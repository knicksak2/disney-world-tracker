/**
 * Migration test for `0036_pin_claiming.sql`.
 *
 * Applies 0001 (users FK target), 0035 (user_pins itself), then 0036 to a
 * fresh pg-mem database and asserts the claim-column contract:
 *
 *   - `user_pins.claimed_at` exists and defaults to NULL on a fresh award;
 *   - `claimed_at` can be set independently of `awarded_at`, and read back;
 *   - 0035's UNIQUE (user_id, pin_id) constraint and the cascade-on-delete
 *     behavior are untouched by this migration (it adds a column, nothing
 *     else).
 *
 * Mirrors the pg-mem setup in migration0035.test.ts.
 *
 * Validates: Requirements 20.1, 20.2
 */

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

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

async function seedUser(pool: Pool, id: string, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x')`,
    [id, email],
  );
}

describe('migration 0036_pin_claiming (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0035_pins_and_challenges.sql');
    applyMigration(db, '0036_pin_claiming.sql');

    userA = randomUUID();
    userB = randomUUID();
    await seedUser(pool, userA, 'a@example.com');
    await seedUser(pool, userB, 'b@example.com');
  });

  it('adds claimed_at to user_pins', () => {
    const columns = [...db.getTable('user_pins').getColumns()].map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'user_id', 'pin_id', 'awarded_at', 'claimed_at']),
    );
  });

  it('defaults claimed_at to NULL on a fresh award (ready to claim)', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'gold_coaster_royalty']);
    const r = await pool.query(
      `SELECT awarded_at, claimed_at FROM user_pins WHERE user_id = $1 AND pin_id = $2`,
      [userA, 'gold_coaster_royalty'],
    );
    expect(r.rows[0]?.['awarded_at']).not.toBeNull();
    expect(r.rows[0]?.['claimed_at']).toBeNull();
  });

  it('sets claimed_at independently of awarded_at and reads it back', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'silver_squad_10']);
    await pool.query(
      `UPDATE user_pins SET claimed_at = now() WHERE user_id = $1 AND pin_id = $2`,
      [userA, 'silver_squad_10'],
    );
    const r = await pool.query(
      `SELECT claimed_at FROM user_pins WHERE user_id = $1 AND pin_id = $2`,
      [userA, 'silver_squad_10'],
    );
    expect(r.rows[0]?.['claimed_at']).not.toBeNull();
  });

  it('leaves the 0035 UNIQUE (user_id, pin_id) constraint intact', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'silver_squad_10']);
    await expect(
      pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'silver_squad_10']),
    ).rejects.toThrow();
    // A different user or a different pin still succeeds.
    await expect(
      pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userB, 'silver_squad_10']),
    ).resolves.toBeDefined();
  });

  it('leaves the 0035 cascade-on-delete behavior intact', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'mythic_whole_catalog']);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userA]);
    const r = await pool.query(`SELECT count(*)::int AS n FROM user_pins WHERE user_id = $1`, [userA]);
    expect(r.rows[0]?.['n']).toBe(0);
  });
});
