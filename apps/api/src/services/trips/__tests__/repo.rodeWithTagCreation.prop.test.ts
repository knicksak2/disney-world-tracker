// Feature: trips, Property 19: Rode_With_Tag creation is deduplicated and target-validated
/**
 * Property-based test for rode-with tag creation during `logCompletion`
 * (task 9.3).
 *
 * **Validates: Requirements 10.3, 10.4, 10.5, 10.6**
 *
 * Design Property 19 (design.md → Correctness Properties):
 *
 *   When a Trip_Member logs a Completion and tags others, `logCompletion`
 *   creates at most one `pending` Rode_With_Tag per *distinct* tagged
 *   Trip_Member (R10.3), and rejects — writing nothing — a tag that names the
 *   logging Member themselves (R10.5), a tag that names a User who is not a
 *   current Trip_Member (R10.4), or a request that names the same Tagged_Member
 *   more than once (R10.6). Every rejection maps to `trip_validation_failed`.
 *
 * Test strategy
 * -------------
 * Per the tasks.md convention, this stateful property runs against an
 * in-memory model of the repo rather than a live database: a tiny fake
 * `pg.Pool` drives the *real* `createTripRepo` factory (the production
 * `logCompletion` transaction), backed by a store that models exactly the
 * tables `logCompletion` writes — `trip_memberships` (seeded, read-only),
 * `trip_log_entries`, `rode_with_tags`, and `trip_feed_items`. The fake pool
 * dispatches the SQL fragments `logCompletion` emits (`BEGIN`, the membership
 * `SELECT`, the log-entry / tag / feed `INSERT`s, and `COMMIT` / `ROLLBACK`)
 * to a snapshot-per-transaction layer so a `ROLLBACK` faithfully discards a
 * rejected log's partial writes (the "SHALL NOT create" clauses of
 * R10.4–R10.6).
 *
 * The canonical Completion and Rating writes are delegated to injected
 * stand-in repos that only *record* their calls, so the property can assert
 * that a rejected log never reaches the canonical `mark` / `setRating` — i.e.
 * a rejection writes nothing anywhere — while a successful log marks the
 * canonical Completion exactly once and records the optional Rating exactly
 * when one was supplied.
 *
 * The scenario fixes one Trip with four current Members (any of which may be
 * the logging Member) and a pool of non-Members. A random interleaving of
 * `LogCompletion` commands is generated; each command draws a logging Member,
 * a fresh Experience, an optional Rating, and a rode-with list assembled from
 * Members, the logging Member (to exercise self-tags), non-Members, and
 * repeats (to exercise in-request duplicates). After every command a set of
 * global invariants is re-checked: every stored tag is `pending`, references
 * an existing log entry, names a current Member, is never the logger of its
 * own entry, and no log entry carries two tags for the same Tagged_Member.
 *
 * `numRuns: 200` (≥100 per the spec convention).
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
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

/** The four current Trip_Members; any may be the logging Member. */
const MEMBER_IDS = [
  '00000000-0000-4000-8000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const;

/** Users who are NOT Trip_Members — tagging any of them must be rejected. */
const NON_MEMBER_IDS = [
  '99999999-9999-4999-8999-999999999999',
  '88888888-8888-4888-8888-888888888888',
] as const;

/** The candidate pool a rode-with list is drawn from (Members + non-Members). */
const TAG_POOL = [...MEMBER_IDS, ...NON_MEMBER_IDS] as const;

// ---------------------------------------------------------------------------
// In-memory model of the tables logCompletion writes
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
 * The whole backing store. `memberIds` is a read-only membership set seeded at
 * setup; the three mutable tables are snapshotted per transaction so a
 * `ROLLBACK` faithfully discards a rejected log's partial writes.
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
            // Tolerate a double ROLLBACK: logCompletion rolls back explicitly on
            // the non-member guard, then the catch runs safeRollback again.
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
// Injected canonical repos — record calls so a rejection can be proven to
// write nothing (the canonical `mark` / `setRating` are never reached), and a
// success can be proven to mark exactly once and rate exactly when supplied.
// ---------------------------------------------------------------------------

interface RecordingDeps {
  readonly deps: TripRepoDeps;
  readonly markCalls: Array<{ userId: string; experienceId: string }>;
  readonly setRatingCalls: Array<{
    userId: string;
    experienceId: string;
    value: number;
  }>;
}

function makeRecordingDeps(): RecordingDeps {
  const markCalls: Array<{ userId: string; experienceId: string }> = [];
  const setRatingCalls: Array<{
    userId: string;
    experienceId: string;
    value: number;
  }> = [];

  const fail = (): never => {
    throw new Error('logCompletion must not touch this canonical operation');
  };

  const completions = {
    async mark(input: { userId: string; experienceId: string }) {
      markCalls.push({ userId: input.userId, experienceId: input.experienceId });
      // A `null` return models "a Completion already existed" — logCompletion
      // ignores the value; it only relies on the insert-on-conflict semantics.
      return null;
    },
    edit: fail,
    getCompletion: fail,
    unmark: fail,
  } as unknown as CompletionRepo;

  const ratings = {
    async setRating(userId: string, experienceId: string, value: number) {
      setRatingCalls.push({ userId, experienceId, value });
      return undefined as unknown;
    },
    removeRating: fail,
    getRating: fail,
  } as unknown as RatingRepo;

  return { deps: { completions, ratings }, markCalls, setRatingCalls };
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** Log-entry ids created so far; used only to assert global uniqueness. */
  readonly logEntryIds: Set<string>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
  readonly markCalls: RecordingDeps['markCalls'];
  readonly setRatingCalls: RecordingDeps['setRatingCalls'];
}

async function expectAppError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return;
  }
  throw new Error(`expected AppError(${code}) but the call resolved`);
}

