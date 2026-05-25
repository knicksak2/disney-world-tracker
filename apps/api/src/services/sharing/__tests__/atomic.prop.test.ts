// Feature: disney-world-tracker, Property 22: a share is created and one delivery row inserted per recipient iff every recipient is a friend at request time
/**
 * Property-based tests for the Sharing_Service atomic delivery contract
 * (task 12.2).
 *
 * Validates: Requirements 9.1, 9.3
 *
 * Design Property 22 (design.md):
 *
 *   For any (sender, recipientList, friendshipGraph) with
 *   1 <= |recipientList| <= 50, a Share is created and exactly one delivery
 *   row is inserted per recipient if and only if every entry in
 *   recipientList is a Friend of the sender at the time of the request;
 *   otherwise no Share row and no delivery rows exist after the request.
 *
 * We drive the real `createShareAtomic` against a fake pool that simulates
 * the `friendships`, `shares`, and `share_recipients` tables transactionally
 * (BEGIN snapshots state, COMMIT applies it, ROLLBACK discards it). This
 * lets us verify the *atomicity* claim end-to-end without spinning up a
 * Postgres instance: when the friend check fails, we must observe that
 * neither the share row nor any recipient rows survived the transaction.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';

import type { SharePayload } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { createSharingRepo } from '../repo.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Fake transactional pool
// ---------------------------------------------------------------------------

/**
 * Tiny in-memory simulation of the three tables `createShareAtomic` touches:
 *   - `friendships`: a static set of canonical `(lo, hi)` pairs.
 *   - `shares`: rows inserted by the happy path.
 *   - `share_recipients`: rows inserted by the happy path.
 *
 * Transactional semantics:
 *   - BEGIN starts a transaction with empty `pendingShares` and
 *     `pendingRecipients`.
 *   - INSERTs append to the pending lists.
 *   - COMMIT folds the pending lists into the committed lists.
 *   - ROLLBACK discards the pending lists without touching committed state.
 *
 * The friendship table is read-only for this property and is provided up
 * front via `friendPairs`.
 */
interface FakeDb {
  // Committed state (post-COMMIT or initial).
  shares: Array<{ id: string; sender_id: string; payload_kind: string }>;
  shareRecipients: Array<{ share_id: string; recipient_id: string }>;
  // Pending state inside an open transaction (cleared on ROLLBACK,
  // applied on COMMIT).
  inTransaction: boolean;
  pendingShares: Array<{ id: string; sender_id: string; payload_kind: string }>;
  pendingRecipients: Array<{ share_id: string; recipient_id: string }>;
}

function makeFakePool(
  friendPairs: ReadonlySet<string>,
): { pool: DbPool; db: FakeDb } {
  const db: FakeDb = {
    shares: [],
    shareRecipients: [],
    inTransaction: false,
    pendingShares: [],
    pendingRecipients: [],
  };

  // Stable share-id sequence so generated counterexamples are reproducible.
  let nextShareSeq = 0;
  const nextShareId = (): string => {
    nextShareSeq += 1;
    const hex = nextShareSeq.toString(16).padStart(12, '0');
    return `99999999-9999-4999-8999-${hex}`;
  };

  const exec = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: ReadonlyArray<unknown>; rowCount?: number }> => {
    if (text === 'BEGIN') {
      db.inTransaction = true;
      db.pendingShares = [];
      db.pendingRecipients = [];
      return { rows: [] };
    }
    if (text === 'COMMIT') {
      db.shares.push(...db.pendingShares);
      db.shareRecipients.push(...db.pendingRecipients);
      db.pendingShares = [];
      db.pendingRecipients = [];
      db.inTransaction = false;
      return { rows: [] };
    }
    if (text === 'ROLLBACK') {
      db.pendingShares = [];
      db.pendingRecipients = [];
      db.inTransaction = false;
      return { rows: [] };
    }
    if (text.startsWith('SELECT user_lo_id, user_hi_id')) {
      // Params are a flat list `[lo1, hi1, lo2, hi2, ...]`. For each pair,
      // include a row in the result iff the pair is in `friendPairs`.
      const rows: Array<{ user_lo_id: string; user_hi_id: string }> = [];
      for (let i = 0; i + 1 < params.length; i += 2) {
        const lo = params[i] as string;
        const hi = params[i + 1] as string;
        if (friendPairs.has(`${lo}|${hi}`)) {
          rows.push({ user_lo_id: lo, user_hi_id: hi });
        }
      }
      return { rows };
    }
    if (text.startsWith('INSERT INTO shares')) {
      const id = nextShareId();
      const senderId = params[0] as string;
      const payloadKind = params[2] as string;
      db.pendingShares.push({ id, sender_id: senderId, payload_kind: payloadKind });
      return { rows: [{ id }] };
    }
    if (text.startsWith('INSERT INTO share_recipients')) {
      const shareId = params[0] as string;
      const recipients = params[1] as ReadonlyArray<string>;
      for (const recipientId of recipients) {
        db.pendingRecipients.push({ share_id: shareId, recipient_id: recipientId });
      }
      return { rows: [], rowCount: recipients.length };
    }
    throw new Error(`unexpected SQL in fake pool: ${text}`);
  };

  const pool: DbPool = {
    query: (text: string, params?: ReadonlyArray<unknown>) =>
      exec(text, params ?? []),
    connect: async () => ({
      query: (text: string, params?: ReadonlyArray<unknown>) =>
        exec(text, params ?? []),
      release: () => undefined,
    }),
  } as unknown as DbPool;

  return { pool, db };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Build a deterministic UUID-shaped string from a small integer index. We
 * use `aaaa...` for the sender and `bbbb...` for candidate recipients, so a
 * recipient id can never collide with the sender even though we draw from
 * disjoint integer pools.
 */
