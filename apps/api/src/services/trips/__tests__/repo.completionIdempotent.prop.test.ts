// Feature: trips, Property 18: Logging a Completion is idempotent on the canonical Completion
/**
 * Property-based test for canonical-Completion idempotency during
 * `logCompletion` (task 9.2).
 *
 * **Validates: Requirements 10.1, 10.2**
 *
 * Design Property 18 (design.md → Correctness Properties):
 *
 *   Logging a Completion through a Trip is idempotent on the canonical
 *   Completion. Every `logCompletion` delegates the canonical write to the
 *   injected Tracking completion repo's `mark`, whose insert-on-conflict
 *   semantics create the Completion the first time a (Member, Experience) pair
 *   is logged and no-op (return `null`) on every subsequent log of the same
 *   pair (R10.1, R10.2). So no matter how many times a Member logs the same
 *   Experience — the exact same pair, in any interleaving with other pairs —
 *   there is never more than one canonical Completion for that (Member,
 *   Experience). Each log still creates a fresh `trip_log_entry`: the Trip's
 *   Shared_Log records every logging event, while the canonical Completion is
 *   written at most once.
 *
 * Test strategy
 * -------------
 * Per the tasks.md convention, this stateful property runs against an
 * in-memory model of the repo rather than a live database: a tiny fake
 * `pg.Pool` drives the *real* `createTripRepo` factory (the production
 * `logCompletion` transaction), backed by a store that models exactly the
 * Trip tables `logCompletion` writes — `trip_memberships` (seeded, read-only),
 * `trip_log_entries`, `rode_with_tags`, and `trip_feed_items`.
 *
 * The canonical Completion write is delegated to an injected fake
 * `CompletionRepo` whose `mark` faithfully models the production
 * insert-on-conflict: it keys a private store on `(userId, experienceId)`,
 * inserts and returns a `CompletionDTO` the first time a pair is seen, and
 * returns `null` on every later `mark` of the same pair — exactly like the
 * real repo's `ON CONFLICT DO NOTHING` returning no row. Every `mark` call is
 * recorded so the property can prove `mark` *is* invoked on each log while the
 * canonical store still holds at most one Completion per pair.
 *
 * The scenario fixes one Trip with three current Members and a *small* pool of
 * Experiences, so repeatedly logging the same (Member, Experience) pair is a
 * frequent, naturally-generated event. Rode-with tagging is left out of this
 * property (an empty `rodeWith` list) to isolate the canonical-Completion
 * idempotency; Property 19 covers tag creation. After every command the
 * invariant is re-checked: the canonical completion store holds exactly one
 * entry per distinct (Member, Experience) pair logged so far, and it never
 * exceeds the number of `mark` calls.
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
const MAX_COMMANDS = 40;

/** The fixed Trip every log entry in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The three current Trip_Members; any may be the logging Member. */
const MEMBER_IDS = [
  '00000000-0000-4000-8000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
] as const;

/**
 * A deliberately small Experience pool so that repeatedly logging the *same*
 * (Member, Experience) pair — the situation Property 18 is about — is a
 * frequent, naturally-generated event across a run.
 */
