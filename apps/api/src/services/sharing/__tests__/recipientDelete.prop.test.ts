// Feature: disney-world-tracker, Property 25: a recipient deleting a share affects only that recipient's row
/**
 * Property-based test for Sharing_Service recipient-side soft delete
 * (task 12.5).
 *
 * Validates: Requirements 9.10
 *
 * Property 25 (design.md → Correctness Properties → "Recipient soft
 * delete is local"):
 *
 *   For any share with N recipients (1..50) and any sequence of
 *   `softDeleteForRecipient(recipientId, shareId)` calls drawn from
 *   that recipient set, after every call:
 *     (a) the targeted recipient's row has `recipient_deleted_at != null`;
 *     (b) every other recipient's row is untouched (its
 *         `recipient_deleted_at` is `null` unless it was deleted by a
 *         prior call in the sequence);
 *     (c) the `shares` row itself is unchanged from the sender's
 *         perspective (sender_id, payload_kind, payload_snapshot,
 *         sent_at all equal to their initial values);
 *     (d) the deleted recipient's `listInbox` call no longer returns
 *         this share;
 *     (e) every non-deleted recipient's `listInbox` call still returns
 *         this share.
 *
 * Test strategy: drive the real `createSharingRepo` factory against an
 * in-memory fake `pg.Pool` that models the two tables the repo touches —
 * `shares` (one row) and `share_recipients` (N rows) — and dispatches
 * the two SQL fragments the repo emits on the relevant code path:
 *
 *   - the `softDeleteForRecipient` UPDATE keyed by `(share_id, recipient_id)`
 *     with the `recipient_deleted_at IS NULL` predicate
 *   - the `listInbox` SELECT joining `share_recipients` and `shares`
 *
 * Targeting the real repo (not a re-implementation) is the point: the
 * property surfaces any SQL drift that could let one recipient's delete
 * leak into another recipient's row or into the sender's `shares` row.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { SharePayload, SharePayloadKind } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createSharingRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

const SHARE_ID = '11111111-1111-4111-8111-111111111111';
const SENDER_ID = '22222222-2222-4222-8222-222222222222';
const EXPERIENCE_ID = '33333333-3333-4333-8333-333333333333';
const SENT_AT = new Date('2024-05-01T10:00:00.000Z');

const INITIAL_PAYLOAD: SharePayload = Object.freeze({
  kind: 'experience',
  experienceId: EXPERIENCE_ID,
  rating: 8,
});

// ---------------------------------------------------------------------------
// In-memory tables
// ---------------------------------------------------------------------------

interface SharesRow {
  id: string;
  sender_id: string;
  payload_kind: SharePayloadKind;
  payload_snapshot: SharePayload;
  sent_at: Date;
}

interface ShareRecipientsRow {
  share_id: string;
  recipient_id: string;
  opened_at: Date | null;
  recipient_deleted_at: Date | null;
}

interface FakeDb {
  /** The single share row. The sender's view is this row, untouched. */
  share: SharesRow;
  /** One row per recipient. Index in the array ↔ position in the recipient list. */
  recipients: ShareRecipientsRow[];
}

/**
 * Build a freshly-seeded database with one share and one row per
 * recipient. All `recipient_deleted_at` values start as `null`.
 */
