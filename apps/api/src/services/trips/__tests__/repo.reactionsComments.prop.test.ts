// Feature: trips, Property 23: Trip_Reactions and Trip_Comments follow an add/remove lifecycle with at-most-one reaction per type
/**
 * Property-based test for the Trip_Reaction / Trip_Comment add/remove lifecycle
 * (task 11.2).
 *
 * **Validates: Requirements 13.4, 13.5, 13.7, 13.8, 13.9, 13.11**
 *
 * Design Property 23 (design.md → Correctness Properties):
 *
 *   For any Trip_Member and target Trip_Feed_Item or Trip_Log_Entry, adding a
 *   supported Trip_Reaction of a type persists exactly one reaction for that
 *   (member, target, type) and re-adding the same type is idempotent, removing
 *   a reaction the Member added deletes it, adding a valid Trip_Comment (1–2000
 *   characters after trimming) persists it associated with the author, and
 *   removing a Trip_Comment the Member authored deletes it.
 *
 * Test strategy
 * -------------
 * Per the tasks.md convention this stateful property runs against an in-memory
 * model of the repo rather than a live database. A tiny fake `pg.Pool` drives
 * the *real* `createTripRepo` factory (the production `addReaction`,
 * `removeReaction`, `addComment`, and `removeComment` operations), backed by a
 * store that models exactly the tables those operations touch — the read-only
 * target tables `trip_feed_items` / `trip_log_entries` (for the
 * `assertTargetInTrip` check) and the mutable `trip_reactions` /
 * `trip_comments`.
 *
 * `trip_reactions` is modelled as a `Set` keyed by the composite primary key
 * `(target_type, target_id, member_id, reaction)`, so an `INSERT ... ON
 * CONFLICT DO NOTHING` is naturally idempotent and the store can hold at most
 * one reaction per (member, target, type) — the structural half of R13.4/R13.5.
 * `trip_comments` is a `Map` keyed by comment id carrying the author, target,
 * and stored (trimmed) body.
 *
 * A random interleaving of commands exercises the whole lifecycle:
 *   - `AddReaction` adds a supported reaction; re-adding the same one is a
 *     no-op that keeps the single row (R13.4, R13.5);
 *   - `RemoveReaction` removes the acting Member's own reaction, idempotent
 *     when absent (R13.7);
 *   - `AddComment` adds a comment whose body is valid, empty-after-trim, or
 *     over-long; a valid body persists trimmed and associated with the author
 *     (R13.8), an invalid body is rejected with `trip_validation_failed` and
 *     nothing is persisted (R13.9);
 *   - `RemoveComment` removes an existing comment: the author's own removal
 *     deletes it (R13.11), a non-author is rejected with `trip_forbidden` and
 *     the comment is retained (R13.12), and an unknown id returns `false`.
 *
 * After every command the fake store (the real SQL effects) is asserted equal
 * to the independent model oracle, so the property proves the repo's persisted
 * state matches the lifecycle rules across every interleaving.
 *
 * `numRuns: 200` (≥100 per the spec convention).
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { TripFeedTargetType, TripReactionValue } from '@dwt/shared';
import { TRIP_REACTION_VALUES } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 200;
const MAX_COMMANDS = 40;

/** The fixed Trip every reaction/comment in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** The current Trip_Members; any may act. */
const MEMBER_IDS = [
  '00000000-0000-4000-8000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
] as const;

/**
 * A fixed set of reaction/comment targets, all belonging to `TRIP_ID`, one of
 * each `TripFeedTargetType` so both `assertTargetInTrip` branches are covered.
 */
interface Target {
  readonly type: TripFeedTargetType;
  readonly id: string;
}
const TARGETS: readonly Target[] = [
  { type: 'feed_item', id: 'f0000000-0000-4000-8000-000000000001' },
  { type: 'feed_item', id: 'f0000000-0000-4000-8000-000000000002' },
  { type: 'log_entry', id: '10000000-0000-4000-8000-000000000001' },
  { type: 'log_entry', id: '10000000-0000-4000-8000-000000000002' },
] as const;

// ---------------------------------------------------------------------------
// In-memory store: the tables the lifecycle operations touch
// ---------------------------------------------------------------------------

/** Composite primary key of a `trip_reactions` row. */
function reactionKey(
  targetType: TripFeedTargetType,
  targetId: string,
  memberId: string,
  reaction: TripReactionValue,
): string {
  return `${targetType}|${targetId}|${memberId}|${reaction}`;
}

interface CommentRow {
  readonly id: string;
  readonly targetType: TripFeedTargetType;
  readonly targetId: string;
  readonly authorId: string;
  readonly body: string;
}

