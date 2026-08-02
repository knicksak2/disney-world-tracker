// Feature: trips, Property 15: Invites require the target to be a Friend of the organizer
/**
 * Property-based test for `sendInvite` (task 6.3).
 *
 * Validates: Requirements 6.2, 6.4, 6.5
 *
 * Design Property 15 (design.md → Correctness Properties): *for any* invite
 * request, the Trip_Service creates a `pending` Trip_Invite **only when** the
 * target is a Friend of the sending Organizer and is neither already a
 * Trip_Member nor the holder of a `pending` invite; otherwise the request is
 * rejected with no invite and no duplicate membership created. Concretely:
 *
 *   - a `pending` Trip_Invite is created iff the target is a Friend of the
 *     inviter AND not already a Trip_Member AND holds no `pending` invite for
 *     the Trip (R6.2, R6.4, R6.5),
 *   - a target who is not a Friend is rejected with `trip_not_friend` and no
 *     invite is written (R6.2),
 *   - a target who is already a Trip_Member is rejected with
 *     `trip_invite_duplicate`, no invite is written, and no duplicate
 *     membership is created (R6.4),
 *   - a target who already holds a `pending` invite is rejected with
 *     `trip_invite_duplicate` and no second `pending` invite is written (R6.5).
 *
 * Test strategy: a `fast-check` `commands`-style state-machine test driven over
 * the real `createTripRepo` factory (task 6.1) backed by a tiny in-memory fake
 * `pg.Pool` that models the three tables `sendInvite` reads and writes inside
 * its one transaction — `trip_memberships`, `friendships`, and `trip_invites`
 * (per the tasks.md convention; the SQL repo is pinned to the same behaviour by
 * the cross-service integration tests). The fake pool dispatches exactly the
 * SQL fragments `sendInvite` emits (`BEGIN`, the membership `SELECT`, the
 * friendship `EXISTS`, the pending-invite `SELECT`, the `INSERT ... RETURNING`,
 * and `COMMIT` / `ROLLBACK`) against a snapshot-per-transaction layer, and it
 * enforces the partial unique index `trip_invites_one_pending_idx` on insert as
 * the production DB would, so the property exercises the production code path
 * rather than a reimplementation of it.
 *
 * `AddFriendship` and `AddMembership` commands seed varied world state directly
 * (they model prior friend/join activity), and each `SendInvite` command
 * computes the expected outcome from the world state observed immediately
 * before the call, then asserts the created-iff invariant, the specific
 * rejection code, and the no-side-effect guarantee on failure. A small fixed
 * pool of users and trips keeps friend/member/pending collisions frequent.
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import type { CompletionRepo } from '../../tracking/completion/repo.js';
import type { RatingRepo } from '../../tracking/rating/repo.js';
import { createTripRepo, type TripRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 40;

/** Postgres SQLSTATE for the `unique_violation` the partial index raises. */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Fixed universe of user and trip ids. Keeping the pools small makes the
 * generator hit the interesting overlaps — inviting an existing Member, an
 * already-pending invitee, or a non-Friend — far more often than fresh UUIDs
 * would. They are only identifiers; the store is created fresh per run.
 */
const USER_IDS: readonly string[] = Array.from({ length: 5 }, () => randomUUID());
const TRIP_IDS: readonly string[] = Array.from({ length: 3 }, () => randomUUID());

// ---------------------------------------------------------------------------
// In-memory model of the tables sendInvite reads and writes
// ---------------------------------------------------------------------------

/** A row of the `trip_invites` table (only the columns sendInvite touches). */
interface InviteRow {
  readonly id: string;
  readonly tripId: string;
  readonly inviterId: string;
  readonly inviteeId: string;
  state: string;
}

/**
 * The whole backing store. `friendships` holds canonical `"lo|hi"` pair keys
 * (mirroring the single canonical row per relationship), `memberships` maps a
 * Trip to its Member ids, and `invites` is the `trip_invites` table.
 */
interface Store {
  friendships: Set<string>;
  memberships: Map<string, Set<string>>;
  invites: InviteRow[];
}

function makeStore(): Store {
  return { friendships: new Set(), memberships: new Map(), invites: [] };
}

/** Canonical friendship key, matching the repo's `canonicalPair` ordering. */
function friendshipKey(a: string, b: string): string {
  const { lo, hi } = canonicalPair(a, b);
  return `${lo}|${hi}`;
}

