/**
 * Integration / route tests for PUT /trips/:id/days/:date/park (task 25.6).
 *
 * Validates: Requirements 24.3, 24.4, 24.5, 24.6, 24.7
 *
 * Tests:
 *  - 401 with no session;
 *  - non-member and non-existent trip return the identical 403 trip_forbidden body;
 *  - a member succeeds (distinguishing it from PATCH /trips/:id, which gets 403);
 *  - an organizer succeeds;
 *  - {park:null} clears;
 *  - malformed date, out-of-range date, unknown park, missing park, and extra body key
 *    each return 400 trip_validation_failed with field set;
 *  - after a successful call trip_feed_items has no new row and day_touring_hours for
 *    other dates is unchanged.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';
import { tripRoutes } from '../routes.js';

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

describe('PUT /trips/:id/days/:date/park (task 25.6)', () => {
  let app: FastifyInstance;
  let pool: DbPool;
  let repo: TripRepo;
  let currentUserId: string | null = null;

  let organizerId: string;
  let memberId: string;
  let nonMemberId: string;
  let tripId: string;

  beforeEach(async () => {
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
      ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_state TEXT NOT NULL DEFAULT 'active';
      ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';
    `);
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0016_trip_resorts.sql');
    applyMigration(db, '0019_planned_item_scheduling.sql');
    applyMigration(db, '0022_planned_item_ride_options.sql');
    applyMigration(db, '0023_trip_touring_hours.sql');
    applyMigration(db, '0045_trip_walk_wait_weighting.sql');

    pool = withForUpdateCompat(rawPool);
    repo = createTripRepo(pool, NOOP_DEPS);

    organizerId = await seedUser(pool, 'Organizer User');
    memberId = await seedUser(pool, 'Member User');
    nonMemberId = await seedUser(pool, 'Non-Member User');

    // Create a trip with organizerId
    const createdTrip = await repo.createTrip(organizerId, {
      name: 'Halloween Trip',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
    });
    tripId = createdTrip.id;

    // Add memberId as member
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'member')`,
      [tripId, memberId],
    );

    // Setup Fastify with session pre-handler
    app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request) => {
      if (!currentUserId) {
        throw new AppError('unauthorized', 'Session required');
      }
      (request as unknown as { userId: string }).userId = currentUserId;
    };

    await app.register(
      tripRoutes({
        pool,
        repo,
        requireSession,
      }),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('401 with no session', async () => {
    currentUserId = null;
    const res = await app.inject({
      method: 'PUT',
      url: `/trips/${tripId}/days/2026-10-01/park`,
      payload: { park: 'EPCOT' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });

  it('non-member and non-existent trip return the identical 403 trip_forbidden body', async () => {
    currentUserId = nonMemberId;

    // Non-member on existing trip
    const nonMemberRes = await app.inject({
      method: 'PUT',
      url: `/trips/${tripId}/days/2026-10-01/park`,
      payload: { park: 'EPCOT' },
    });
    expect(nonMemberRes.statusCode).toBe(403);
    const nonMemberJson = nonMemberRes.json();
    expect(nonMemberJson.error.code).toBe('trip_forbidden');

    // Non-existent trip id
    const nonExistentId = randomUUID();
    const nonExistentRes = await app.inject({
      method: 'PUT',
      url: `/trips/${nonExistentId}/days/2026-10-01/park`,
      payload: { park: 'EPCOT' },
    });
    expect(nonExistentRes.statusCode).toBe(403);
    const nonExistentJson = nonExistentRes.json();
    expect(nonExistentJson.error.code).toBe('trip_forbidden');

    // Identical error body (anti-probing invariant R15.4)
    expect(nonMemberJson).toEqual(nonExistentJson);
  });

  it('a member succeeds (and distinguish from PATCH /trips/:id where member gets 403)', async () => {
    currentUserId = memberId;

    // First show PATCH /trips/:id gets 403 for member
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/trips/${tripId}`,
      payload: { name: 'New Name' },
    });
    expect(patchRes.statusCode).toBe(403);
    expect(patchRes.json().error.code).toBe('trip_forbidden');

    // PUT day park succeeds for member
    const res = await app.inject({
      method: 'PUT',
      url: `/trips/${tripId}/days/2026-10-01/park`,
      payload: { park: 'EPCOT' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(tripId);
    expect(body.dayTouringHours['2026-10-01'].startingPark).toBe('EPCOT');
  });

  it('an organizer succeeds', async () => {
    currentUserId = organizerId;
    const res = await app.inject({
      method: 'PUT',
      url: `/trips/${tripId}/days/2026-10-02/park`,
      payload: { park: 'Magic Kingdom' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dayTouringHours['2026-10-02'].startingPark).toBe('Magic Kingdom');
  });

  it('{park: null} clears', async () => {
    currentUserId = organizerId;

    // Set first
    await app.inject({
      method: 'PUT',
      url: `/trips/${tripId}/days/2026-10-01/park`,
      payload: { park: 'EPCOT' },
    });

    // Clear
    const clearRes = await app.inject({
      method: 'PUT',
      url: `/trips/${tripId}/days/2026-10-01/park`,
      payload: { park: null },
    });
    expect(clearRes.statusCode).toBe(200);
    const body = clearRes.json();
    expect(body.dayTouringHours?.['2026-10-01']).toBeUndefined();
  });

  describe('validation errors', () => {
    beforeEach(() => {
      currentUserId = memberId;
    });

    it('malformed date returns 400 trip_validation_failed with field "date"', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/trips/${tripId}/days/not-a-date/park`,
        payload: { park: 'EPCOT' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
      expect(res.json().error.field).toBe('date');
    });

    it('out-of-range date returns 400 trip_validation_failed with field "date"', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/trips/${tripId}/days/2026-09-30/park`,
        payload: { park: 'EPCOT' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
      expect(res.json().error.field).toBe('date');
    });

    it('unknown park returns 400 trip_validation_failed with field "park"', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/trips/${tripId}/days/2026-10-01/park`,
        payload: { park: 'Space Mountain' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
      expect(res.json().error.field).toBe('park');
    });

    it('missing park returns 400 trip_validation_failed with field "park"', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/trips/${tripId}/days/2026-10-01/park`,
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
      expect(res.json().error.field).toBe('park');
    });

    it('extra body key returns 400 trip_validation_failed with field naming the extra key', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/trips/${tripId}/days/2026-10-01/park`,
        payload: { park: 'EPCOT', extra: 1 },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('trip_validation_failed');
      expect(res.json().error.field).toBe('extra');
    });
  });

  it('after a successful call trip_feed_items has no new row and day_touring_hours for other dates is unchanged', async () => {
    currentUserId = memberId;

    // Seed another date in day_touring_hours
    const initialMap = {
      '2026-10-03': { startingPark: 'Animal Kingdom', startHour: 8 },
    };
    await pool.query(
      `UPDATE trips SET day_touring_hours = $1 WHERE id = $2`,
      [JSON.stringify(initialMap), tripId],
    );

    // Check baseline feed items count
    const initialFeed = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM trip_feed_items WHERE trip_id = $1`,
      [tripId],
    );
    const initialFeedCount = initialFeed.rows[0]!.count;

    // Make successful Day_Park PUT
    const res = await app.inject({
      method: 'PUT',
      url: `/trips/${tripId}/days/2026-10-01/park`,
      payload: { park: 'Hollywood Studios' },
    });
    expect(res.statusCode).toBe(200);

    // Verify trip_feed_items count is strictly unchanged
    const afterFeed = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM trip_feed_items WHERE trip_id = $1`,
      [tripId],
    );
    expect(afterFeed.rows[0]!.count).toBe(initialFeedCount);

    // Verify other date is unchanged in database
    const { rows } = await pool.query<{ day_touring_hours: string }>(
      `SELECT day_touring_hours FROM trips WHERE id = $1`,
      [tripId],
    );
    const parsed = typeof rows[0]!.day_touring_hours === 'string'
      ? JSON.parse(rows[0]!.day_touring_hours)
      : rows[0]!.day_touring_hours;

    expect(parsed['2026-10-03']).toEqual(initialMap['2026-10-03']);
    expect(parsed['2026-10-01']).toEqual({ startingPark: 'Hollywood Studios' });
  });
});
