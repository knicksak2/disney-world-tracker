// Feature: trips, Property 13: Ownership-scoped actions are limited to the owning Trip_Member
/**
 * Property-based test for owner/author/target-scoped Trip actions (task 11.4).
 *
 * **Validates: Requirements 7.4, 9.8, 11.7, 13.12**
 *
 * Design Property 13 (design.md → Correctness Properties):
 *
 *   An action scoped to a specific Trip_Member — accepting/declining an invite
 *   addressed to the invitee (R7.4), removing a Planned_Item (permitted for the
 *   adder or any Organizer, R9.8), confirming/declining a Rode_With_Tag (only
 *   the Tagged_Member, R11.7), and removing a Trip_Comment (only the author,
 *   R13.12) — succeeds only for the owning Trip_Member and is rejected with
 *   `trip_forbidden` for anyone else, leaving the persisted state unchanged.
 *
 * Test strategy
 * -------------
 * Per the tasks.md convention this stateful property runs against an in-memory
 * model of the repo. A tiny fake `pg.Pool` drives the *real* `createTripRepo`
 * factory so the property exercises the production ownership checks in
 * `removePlannedItem` (R9.8), `removeComment` (R13.12), and `declineRodeWithTag`
 * (R11.7) — three action families, one per owner/author/target scope — rather
 * than a re-implementation of them. Each of those operations is a `connect()`
 * transaction; the fake pool models exactly the SQL they emit (the
 * `... FOR UPDATE` ownership probe, the terminal `DELETE`/`UPDATE`, and
 * `BEGIN`/`COMMIT`/`ROLLBACK`), snapshotting the store per transaction so a
 * `ROLLBACK` faithfully discards any partial write and tolerating the double
 * `ROLLBACK` the repo issues on the rejection path (explicit rollback + the
 * `catch`'s `safeRollback`).
 *
 * The Trip has a fixed membership with fixed roles (one Organizer, three
 * Members). Seed commands add Planned_Items / Trip_Comments / Rode_With_Tags
 * directly into the store (the readProjections property uses the same
 * seed-directly pattern), each owned by a chosen Member. The action commands
 * then attempt a removal/decline as an arbitrary acting Member and assert the
 * ownership rule:
 *   - RemovePlannedItem: the adder or an Organizer succeeds and the item is
 *     gone (R9.6/R9.7); any other Member is rejected with `trip_forbidden` and
 *     the store is byte-for-byte unchanged (R9.8).
 *   - RemoveComment: the author succeeds and the comment is gone (R13.11); any
 *     other Member is rejected with `trip_forbidden` and the store is unchanged
 *     (R13.12).
 *   - DeclineTag: the Tagged_Member declines a pending tag and its state flips
 *     to `declined`; any other Member is rejected with `trip_forbidden` and the
 *     store is unchanged (R11.7).
 *
 * "Byte-for-byte unchanged" is asserted by comparing a canonical serialization
 * of the whole store captured immediately before the call against the store
 * after the rejection. After every command the store is also re-checked against
 * an independent model oracle, so the property proves both halves of Property
 * 13: the owning Member's action takes effect and a non-owner's action is
 * rejected with no state change.
 *
 * `numRuns: 150` (≥100 per the spec convention).
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { RodeWithTagState } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import type { TripRole } from '../permissions.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 150;
const MAX_COMMANDS = 40;

/** The fixed Trip every seeded row in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * The fixed Trip_Members and their roles. One Organizer (who may remove any
 * Planned_Item, R9.7) and three plain Members. Any of them may act, so the
 * ownership rule is exercised for owners, non-owners, and — for Planned_Items —
 * the Organizer bypass.
 */
interface Member {
  readonly userId: string;
  readonly role: TripRole;
}
const MEMBERS: readonly Member[] = [
  { userId: '00000000-0000-4000-8000-000000000000', role: 'organizer' },
  { userId: '11111111-1111-4111-8111-111111111111', role: 'member' },
  { userId: '22222222-2222-4222-8222-222222222222', role: 'member' },
  { userId: '33333333-3333-4333-8333-333333333333', role: 'member' },
] as const;

function memberOf(idx: number): Member {
  return MEMBERS[idx % MEMBERS.length]!;
}

// ---------------------------------------------------------------------------
// In-memory store: the tables the owner-scoped operations touch
// ---------------------------------------------------------------------------

type PlannedMap = Map<string, { addedBy: string }>;
type CommentMap = Map<string, { authorId: string }>;
type TagMap = Map<string, { taggedMemberId: string; state: RodeWithTagState }>;

