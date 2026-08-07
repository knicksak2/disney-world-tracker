/**
 * Integration tests for persisting, reading back, and clearing a Planned_Item's
 * optimization result on the REAL `createTripRepo`, against an in-memory
 * Postgres (`pg-mem`). Exercises the real SQL in `updatePlannedItemTimes`
 * (write), `listPlannedItems` (read projection), and `editPlannedItem` (clear).
 *
 * Guards Correctness Property 8 and Requirement 8.1/8.2/8.4 — a bug here (a
 * column dropped from the UPDATE, a missing projection column, or a failure to
 * clear on edit) would surface only against the real query, so a mocked-repo
 * test would not cover it.
 *
 * Validates: Requirements 8.1, 8.2, 8.4
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors repo.resorts.integration.test.ts)
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
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

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

const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

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

async function seedExperience(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride')`,
    [id, `up-${id}`, name],
  );
  return id;
}

interface Fixture {
  pool: DbPool;
  repo: TripRepo;
}

function makeFixture(): Fixture {
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const rawPool = new PgMemPool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0019_planned_item_scheduling.sql');
  applyMigration(db, '0022_planned_item_ride_options.sql');
  applyMigration(db, '0023_trip_touring_hours.sql');
  applyMigration(db, '0024_planned_item_optimization_result.sql');

  const pool = withForUpdateCompat(rawPool);
  const repo = createTripRepo(pool, NOOP_DEPS);
  return { pool, repo };
}

const VALID_TRIP = {
  name: 'WDW 2026',
  description: '',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Planned_Item optimization result (integration, pg-mem)', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  it('persists the optimizer result and reads it back via listPlannedItems (R8.1, R8.2, Property 8)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Space Mountain');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
    });

    // Freshly added → not optimized yet.
    expect(item.predictedWaitMinutes).toBeNull();
    expect(item.travelFromPrev).toBeNull();
    expect(item.optimizedAt).toBeNull();

    await fx.repo.updatePlannedItemTimes(trip.id, [
      {
        itemId: item.id,
        plannedTime: '2026-10-01T14:00:00.000Z',
        predictedWaitMinutes: 42,
        travelFromPrev: { kind: 'walk', minutes: 7 },
      },
    ]);

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read).toBeDefined();
    expect(read!.predictedWaitMinutes).toBe(42);
    expect(read!.travelFromPrev).toEqual({ kind: 'walk', minutes: 7 });
    expect(read!.optimizedAt).not.toBeNull();
    // planned_time still round-trips as before.
    expect(read!.plannedTime).not.toBeNull();
  });

  it('stores a null travel leg for the first item (no travelFromPrev) (Property 8)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Pirates');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
    });

    await fx.repo.updatePlannedItemTimes(trip.id, [
      { itemId: item.id, plannedTime: '2026-10-01T09:00:00.000Z', predictedWaitMinutes: 15 },
    ]);

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read!.predictedWaitMinutes).toBe(15);
    expect(read!.travelFromPrev).toBeNull();
    expect(read!.optimizedAt).not.toBeNull();
  });

  it('clears the persisted optimization result when the item is edited (R8.4)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Big Thunder');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
    });

    await fx.repo.updatePlannedItemTimes(trip.id, [
      {
        itemId: item.id,
        plannedTime: '2026-10-01T14:00:00.000Z',
        predictedWaitMinutes: 42,
        travelFromPrev: { kind: 'park_hop', minutes: 45 },
      },
    ]);

    // Sanity: it is set before the edit.
    const [before] = await fx.repo.listPlannedItems(trip.id);
    expect(before!.optimizedAt).not.toBeNull();

    // A manual edit invalidates the cached optimization result.
    const edited = await fx.repo.editPlannedItem(trip.id, item.id, { priority: 1 });
    expect(edited.priority).toBe(1);
    expect(edited.predictedWaitMinutes).toBeNull();
    expect(edited.travelFromPrev).toBeNull();
    expect(edited.optimizedAt).toBeNull();

    // And the cleared state is persisted, not just in the returned DTO.
    const [after] = await fx.repo.listPlannedItems(trip.id);
    expect(after!.predictedWaitMinutes).toBeNull();
    expect(after!.travelFromPrev).toBeNull();
    expect(after!.optimizedAt).toBeNull();
  });

  it('rejects an invalid travel_from_prev_kind via the CHECK constraint', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Haunted Mansion');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
    });

    await expect(
      fx.pool.query(
        `UPDATE planned_items SET travel_from_prev_kind = $1 WHERE id = $2`,
        ['bogus', item.id],
      ),
    ).rejects.toThrow();
  });
});