/**
 * The whole backing store. `feedItemIds` / `logEntryIds` are the read-only
 * target tables `assertTargetInTrip` probes; `reactions` and `comments` are the
 * mutable tables. Each is snapshotted per transaction so a `ROLLBACK`
 * faithfully discards partial writes.
 */
interface Store {
  readonly feedItemIds: ReadonlySet<string>;
  readonly logEntryIds: ReadonlySet<string>;
  reactions: Set<string>;
  comments: Map<string, CommentRow>;
}

function makeStore(): Store {
  return {
    feedItemIds: new Set(
      TARGETS.filter((t) => t.type === 'feed_item').map((t) => t.id),
    ),
    logEntryIds: new Set(
      TARGETS.filter((t) => t.type === 'log_entry').map((t) => t.id),
    ),
    reactions: new Set(),
    comments: new Map(),
  };
}

interface Tx {
  reactions: Set<string>;
  comments: Map<string, CommentRow>;
}

interface QueryResult {
  rows: unknown[];
  rowCount: number;
}

interface FakeClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResult>;
  release(): void;
}

/** Collapse SQL whitespace so multi-line statements match on a stable prefix. */
function norm(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Build a fake pool that models exactly the SQL the reaction/comment operations
 * emit. `addReaction` / `addComment` / `removeComment` go through `connect()`
 * transactions; `removeReaction` is a single `pool.query`. Anything else fails
 * loudly so a future SQL drift is surfaced by the test rather than silently
 * ignored.
 */
interface FakePool {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResult>;
  connect(): Promise<FakeClient>;
}

function makeFakePool(store: Store): FakePool {
  const ok = (rows: unknown[]): QueryResult => ({
    rows,
    rowCount: rows.length,
  });

  return {
    // removeReaction issues a single pool.query (no transaction).
    async query(
      text: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<QueryResult> {
      const sql = norm(text);
      if (sql.startsWith('DELETE FROM trip_reactions')) {
        const [, targetType, targetId, memberId, reaction] = params as [
          string,
          TripFeedTargetType,
          string,
          string,
          TripReactionValue,
        ];
        const key = reactionKey(targetType, targetId, memberId, reaction);
        const existed = store.reactions.delete(key);
        return { rows: [], rowCount: existed ? 1 : 0 };
      }
      throw new Error(`unhandled pool.query SQL in fake pool: ${sql.slice(0, 80)}`);
    },

    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<QueryResult> {
          const sql = norm(text);

          if (sql.startsWith('BEGIN')) {
            tx = {
              reactions: new Set(store.reactions),
              comments: new Map(store.comments),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.reactions = new Set(tx.reactions);
            store.comments = new Map(tx.comments);
            tx = null;
            return ok([]);
          }
          if (sql.startsWith('ROLLBACK')) {
            tx = null;
            return ok([]);
          }

          if (tx === null) {
            throw new Error(`data-plane query without BEGIN: ${sql.slice(0, 64)}`);
          }

          // assertTargetInTrip: SELECT 1 FROM <table> WHERE id=$1 AND trip_id=$2
          if (sql.startsWith('SELECT 1 FROM trip_feed_items')) {
            const [targetId, tripId] = params as [string, string];
            const hit = tripId === TRIP_ID && store.feedItemIds.has(targetId);
            return ok(hit ? [{ '?column?': 1 }] : []);
          }
          if (sql.startsWith('SELECT 1 FROM trip_log_entries')) {
            const [targetId, tripId] = params as [string, string];
            const hit = tripId === TRIP_ID && store.logEntryIds.has(targetId);
            return ok(hit ? [{ '?column?': 1 }] : []);
          }

          // addReaction: INSERT ... ON CONFLICT DO NOTHING (idempotent).
          if (sql.startsWith('INSERT INTO trip_reactions')) {
            const [, targetType, targetId, memberId, reaction] = params as [
              string,
              TripFeedTargetType,
              string,
              string,
              TripReactionValue,
            ];
            tx.reactions.add(
              reactionKey(targetType, targetId, memberId, reaction),
            );
            return ok([]);
          }

          // addComment: INSERT ... RETURNING id.
          if (sql.startsWith('INSERT INTO trip_comments')) {
            const [, targetType, targetId, authorId, body] = params as [
              string,
              TripFeedTargetType,
              string,
              string,
              string,
            ];
            const id = randomUUID();
            tx.comments.set(id, { id, targetType, targetId, authorId, body });
            return ok([{ id }]);
          }

          // removeComment: SELECT author_id ... FOR UPDATE.
          if (sql.startsWith('SELECT author_id FROM trip_comments')) {
            const [commentId, tripId] = params as [string, string];
            const row = tripId === TRIP_ID ? tx.comments.get(commentId) : undefined;
            return ok(row ? [{ author_id: row.authorId }] : []);
          }

          // removeComment: DELETE FROM trip_comments WHERE id=$1.
          if (sql.startsWith('DELETE FROM trip_comments')) {
            const [commentId] = params as [string];
            tx.comments.delete(commentId);
            return ok([]);
          }

          throw new Error(`unhandled client SQL in fake pool: ${sql.slice(0, 80)}`);
        },
        release(): void {
          tx = null;
        },
      };
    },
  };
}

/** The lifecycle operations never touch the canonical repos; stand-ins suffice. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  /** Composite reaction keys the model expects to be persisted. */
  reactions: Set<string>;
  /** Comment id → its author + stored (trimmed) body. */
  comments: Map<string, { authorId: string; body: string }>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

/**
 * Re-checked after every command: the persisted store (the real SQL effects)
 * equals the independent model oracle. This is the crux of Property 23 — the
 * reaction set holds at most one row per (member, target, type) and matches
 * exactly, and the comment map matches exactly on id, author, and stored body.
 */
function assertStoreMatchesModel(m: Model, r: Real): void {
  expect([...r.store.reactions].sort()).toEqual([...m.reactions].sort());

  expect(r.store.comments.size).toBe(m.comments.size);
  for (const [id, expected] of m.comments) {
    const row = r.store.comments.get(id);
    expect(row).toBeDefined();
    expect(row!.authorId).toBe(expected.authorId);
    expect(row!.body).toBe(expected.body);
  }
}

function memberOf(idx: number): string {
  return MEMBER_IDS[idx % MEMBER_IDS.length]!;
}
function targetOf(idx: number): Target {
  return TARGETS[idx % TARGETS.length]!;
}
function reactionOf(idx: number): TripReactionValue {
  return TRIP_REACTION_VALUES[idx % TRIP_REACTION_VALUES.length]!;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `AddReaction`: add a supported reaction. Persisting is idempotent on the
 * composite key, so re-adding the same (member, target, type) keeps the single
 * existing row (R13.4, R13.5).
 */
class AddReactionCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIdx: number,
    public readonly targetIdx: number,
    public readonly reactionIdx: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const member = memberOf(this.memberIdx);
    const target = targetOf(this.targetIdx);
    const reaction = reactionOf(this.reactionIdx);

    await r.repo.addReaction(TRIP_ID, target.type, target.id, member, reaction);
    m.reactions.add(reactionKey(target.type, target.id, member, reaction));

    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    const t = targetOf(this.targetIdx);
    return `AddReaction(m=${this.memberIdx % MEMBER_IDS.length}, ${t.type}:${t.id.slice(0, 8)}, ${reactionOf(this.reactionIdx)})`;
  }
}

