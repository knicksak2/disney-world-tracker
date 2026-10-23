/**
 * Shared pg-mem harness for the account-deletion repo tests.
 *
 *  - `buildMigratedDb()` applies every migration 0001..0064 verbatim (apart from the two
 *    pg-mem-specific strips `migration0064.test.ts` already uses).
 *  - `createTestPool()` returns a `DbPool` over pg-mem that RECORDS every statement exactly as the repo
 *    sent it (text, params, rows affected) and applies two compatibility rewrites, see `adaptSql`.
 *  - `createSeeder()` inserts rows from the migrations' own column definitions, so fixtures mirror the
 *    real schema: NOT NULL columns without a default get a valid value derived from the column's type,
 *    its CHECK ... IN (...) list, or its foreign key (a parent row is created).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import type { DbPool } from '../../../db/pool.js';
import type { LoggerPort } from '../ports.js';
import {
  MIGRATIONS_DIR,
  migrationFileNames,
  parseMigrations,
  type MigrationSchema,
  type ParsedTable,
} from './migrationSchema.js';

// ---------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------

export function buildMigratedDb(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });
  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  db.public.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  for (const name of migrationFileNames()) {
    let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    db.public.none(sql);
  }
  return db;
}

// ---------------------------------------------------------------------------------------------
// Recording pool with pg-mem compatibility rewrites
// ---------------------------------------------------------------------------------------------

export interface RecordedStatement {
  /** The statement exactly as the repo sent it (before any compatibility rewrite). */
  readonly text: string;
  readonly params: readonly unknown[];
  /** Rows affected (INSERT/UPDATE/DELETE) or returned (SELECT); null when the driver gave none. */
  rowCount: number | null;
}

interface RawQueryable {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[]; rowCount?: number | null }>;
}

