/**
 * Migration test for `0042_trip_food_lists.sql` (Trip Food Lists).
 *
 * Validates: Requirements 22.1, 22.2, 22.5, 22.6
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

  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number =>
      typeof s === 'string' ? s.length : 0,
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
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

const FOOD_LISTS_STUB = `
  CREATE TABLE food_lists (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private'
  );
`;

const BASE_MIGRATIONS = ['0001_init.sql', '0015_trips.sql'];
const MIGRATION_0042 = '0042_trip_food_lists.sql';

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

async function seedUser(pool: Pool, id: string, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
    [id, email, 'argon2id$seeded'],
  );
}

async function seedTrip(pool: Pool, creatorId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO trips (creator_id, name, start_date, end_date)
     VALUES ($1, 'WDW Food Crawl', '2025-06-10', '2025-06-15')
     RETURNING id`,
    [creatorId],
  );
  return result.rows[0]!.id as string;
}

async function seedFoodList(pool: Pool, ownerId: string, name: string, visibility = 'private'): Promise<string> {
  const result = await pool.query(
    `INSERT INTO food_lists (owner_id, name, visibility)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [ownerId, name, visibility],
  );
  return result.rows[0]!.id as string;
}

describe('migration 0042_trip_food_lists (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    db.public.none(FOOD_LISTS_STUB);

    applyMigration(db, MIGRATION_0042);
  });

  it('creates the trip_food_lists table with trip_id / food_list_id / added_by / created_at columns', () => {
    expect(db.getTable('trip_food_lists')).toBeDefined();

    const columns = [...db.getTable('trip_food_lists').getColumns()].map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(['trip_id', 'food_list_id', 'added_by', 'created_at']),
    );
  });

  it('enforces the (trip_id, food_list_id) composite PRIMARY KEY (at most one link per pair)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user@example.com');
    const tripId = await seedTrip(pool, user);
    const listId = await seedFoodList(pool, user, 'Snacks to Try');

    await pool.query(
      `INSERT INTO trip_food_lists (trip_id, food_list_id, added_by) VALUES ($1, $2, $3)`,
      [tripId, listId, user],
    );

    // Collides on PK
    await expect(
      pool.query(
        `INSERT INTO trip_food_lists (trip_id, food_list_id, added_by) VALUES ($1, $2, $3)`,
        [tripId, listId, user],
      ),
    ).rejects.toThrow();
  });

  it('rejects a link to a non-existent Food_List (food_list_id FK)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user2@example.com');
    const tripId = await seedTrip(pool, user);

    await expect(
      pool.query(
        `INSERT INTO trip_food_lists (trip_id, food_list_id, added_by) VALUES ($1, $2, $3)`,
        [tripId, randomUUID(), user],
      ),
    ).rejects.toThrow();
  });

  it('cascades a Trip delete to its trip_food_lists rows (ON DELETE CASCADE)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user3@example.com');
    const tripId = await seedTrip(pool, user);
    const listA = await seedFoodList(pool, user, 'List A');
    const listB = await seedFoodList(pool, user, 'List B');

    await pool.query(
      `INSERT INTO trip_food_lists (trip_id, food_list_id, added_by) VALUES ($1, $2, $4), ($1, $3, $4)`,
      [tripId, listA, listB, user],
    );

    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_food_lists WHERE trip_id = $1`,
      [tripId],
    );
    expect(before.rows[0]!.n).toBe(2);

    await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);

    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_food_lists WHERE trip_id = $1`,
      [tripId],
    );
    expect(after.rows[0]!.n).toBe(0);

    // Food lists themselves survive
    const listsLeft = await pool.query(`SELECT COUNT(*)::int AS n FROM food_lists`);
    expect(listsLeft.rows[0]!.n).toBe(2);
  });

  it('cascades a Food_List delete to its trip_food_lists rows (ON DELETE CASCADE)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user4@example.com');
    const tripId = await seedTrip(pool, user);
    const listId = await seedFoodList(pool, user, 'Deleted List');

    await pool.query(
      `INSERT INTO trip_food_lists (trip_id, food_list_id, added_by) VALUES ($1, $2, $3)`,
      [tripId, listId, user],
    );

    await pool.query(`DELETE FROM food_lists WHERE id = $1`, [listId]);

    const links = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_food_lists WHERE food_list_id = $1`,
      [listId],
    );
    expect(links.rows[0]!.n).toBe(0);
  });
});