const EXPERIENCE_IDS = [
  'e0000000-0000-4000-8000-000000000000',
  'e1111111-1111-4111-8111-111111111111',
  'e2222222-2222-4222-8222-222222222222',
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

interface TagRow {
  readonly id: string;
  readonly logEntryId: string;
  readonly taggedMemberId: string;
  readonly state: string;
}

interface FeedRow {
  readonly tripId: string;
  readonly type: string;
  readonly actorId: string;
}

/**
 * The whole backing store for the Trip tables. `memberIds` is a read-only
 * membership set seeded at setup; the three mutable tables are snapshotted per
 * transaction so a `ROLLBACK` faithfully discards partial writes.
 */
interface Store {
  readonly memberIds: ReadonlySet<string>;
  logEntries: LogEntryRow[];
  tags: TagRow[];
  feedItems: FeedRow[];
}

function makeStore(): Store {
  return {
    memberIds: new Set(MEMBER_IDS),
    logEntries: [],
    tags: [],
    feedItems: [],
  };
}

/** A mutable per-transaction snapshot of the store's mutable tables. */
interface Tx {
  logEntries: LogEntryRow[];
  tags: TagRow[];
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
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it. Only the SQL fragments
 * `logCompletion` emits are modelled; anything else fails loudly so a future
 * SQL drift is surfaced by the test rather than silently ignored.
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

          // ---- transaction control ---------------------------------
          if (sql.startsWith('BEGIN')) {
            tx = {
              logEntries: store.logEntries.slice(),
              tags: store.tags.slice(),
              feedItems: store.feedItems.slice(),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.logEntries = tx.logEntries.slice();
            store.tags = tx.tags.slice();
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

          // ---- membership set read for tag target validation (R10.4) --
          if (sql.startsWith('SELECT user_id FROM trip_memberships')) {
            const [tripId] = params as [string];
            const rows =
              tripId === TRIP_ID
                ? [...store.memberIds].map((user_id) => ({ user_id }))
                : [];
            return ok(rows);
          }

          // ---- insert the Trip_Log_Entry (R10.1, R10.2) --------------
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

          // ---- insert one pending Rode_With_Tag per tag (R10.3) ------
          if (sql.startsWith('INSERT INTO rode_with_tags')) {
            const [logEntryId, taggedMemberId] = params as [string, string];
            const id = randomUUID();
            tx.tags.push({
              id,
              logEntryId,
              taggedMemberId,
              state: 'pending',
            });
            return ok([{ id }]);
          }

          // ---- completion_logged feed item (R10.9) -------------------
          if (sql.startsWith('INSERT INTO trip_feed_items')) {
            const [tripId, actorId] = params as [string, string];
            tx.feedItems.push({
              tripId,
              type: 'completion_logged',
              actorId,
            });
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
// Injected canonical CompletionRepo modelling insert-on-conflict semantics.
//
// `mark` keys a private store on `(userId, experienceId)`: the first `mark`
// for a pair inserts and returns a CompletionDTO; every later `mark` of the
// same pair returns `null` — faithfully mirroring the real repo's
// `ON CONFLICT DO NOTHING` returning no row (R10.1, R10.2). Every call is
// recorded so the property can prove `mark` is invoked on each log while the
// canonical store still holds at most one Completion per pair.
// ---------------------------------------------------------------------------

interface MarkCall {
  readonly userId: string;
  readonly experienceId: string;
}

interface CanonicalCompletions {
  readonly deps: TripRepoDeps;
  /** Every `mark` invocation, in order. */
  readonly markCalls: MarkCall[];
  /** The distinct (user, experience) keys that have a canonical Completion. */
  readonly stored: Set<string>;
  /** Whether the most recent `mark` inserted (true) or was a no-op (false). */
  lastInserted: boolean;
}

function keyOf(userId: string, experienceId: string): string {
  return `${userId}|${experienceId}`;
}

function makeCanonicalCompletions(): CanonicalCompletions {
  const markCalls: MarkCall[] = [];
  const stored = new Set<string>();
  const state: { lastInserted: boolean } = { lastInserted: false };

  const fail = (): never => {
    throw new Error('logCompletion must not touch this canonical operation');
  };

  const completions = {
    async mark(input: { userId: string; experienceId: string }) {
      markCalls.push({ userId: input.userId, experienceId: input.experienceId });
      const key = keyOf(input.userId, input.experienceId);
      if (stored.has(key)) {
        // Pair already completed → insert-on-conflict no-ops, returns null.
        state.lastInserted = false;
        return null;
      }
      // First completion of this pair → insert, return a DTO-shaped row.
      stored.add(key);
      state.lastInserted = true;
      return {
        userId: input.userId,
        experienceId: input.experienceId,
      } as unknown;
    },
    edit: fail,
    getCompletion: fail,
    unmark: fail,
  } as unknown as CompletionRepo;

  // logCompletion may apply an optional Rating; not exercised here (we never
  // supply one) but the shape must exist.
  const ratings = {
    setRating: fail,
    removeRating: fail,
    getRating: fail,
  } as unknown as RatingRepo;

  return {
    deps: { completions, ratings },
    markCalls,
    stored,
    get lastInserted() {
      return state.lastInserted;
    },
    set lastInserted(v: boolean) {
      state.lastInserted = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** Distinct (member, experience) pairs logged so far. */
  readonly loggedPairs: Set<string>;
  /** Log-entry ids created so far; used to assert global uniqueness. */
  readonly logEntryIds: Set<string>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
  readonly canonical: CanonicalCompletions;
}

/**
 * Global invariant re-checked after every command: the canonical completion
 * store holds exactly one entry per distinct (Member, Experience) pair logged
 * (idempotency — never a duplicate, R10.1, R10.2), and it never exceeds the
 * number of `mark` calls (each log delegated to `mark`).
 */
function assertInvariants(m: Model, r: Real): void {
  // Exactly one canonical Completion per distinct pair — never a duplicate.
  expect(r.canonical.stored.size).toBe(m.loggedPairs.size);
  expect([...r.canonical.stored].sort()).toEqual([...m.loggedPairs].sort());

  // Every log delegated to `mark`, so there are at least as many mark calls as
  // distinct completions, and never fewer marks than distinct pairs.
  expect(r.canonical.markCalls.length).toBeGreaterThanOrEqual(
    r.canonical.stored.size,
  );

  // Every stored Trip_Log_Entry names a current Member and the fixed Trip.
  for (const entry of r.store.logEntries) {
    expect(entry.tripId).toBe(TRIP_ID);
    expect(r.store.memberIds.has(entry.memberId)).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * `LogCompletion(memberIndex, experienceIndex)`: the chosen Member logs a
 * Completion of the chosen Experience with no rode-with tags. The command
 * asserts, per log:
 *   - a fresh Trip_Log_Entry is always created and a `completion_logged` feed
 *     item recorded (the Shared_Log records every logging event);
 *   - the canonical `mark` is invoked exactly once;
 *   - the canonical Completion is inserted only the *first* time this exact
 *     (Member, Experience) pair is logged and is a no-op thereafter, so the
 *     canonical store never holds a duplicate (R10.1, R10.2).
 */
class LogCompletionCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIndex: number,
    public readonly experienceIndex: number,
  ) {}

  private member(): string {
    return MEMBER_IDS[this.memberIndex % MEMBER_IDS.length]!;
  }

  private experienceId(): string {
    return EXPERIENCE_IDS[this.experienceIndex % EXPERIENCE_IDS.length]!;
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const member = this.member();
    const experienceId = this.experienceId();
    const pairKey = keyOf(member, experienceId);
    const isRepeat = m.loggedPairs.has(pairKey);

    const logEntriesBefore = r.store.logEntries.length;
    const feedBefore = r.store.feedItems.length;
    const markBefore = r.canonical.markCalls.length;
    const storedBefore = r.canonical.stored.size;

    const result = await r.repo.logCompletion(TRIP_ID, member, {
      experienceId,
      rodeWith: [],
    });

    // A fresh Trip_Log_Entry is always created, with a completion_logged feed
    // item — the Shared_Log records every logging event, repeat or not.
    expect(r.store.logEntries.length).toBe(logEntriesBefore + 1);
    expect(r.store.feedItems.length).toBe(feedBefore + 1);
    expect(m.logEntryIds.has(result.logEntryId)).toBe(false);
    m.logEntryIds.add(result.logEntryId);

    // No rode-with tags on this property.
    expect(result.pendingTags).toHaveLength(0);

    // The canonical `mark` is invoked exactly once per log (always delegated).
    expect(r.canonical.markCalls.length).toBe(markBefore + 1);
    const lastCall = r.canonical.markCalls[r.canonical.markCalls.length - 1]!;
    expect(lastCall.userId).toBe(member);
    expect(lastCall.experienceId).toBe(experienceId);

    if (isRepeat) {
      // Re-logging the same pair inserts no new canonical Completion (no-op).
      expect(r.canonical.stored.size).toBe(storedBefore);
      expect(r.canonical.lastInserted).toBe(false);
    } else {
      // First log of this pair inserts exactly one canonical Completion.
      expect(r.canonical.stored.size).toBe(storedBefore + 1);
      expect(r.canonical.lastInserted).toBe(true);
      m.loggedPairs.add(pairKey);
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `LogCompletion(member=${this.member().slice(0, 8)}, experience=${this.experienceId().slice(0, 8)})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('logCompletion canonical Completion — Property 18: logging is idempotent on the canonical Completion', () => {
  it('creates a fresh log entry per log but never more than one canonical Completion per (member, experience)', async () => {
    const commandArb = fc
      .record({
        memberIndex: fc.nat({ max: MEMBER_IDS.length - 1 }),
        experienceIndex: fc.nat({ max: EXPERIENCE_IDS.length - 1 }),
      })
      .map(
        ({ memberIndex, experienceIndex }) =>
          new LogCompletionCommand(memberIndex, experienceIndex),
      );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const store = makeStore();
          const canonical = makeCanonicalCompletions();
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            canonical.deps,
          );
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: {
              loggedPairs: new Set<string>(),
              logEntryIds: new Set<string>(),
            },
            real: { store, repo, canonical },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
