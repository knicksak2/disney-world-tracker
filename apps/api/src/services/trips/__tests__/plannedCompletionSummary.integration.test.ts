// Feature: planned-list-completion-sync, Task 2.6: integration tests for the
// extended Trip_Summary planned counts and the reused member-gated reads.
/**
 * Cross-service integration test for the Planned List Completion Sync server
 * surface (task 2.6).
 *
 * Validates: Requirements 5.7, 6.5, 6.7, 7.2
 *
 * This test exercises the REAL `createTripRepo` — wired to the REAL Tracking
 * `createCompletionRepo` / `createRatingRepo` — behind the REAL `tripRoutes`
 * Fastify plugin (the same `requireSession` → `assertTripMember` gate
 * `composeServices.ts` builds), end-to-end against a REAL Postgres.
 *
 * Unlike the pure-`trip_*` property tests (fake in-memory pool) and the pg-mem
 * cascade/rating integration tests, this suite runs against a real Postgres in a
 * throwaway database created and dropped per run, because the reused
 * `GET /trips/:id/feed` read the Rating facets depend on uses correlated
 * scalar subqueries and JSON aggregation that the in-memory `pg-mem` engine
 * cannot execute (the same limitation the Stats snapshot-isolation and
 * performance integration tests document). Following those tests, the whole
 * suite is guarded by a reachability probe and SKIPS with a clear reason when no
 * Postgres is reachable, rather than failing — mirroring
 * `services/stats/__tests__/repo.isolation.test.ts`.
 *
 * The full migration chain is applied verbatim to the throwaway database so the
 * production DDL — including the Trip tables (`0015_trips.sql`) and the GIN
 * trigram indexes / extensions pg-mem cannot model — runs exactly as in
 * production.
 *
 * Three facets are proven:
 *
 *   1. Extended summary counts (R5.1, R5.2, R5.4, R5.5) — `GET /trips/:id/summary`
 *      returns `plannedTotalCount` / `plannedCompletedCount` derived live from
 *      the Trip's real `planned_items` matched against its `trip_log_entries`,
 *      including the empty `0 / 0` case and the dedup of several log entries for
 *      one Experience counting its Planned_Item at most once.
 *
 *   2. Member-gated, non-disclosing authorization (R5.7, R7.2) — a non-member of
 *      an existing Trip and a request for a non-existent Trip collapse to the
 *      byte-for-byte identical `trip_forbidden` (403) on `GET /summary`,
 *      `GET /planned-items`, and `GET /feed`, so neither the planned counts nor
 *      the existence of the Trip can be probed; a Member receives their data.
 *
 *   3. Canonical Rating read live, referenced never copied (R6.5, R6.7) — the
 *      Rating surfaced on a completion logged from the Planned_List's Experience
 *      is read live from the canonical `ratings` table each read (a later change
 *      to that row is reflected on the next `GET /feed`, proving no Trip-local
 *      copy), and a completion with no canonical Rating surfaces no Rating value
 *      and no placeholder (the absent/unavailable-Rating indication).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { TripFeedItemDTO, TripSummaryDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { createCompletionRepo } from '../../tracking/completion/repo.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
} from '../../tracking/rating/repo.js';
import { createTripRepo, type TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Live-DB discovery (mirrors services/stats/__tests__/repo.isolation.test.ts)
// ---------------------------------------------------------------------------
//
// The connection string mirrors the docker-compose `postgres` service used for
// local development (apps/api/.env.example). If no Postgres is reachable the
// whole suite is skipped with a clear reason rather than failing.

const BASE_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';

/** Quick reachability probe with a short timeout so DB-less CI skips fast. */
async function probeDatabase(): Promise<boolean> {
  const probe = new Pool({
    connectionString: BASE_DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {
      /* ignore */
    });
  }
}

const DB_AVAILABLE = await probeDatabase();

/** Swap the database name in a Postgres connection URL. */
function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

