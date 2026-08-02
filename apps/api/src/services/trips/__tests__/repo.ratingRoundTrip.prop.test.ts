// Feature: trips, Property 22: Ratings recorded through a Trip round-trip to the single canonical Rating
/**
 * Property-based test for the canonical Rating round-trip through a Trip's
 * `logCompletion` (task 9.4).
 *
 * **Validates: Requirements 10.10, 12.1, 12.2**
 *
 * Design Property 22 (design.md → Correctness Properties):
 *
 *   For any Trip_Member and Experience, recording or updating a whole-number
 *   1–10 Rating through a Trip persists exactly that value as the Member's
 *   single canonical Rating in the Tracking_Service, so a subsequent read
 *   returns the same value from one canonical row, and no Trip-local copy of
 *   the Rating is stored.
 *
 * Test strategy
 * -------------
 * Per the tasks.md convention this stateful property runs against an in-memory
 * model of the repo rather than a live database. A tiny fake `pg.Pool` drives
 * the *real* `createTripRepo` factory (the production `logCompletion`
 * transaction), backed by a store that models exactly the Trip tables
 * `logCompletion` writes — `trip_memberships` (seeded, read-only),
 * `trip_log_entries`, `rode_with_tags`, and `trip_feed_items`.
 *
 * The canonical Rating write is delegated to an injected fake `RatingRepo`
 * whose `setRating(userId, experienceId, value)` records into an in-memory
 * *canonical ratings map* keyed by `(userId, experienceId)` — a single value
 * per key, exactly like the one canonical `ratings` row. That map is the
 * single source of truth the property reads back through `getRating`, so it
 * proves the round-trip: what was written through the Trip is exactly what the
 * canonical repo returns.
 *
 * The property asserts, after every command:
 *   - when a Rating was supplied, `setRating` was invoked with exactly
 *     `(loggerId, experienceId, rating)` and the canonical map holds that
 *     single value (R10.10, R12.1, R12.2);
 *   - when no Rating was supplied, `setRating` was not invoked and the
 *     canonical value for `(logger, experience)` is unchanged (R12.1);
 *   - repeated logs with new Ratings overwrite the single canonical value —
 *     the map never accumulates a second value for a key (R12.2);
 *   - no Trip-local copy of the Rating exists: the `trip_log_entries` rows the
 *     fake store captures carry no rating field, so the only Rating anywhere is
 *     the one canonical map entry (R12.1).
 *
 * `numRuns: 200` (≥100 per the spec convention).
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import type { CompletionRepo } from '../../tracking/completion/repo.js';
import type { RatingRepo } from '../../tracking/rating/repo.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 200;
const MAX_COMMANDS = 30;

/** The fixed Trip every log entry in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The current Trip_Members; any may be the logging Member. */
const MEMBER_IDS = [
  '00000000-0000-4000-8000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
] as const;

/** A small pool of Experiences so repeated logs can target the same key. */
const EXPERIENCE_IDS = [
  'e0000000-0000-4000-8000-000000000000',
  'e1111111-1111-4111-8111-111111111111',
] as const;

// ---------------------------------------------------------------------------
// In-memory model of the Trip tables logCompletion writes
// ---------------------------------------------------------------------------

interface LogEntryRow {
  readonly id: string;
  readonly tripId: string;
  readonly memberId: string;
  readonly experienceId: string;
}

interface FeedRow {
  readonly tripId: string;
  readonly type: string;
  readonly actorId: string;
}

/**
 * The whole backing store. `memberIds` is a read-only membership set seeded at
 * setup; the mutable tables are snapshotted per transaction so a `ROLLBACK`
 * faithfully discards partial writes. Crucially, {@link LogEntryRow} has no
 * rating field — there is nowhere in the Trip tables to store a Rating, which
 * is the structural half of "no Trip-local copy" (R12.1).
 */
interface Store {
  readonly memberIds: ReadonlySet<string>;
  logEntries: LogEntryRow[];
  feedItems: FeedRow[];
}

function makeStore(): Store {
  return {
    memberIds: new Set(MEMBER_IDS),
    logEntries: [],
    feedItems: [],
  };
}

interface Tx {
  logEntries: LogEntryRow[];
  feedItems: FeedRow[];
}

interface FakeClient {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount: number }>;
  release(): void;
}