function makeDb(recipientIds: ReadonlyArray<string>): FakeDb {
  return {
    share: {
      id: SHARE_ID,
      sender_id: SENDER_ID,
      payload_kind: 'experience',
      payload_snapshot: { ...INITIAL_PAYLOAD },
      sent_at: SENT_AT,
    },
    recipients: recipientIds.map((recipientId) => ({
      share_id: SHARE_ID,
      recipient_id: recipientId,
      opened_at: null,
      recipient_deleted_at: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

/**
 * Build a fake pool whose `query` method dispatches the two SQL
 * fragments the repo emits on this code path:
 *
 *   - `UPDATE share_recipients SET recipient_deleted_at = now() WHERE
 *      share_id = $1 AND recipient_id = $2 AND recipient_deleted_at IS NULL`
 *   - `SELECT sr.share_id, (sr.opened_at IS NOT NULL) AS is_opened, ...
 *      FROM share_recipients sr JOIN shares s ON s.id = sr.share_id
 *      WHERE sr.recipient_id = $1 AND sr.recipient_deleted_at IS NULL ...`
 *
 * Any other SQL falls through to a thrown error so an accidental query
 * surfaces immediately.
 *
 * `connect()` is also implemented so the same pool could service the
 * repo's `createShareAtomic` path if a future test wires it in; for
 * Property 25 we never call `createShareAtomic`, so the transactional
 * side is unused.
 */
function makeFakePool(db: FakeDb): DbPool {
  const run = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: unknown[]; rowCount: number }> => {
    const trimmed = text.trim();

    // ---- softDeleteForRecipient UPDATE ---------------------------------
    if (trimmed.startsWith('UPDATE share_recipients')) {
      // The repo's UPDATE statement is identified by `SET
      // recipient_deleted_at = now()` + the (share_id, recipient_id)
      // predicate. We assert structural fidelity so a future repo
      // change that drops the recipient_id scope would surface as a
      // test failure even before the post-condition check fires.
      if (!trimmed.includes('SET recipient_deleted_at = now()')) {
        throw new Error(`unexpected UPDATE shape: ${trimmed.slice(0, 120)}`);
      }
      if (!trimmed.includes('share_id = $1')) {
        throw new Error(`UPDATE missing share_id predicate: ${trimmed.slice(0, 120)}`);
      }
      if (!trimmed.includes('recipient_id = $2')) {
        throw new Error(
          `UPDATE missing recipient_id predicate: ${trimmed.slice(0, 120)}`,
        );
      }
      if (!trimmed.includes('recipient_deleted_at IS NULL')) {
        throw new Error(
          `UPDATE missing IS NULL predicate: ${trimmed.slice(0, 120)}`,
        );
      }

      const shareId = String(params[0]);
      const recipientId = String(params[1]);

      let rowCount = 0;
      for (const row of db.recipients) {
        if (
          row.share_id === shareId &&
          row.recipient_id === recipientId &&
          row.recipient_deleted_at === null
        ) {
          row.recipient_deleted_at = new Date();
          rowCount += 1;
        }
      }
      return { rows: [], rowCount };
    }

    // ---- listInbox SELECT ---------------------------------------------
    if (
      trimmed.startsWith('SELECT sr.share_id') &&
      trimmed.includes('FROM share_recipients sr')
    ) {
      if (!trimmed.includes('recipient_deleted_at IS NULL')) {
        throw new Error(
          `listInbox SELECT missing IS NULL predicate: ${trimmed.slice(0, 120)}`,
        );
      }
      if (!trimmed.includes('recipient_id = $1')) {
        throw new Error(
          `listInbox SELECT missing recipient_id predicate: ${trimmed.slice(0, 120)}`,
        );
      }

      const recipientId = String(params[0]);
      const rows: unknown[] = [];
      for (const row of db.recipients) {
        if (
          row.recipient_id === recipientId &&
          row.recipient_deleted_at === null
        ) {
          rows.push({
            share_id: row.share_id,
            is_opened: row.opened_at !== null,
            sender_id: db.share.sender_id,
            payload_kind: db.share.payload_kind,
            payload_snapshot: db.share.payload_snapshot,
            sent_at: db.share.sent_at,
          });
        }
      }
      return { rows, rowCount: rows.length };
    }

    throw new Error(`unhandled SQL in fake pool: ${trimmed.slice(0, 120)}`);
  };

  return {
    query: run,
    async connect() {
      return {
        query: run,
        release() {
          // no-op; this PBT never opens a transaction.
        },
      };
    },
  } as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Recipient id arbitrary. Bounded numeric domain keeps the shrinker
 * fast while still spanning enough of the id space that "delete a
 * non-existent id" is reachable via `extraneousIdArb` below.
 */
const recipientIdArb = fc
  .integer({ min: 0, max: 9999 })
  .map((n) => `r-${String(n).padStart(4, '0')}`);

/**
 * The recipient list for the share. 1..50 unique ids per R9.2; the
 * dedupe selector is identity since `recipientIdArb` already returns
 * strings.
 */
const recipientListArb = fc.uniqueArray(recipientIdArb, {
  minLength: 1,
  maxLength: 50,
});

/**
 * An id that is *not* in the recipient list. Used to occasionally
 * sprinkle "delete a stranger" calls into the operation sequence so
 * we exercise the path where the UPDATE matches no row.
 */
const extraneousIdArb = fc
  .integer({ min: 10_000, max: 99_999 })
  .map((n) => `x-${String(n).padStart(5, '0')}`);

/**
 * Build the operation sequence arbitrary parameterized over a
 * recipient list. Each operation is either:
 *   - an index into the recipient list (delete that recipient's row)
 *   - a stranger id (UPDATE matches no row; rowCount === 0)
 *
 * We bias toward valid recipient indexes so the property spends most
 * runs in the "row was actually deleted" half of the contract.
 */
function operationSequenceArb(
  recipientIds: ReadonlyArray<string>,
): fc.Arbitrary<ReadonlyArray<string>> {
  const indexArb = fc
    .integer({ min: 0, max: recipientIds.length - 1 })
    .map((i) => recipientIds[i] as string);
  const opArb = fc.oneof(
    { weight: 5, arbitrary: indexArb },
    { weight: 1, arbitrary: extraneousIdArb },
  );
  return fc.array(opArb, { minLength: 0, maxLength: 80 });
}

/**
 * Combined scenario: a recipient list and an operation sequence whose
 * indexes are drawn from that list. `chain` ensures the sequence
 * cannot point at indexes outside the list.
 */
const scenarioArb = recipientListArb.chain((recipientIds) =>
  fc.tuple(fc.constant(recipientIds), operationSequenceArb(recipientIds)),
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Sharing_Service softDeleteForRecipient — Property 25', () => {
  it('a recipient deleting a share affects only that recipient row', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ([recipientIds, ops]) => {
        const db = makeDb(recipientIds);
        const repo = createSharingRepo(makeFakePool(db));

        // Snapshot the sender's view of the share so we can assert the
        // shares row is byte-identical after every operation. JSON
        // serialization is the cheapest deep-equal that survives Date
        // and nested object comparisons reliably.
        const initialShareSnapshot = JSON.stringify(db.share);

        // Track a shadow model of which recipients have been deleted
        // so the post-condition for each call can be checked locally.
        const expectedDeleted = new Set<string>();

        for (const target of ops) {
          const wasAlreadyDeleted = expectedDeleted.has(target);
          const isInList = recipientIds.includes(target);

          const result = await repo.softDeleteForRecipient(target, SHARE_ID);

          // (return value) The repo returns true iff a row was actually
          // updated this call. `target` is in the recipient list AND
          // it was not already deleted ⇒ true; otherwise ⇒ false.
          const expectedReturn = isInList && !wasAlreadyDeleted;
          expect(result).toBe(expectedReturn);

          if (expectedReturn) {
            expectedDeleted.add(target);
          }

          // (a) The targeted recipient's row has recipient_deleted_at
          // != null after a successful delete.
          if (isInList) {
            const targetRow = db.recipients.find(
              (r) => r.recipient_id === target,
            );
            // The row exists by construction.
            expect(targetRow).toBeDefined();
            expect(targetRow!.recipient_deleted_at).not.toBeNull();
          }

          // (b) Every other recipient's row is untouched (its deleted
          // flag matches the shadow model). This is the core
          // independence claim.
          for (const row of db.recipients) {
            const shouldBeDeleted = expectedDeleted.has(row.recipient_id);
            if (shouldBeDeleted) {
              expect(row.recipient_deleted_at).not.toBeNull();
            } else {
              expect(row.recipient_deleted_at).toBeNull();
            }
            // Other column invariants: share_id and recipient_id are
            // never rewritten by softDeleteForRecipient. opened_at
            // stays at its initial value (null in this test) — the
            // delete path must not flip the open flag either.
            expect(row.share_id).toBe(SHARE_ID);
            expect(row.opened_at).toBeNull();
          }

          // (c) The `shares` row is unchanged from the sender's
          // perspective. R9.10 explicitly preserves the sender's
          // record.
          expect(JSON.stringify(db.share)).toBe(initialShareSnapshot);
        }

        // After the full sequence, run the inbox check for every
        // recipient — both deleted and non-deleted — to confirm
        // properties (d) and (e) on the read path.
        for (const recipientId of recipientIds) {
          const inbox = await repo.listInbox(recipientId);
          if (expectedDeleted.has(recipientId)) {
            // (d) deleted recipient no longer sees the share.
            expect(inbox.unread).toBe(0);
            expect(inbox.items).toHaveLength(0);
          } else {
            // (e) non-deleted recipient still sees the share. Each
            // recipient's row was unopened in this test, so unread
            // == 1 and the single item carries the unopened
            // privacy projection.
            expect(inbox.items).toHaveLength(1);
            expect(inbox.unread).toBe(1);
            expect(inbox.items[0]).toEqual({
              shareId: SHARE_ID,
              isOpened: false,
            });
          }
        }

        // A stranger (id never in the recipient list) sees an empty
        // inbox regardless of the operation sequence — sanity check
        // that the listInbox predicate scopes by recipient_id.
        const stranger = 'x-stranger-id';
        const strangerInbox = await repo.listInbox(stranger);
        expect(strangerInbox).toEqual({ unread: 0, items: [] });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