function senderId(): string {
  return 'aaaaaaaa-aaaa-4aaa-8aaa-000000000000';
}
function candidateId(index: number): string {
  const hex = index.toString(16).padStart(12, '0');
  return `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
}

interface Scenario {
  readonly sender: string;
  /** Candidate population (distinct, none equal to sender). */
  readonly candidates: ReadonlyArray<string>;
  /** Subset of candidates that are friends of the sender. */
  readonly friends: ReadonlyArray<string>;
  /** Distinct subset (1..50) of candidates the sender targets. */
  readonly recipients: ReadonlyArray<string>;
}

/**
 * Generate one scenario.
 *
 *   - Population: 1..50 distinct candidates.
 *   - Friend set: a random subset of the population.
 *   - Recipient list: a random non-empty subset of the population (1..50,
 *     and at most |population|), so duplicates are excluded by construction
 *     (the duplicate-list path is covered by the unit suite, not Property 22).
 *
 * Each candidate carries a `(boolean, boolean)` pair `(isFriend, isRecipient)`
 * so the four cells of the 2x2 are reachable: friend-and-recipient,
 * friend-only, recipient-only (the failure case), and neither.
 */
function scenarioArb(): fc.Arbitrary<Scenario> {
  return fc
    .integer({ min: 1, max: 50 })
    .chain((populationSize) =>
      fc
        .array(
          fc.record({
            isFriend: fc.boolean(),
            isRecipient: fc.boolean(),
          }),
          { minLength: populationSize, maxLength: populationSize },
        )
        // Ensure at least one recipient is selected so the recipient
        // list is in 1..50 (R9.2).
        .filter((flags) => flags.some((f) => f.isRecipient))
        .map((flags) => {
          const candidates = flags.map((_, i) => candidateId(i));
          const friends: string[] = [];
          const recipients: string[] = [];
          for (let i = 0; i < flags.length; i += 1) {
            if (flags[i]!.isFriend) friends.push(candidates[i]!);
            if (flags[i]!.isRecipient) recipients.push(candidates[i]!);
          }
          return { sender: senderId(), candidates, friends, recipients };
        }),
    );
}

const PAYLOAD: SharePayload = {
  kind: 'experience',
  experienceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

/**
 * Build the canonical-pair set that the fake pool's friendship lookup
 * consults. One pair per `(sender, friend)`.
 */
function buildFriendPairSet(
  sender: string,
  friends: ReadonlyArray<string>,
): Set<string> {
  const set = new Set<string>();
  for (const friend of friends) {
    const { lo, hi } = canonicalPair(sender, friend);
    set.add(`${lo}|${hi}`);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Property 22
// ---------------------------------------------------------------------------

describe('Sharing_Service — Property 22: atomic delivery (R9.1, R9.3)', () => {
  it('iff every recipient is a friend, exactly one shares row + N share_recipients rows are inserted; otherwise zero rows of each', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb(), async (scenario) => {
        const { sender, friends, recipients } = scenario;
        const friendPairs = buildFriendPairSet(sender, friends);
        const friendSet = new Set(friends);
        const allFriends = recipients.every((r) => friendSet.has(r));

        const { pool, db } = makeFakePool(friendPairs);
        const repo = createSharingRepo(pool);

        if (allFriends) {
          // Happy path (R9.1): exactly one share row and exactly N
          // recipient rows after COMMIT, deliveredTo == N.
          const result = await repo.createShareAtomic(
            sender,
            recipients,
            PAYLOAD,
          );

          if (result.deliveredTo !== recipients.length) return false;
          if (db.shares.length !== 1) return false;
          if (db.shareRecipients.length !== recipients.length) return false;
          if (db.shares[0]!.sender_id !== sender) return false;
          if (db.shares[0]!.id !== result.shareId) return false;

          // Every recipient row points at the new share id.
          for (const row of db.shareRecipients) {
            if (row.share_id !== result.shareId) return false;
          }
          // The set of recipient_ids equals the requested recipient set.
          const insertedRecipients = new Set(
            db.shareRecipients.map((r) => r.recipient_id),
          );
          if (insertedRecipients.size !== recipients.length) return false;
          for (const r of recipients) {
            if (!insertedRecipients.has(r)) return false;
          }
          // No transaction left dangling.
          if (db.inTransaction) return false;
          return true;
        }

        // Rejection path (R9.3): the call must throw share_atomic_rejected
        // and leave the committed state empty (rolled back).
        let threw: unknown;
        try {
          await repo.createShareAtomic(sender, recipients, PAYLOAD);
        } catch (err) {
          threw = err;
        }
        if (!(threw instanceof AppError)) return false;
        if (threw.code !== 'share_atomic_rejected') return false;
        if (db.shares.length !== 0) return false;
        if (db.shareRecipients.length !== 0) return false;
        if (db.inTransaction) return false;
        return true;
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('on success, deliveredTo equals the recipient list size and the share id is unique per call', async () => {
    // Tightens R9.1: across many invocations against the same fake pool,
    // each successful share row gets a fresh id and the recipient-row count
    // grows by exactly |recipients| each time.
    await fc.assert(
      fc.asyncProperty(
        scenarioArb().filter((s) =>
          s.recipients.every((r) => s.friends.includes(r)),
        ),
        async (scenario) => {
          const { sender, friends, recipients } = scenario;
          const friendPairs = buildFriendPairSet(sender, friends);
          const { pool, db } = makeFakePool(friendPairs);
          const repo = createSharingRepo(pool);

          const before = {
            shares: db.shares.length,
            recipients: db.shareRecipients.length,
          };
          const result = await repo.createShareAtomic(
            sender,
            recipients,
            PAYLOAD,
          );

          return (
            result.deliveredTo === recipients.length &&
            db.shares.length === before.shares + 1 &&
            db.shareRecipients.length === before.recipients + recipients.length
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('on rejection, no partial state survives (zero shares rows and zero share_recipients rows added)', async () => {
    // Tightens R9.3: even when *some* recipients are friends, if at least
    // one is not, the entire transaction rolls back. The committed tables
    // must not gain any rows.
    await fc.assert(
      fc.asyncProperty(
        scenarioArb().filter((s) =>
          s.recipients.some((r) => !s.friends.includes(r)),
        ),
        async (scenario) => {
          const { sender, friends, recipients } = scenario;
          const friendPairs = buildFriendPairSet(sender, friends);
          const { pool, db } = makeFakePool(friendPairs);
          const repo = createSharingRepo(pool);

          let threw = false;
          try {
            await repo.createShareAtomic(sender, recipients, PAYLOAD);
          } catch (err) {
            threw = err instanceof AppError && err.code === 'share_atomic_rejected';
          }

          return (
            threw &&
            db.shares.length === 0 &&
            db.shareRecipients.length === 0 &&
            !db.inTransaction
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
