// Feature: trips, Property 14: A Trip_Invite follows the pending→terminal state machine
/**
 * Property-based test for the Trip_Invite state machine (task 6.2).
 *
 * Validates: Requirements 6.1, 6.8, 7.1, 7.2, 7.3, 7.5
 *
 * Design Property 14 (design.md → Correctness Properties):
 *
 *   For any Trip_Invite, sending creates it in the `pending` state; accepting a
 *   `pending` invite addressed to the caller sets it `accepted` and adds a
 *   `member` Trip_Membership (idempotently, never a duplicate); declining sets
 *   it `declined` with no membership; cancelling sets it to a terminal state
 *   after which acceptance is rejected while a fresh invite may be sent; and
 *   any accept/decline/cancel of a non-`pending` invite is rejected with the
 *   invite unchanged.
 *
 * Test strategy
 * -------------
 * A `fast-check` `commands`-style state-machine test driven over the real
 * `createTripRepo` factory (task 6.1) backed by a tiny in-memory fake `pg.Pool`
 * that models exactly the tables the invite operations touch — `friendships`
 * (seeded, read-only), `trip_memberships`, `trip_invites`, and
 * `trip_feed_items`. The fake pool dispatches the SQL fragments the repo emits
 * (`BEGIN`, the pre-condition `SELECT`s, the state `UPDATE`s, the idempotent
 * membership / feed `INSERT`s, and `COMMIT` / `ROLLBACK`) to a
 * snapshot-per-transaction layer so the property exercises the production code
 * path (`sendInvite` / `cancelInvite` / `acceptInvite` / `declineInvite`)
 * rather than a re-implementation of it. Per the tasks.md convention the
 * stateful property runs against this in-memory model; the SQL repo is pinned
 * to the same behaviour by the cross-service integration tests (task 15.x).
 *
 * The scenario fixes one Trip with a single Organizer and a small pool of
 * candidate invitees, all seeded as Friends of the Organizer (the Friend
 * requirement is Property 15's concern, so here every send is friend-valid and
 * the focus is purely the state machine). A random interleaving of
 * send/accept/decline/cancel commands is generated; after every command a set
 * of global invariants is re-checked: model and store invite states agree, the
 * membership set agrees, no `(trip, user)` membership is ever duplicated, and
 * at most one `pending` invite exists per `(trip, invitee)`.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 40;

/** The fixed Trip every invite in a run belongs to. */
const TRIP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
/** The sole Organizer and inviter; a Member from the start. */
const ORGANIZER_ID = '00000000-0000-4000-8000-000000000000';
/** Candidate invitees, all seeded as Friends of the Organizer. */
const CANDIDATE_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;

type InviteState = 'pending' | 'accepted' | 'declined' | 'cancelled';

// ---------------------------------------------------------------------------
// In-memory model of the tables the invite operations touch
// ---------------------------------------------------------------------------

interface MembershipRow {
  readonly tripId: string;
  readonly userId: string;
  readonly role: string;
}

interface InviteRow {
  readonly id: string;
  readonly tripId: string;
  readonly inviterId: string;
  readonly inviteeId: string;
  state: InviteState;
}

interface FeedRow {
  readonly tripId: string;
  readonly type: string;
  readonly actorId: string;
}

/**
 * The whole backing store. `friendships` is a read-only set of canonical
 * `"lo|hi"` pairs seeded at setup; the mutable tables are snapshotted per
 * transaction so a `ROLLBACK` faithfully discards a rejected operation's
 * partial writes (the state machine's "rejected → invite unchanged" clause).
 */
interface Store {
  readonly friendships: ReadonlySet<string>;
  memberships: MembershipRow[];
  invites: Map<string, InviteRow>;
  feedItems: FeedRow[];
}

function makeStore(): Store {
  const friendships = new Set<string>();
  for (const candidate of CANDIDATE_IDS) {
    const { lo, hi } = canonicalPair(ORGANIZER_ID, candidate);
    friendships.add(`${lo}|${hi}`);
  }
  return {
    friendships,
    memberships: [{ tripId: TRIP_ID, userId: ORGANIZER_ID, role: 'organizer' }],
    invites: new Map(),
    feedItems: [],
  };
}