/** Index just past the `)` that closes the `(` at `open`; quotes are skipped. -1 when unbalanced. */
function matchParen(text: string, open: number): number {
  let depth = 0;
  let inQuote = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") inQuote = true;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * pg-mem fallbacks, both recorded in the task findings:
 *
 * 1. pg-mem re-evaluates an uncorrelated `IN (SELECT ... LIMIT n)` (and `ANY(ARRAY(SELECT ...))`) subselect for
 *    every candidate row, against the table as the statement is already changing it. A bounded
 *    `DELETE ... WHERE k IN (SELECT k ... LIMIT n)` therefore removes EVERY matching row instead of n. Postgres
 *    evaluates it once. This rewrite runs the bounded subselect once (on the same executor, so it sees the open
 *    transaction) and substitutes its result as a parameter list, which is Postgres's semantics.
 * 2. `col = ANY($n)` / `ANY($n::uuid[])` with an array parameter becomes an `IN` list.
 */
async function adaptSql(
  exec: RawQueryable,
  text: string,
  params: ReadonlyArray<unknown> | undefined,
): Promise<[string, ReadonlyArray<unknown> | undefined]> {
  if (params === undefined) return [text, params];
  let sql = text;
  const all = [...params];

  // 1. Materialize bounded subselects, one at a time (positions shift after each replacement).
  for (let guard = 0; guard < 8; guard++) {
    const re = /(\bIN\s*\(\s*SELECT\b|=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\b)/gi;
    let found: { start: number; end: number; inner: string } | null = null;
    for (let m = re.exec(sql); m !== null; m = re.exec(sql)) {
      const isAny = /ANY/i.test(m[0]);
      const open = sql.indexOf('(', isAny ? m.index + m[0].toUpperCase().indexOf('ARRAY') : m.index);
      const close = matchParen(sql, open);
      if (close === -1) continue;
      const inner = sql.slice(open + 1, close - 1);
      if (!/\bLIMIT\s+\$\d+/i.test(inner)) continue;
      // For ANY(ARRAY(<inner>)) one more `)` closes the ANY call.
      const end = isAny ? sql.indexOf(')', close) + 1 : close;
      found = { start: m.index, end, inner };
      break;
    }
    if (found === null) break;

    const used = [...new Set([...found.inner.matchAll(/\$(\d+)/g)].map((x) => Number(x[1])))].sort((a, b) => a - b);
    const renumbered = found.inner.replace(/\$(\d+)/g, (_, n: string) => `$${used.indexOf(Number(n)) + 1}`);
    const res = await exec.query(renumbered, used.map((i) => all[i - 1]));
    const firstCol = res.rows.length > 0 ? Object.keys(res.rows[0] as object)[0]! : '';
    const placeholders = res.rows.map((row) => {
      all.push((row as Record<string, unknown>)[firstCol]);
      return `$${all.length}`;
    });
    sql = `${sql.slice(0, found.start)}IN (${placeholders.length > 0 ? placeholders.join(', ') : 'NULL'})${sql.slice(found.end)}`;
  }

  // 2. `= ANY($n)` with an array parameter.
  sql = sql.replace(/=\s*ANY\s*\(\s*\$(\d+)(?:::\w+\[\])?\s*\)/gi, (match, n: string) => {
    const arr = all[Number(n) - 1];
    if (!Array.isArray(arr)) return match;
    if (arr.length === 0) return 'IN (NULL)';
    return `IN (${arr
      .map((v) => {
        all.push(v);
        return `$${all.length}`;
      })
      .join(', ')})`;
  });

  return [sql, all];
}

export interface TestPool {
  readonly pool: DbPool;
  /** Every statement the code under test sent, in order, as sent. */
  readonly statements: RecordedStatement[];
  /** Clears `statements`. */
  reset(): void;
}

export function createTestPool(db: IMemoryDb): TestPool {
  const { Pool } = db.adapters.createPg();
  const raw = new Pool() as unknown as {
    query: RawQueryable['query'];
    connect(): Promise<RawQueryable & { release(): void }>;
  };
  const statements: RecordedStatement[] = [];
  // pg-mem accepts BEGIN / COMMIT / ROLLBACK but ROLLBACK does not undo anything. Transactions are therefore
  // emulated with snapshots (pg-mem is single-connection, so one stack is exact): BEGIN snapshots the whole
  // database, ROLLBACK restores the snapshot, COMMIT drops it. Atomicity tests (a fenced counter rolling a trip
  // back, a throwing seam leaving photos un-deleted) depend on this.
  const snapshots: { restore(): void }[] = [];

  const wrap = (target: RawQueryable): RawQueryable => ({
    async query(text, params) {
      const entry: RecordedStatement = { text, params: params ? [...params] : [], rowCount: null };
      statements.push(entry);
      const control = text.trim().toUpperCase();
      if (control === 'BEGIN') {
        snapshots.push(db.backup());
        entry.rowCount = 0;
        return { rows: [], rowCount: 0 };
      }
      if (control === 'COMMIT') {
        snapshots.pop();
        entry.rowCount = 0;
        return { rows: [], rowCount: 0 };
      }
      if (control === 'ROLLBACK') {
        snapshots.pop()?.restore();
        entry.rowCount = 0;
        return { rows: [], rowCount: 0 };
      }
      const [t, p] = await adaptSql(target, text, params);
      const res = await target.query(t, p);
      entry.rowCount = res.rowCount ?? res.rows.length;
      return res;
    },
  });

  const pool = {
    query: (text: string, params?: ReadonlyArray<unknown>) => wrap(raw).query(text, params),
    async connect() {
      const client = await raw.connect();
      const wrapped = wrap(client);
      return { query: wrapped.query, release: () => client.release() };
    },
  } as unknown as DbPool;

  return { pool, statements, reset: () => void statements.splice(0, statements.length) };
}

// ---------------------------------------------------------------------------------------------
// Row seeder (fixtures derived from the migrations' own column definitions)
// ---------------------------------------------------------------------------------------------

export type Row = Record<string, unknown>;

let cachedSchema: MigrationSchema | null = null;
export function migrationSchema(): MigrationSchema {
  cachedSchema ??= parseMigrations();
  return cachedSchema;
}

function enumValue(table: ParsedTable, column: string): string | null {
  const re = new RegExp(`\\b${column}\\s+IN\\s*\\(([^)]*)\\)`, 'i');
  for (let i = table.checks.length - 1; i >= 0; i--) {
    const m = re.exec(table.checks[i]!);
    if (m) {
      const first = /'([^']*)'/.exec(m[1]!);
      if (first) return first[1]!;
    }
  }
  return null;
}

/**
 * Column values the generic generator cannot know: multi-column CHECKs and cross-column rules. Keyed by
 * table; every entry restates what the migration's CHECK demands.
 */
export type TableDefaults = Readonly<Record<string, (seeder: Seeder) => Row | Promise<Row>>>;

export interface Seeder {
  /** Inserts one row and returns it (`RETURNING *`). Missing NOT NULL columns are filled; FK parents are created. */
  insertRow(table: string, overrides?: Row): Promise<Row>;
}

export interface SeederOptions {
  readonly tableDefaults?: TableDefaults;
  /**
   * The user an otherwise-unspecified NOT NULL foreign key to `users` points at. A fixture sets it to a
   * BYSTANDER so a parent row created on the way (a list owner, a trip creator) never names the person
   * under test. Without it such a column throws.
   */
  readonly fallbackUserId?: string;
}