/** Deep copy of the store for a transaction snapshot. */
function snapshot(store: Store): Store {
  const memberships = new Map<string, Set<string>>();
  for (const [tripId, members] of store.memberships) {
    memberships.set(tripId, new Set(members));
  }
  return {
    friendships: new Set(store.friendships),
    memberships,
    invites: store.invites.map((i) => ({ ...i })),
  };
}

interface QueryResult {
  rows: unknown[];
  rowCount: number;
}

interface FakeClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<QueryResult>;
  release(): void;
}

/** The minimal `pg.Pool` shape `sendInvite` touches (`connect()` only). */
interface FakePool {
  connect(): Promise<FakeClient>;
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it. Only the SQL fragments
 * `sendInvite` emits are modelled; anything else fails loudly so a future SQL
 * drift is surfaced by the test rather than silently ignored.
 */
function makeFakePool(store: Store): FakePool {
  return {
    async connect(): Promise<FakeClient> {
      let tx: Store | null = null;
      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<QueryResult> {
          const t = text.trim();

          // ---- transaction control ---------------------------------
          if (t.startsWith('BEGIN')) {
            tx = snapshot(store);
            return { rows: [], rowCount: 0 };
          }
          if (t.startsWith('COMMIT')) {
            if (tx === null) {
              throw new Error('COMMIT without BEGIN');
            }
            store.friendships = new Set(tx.friendships);
            const memberships = new Map<string, Set<string>>();
            for (const [tripId, members] of tx.memberships) {
              memberships.set(tripId, new Set(members));
            }
            store.memberships = memberships;
            store.invites = tx.invites.map((i) => ({ ...i }));
            tx = null;
            return { rows: [], rowCount: 0 };
          }
          if (t.startsWith('ROLLBACK')) {
            tx = null;
            return { rows: [], rowCount: 0 };
          }

          if (tx === null) {
            throw new Error(
              `data-plane query without BEGIN: ${t.slice(0, 64)}`,
            );
          }

          // ---- membership check (R6.4) ------------------------------
          if (t.startsWith('SELECT 1 FROM trip_memberships')) {
            const tripId = String(params[0]);
            const userId = String(params[1]);
            const has = tx.memberships.get(tripId)?.has(userId) ?? false;
            return { rows: has ? [{ ok: 1 }] : [], rowCount: has ? 1 : 0 };
          }

          // ---- friendship EXISTS check (R6.2) -----------------------
          if (t.startsWith('SELECT EXISTS')) {
            const lo = String(params[0]);
            const hi = String(params[1]);
            const exists = tx.friendships.has(`${lo}|${hi}`);
            return { rows: [{ exists }], rowCount: 1 };
          }

          // ---- pending-invite check (R6.5) --------------------------
          if (t.startsWith('SELECT 1 FROM trip_invites')) {
            const tripId = String(params[0]);
            const inviteeId = String(params[1]);
            const has = tx.invites.some(
              (i) =>
                i.tripId === tripId &&
                i.inviteeId === inviteeId &&
                i.state === 'pending',
            );
            return { rows: has ? [{ ok: 1 }] : [], rowCount: has ? 1 : 0 };
          }

          // ---- INSERT INTO trip_invites ... RETURNING id ------------
          if (t.startsWith('INSERT INTO trip_invites')) {
            const tripId = String(params[0]);
            const inviterId = String(params[1]);
            const inviteeId = String(params[2]);
            // Partial unique index `trip_invites_one_pending_idx`: at most one
            // pending invite per (trip, invitee). A racing insert collides here
            // exactly as Postgres would, surfacing SQLSTATE 23505.
            const collides = tx.invites.some(
              (i) =>
                i.tripId === tripId &&
                i.inviteeId === inviteeId &&
                i.state === 'pending',
            );
            if (collides) {
              const err = new Error(
                'duplicate key value violates unique constraint "trip_invites_one_pending_idx"',
              ) as Error & { code: string };
              err.code = PG_UNIQUE_VIOLATION;
              throw err;
            }
            const id = randomUUID();
            tx.invites.push({
              id,
              tripId,
              inviterId,
              inviteeId,
              state: 'pending',
            });
            return { rows: [{ id }], rowCount: 1 };
          }

          throw new Error(`unhandled SQL in fake pool: ${t.slice(0, 64)}`);
        },
        release(): void {
          // Drop any un-committed snapshot, matching PoolClient.release().
          tx = null;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Stub canonical repos (sendInvite never touches them; the factory requires
// them, and later log/confirm operations will use them).
// ---------------------------------------------------------------------------

function makeUnusedCompletionRepo(): CompletionRepo {
  const fail = (): never => {
    throw new Error('sendInvite must not touch the canonical Completion repo');
  };
  return {
    mark: fail,
    edit: fail,
    getCompletion: fail,
    unmark: fail,
  } as unknown as CompletionRepo;
}

function makeUnusedRatingRepo(): RatingRepo {
  const fail = (): never => {
    throw new Error('sendInvite must not touch the canonical Rating repo');
  };
  return {
    setRating: fail,
    removeRating: fail,
    getRating: fail,
  } as unknown as RatingRepo;
}

// ---------------------------------------------------------------------------
// Store query helpers (the oracle reads these before each SendInvite)
// ---------------------------------------------------------------------------

function isMember(store: Store, tripId: string, userId: string): boolean {
  return store.memberships.get(tripId)?.has(userId) ?? false;
}

function areFriends(store: Store, a: string, b: string): boolean {
  return store.friendships.has(friendshipKey(a, b));
}

function hasPendingInvite(
  store: Store,
  tripId: string,
  inviteeId: string,
): boolean {
  return store.invites.some(
    (i) =>
      i.tripId === tripId && i.inviteeId === inviteeId && i.state === 'pending',
  );
}

function pendingInvitesFor(
  store: Store,
  tripId: string,
  inviteeId: string,
): InviteRow[] {
  return store.invites.filter(
    (i) =>
      i.tripId === tripId && i.inviteeId === inviteeId && i.state === 'pending',
  );
}

/** Snapshot of every Trip's membership set sizes, for a no-mutation assertion. */
function membershipSizes(store: Store): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const [tripId, members] of store.memberships) {
    sizes.set(tripId, members.size);
  }
  return sizes;
}

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

// The oracle reads directly from the real store immediately before each call,
// so the model carries no mirrored state.
type Model = Record<string, never>;

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `AddFriendship(a, b)`: seed a canonical friendship pair, modelling prior
 * Friends_Service activity. A no-op when `a === b` (a self-friend is
 * unrepresentable). Mutates the store directly — it is test setup, not a Trip
 * operation.
 */
class AddFriendshipCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly a: string,
    public readonly b: string,
  ) {}

  check(): boolean {
    return this.a !== this.b;
  }

  async run(_m: Model, r: Real): Promise<void> {
    r.store.friendships.add(friendshipKey(this.a, this.b));
  }

  toString(): string {
    return `AddFriendship(${this.a.slice(0, 8)}, ${this.b.slice(0, 8)})`;
  }
}

/**
 * `AddMembership(tripId, userId)`: seed a Trip_Membership, modelling a User who
 * has already joined the Trip. Mutates the store directly.
 */
class AddMembershipCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly tripId: string,
    public readonly userId: string,
  ) {}

