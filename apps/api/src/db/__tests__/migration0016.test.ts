/**
 * Migration test for `0016_trip_resorts.sql` (Trip Resorts).
 *
 * Applies the FK targets 0016 references to a fresh pg-mem database — the base
 * schema `0001_init.sql` (which creates `users` and `experiences`), a minimal
 * `resorts` FK-target stub standing in for the heavier `0004_disney_sources.sql`
 * (0016 only needs `resorts(id)` to reference, mirroring the focused-chain
 * rationale of `migration0009.test.ts` / `migration0011.test.ts`), and
 * `0015_trips.sql` (which creates `trips`) — then applies 0016 on top and
 * asserts the migration's strictly additive contract holds:
 *
 *   - the new `trip_resorts` join table is created with its
 *     `trip_id` / `resort_id` / `created_at` columns;
 *   - the composite PRIMARY KEY `(trip_id, resort_id)` guarantees at most one
 *     link per (trip, resort) — a duplicate insert collides (R21.2);
 *   - the `resort_id` foreign key rejects a link to a non-existent Resort
 *     (referential integrity, R21.1);
 *   - deleting a Trip cascades to its `trip_resorts` rows via the
 *     `ON DELETE CASCADE` on the trip FK (R21.3).
 *
 * The guards are exercised behaviorally at the storage layer rather than merely
 * inferred from the DDL text. Mirrors the pg-mem setup of the sibling migration
 * tests (extensions/functions registered, GIN trigram indexes stripped).
 *
 * Validates: Requirements 21.1, 21.2, 21.3
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors migration0011.test.ts)
// ---------------------------------------------------------------------------

/** Build a fresh pg-mem db with the schema's extensions/functions registered. */
function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();

  db.registerExtension('citext', () => {
    // citext is supported natively by pg-mem.
  });
  db.registerExtension('pg_trgm', () => {
    // pg_trgm is only consulted by the GIN trigram indexes we strip below.
  });
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

/** Absolute path to a migration file relative to this test. */
function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → db → src → apps/api
  return resolve(here, '..', '..', '..', 'migrations', name);
}

/** Apply a migration file, stripping GIN trigram indexes pg-mem can't model. */
function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/**
 * Minimal `resorts` FK-target stub standing in for `0004_disney_sources.sql`.
 * 0016's only dependency on the Resort catalog is `resorts(id)` as its
 * `resort_id` FK target, so the heavier real migration (extensions, JSONB
 * columns, menu/bridge tables) is not needed to exercise 0016's own DDL —
 * exactly the focused-chain rationale of the 0009 / 0011 migration tests.
 */
const RESORTS_STUB = `
  CREATE TABLE resorts (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

/**
 * The migrations applied before 0016: 0001_init.sql creates `users` and
 * `experiences`; the inline stub creates the `resorts` FK target; 0015_trips.sql
 * creates `trips` (the second FK target). Every other migration is additive to
 * unrelated tables and is omitted to keep the schema focused on what 0016
 * touches (see the 0009 test for the same rationale).
 */
const BASE_MIGRATIONS = ['0001_init.sql'];

const MIGRATION_0015 = '0015_trips.sql';
const MIGRATION_0016 = '0016_trip_resorts.sql';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

/** Insert one User row (FK target for trips.creator_id). */
async function seedUser(pool: Pool, id: string, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
    [id, email, 'argon2id$seeded'],
  );
}

/** Insert one Resort row (FK target for trip_resorts.resort_id). */
async function seedResort(pool: Pool, id: string, name: string): Promise<void> {
  await pool.query(`INSERT INTO resorts (id, name) VALUES ($1, $2)`, [id, name]);
}

/** Insert one Trip row and return its id (FK target for trip_resorts.trip_id). */
async function seedTrip(pool: Pool, creatorId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO trips (creator_id, name, start_date, end_date)
     VALUES ($1, 'WDW 2025', '2025-06-10', '2025-06-15')
     RETURNING id`,
    [creatorId],
  );
  return result.rows[0]!.id as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migration 0016_trip_resorts (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    db.public.none(RESORTS_STUB);
    applyMigration(db, MIGRATION_0015);

    // Apply the migration under test on top.
    applyMigration(db, MIGRATION_0016);
  });

  it('creates the trip_resorts table with its trip_id / resort_id / created_at columns', () => {
    expect(db.getTable('trip_resorts')).toBeDefined();

    const columns = [...db.getTable('trip_resorts').getColumns()].map((c) => c.name);
    expect(columns).toEqual(
      expect.arrayContaining(['trip_id', 'resort_id', 'created_at']),
    );
  });

  it('enforces the (trip_id, resort_id) composite PRIMARY KEY (at most one link per pair)', async () => {
    const user = randomUUID();
    const resort = randomUUID();
    await seedUser(pool, user, 'creator@example.com');
    await seedResort(pool, resort, 'Grand Floridian');
    const tripId = await seedTrip(pool, user);

    // First link for (trip, resort) is accepted.
    await pool.query(
      `INSERT INTO trip_resorts (trip_id, resort_id) VALUES ($1, $2)`,
      [tripId, resort],
    );

    // A second link for the SAME (trip, resort) must collide on the PK.
    await expect(
      pool.query(
        `INSERT INTO trip_resorts (trip_id, resort_id) VALUES ($1, $2)`,
        [tripId, resort],
      ),
    ).rejects.toThrow();
  });

  it('rejects a link to a non-existent Resort (resort_id foreign key)', async () => {
    const user = randomUUID();
    await seedUser(pool, user, 'creator2@example.com');
    const tripId = await seedTrip(pool, user);

    await expect(
      pool.query(
        `INSERT INTO trip_resorts (trip_id, resort_id) VALUES ($1, $2)`,
        [tripId, randomUUID()],
      ),
    ).rejects.toThrow();
  });

  it('cascades a Trip delete to its trip_resorts rows (ON DELETE CASCADE)', async () => {
    const user = randomUUID();
    const resortA = randomUUID();
    const resortB = randomUUID();
    await seedUser(pool, user, 'creator3@example.com');
    await seedResort(pool, resortA, 'Polynesian Village');
    await seedResort(pool, resortB, 'Contemporary');
    const tripId = await seedTrip(pool, user);

    await pool.query(
      `INSERT INTO trip_resorts (trip_id, resort_id) VALUES ($1, $2), ($1, $3)`,
      [tripId, resortA, resortB],
    );

    const before = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_resorts WHERE trip_id = $1`,
      [tripId],
    );
    expect(before.rows[0]!.n).toBe(2);

    // Deleting the Trip fans out to its resort links.
    await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);

    const after = await pool.query(
      `SELECT COUNT(*)::int AS n FROM trip_resorts WHERE trip_id = $1`,
      [tripId],
    );
    expect(after.rows[0]!.n).toBe(0);

    // The referenced Resorts themselves are untouched by the Trip delete.
    const resortsLeft = await pool.query(`SELECT COUNT(*)::int AS n FROM resorts`);
    expect(resortsLeft.rows[0]!.n).toBe(2);
  });
});