/** Absolute path to the migrations directory relative to this test file. */
function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → trips → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations');
}

/** Apply every `NNNN_*.sql` migration, in lexicographic order, verbatim. */
async function applyAllMigrations(pool: DbPool): Promise<void> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((name) => /^\d{4,}_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const client = await pool.connect();
  try {
    for (const name of files) {
      const sql = readFileSync(join(dir, name), 'utf8');
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function insertUser(pool: DbPool, displayName: string): Promise<string> {
  const email = `${randomUUID()}@example.test`;
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
    [email, 'x'],
  );
  const userId = res.rows[0]!.id;
  await pool.query(
    `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
    [userId, displayName],
  );
  return userId;
}

async function befriend(pool: DbPool, a: string, b: string): Promise<void> {
  const { lo, hi } = canonicalPair(a, b);
  await pool.query(
    `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
    [lo, hi],
  );
}

async function insertExperience(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description, active)
     VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride', '', TRUE)`,
    [id, `upstream-${id}`, name],
  );
  return id;
}

/** Read the single canonical Rating value for a `(user, experience)` pair. */
async function readRatingValue(
  pool: DbPool,
  userId: string,
  experienceId: string,
): Promise<number | null> {
  const res = await pool.query<{ value: number }>(
    `SELECT value FROM ratings WHERE user_id = $1 AND experience_id = $2`,
    [userId, experienceId],
  );
  const row = res.rows[0];
  return row ? Number(row.value) : null;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!DB_AVAILABLE)(
  'Planned List Completion Sync — summary + reused reads (integration, live Postgres)',
  () => {
    let adminPool: DbPool;
    let testPool: DbPool;
    let testDbName: string;
    let repo: TripRepo;
    let app: FastifyInstance;
    let ratingEvents: RatingChangedEvent[];

    // The controllable "current session User": the injected requireSession
    // assigns it, so a test can impersonate a member, a non-member, or (null) an
    // unauthenticated caller. The route's authenticated-session check runs
    // before the membership gate, so a null caller never reaches
    // `assertTripMember`.
    let currentCaller: string | null = null;

    beforeAll(async () => {
      // Create a throwaway database so the developer's catalog is never touched,
      // then apply the full migration chain verbatim.
      testDbName = `dwt_plc_sync_${randomUUID().replace(/-/g, '')}`;
      adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
      await adminPool.query(`CREATE DATABASE ${testDbName}`);

      testPool = new Pool({
        connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
        max: 5,
      });
      await applyAllMigrations(testPool);

      ratingEvents = [];
      const completionRepo = createCompletionRepo(testPool);
      const ratingRepo = createRatingRepo({
        pool: testPool,
        emitRatingChanged: async (event) => {
          ratingEvents.push(event);
        },
      });
      // The REAL Trip repo wired to the REAL canonical Tracking repos — exactly
      // the wiring composeServices.ts builds in production.
      repo = createTripRepo(testPool, {
        completions: completionRepo,
        ratings: ratingRepo,
      });

      const requireSession: preHandlerHookHandler = async (request) => {
        if (currentCaller === null) {
          throw new AppError('unauthorized', 'Authentication required.');
        }
        request.userId = currentCaller;
      };

      app = Fastify({ logger: false });
      registerErrorHandler(app);
      await app.register(tripRoutes({ repo, requireSession, pool: testPool }));
      await app.ready();
    }, 60_000);

    afterAll(async () => {
      await app?.close();
      await testPool?.end().catch(() => {
        /* ignore */
      });
      if (adminPool) {
        // FORCE disconnects any lingering sessions so the DROP succeeds.
        await adminPool
          .query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`)
          .catch(() => {
            /* ignore */
          });
        await adminPool.end().catch(() => {
          /* ignore */
        });
      }
    });

    beforeEach(async () => {
      // Reset the mutable tables between tests so each run is independent. A
      // CASCADE from `users` / `trips` clears every dependent Trip child row.
      await testPool.query(
        `TRUNCATE trips, completions, ratings, notes, friendships, experiences, profiles, users
           RESTART IDENTITY CASCADE`,
      );
      ratingEvents.length = 0;
      currentCaller = null;
    });

    afterEach(() => {
      currentCaller = null;
    });

    const setCaller = (userId: string | null): void => {
      currentCaller = userId;
    };

    // -----------------------------------------------------------------------
    // Facet 1 — the extended summary planned counts (R5.1, R5.2, R5.4, R5.5)
    // -----------------------------------------------------------------------

    it('GET /summary reports 0/0 planned counts for a Trip with an empty Planned_List (R5.4)', async () => {
      const organizer = await insertUser(testPool, 'Organizer O');
      const trip = await repo.createTrip(organizer, {
        name: 'WDW 2025',
        description: '',
        startDate: '2025-01-10',
        endDate: '2025-01-15',
      });

      setCaller(organizer);
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/summary`,
      });

      expect(res.statusCode).toBe(200);
      const summary = res.json<TripSummaryDTO>();
      expect(summary.plannedTotalCount).toBe(0);
      expect(summary.plannedCompletedCount).toBe(0);
    });

    it('GET /summary derives the planned counts from real planned_items matched against trip_log_entries (R5.1, R5.2)', async () => {
      const organizer = await insertUser(testPool, 'Organizer O');
      const planned1 = await insertExperience(testPool, 'Space Mountain');
      const planned2 = await insertExperience(testPool, 'Big Thunder Mountain');
      const planned3 = await insertExperience(testPool, 'Haunted Mansion');

      const trip = await repo.createTrip(organizer, {
        name: 'WDW 2025',
        description: '',
        startDate: '2025-01-10',
        endDate: '2025-01-15',
      });

      // Three Planned_Items on the shared list.
      await repo.addPlannedItem(trip.id, organizer, { experienceId: planned1 });
      await repo.addPlannedItem(trip.id, organizer, { experienceId: planned2 });
      await repo.addPlannedItem(trip.id, organizer, { experienceId: planned3 });

      // Only two of the three are actually completed via a Trip_Log_Entry.
      await repo.logCompletion(trip.id, organizer, {
        experienceId: planned1,
        rodeWith: [],
        rating: 8,
        completedOn: '2025-01-12',
        userTz: 'America/New_York',
      });
      await repo.logCompletion(trip.id, organizer, {
        experienceId: planned2,
        rodeWith: [],
        completedOn: '2025-01-13',
        userTz: 'America/New_York',
      });

      setCaller(organizer);
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/summary`,
      });

      expect(res.statusCode).toBe(200);
      const summary = res.json<TripSummaryDTO>();
      // total = every Planned_Item; completed = the two whose Experience matches
      // a Trip_Log_Entry, the third stays not-done (R5.1, R5.2, R5.6).
      expect(summary.plannedTotalCount).toBe(3);
      expect(summary.plannedCompletedCount).toBe(2);
    });

    it('GET /summary counts a Planned_Item at most once despite several log entries for its Experience (R5.5)', async () => {
      const organizer = await insertUser(testPool, 'Organizer O');
      const member = await insertUser(testPool, 'Member M');
      await befriend(testPool, organizer, member);
      const experience = await insertExperience(testPool, 'Pirates of the Caribbean');

      const trip = await repo.createTrip(organizer, {
        name: 'WDW 2025',
        description: '',
        startDate: '2025-01-10',
        endDate: '2025-01-15',
      });

      // A single Planned_Item on the list.
      await repo.addPlannedItem(trip.id, organizer, { experienceId: experience });

      // The member joins (Friend → invite → accept) so a second, distinct
      // Trip_Log_Entry can reference the same Experience.
      const invite = await repo.sendInvite(trip.id, organizer, member);
      await repo.acceptInvite(invite.inviteId, member);

      // Two Trip_Log_Entries (one per Member) for the SAME Experience.
      await repo.logCompletion(trip.id, organizer, {
        experienceId: experience,
        rodeWith: [],
        completedOn: '2025-01-12',
        userTz: 'America/New_York',
      });
      await repo.logCompletion(trip.id, member, {
        experienceId: experience,
        rodeWith: [],
        completedOn: '2025-01-13',
        userTz: 'America/New_York',
      });

      // Sanity: two log entries really exist for the one Experience.
      const logCount = await testPool.query<{ count: string }>(
        `SELECT count(*) AS count FROM trip_log_entries
          WHERE trip_id = $1 AND experience_id = $2`,
        [trip.id, experience],
      );
      expect(Number(logCount.rows[0]!.count)).toBe(2);

      setCaller(organizer);
      const res = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/summary`,
      });

      expect(res.statusCode).toBe(200);
      const summary = res.json<TripSummaryDTO>();
      // The single Planned_Item is counted once, not twice (R5.5), and the
      // completed count never exceeds the total (R5.6).
      expect(summary.plannedTotalCount).toBe(1);
      expect(summary.plannedCompletedCount).toBe(1);
    });

    // -----------------------------------------------------------------------
    // Facet 2 — member-gated, non-disclosing authorization (R5.7, R7.2)
    // -----------------------------------------------------------------------

    it('a non-member and a non-existent Trip collapse to an identical trip_forbidden on /summary, /planned-items, and /feed (R5.7, R7.2)', async () => {
      const organizer = await insertUser(testPool, 'Organizer O');
      const outsider = await insertUser(testPool, 'Outsider X');
      const experience = await insertExperience(testPool, 'Jungle Cruise');

      const trip = await repo.createTrip(organizer, {
        name: 'WDW 2025',
        description: '',
        startDate: '2025-01-10',
        endDate: '2025-01-15',
      });
      await repo.addPlannedItem(trip.id, organizer, { experienceId: experience });

      const nonExistentTripId = randomUUID();

      for (const suffix of ['summary', 'planned-items', 'feed'] as const) {
        // Non-member of a Trip that DOES exist.
        setCaller(outsider);
        const nonMemberRes = await app.inject({
          method: 'GET',
          url: `/trips/${trip.id}/${suffix}`,
        });

        // A Trip that does NOT exist (same authenticated caller).
        const absentRes = await app.inject({
          method: 'GET',
          url: `/trips/${nonExistentTripId}/${suffix}`,
        });

        // Both are denied 403 trip_forbidden and are byte-for-byte identical, so
        // existence cannot be probed and no planned/list/feed data leaks (R7.2).
        expect(nonMemberRes.statusCode).toBe(403);
        expect(absentRes.statusCode).toBe(403);
        expect(nonMemberRes.json()).toMatchObject({
          error: { code: 'trip_forbidden' },
        });
        expect(nonMemberRes.json()).toEqual(absentRes.json());
      }
    });

    it('a Trip_Member is authorized and receives that Trip data on /summary, /planned-items, and /feed (R7.1)', async () => {
      const organizer = await insertUser(testPool, 'Organizer O');
      const experience = await insertExperience(testPool, 'Test Track');

      const trip = await repo.createTrip(organizer, {
        name: 'WDW 2025',
        description: '',
        startDate: '2025-01-10',
        endDate: '2025-01-15',
      });
      await repo.addPlannedItem(trip.id, organizer, { experienceId: experience });
      await repo.logCompletion(trip.id, organizer, {
        experienceId: experience,
        rodeWith: [],
        rating: 9,
        completedOn: '2025-01-12',
        userTz: 'America/New_York',
      });

      setCaller(organizer);

      const summaryRes = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/summary`,
      });
      expect(summaryRes.statusCode).toBe(200);
      const summary = summaryRes.json<TripSummaryDTO>();
      expect(summary.plannedTotalCount).toBe(1);
      expect(summary.plannedCompletedCount).toBe(1);

      const plannedRes = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/planned-items`,
      });
      expect(plannedRes.statusCode).toBe(200);
      const planned = plannedRes.json<Array<{ experienceId: string }>>();
      expect(planned).toHaveLength(1);
      expect(planned[0]!.experienceId).toBe(experience);

      const feedRes = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/feed`,
      });
      expect(feedRes.statusCode).toBe(200);
      expect(Array.isArray(feedRes.json())).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Facet 3 — canonical Rating read live, referenced never copied (R6.5, R6.7)
    // -----------------------------------------------------------------------

    it('GET /feed reads the canonical Rating live so a later change to the ratings row is reflected (R6.5)', async () => {
      const organizer = await insertUser(testPool, 'Organizer O');
      const experience = await insertExperience(testPool, 'Space Mountain');

      const trip = await repo.createTrip(organizer, {
        name: 'WDW 2025',
        description: '',
        startDate: '2025-01-10',
        endDate: '2025-01-15',
      });
      await repo.addPlannedItem(trip.id, organizer, { experienceId: experience });

      // Log a completion from the planned Experience WITH a canonical Rating.
      await repo.logCompletion(trip.id, organizer, {
        experienceId: experience,
        rodeWith: [],
        rating: 7,
        completedOn: '2025-01-12',
        userTz: 'America/New_York',
      });
      expect(await readRatingValue(testPool, organizer, experience)).toBe(7);

      setCaller(organizer);

      const firstFeed = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/feed`,
      });
      expect(firstFeed.statusCode).toBe(200);
      const completion1 = firstFeed
        .json<TripFeedItemDTO[]>()
        .find((item) => item.type === 'completion_logged');
      expect(completion1).toBeDefined();
      expect(completion1!.metadata.experienceId).toBe(experience);
      expect(completion1!.metadata.rating).toBe(7);

      // Change the SINGLE canonical Rating row directly — no Trip data touched.
      await testPool.query(
        `UPDATE ratings SET value = $1 WHERE user_id = $2 AND experience_id = $3`,
        [3, organizer, experience],
      );

      // The next read reflects the new canonical value: the feed references the
      // live Rating, it never stored a Trip-local copy at log time (R6.5).
      const secondFeed = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/feed`,
      });
      const completion2 = secondFeed
        .json<TripFeedItemDTO[]>()
        .find((item) => item.type === 'completion_logged');
      expect(completion2!.metadata.rating).toBe(3);
    });

    it('GET /feed surfaces no Rating value for a completion with no canonical Rating (absent/unavailable indication, R6.7)', async () => {
      const organizer = await insertUser(testPool, 'Organizer O');
      const experience = await insertExperience(testPool, 'Haunted Mansion');

      const trip = await repo.createTrip(organizer, {
        name: 'WDW 2025',
        description: '',
        startDate: '2025-01-10',
        endDate: '2025-01-15',
      });
      await repo.addPlannedItem(trip.id, organizer, { experienceId: experience });

      // Log a completion from the planned Experience WITHOUT a Rating.
      await repo.logCompletion(trip.id, organizer, {
        experienceId: experience,
        rodeWith: [],
        completedOn: '2025-01-12',
        userTz: 'America/New_York',
      });
      // No canonical Rating row exists for this (Member, Experience).
      expect(await readRatingValue(testPool, organizer, experience)).toBeNull();

      setCaller(organizer);
      const feed = await app.inject({
        method: 'GET',
        url: `/trips/${trip.id}/feed`,
      });
      expect(feed.statusCode).toBe(200);
      const completion = feed
        .json<TripFeedItemDTO[]>()
        .find((item) => item.type === 'completion_logged');
      expect(completion).toBeDefined();
      // No Rating value and no placeholder is surfaced — the client renders the
      // unrated / "rating unavailable" indication from this absence (R6.6, R6.7).
      expect(completion!.metadata.rating).toBeUndefined();
    });
  },
);
