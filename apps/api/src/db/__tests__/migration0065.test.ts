/**
 * Migration test for `0065_ticket_prices.sql`.
 *
 * Validates: Requirements 11.6, 20.3
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_FILE = '0065_ticket_prices.sql';
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

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

describe('migration 0065_ticket_prices (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    for (const name of migrationNames().filter((n) => n <= MIGRATION_FILE)) {
      applyMigration(db, name);
    }
  });

  it('is wrapped in BEGIN/COMMIT and contains no REFERENCES users', () => {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    expect(raw).toMatch(/^\s*BEGIN;/m);
    expect(raw).toMatch(/^\s*COMMIT;/m);
    expect(raw).not.toMatch(/REFERENCES\s+users/i);
  });

  it('re-applying 0065 is a no-op (idempotent)', () => {
    expect(() => applyMigration(db, MIGRATION_FILE)).not.toThrow();
  });

  it('ticket_price_control singleton row exists with id = 1 and rejects id <> 1', async () => {
    const res = await pool.query('SELECT * FROM ticket_price_control WHERE id = 1');
    expect(res.rows).toHaveLength(1);

    await expect(
      pool.query('INSERT INTO ticket_price_control (id) VALUES (2)')
    ).rejects.toThrow();
  });

  it('ticket_prices validates primary key and check constraints', async () => {
    // Valid insert
    await pool.query(`
      INSERT INTO ticket_prices (
        discount_group, num_days, age_group, option_code, park, start_date,
        price_cents, tax_cents, valid_end_date, product_id
      ) VALUES (
        'std-gst', 4, 'adult', 'base', 'any', '2026-10-25',
        45000, 2925, '2026-10-31', 'prod-1'
      )
    `);

    // Duplicate PK fails
    await expect(
      pool.query(`
        INSERT INTO ticket_prices (
          discount_group, num_days, age_group, option_code, park, start_date,
          price_cents, tax_cents, valid_end_date, product_id
        ) VALUES (
          'std-gst', 4, 'adult', 'base', 'any', '2026-10-25',
          46000, 2990, '2026-10-31', 'prod-1'
        )
      `)
    ).rejects.toThrow();

    // Invalid discount_group fails
    await expect(
      pool.query(`
        INSERT INTO ticket_prices (
          discount_group, num_days, age_group, option_code, park, start_date,
          price_cents, tax_cents, valid_end_date, product_id
        ) VALUES (
          'military', 4, 'adult', 'base', 'any', '2026-10-26',
          45000, 2925, '2026-10-31', 'prod-1'
        )
      `)
    ).rejects.toThrow();

    // num_days outside 1..10 fails
    await expect(
      pool.query(`
        INSERT INTO ticket_prices (
          discount_group, num_days, age_group, option_code, park, start_date,
          price_cents, tax_cents, valid_end_date, product_id
        ) VALUES (
          'std-gst', 0, 'adult', 'base', 'any', '2026-10-26',
          45000, 2925, '2026-10-31', 'prod-1'
        )
      `)
    ).rejects.toThrow();

    // price_cents <= 0 fails
    await expect(
      pool.query(`
        INSERT INTO ticket_prices (
          discount_group, num_days, age_group, option_code, park, start_date,
          price_cents, tax_cents, valid_end_date, product_id
        ) VALUES (
          'std-gst', 1, 'adult', 'base', 'any', '2026-10-26',
          0, 0, '2026-10-26', 'prod-1'
        )
      `)
    ).rejects.toThrow();
  });

  it('ticket_price_sets validates columns and constraints', async () => {
    // Valid set with additive columns window_days, horizon_date, as_of
    await pool.query(`
      INSERT INTO ticket_price_sets (
        discount_group, num_days, as_of, horizon_date, row_count, window_days
      ) VALUES (
        'std-gst', 1, now(), '2027-10-25', 100, 365
      )
    `);

    // window_days = 0 fails
    await expect(
      pool.query(`
        INSERT INTO ticket_price_sets (
          discount_group, num_days, window_days
        ) VALUES (
          'fl-resident', 1, 0
        )
      `)
    ).rejects.toThrow();

    // window_days accepts NULL
    await pool.query(`
      INSERT INTO ticket_price_sets (
        discount_group, num_days, window_days
      ) VALUES (
        'fl-resident', 1, NULL
      )
    `);
  });
});

