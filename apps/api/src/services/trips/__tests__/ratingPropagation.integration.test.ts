// Feature: trips, Task 15.3: a Rating recorded through a Trip emits
// `RatingChanged` and is reflected by the canonical Rating + Aggregate exactly
// as a direct (non-Trip) rating would be, and a Trip-logged Completion produces
// the same canonical `completions` row as a non-Trip one.
/**
 * Cross-service integration test for canonical Rating propagation through a
 * Trip (task 15.3).
 *
 * Validates: Requirements 12.3, 12.6
 *
 * Unlike the Property tests in this folder (which drive the repo through a fake
 * in-memory `pg.Pool` that models only the `trip_*` tables the operation under
 * test touches), this test exercises the REAL `createTripRepo` — wired to the
 * REAL Tracking `createCompletionRepo` / `createRatingRepo` and the REAL
 * `createAggregateRepo` — end-to-end against a real Postgres-style engine
 * (`pg-mem`, the same in-memory Postgres the smoke harness and the other
 * integration tests use; see `test/smoke/harness.ts`,
 * `catalog/__tests__/repo.apply.integration.test.ts`,
 * `tracking/friendCompletions/__tests__/completions.integration.test.ts`, and
 * the sibling `cascadeDelete.integration.test.ts`).
 *
 * Migrations `0001_init.sql` (base tables: users, profiles, experiences,
 * completions, ratings, aggregate_ratings) and `0015_trips.sql` (the nine Trip
 * tables) are applied to a fresh pg-mem database so the production DDL runs
 * verbatim against actual tables. `0015_trips.sql` references only `users(id)`
 * and `experiences(id)` from `0001_init.sql`, so the intervening
 * catalog/social migrations are not needed here.
 *
 * The wiring mirrors `composeServices.ts` exactly: `emitRatingChanged` both
 * records every event AND drives `aggregateRepo.updateAggregate(...)` in
 * process, so the single canonical `RatingChanged` propagation path is reused
 * unchanged whether the Rating is written directly or through a Trip.
 *
 * Scenarios:
 *   1. A Rating recorded THROUGH a Trip via `repo.logCompletion(...)` emits
 *      exactly one `RatingChanged{ experienceId, oldValue, newValue }`, and
 *      that value is reflected by the single canonical `ratings` row and by the
 *      `aggregate_ratings` row (R12.3).
 *   2. The event a Trip-path Rating emits is structurally identical to the one
 *      a direct (non-Trip) `ratingRepo.setRating(...)` emits, and both drive the
 *      Aggregate identically — proving the Trip path routes through the single
 *      canonical Rating and reuses the propagation path unchanged (R12.3).
 *   3. A Rating recorded through the trickle-down `repo.confirmRodeWithTag(...)`
 *      path likewise emits `RatingChanged` and is reflected by the canonical
 *      Rating + Aggregate (R12.3).
 *   4. A Trip-logged Completion produces the same canonical `completions` row
 *      (same columns, same values) as a direct `completionRepo.mark(...)` — a
 *      Trip completion counts exactly the same as a non-Trip one (R12.6).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { createAggregateRepo, type AggregateRepo } from '../../aggregate/repo.js';
import { createCompletionRepo, type CompletionRepo } from '../../tracking/completion/repo.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
  type RatingRepo,
} from '../../tracking/rating/repo.js';
import { createTripRepo, type TripRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup (mirrors test/smoke/harness.ts + the other integration tests)
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

  // The Aggregate_Ratings_Service's `updateAggregate` serializes concurrent
  // updates for an Experience with `pg_advisory_xact_lock(hashtext(id)::bigint)`.
  // pg-mem ships neither function, so register faithful shims: `hashtext` is a
  // deterministic 32-bit string hash and `pg_advisory_xact_lock` is a no-op
  // (advisory locking is a concurrency concern, transparent for this
  // single-threaded test — the repo always reads the latest row before writing).
  pub.registerFunction({
    name: 'hashtext',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => {
      const str = typeof s === 'string' ? s : '';
      let h = 0;
      for (let i = 0; i < str.length; i += 1) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
      }
      return h;
    },
  });
  pub.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (): boolean => true,
    impure: true,
  });

  return db;
}

/** Absolute path to a migration file relative to this test. */
function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // __tests__ → trips → services → src → apps/api
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

