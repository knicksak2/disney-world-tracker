/**
 * Property 7: Rejected Trip-linked requests write nothing, and denials do not disclose
 * Validates: Requirements 5.11, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 *
 * For any Trip-linked create that violates a rule (a rodeWith containing the caller,
 * a duplicate, or a non-member; a future visitedOn; an explicit visitedOn outside the Trip's range;
 * a caller who is not a member), the call is rejected with the specific code
 * (trip_validation_failed, log_future_date, log_outside_trip_dates, trip_forbidden)
 * and the row counts of experience_logs, completions, ratings, trip_log_entries,
 * trip_feed_items, and rode_with_tags are unchanged.
 *
 * For any caller who is not a member of an existing Trip and any non-existent Trip id,
 * the responses (status, code, message) are identical.
 * An unauthenticated request is rejected unauthorized before either check.
 * A POST /trips/:id/log-entries without visitedOn never raises log_outside_trip_dates regardless of the Trip's dates.
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
import { AppError } from '../../../../errors/AppError.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import { createCompletionRepo } from '../../completion/repo.js';
import { createRatingRepo } from '../../rating/repo.js';
import { assertTripMember } from '../../../trips/authz.js';
import { createTripRepo, type TripRepo } from '../../../trips/repo.js';
import { tripRoutes } from '../../../trips/routes.js';
import { createExperienceLogRepo, type ExperienceLogRepo } from '../repo.js';
import { experienceLogRoutes } from '../routes.js';
import type { TripLogPort } from '../tripLogPort.js';

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

  for (const name of [
    '0001_init.sql',
    '0002_experience_images.sql',
    '0006_experience_land.sql',
    '0013_avatar_presets.sql',
    '0015_trips.sql',
    '0034_experience_logs.sql',
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
  readonly tripRepo: TripRepo;
  readonly logRepo: ExperienceLogRepo;
  currentUserId: string | null;
}

function buildTestContext(pool: DbPool, clock?: () => Date): TestContext {
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

  let currentUserId: string | null = null;
  const requireSession: preHandlerHookHandler = async (req) => {
    if (!currentUserId) {
      throw new AppError('unauthorized', 'Unauthorized');
    }
    req.userId = currentUserId;
  };

  app.register(
    experienceLogRoutes({
      repo: logRepo,
      requireSession,
      tripLog: tripLogPort,
      ...(clock ? { clock } : {}),
    }),
  );

  app.register(
    tripRoutes({
      repo: tripRepo,
      pool,
      requireSession,
      ...(clock ? { clock } : {}),
    }),
  );

  return {
    pool,
    app,
    tripRepo,
    logRepo,
    get currentUserId() {
      return currentUserId;
    },
    set currentUserId(v: string | null) {
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

interface TableCounts {
  readonly experienceLogs: number;
  readonly completions: number;
  readonly ratings: number;
  readonly tripLogEntries: number;
  readonly tripFeedItems: number;
  readonly rodeWithTags: number;
}

async function getSixTableCounts(pool: DbPool): Promise<TableCounts> {
  const [el, c, r, tle, tfi, rwt] = await Promise.all([
    pool.query<{ count: string | number }>('SELECT count(*) AS count FROM experience_logs'),
    pool.query<{ count: string | number }>('SELECT count(*) AS count FROM completions'),
    pool.query<{ count: string | number }>('SELECT count(*) AS count FROM ratings'),
    pool.query<{ count: string | number }>('SELECT count(*) AS count FROM trip_log_entries'),
    pool.query<{ count: string | number }>('SELECT count(*) AS count FROM trip_feed_items'),
    pool.query<{ count: string | number }>('SELECT count(*) AS count FROM rode_with_tags'),
  ]);

  return {
    experienceLogs: Number(el.rows[0]?.count ?? 0),
    completions: Number(c.rows[0]?.count ?? 0),
    ratings: Number(r.rows[0]?.count ?? 0),
    tripLogEntries: Number(tle.rows[0]?.count ?? 0),
    tripFeedItems: Number(tfi.rows[0]?.count ?? 0),
    rodeWithTags: Number(rwt.rows[0]?.count ?? 0),
  };
}

describe('unifiedLogging rejections (Property 7)', () => {
  it('Property 7: Rejected Trip-linked requests write nothing, and denials do not disclose (100 runs)', async () => {
    // Fixed simulated "today" clock for date testing
    const simulatedClock = () => new Date('2026-05-05T12:00:00.000Z');

    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool, simulatedClock);
    await ctx.app.ready();

    const callerId = await seedUser(pool, 'Caller');
    const memberId = await seedUser(pool, 'Member');
    const nonMemberId = await seedUser(pool, 'NonMember');
    const tripId = await seedTrip(pool, callerId, [memberId]);
    const expId = await seedExperience(pool);

    type ViolationKind =
      | 'rodeWith_self'
      | 'rodeWith_dup'
      | 'rodeWith_non_member'
      | 'future_date'
      | 'date_outside_trip'
      | 'caller_not_member';

    const violationKindArb = fc.constantFrom<ViolationKind>(
      'rodeWith_self',
      'rodeWith_dup',
      'rodeWith_non_member',
      'future_date',
      'date_outside_trip',
      'caller_not_member',
    );

    const endpointArb = fc.constantFrom<'personal' | 'trip'>('personal', 'trip');

    await fc.assert(
      fc.asyncProperty(violationKindArb, endpointArb, async (kind, endpoint) => {
        const countsBefore = await getSixTableCounts(pool);

        let actingUserId = callerId;
        let testTripId = tripId;
        let visitedOn = '2026-05-03';
        let rodeWith: string[] = [memberId];
        let expectedCode: string;
        let expectedStatus: number;

        switch (kind) {
          case 'rodeWith_self':
            rodeWith = [callerId];
            expectedCode = 'trip_validation_failed';
            expectedStatus = 400;
            break;
          case 'rodeWith_dup':
            rodeWith = [memberId, memberId];
            expectedCode = 'trip_validation_failed';
            expectedStatus = 400;
            break;
          case 'rodeWith_non_member':
            rodeWith = [nonMemberId];
            expectedCode = 'trip_validation_failed';
            expectedStatus = 400;
            break;
          case 'future_date':
            visitedOn = '2026-05-15'; // after simulatedClock 2026-05-05
            expectedCode = 'log_future_date';
            expectedStatus = 400;
            break;
          case 'date_outside_trip':
            visitedOn = '2026-04-20'; // trip is 2026-05-01 to 2026-05-10
            expectedCode = 'log_outside_trip_dates';
            expectedStatus = 400;
            break;
          case 'caller_not_member':
            actingUserId = nonMemberId;
            expectedCode = 'trip_forbidden';
            expectedStatus = 403;
            break;
        }

        ctx.currentUserId = actingUserId;

        const res =
          endpoint === 'personal'
            ? await ctx.app.inject({
                method: 'POST',
                url: `/me/experiences/${expId}/logs`,
                payload: {
                  visitedOn,
                  userTz: 'America/New_York',
                  tripId: testTripId,
                  rodeWith,
                },
              })
            : await ctx.app.inject({
                method: 'POST',
                url: `/trips/${testTripId}/log-entries`,
                payload: {
                  experienceId: expId,
                  visitedOn,
                  userTz: 'America/New_York',
                  rodeWith,
                },
              });

        expect(res.statusCode).toBe(expectedStatus);
        const parsed = JSON.parse(res.payload);
        expect(parsed.error?.code).toBe(expectedCode);

        // Row counts of all six tables must be completely unchanged
        const countsAfter = await getSixTableCounts(pool);
        expect(countsAfter).toEqual(countsBefore);
      }),
      { numRuns: 100 },
    );
  });

  it('Non-member vs non-existent Trip produces byte-for-byte identical responses', async () => {
    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool);
    await ctx.app.ready();

    const callerId = await seedUser(pool, 'Caller');
    const bystanderId = await seedUser(pool, 'Bystander');
    const tripId = await seedTrip(pool, bystanderId, []); // caller is NOT member
    const expId = await seedExperience(pool);
    const nonExistentTripId = randomUUID();

    ctx.currentUserId = callerId;

    // 1. Personal endpoint with non-member trip vs non-existent trip
    const resPersonalNonMember = await ctx.app.inject({
      method: 'POST',
      url: `/me/experiences/${expId}/logs`,
      payload: {
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        tripId,
      },
    });

    const resPersonalNonExistent = await ctx.app.inject({
      method: 'POST',
      url: `/me/experiences/${expId}/logs`,
      payload: {
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        tripId: nonExistentTripId,
      },
    });

    expect(resPersonalNonMember.statusCode).toBe(403);
    expect(resPersonalNonExistent.statusCode).toBe(403);
    expect(JSON.parse(resPersonalNonMember.payload)).toEqual(JSON.parse(resPersonalNonExistent.payload));

    // 2. Trip endpoint with non-member trip vs non-existent trip
    const resTripNonMember = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/log-entries`,
      payload: {
        experienceId: expId,
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        rodeWith: [],
      },
    });

    const resTripNonExistent = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${nonExistentTripId}/log-entries`,
      payload: {
        experienceId: expId,
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        rodeWith: [],
      },
    });

    expect(resTripNonMember.statusCode).toBe(403);
    expect(resTripNonExistent.statusCode).toBe(403);
    expect(JSON.parse(resTripNonMember.payload)).toEqual(JSON.parse(resTripNonExistent.payload));
  });

  it('Unauthenticated request is rejected unauthorized before either check', async () => {
    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool);
    await ctx.app.ready();

    ctx.currentUserId = null; // Unauthenticated
    const expId = randomUUID();
    const tripId = randomUUID();

    const resPersonal = await ctx.app.inject({
      method: 'POST',
      url: `/me/experiences/${expId}/logs`,
      payload: {
        visitedOn: '2026-05-02',
        userTz: 'America/New_York',
        tripId,
      },
    });
    expect(resPersonal.statusCode).toBe(401);
    expect(JSON.parse(resPersonal.payload).error?.code).toBe('unauthorized');

    const resTrip = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/log-entries`,
      payload: {
        experienceId: expId,
        rodeWith: [],
      },
    });
    expect(resTrip.statusCode).toBe(401);
    expect(JSON.parse(resTrip.payload).error?.code).toBe('unauthorized');
  });

  it('POST /trips/:id/log-entries without visitedOn on a past Trip still succeeds', async () => {
    // Current date is 2026-06-01, trip was 2026-05-01 to 2026-05-10 (a past trip)
    const simulatedClock = () => new Date('2026-06-01T12:00:00.000Z');

    const { pool } = buildPgMem();
    const ctx = buildTestContext(pool, simulatedClock);
    await ctx.app.ready();

    const callerId = await seedUser(pool, 'PastTripCaller');
    const tripId = await seedTrip(pool, callerId, []);
    const expId = await seedExperience(pool);
    ctx.currentUserId = callerId;

    // Omitting visitedOn on POST /trips/:id/log-entries must succeed and NOT raise log_outside_trip_dates
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/log-entries`,
      payload: {
        experienceId: expId,
        rodeWith: [],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.logEntryId).toBeDefined();
  });
});
