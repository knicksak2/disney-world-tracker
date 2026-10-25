/**
 * Integration tests for `setDayPark` (repo method, task 25.5) using pg-mem.
 *
 * Validates: Requirements 24.1, 24.2, 24.3, 24.4, 24.6
 *
 * Asserts real SQL execution and row state:
 *  - set on a trip with other dates and other per-date fields preserves them all;
 *  - clear removes only `startingPark`;
 *  - clear of the only field removes the date key;
 *  - first write on a trip whose `day_touring_hours` is NULL/{} works;
 *  - out-of-range date (before start, after end) rejects and leaves the stored value unchanged;
 *  - `updated_at` advances.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DayTouringHoursDTO, TripDTO } from '@dwt/shared';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

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

interface Fixture {
  pool: DbPool;
  repo: TripRepo;
  userId: string;
}

function makeFixture(): Fixture {
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const rawPool = new PgMemPool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  db.public.none(`
    CREATE TABLE resorts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';
  `);
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0016_trip_resorts.sql');
  applyMigration(db, '0019_planned_item_scheduling.sql');
  applyMigration(db, '0022_planned_item_ride_options.sql');
  applyMigration(db, '0023_trip_touring_hours.sql');
  applyMigration(db, '0045_trip_walk_wait_weighting.sql');

  const pool = withForUpdateCompat(rawPool);
  const repo = createTripRepo(pool, NOOP_DEPS);
  return { pool, repo, userId: '' };
}

describe('repo.setDayPark (integration, pg-mem)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = makeFixture();
    fx.userId = await seedUser(fx.pool, 'Test Member');
  });

  async function createTestTrip(startDate = '2026-10-01', endDate = '2026-10-05'): Promise<TripDTO> {
    return fx.repo.createTrip(fx.userId, {
      name: 'October Trip',
      startDate,
      endDate,
    });
  }

  it('preserves other dates and other fields on set', async () => {
    const trip = await createTestTrip();

    // Seed existing day_touring_hours with multiple dates and properties
    const initialMap: Record<string, DayTouringHoursDTO> = {
      '2026-10-01': { startHour: 8, endHour: 22, startMode: 'park_open' },
      '2026-10-02': { startHour: 9, startMinutes: 540, startingPark: 'EPCOT' },
      '2026-10-03': { startHour: 8, startingPark: 'Magic Kingdom' },
    };
    await fx.pool.query(
      `UPDATE trips SET day_touring_hours = $1 WHERE id = $2`,
      [JSON.stringify(initialMap), trip.id],
    );

    const updatedTrip = await fx.repo.setDayPark(
      trip.id,
      '2026-10-01',
      'Hollywood Studios',
    );

    // Returned DTO assertions
    expect(updatedTrip.dayTouringHours?.['2026-10-01']).toEqual({
      startHour: 8,
      endHour: 22,
      startMode: 'park_open',
      startingPark: 'Hollywood Studios',
    });
    expect(updatedTrip.dayTouringHours?.['2026-10-02']).toEqual(initialMap['2026-10-02']);
    expect(updatedTrip.dayTouringHours?.['2026-10-03']).toEqual(initialMap['2026-10-03']);

    // Direct database row assertions
    const { rows } = await fx.pool.query<{ day_touring_hours: string }>(
      `SELECT day_touring_hours FROM trips WHERE id = $1`,
      [trip.id],
    );
    const parsed = typeof rows[0]!.day_touring_hours === 'string'
      ? JSON.parse(rows[0]!.day_touring_hours)
      : rows[0]!.day_touring_hours;

    expect(parsed['2026-10-01']).toEqual({
      startHour: 8,
      endHour: 22,
      startMode: 'park_open',
      startingPark: 'Hollywood Studios',
    });
    expect(parsed['2026-10-02']).toEqual(initialMap['2026-10-02']);
    expect(parsed['2026-10-03']).toEqual(initialMap['2026-10-03']);
  });

  it('clear removes only startingPark while preserving other fields for that date', async () => {
    const trip = await createTestTrip();

    const initialMap: Record<string, DayTouringHoursDTO> = {
      '2026-10-01': { startHour: 8, endHour: 22, startingPark: 'Magic Kingdom' },
      '2026-10-02': { startHour: 9, startingPark: 'EPCOT' },
    };
    await fx.pool.query(
      `UPDATE trips SET day_touring_hours = $1 WHERE id = $2`,
      [JSON.stringify(initialMap), trip.id],
    );

    const updatedTrip = await fx.repo.setDayPark(trip.id, '2026-10-01', null);

    expect(updatedTrip.dayTouringHours?.['2026-10-01']).toEqual({
      startHour: 8,
      endHour: 22,
    });
    expect(updatedTrip.dayTouringHours?.['2026-10-01']?.startingPark).toBeUndefined();
    expect(updatedTrip.dayTouringHours?.['2026-10-02']).toEqual(initialMap['2026-10-02']);

    const { rows } = await fx.pool.query<{ day_touring_hours: string }>(
      `SELECT day_touring_hours FROM trips WHERE id = $1`,
      [trip.id],
    );
    const parsed = typeof rows[0]!.day_touring_hours === 'string'
      ? JSON.parse(rows[0]!.day_touring_hours)
      : rows[0]!.day_touring_hours;

    expect(parsed['2026-10-01']).toEqual({
      startHour: 8,
      endHour: 22,
    });
    expect(parsed['2026-10-02']).toEqual(initialMap['2026-10-02']);
  });

  it('clear of the only field removes the date key', async () => {
    const trip = await createTestTrip();

    await fx.repo.setDayPark(trip.id, '2026-10-04', 'Animal Kingdom');
    const clearedTrip = await fx.repo.setDayPark(trip.id, '2026-10-04', null);

    expect(clearedTrip.dayTouringHours?.['2026-10-04']).toBeUndefined();

    const { rows } = await fx.pool.query<{ day_touring_hours: string }>(
      `SELECT day_touring_hours FROM trips WHERE id = $1`,
      [trip.id],
    );
    const parsed = typeof rows[0]!.day_touring_hours === 'string'
      ? JSON.parse(rows[0]!.day_touring_hours)
      : rows[0]!.day_touring_hours;

    expect(parsed['2026-10-04']).toBeUndefined();
  });

  it('first write on a trip whose day_touring_hours is {} works', async () => {
    const trip = await createTestTrip();

    // Confirm initial state is {}
    const initialQuery = await fx.pool.query<{ day_touring_hours: unknown }>(
      `SELECT day_touring_hours FROM trips WHERE id = $1`,
      [trip.id],
    );
    const initialHours = typeof initialQuery.rows[0]!.day_touring_hours === 'string'
      ? JSON.parse(initialQuery.rows[0]!.day_touring_hours)
      : initialQuery.rows[0]!.day_touring_hours;
    expect(initialHours).toEqual({});

    const updatedTrip = await fx.repo.setDayPark(trip.id, '2026-10-02', 'Magic Kingdom');
    expect(updatedTrip.dayTouringHours?.['2026-10-02']).toEqual({
      startingPark: 'Magic Kingdom',
    });

    const { rows } = await fx.pool.query<{ day_touring_hours: string }>(
      `SELECT day_touring_hours FROM trips WHERE id = $1`,
      [trip.id],
    );
    const parsed = typeof rows[0]!.day_touring_hours === 'string'
      ? JSON.parse(rows[0]!.day_touring_hours)
      : rows[0]!.day_touring_hours;
    expect(parsed).toEqual({
      '2026-10-02': { startingPark: 'Magic Kingdom' },
    });
  });

  it('out-of-range date (before start, after end) rejects and leaves stored value unchanged', async () => {
    const trip = await createTestTrip('2026-10-01', '2026-10-05');

    const initialMap = {
      '2026-10-02': { startingPark: 'EPCOT' },
    };
    await fx.pool.query(
      `UPDATE trips SET day_touring_hours = $1 WHERE id = $2`,
      [JSON.stringify(initialMap), trip.id],
    );

    // Before startDate
    await expect(
      fx.repo.setDayPark(trip.id, '2026-09-30', 'Magic Kingdom'),
    ).rejects.toThrow(AppError);

    try {
      await fx.repo.setDayPark(trip.id, '2026-09-30', 'Magic Kingdom');
    } catch (e: any) {
      expect(e.code).toBe('trip_validation_failed');
      expect(e.field).toBe('date');
    }

    // After endDate
    await expect(
      fx.repo.setDayPark(trip.id, '2026-10-06', 'Magic Kingdom'),
    ).rejects.toThrow(AppError);

    try {
      await fx.repo.setDayPark(trip.id, '2026-10-06', 'Magic Kingdom');
    } catch (e: any) {
      expect(e.code).toBe('trip_validation_failed');
      expect(e.field).toBe('date');
    }

    // Stored value remains completely unchanged
    const { rows } = await fx.pool.query<{ day_touring_hours: string }>(
      `SELECT day_touring_hours FROM trips WHERE id = $1`,
      [trip.id],
    );
    const parsed = typeof rows[0]!.day_touring_hours === 'string'
      ? JSON.parse(rows[0]!.day_touring_hours)
      : rows[0]!.day_touring_hours;
    expect(parsed).toEqual(initialMap);
  });

  it('advances updated_at timestamp on successful update', async () => {
    const trip = await createTestTrip();

    // Force an older updated_at
    const pastTime = new Date('2024-01-01T00:00:00Z');
    await fx.pool.query(
      `UPDATE trips SET updated_at = $1 WHERE id = $2`,
      [pastTime, trip.id],
    );

    await fx.repo.setDayPark(trip.id, '2026-10-02', 'EPCOT');

    const { rows } = await fx.pool.query<{ updated_at: Date }>(
      `SELECT updated_at FROM trips WHERE id = $1`,
      [trip.id],
    );
    const newUpdatedAt = new Date(rows[0]!.updated_at).getTime();
    expect(newUpdatedAt).toBeGreaterThan(pastTime.getTime());
  });

  it('throws trip_not_found for non-existent trip', async () => {
    const nonExistentId = randomUUID();
    await expect(
      fx.repo.setDayPark(nonExistentId, '2026-10-01', 'Magic Kingdom'),
    ).rejects.toMatchObject({
      code: 'trip_not_found',
    });
  });
});