interface FakePool {
  connect(): Promise<FakeClient>;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Only the SQL fragments `logCompletion` emits are modelled; anything
 * else fails loudly so a future SQL drift is surfaced by the test rather than
 * silently ignored. This test never generates a rode-with list (rode-with
 * dedup/target-validation is Property 19's concern), so the tag INSERT is not
 * exercised here; it is still modelled defensively.
 */
function makeFakePool(store: Store): FakePool {
  const ok = (rows: unknown[]): { rows: unknown[]; rowCount: number } => ({
    rows,
    rowCount: rows.length,
  });

  return {
    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount: number }> {
          const sql = norm(text);

          if (sql.startsWith('BEGIN')) {
            tx = {
              logEntries: store.logEntries.slice(),
              feedItems: store.feedItems.slice(),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.logEntries = tx.logEntries.slice();
            store.feedItems = tx.feedItems.slice();
            tx = null;
            return ok([]);
          }
          if (sql.startsWith('ROLLBACK')) {
            tx = null;
            return ok([]);
          }

          if (tx === null) {
            throw new Error(
              `data-plane query without BEGIN: ${sql.slice(0, 64)}`,
            );
          }

          if (sql.startsWith('SELECT user_id FROM trip_memberships')) {
            const [tripId] = params as [string];
            const rows =
              tripId === TRIP_ID
                ? [...store.memberIds].map((user_id) => ({ user_id }))
                : [];
            return ok(rows);
          }

          if (sql.startsWith('INSERT INTO trip_log_entries')) {
            const [tripId, memberId, experienceId] = params as [
              string,
              string,
              string,
            ];
            const id = randomUUID();
            tx.logEntries.push({ id, tripId, memberId, experienceId });
            return ok([{ id }]);
          }

          if (sql.startsWith('INSERT INTO rode_with_tags')) {
            const id = randomUUID();
            return ok([{ id }]);
          }

          if (sql.startsWith('INSERT INTO trip_feed_items')) {
            const [tripId, actorId] = params as [string, string];
            tx.feedItems.push({ tripId, type: 'completion_logged', actorId });
            return ok([]);
          }

          throw new Error(`unhandled SQL in fake pool: ${sql.slice(0, 80)}`);
        },
        release(): void {
          tx = null;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Injected canonical repos.
//
// The RatingRepo fake models the ONE canonical `ratings` row per
// (userId, experienceId): `setRating` upserts into a single-value-per-key map
// and `getRating` reads it back. That map is the single source of truth the
// property round-trips against. Every `setRating` call is also recorded so the
// property can assert the exact `(userId, experienceId, value)` arguments and
// the invoked/not-invoked discipline.
// ---------------------------------------------------------------------------

interface SetRatingCall {
  readonly userId: string;
  readonly experienceId: string;
  readonly value: number;
}

interface Canonical {
  readonly deps: TripRepoDeps;
  /** The single canonical Rating value per `(userId, experienceId)`. */
  readonly ratings: Map<string, number>;
  readonly setRatingCalls: SetRatingCall[];
  /** Read back a canonical Rating exactly as the Tracking read path would. */
  getRating(userId: string, experienceId: string): number | null;
}

function ratingKey(userId: string, experienceId: string): string {
  return `${userId}::${experienceId}`;
}

function makeCanonical(): Canonical {
  const ratings = new Map<string, number>();
  const setRatingCalls: SetRatingCall[] = [];

  const fail = (): never => {
    throw new Error('logCompletion must not touch this canonical operation');
  };

  // Completion write is delegated but not the focus here; record nothing.
  const completions = {
    async mark() {
      return null;
    },
    edit: fail,
    getCompletion: fail,
    unmark: fail,
  } as unknown as CompletionRepo;

  const ratingsRepo = {
    async setRating(userId: string, experienceId: string, value: number) {
      // The single canonical row: upsert overwrites any prior value (R12.2).
      ratings.set(ratingKey(userId, experienceId), value);
      setRatingCalls.push({ userId, experienceId, value });
      return { userId, experienceId, value };
    },
    async getRating(userId: string, experienceId: string) {
      const key = ratingKey(userId, experienceId);
      if (!ratings.has(key)) return null;
      return { userId, experienceId, value: ratings.get(key)! };
    },
    removeRating: fail,
  } as unknown as RatingRepo;

  return {
    deps: { completions, ratings: ratingsRepo },
    ratings,
    setRatingCalls,
    getRating: (userId, experienceId) => {
      const key = ratingKey(userId, experienceId);
      return ratings.has(key) ? ratings.get(key)! : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /**
   * The expected single canonical Rating per `(userId, experienceId)`, updated
   * only when a log supplies a rating — the independent oracle the real
   * canonical map is checked against.
   */
  readonly expected: Map<string, number>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
  readonly canonical: Canonical;
}

/**
 * Global invariants re-checked after every command:
 *   - the canonical map is a faithful single-value-per-key mirror of the model
 *     oracle, and `getRating` reads back exactly that value (round-trip);
 *   - no `trip_log_entries` row carries a rating field — the only Rating store
 *     anywhere is the single canonical map (no Trip-local copy, R12.1).
 */
function assertInvariants(m: Model, r: Real): void {
  // The canonical map holds exactly one value per key and equals the oracle.
  expect(r.canonical.ratings.size).toBe(m.expected.size);
  for (const [key, value] of m.expected) {
    expect(r.canonical.ratings.get(key)).toBe(value);
    const [userId, experienceId] = key.split('::') as [string, string];
    // A subsequent read returns the same value from the one canonical row.
    expect(r.canonical.getRating(userId, experienceId)).toBe(value);
  }

  // Structural "no Trip-local copy": the log-entry rows have only the four
  // linking columns and no rating field of any kind.
  for (const entry of r.store.logEntries) {
    expect(Object.keys(entry).sort()).toEqual(
      ['experienceId', 'id', 'memberId', 'tripId'].sort(),
    );
    expect((entry as unknown as Record<string, unknown>).rating).toBeUndefined();
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * `LogCompletion(loggerIndex, experienceIndex, rating)`: the logging Member
 * logs a Completion for an Experience, optionally recording a whole-number
 * 1–10 Rating through the Trip. No rode-with tags are generated so the command
 * isolates the Rating round-trip (rode-with behaviour is Property 19).
 *
 * Expected outcome, derived purely from the request:
 *   - with a rating: `setRating(logger, experience, rating)` is invoked exactly
 *     once and the single canonical value for `(logger, experience)` becomes
 *     `rating` (overwriting any prior value);
 *   - without a rating: `setRating` is not invoked and the canonical value is
 *     unchanged.
 */
class LogCompletionCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly loggerIndex: number,
    public readonly experienceIndex: number,
    public readonly rating: number | null,
  ) {}

  private logger(): string {
    return MEMBER_IDS[this.loggerIndex % MEMBER_IDS.length]!;
  }

  private experienceId(): string {
    return EXPERIENCE_IDS[this.experienceIndex % EXPERIENCE_IDS.length]!;
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const logger = this.logger();
    const experienceId = this.experienceId();
    const key = ratingKey(logger, experienceId);

    const input = {
      experienceId,
      rodeWith: [] as string[],
      ...(this.rating === null ? {} : { rating: this.rating }),
    };

    const setRatingCallsBefore = r.canonical.setRatingCalls.length;
    const canonicalValueBefore = r.canonical.getRating(logger, experienceId);

    await r.repo.logCompletion(TRIP_ID, logger, input);

    if (this.rating === null) {
      // No rating supplied → setRating not invoked, canonical value unchanged.
      expect(r.canonical.setRatingCalls.length).toBe(setRatingCallsBefore);
      expect(r.canonical.getRating(logger, experienceId)).toBe(
        canonicalValueBefore,
      );
    } else {
      // Rating supplied → exactly one setRating call with exactly the tuple
      // (loggerId, experienceId, rating), and the single canonical value now
      // equals that rating (overwriting any prior value).
      expect(r.canonical.setRatingCalls.length).toBe(setRatingCallsBefore + 1);
      const call = r.canonical.setRatingCalls.at(-1)!;
      expect(call).toEqual({
        userId: logger,
        experienceId,
        value: this.rating,
      });
      expect(r.canonical.getRating(logger, experienceId)).toBe(this.rating);

      m.expected.set(key, this.rating);
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `LogCompletion(logger=${this.logger().slice(0, 8)}, exp=${this.experienceId().slice(0, 8)}, rating=${this.rating ?? 'none'})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('logCompletion canonical Rating — Property 22: ratings round-trip to the single canonical Rating', () => {
  it('persists exactly the supplied rating as the single canonical Rating, leaves it unchanged when omitted, and stores no Trip-local copy', async () => {
    const commandArb = fc
      .record({
        loggerIndex: fc.nat({ max: MEMBER_IDS.length - 1 }),
        experienceIndex: fc.nat({ max: EXPERIENCE_IDS.length - 1 }),
        rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
      })
      .map(
        ({ loggerIndex, experienceIndex, rating }) =>
          new LogCompletionCommand(loggerIndex, experienceIndex, rating),
      );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const store = makeStore();
          const canonical = makeCanonical();
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            canonical.deps,
          );
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { expected: new Map<string, number>() },
            real: { store, repo, canonical },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