/**
 * Global invariants re-checked after every command:
 *   - every stored tag is `pending`, references an existing log entry, and
 *     names a current Trip_Member (R10.3, R10.4),
 *   - no tag names the logging Member of its own entry (R10.5),
 *   - no log entry carries two tags for the same Tagged_Member (R10.3, R10.6).
 */
function assertInvariants(r: Real): void {
  const entryById = new Map(r.store.logEntries.map((e) => [e.id, e]));
  const perEntry = new Map<string, Set<string>>();

  for (const tag of r.store.tags) {
    expect(tag.state).toBe('pending');

    const entry = entryById.get(tag.logEntryId);
    expect(entry).toBeDefined();

    // Tagged_Member is a current Member and not the logger of the entry.
    expect(r.store.memberIds.has(tag.taggedMemberId)).toBe(true);
    expect(tag.taggedMemberId).not.toBe(entry!.memberId);

    // At most one tag per (log entry, Tagged_Member).
    const seen = perEntry.get(tag.logEntryId) ?? new Set<string>();
    expect(seen.has(tag.taggedMemberId)).toBe(false);
    seen.add(tag.taggedMemberId);
    perEntry.set(tag.logEntryId, seen);
  }
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

/**
 * `LogCompletion(loggerIndex, experienceId, tagIndices, rating)`: the logging
 * Member logs a Completion and tags the Users named by `tagIndices` (indices
 * into `TAG_POOL`, so the list may contain the logger, non-Members, and
 * repeats). The command derives the expected outcome purely from the request:
 *
 *   - reject with `trip_validation_failed` when the list names the logger
 *     (R10.5), repeats a Tagged_Member (R10.6), or names a non-Member (R10.4),
 *     writing nothing to any Trip table or canonical repo;
 *   - otherwise succeed, creating exactly one `pending` tag per distinct
 *     Tagged_Member (R10.3), marking the canonical Completion once, and
 *     recording the Rating exactly when one was supplied.
 */
class LogCompletionCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly loggerIndex: number,
    public readonly experienceId: string,
    public readonly tagIndices: readonly number[],
    public readonly rating: number | null,
  ) {}

  private logger(): string {
    return MEMBER_IDS[this.loggerIndex % MEMBER_IDS.length]!;
  }

  private rodeWith(): string[] {
    return this.tagIndices.map((i) => TAG_POOL[i % TAG_POOL.length]!);
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const logger = this.logger();
    const rodeWith = this.rodeWith();
    const input = {
      experienceId: this.experienceId,
      rodeWith,
      ...(this.rating === null ? {} : { rating: this.rating }),
    };

    const distinct = [...new Set(rodeWith)];
    const hasSelf = rodeWith.includes(logger);
    const hasDuplicate = rodeWith.length !== distinct.length;
    const hasNonMember = distinct.some((id) => !r.store.memberIds.has(id));
    const shouldReject = hasSelf || hasDuplicate || hasNonMember;

    const logEntriesBefore = r.store.logEntries.length;
    const tagsBefore = r.store.tags.length;
    const feedBefore = r.store.feedItems.length;
    const markBefore = r.markCalls.length;
    const setRatingBefore = r.setRatingCalls.length;

    if (shouldReject) {
      await expectAppError(
        () => r.repo.logCompletion(TRIP_ID, logger, input),
        'trip_validation_failed',
      );

      // Nothing is written to any Trip table on rejection (R10.4–R10.6).
      expect(r.store.logEntries.length).toBe(logEntriesBefore);
      expect(r.store.tags.length).toBe(tagsBefore);
      expect(r.store.feedItems.length).toBe(feedBefore);

      // …and the canonical Completion / Rating are never touched.
      expect(r.markCalls.length).toBe(markBefore);
      expect(r.setRatingCalls.length).toBe(setRatingBefore);
    } else {
      const result = await r.repo.logCompletion(TRIP_ID, logger, input);

      // Exactly one Trip_Log_Entry, one completion_logged feed item.
      expect(r.store.logEntries.length).toBe(logEntriesBefore + 1);
      expect(r.store.feedItems.length).toBe(feedBefore + 1);
      expect(m.logEntryIds.has(result.logEntryId)).toBe(false);
      m.logEntryIds.add(result.logEntryId);

      // At most one pending tag per distinct Tagged_Member (R10.3).
      expect(result.pendingTags).toHaveLength(distinct.length);
      expect(r.store.tags.length).toBe(tagsBefore + distinct.length);

      const newTags = r.store.tags.filter(
        (t) => t.logEntryId === result.logEntryId,
      );
      expect(newTags).toHaveLength(distinct.length);
      const taggedIds = newTags.map((t) => t.taggedMemberId);
      // No duplicate Tagged_Member on the entry, and the set equals the
      // distinct requested set — deduplicated and target-validated.
      expect(new Set(taggedIds).size).toBe(taggedIds.length);
      expect(new Set(taggedIds)).toEqual(new Set(distinct));
      for (const tag of newTags) expect(tag.state).toBe('pending');

      // The returned pending-tag identities match the created tags.
      expect(new Set(result.pendingTags.map((p) => p.taggedMemberId))).toEqual(
        new Set(distinct),
      );

      // Canonical Completion marked once; Rating recorded iff supplied.
      expect(r.markCalls.length).toBe(markBefore + 1);
      expect(r.setRatingCalls.length).toBe(
        setRatingBefore + (this.rating === null ? 0 : 1),
      );
    }

    assertInvariants(r);
  }

  toString(): string {
    return `LogCompletion(logger=${this.logger().slice(0, 8)}, rodeWith=[${this.rodeWith()
      .map((id) => id.slice(0, 8))
      .join(',')}], rating=${this.rating ?? 'none'})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('logCompletion rode-with tags — Property 19: deduplicated and target-validated', () => {
  it('creates at most one pending tag per distinct member and rejects self/non-member/duplicate tags, writing nothing on rejection', async () => {
    const commandArb = fc
      .record({
        loggerIndex: fc.nat({ max: MEMBER_IDS.length - 1 }),
        experienceId: fc.uuid(),
        tagIndices: fc.array(fc.nat({ max: TAG_POOL.length - 1 }), {
          maxLength: 6,
        }),
        rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
      })
      .map(
        ({ loggerIndex, experienceId, tagIndices, rating }) =>
          new LogCompletionCommand(
            loggerIndex,
            experienceId,
            tagIndices,
            rating,
          ),
      );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const store = makeStore();
          const { deps, markCalls, setRatingCalls } = makeRecordingDeps();
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            deps,
          );
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { logEntryIds: new Set<string>() },
            real: { store, repo, markCalls, setRatingCalls },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
