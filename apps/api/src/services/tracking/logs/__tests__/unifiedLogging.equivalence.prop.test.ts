/**
 * Property 6: Trip-linked creates are identical from either endpoint
 * Validates: Requirements 5.2, 5.3, 5.4, 5.7
 *
 * For any valid input (experience, date within the Trip's range and not future,
 * optional Rating, optional note, distinct non-caller Trip_Member rodeWith),
 * creating through POST /me/experiences/:id/logs with a tripId and through
 * POST /trips/:id/log-entries with the same fields produces the same set of
 * persisted rows:
 *  - one experience_logs row with equal visited_on, user_tz, rating, note;
 *  - the caller's completions row (not duplicated if one already existed);
 *  - the ratings row when a Rating was given;
 *  - one trip_log_entries row;
 *  - one completion_logged trip_feed_items row whose metadata has the same experienceId
 *    and a logEntryId equal to the entry id;
 *  - one pending rode_with_tags row per tagged Member;
 *  - and one tag notice per tag.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../../db/pool.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import { createCompletionRepo } from '../../completion/repo.js';
import { createRatingRepo } from '../../rating/repo.js';
import { assertTripMember } from '../../../trips/authz.js';
import { createTripRepo, type TripRepo } from '../../../trips/repo.js';
import { tripRoutes } from '../../../trips/routes.js';
import { createExperienceLogRepo, type ExperienceLogRepo } from '../repo.js';
import { experienceLogRoutes } from '../routes.js';
import type { TripLogPort } from '../tripLogPort.js';

function toDateStr(d: Date | string): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
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
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'nullif',
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (a, b) => (a === b ? null : a),
  });
  pub.registerFunction({
    name: 'jsonb_build_object',
    args: [DataType.text, DataType.text, DataType.text, DataType.text],
    returns: DataType.jsonb,
    implementation: (k1, v1, k2, v2) => ({ [String(k1)]: v1, [String(k2)]: v2 }),
  });
  pub.registerFunction({
    name: 'json_build_object',
    args: [DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.text, DataType.uuid],
    returns: DataType.json,
    implementation: (k1, v1, k2, v2, k3, v3, k4, v4) => ({
      [String(k1)]: v1,
      [String(k2)]: v2,
      [String(k3)]: v3,
      [String(k4)]: v4,
    }),
  });

  for (const name of ['0001_init.sql', '0002_experience_images.sql', '0006_experience_land.sql', '0013_avatar_presets.sql', '0015_trips.sql', '0034_experience_logs.sql']) {
    let sql = readFileSync(migrationPath(name), 'utf8');
    sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
    sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
    pub.none(sql);
  }

  // Users deletion_state used by trip authorization
  pub.none(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_state text NOT NULL DEFAULT 'active';
  `);

  // Widen feed item types to allow completion_logged
  pub.none(`
    ALTER TABLE trip_feed_items DROP CONSTRAINT IF EXISTS trip_feed_items_type_chk;
    ALTER TABLE trip_feed_items ADD CONSTRAINT trip_feed_items_type_chk CHECK (
      type IN ('trip_created', 'member_joined', 'completion_logged', 'rating_recorded', 'member_post', 'log_entry_added')
    );
  `);

  // Profile identity view and active memberships used by getFeed and membership queries
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
  const strip = (t: string): string =>
    t
      .replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '')
      .replace(/\(SELECT count\(\*\)::int\s+FROM rode_with_tags rwt[\s\S]+?WHERE[^\)]+\)/giu, '0')
      .replace(/\(SELECT json_agg\([\s\S]+?WHERE rwt\.log_entry_id = le\.id\)/giu, 'NULL');
  const pool = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return rawPool.query(strip(text), params as unknown[]);
    },
    async connect() {
      const client = await rawPool.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(strip(text), params as unknown[]);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;

  return { db, pool };
}

interface TestContext {
  readonly pool: DbPool;
  readonly app: FastifyInstance;
  readonly notices: Array<unknown>;
  readonly tripRepo: TripRepo;
  readonly logRepo: ExperienceLogRepo;
  currentUserId: string;
}

function buildTestContext(pool: DbPool): TestContext {
  const notices: Array<unknown> = [];
  const completions = createCompletionRepo(pool);
  const ratings = createRatingRepo({
    pool,
    emitRatingChanged: async () => {},
  });
  const tripRepo = createTripRepo(pool, { completions, ratings });
  const logRepo = createExperienceLogRepo({
    pool,
    emitRatingChanged: async () => {},
  });

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

  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  let currentUserId = '';
  const requireSession: preHandlerHookHandler = async (req) => {
    req.userId = currentUserId;
  };

  app.register(
    experienceLogRoutes({
      repo: logRepo,
      requireSession,
      tripLog: tripLogPort,
      onRodeWithTagCreated: async (n) => {
        notices.push(n);
      },
    }),
  );

  app.register(
    tripRoutes({
      repo: tripRepo,
      pool,
      requireSession,
      emitRodeWithTagCreated: async (n) => {
        notices.push(n);
      },
    }),
  );

  return {
    pool,
    app,
    notices,
    tripRepo,
    logRepo,
    get currentUserId() {
      return currentUserId;
    },
    set currentUserId(v: string) {
      currentUserId = v;
    },
  };
}

async function seedUser(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`, [
    id,
    `${name}-${id}@example.com`,
  ]);
  await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [id, name]);
  return id;
}

async function seedExperience(pool: DbPool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, $2, 'Space Mountain', 'Magic Kingdom', 'Ride')`,
    [id, `up-${id}`],
  );
  return id;
}

async function seedTrip(pool: DbPool, creatorId: string, memberIds: string[]): Promise<string> {
  const tripId = randomUUID();
  await pool.query(
    `INSERT INTO trips (id, creator_id, name, start_date, end_date)
     VALUES ($1, $2, 'Disney Vacation', '2026-05-01', '2026-05-10')`,
    [tripId, creatorId],
  );
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'organizer')`,
    [tripId, creatorId],
  );
  for (const mid of memberIds) {
    await pool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ($1, $2, 'member')`,
      [tripId, mid],
    );
  }
  return tripId;
}

describe('unifiedLogging equivalence (Property 6)', () => {
  it('Property 6: Trip-linked creates are identical from either endpoint (100 runs)', async () => {
    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool);
    await ctx.app.ready();

    const callerId = await seedUser(pool, 'Caller');
    const member1 = await seedUser(pool, 'Member1');
    const member2 = await seedUser(pool, 'Member2');
    ctx.currentUserId = callerId;

    const memberUniverse = [member1, member2];

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
          note: fc.option(fc.string({ minLength: 1, maxLength: 50 }).map((s) => s.trim()).filter((s) => s.length > 0), { nil: null }),
          visitedOn: fc.constantFrom('2026-05-01', '2026-05-03', '2026-05-05', '2026-05-10'),
          rodeWith: fc.subarray(memberUniverse, { minLength: 0, maxLength: 2 }),
        }),
        async (input) => {
          // Clear notices before each run
          ctx.notices.length = 0;

          // Branch 1: POST /me/experiences/:id/logs with tripId
          const exp1 = await seedExperience(pool);
          const trip1 = await seedTrip(pool, callerId, memberUniverse);

          const res1 = await ctx.app.inject({
            method: 'POST',
            url: `/me/experiences/${exp1}/logs`,
            payload: {
              visitedOn: input.visitedOn,
              userTz: 'America/New_York',
              rating: input.rating,
              note: input.note,
              tripId: trip1,
              rodeWith: input.rodeWith,
            },
          });
          expect(res1.statusCode).toBe(201);
          const notices1 = [...ctx.notices];

          // Branch 2: POST /trips/:id/log-entries with experienceId
          ctx.notices.length = 0;
          const exp2 = await seedExperience(pool);
          const trip2 = await seedTrip(pool, callerId, memberUniverse);

          const res2 = await ctx.app.inject({
            method: 'POST',
            url: `/trips/${trip2}/log-entries`,
            payload: {
              experienceId: exp2,
              visitedOn: input.visitedOn,
              userTz: 'America/New_York',
              ...(input.rating !== null ? { rating: input.rating } : {}),
              ...(input.note !== null ? { note: input.note } : {}),
              rodeWith: input.rodeWith,
            },
          });
          expect(res2.statusCode).toBe(201);
          const notices2 = [...ctx.notices];

          // 1. Compare experience_logs
          const logs1 = await pool.query<{ visited_on: string; user_tz: string; rating: number | null; note: string | null }>(
            `SELECT visited_on, user_tz, rating, note FROM experience_logs WHERE experience_id = $1`,
            [exp1],
          );
          const logs2 = await pool.query<{ visited_on: string; user_tz: string; rating: number | null; note: string | null }>(
            `SELECT visited_on, user_tz, rating, note FROM experience_logs WHERE experience_id = $1`,
            [exp2],
          );
          expect(logs1.rows).toHaveLength(1);
          expect(logs2.rows).toHaveLength(1);
          expect(toDateStr(logs1.rows[0]!.visited_on)).toBe(toDateStr(logs2.rows[0]!.visited_on));
          expect(logs1.rows[0]!.user_tz).toBe(logs2.rows[0]!.user_tz);
          expect(logs1.rows[0]!.rating).toBe(logs2.rows[0]!.rating);
          expect(logs1.rows[0]!.note).toBe(logs2.rows[0]!.note);

          // 2. Compare completions
          const comp1 = await pool.query<{ completed_on: Date | string; user_tz: string }>(
            `SELECT completed_on, user_tz FROM completions WHERE user_id = $1 AND experience_id = $2`,
            [callerId, exp1],
          );
          const comp2 = await pool.query<{ completed_on: Date | string; user_tz: string }>(
            `SELECT completed_on, user_tz FROM completions WHERE user_id = $1 AND experience_id = $2`,
            [callerId, exp2],
          );
          expect(comp1.rows).toHaveLength(1);
          expect(comp2.rows).toHaveLength(1);
          expect(toDateStr(comp1.rows[0]!.completed_on)).toBe(toDateStr(comp2.rows[0]!.completed_on));

          // 3. Compare ratings
          const rat1 = await pool.query<{ value: number }>(
            `SELECT value FROM ratings WHERE user_id = $1 AND experience_id = $2`,
            [callerId, exp1],
          );
          const rat2 = await pool.query<{ value: number }>(
            `SELECT value FROM ratings WHERE user_id = $1 AND experience_id = $2`,
            [callerId, exp2],
          );
          if (input.rating !== null) {
            expect(rat1.rows).toHaveLength(1);
            expect(rat2.rows).toHaveLength(1);
            expect(rat1.rows[0]!.value).toBe(input.rating);
            expect(rat2.rows[0]!.value).toBe(input.rating);
          } else {
            expect(rat1.rows).toHaveLength(0);
            expect(rat2.rows).toHaveLength(0);
          }

          // 4. Compare trip_log_entries
          const tle1 = await pool.query<{ member_id: string }>(
            `SELECT member_id FROM trip_log_entries WHERE trip_id = $1`,
            [trip1],
          );
          const tle2 = await pool.query<{ member_id: string }>(
            `SELECT member_id FROM trip_log_entries WHERE trip_id = $1`,
            [trip2],
          );
          expect(tle1.rows).toHaveLength(1);
          expect(tle2.rows).toHaveLength(1);
          expect(tle1.rows[0]!.member_id).toBe(callerId);
          expect(tle2.rows[0]!.member_id).toBe(callerId);

          // 5. Compare trip_feed_items
          const fi1 = await pool.query<{ type: string; actor_id: string; metadata: any }>(
            `SELECT type, actor_id, metadata FROM trip_feed_items WHERE trip_id = $1`,
            [trip1],
          );
          const fi2 = await pool.query<{ type: string; actor_id: string; metadata: any }>(
            `SELECT type, actor_id, metadata FROM trip_feed_items WHERE trip_id = $1`,
            [trip2],
          );
          expect(fi1.rows).toHaveLength(1);
          expect(fi2.rows).toHaveLength(1);
          expect(fi1.rows[0]!.type).toBe('completion_logged');
          expect(fi2.rows[0]!.type).toBe('completion_logged');
          expect(fi1.rows[0]!.actor_id).toBe(callerId);
          expect(fi2.rows[0]!.actor_id).toBe(callerId);
          expect(fi1.rows[0]!.metadata.experienceId).toBe(exp1);
          expect(fi2.rows[0]!.metadata.experienceId).toBe(exp2);

          // 6. Compare rode_with_tags
          const rwt1 = await pool.query<{ tagged_member_id: string; state: string }>(
            `SELECT tagged_member_id, state FROM rode_with_tags WHERE log_entry_id = (SELECT id FROM trip_log_entries WHERE trip_id = $1) ORDER BY tagged_member_id`,
            [trip1],
          );
          const rwt2 = await pool.query<{ tagged_member_id: string; state: string }>(
            `SELECT tagged_member_id, state FROM rode_with_tags WHERE log_entry_id = (SELECT id FROM trip_log_entries WHERE trip_id = $1) ORDER BY tagged_member_id`,
            [trip2],
          );
          expect(rwt1.rows).toEqual(rwt2.rows);

          // 7. Compare notices
          expect(notices1).toHaveLength(input.rodeWith.length);
          expect(notices2).toHaveLength(input.rodeWith.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Regression for reported bug: POST /me/experiences/:id/logs with tripId produces completion_logged feed item', async () => {
    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool);
    await ctx.app.ready();

    const callerId = await seedUser(pool, 'BugCaller');
    const tripId = await seedTrip(pool, callerId, []);
    const expId = await seedExperience(pool);
    ctx.currentUserId = callerId;

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/me/experiences/${expId}/logs`,
      payload: {
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        tripId,
      },
    });
    expect(res.statusCode).toBe(201);

    // Verify completion_logged row in trip_feed_items
    const feedItemRes = await pool.query<{ id: string; type: string; metadata: any }>(
      `SELECT id, type, metadata FROM trip_feed_items WHERE trip_id = $1 AND type = 'completion_logged'`,
      [tripId],
    );
    expect(feedItemRes.rows).toHaveLength(1);
    expect(feedItemRes.rows[0]!.metadata.experienceId).toBe(expId);

    // Verify it appears in getFeed
    const feed = await ctx.tripRepo.getFeed(tripId, callerId);
    const loggedItem = feed.find((item) => item.type === 'completion_logged');
    expect(loggedItem).toBeDefined();
    expect(loggedItem?.metadata?.experienceId).toBe(expId);

    // Confirm that a pre-change addLog-only path (without tripLogPort) would NOT produce trip_feed_items
    const unlinkedApp = Fastify({ logger: false });
    registerErrorHandler(unlinkedApp);
    const requireSession: preHandlerHookHandler = async (req) => {
      req.userId = callerId;
    };
    unlinkedApp.register(
      experienceLogRoutes({
        repo: ctx.logRepo,
        requireSession,
        // NO tripLog port, simulating pre-change code
      }),
    );
    await unlinkedApp.ready();

    const expUnlinked = await seedExperience(pool);
    const tripUnlinked = await seedTrip(pool, callerId, []);
    const resPreChange = await unlinkedApp.inject({
      method: 'POST',
      url: `/me/experiences/${expUnlinked}/logs`,
      payload: {
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        tripId: tripUnlinked,
      },
    });
    expect(resPreChange.statusCode).toBe(201);

    const preChangeFeedItems = await pool.query(
      `SELECT id FROM trip_feed_items WHERE trip_id = $1 AND type = 'completion_logged'`,
      [tripUnlinked],
    );
    // Demonstrates pre-change path wrote NO completion_logged feed item
    expect(preChangeFeedItems.rows).toHaveLength(0);
  });
});