/**
 * A canonical, order-independent serialization of the three mutable tables.
 * Used both to assert the store matches the model oracle and to prove a
 * rejected action leaves the persisted state byte-for-byte unchanged.
 */
function serialize(
  planned: PlannedMap,
  comments: CommentMap,
  tags: TagMap,
): string {
  const p = [...planned.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, v]) => [id, v.addedBy]);
  const c = [...comments.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, v]) => [id, v.authorId]);
  const t = [...tags.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, v]) => [id, v.taggedMemberId, v.state]);
  return JSON.stringify({ planned: p, comments: c, tags: t });
}

/**
 * The whole backing store. Each table is snapshotted per transaction so a
 * `ROLLBACK` discards partial writes exactly like Postgres.
 */
interface Store {
  plannedItems: PlannedMap;
  comments: CommentMap;
  tags: TagMap;
}

function makeStore(): Store {
  return { plannedItems: new Map(), comments: new Map(), tags: new Map() };
}

function serializeStore(s: Store): string {
  return serialize(s.plannedItems, s.comments, s.tags);
}

interface Tx {
  plannedItems: PlannedMap;
  comments: CommentMap;
  tags: TagMap;
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
 * Build a fake pool that models exactly the SQL the three owner-scoped
 * operations emit, all of which run inside a `connect()` transaction. The
 * per-transaction snapshot is applied on `COMMIT` and discarded on `ROLLBACK`;
 * a `ROLLBACK` while already rolled back (the repo's explicit rollback followed
 * by `safeRollback` in its `catch`) is a tolerated no-op. Anything else fails
 * loudly so a future SQL drift is surfaced by the test rather than ignored.
 */
interface FakePool {
  connect(): Promise<FakeClient>;
}

function makeFakePool(store: Store): FakePool {
  const ok = (rows: unknown[]): QueryResult => ({ rows, rowCount: rows.length });

  return {
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
              plannedItems: new Map(store.plannedItems),
              comments: new Map(store.comments),
              tags: new Map(store.tags),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.plannedItems = new Map(tx.plannedItems);
            store.comments = new Map(tx.comments);
            store.tags = new Map(tx.tags);
            tx = null;
            return ok([]);
          }
          if (sql.startsWith('ROLLBACK')) {
            // Tolerate the repo's double rollback on the rejection path.
            tx = null;
            return ok([]);
          }

          if (tx === null) {
            throw new Error(`data-plane query without BEGIN: ${sql.slice(0, 64)}`);
          }

          // --- removePlannedItem (R9.6/R9.7/R9.8) --------------------------
          if (sql.startsWith('SELECT added_by FROM planned_items')) {
            const [itemId, tripId] = params as [string, string];
            const row =
              tripId === TRIP_ID ? tx.plannedItems.get(itemId) : undefined;
            return ok(row ? [{ added_by: row.addedBy }] : []);
          }
          if (sql.startsWith('DELETE FROM planned_items')) {
            const [itemId] = params as [string];
            tx.plannedItems.delete(itemId);
            return ok([]);
          }

          // --- removeComment (R13.11/R13.12) -------------------------------
          if (sql.startsWith('SELECT author_id FROM trip_comments')) {
            const [commentId, tripId] = params as [string, string];
            const row =
              tripId === TRIP_ID ? tx.comments.get(commentId) : undefined;
            return ok(row ? [{ author_id: row.authorId }] : []);
          }
          if (sql.startsWith('DELETE FROM trip_comments')) {
            const [commentId] = params as [string];
            tx.comments.delete(commentId);
            return ok([]);
          }

          // --- declineRodeWithTag (R11.6/R11.7/R11.8) ----------------------
          if (sql.startsWith('SELECT state, tagged_member_id FROM rode_with_tags')) {
            const [tagId] = params as [string];
            const row = tx.tags.get(tagId);
            return ok(
              row
                ? [{ state: row.state, tagged_member_id: row.taggedMemberId }]
                : [],
            );
          }
          if (sql.startsWith("UPDATE rode_with_tags SET state = 'declined'")) {
            const [tagId] = params as [string];
            const row = tx.tags.get(tagId);
            if (row) tx.tags.set(tagId, { ...row, state: 'declined' });
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

/** The owner-scoped operations never touch the canonical repos; stand-ins suffice. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface Model {
  plannedItems: PlannedMap;
  comments: CommentMap;
  tags: TagMap;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

/** Re-checked after every command: the persisted store equals the model oracle. */
function assertStoreMatchesModel(m: Model, r: Real): void {
  expect(serializeStore(r.store)).toBe(
    serialize(m.plannedItems, m.comments, m.tags),
  );
}

/**
 * Assert `fn` rejects with an {@link AppError} carrying `code`, executing it
 * exactly once so a state-mutating call is not run twice.
 */
async function expectAppError(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  let threw = false;
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    threw = true;
    err = e;
  }
  expect(threw).toBe(true);
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

// ---------------------------------------------------------------------------
// Seed commands (write directly into store + model)
// ---------------------------------------------------------------------------

/** Seed a Planned_Item added by a chosen Member. */
class AddPlannedItemCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly adderIdx: number) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const adder = memberOf(this.adderIdx).userId;
    const id = randomUUID();
    r.store.plannedItems.set(id, { addedBy: adder });
    m.plannedItems.set(id, { addedBy: adder });
    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    return `AddPlannedItem(adder=${this.adderIdx % MEMBERS.length})`;
  }
}

