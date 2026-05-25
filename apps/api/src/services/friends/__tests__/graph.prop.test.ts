// Feature: disney-world-tracker, Property 21: friend-graph operations preserve symmetry, no-self, request and friendship invariants
/**
 * Property-based test for the Friends_Service friend-graph state machine
 * (task 7.4).
 *
 * Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11
 *
 * Property 21 (design.md → Correctness Properties → "Friend-graph state
 * machine"):
 *
 *   For any sequence of friend operations (`sendRequest`, `accept`,
 *   `decline`, `remove`) on a population of Users, the resulting state
 *   satisfies:
 *
 *     - friendships are symmetric (a single canonical row per unordered
 *       pair) and `user_lo_id < user_hi_id` (no self-friend) (R8.6);
 *     - at most one pending Friend_Request exists between any unordered
 *       pair (R8.7);
 *     - no pending Friend_Request exists when a friendship is established
 *       between the same pair (R8.7);
 *     - `accept` converts a pending request into a friendship and removes
 *       the request (R8.4, R8.6);
 *     - `decline` removes the request without creating a friendship
 *       (R8.5);
 *     - `remove` deletes the friendship for both Users (R8.6, R8.11);
 *     - any `sendRequest` to self, to a non-existent User, or that would
 *       create a duplicate of an existing pending or friendship state is
 *       rejected (R8.8, R8.10, R8.7);
 *     - any `remove` for a non-existent friendship is rejected (R8.11);
 *     - no friend request has `sender_id == recipient_id` (R8.8).
 *
 * Test strategy: a `fast-check` `commands`-style state-machine test driven
 * over the real `createFriendsRepo` factory (task 7.2) backed by an
 * in-memory fake `pg.Pool` whose state is three Maps modelling the
 * `users`, `friend_requests`, and `friendships` tables. The fake pool
 * dispatches the SQL fragments the repo emits — `BEGIN`, the recipient
 * `SELECT id FROM users`, the friendship/duplicate-request `EXISTS`
 * checks, `INSERT INTO friend_requests`, `INSERT INTO friendships`,
 * `DELETE FROM friend_requests`, `DELETE FROM friendships`, and
 * `COMMIT` / `ROLLBACK` — to a per-transaction snapshot layer so the
 * property exercises the production code path rather than a bespoke
 * imitation of it.
 *
 * The test uses a small fixed population of four Users plus one
 * non-existent User id. Four commands cover the full transition space:
 *
 *   - `SendRequest(senderIdx, recipientIdx, useUnknown)` — exercises the
 *     happy path (R8.3), self-target rejection (R8.8), unknown-recipient
 *     rejection (R8.10), and same/reverse-direction duplicate or
 *     existing-friendship rejection (R8.7).
 *   - `AcceptRequest(requestSelector)` — picks the `requestSelector`-th
 *     pending request from the model and accepts it as the recorded
 *     recipient (R8.4, R8.6); a no-op when no pending request exists.
 *   - `DeclineRequest(requestSelector)` — picks the `requestSelector`-th
 *     pending request and declines it as the recorded recipient (R8.5);
 *     a no-op when no pending request exists.
 *   - `RemoveFriend(userIdxA, userIdxB)` — issues a remove between two
 *     Users; succeeds iff a canonical row exists for the pair (R8.6,
 *     R8.11).
 *
 * After every command, `assertInvariants` re-checks the structural
 * invariants of the friend graph against both the model and the storage
 * layer.
 *
 * `numRuns: 100` per the spec convention.
 */

import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { pair as canonicalPair } from '../canonicalPair.js';
import { createFriendsRepo, type FriendsRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;
const MAX_COMMANDS = 50;

/**
 * Fixed population of four Users. UUIDs are hand-picked so their
 * lexicographic order is stable and predictable, which keeps the
 * canonical-pair comparisons in assertions easy to reason about under
 * shrinking. A fifth value (`UNKNOWN_USER_ID`) is used by `SendRequest`
 * to drive the R8.10 "phantom recipient" rejection branch.
 */
const USERS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
] as const;
const UNKNOWN_USER_ID = '99999999-9999-4999-8999-999999999999';

