/**
 * Test-only migration parser for the account-deletion completeness tests
 * (Property 11 and Property 28).
 *
 * It reads every `apps/api/migrations/NNNN_*.sql` file and reconstructs just
 * enough schema to answer three questions without a database:
 *   1. which `table.column` pairs reference `users(id)` (and with what ON DELETE),
 *   2. what each table's primary / unique keys are (the chunk-key rule),
 *   3. which tables cascade from which (the cascade audit).
 *
 * Handled: `CREATE TABLE` (inline and table-level constraints), `ALTER TABLE`
 * `ADD COLUMN` / `DROP COLUMN` / `RENAME COLUMN` / `ADD ... PRIMARY KEY|UNIQUE|FOREIGN KEY`,
 * and non-partial `CREATE UNIQUE INDEX`. Anything else is ignored.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type OnDelete = 'cascade' | 'set_null' | 'no_action' | 'restrict' | 'set_default';

export interface ParsedColumn {
  readonly name: string;
  readonly nullable: boolean;
  /** Lower-cased first type word (`uuid`, `text`, `timestamptz`, `integer`, ...). Used by the row seeder. */
  readonly type: string;
  /** True when the column definition carries a `DEFAULT`. */
  readonly hasDefault: boolean;
}

export interface ParsedTable {
  readonly name: string;
  readonly columns: Map<string, ParsedColumn>;
  primaryKey: string[];
  readonly uniques: string[][];
  /** Raw text of every inline and table-level CHECK, in declaration order (later migrations later). */
  readonly checks: string[];
}

export interface ParsedFk {
  readonly table: string;
  readonly column: string;
  readonly refTable: string;
  readonly refColumn: string;
  readonly onDelete: OnDelete;
  readonly nullable: boolean;
}

export interface MigrationSchema {
  readonly tables: Map<string, ParsedTable>;
  /** Every foreign key found, deduplicated by `table.column -> refTable`. */
  readonly foreignKeys: readonly ParsedFk[];
  /** Foreign keys whose target is `users(id)`. */
  readonly userForeignKeys: readonly ParsedFk[];
  /** `ON DELETE CASCADE` edges: deleting a row of `parent` deletes rows of `child`. */
  readonly cascadeEdges: readonly { readonly parent: string; readonly child: string; readonly column: string }[];
}

export const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'migrations',
);

export function migrationFileNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_[a-z0-9_-]+\.sql$/iu.test(n))
    .sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Lexing helpers
// ---------------------------------------------------------------------------