/**
 * `RemoveReaction`: remove the acting Member's own reaction; idempotent when
 * the reaction is absent (R13.7).
 */
class RemoveReactionCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIdx: number,
    public readonly targetIdx: number,
    public readonly reactionIdx: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const member = memberOf(this.memberIdx);
    const target = targetOf(this.targetIdx);
    const reaction = reactionOf(this.reactionIdx);

    await r.repo.removeReaction(TRIP_ID, target.type, target.id, member, reaction);
    m.reactions.delete(reactionKey(target.type, target.id, member, reaction));

    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    const t = targetOf(this.targetIdx);
    return `RemoveReaction(m=${this.memberIdx % MEMBER_IDS.length}, ${t.type}:${t.id.slice(0, 8)}, ${reactionOf(this.reactionIdx)})`;
  }
}

/**
 * `AddComment(memberIdx, targetIdx, body)`: add a comment. A body that is 1–2000
 * characters after trimming persists trimmed and associated with the author
 * (R13.8); an empty-after-trim or over-long body is rejected with
 * `trip_validation_failed` and nothing is persisted (R13.9).
 */
class AddCommentCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly memberIdx: number,
    public readonly targetIdx: number,
    public readonly body: string,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const author = memberOf(this.memberIdx);
    const target = targetOf(this.targetIdx);
    const trimmed = this.body.trim();
    const valid = trimmed.length >= 1 && trimmed.length <= 2000;

    if (valid) {
      const { commentId } = await r.repo.addComment(
        TRIP_ID,
        target.type,
        target.id,
        author,
        this.body,
      );
      // R13.8: persisted, associated with the author, and stored trimmed.
      m.comments.set(commentId, { authorId: author, body: trimmed });
    } else {
      // R13.9: rejected with trip_validation_failed; nothing persisted.
      await expect(
        r.repo.addComment(TRIP_ID, target.type, target.id, author, this.body),
      ).rejects.toMatchObject({ code: 'trip_validation_failed' });
    }

    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    const trimmed = this.body.trim().length;
    return `AddComment(m=${this.memberIdx % MEMBER_IDS.length}, trimLen=${trimmed})`;
  }
}

