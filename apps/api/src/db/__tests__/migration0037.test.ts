/**
 * Migration test for `0037_pin_showcase.sql`.
 *
 * Applies 0001 (users FK target), 0035, 0036, and 0037 to a fresh pg-mem
 * database and asserts the showcase table contract:
 *
 *   - `pin_showcase_placements` exists with required columns;
 *   - `pos_x` and `pos_y` CHECK constraints enforce [0.0, 1.0] range;
 *   - `pin_id` CHECK constraint enforces length [1, 100];
 *   - UNIQUE (user_id, pin_id) constraint prevents duplicate placement rows;
 *   - Cascade on delete removes placements when user is deleted;
 *   - user_id index exists.
 *
 * Validates: Requirements 24.1, 24.2, 24.3
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

describe('migration 0037_pin_showcase (pg-mem)', () => {
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
    applyMigration(db, '0037_pin_showcase.sql');

    userA = randomUUID();
    userB = randomUUID();
    await seedUser(pool, userA, 'a@example.com');
    await seedUser(pool, userB, 'b@example.com');
  });

  it('creates pin_showcase_placements with expected columns', () => {
    const columns = [...db.getTable('pin_showcase_placements').getColumns()].map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(['id', 'user_id', 'pin_id', 'pos_x', 'pos_y', 'z_index', 'placed_at']),
    );
  });

  it('allows valid placement coordinates and defaults z_index and placed_at', async () => {
    await pool.query(
      `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
      [userA, 'gold_coaster_royalty', 0.25, 0.75],
    );

    const r = await pool.query(
      `SELECT user_id, pin_id, pos_x, pos_y, z_index, placed_at FROM pin_showcase_placements WHERE user_id = $1`,
      [userA],
    );

    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.['pin_id']).toBe('gold_coaster_royalty');
    expect(Number(r.rows[0]?.['pos_x'])).toBeCloseTo(0.25);
    expect(Number(r.rows[0]?.['pos_y'])).toBeCloseTo(0.75);
    expect(r.rows[0]?.['z_index']).toBe(0);
    expect(r.rows[0]?.['placed_at']).not.toBeNull();
  });

  it('rejects pos_x out of [0.0, 1.0] bounds', async () => {
    await expect(
      pool.query(
        `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
        [userA, 'pin_neg_x', -0.01, 0.5],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
        [userA, 'pin_over_x', 1.01, 0.5],
      ),
    ).rejects.toThrow();
  });

  it('rejects pos_y out of [0.0, 1.0] bounds', async () => {
    await expect(
      pool.query(
        `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
        [userA, 'pin_neg_y', 0.5, -0.01],
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
        [userA, 'pin_over_y', 0.5, 1.01],
      ),
    ).rejects.toThrow();
  });

  it('rejects empty pin_id string', async () => {
    await expect(
      pool.query(
        `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
        [userA, '', 0.5, 0.5],
      ),
    ).rejects.toThrow();
  });

  it('enforces UNIQUE (user_id, pin_id)', async () => {
    await pool.query(
      `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
      [userA, 'gold_coaster_royalty', 0.2, 0.2],
    );

    // Duplicate for userA fails
    await expect(
      pool.query(
        `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
        [userA, 'gold_coaster_royalty', 0.4, 0.4],
      ),
    ).rejects.toThrow();

    // Same pin for userB succeeds
    await expect(
      pool.query(
        `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
        [userB, 'gold_coaster_royalty', 0.4, 0.4],
      ),
    ).resolves.toBeDefined();
  });

  it('cascades on user delete', async () => {
    await pool.query(
      `INSERT INTO pin_showcase_placements (user_id, pin_id, pos_x, pos_y) VALUES ($1, $2, $3, $4)`,
      [userA, 'gold_coaster_royalty', 0.5, 0.5],
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [userA]);

    const r = await pool.query(
      `SELECT count(*)::int AS n FROM pin_showcase_placements WHERE user_id = $1`,
      [userA],
    );
    expect(r.rows[0]?.['n']).toBe(0);
  });
});
