/**
 * Integration test for the `catalogDurationMinutes` read-projection on the
 * REAL `createTripRepo`, against an in-memory Postgres (`pg-mem`). Exercises
 * the real SQL join (`e.duration_minutes AS catalog_duration_minutes`) added
 * to `listPlannedItems`, not a mocked repo — a bug here (a dropped join
 * column, a wrong table alias) would surface only against the real query.
 *
 * Guards Correctness Property 23 and Requirement 11.6.
 *
 * Validates: Requirements 11.6
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
// pg-mem setup (mirrors repo.optimizationResult.integration.test.ts)
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

/** Seed an Experience, optionally with a curated `duration_minutes`. */
async function seedExperience(
  pool: DbPool,
  name: string,
  durationMinutes: number | null = null,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, duration_minutes)
     VALUES ($1, $2, $3, 'Animal Kingdom', 'Ride', $4)`,
    [id, `up-${id}`, name, durationMinutes],
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
  db.public.none("ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';");
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0019_planned_item_scheduling.sql');
  applyMigration(db, '0022_planned_item_ride_options.sql');
  applyMigration(db, '0023_trip_touring_hours.sql');
  applyMigration(db, '0024_planned_item_optimization_result.sql');
  applyMigration(db, '0027_planned_items_soft_windows.sql');
  applyMigration(db, '0028_planned_items_meal_period_snack.sql');
  applyMigration(db, '0031_planned_item_reservations.sql');
  applyMigration(db, '0045_trip_walk_wait_weighting.sql');

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

describe('catalogDurationMinutes read projection (integration, pg-mem)', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  it('projects the linked Experience\'s curated duration_minutes via listPlannedItems (R11.6)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Avatar Flight of Passage', 12);
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
    });

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read).toBeDefined();
    expect(read!.catalogDurationMinutes).toBe(12);
  });

  it('returns null when the linked Experience has no curated duration (R11.6)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Some Uncurated Ride', null);
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
    });

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read!.catalogDurationMinutes).toBeNull();
  });

  it('returns null for a break item with no linked Experience (R11.6)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    await fx.repo.addPlannedItem(trip.id, user, {
      itemType: 'break',
      customTitle: 'Lunch break',
      plannedDate: '2026-10-01',
    });

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read!.catalogDurationMinutes).toBeNull();
  });

  it('leaves the user\'s own durationMinutes override independent of catalogDurationMinutes (R11.6)', async () => {
    const user = await seedUser(fx.pool, 'Organizer');
    const expId = await seedExperience(fx.pool, 'Kilimanjaro Safaris', 20);
    const trip = await fx.repo.createTrip(user, { ...VALID_TRIP });
    const item = await fx.repo.addPlannedItem(trip.id, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      durationMinutes: 45,
    });
    expect(item.durationMinutes).toBe(45);
    expect(item.catalogDurationMinutes).toBe(20);

    const [read] = await fx.repo.listPlannedItems(trip.id);
    expect(read!.durationMinutes).toBe(45);
    expect(read!.catalogDurationMinutes).toBe(20);
  });
});