  check(): boolean {
    return true;
  }

  async run(_m: Model, r: Real): Promise<void> {
    let members = r.store.memberships.get(this.tripId);
    if (!members) {
      members = new Set<string>();
      r.store.memberships.set(this.tripId, members);
    }
    members.add(this.userId);
  }

  toString(): string {
    return `AddMembership(${this.tripId.slice(0, 8)}, ${this.userId.slice(0, 8)})`;
  }
}

/**
 * `SendInvite(tripId, inviterId, inviteeId)`: attempt an invite and assert
 * Property 15. `inviterId !== inviteeId` is guaranteed by the generator so the
 * canonical-pair friendship lookup is always well-formed (a self-invite is a
 * distinct concern absorbed by the membership check and covered elsewhere).
 */
class SendInviteCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly tripId: string,
    public readonly inviterId: string,
    public readonly inviteeId: string,
  ) {}

  check(): boolean {
    return this.inviterId !== this.inviteeId;
  }

  async run(_m: Model, r: Real): Promise<void> {
    const { store, repo } = r;

    // Oracle: observe the world state the invite decision depends on, exactly
    // as the repo evaluates it and in the same precedence order.
    const alreadyMember = isMember(store, this.tripId, this.inviteeId);
    const isFriend = areFriends(store, this.inviterId, this.inviteeId);
    const pending = hasPendingInvite(store, this.tripId, this.inviteeId);
    const shouldCreate = isFriend && !alreadyMember && !pending;

    const beforeInviteCount = store.invites.length;
    const beforePending = pendingInvitesFor(
      store,
      this.tripId,
      this.inviteeId,
    ).length;
    const beforeMembershipSizes = membershipSizes(store);

    if (shouldCreate) {
      const created = await repo.sendInvite(
        this.tripId,
        this.inviterId,
        this.inviteeId,
      );

      // A fresh `pending` Trip_Invite is created and its identity is returned
      // with the routing fields the post-commit notification needs (R6.1).
      expect(created.tripId).toBe(this.tripId);
      expect(created.inviterId).toBe(this.inviterId);
      expect(created.inviteeId).toBe(this.inviteeId);
      expect(typeof created.inviteId).toBe('string');
      expect(created.inviteId.length).toBeGreaterThan(0);

      // Exactly one new invite row exists, it is the returned one, and it is
      // `pending` for this (trip, invitee).
      expect(store.invites.length).toBe(beforeInviteCount + 1);
      const row = store.invites.find((i) => i.id === created.inviteId);
      expect(row).toBeDefined();
      expect(row?.tripId).toBe(this.tripId);
      expect(row?.inviterId).toBe(this.inviterId);
      expect(row?.inviteeId).toBe(this.inviteeId);
      expect(row?.state).toBe('pending');
      expect(
        pendingInvitesFor(store, this.tripId, this.inviteeId),
      ).toHaveLength(beforePending + 1);
    } else {
      // The request is rejected with a domain error and the specific code
      // matches the repo's check precedence: membership (R6.4) before
      // friendship (R6.2) before pending (R6.5).
      let thrown: unknown;
      try {
        await repo.sendInvite(this.tripId, this.inviterId, this.inviteeId);
        expect.unreachable('sendInvite should have rejected the request');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AppError);
      const code = (thrown as AppError).code;
      if (alreadyMember) {
        expect(code).toBe('trip_invite_duplicate');
      } else if (!isFriend) {
        expect(code).toBe('trip_not_friend');
      } else {
        expect(code).toBe('trip_invite_duplicate');
      }

      // No invite was written and no membership was created or duplicated.
      expect(store.invites.length).toBe(beforeInviteCount);
      expect(
        pendingInvitesFor(store, this.tripId, this.inviteeId),
      ).toHaveLength(beforePending);
      expect(membershipSizes(store)).toEqual(beforeMembershipSizes);
    }
  }

  toString(): string {
    return `SendInvite(trip=${this.tripId.slice(0, 8)}, inviter=${this.inviterId.slice(0, 8)}, invitee=${this.inviteeId.slice(0, 8)})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('sendInvite — Property 15: invites require the target to be a Friend of the organizer', () => {
  it('creates a pending invite iff the target is a Friend, not already a Member, and has no pending invite', async () => {
    const userArb = fc.constantFrom(...USER_IDS);
    const tripArb = fc.constantFrom(...TRIP_IDS);

    const addFriendshipArb = fc
      .tuple(userArb, userArb)
      .map(([a, b]) => new AddFriendshipCommand(a, b));

    const addMembershipArb = fc
      .tuple(tripArb, userArb)
      .map(([tripId, userId]) => new AddMembershipCommand(tripId, userId));

    const sendInviteArb = fc
      .tuple(tripArb, userArb, userArb)
      .map(
        ([tripId, inviterId, inviteeId]) =>
          new SendInviteCommand(tripId, inviterId, inviteeId),
      );

    const commandArb = fc.commands(
      [addFriendshipArb, addMembershipArb, sendInviteArb],
      { maxCommands: MAX_COMMANDS },
    );

    await fc.assert(
      fc.asyncProperty(commandArb, async (cmds) => {
        const store = makeStore();
        const repo = createTripRepo(makeFakePool(store) as unknown as DbPool, {
          completions: makeUnusedCompletionRepo(),
          ratings: makeUnusedRatingRepo(),
        });
        const setup: fc.ModelRunSetup<Model, Real> = () => ({
          model: {},
          real: { store, repo },
        });
        await fc.asyncModelRun(setup, cmds);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