// ---------------------------------------------------------------------------
// In-memory fake pg.Pool that mirrors the SQL the friends repo emits
// ---------------------------------------------------------------------------

/** One row of the (user_id) -> friend_request mapping. */
interface RequestRow {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
  readonly createdAt: Date;
}

/** Backing storage for the three tables the repo touches. */
interface Store {
  readonly users: Set<string>;
  readonly requests: Map<string, RequestRow>;
  /** Canonical pair `${lo}|${hi}` → established_at. */
  readonly friendships: Map<string, Date>;
}

/** Per-transaction snapshot. COMMIT publishes; ROLLBACK discards. */
interface Tx {
  requests: Map<string, RequestRow>;
  friendships: Map<string, Date>;
}

interface FakeClient {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount?: number }>;
  release(): void;
}

interface FakePool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: unknown[]; rowCount?: number }>;
  connect(): Promise<FakeClient>;
}

function pairKey(lo: string, hi: string): string {
  return `${lo}|${hi}`;
}

function makeStore(initialUsers: ReadonlyArray<string>): Store {
  return {
    users: new Set(initialUsers),
    requests: new Map(),
    friendships: new Map(),
  };
}

/**
 * Build a fake pool whose `query`/`connect()` route the SQL the friends
 * repo emits to the in-memory store. A connect()-returned client owns
 * its own per-transaction snapshot; COMMIT atomically writes the
 * snapshot back to the store and ROLLBACK discards it. Standalone
 * `pool.query` calls (used by `declineRequest`, `removeFriend`, and
 * `searchUsers` / `listFriendsAndRequests` — neither of which this test
 * drives) read and write the store directly.
 */
