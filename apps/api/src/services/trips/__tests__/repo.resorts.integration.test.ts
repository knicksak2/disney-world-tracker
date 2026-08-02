/**
 * Integration tests for the Trip → Resort stay association (R21.1).
 *
 * Exercises the REAL `createTripRepo` lifecycle operations — `createTrip`,
 * `editTrip`, `getTripForMember`, `listMyTrips` — against an in-memory Postgres
 * (`pg-mem`, the same engine the other Trip integration tests use). The full
 * production DDL for the FK targets is applied: `0001_init.sql` (users,
 * experiences), a minimal `resorts` FK-target stub (the only Resort dependency
 * 0016 has, mirroring `migration0016.test.ts`), `0015_trips.sql` (trips), and
 * `0016_trip_resorts.sql` (the join table under test).
 *
 * The Resort operations never touch the canonical Tracking repos, so empty
 * stand-ins satisfy the `createTripRepo` dependency shape.
 *
 * Validates: Requirements 21.1, 21.2, 21.4
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup
// ---------------------------------------------------------------------------

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
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
  });
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → trips → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/** Minimal `resorts` FK-target stub (see migration0016.test.ts for rationale). */
const RESORTS_STUB = `
  CREATE TABLE resorts (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

/**
 * pg-mem does not model row-level `FOR UPDATE`; `editTrip` appends it purely for
 * concurrency safety. Strip it on every query so the statements run.
 */
function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query: (text: string, params?: unknown[]) => Promise<unknown>;
    connect: () => Promise<{
      query: (text: string, params?: unknown[]) => Promise<unknown>;
      release: () => void;
    }>;
  };
  const strip = (text: string): string =>
    text.replace(/\bFOR UPDATE(?:\s+OF\s+\w+)?/gi, '');
  return {
    query: (text: string, params?: unknown[]) => raw.query(strip(text), params),
    async connect() {
      const client = await raw.connect();
      return {
        query: (text: string, params?: unknown[]) =>
          client.query(strip(text), params),
        release: () => client.release(),
      };
    },
  } as unknown as DbPool;
}

/** Resort operations never reach the canonical repos; empty stand-ins suffice. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedUser(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
    [id, `${id}@example.com`, 'argon2id$seeded'],
  );
  await pool.query(
    `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
    [id, name],
  );
  return id;
}

async function seedResort(
  pool: DbPool,
  name: string,
  active = true,
): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO resorts (id, name, active) VALUES ($1, $2, $3)`, [
    id,
    name,
    active,
  ]);
  return id;
}

const VALID_TRIP = {
  name: 'WDW 2025',
  description: '',
  startDate: '2025-06-10',
  endDate: '2025-06-15',
} as const;

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface Fixture {
  pool: DbPool;
  repo: TripRepo;
}

function makeFixture(): Fixture {
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const rawPool = new PgMemPool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  db.public.none(RESORTS_STUB);
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0016_trip_resorts.sql');

  const pool = withForUpdateCompat(rawPool);
  const repo = createTripRepo(pool, NOOP_DEPS);
  return { pool, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Trip Resort stay (integration, pg-mem)', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  it('create with no resortIds yields an empty resorts array (R21.1)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    expect(trip.resorts).toEqual([]);
  });

  it('create records the supplied Resort stay, ordered by name (R21.1)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const poly = await seedResort(fx.pool, 'Polynesian Village');
    const contemporary = await seedResort(fx.pool, 'Contemporary');

    const trip = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      resortIds: [poly, contemporary],
    });

    // Ordered by name: Contemporary before Polynesian Village.
    expect(trip.resorts).toEqual([
      { id: contemporary, name: 'Contemporary' },
      { id: poly, name: 'Polynesian Village' },
    ]);

    // A subsequent read observes the same stay.
    const reread = await fx.repo.getTripForMember(trip.id);
    expect(reread?.resorts).toEqual(trip.resorts);
  });

  it('collapses duplicate resort ids in the request (R21.2)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const resort = await seedResort(fx.pool, 'Grand Floridian');

    const trip = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      resortIds: [resort, resort, resort],
    });

    expect(trip.resorts).toEqual([{ id: resort, name: 'Grand Floridian' }]);
  });

  it('rejects an unknown Resort id and persists no Trip stay (R21.4)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const known = await seedResort(fx.pool, 'Wilderness Lodge');

    await expect(
      fx.repo.createTrip(user, {
        ...VALID_TRIP,
        resortIds: [known, randomUUID()],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a soft-deleted (inactive) Resort id (R21.4)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const inactive = await seedResort(fx.pool, 'Old Resort', false);

    await expect(
      fx.repo.createTrip(user, { ...VALID_TRIP, resortIds: [inactive] }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('edit replaces the recorded stay wholesale (R21.1)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const a = await seedResort(fx.pool, 'Resort A');
    const b = await seedResort(fx.pool, 'Resort B');
    const c = await seedResort(fx.pool, 'Resort C');

    const trip = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      resortIds: [a],
    });
    expect(trip.resorts.map((r) => r.id)).toEqual([a]);

    const edited = await fx.repo.editTrip(trip.id, { resortIds: [b, c] });
    expect(edited?.resorts.map((r) => r.id)).toEqual([b, c]);
  });

  it('edit with an empty resortIds clears the stay (R21.1)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const a = await seedResort(fx.pool, 'Resort A');

    const trip = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      resortIds: [a],
    });
    expect(trip.resorts).toHaveLength(1);

    const edited = await fx.repo.editTrip(trip.id, { resortIds: [] });
    expect(edited?.resorts).toEqual([]);
  });

  it('edit that omits resortIds leaves the recorded stay untouched (R21.1)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const a = await seedResort(fx.pool, 'Resort A');

    const trip = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      resortIds: [a],
    });

    const edited = await fx.repo.editTrip(trip.id, { name: 'Renamed Trip' });
    expect(edited?.name).toBe('Renamed Trip');
    expect(edited?.resorts).toEqual([{ id: a, name: 'Resort A' }]);
  });

  it('edit rejecting an unknown Resort leaves the prior stay intact (R21.4)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const a = await seedResort(fx.pool, 'Resort A');

    const trip = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      resortIds: [a],
    });

    await expect(
      fx.repo.editTrip(trip.id, { resortIds: [randomUUID()] }),
    ).rejects.toBeInstanceOf(AppError);

    // The failed edit rolled back — the original stay survives.
    const reread = await fx.repo.getTripForMember(trip.id);
    expect(reread?.resorts).toEqual([{ id: a, name: 'Resort A' }]);
  });

  it('listMyTrips carries each Trip its recorded stay (R21.1)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const a = await seedResort(fx.pool, 'Resort A');
    const b = await seedResort(fx.pool, 'Resort B');

    const trip1 = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      name: 'Trip One',
      resortIds: [a, b],
    });
    const trip2 = await fx.repo.createTrip(user, {
      ...VALID_TRIP,
      name: 'Trip Two',
    });

    const groups = await fx.repo.listMyTrips(user);
    const all = groups.flatMap((g) => g.trips);
    const byId = new Map(all.map((t) => [t.id, t]));

    expect(byId.get(trip1.id)?.resorts.map((r) => r.id).sort()).toEqual(
      [a, b].sort(),
    );
    expect(byId.get(trip2.id)?.resorts).toEqual([]);
  });
});