/** A mutable per-transaction snapshot of the store's mutable tables. */
interface Tx {
  memberships: MembershipRow[];
  invites: Map<string, InviteRow>;
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

/** Deep-copy an invite map so a transaction snapshot is fully isolated. */
function cloneInvites(src: Map<string, InviteRow>): Map<string, InviteRow> {
  const out = new Map<string, InviteRow>();
  for (const [id, row] of src) out.set(id, { ...row });
  return out;
}

/**
 * Build a fake pool whose `connect()` hands out clients backed by the shared
 * `Store`. Each client owns a per-transaction snapshot; `COMMIT` atomically
 * writes it back and `ROLLBACK` discards it. Only the SQL fragments the invite
 * operations emit are modelled; anything else fails loudly so a future SQL
 * drift is surfaced by the test rather than silently ignored.
 */
function makeFakePool(store: Store): FakePool {
  return {
    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;

      const ok = (
        rows: unknown[],
      ): { rows: unknown[]; rowCount: number } => ({
        rows,
        rowCount: rows.length,
      });

      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount: number }> {
          const sql = norm(text);

          // ---- transaction control ---------------------------------
          if (sql.startsWith('BEGIN')) {
            tx = {
              memberships: store.memberships.slice(),
              invites: cloneInvites(store.invites),
              feedItems: store.feedItems.slice(),
            };
            return ok([]);
          }
          if (sql.startsWith('COMMIT')) {
            if (tx === null) throw new Error('COMMIT without BEGIN');
            store.memberships = tx.memberships.slice();
            store.invites = cloneInvites(tx.invites);
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

          // ---- sendInvite: membership pre-check (R6.4) --------------
          if (sql.startsWith('SELECT 1 FROM trip_memberships')) {
            const [tripId, userId] = params as [string, string];
            const hit = tx.memberships.some(
              (m) => m.tripId === tripId && m.userId === userId,
            );
            return ok(hit ? [{ '?column?': 1 }] : []);
          }

          // ---- sendInvite: friendship pre-check (R6.2) --------------
          if (sql.startsWith('SELECT EXISTS') && sql.includes('friendships')) {
            const [lo, hi] = params as [string, string];
            const exists = store.friendships.has(`${lo}|${hi}`);
            return ok([{ exists }]);
          }

          // ---- sendInvite: no-pending-invite pre-check (R6.5) -------
          if (sql.startsWith('SELECT 1 FROM trip_invites')) {
            const [tripId, inviteeId] = params as [string, string];
            const hit = [...tx.invites.values()].some(
              (i) =>
                i.tripId === tripId &&
                i.inviteeId === inviteeId &&
                i.state === 'pending',
            );
            return ok(hit ? [{ '?column?': 1 }] : []);
          }

          // ---- cancelInvite: lock + read state, scoped to Trip ------
          if (sql.startsWith('SELECT state FROM trip_invites')) {
            const [inviteId, tripId] = params as [string, string];
            const row = tx.invites.get(inviteId);
            return ok(row && row.tripId === tripId ? [{ state: row.state }] : []);
          }

          // ---- acceptInvite: lock + read (trip, invitee, state) -----
          if (sql.startsWith('SELECT trip_id, invitee_id, state FROM trip_invites')) {
            const [inviteId] = params as [string];
            const row = tx.invites.get(inviteId);
            return ok(
              row
                ? [
                    {
                      trip_id: row.tripId,
                      invitee_id: row.inviteeId,
                      state: row.state,
                    },
                  ]
                : [],
            );
          }

          // ---- declineInvite: lock + read (invitee, state) ----------
          if (sql.startsWith('SELECT invitee_id, state FROM trip_invites')) {
            const [inviteId] = params as [string];
            const row = tx.invites.get(inviteId);
            return ok(
              row
                ? [{ invitee_id: row.inviteeId, state: row.state }]
                : [],
            );
          }

          // ---- state transition UPDATE ------------------------------
          if (sql.startsWith('UPDATE trip_invites')) {
            const stateMatch = /SET state = '(\w+)'/u.exec(sql);
            const nextState = stateMatch?.[1] as InviteState | undefined;
            const [inviteId] = params as [string];
            const row = tx.invites.get(inviteId);
            if (row && nextState) {
              row.state = nextState;
              return ok([{ id: row.id }]);
            }
            return ok([]);
          }

          // ---- sendInvite: create the pending invite ----------------
          if (sql.startsWith('INSERT INTO trip_invites')) {
            const [tripId, inviterId, inviteeId] = params as [
              string,
              string,
              string,
            ];
            // Model the partial unique index `trip_invites_one_pending_idx`:
            // at most one pending invite per (trip, invitee).
            const collision = [...tx.invites.values()].some(
              (i) =>
                i.tripId === tripId &&
                i.inviteeId === inviteeId &&
                i.state === 'pending',
            );
            if (collision) {
              throw Object.assign(new Error('duplicate pending invite'), {
                code: '23505',
              });
            }
            const id = randomUUID();
            tx.invites.set(id, {
              id,
              tripId,
              inviterId,
              inviteeId,
              state: 'pending',
            });
            return ok([{ id }]);
          }

          // ---- acceptInvite: idempotent membership insert (R7.2) ----
          if (sql.startsWith('INSERT INTO trip_memberships')) {
            const [tripId, userId] = params as [string, string];
            const already = tx.memberships.some(
              (m) => m.tripId === tripId && m.userId === userId,
            );
            if (!already) {
              tx.memberships.push({ tripId, userId, role: 'member' });
            }
            return ok([]);
          }

          // ---- feed item (member_joined) ----------------------------
          if (sql.startsWith('INSERT INTO trip_feed_items')) {
            const [tripId, actorId] = params as [string, string];
            const typeMatch = /VALUES \(\$1, '(\w+)'/u.exec(sql);
            tx.feedItems.push({
              tripId,
              type: typeMatch?.[1] ?? 'unknown',
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

/** Invite operations never touch the canonical repos; stand-ins satisfy the type. */
const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

// ---------------------------------------------------------------------------
// Model + Real
// ---------------------------------------------------------------------------

interface ModelInvite {
  readonly inviteeId: string;
  state: InviteState;
}

interface Model {
  /** Invite states, index-aligned with `Real.inviteIds`. */
  readonly invites: ModelInvite[];
  /** Set of userIds who are Trip_Members (starts with the Organizer). */
  readonly members: Set<string>;
}

interface Real {
  readonly store: Store;
  readonly repo: TripRepo;
  /** Real invite ids, index-aligned with `Model.invites`. */
  readonly inviteIds: string[];
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
 *   - model and store agree on every invite's state (aligned by index/id),
 *   - the membership set matches between model and store,
 *   - no `(trip, user)` membership is duplicated (idempotent join, R7.2),
 *   - at most one `pending` invite exists per `(trip, invitee)`.
 */
function assertInvariants(m: Model, r: Real): void {
  // Invite states agree.
  for (let i = 0; i < m.invites.length; i += 1) {
    const storeRow = r.store.invites.get(r.inviteIds[i]!);
    expect(storeRow).toBeDefined();
    expect(storeRow!.state).toBe(m.invites[i]!.state);
  }

  // Membership set agrees.
  const storeMembers = new Set(
    r.store.memberships
      .filter((x) => x.tripId === TRIP_ID)
      .map((x) => x.userId),
  );
  expect(storeMembers).toEqual(m.members);

  // No duplicate membership row for any (trip, user).
  const seen = new Set<string>();
  for (const row of r.store.memberships) {
    const key = `${row.tripId}|${row.userId}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
  }

  // At most one pending invite per (trip, invitee).
  const pendingByInvitee = new Map<string, number>();
  for (const inv of r.store.invites.values()) {
    if (inv.state === 'pending') {
      const key = `${inv.tripId}|${inv.inviteeId}`;
      pendingByInvitee.set(key, (pendingByInvitee.get(key) ?? 0) + 1);
    }
  }
  for (const count of pendingByInvitee.values()) {
    expect(count).toBeLessThanOrEqual(1);
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * `SendInvite(candidateIndex)`: the Organizer invites a candidate. Succeeds
 * (new `pending` invite) unless the candidate is already a Member or already
 * holds a `pending` invite, in which case `trip_invite_duplicate` is thrown and
 * no invite is created (R6.1, and — after a cancel — the "fresh invite may be
 * sent" clause).
 */
class SendInviteCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly candidateIndex: number) {}

  private invitee(): string {
    return CANDIDATE_IDS[this.candidateIndex % CANDIDATE_IDS.length]!;
  }

  check(): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const invitee = this.invitee();
    const isMember = m.members.has(invitee);
    const hasPending = m.invites.some(
      (i) => i.inviteeId === invitee && i.state === 'pending',
    );

    if (isMember || hasPending) {
      const before = r.store.invites.size;
      await expectAppError(
        () => r.repo.sendInvite(TRIP_ID, ORGANIZER_ID, invitee),
        'trip_invite_duplicate',
      );
      // Rejected send creates no invite.
      expect(r.store.invites.size).toBe(before);
    } else {
      const created = await r.repo.sendInvite(TRIP_ID, ORGANIZER_ID, invitee);
      expect(created.tripId).toBe(TRIP_ID);
      expect(created.inviteeId).toBe(invitee);
      expect(created.inviterId).toBe(ORGANIZER_ID);
      const stored = r.store.invites.get(created.inviteId);
      expect(stored?.state).toBe('pending');

      r.inviteIds.push(created.inviteId);
      m.invites.push({ inviteeId: invitee, state: 'pending' });
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `SendInvite(${this.invitee().slice(0, 8)})`;
  }
}

/**
 * `AcceptInvite(selector, wrongCaller)`: accept an existing invite. When the
 * caller is not the addressed invitee the repo returns `trip_forbidden` and the
 * invite is unchanged (R7.4); a non-`pending` invite is rejected with
 * `trip_invite_state_invalid` and left unchanged (R7.5); accepting a `pending`
 * invite sets it `accepted` and adds a `member` membership idempotently
 * (R7.1, R7.2).
 */
class AcceptInviteCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly selector: number,
    public readonly wrongCaller: boolean,
  ) {}

  check(m: Readonly<Model>): boolean {
    return m.invites.length > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const idx = this.selector % m.invites.length;
    const modelInvite = m.invites[idx]!;
    const inviteId = r.inviteIds[idx]!;
    // The Organizer is never a candidate invitee, so it is always a "wrong"
    // caller for any invite in play.
    const caller = this.wrongCaller ? ORGANIZER_ID : modelInvite.inviteeId;

    if (this.wrongCaller) {
      const stateBefore = modelInvite.state;
      await expectAppError(
        () => r.repo.acceptInvite(inviteId, caller),
        'trip_forbidden',
      );
      expect(r.store.invites.get(inviteId)?.state).toBe(stateBefore);
    } else if (modelInvite.state !== 'pending') {
      const stateBefore = modelInvite.state;
      await expectAppError(
        () => r.repo.acceptInvite(inviteId, caller),
        'trip_invite_state_invalid',
      );
      expect(r.store.invites.get(inviteId)?.state).toBe(stateBefore);
    } else {
      const result = await r.repo.acceptInvite(inviteId, caller);
      expect(result.tripId).toBe(TRIP_ID);
      modelInvite.state = 'accepted';
      m.members.add(modelInvite.inviteeId);
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `AcceptInvite(#${this.selector}, wrongCaller=${this.wrongCaller})`;
  }
}

/**
 * `DeclineInvite(selector, wrongCaller)`: decline an existing invite. Mirrors
 * accept's guards (R7.4, R7.5); declining a `pending` invite sets it `declined`
 * and adds no membership (R7.3).
 */
class DeclineInviteCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly selector: number,
    public readonly wrongCaller: boolean,
  ) {}

  check(m: Readonly<Model>): boolean {
    return m.invites.length > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const idx = this.selector % m.invites.length;
    const modelInvite = m.invites[idx]!;
    const inviteId = r.inviteIds[idx]!;
    const caller = this.wrongCaller ? ORGANIZER_ID : modelInvite.inviteeId;
    const membersBefore = new Set(m.members);

    if (this.wrongCaller) {
      const stateBefore = modelInvite.state;
      await expectAppError(
        () => r.repo.declineInvite(inviteId, caller),
        'trip_forbidden',
      );
      expect(r.store.invites.get(inviteId)?.state).toBe(stateBefore);
    } else if (modelInvite.state !== 'pending') {
      const stateBefore = modelInvite.state;
      await expectAppError(
        () => r.repo.declineInvite(inviteId, caller),
        'trip_invite_state_invalid',
      );
      expect(r.store.invites.get(inviteId)?.state).toBe(stateBefore);
    } else {
      await r.repo.declineInvite(inviteId, caller);
      modelInvite.state = 'declined';
    }

    // Declining never changes membership.
    expect(m.members).toEqual(membersBefore);
    assertInvariants(m, r);
  }

  toString(): string {
    return `DeclineInvite(#${this.selector}, wrongCaller=${this.wrongCaller})`;
  }
}

/**
 * `CancelInvite(selector)`: an Organizer cancels an invite. A `pending` invite
 * transitions to the terminal `cancelled` state (R6.8); a non-`pending` invite
 * is rejected with `trip_invite_state_invalid` and left unchanged (R7.5-style
 * terminal guard).
 */
class CancelInviteCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly selector: number) {}

  check(m: Readonly<Model>): boolean {
    return m.invites.length > 0;
  }

  async run(m: Model, r: Real): Promise<void> {
    const idx = this.selector % m.invites.length;
    const modelInvite = m.invites[idx]!;
    const inviteId = r.inviteIds[idx]!;

    if (modelInvite.state === 'pending') {
      const cancelled = await r.repo.cancelInvite(TRIP_ID, inviteId);
      expect(cancelled).toBe(true);
      modelInvite.state = 'cancelled';
    } else {
      const stateBefore = modelInvite.state;
      await expectAppError(
        () => r.repo.cancelInvite(TRIP_ID, inviteId),
        'trip_invite_state_invalid',
      );
      expect(r.store.invites.get(inviteId)?.state).toBe(stateBefore);
    }

    assertInvariants(m, r);
  }

  toString(): string {
    return `CancelInvite(#${this.selector})`;
  }
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Trip_Invite state machine — Property 14: pending→terminal transitions', () => {
  it('send/accept/decline/cancel obey the pending→terminal state machine for any interleaving', async () => {
    const selectorArb = fc.nat({ max: 1000 });
    const commandArb = fc.oneof(
      fc
        .nat({ max: CANDIDATE_IDS.length - 1 })
        .map((i) => new SendInviteCommand(i)),
      fc
        .tuple(selectorArb, fc.boolean())
        .map(([s, w]) => new AcceptInviteCommand(s, w)),
      fc
        .tuple(selectorArb, fc.boolean())
        .map(([s, w]) => new DeclineInviteCommand(s, w)),
      selectorArb.map((s) => new CancelInviteCommand(s)),
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
            model: { invites: [], members: new Set([ORGANIZER_ID]) },
            real: { store, repo, inviteIds: [] },
          });
          await fc.asyncModelRun(setup, cmds);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Idempotency of the membership insert (R7.2)
// ---------------------------------------------------------------------------

/**
 * A `pending` invite addressed to a User who is *already* a Member cannot be
 * produced through `sendInvite` (its membership pre-check rejects it), so the
 * idempotent `ON CONFLICT DO NOTHING` membership insert (R7.2) is exercised
 * directly: seed such an invite and accept it, then assert the accept succeeds,
 * the invite becomes `accepted`, and exactly one membership row exists for that
 * User (no duplicate).
 */
describe('acceptInvite — Property 14: idempotent membership on accept (R7.2)', () => {
  it('accepting a pending invite for an existing Member creates no duplicate membership', async () => {
    await fc.assert(
      fc.asyncProperty(fc.nat({ max: CANDIDATE_IDS.length - 1 }), async (i) => {
        const invitee = CANDIDATE_IDS[i]!;
        const store = makeStore();
        // The invitee is already a Member of the Trip.
        store.memberships.push({
          tripId: TRIP_ID,
          userId: invitee,
          role: 'member',
        });
        // …and, contrary to what sendInvite would allow, holds a pending invite.
        const inviteId = randomUUID();
        store.invites.set(inviteId, {
          id: inviteId,
          tripId: TRIP_ID,
          inviterId: ORGANIZER_ID,
          inviteeId: invitee,
          state: 'pending',
        });

        const repo = createTripRepo(
          makeFakePool(store) as unknown as DbPool,
          NOOP_DEPS,
        );

        const result = await repo.acceptInvite(inviteId, invitee);
        expect(result.tripId).toBe(TRIP_ID);
        expect(store.invites.get(inviteId)?.state).toBe('accepted');

        const rows = store.memberships.filter(
          (mrow) => mrow.tripId === TRIP_ID && mrow.userId === invitee,
        );
        expect(rows).toHaveLength(1);
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
