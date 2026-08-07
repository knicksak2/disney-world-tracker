import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

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

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

const BASE_MIGRATIONS = [
  '0001_init.sql',
  '0015_trips.sql',
  '0019_planned_item_scheduling.sql',
];

describe('migration 0024_planned_item_optimization_result', () => {
  let db: IMemoryDb;
  let pool: any;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    applyMigration(db, '0024_planned_item_optimization_result.sql');

    pool = {
      query: async (text: string, params: any[] = []) => {
        let paramIndex = 1;
        let psql = text;
        for (const p of params) {
          psql = psql
            .split(`$${paramIndex++}`)
            .join(typeof p === 'string' || p instanceof Date ? `'${p instanceof Date ? p.toISOString() : p}'` : p);
        }
        const res = db.public.query(psql);
        return { rows: res.rows || res || [] };
      },
    };
  });

  it('adds the optimization-result columns to planned_items', async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'planned_items'
        AND column_name IN (
          'predicted_wait_minutes',
          'travel_from_prev_minutes',
          'travel_from_prev_kind',
          'optimized_at'
        );
    `);

    const cols = new Set(res.rows.map((r: any) => r.column_name));
    // The columns' nullability (NULL = "not optimized yet", R8.3) is proven
    // behaviorally in repo.optimizationResult.integration.test.ts, where a
    // freshly-added item reads these back as null; pg-mem's information_schema
    // does not report is_nullable reliably, so we assert presence here.
    expect(cols.has('predicted_wait_minutes')).toBe(true);
    expect(cols.has('travel_from_prev_minutes')).toBe(true);
    expect(cols.has('travel_from_prev_kind')).toBe(true);
    expect(cols.has('optimized_at')).toBe(true);
  });
});
