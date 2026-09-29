/**
 * Migration test for `0051_trip_experience_lists.sql` (Trip Experience Lists).
 *
 * Structurally identical to trip_food_lists (0042_trip_food_lists.sql), but reuses the
 * REAL `0050_experience_lists.sql` migration instead of an inline stub, since that
 * migration already exists and applies cleanly in pg-mem (see migration0050.test.ts).
 *
 * Validates: Requirements 14.6, 14.7
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
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const BASE_MIGRATIONS = ['0001_init.sql', '0015_trips.sql', '0050_experience_lists.sql'];
const MIGRATION_0051 = '0051_trip_experience_lists.sql';

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
     VALUES ($1, 'WDW Experience Crawl', '2025-06-10', '2025-06-15')
     RETURNING id`,
    [creatorId],
  );
  return result.rows[0]!.id as string;
}

async function seedExperienceList(pool: Pool, ownerId: string, name: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO experience_lists (owner_id, name)
     VALUES ($1, $2)
     RETURNING id`,
    [ownerId, name],
  );
  return result.rows[0]!.id as string;
}

describe('migration 0051_trip_experience_lists (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }

    applyMigration(db, MIGRATION_0051);
  });

  it('creates the trip_experience_lists table with trip_id / experience_list_id / added_by / added_at columns', () => {
    expect(db.getTable('trip_experience_lists')).toBeDefined();

    const columns = [...db.getTable('trip_experience_lists').getColumns()].map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(['trip_id', 'experience_list_id', 'added_by', 'added_at']),
    );
  });

  it('enforces the (trip_id, experience_list_id) composite PRIMARY KEY (at most one link per pair)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user@example.com');
    const tripId = await seedTrip(pool, user);
    const listId = await seedExperienceList(pool, user, 'Must-Do Rides');

    await pool.query(
      `INSERT INTO trip_experience_lists (trip_id, experience_list_id, added_by) VALUES ($1, $2, $3)`,
      [tripId, listId, user],
    );

    // Collides on PK
    await expect(
      pool.query(
        `INSERT INTO trip_experience_lists (trip_id, experience_list_id, added_by) VALUES ($1, $2, $3)`,
        [tripId, listId, user],
      ),
    ).rejects.toThrow();
  });

  it('rejects a link to a non-existent Experience_List (experience_list_id FK)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user2@example.com');
    const tripId = await seedTrip(pool, user);

    await expect(
      pool.query(
        `INSERT INTO trip_experience_lists (trip_id, experience_list_id, added_by) VALUES ($1, $2, $3)`,
        [tripId, randomUUID(), user],
      ),
    ).rejects.toThrow();
  });

  it('cascades a Trip delete to its trip_experience_lists rows (ON DELETE CASCADE)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user3@example.com');
    const tripId = await seedTrip(pool, user);
    const listA = await seedExperienceList(pool, user, 'List A');
    const listB = await seedExperienceList(pool, user, 'List B');

    await pool.query(
      `INSERT INTO trip_experience_lists (trip_id, experience_list_id, added_by) VALUES ($1, $2, $4), ($1, $3, $4)`,
      [tripId, listA, listB, user],
    );

    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_experience_lists WHERE trip_id = $1`,
      [tripId],
    );
    expect(before.rows[0]!.n).toBe(2);

    await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);

    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_experience_lists WHERE trip_id = $1`,
      [tripId],
    );
    expect(after.rows[0]!.n).toBe(0);

    // Experience lists themselves survive
    const listsLeft = await pool.query(`SELECT COUNT(*)::int AS n FROM experience_lists`);
    expect(listsLeft.rows[0]!.n).toBe(2);
  });

  it('cascades an Experience_List delete to its trip_experience_lists rows (ON DELETE CASCADE)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'user4@example.com');
    const tripId = await seedTrip(pool, user);
    const listId = await seedExperienceList(pool, user, 'Deleted List');

    await pool.query(
      `INSERT INTO trip_experience_lists (trip_id, experience_list_id, added_by) VALUES ($1, $2, $3)`,
      [tripId, listId, user],
    );

    await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [listId]);

    const links = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_experience_lists WHERE experience_list_id = $1`,
      [listId],
    );
    expect(links.rows[0]!.n).toBe(0);
  });
});