export function createSeeder(pool: DbPool, options: SeederOptions = {}): Seeder {
  const schema = migrationSchema();
  const tableDefaults = options.tableDefaults ?? {};
  let counter = 0;
  const self: Seeder = { insertRow: (table, overrides) => insertRow(table, overrides) };

  async function insertRow(table: string, overrides: Row = {}, depth = 0): Promise<Row> {
    if (depth > 8) throw new Error(`seed ${table}: foreign key chain too deep`);
    const parsed = schema.tables.get(table);
    if (!parsed) throw new Error(`seed: unknown table ${table}`);
    const fkByColumn = new Map(schema.foreignKeys.filter((f) => f.table === table).map((f) => [f.column, f]));
    const base = (await tableDefaults[table]?.(self)) ?? {};
    const given: Row = { ...base, ...overrides };

    const columns: string[] = [];
    const values: unknown[] = [];
    const casts: string[] = [];
    for (const [name, col] of parsed.columns) {
      let value: unknown;
      if (Object.prototype.hasOwnProperty.call(given, name)) {
        value = given[name];
      } else if (col.nullable || col.hasDefault) {
        continue;
      } else {
        const fk = fkByColumn.get(name);
        if (fk) {
          if (fk.refTable === 'users') {
            if (options.fallbackUserId === undefined) {
              throw new Error(`seed ${table}.${name}: pass a user id explicitly (no fallbackUserId configured)`);
            }
            value = options.fallbackUserId;
          } else {
            const parent = await insertRow(fk.refTable, {}, depth + 1);
            value = parent[fk.refColumn];
          }
        } else {
          const en = enumValue(parsed, name);
          counter += 1;
          switch (en !== null ? 'enum' : col.type) {
            case 'enum':
              value = en;
              break;
            case 'uuid':
              value = randomUUID();
              break;
            case 'text':
            case 'citext':
            case 'varchar':
            case 'char':
              value = `${table}.${name}.${counter}`;
              break;
            case 'integer':
            case 'int':
            case 'smallint':
            case 'bigint':
            case 'numeric':
            case 'real':
            case 'double':
              value = 1;
              break;
            case 'boolean':
              value = false;
              break;
            case 'date':
              value = '2026-03-01';
              break;
            case 'timestamptz':
            case 'timestamp':
              value = new Date('2026-03-01T12:00:00Z');
              break;
            case 'time':
              value = '12:00:00';
              break;
            case 'jsonb':
            case 'json':
              value = '{}';
              break;
            default:
              throw new Error(`seed ${table}.${name}: no generator for type '${col.type}'`);
          }
        }
      }
      columns.push(name);
      values.push(value);
      casts.push(col.type === 'jsonb' && typeof value !== 'undefined' ? '::jsonb' : '');
    }
    for (const k of Object.keys(given)) {
      if (!parsed.columns.has(k)) throw new Error(`seed ${table}: unknown column ${k}`);
    }

    const sql =
      columns.length === 0
        ? `INSERT INTO ${table} DEFAULT VALUES RETURNING *`
        : `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}${casts[i]}`).join(', ')}) RETURNING *`;
    const res = await pool.query(sql, values.map((v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v)));
    return res.rows[0] as Row;
  }

  return self;
}

// ---------------------------------------------------------------------------------------------
// Recording logger
// ---------------------------------------------------------------------------------------------

export interface LogCall {
  readonly level: 'info' | 'warn' | 'error';
  readonly obj: Record<string, unknown>;
  readonly msg?: string;
}

/** A `LoggerPort` that records every call, so a test can assert what was (and was not) logged. */
export function createRecordingLogger(): { logger: LoggerPort; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const record =
    (level: LogCall['level']) =>
    (obj: object, msg?: string): void => {
      calls.push({ level, obj: obj as Record<string, unknown>, ...(msg === undefined ? {} : { msg }) });
    };
  return { logger: { info: record('info'), warn: record('warn'), error: record('error') }, calls };
}

// ---------------------------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------------------------

/** Every table's rows (`SELECT *` order is insertion order in pg-mem), keyed by table name. */
export function dumpAllTables(db: IMemoryDb): Record<string, readonly Row[]> {
  const out: Record<string, readonly Row[]> = {};
  for (const name of migrationSchema().tables.keys()) {
    out[name] = db.public.getTable(name).find() as Row[];
  }
  return out;
}

/** JSON text of every row of every table, with Dates as ISO strings (for substring searches). */
export function dumpAsText(db: IMemoryDb, tables?: readonly string[]): string {
  const dump = dumpAllTables(db);
  const names = tables ?? Object.keys(dump);
  return names.map((t) => JSON.stringify({ [t]: dump[t] })).join('\n');
}
