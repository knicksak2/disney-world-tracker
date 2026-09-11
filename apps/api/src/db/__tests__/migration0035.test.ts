/**
 * Migration test for `0035_pins_and_challenges.sql`.
 *
 * Applies 0001 (for the `users` FK target) then 0035 to a fresh pg-mem database
 * and asserts the award-ledger contract:
 *
 *   - the `user_pins` table exists with `id`, `user_id`, `pin_id`, `awarded_at`;
 *   - `user_pins_user_id_idx` exists;
 *   - the UNIQUE (user_id, pin_id) constraint is observable at the storage layer:
 *     the same Pin cannot be awarded to the same User twice (this is what backs
 *     the evaluator's idempotent `ON CONFLICT DO NOTHING`), while the same Pin
 *     for a different User and a different Pin for the same User both succeed;
 *   - deleting a User cascades away their awards.
 *
 * Mirrors the pg-mem setup in migration0009.test.ts.
 *
 * Validates: Requirements 2.4, 3.1 (Property 1)
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

describe('migration 0035_pins_and_challenges (pg-mem)', () => {
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

    userA = randomUUID();
    userB = randomUUID();
    await seedUser(pool, userA, 'a@example.com');
    await seedUser(pool, userB, 'b@example.com');
  });

  it('creates user_pins with the expected columns', () => {
    const columns = [...db.getTable('user_pins').getColumns()].map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['id', 'user_id', 'pin_id', 'awarded_at']));
  });

  it('creates the board index', () => {
    const indexNames = db.getTable('user_pins').listIndices().map((idx) => idx.name);
    expect(indexNames).toContain('user_pins_user_id_idx');
  });

  it('awards a pin and reads it back', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'gold_coaster_royalty']);
    const r = await pool.query(`SELECT user_id, pin_id FROM user_pins WHERE user_id = $1`, [userA]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ pin_id: 'gold_coaster_royalty' });
  });

  it('rejects awarding the same pin to the same user twice (UNIQUE)', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'silver_squad_10']);
    await expect(
      pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'silver_squad_10']),
    ).rejects.toThrow();
  });

  it('allows the same pin for a different user and a different pin for the same user', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'silver_squad_10']);
    await expect(
      pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userB, 'silver_squad_10']),
    ).resolves.toBeDefined();
    await expect(
      pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'gold_coaster_royalty']),
    ).resolves.toBeDefined();
  });

  it('cascades awards away when the user is deleted', async () => {
    await pool.query(`INSERT INTO user_pins (user_id, pin_id) VALUES ($1, $2)`, [userA, 'mythic_whole_catalog']);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userA]);
    const r = await pool.query(`SELECT count(*)::int AS n FROM user_pins WHERE user_id = $1`, [userA]);
    expect(r.rows[0]?.n).toBe(0);
  });
});