/**
 * Splits SQL into statements at top-level `;`, dropping `--` and block comments.
 * Single-quoted strings and `$$ ... $$` bodies are kept intact.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '$' && next === '$') {
      const end = sql.indexOf('$$', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      cur += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Splits `text` at commas that are outside parentheses and single quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuote) {
      cur += ch;
      if (ch === "'") inQuote = false;
      continue;
    }
    if (ch === "'") {
      inQuote = true;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const unquote = (s: string): string => s.trim().replace(/^"|"$/g, '').toLowerCase();

const columnList = (s: string): string[] => s.split(',').map(unquote).filter(Boolean);

function parseOnDelete(text: string): OnDelete {
  const m = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i.exec(text);
  if (!m) return 'no_action';
  switch (m[1]!.replace(/\s+/g, ' ').toUpperCase()) {
    case 'CASCADE':
      return 'cascade';
    case 'SET NULL':
      return 'set_null';
    case 'SET DEFAULT':
      return 'set_default';
    case 'RESTRICT':
      return 'restrict';
    default:
      return 'no_action';
  }
}

const REFERENCES_RE = /REFERENCES\s+("?\w+"?)\s*\(\s*("?\w+"?)\s*\)/i;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseMigrations(files: readonly string[] = migrationFileNames()): MigrationSchema {
  const tables = new Map<string, ParsedTable>();
  const fks = new Map<string, ParsedFk>();

  const ensureTable = (name: string): ParsedTable => {
    let t = tables.get(name);
    if (!t) {
      t = { name, columns: new Map(), primaryKey: [], uniques: [], checks: [] };
      tables.set(name, t);
    }
    return t;
  };

  const addFk = (fk: ParsedFk): void => {
    fks.set(`${fk.table}.${fk.column}->${fk.refTable}`, fk);
  };

  /** Adds one column definition (`name TYPE ... [PRIMARY KEY] [REFERENCES t(c) ...]`). */
  const addColumnDef = (table: ParsedTable, def: string): void => {
    const m = /^("?\w+"?)\s+(.*)$/is.exec(def);
    if (!m) return;
    const name = unquote(m[1]!);
    const rest = m[2]!;
    const isPk = /\bPRIMARY\s+KEY\b/i.test(rest);
    const nullable = !isPk && !/\bNOT\s+NULL\b/i.test(rest);
    table.columns.set(name, {
      name,
      nullable,
      type: (/^([A-Za-z_]+)/.exec(rest)?.[1] ?? '').toLowerCase(),
      hasDefault: /\bDEFAULT\b/i.test(rest),
    });
    const inlineCheck = /\bCHECK\s*\(([\s\S]*)\)/i.exec(rest);
    if (inlineCheck) table.checks.push(inlineCheck[1]!);
    if (isPk) table.primaryKey = [name];
    else if (/\bUNIQUE\b/i.test(rest)) table.uniques.push([name]);
    const ref = REFERENCES_RE.exec(rest);
    if (ref) {
      addFk({
        table: table.name,
        column: name,
        refTable: unquote(ref[1]!),
        refColumn: unquote(ref[2]!),
        onDelete: parseOnDelete(rest.slice(ref.index)),
        nullable,
      });
    }
  };

  /** Adds a table-level constraint; returns true when `item` was one. */
  const addTableConstraint = (table: ParsedTable, item: string): boolean => {
    const body = item.replace(/^CONSTRAINT\s+"?\w+"?\s+/i, '');
    const pk = /^PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(body);
    if (pk) {
      table.primaryKey = columnList(pk[1]!);
      return true;
    }
    const uq = /^UNIQUE\s*\(([^)]*)\)/i.exec(body);
    if (uq) {
      table.uniques.push(columnList(uq[1]!));
      return true;
    }
    const fk = /^FOREIGN\s+KEY\s*\(([^)]*)\)\s*(REFERENCES.*)$/is.exec(body);
    if (fk) {
      const ref = REFERENCES_RE.exec(fk[2]!);
      if (ref) {
        for (const col of columnList(fk[1]!)) {
          addFk({
            table: table.name,
            column: col,
            refTable: unquote(ref[1]!),
            refColumn: unquote(ref[2]!),
            onDelete: parseOnDelete(fk[2]!),
            nullable: table.columns.get(col)?.nullable ?? true,
          });
        }
      }
      return true;
    }
    const check = /^CHECK\s*\(([\s\S]*)\)\s*$/i.exec(body);
    if (check) {
      table.checks.push(check[1]!);
      return true;
    }
    return /^(EXCLUDE|LIKE)\b/i.test(body);
  };

  for (const file of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of splitStatements(sql)) {
      const create = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?\w+"?)\s*\(/i.exec(stmt);
      if (create) {
        const open = stmt.indexOf('(', create.index + create[0].length - 1);
        let depth = 0;
        let close = -1;
        for (let i = open; i < stmt.length; i++) {
          if (stmt[i] === '(') depth++;
          else if (stmt[i] === ')' && --depth === 0) {
            close = i;
            break;
          }
        }
        if (close === -1) continue;
        const table = ensureTable(unquote(create[1]!));
        for (const item of splitTopLevel(stmt.slice(open + 1, close))) {
          if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE|LIKE)\b/i.test(item)) {
            addTableConstraint(table, item);
          } else {
            addColumnDef(table, item);
          }
        }
        continue;
      }

      const alter = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?("?\w+"?)\s+([\s\S]*)$/i.exec(stmt);
      if (alter) {
        const table = ensureTable(unquote(alter[1]!));
        const rename = /^RENAME\s+COLUMN\s+("?\w+"?)\s+TO\s+("?\w+"?)$/i.exec(alter[2]!.trim());
        if (rename) {
          const from = unquote(rename[1]!);
          const to = unquote(rename[2]!);
          const col = table.columns.get(from);
          if (col) {
            table.columns.delete(from);
            table.columns.set(to, { ...col, name: to });
            table.primaryKey = table.primaryKey.map((c) => (c === from ? to : c));
          }
          continue;
        }
        for (const clause of splitTopLevel(alter[2]!)) {
          const add = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\s\S]+)$/i.exec(clause);
          if (add) {
            addColumnDef(table, add[1]!);
            continue;
          }
          const drop = /^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?("?\w+"?)/i.exec(clause);
          if (drop) {
            table.columns.delete(unquote(drop[1]!));
            continue;
          }
          const addConstraint = /^ADD\s+([\s\S]+)$/i.exec(clause);
          if (addConstraint) addTableConstraint(table, addConstraint[1]!);
        }
        continue;
      }

      const idx = /^CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(?:ONLY\s+)?("?\w+"?)\s*(?:USING\s+\w+\s*)?\(([^)]*)\)\s*(WHERE\b[\s\S]*)?$/i.exec(
        stmt,
      );
      // A partial unique index does not make the columns unique across the whole table; and an
      // expression index (a function call or cast in the list) is not a plain column key.
      if (idx && !idx[3] && !/[()]|::/.test(idx[2]!)) {
        ensureTable(unquote(idx[1]!)).uniques.push(columnList(idx[2]!));
      }
    }
  }

  const foreignKeys = [...fks.values()];
  return {
    tables,
    foreignKeys,
    userForeignKeys: foreignKeys.filter((f) => f.refTable === 'users' && f.refColumn === 'id'),
    cascadeEdges: foreignKeys
      .filter((f) => f.onDelete === 'cascade')
      .map((f) => ({ parent: f.refTable, child: f.table, column: f.column })),
  };
}

/** True when `columns` contain the table's whole primary key or one whole unique key. */
export function coversUniqueKey(table: ParsedTable, columns: readonly string[]): boolean {
  const have = new Set(columns);
  const keys = [table.primaryKey, ...table.uniques].filter((k) => k.length > 0);
  return keys.some((key) => key.every((c) => have.has(c)));
}
