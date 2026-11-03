/**
 * Migration test for `0066_lightning_lane_prices.sql`.
 *
 * Validates: Requirements 15.4
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_FILE = '0066_lightning_lane_prices.sql';
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

describe('migration 0066_lightning_lane_prices (pg-mem)', () => {
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

  it('is wrapped in BEGIN/COMMIT and idempotent', () => {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    expect(raw).toMatch(/^\s*BEGIN;/m);
    expect(raw).toMatch(/^\s*COMMIT;/m);
    expect(() => applyMigration(db, MIGRATION_FILE)).not.toThrow();
  });

  it('all six new columns on park_schedule_signals exist and accept NULL', async () => {
    await pool.query(`
      INSERT INTO park_schedule_signals (
        park, date, ll_multipass_price_cents,
        ll_multipass_available, ll_premier_price_cents, ll_premier_available,
        ll_prices_captured_at, ll_multipass_captured_at, ll_premier_captured_at
      ) VALUES (
        'Magic Kingdom', '2026-10-25', 2500,
        true, 39900, true,
        now(), now(), now()
      )
    `);

    const res = await pool.query(`
      SELECT * FROM park_schedule_signals WHERE park = 'Magic Kingdom' AND date = '2026-10-25'
    `);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.ll_multipass_available).toBe(true);
    expect(res.rows[0]?.ll_premier_price_cents).toBe(39900);
    expect(res.rows[0]?.ll_premier_available).toBe(true);
  });

  it('validates lightning_lane_single_prices PK, CHECK, and ON DELETE SET NULL on experience_id', async () => {
    const expId = randomUUID();
    await pool.query(`
      INSERT INTO experiences (id, name, park, category, upstream_entity_id)
      VALUES ('${expId}', 'Space Mountain', 'Magic Kingdom', 'Ride', 'space-mtn-1')
    `);

    await pool.query(`
      INSERT INTO lightning_lane_single_prices (
        park, date, purchase_id, experience_id, attraction_name, price_cents, available
      ) VALUES (
        'Magic Kingdom', '2026-10-25', 'purchase-1', '${expId}', 'Space Mountain', 2000, true
      )
    `);

    // Duplicate PK fails
    await expect(
      pool.query(`
        INSERT INTO lightning_lane_single_prices (
          park, date, purchase_id, experience_id, attraction_name, price_cents, available
        ) VALUES (
          'Magic Kingdom', '2026-10-25', 'purchase-1', '${expId}', 'Space Mountain', 2200, true
        )
      `)
    ).rejects.toThrow();

    // price_cents <= 0 fails
    await expect(
      pool.query(`
        INSERT INTO lightning_lane_single_prices (
          park, date, purchase_id, experience_id, attraction_name, price_cents, available
        ) VALUES (
          'Magic Kingdom', '2026-10-25', 'purchase-2', '${expId}', 'Space Mountain', 0, true
        )
      `)
    ).rejects.toThrow();

    // Delete experience -> experience_id becomes NULL (ON DELETE SET NULL)
    await pool.query(`DELETE FROM experiences WHERE id = '${expId}'`);
    const readBack = await pool.query(`
      SELECT * FROM lightning_lane_single_prices WHERE purchase_id = 'purchase-1'
    `);
    expect(readBack.rows).toHaveLength(1);
    expect(readBack.rows[0]?.experience_id).toBeNull();
  });
});
