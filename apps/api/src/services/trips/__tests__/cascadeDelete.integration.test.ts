// Feature: trips, Task 15.1: cascade delete removes every Trip child row while
// canonical Tracking data (completions / ratings / notes) survives.
/**
 * Cross-service integration test for Trip cascade delete with canonical
 * Tracking survival (task 15.1).
 *
 * Validates: Requirements 3.7, 3.10
 *
 * Unlike the Property tests in this folder (which drive the repo through a
 * fake in-memory `pg.Pool` that models only the `trip_*` tables the operation
 * under test touches), this test exercises the REAL `createTripRepo` — wired to
 * the REAL Tracking `createCompletionRepo` / `createRatingRepo` for the
 * canonical writes — end-to-end against a real Postgres-style engine (`pg-mem`,
 * the same in-memory Postgres the smoke harness and the other integration tests
 * use; see `test/smoke/harness.ts`,
 * `catalog/__tests__/repo.apply.integration.test.ts`, and
 * `tracking/friendCompletions/__tests__/completions.integration.test.ts`).
 *
 * Migrations `0001_init.sql` (base tables: users, profiles, experiences,
 * completions, ratings, notes, friendships) and `0015_trips.sql` (the nine
 * Trip tables with their `ON DELETE CASCADE` foreign keys) are applied to a
 * fresh pg-mem database so the production DDL — including the cascade FKs that
 * `deleteTrip` relies on — runs verbatim against actual tables. Only these two
 * migrations are applied because `0015_trips.sql` references only `users(id)`
 * and `experiences(id)`, both created by `0001_init.sql`; the intervening
 * catalog/social migrations are not needed for the tables this test touches.
 *
 * Scenario:
 *
 *   A Trip is seeded through the real repo so every child table holds real
 *   rows: two Members (an organizer + a member joined via a real invite →
 *   accept), a Planned_Item, a logged Completion (which writes the logging
 *   Member's canonical Completion + Rating through the injected Tracking repos
 *   and creates a Trip_Log_Entry, a pending Rode_With_Tag, and a
 *   `completion_logged` feed item), a confirmed Rode_With_Tag (which trickles
 *   the tagged Member's canonical Completion + Rating down and writes no feed
 *   item), plus a Trip_Reaction and a Trip_Comment on a feed item. Canonical
 *   Notes are seeded directly for both Members.
 *
 *   The test first asserts every Trip child table and every canonical table
 *   holds the expected rows. Then it calls the REAL `repo.deleteTrip(tripId)`
 *   and asserts:
 *     - the Trip and every child row (memberships, invites, planned_items,
 *       trip_log_entries, rode_with_tags, trip_feed_items, trip_reactions,
 *       trip_comments) are gone — count 0 (R3.7), and
 *     - the canonical `completions` / `ratings` / `notes` rows SURVIVE
 *       untouched, proving the cascade never reaches Tracking data (R3.10).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { createCompletionRepo } from '../../tracking/completion/repo.js';
import {
  createRatingRepo,
  type RatingChangedEvent,
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
 * several Trip and Tracking repo statements append a `FOR UPDATE` (or
 * `FOR UPDATE OF <alias>`) clause purely for concurrency safety. Stripping the
 * clause is semantically transparent for this single-threaded test — the
 * check-then-write ordering the repo relies on is preserved — and lets the
 * production SQL (BEGIN/COMMIT transactions, JSONB inserts, the cascade DELETE)
 * run verbatim. This is a harness-only shim, analogous to the `= ANY($n)` shim
 * in `catalog/__tests__/documentStore.durability.integration.test.ts`.
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

async function seedNote(
  pool: DbPool,
  userId: string,
  experienceId: string,
  body: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO notes (user_id, experience_id, body) VALUES ($1, $2, $3)`,
    [userId, experienceId, body],
  );
}

/** Count all rows in a table (single-Trip scenario, so no filter needed). */
async function countRows(pool: DbPool, table: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT count(*) AS count FROM ${table}`,
  );
  return Number(res.rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface Fixture {
  db: IMemoryDb;
  /** Raw pg-mem pool for direct seed/read SQL. */
  rawPool: DbPool;
  repo: TripRepo;
  /** RatingChanged events emitted by the injected rating repo. */
  ratingEvents: RatingChangedEvent[];
}

async function setup(): Promise<Fixture> {
  const db = buildPgMemDatabase();
  const { Pool } = db.adapters.createPg();
  const rawPool = new Pool() as unknown as DbPool;

  applyInitMigration(db);
  db.public.none("ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';");
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0019_planned_item_scheduling.sql');
  applyMigration(db, '0022_planned_item_ride_options.sql');
  applyMigration(db, '0023_trip_touring_hours.sql');
  applyMigration(db, '0024_planned_item_optimization_result.sql');
  applyMigration(db, '0027_planned_items_soft_windows.sql');
  applyMigration(db, '0028_planned_items_meal_period_snack.sql');

  // The repo and the canonical Tracking repos all run against the same pool,
  // wrapped so `FOR UPDATE` clauses are stripped for pg-mem.
  const pool = withForUpdateCompat(rawPool);

  const ratingEvents: RatingChangedEvent[] = [];
  const completionRepo = createCompletionRepo(pool);
  const ratingRepo = createRatingRepo({
    pool,
    emitRatingChanged: async (event) => {
      ratingEvents.push(event);
    },
  });

  // The REAL Trip repo wired to the REAL canonical Tracking repos — exactly the
  // wiring composeServices.ts builds in production.
  const repo = createTripRepo(pool, {
    completions: completionRepo,
    ratings: ratingRepo,
  });

  return { db, rawPool, repo, ratingEvents };
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Trip cascade delete with canonical Tracking survival (integration, pg-mem)', () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await setup();
  });

  afterEach(async () => {
    await (fx.rawPool as unknown as { end?: () => Promise<void> }).end?.();
  });

  it('deleting a Trip removes every child row while completions/ratings/notes survive (R3.7, R3.10)', async () => {
    const { rawPool, repo } = fx;

    // --- Seed a fully-populated Trip through the REAL repo ------------------
    const organizer = await insertUser(rawPool, 'Organizer O');
    const member = await insertUser(rawPool, 'Member M');
    await befriend(rawPool, organizer, member);

    const experience = await insertExperience(rawPool, 'Space Mountain');

    // Create the Trip (organizer membership + trip_created feed item).
    const trip = await repo.createTrip(organizer, {
      name: 'WDW 2025',
      description: 'A trip',
      startDate: '2025-01-10',
      endDate: '2025-01-15',
    });

    // Invite + accept so `member` joins as a real member (invite row +
    // member_joined feed item).
    const invite = await repo.sendInvite(trip.id, organizer, member);
    await repo.acceptInvite(invite.inviteId, member);

    // A Planned_Item on the shared list.
    await repo.addPlannedItem(trip.id, organizer, {
      experienceId: experience,
    });

    // Log a Completion for the organizer, tagging `member` — writes the
    // organizer's canonical Completion + Rating (via the injected Tracking
    // repos), a Trip_Log_Entry, a pending Rode_With_Tag, and a feed item.
    const logged = await repo.logCompletion(trip.id, organizer, {
      experienceId: experience,
      rodeWith: [member],
      rating: 8,
    });
    expect(logged.pendingTags).toHaveLength(1);
    const tagId = logged.pendingTags[0]!.tagId;

    // The tagged Member confirms — trickles their canonical Completion +
    // Rating down. The confirm writes no feed item (R11.10).
    await repo.confirmRodeWithTag(tagId, member, 7);

    // A reaction + a comment on the trip_created feed item.
    const feedRes = await rawPool.query<{ id: string }>(
      `SELECT id FROM trip_feed_items WHERE trip_id = $1 AND type = 'trip_created'`,
      [trip.id],
    );
    const feedItemId = feedRes.rows[0]!.id;
    await repo.addReaction(trip.id, 'feed_item', feedItemId, member, 'like');
    await repo.addComment(trip.id, 'feed_item', feedItemId, member, 'So excited!');

    // Canonical Notes for both Members (seeded directly — Trips never write Notes).
    await seedNote(rawPool, organizer, experience, 'organizer note');
    await seedNote(rawPool, member, experience, 'member note');

    // --- Pre-delete: every child table and canonical table holds rows -------
    expect(await countRows(rawPool, 'trips')).toBe(1);
    expect(await countRows(rawPool, 'trip_memberships')).toBe(2);
    expect(await countRows(rawPool, 'trip_invites')).toBe(1);
    expect(await countRows(rawPool, 'planned_items')).toBe(1);
    expect(await countRows(rawPool, 'trip_log_entries')).toBe(1);
    expect(await countRows(rawPool, 'rode_with_tags')).toBe(1);
    // trip_created + member_joined + completion_logged (confirm writes none).
    expect(await countRows(rawPool, 'trip_feed_items')).toBe(3);
    expect(await countRows(rawPool, 'trip_reactions')).toBe(1);
    expect(await countRows(rawPool, 'trip_comments')).toBe(1);

    // Canonical rows: organizer + member each have a Completion, a Rating, and
    // a Note.
    expect(await countRows(rawPool, 'completions')).toBe(2);
    expect(await countRows(rawPool, 'ratings')).toBe(2);
    expect(await countRows(rawPool, 'notes')).toBe(2);

    // Snapshot the canonical rows so we can prove they are byte-for-byte
    // unchanged after the delete.
    const canonicalBefore = await snapshotCanonical(rawPool);

    // --- Delete the Trip through the REAL repo ------------------------------
    const deleted = await repo.deleteTrip(trip.id);
    expect(deleted).toBe(true);

    // --- Post-delete: every Trip child row is gone (R3.7) -------------------
    expect(await repo.getTripForMember(trip.id)).toBeNull();
    expect(await countRows(rawPool, 'trips')).toBe(0);
    expect(await countRows(rawPool, 'trip_memberships')).toBe(0);
    expect(await countRows(rawPool, 'trip_invites')).toBe(0);
    expect(await countRows(rawPool, 'planned_items')).toBe(0);
    expect(await countRows(rawPool, 'trip_log_entries')).toBe(0);
    expect(await countRows(rawPool, 'rode_with_tags')).toBe(0);
    expect(await countRows(rawPool, 'trip_feed_items')).toBe(0);
    expect(await countRows(rawPool, 'trip_reactions')).toBe(0);
    expect(await countRows(rawPool, 'trip_comments')).toBe(0);

    // --- Post-delete: canonical Tracking data SURVIVES untouched (R3.10) ----
    expect(await countRows(rawPool, 'completions')).toBe(2);
    expect(await countRows(rawPool, 'ratings')).toBe(2);
    expect(await countRows(rawPool, 'notes')).toBe(2);

    const canonicalAfter = await snapshotCanonical(rawPool);
    expect(canonicalAfter).toEqual(canonicalBefore);

    // The Members themselves (and their profiles) are also untouched — the
    // cascade is confined to the Trip's own children.
    expect(await countRows(rawPool, 'users')).toBe(2);
    expect(await countRows(rawPool, 'profiles')).toBe(2);
  });
});

/**
 * Materialize the canonical Completion / Rating / Note rows into a stable,
 * deterministically ordered JSON string so two snapshots compared for equality
 * prove the canonical Tracking data is unchanged down to the byte.
 */
async function snapshotCanonical(pool: DbPool): Promise<string> {
  const completions = await pool.query(
    `SELECT user_id, experience_id, completed_on, user_tz
       FROM completions ORDER BY user_id, experience_id`,
  );
  const ratings = await pool.query(
    `SELECT user_id, experience_id, value
       FROM ratings ORDER BY user_id, experience_id`,
  );
  const notes = await pool.query(
    `SELECT user_id, experience_id, body
       FROM notes ORDER BY user_id, experience_id`,
  );
  return JSON.stringify({
    completions: completions.rows,
    ratings: ratings.rows,
    notes: notes.rows,
  });
}
