// Feature: unified-dining-logging, Property 1, Property 2, Property 3
//
// Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9
//
// Property 1: First Dish Log on a Date Ensures Exactly One Restaurant Visit
// Property 2: Dish Ratings Never Pollute Restaurant Ratings
// Property 3: Trip-Linked Dish Log Produces Full Trip Footprint on First Visit Only

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createCompletionRepo } from '../../tracking/completion/repo.js';
import { createExperienceLogRepo } from '../../tracking/logs/repo.js';
import type { TripLogPort } from '../../tracking/logs/tripLogPort.js';
import { createRatingRepo } from '../../tracking/rating/repo.js';
import { assertTripMember } from '../../trips/authz.js';
import { createTripRepo } from '../../trips/repo.js';
import { createFoodItemLogRepo } from '../repo.js';
import { createRestaurantVisitPort } from '../restaurantVisitPort.js';
import { foodItemLogRoutes } from '../routes.js';

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function buildPgMem(): { db: IMemoryDb; pool: DbPool } {
  const db = newDb({ noAstCoverageCheck: true });
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
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'jsonb_build_object',
    args: [DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.jsonb,
    implementation: (k1, v1, k2, v2) => ({ [String(k1)]: v1, [String(k2)]: v2 }),
  });

  for (const name of [
    '0001_init.sql',
    '0002_experience_images.sql',
    '0006_experience_land.sql',
    '0013_avatar_presets.sql',
    '0015_trips.sql',
    '0034_experience_logs.sql',
    '0040_food_item_logging.sql',
  ]) {
    let sql = readFileSync(migrationPath(name), 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    pub.none(sql);
  }

  pub.none(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_state text NOT NULL DEFAULT 'active';
  `);

  pub.none(`
    ALTER TABLE trip_feed_items DROP CONSTRAINT IF EXISTS trip_feed_items_type_chk;
    ALTER TABLE trip_feed_items ADD CONSTRAINT trip_feed_items_type_chk CHECK (
      type IN ('trip_created', 'member_joined', 'completion_logged', 'rating_recorded', 'member_post', 'log_entry_added')
    );
  `);

  pub.none(`
    CREATE OR REPLACE VIEW profile_identity AS
    SELECT p.user_id,
           p.user_id AS public_id,
           p.display_name,
           p.avatar_preset,
           true AS is_visible
      FROM profiles p;

    CREATE OR REPLACE VIEW active_trip_memberships AS
    SELECT tm.trip_id, tm.user_id, tm.role, tm.joined_at
      FROM trip_memberships tm
      JOIN users u ON u.id = tm.user_id AND u.deletion_state = 'active';
  `);

  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool();
  const pool = {
    async query(text: string, params?: ReadonlyArray<unknown>) {
      const stripped = text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
      return rawPool.query(stripped, params as unknown[]);
    },
    async connect() {
      const client = await rawPool.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const stripped = text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
          return client.query(stripped, params as unknown[]);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;

  return { db, pool };
}

const FIXED_NOW = new Date('2026-11-04T15:00:00Z');

async function buildSeededHarness() {
  const { db, pool } = buildPgMem();
  const emitRatingChanged = async () => {};
  const completions = createCompletionRepo(pool);
  const ratings = createRatingRepo({ pool, emitRatingChanged });
  const experienceLogRepo = createExperienceLogRepo({ pool, emitRatingChanged });
  const tripRepo = createTripRepo(pool, { completions, ratings });
  const foodItemLogRepo = createFoodItemLogRepo({ pool, clock: () => FIXED_NOW });

  const tripLogPort: TripLogPort = {
    async logToTrip(i) {
      await assertTripMember(pool, i.userId, i.tripId);
      const r = await tripRepo.logCompletion(i.tripId, i.userId, {
        experienceId: i.experienceId,
        rodeWith: [...i.rodeWith],
        ...(i.rating !== null ? { rating: i.rating } : {}),
        note: i.note,
        completedOn: i.visitedOn,
        userTz: i.userTz,
      });
      return {
        logId: r.logId,
        loggedAt: r.loggedAt,
        logEntryId: r.logEntryId,
        pendingTags: r.pendingTags,
      };
    },
    purgeFeedForLog: (logId, userId) => tripRepo.purgeFeedForLog(logId, userId),
  };

  const restaurantVisitPort = createRestaurantVisitPort({
    pool,
    addExperienceLog: (i) => experienceLogRepo.addLog(i),
    logToTrip: (i) => tripLogPort.logToTrip(i),
  });

  const userId = randomUUID();
  const friendId = randomUUID();
  const outsiderId = randomUUID();
  const restaurantId = randomUUID();
  const locationId = randomUUID();
  const dish1Id = randomUUID();
  const dish2Id = randomUUID();
  const locationDishId = randomUUID();
  const tripId = randomUUID();

  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, 'u1@test.local', 'h'), ($2, 'u2@test.local', 'h'), ($3, 'u3@test.local', 'h')`,
    [userId, friendId, outsiderId],
  );
  await pool.query(
    `INSERT INTO profiles (user_id, display_name)
     VALUES ($1, 'Alice'), ($2, 'Bob'), ($3, 'Outsider')`,
    [userId, friendId, outsiderId],
  );
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, 'up-satuli', 'Satuli Canteen', 'Magic Kingdom', 'Restaurant')`,
    [restaurantId],
  );
  await pool.query(
    `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
     VALUES ($1, 'Spring Roll Cart', 'Magic Kingdom', $2)`,
    [locationId, userId],
  );
  await pool.query(
    `INSERT INTO food_items (id, experience_id, name, source)
     VALUES ($1, $3, 'Cheeseburger Pods', 'menu_sync'),
            ($2, $3, 'Blueberry Mousse', 'menu_sync')`,
    [dish1Id, dish2Id, restaurantId],
  );
  await pool.query(
    `INSERT INTO food_items (id, location_id, name, source, created_by_user_id)
     VALUES ($1, $2, 'Pastrami Spring Roll', 'user_submitted', $3)`,
    [locationDishId, locationId, userId],
  );
  await pool.query(
    `INSERT INTO trips (id, name, start_date, end_date, creator_id)
     VALUES ($1, 'AK Trip', '2026-11-01', '2026-11-05', $2)`,
    [tripId, userId],
  );
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role)
     VALUES ($1, $2, 'organizer'), ($1, $3, 'member')`,
    [tripId, userId, friendId],
  );

  const notices: Array<{
    tagId: string;
    tripLogEntryId: string;
    taggedMemberId: string;
    taggingMemberId: string;
  }> = [];

  const app: FastifyInstance = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    foodItemLogRoutes({
      repo: foodItemLogRepo,
      requireSession: async (req: any) => {
        const uid = req.headers['x-test-user-id'];
        if (!uid) throw new AppError('unauthorized', 'Auth required');
        req.userId = uid;
      },
      clock: () => FIXED_NOW,
      restaurantVisit: restaurantVisitPort,
      awardPins: async () => ['pin-foodie-1'],
      onRodeWithTagCreated: (n) => notices.push(n),
    }),
  );
  await app.ready();

  return {
    db,
    pool,
    app,
    notices,
    userId,
    friendId,
    outsiderId,
    restaurantId,
    dish1Id,
    dish2Id,
    locationDishId,
    tripId,
  };
}