function makeFakePool(store: Store): FakePool {
  const standaloneQuery = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: unknown[]; rowCount?: number }> => {
    const trimmed = text.trim();

    if (trimmed.startsWith('DELETE FROM friend_requests')) {
      const requestId = String(params[0]);
      const recipientId = String(params[1]);
      const row = store.requests.get(requestId);
      if (row !== undefined && row.recipientId === recipientId) {
        store.requests.delete(requestId);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith('DELETE FROM friendships')) {
      const lo = String(params[0]);
      const hi = String(params[1]);
      const key = pairKey(lo, hi);
      const existed = store.friendships.delete(key);
      return { rows: [], rowCount: existed ? 1 : 0 };
    }

    throw new Error(
      `unhandled standalone SQL in fake pool: ${trimmed.slice(0, 80)}`,
    );
  };

  return {
    query: standaloneQuery,
    async connect(): Promise<FakeClient> {
      let tx: Tx | null = null;
      return {
        async query(
          text: string,
          params: ReadonlyArray<unknown> = [],
        ): Promise<{ rows: unknown[]; rowCount?: number }> {
          const trimmed = text.trim();

          // ---- transaction control -------------------------------------
          if (trimmed.startsWith('BEGIN')) {
            tx = {
              requests: new Map(store.requests),
              friendships: new Map(store.friendships),
            };
            return { rows: [] };
          }
          if (trimmed.startsWith('COMMIT')) {
            if (tx === null) {
              throw new Error('COMMIT without BEGIN');
            }
            store.requests.clear();
            for (const [k, v] of tx.requests) store.requests.set(k, v);
            store.friendships.clear();
            for (const [k, v] of tx.friendships) store.friendships.set(k, v);
            tx = null;
            return { rows: [] };
          }
          if (trimmed.startsWith('ROLLBACK')) {
            tx = null;
            return { rows: [] };
          }

          if (tx === null) {
            throw new Error(
              `data-plane query without BEGIN: ${trimmed.slice(0, 80)}`,
            );
          }

          // ---- recipient existence (R8.10) ----------------------------
          if (trimmed.startsWith('SELECT id FROM users WHERE id =')) {
            const recipientId = String(params[0]);
            return store.users.has(recipientId)
              ? { rows: [{ id: recipientId }] }
              : { rows: [] };
          }

          // ---- existing-friendship EXISTS check (R8.7) ----------------
          if (
            trimmed.startsWith('SELECT EXISTS') &&
            trimmed.includes('FROM friendships')
          ) {
            const lo = String(params[0]);
            const hi = String(params[1]);
            return {
              rows: [{ exists: tx.friendships.has(pairKey(lo, hi)) }],
            };
          }

          // ---- pending-request (either-direction) EXISTS check (R8.7) -
          if (
            trimmed.startsWith('SELECT EXISTS') &&
            trimmed.includes('FROM friend_requests')
          ) {
            const sender = String(params[0]);
            const recipient = String(params[1]);
            let exists = false;
            for (const row of tx.requests.values()) {
              if (
                (row.senderId === sender && row.recipientId === recipient) ||
                (row.senderId === recipient && row.recipientId === sender)
              ) {
                exists = true;
                break;
              }
            }
            return { rows: [{ exists }] };
          }

          // ---- INSERT INTO friend_requests (R8.3) ---------------------
          if (trimmed.startsWith('INSERT INTO friend_requests')) {
            const sender = String(params[0]);
            const recipient = String(params[1]);
            // Mirror the (sender_id, recipient_id) UNIQUE constraint so
            // a buggy SELECT-then-INSERT race in the repo would surface
            // as a 23505 (which the repo translates to
            // `friend_duplicate_relationship`).
            for (const row of tx.requests.values()) {
              if (
                row.senderId === sender &&
                row.recipientId === recipient
              ) {
                const err = new Error(
                  'duplicate key value violates unique constraint',
                ) as Error & { code: string };
                err.code = '23505';
                throw err;
              }
            }
            const id = randomUUID();
            const createdAt = new Date();
            tx.requests.set(id, {
              id,
              senderId: sender,
              recipientId: recipient,
              createdAt,
            });
            return {
              rows: [
                {
                  id,
                  sender_id: sender,
                  recipient_id: recipient,
                  created_at: createdAt,
                },
              ],
            };
          }

          // ---- accept: lookup gated by recipient_id -------------------
          if (
            trimmed.startsWith('SELECT sender_id, recipient_id') &&
            trimmed.includes('FROM friend_requests')
          ) {
            const requestId = String(params[0]);
            const recipientId = String(params[1]);
            const row = tx.requests.get(requestId);
            if (row !== undefined && row.recipientId === recipientId) {
              return {
                rows: [
                  { sender_id: row.senderId, recipient_id: row.recipientId },
                ],
              };
            }
            return { rows: [] };
          }

          // ---- INSERT INTO friendships (R8.4, R8.6) -------------------
          if (trimmed.startsWith('INSERT INTO friendships')) {
            const lo = String(params[0]);
            const hi = String(params[1]);
            const key = pairKey(lo, hi);
            // ON CONFLICT DO NOTHING: silent insert when present, write
            // when absent. Either way the post-state has the row.
            if (!tx.friendships.has(key)) {
              tx.friendships.set(key, new Date());
            }
            return { rows: [] };
          }

          // ---- DELETE FROM friend_requests (accept tail / decline) ---
          if (trimmed.startsWith('DELETE FROM friend_requests')) {
            const requestId = String(params[0]);
            // Two flavors live here. The accept path issues
            // `DELETE FROM friend_requests WHERE id = $1` (one param);
            // decline runs through `pool.query` and never reaches this
            // transactional branch.
            const existed = tx.requests.delete(requestId);
            return { rows: [], rowCount: existed ? 1 : 0 };
          }

          throw new Error(
            `unhandled transactional SQL in fake pool: ${trimmed.slice(0, 80)}`,
          );
        },
        release(): void {
          // Drop any uncommitted snapshot, matching `pg.PoolClient.release()`.
          tx = null;
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Model and Real
// ---------------------------------------------------------------------------

/**
 * Canonical-pair friendship key used by both the model and the store.
 * Building it through `canonicalPair` is what makes "the model expects
 * the same canonical row the repo writes" structurally true.
 */
interface ModelRequest {
  readonly id: string;
  readonly senderId: string;
  readonly recipientId: string;
}

interface Model {
  /** Set of canonical pair keys `${lo}|${hi}` representing friendships. */
  readonly friendships: Set<string>;
  /** Map of request id → request. */
  readonly requests: Map<string, ModelRequest>;
}

interface Real {
  readonly store: Store;
  readonly repo: FriendsRepo;
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Re-check the friend-graph invariants against both the model and the
 * store after every command. A divergence in any of these means the
 * repo violated Property 21.
 */
function assertInvariants(model: Readonly<Model>, real: Real): void {
  // Storage matches the model exactly.
  if (real.store.friendships.size !== model.friendships.size) {
    throw new Error(
      `friendships size mismatch: model=${model.friendships.size}, store=${real.store.friendships.size}`,
    );
  }
  for (const key of model.friendships) {
    if (!real.store.friendships.has(key)) {
      throw new Error(`friendships divergence: model has ${key}, store does not`);
    }
  }
  if (real.store.requests.size !== model.requests.size) {
    throw new Error(
      `friend_requests size mismatch: model=${model.requests.size}, store=${real.store.requests.size}`,
    );
  }
  for (const id of model.requests.keys()) {
    if (!real.store.requests.has(id)) {
      throw new Error(
        `friend_requests divergence: model has ${id}, store does not`,
      );
    }
  }

  // R8.6: every friendship row has user_lo_id < user_hi_id strictly.
  for (const key of real.store.friendships.keys()) {
    const [lo, hi] = key.split('|');
    if (lo === undefined || hi === undefined || lo >= hi) {
      throw new Error(
        `R8.6 violation: friendship row not canonical (${key})`,
      );
    }
  }

  // R8.8: no friend_request has sender == recipient.
  for (const row of real.store.requests.values()) {
    if (row.senderId === row.recipientId) {
      throw new Error(
        `R8.8 violation: friend_request ${row.id} has sender == recipient`,
      );
    }
  }

  // R8.7 disjointness: no canonical pair has both a friendship and a
  // pending request in either direction.
  for (const row of real.store.requests.values()) {
    const { lo, hi } = canonicalPair(row.senderId, row.recipientId);
    if (real.store.friendships.has(pairKey(lo, hi))) {
      throw new Error(
        `R8.7 violation: pending request ${row.id} coexists with friendship for ${lo}|${hi}`,
      );
    }
  }

  // R8.7 cardinality: at most one pending request per unordered pair.
  const seenPairs = new Set<string>();
  for (const row of real.store.requests.values()) {
    const { lo, hi } = canonicalPair(row.senderId, row.recipientId);
    const key = pairKey(lo, hi);
    if (seenPairs.has(key)) {
      throw new Error(
        `R8.7 violation: more than one pending request for unordered pair ${key}`,
      );
    }
    seenPairs.add(key);
  }
}

// ---------------------------------------------------------------------------
// Helpers shared by the commands
// ---------------------------------------------------------------------------

/**
 * Lazy resolution of the `requestSelector`-th pending request from the
 * current model state. The selector is a non-negative integer drawn at
 * generation time; we mod it by the live request count at run time so
 * the choice stays well-defined regardless of how many requests happen
 * to be pending when the command executes (and gracefully no-ops when
 * none are).
 */
function pickRequest(
  model: Readonly<Model>,
  selector: number,
): ModelRequest | null {
  if (model.requests.size === 0) return null;
  const ordered = [...model.requests.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const idx = selector % ordered.length;
  return ordered[idx] ?? null;
}

/** Resolve a sender index into a real user id. */
function userAt(idx: number): string {
  return USERS[idx % USERS.length]!;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Drive a `sendRequest` from `senderIdx` to either a real recipient
 * (when `useUnknown` is `false`) or to `UNKNOWN_USER_ID` (when `true`).
 * The model classifies the call into one of four outcomes and checks
 * the repo's response and the store match:
 *
 *   - self-target          → `friend_self_target` (R8.8)
 *   - unknown recipient    → `friend_recipient_unknown` (R8.10)
 *   - duplicate / friend   → `friend_duplicate_relationship` (R8.7)
 *   - happy path           → DTO is persisted and request is added (R8.3)
 */
class SendRequestCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly senderIdx: number,
    public readonly recipientIdx: number,
    public readonly useUnknown: boolean,
  ) {}

  check(_m: Readonly<Model>): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const senderId = userAt(this.senderIdx);
    const recipientId = this.useUnknown
      ? UNKNOWN_USER_ID
      : userAt(this.recipientIdx);

    // Classify the expected outcome from the model alone.
    const isSelf = senderId === recipientId;
    const isUnknown = !isSelf && this.useUnknown;
    const friendshipKey = !isSelf
      ? (() => {
          const { lo, hi } = canonicalPair(senderId, recipientId);
          return pairKey(lo, hi);
        })()
      : null;
    const friendshipExists =
      friendshipKey !== null && m.friendships.has(friendshipKey);
    const requestExists =
      !isSelf &&
      [...m.requests.values()].some(
        (req) =>
          (req.senderId === senderId && req.recipientId === recipientId) ||
          (req.senderId === recipientId && req.recipientId === senderId),
      );

    if (isSelf) {
      let threw: unknown = null;
      try {
        await r.repo.sendRequest(senderId, recipientId);
      } catch (err) {
        threw = err;
      }
      if (!(threw instanceof AppError) || threw.code !== 'friend_self_target') {
        throw new Error(
          `expected friend_self_target on self-send, got ${String(threw)}`,
        );
      }
      assertInvariants(m, r);
      return;
    }

    if (isUnknown) {
      let threw: unknown = null;
      try {
        await r.repo.sendRequest(senderId, recipientId);
      } catch (err) {
        threw = err;
      }
      if (
        !(threw instanceof AppError) ||
        threw.code !== 'friend_recipient_unknown'
      ) {
        throw new Error(
          `expected friend_recipient_unknown on phantom recipient, got ${String(threw)}`,
        );
      }
      assertInvariants(m, r);
      return;
    }

    if (friendshipExists || requestExists) {
      let threw: unknown = null;
      try {
        await r.repo.sendRequest(senderId, recipientId);
      } catch (err) {
        threw = err;
      }
      if (
        !(threw instanceof AppError) ||
        threw.code !== 'friend_duplicate_relationship'
      ) {
        throw new Error(
          `expected friend_duplicate_relationship for duplicate, got ${String(threw)}`,
        );
      }
      assertInvariants(m, r);
      return;
    }

    // Happy path: a new pending request is created.
    const dto = await r.repo.sendRequest(senderId, recipientId);
    if (dto.senderId !== senderId || dto.recipientId !== recipientId) {
      throw new Error(
        `sendRequest returned wrong parties: ${JSON.stringify(dto)}`,
      );
    }
    m.requests.set(dto.id, {
      id: dto.id,
      senderId,
      recipientId,
    });
    assertInvariants(m, r);
  }

  toString(): string {
    return `SendRequest(${this.senderIdx},${this.recipientIdx},unknown=${this.useUnknown})`;
  }
}

/**
 * Drive an `acceptRequest` for the `requestSelector`-th pending request,
 * called by that request's recipient (R8.4, R8.6). When no pending
 * request exists this command is a no-op so the generator does not
 * waste shrinks on dead branches.
 */
class AcceptRequestCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly requestSelector: number) {}

  check(_m: Readonly<Model>): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const target = pickRequest(m, this.requestSelector);
    if (target === null) {
      assertInvariants(m, r);
      return;
    }

    const result = await r.repo.acceptRequest(target.recipientId, target.id);
    if (result === null) {
      throw new Error(
        `acceptRequest returned null for live request ${target.id}`,
      );
    }
    const { lo, hi } = canonicalPair(target.senderId, target.recipientId);
    if (result.userLoId !== lo || result.userHiId !== hi) {
      throw new Error(
        `acceptRequest returned wrong canonical pair: expected ${lo}|${hi}, got ${result.userLoId}|${result.userHiId}`,
      );
    }

    m.friendships.add(pairKey(lo, hi));
    m.requests.delete(target.id);
    assertInvariants(m, r);
  }

  toString(): string {
    return `AcceptRequest(sel=${this.requestSelector})`;
  }
}

/**
 * Drive a `declineRequest` for the `requestSelector`-th pending request,
 * called by that request's recipient (R8.5). No-op when no pending
 * request exists.
 */
class DeclineRequestCommand implements fc.AsyncCommand<Model, Real> {
  constructor(public readonly requestSelector: number) {}

  check(_m: Readonly<Model>): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const target = pickRequest(m, this.requestSelector);
    if (target === null) {
      assertInvariants(m, r);
      return;
    }

    const removed = await r.repo.declineRequest(
      target.recipientId,
      target.id,
    );
    if (!removed) {
      throw new Error(
        `declineRequest returned false for live request ${target.id}`,
      );
    }

    m.requests.delete(target.id);
    assertInvariants(m, r);
  }

  toString(): string {
    return `DeclineRequest(sel=${this.requestSelector})`;
  }
}

/**
 * Drive a `removeFriend(userIdxA, userIdxB)`. The repo returns `true`
 * iff a canonical row existed for the pair (R8.6, R8.11); the model
 * mirrors that decision. Self-target (`userIdxA === userIdxB`) is a
 * model-side return-`false` branch — `removeFriend` short-circuits
 * before any DB I/O.
 */
class RemoveFriendCommand implements fc.AsyncCommand<Model, Real> {
  constructor(
    public readonly userIdxA: number,
    public readonly userIdxB: number,
  ) {}

  check(_m: Readonly<Model>): boolean {
    return true;
  }

  async run(m: Model, r: Real): Promise<void> {
    const userA = userAt(this.userIdxA);
    const userB = userAt(this.userIdxB);

    if (userA === userB) {
      const removed = await r.repo.removeFriend(userA, userB);
      if (removed) {
        throw new Error('removeFriend reported true for self-target');
      }
      assertInvariants(m, r);
      return;
    }

    const { lo, hi } = canonicalPair(userA, userB);
    const key = pairKey(lo, hi);
    const expected = m.friendships.has(key);

    const removed = await r.repo.removeFriend(userA, userB);
    if (removed !== expected) {
      throw new Error(
        `removeFriend(${userA}, ${userB}) returned ${removed}, expected ${expected}`,
      );
    }
    if (expected) {
      m.friendships.delete(key);
    }
    assertInvariants(m, r);
  }

  toString(): string {
    return `RemoveFriend(${this.userIdxA},${this.userIdxB})`;
  }
}

// ---------------------------------------------------------------------------
// Command arbitraries
// ---------------------------------------------------------------------------

const userIndexArb = fc.integer({ min: 0, max: USERS.length - 1 });
const selectorArb = fc.integer({ min: 0, max: 32 });

const sendRequestArb = fc
  .tuple(
    userIndexArb,
    userIndexArb,
    // Bias toward real recipients so the bulk of runs exercise the
    // happy path; ~10% drive the R8.10 unknown-recipient branch.
    fc.oneof(
      { weight: 9, arbitrary: fc.constant(false) },
      { weight: 1, arbitrary: fc.constant(true) },
    ),
  )
  .map(([s, r, u]) => new SendRequestCommand(s, r, u));

const acceptArb = selectorArb.map((s) => new AcceptRequestCommand(s));
const declineArb = selectorArb.map((s) => new DeclineRequestCommand(s));
const removeArb = fc
  .tuple(userIndexArb, userIndexArb)
  .map(([a, b]) => new RemoveFriendCommand(a, b));

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Friends repo — Property 21: friend-graph state machine', () => {
  it(
    'a sequence of sendRequest/accept/decline/remove preserves symmetry, no-self, and request-friendship invariants',
    async () => {
      // Bias the distribution so SendRequest and Accept/Decline
      // dominate (the request and friendship populations grow that
      // way); RemoveFriend keeps the friendship-deletion branch
      // exercised on every shrunken trace.
      const cmdArb = fc.oneof(
        { weight: 5, arbitrary: sendRequestArb },
        { weight: 3, arbitrary: acceptArb },
        { weight: 2, arbitrary: declineArb },
        { weight: 2, arbitrary: removeArb },
      );

      await fc.assert(
        fc.asyncProperty(
          fc.commands([cmdArb], { maxCommands: MAX_COMMANDS }),
          async (cmds) => {
            const setup = (): { model: Model; real: Real } => {
              const store = makeStore(USERS);
              const pool = makeFakePool(store);
              const repo = createFriendsRepo(pool as unknown as DbPool);
              return {
                model: {
                  friendships: new Set<string>(),
                  requests: new Map<string, ModelRequest>(),
                },
                real: { store, repo },
              };
            };
            await fc.asyncModelRun(setup, cmds);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    },
    60_000,
  );
});