/** Seed a Trip_Comment authored by a chosen Member. */
class AddCommentCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly authorIdx: number) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const author = memberOf(this.authorIdx).userId;
    const id = randomUUID();
    r.store.comments.set(id, { authorId: author });
    m.comments.set(id, { authorId: author });
    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    return `AddComment(author=${this.authorIdx % MEMBERS.length})`;
  }
}

/** Seed a `pending` Rode_With_Tag naming a chosen Member as Tagged_Member. */
class AddTagCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly taggedIdx: number) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const tagged = memberOf(this.taggedIdx).userId;
    const id = randomUUID();
    r.store.tags.set(id, { taggedMemberId: tagged, state: 'pending' });
    m.tags.set(id, { taggedMemberId: tagged, state: 'pending' });
    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    return `AddTag(tagged=${this.taggedIdx % MEMBERS.length})`;
  }
}

// ---------------------------------------------------------------------------
// Action commands (exercise the real ownership checks)
// ---------------------------------------------------------------------------

/**
 * `RemovePlannedItem(itemPicker, actorIdx)`: the adder or an Organizer removes
 * the item (R9.6/R9.7); any other Member is rejected with `trip_forbidden` and
 * the store is byte-for-byte unchanged (R9.8). An empty list exercises the
 * unknown-id → `false` path.
 */
class RemovePlannedItemCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly itemPicker: number,
    public readonly actorIdx: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const actor = memberOf(this.actorIdx);
    const ids = [...m.plannedItems.keys()].sort();
    const before = serializeStore(r.store);

    if (ids.length === 0) {
      const removed = await r.repo.removePlannedItem(
        TRIP_ID,
        randomUUID(),
        actor.userId,
        actor.role,
      );
      expect(removed).toBe(false);
      expect(serializeStore(r.store)).toBe(before);
      assertStoreMatchesModel(m, r);
      return;
    }

    const itemId = ids[this.itemPicker % ids.length]!;
    const item = m.plannedItems.get(itemId)!;
    const authorized = actor.role === 'organizer' || item.addedBy === actor.userId;

    if (authorized) {
      const removed = await r.repo.removePlannedItem(
        TRIP_ID,
        itemId,
        actor.userId,
        actor.role,
      );
      expect(removed).toBe(true);
      m.plannedItems.delete(itemId);
    } else {
      await expectAppError(
        () =>
          r.repo.removePlannedItem(TRIP_ID, itemId, actor.userId, actor.role),
        'trip_forbidden',
      );
      // R9.8: a non-owner, non-organizer removal leaves the item in place.
      expect(serializeStore(r.store)).toBe(before);
    }

    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    return `RemovePlannedItem(pick=${this.itemPicker}, actor=${this.actorIdx % MEMBERS.length})`;
  }
}

/**
 * `RemoveComment(commentPicker, actorIdx)`: the author removes their comment
 * (R13.11); any other Member is rejected with `trip_forbidden` and the comment
 * is retained (R13.12). An empty set exercises the unknown-id → `false` path.
 */
class RemoveCommentCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly commentPicker: number,
    public readonly actorIdx: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const actor = memberOf(this.actorIdx);
    const ids = [...m.comments.keys()].sort();
    const before = serializeStore(r.store);

    if (ids.length === 0) {
      const removed = await r.repo.removeComment(TRIP_ID, randomUUID(), actor.userId);
      expect(removed).toBe(false);
      expect(serializeStore(r.store)).toBe(before);
      assertStoreMatchesModel(m, r);
      return;
    }

    const commentId = ids[this.commentPicker % ids.length]!;
    const comment = m.comments.get(commentId)!;

    if (comment.authorId === actor.userId) {
      const removed = await r.repo.removeComment(TRIP_ID, commentId, actor.userId);
      expect(removed).toBe(true);
      m.comments.delete(commentId);
    } else {
      await expectAppError(
        () => r.repo.removeComment(TRIP_ID, commentId, actor.userId),
        'trip_forbidden',
      );
      // R13.12: a non-author removal leaves the comment in place.
      expect(serializeStore(r.store)).toBe(before);
    }

    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    return `RemoveComment(pick=${this.commentPicker}, actor=${this.actorIdx % MEMBERS.length})`;
  }
}

/**
 * `DeclineTag(tagPicker, actorIdx)`: the Tagged_Member declines a pending tag,
 * flipping its state to `declined` (R11.6); any other Member is rejected with
 * `trip_forbidden` and the tag is unchanged (R11.7). A tag the caller owns but
 * that is no longer pending is a state conflict (`trip_tag_state_invalid`) with
 * no change; an empty set exercises the unknown-id → `trip_forbidden` path.
 */
class DeclineTagCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly tagPicker: number,
    public readonly actorIdx: number,
  ) {}

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const actor = memberOf(this.actorIdx);
    const ids = [...m.tags.keys()].sort();
    const before = serializeStore(r.store);

    if (ids.length === 0) {
      // Unknown tag → non-probing trip_forbidden, nothing changes (R11.7).
      await expectAppError(
        () => r.repo.declineRodeWithTag(randomUUID(), actor.userId),
        'trip_forbidden',
      );
      expect(serializeStore(r.store)).toBe(before);
      assertStoreMatchesModel(m, r);
      return;
    }

    const tagId = ids[this.tagPicker % ids.length]!;
    const tag = m.tags.get(tagId)!;
    const isOwner = tag.taggedMemberId === actor.userId;

    if (!isOwner) {
      // R11.7: only the Tagged_Member may act; anyone else is rejected and the
      // tag is left untouched.
      await expectAppError(
        () => r.repo.declineRodeWithTag(tagId, actor.userId),
        'trip_forbidden',
      );
      expect(serializeStore(r.store)).toBe(before);
    } else if (tag.state === 'pending') {
      await r.repo.declineRodeWithTag(tagId, actor.userId);
      m.tags.set(tagId, { ...tag, state: 'declined' });
    } else {
      // Owner, but the tag is already terminal → a state conflict, not an
      // ownership rejection, and nothing changes.
      await expectAppError(
        () => r.repo.declineRodeWithTag(tagId, actor.userId),
        'trip_tag_state_invalid',
      );
      expect(serializeStore(r.store)).toBe(before);
    }

    assertStoreMatchesModel(m, r);
  }

  toString(): string {
    return `DeclineTag(pick=${this.tagPicker}, actor=${this.actorIdx % MEMBERS.length})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Trip owner-scoped actions — Property 13: ownership-scoped actions are limited to the owning Trip_Member', () => {
  it('lets the owner (or Organizer for planned items) act and rejects everyone else with trip_forbidden, leaving state unchanged', async () => {
    const memberIdx = fc.nat({ max: MEMBERS.length - 1 });
    const picker = fc.nat({ max: 1000 });

    const addPlannedArb = memberIdx.map((i) => new AddPlannedItemCommand(i));
    const addCommentArb = memberIdx.map((i) => new AddCommentCommand(i));
    const addTagArb = memberIdx.map((i) => new AddTagCommand(i));
    const removePlannedArb = fc
      .tuple(picker, memberIdx)
      .map(([p, a]) => new RemovePlannedItemCommand(p, a));
    const removeCommentArb = fc
      .tuple(picker, memberIdx)
      .map(([p, a]) => new RemoveCommentCommand(p, a));
    const declineTagArb = fc
      .tuple(picker, memberIdx)
      .map(([p, a]) => new DeclineTagCommand(p, a));

    const commandArb = fc.oneof(
      addPlannedArb,
      addCommentArb,
      addTagArb,
      removePlannedArb,
      removeCommentArb,
      declineTagArb,
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
            model: {
              plannedItems: new Map(),
              comments: new Map(),
              tags: new Map(),
            },
            real: { store, repo },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
