/**
 * Migration test for `0069_expense_category_lightning_lane.sql`.
 *
 * Validates: Requirements 11.8 (widen expenses category to include lightning_lane)
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_FILE = '0069_expense_category_lightning_lane.sql';
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function jsonbTypeof(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  let parsed = val;
  if (typeof val === 'string') {
    try {
      parsed = JSON.parse(val);
    } catch {
      return 'string';
    }
  }
  if (parsed === null) return 'null';
  if (Array.isArray(parsed)) return 'array';
  if (typeof parsed === 'object') return 'object';
  if (typeof parsed === 'string') return 'string';
  if (typeof parsed === 'number') return 'number';
  if (typeof parsed === 'boolean') return 'boolean';
  return 'null';
}

function buildPgMemDatabase(): IMemoryDb {
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
    name: 'btrim',
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
  db.public.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: jsonbTypeof,
  });
  return db;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

describe('migration 0069_expense_category_lightning_lane (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let tripId: string;
  let userId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    // Apply migrations up to 0068
    for (const name of migrationNames().filter((n) => n < MIGRATION_FILE)) {
      applyMigration(db, name);
    }

    userId = randomUUID();
    await pool.query(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${userId}', 'test@example.com', 'hash')
    `);

    tripId = randomUUID();
    await pool.query(`
      INSERT INTO trips (id, name, start_date, end_date, creator_id)
      VALUES ('${tripId}', 'Test Trip', '2026-11-01', '2026-11-05', '${userId}')
    `);
  });

  it('rejects lightning_lane before 0069 is applied', async () => {
    await expect(
      pool.query(`
        INSERT INTO expenses (trip_id, payer_id, created_by, amount_cents, description, expense_date, category, split_mode)
        VALUES ('${tripId}', '${userId}', '${userId}', 3500, 'Multi Pass', '2026-11-02', 'lightning_lane', 'even')
      `),
    ).rejects.toThrow();
  });

  it('accepts lightning_lane after 0069 is applied', async () => {
    applyMigration(db, MIGRATION_FILE);

    const res = await pool.query(`
      INSERT INTO expenses (trip_id, payer_id, created_by, amount_cents, description, expense_date, category, split_mode)
      VALUES ('${tripId}', '${userId}', '${userId}', 3500, 'Multi Pass', '2026-11-02', 'lightning_lane', 'even')
      RETURNING category
    `);

    expect(res.rows[0]?.category).toBe('lightning_lane');
  });

  it('still rejects an invalid category after 0069', async () => {
    applyMigration(db, MIGRATION_FILE);

    await expect(
      pool.query(`
        INSERT INTO expenses (trip_id, payer_id, created_by, amount_cents, description, expense_date, category, split_mode)
        VALUES ('${tripId}', '${userId}', '${userId}', 3500, 'Invalid', '2026-11-02', 'not_a_category', 'even')
      `),
    ).rejects.toThrow();
  });
});