/** Apply migration 0001, stripping the GIN trigram indexes pg-mem can't model. */
function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/** Apply a later migration verbatim (no GIN indexes in 0015). */
function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

/**
 * pg-mem does not model row-level `FOR UPDATE` locking (real Postgres does);
 * several Trip / Tracking / Aggregate repo statements append a `FOR UPDATE` (or
 * `FOR UPDATE OF <alias>`) clause purely for concurrency safety. Stripping the
 * clause is semantically transparent for this single-threaded test — the
 * check-then-write ordering the repos rely on is preserved — and lets the
 * production SQL (BEGIN/COMMIT transactions, JSONB inserts, the ON CONFLICT
 * upserts) run verbatim. Harness-only shim, matching the sibling
 * `cascadeDelete.integration.test.ts`.
 */
function stripForUpdate(text: string): string {
  return text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
}

/** Wrap a pg-mem pool so `FOR UPDATE` clauses are stripped on every query. */
function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return raw.query(stripForUpdate(text), params);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(stripForUpdate(text), params);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
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

/** Read the raw canonical Completion row for a `(user, experience)` pair. */
async function readCompletionRow(
  pool: DbPool,
  userId: string,
  experienceId: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await pool.query<Record<string, unknown>>(
    `SELECT user_id, experience_id, completed_on, user_tz
       FROM completions WHERE user_id = $1 AND experience_id = $2`,
    [userId, experienceId],
  );
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface Fixture {
  db: IMemoryDb;
  /** Raw pg-mem pool for direct seed/read SQL. */
  rawPool: DbPool;
  repo: TripRepo;
  completionRepo: CompletionRepo;
  ratingRepo: RatingRepo;
  aggregateRepo: AggregateRepo;
  /** RatingChanged events emitted by the injected rating repo, in order. */
  ratingEvents: RatingChangedEvent[];
}

async function setup(): Promise<Fixture> {
  const db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool() as unknown as DbPool;

  applyInitMigration(db);
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0019_planned_item_scheduling.sql');
  applyMigration(db, '0022_planned_item_ride_options.sql');
  applyMigration(db, '0023_trip_touring_hours.sql');

  // The repos all run against the same pool, wrapped so `FOR UPDATE` clauses
  // are stripped for pg-mem.
  const pool = withForUpdateCompat(rawPool);

  const ratingEvents: RatingChangedEvent[] = [];
  const completionRepo = createCompletionRepo(pool);
  const aggregateRepo = createAggregateRepo(pool);

  // Mirror composeServices.ts exactly: the SINGLE `emitRatingChanged` both
  // records the event and drives the in-process aggregate update. The rating
  // repo emits this on every successful set/delete, so the Trip path and the
  // direct path share the very same propagation.
  const ratingRepo = createRatingRepo({
    pool,
    emitRatingChanged: async (event) => {
      ratingEvents.push(event);
      await aggregateRepo.updateAggregate(
        event.experienceId,
        event.oldValue,
        event.newValue,
      );
    },
  });

  // The REAL Trip repo wired to the REAL canonical Tracking repos — exactly the
  // wiring composeServices.ts builds in production.
  const repo = createTripRepo(pool, {
    completions: completionRepo,
    ratings: ratingRepo,
  });

  return {
    db,
    rawPool,
    repo,
    completionRepo,
    ratingRepo,
    aggregateRepo,
    ratingEvents,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Trip canonical Rating propagation (integration, pg-mem)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(async () => {
    await (fx.rawPool as unknown as { end?: () => Promise<void> }).end?.();
  });

  it('a Rating logged through a Trip emits RatingChanged and is reflected by the canonical Rating and Aggregate (R12.3)', async () => {
    const { rawPool, repo, aggregateRepo, ratingEvents } = fx;

    const user = await insertUser(rawPool, 'Rider R');
    const experience = await insertExperience(rawPool, 'Space Mountain');
    const trip = await repo.createTrip(user, {
      name: 'WDW 2025',
      description: '',
      startDate: '2025-01-10',
      endDate: '2025-01-15',
    });

    // No Rating has been recorded yet.
    expect(ratingEvents).toHaveLength(0);
    expect(await aggregateRepo.getAggregate(experience)).toBeNull();

    // Record a Rating THROUGH the Trip.
    await repo.logCompletion(trip.id, user, {
      experienceId: experience,
      rodeWith: [],
      rating: 7,
      completedOn: '2025-01-12',
      userTz: 'America/New_York',
    });

    // Exactly one RatingChanged fired, with the canonical shape.
    expect(ratingEvents).toHaveLength(1);
    expect(ratingEvents[0]).toEqual({
      experienceId: experience,
      oldValue: null,
      newValue: 7,
    });

    // The single canonical `ratings` row holds exactly that value.
    expect(await readRatingValue(rawPool, user, experience)).toBe(7);

    // The Aggregate reflects it (sum/count advanced by the propagation path).
    const agg = await aggregateRepo.getAggregate(experience);
    expect(agg?.sum).toBe(7);
    expect(agg?.count).toBe(1);

    // ...and the logging Member's canonical Completion exists.
    expect(await readCompletionRow(rawPool, user, experience)).toBeDefined();
  });

  it('a Trip-path Rating emits the same event and drives the Aggregate identically to a direct (non-Trip) setRating (R12.3)', async () => {
    const { rawPool, repo, ratingRepo, aggregateRepo, ratingEvents } = fx;

    // Trip path: user A rates experience X through a Trip.
    const userA = await insertUser(rawPool, 'Trip Rider');
    const expX = await insertExperience(rawPool, 'Big Thunder Mountain');
    const trip = await repo.createTrip(userA, {
      name: 'WDW 2025',
      description: '',
      startDate: '2025-01-10',
      endDate: '2025-01-15',
    });

    // Direct path: user B rates experience Y with no Trip involved.
    const userB = await insertUser(rawPool, 'Direct Rater');
    const expY = await insertExperience(rawPool, 'Test Track');

    await repo.logCompletion(trip.id, userA, {
      experienceId: expX,
      rodeWith: [],
      rating: 9,
      completedOn: '2025-01-12',
      userTz: 'America/New_York',
    });
    const tripEvent = ratingEvents.at(-1)!;

    await ratingRepo.setRating(userB, expY, 9);
    const directEvent = ratingEvents.at(-1)!;

    // Same event structure and same old/new transition; only the target
    // Experience differs. Normalizing away `experienceId` makes them equal —
    // the Trip path reuses the canonical propagation path unchanged.
    expect(Object.keys(tripEvent).sort()).toEqual(
      Object.keys(directEvent).sort(),
    );
    const { experienceId: _tx, ...tripRest } = tripEvent;
    const { experienceId: _dx, ...directRest } = directEvent;
    expect(tripRest).toEqual(directRest);
    expect(tripRest).toEqual({ oldValue: null, newValue: 9 });

    // Both Experiences ended up with an identical Aggregate state (modulo id).
    const aggX = await aggregateRepo.getAggregate(expX);
    const aggY = await aggregateRepo.getAggregate(expY);
    expect(aggX?.sum).toBe(aggY?.sum);
    expect(aggX?.count).toBe(aggY?.count);
    expect(aggX?.meanX10).toBe(aggY?.meanX10);
    expect(aggX?.sum).toBe(9);
    expect(aggX?.count).toBe(1);

    // And the canonical single-row Rating matches on both paths.
    expect(await readRatingValue(rawPool, userA, expX)).toBe(9);
    expect(await readRatingValue(rawPool, userB, expY)).toBe(9);
  });

  it('a Rating recorded through confirmRodeWithTag emits RatingChanged and is reflected by the canonical Rating and Aggregate (R12.3)', async () => {
    const { rawPool, repo, aggregateRepo, ratingEvents } = fx;

    const organizer = await insertUser(rawPool, 'Organizer O');
    const member = await insertUser(rawPool, 'Member M');
    await befriend(rawPool, organizer, member);
    const experience = await insertExperience(rawPool, 'Haunted Mansion');

    const trip = await repo.createTrip(organizer, {
      name: 'WDW 2025',
      description: '',
      startDate: '2025-01-10',
      endDate: '2025-01-15',
    });
    const invite = await repo.sendInvite(trip.id, organizer, member);
    await repo.acceptInvite(invite.inviteId, member);

    // The organizer logs a Completion tagging the member, but records NO Rating,
    // so the only RatingChanged in this test comes from the member's confirm.
    const logged = await repo.logCompletion(trip.id, organizer, {
      experienceId: experience,
      rodeWith: [member],
      completedOn: '2025-01-12',
      userTz: 'America/New_York',
    });
    expect(logged.pendingTags).toHaveLength(1);
    expect(ratingEvents).toHaveLength(0);
    const tagId = logged.pendingTags[0]!.tagId;

    // The tagged member confirms WITH a Rating — trickle-down through the same
    // canonical Rating repo.
    await repo.confirmRodeWithTag(tagId, member, 6);

    // Exactly one RatingChanged fired for the member's canonical Rating.
    expect(ratingEvents).toHaveLength(1);
    expect(ratingEvents[0]).toEqual({
      experienceId: experience,
      oldValue: null,
      newValue: 6,
    });

    // Reflected by the single canonical `ratings` row and the Aggregate.
    expect(await readRatingValue(rawPool, member, experience)).toBe(6);
    const agg = await aggregateRepo.getAggregate(experience);
    expect(agg?.sum).toBe(6);
    expect(agg?.count).toBe(1);
  });

  it('a Trip-logged Completion produces the same canonical completions row as a direct (non-Trip) completion (R12.6)', async () => {
    const { rawPool, repo, completionRepo } = fx;

    // Trip path: user A completes experience X through a Trip.
    const userA = await insertUser(rawPool, 'Trip Completer');
    const expX = await insertExperience(rawPool, 'Pirates of the Caribbean');
    const trip = await repo.createTrip(userA, {
      name: 'WDW 2025',
      description: '',
      startDate: '2025-01-10',
      endDate: '2025-01-15',
    });

    // Direct path: user B completes experience Y with no Trip involved.
    const userB = await insertUser(rawPool, 'Direct Completer');
    const expY = await insertExperience(rawPool, 'Jungle Cruise');

    const completedOn = '2025-01-12';
    const userTz = 'America/New_York';

    await repo.logCompletion(trip.id, userA, {
      experienceId: expX,
      rodeWith: [],
      completedOn,
      userTz,
    });
    await completionRepo.mark({
      userId: userB,
      experienceId: expY,
      completedOn,
      userTz,
    });

    const tripRow = await readCompletionRow(rawPool, userA, expX);
    const directRow = await readCompletionRow(rawPool, userB, expY);
    expect(tripRow).toBeDefined();
    expect(directRow).toBeDefined();

    // Both rows carry exactly the same columns...
    expect(Object.keys(tripRow!).sort()).toEqual(
      Object.keys(directRow!).sort(),
    );

    // ...and the Trip completion is byte-for-byte the same canonical Completion
    // as the direct one once the (user, experience) identity is normalized: a
    // Trip completion counts exactly the same as a non-Trip one (R12.6).
    const normalize = (
      row: Record<string, unknown>,
    ): Record<string, unknown> => {
      const { user_id: _u, experience_id: _e, ...rest } = row;
      return rest;
    };
    expect(normalize(tripRow!)).toEqual(normalize(directRow!));
    expect(String(normalize(tripRow!).user_tz ?? userTz)).toBe(userTz);
  });
});