/**
 * `RemoveComment(commentPicker, actingMemberIdx)`: remove a comment. The author's
 * own removal deletes it (R13.11); a non-author is rejected with
 * `trip_forbidden` and the comment is retained (R13.12); an unknown id returns
 * `false`. The concrete comment/actor are resolved at run time against the
 * live model so the command adapts to the current state.
 */
class RemoveCommentCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly commentPicker: number,
    public readonly actingMemberIdx: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const ids = [...m.comments.keys()].sort();
    const actor = memberOf(this.actingMemberIdx);

    if (ids.length === 0) {
      // Unknown comment id → false, nothing changes.
      const removed = await r.repo.removeComment(TRIP_ID, randomUUID(), actor);
      expect(removed).toBe(false);
      assertStoreMatchesModel(m, r);
      return;
    }

    const commentId = ids[this.commentPicker % ids.length]!;
    const expected = m.comments.get(commentId)!;

    if (actor === expected.authorId) {
      // R13.11: the author's own removal deletes the comment.
      const removed = await r.repo.removeComment(TRIP_ID, commentId, actor);
      expect(removed).toBe(true);
      m.comments.delete(commentId);
    } else {
      // R13.12: a non-author is rejected and the comment is retained.
      await expect(
        r.repo.removeComment(TRIP_ID, commentId, actor),
      ).rejects.toMatchObject({ code: 'trip_forbidden' });
    }

    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    return `RemoveComment(pick=${this.commentPicker}, actor=${this.actingMemberIdx % MEMBER_IDS.length})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Trip reactions/comments — Property 23: add/remove lifecycle with at-most-one reaction per type', () => {
  it('persists exactly one reaction per (member, target, type) idempotently, removes own reactions, and adds/removes comments per the author + length rules', async () => {
    const memberIdx = fc.nat({ max: MEMBER_IDS.length - 1 });
    const targetIdx = fc.nat({ max: TARGETS.length - 1 });
    const reactionIdx = fc.nat({ max: TRIP_REACTION_VALUES.length - 1 });

    // Comment bodies: valid (1–2000 after trim), empty-after-trim, over-long.
    const validBody = fc
      .tuple(
        fc.constantFrom('a', 'ride', 'Loved it', 'Best day', '🎢', 'x'),
        fc.string({ maxLength: 20 }),
      )
      .map(([core, pad]) => `${pad}${core}${pad}`);
    const emptyBody = fc.constantFrom('', ' ', '   ', '\t', '\n \t ');
    const overLongBody = fc
      .integer({ min: 2001, max: 2100 })
      .map((n) => 'a'.repeat(n));
    const bodyArb = fc.oneof(
      { weight: 6, arbitrary: validBody },
      { weight: 2, arbitrary: emptyBody },
      { weight: 1, arbitrary: overLongBody },
    );

    const addReactionArb = fc
      .tuple(memberIdx, targetIdx, reactionIdx)
      .map(([mi, ti, ri]) => new AddReactionCommand(mi, ti, ri));
    const removeReactionArb = fc
      .tuple(memberIdx, targetIdx, reactionIdx)
      .map(([mi, ti, ri]) => new RemoveReactionCommand(mi, ti, ri));
    const addCommentArb = fc
      .tuple(memberIdx, targetIdx, bodyArb)
      .map(([mi, ti, body]) => new AddCommentCommand(mi, ti, body));
    const removeCommentArb = fc
      .tuple(fc.nat({ max: 1000 }), memberIdx)
      .map(([pick, mi]) => new RemoveCommentCommand(pick, mi));

    const commandArb = fc.oneof(
      addReactionArb,
      removeReactionArb,
      addCommentArb,
      removeCommentArb,
    );

    await fc.assert(
      fc.asyncProperty(
        fc.commands([commandArb], { maxCommands: MAX_COMMANDS }),
        async (cmds) => {
          const store = makeStore();
          const repo = createTripRepo(
            makeFakePool(store) as unknown as DbPool,
            NOOP_DEPS,
          );
          const setup: fc.ModelRunSetup<Model, Real> = () => ({
            model: { reactions: new Set<string>(), comments: new Map() },
            real: { store, repo },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