describe('Feature: unified-dining-logging, Properties 1, 2, 3: Auto Restaurant Visit on Dish Log', () => {
  it(
    'Property 1 & Property 2: logging N dishes on the same date creates exactly 1 unrated Experience_Log + Completion and never touches restaurant ratings',
    async () => {
      const h = await buildSeededHarness();
      const backup = h.db.backup();

      await fc.assert(
        fc.asyncProperty(
          fc.boolean(), // whether a restaurant visit already existed before logging dishes
          fc.array(
            fc.record({
              useSecondDish: fc.boolean(),
              rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
              note: fc.option(fc.constantFrom('Great!', 'Delicious', 'Would order again'), {
                nil: null,
              }),
            }),
            { minLength: 1, maxLength: 4 },
          ),
          async (preExistingVisit, dishEntries) => {
            backup.restore();
            h.notices.length = 0;

            if (preExistingVisit) {
              await h.pool.query(
                `INSERT INTO experience_logs (user_id, experience_id, visited_on, user_tz, rating, note)
                 VALUES ($1, $2, '2026-11-04', 'America/New_York', 10, 'Overall great restaurant')`,
                [h.userId, h.restaurantId],
              );
              await h.pool.query(
                `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
                 VALUES ($1, $2, '2026-11-04', 'America/New_York')
                 ON CONFLICT DO NOTHING`,
                [h.userId, h.restaurantId],
              );
            }

            for (let i = 0; i < dishEntries.length; i++) {
              const entry = dishEntries[i]!;
              const foodItemId = entry.useSecondDish ? h.dish2Id : h.dish1Id;
              const res = await h.app.inject({
                method: 'POST',
                url: `/me/food-items/${foodItemId}/logs`,
                headers: { 'x-test-user-id': h.userId },
                payload: {
                  visitedOn: '2026-11-04',
                  userTz: 'America/New_York',
                  rating: entry.rating,
                  note: entry.note,
                },
              });

              expect(res.statusCode).toBe(201);
              const body = res.json();
              expect(body.restaurantVisit).toBeDefined();
              expect(body.restaurantVisit.experienceId).toBe(h.restaurantId);
              if (i === 0 && !preExistingVisit) {
                expect(body.restaurantVisit.created).toBe(true);
                expect(body.newlyAwardedPinIds).toEqual(['pin-foodie-1']);
              } else {
                expect(body.restaurantVisit.created).toBe(false);
              }
            }

            // Exactly 1 experience_logs row for (userId, restaurantId, '2026-11-04')
            const expLogs = await h.pool.query<{ rating: number | null; note: string | null }>(
              `SELECT rating, note FROM experience_logs WHERE user_id = $1 AND experience_id = $2 AND visited_on = '2026-11-04'`,
              [h.userId, h.restaurantId],
            );
            expect(expLogs.rows).toHaveLength(1);

            // Property 2: when auto-created, restaurant rating & note stay null and canonical ratings table has 0 rows
            if (!preExistingVisit) {
              expect(expLogs.rows[0]!.rating).toBeNull();
              expect(expLogs.rows[0]!.note).toBeNull();
              const ratingsCount = await h.pool.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM ratings WHERE user_id = $1 AND experience_id = $2`,
                [h.userId, h.restaurantId],
              );
              expect(ratingsCount.rows[0]!.n).toBe(0);
            } else {
              expect(expLogs.rows[0]!.rating).toBe(10);
              expect(expLogs.rows[0]!.note).toBe('Overall great restaurant');
            }

            // Canonical completion exists
            const compCount = await h.pool.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM completions WHERE user_id = $1 AND experience_id = $2`,
              [h.userId, h.restaurantId],
            );
            expect(compCount.rows[0]!.n).toBe(1);
          },
        ),
        { numRuns: 100 },
      );
    },
    30000,
  );

  it(
    'Property 3: Trip-linked dish log creates full trip footprint on first visit and writes nothing on rejection',
    async () => {
      const h = await buildSeededHarness();
      const backup = h.db.backup();

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<'valid_trip' | 'forbidden_trip' | 'outside_dates' | 'invalid_rider' | 'location_with_trip'>(
            'valid_trip',
            'forbidden_trip',
            'outside_dates',
            'invalid_rider',
            'location_with_trip',
          ),
          fc.boolean(), // tag friendId when valid
          async (scenario, tagFriend) => {
            backup.restore();
            h.notices.length = 0;

            if (scenario === 'valid_trip') {
              const rodeWith = tagFriend ? [h.friendId] : [];
              const res = await h.app.inject({
                method: 'POST',
                url: `/me/food-items/${h.dish1Id}/logs`,
                headers: { 'x-test-user-id': h.userId },
                payload: {
                  visitedOn: '2026-11-04',
                  userTz: 'America/New_York',
                  rating: 9,
                  tripId: h.tripId,
                  rodeWith,
                },
              });

              expect(res.statusCode).toBe(201);
              const body = res.json();
              expect(body.restaurantVisit.created).toBe(true);
              expect(body.restaurantVisit.tripLog).toEqual({
                tripId: h.tripId,
                logEntryId: expect.any(String),
                taggedCount: rodeWith.length,
              });
              expect(h.notices).toHaveLength(rodeWith.length);

              const feedRows = await h.pool.query(
                `SELECT 1 FROM trip_feed_items WHERE trip_id = $1 AND type = 'completion_logged'`,
                [h.tripId],
              );
              expect(feedRows.rows).toHaveLength(1);
              return;
            }

            // Rejected scenarios must write neither food_item_logs nor experience_logs
            const caller = scenario === 'forbidden_trip' ? h.outsiderId : h.userId;
            const visitedOn = scenario === 'outside_dates' ? '2026-10-15' : '2026-11-04';
            const rodeWith = scenario === 'invalid_rider' ? [h.outsiderId] : [];
            const targetItem = scenario === 'location_with_trip' ? h.locationDishId : h.dish1Id;

            const res = await h.app.inject({
              method: 'POST',
              url: `/me/food-items/${targetItem}/logs`,
              headers: { 'x-test-user-id': caller },
              payload: {
                visitedOn,
                userTz: 'America/New_York',
                tripId: h.tripId,
                rodeWith,
              },
            });

            expect(res.statusCode).toBeGreaterThanOrEqual(400);

            const dishLogs = await h.pool.query(`SELECT 1 FROM food_item_logs`);
            const expLogs = await h.pool.query(`SELECT 1 FROM experience_logs`);
            expect(dishLogs.rows).toHaveLength(0);
            expect(expLogs.rows).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    },
    30000,
  );
});
