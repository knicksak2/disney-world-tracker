// Feature: social-sharing-loop, Property 12: Inbox discloses only the requesting recipient's shares
/**
 * Property-based test for the inbox privacy boundary (task 2.2).
 *
 * Validates: Requirements 6.1
 *
 * **Property 12: Inbox discloses only the requesting recipient's shares.**
 *
 * *For any* graph of `Share`s and recipients, `listInbox(u)` returns exactly
 * the non-deleted `Share`s delivered to `u` and never returns the sender
 * identity, payload, or timestamp of a `Share` not delivered to `u`.
 *
 * The privacy boundary in `Sharing_Service.listInbox` is the
 * `WHERE sr.recipient_id = $1 AND sr.recipient_deleted_at IS NULL` predicate
 * (design.md → "Read_State no longer gates disclosure" / R6.1). This test
 * generates a random population of `share_recipients` rows spanning **several
 * distinct recipients** — so every run contains shares delivered to users
 * other than the requester — plus per-row soft-delete flags, then drives the
 * repo through a fake `pg.Pool` that faithfully executes the SQL predicate:
 * it returns only the rows whose `recipient_id` equals the bound `$1`
 * parameter and whose `recipient_deleted_at` is NULL, exactly as Postgres
 * would.
 *
 * Because the fake pool applies the real predicate against the *whole*
 * population (including other recipients' rows and the requester's own
 * soft-deleted rows), the property can assert the boundary directly:
 *
 *   - The set of `shareId`s returned equals exactly the set of shares
 *     delivered to `u` with a non-deleted recipient row — no more, no less.
 *   - No `Share` that was **not** delivered to `u` (delivered only to other
 *     recipients, or delivered to `u` but soft-deleted) contributes its
 *     sender identity, payload, or timestamp to the result.
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import type { SharePayload, SharePayloadKind } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { createSharingRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NUM_RUNS = 100;

/** The requesting recipient `u` whose inbox we read on every run. */
const REQUESTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * A small pool of *other* recipient ids. Every generated population draws
 * recipients from `[REQUESTER_ID, ...OTHER_RECIPIENT_IDS]`, so runs reliably
 * mix shares delivered to `u` with shares delivered only to other users.
 */
const OTHER_RECIPIENT_IDS = [
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
] as const;

const ALL_RECIPIENT_IDS = [REQUESTER_ID, ...OTHER_RECIPIENT_IDS] as const;

// ---------------------------------------------------------------------------
// Model types (a `share` plus its `share_recipients` fan-out)
// ---------------------------------------------------------------------------

/** One recipient row for a share: who received it and its per-row state. */
interface RecipientRow {
  recipientId: string;
  read: boolean;
  deleted: boolean;
}

/** A share and every recipient it was delivered to. */
interface ShareModel {
  shareId: string;
  senderId: string;
  senderDisplayName: string;
  payloadKind: SharePayloadKind;
  payload: SharePayload;
  sentAt: Date;
  recipients: RecipientRow[];
  /** The requester's own reaction on this share, if the requester received it. */
  requesterReaction: string | null;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** UUID-ish string; the repo passes ids through without parsing. */
const idArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 0xffffffff })
  .map((n) => {
    const hex = n.toString(16).padStart(8, '0');
    return `${hex}-eeee-4eee-8eee-${hex}${hex}eeee`;
  });

const experiencePayloadArb: fc.Arbitrary<SharePayload> = fc.record({
  kind: fc.constant<'experience'>('experience'),
  experienceId: idArb,
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  note: fc.option(fc.string({ minLength: 1, maxLength: 50 }), {
    nil: undefined,
  }),
}) as fc.Arbitrary<SharePayload>;

const progressPayloadArb: fc.Arbitrary<SharePayload> = fc.record({
  kind: fc.constant<'progress'>('progress'),
  overallPercent: fc.float({
    min: 0,
    max: 100,
    noNaN: true,
    noDefaultInfinity: true,
  }),
  perParkPercent: fc.constant({}),
  perCategoryPercent: fc.constant({}),
}) as fc.Arbitrary<SharePayload>;

const payloadArb: fc.Arbitrary<SharePayload> = fc.oneof(
  experiencePayloadArb,
  progressPayloadArb,
);

const dateArb: fc.Arbitrary<Date> = fc
  .integer({ min: 0, max: 1_000_000_000_000 })
  .map((ms) => new Date(ms));

const reactionArb: fc.Arbitrary<string | null> = fc.option(
  fc.constantFrom('like', 'love', 'been_there', 'want_to_go'),
  { nil: null },
);

/**
 * A non-empty set of recipient rows for one share. Recipients are drawn from
 * the shared id pool (deduplicated by recipient id, since `share_recipients`
 * has a `(share_id, recipient_id)` PK) so a share may or may not include the
 * requester.
 */
const recipientsArb: fc.Arbitrary<RecipientRow[]> = fc
  .uniqueArray(
    fc.record({
      recipientId: fc.constantFrom(...ALL_RECIPIENT_IDS),
      read: fc.boolean(),
      deleted: fc.boolean(),
    }),
    {
      minLength: 1,
      maxLength: ALL_RECIPIENT_IDS.length,
      selector: (r) => r.recipientId,
    },
  );

const shareArb: fc.Arbitrary<ShareModel> = fc
  .record({
    shareId: idArb,
    senderId: idArb,
    senderDisplayName: fc.string({ minLength: 1, maxLength: 50 }),
    payload: payloadArb,
    sentAt: dateArb,
    recipients: recipientsArb,
    requesterReaction: reactionArb,
  })
  .map((s) => ({
    shareId: s.shareId,
    senderId: s.senderId,
    senderDisplayName: s.senderDisplayName,
    payloadKind: s.payload.kind,
    payload: s.payload,
    sentAt: s.sentAt,
    recipients: s.recipients,
    requesterReaction: s.requesterReaction,
  }));

/**
 * A population of shares with globally-unique share ids (so a returned
 * `shareId` maps back to exactly one share).
 */
const populationArb: fc.Arbitrary<ShareModel[]> = fc
  .uniqueArray(shareArb, {
    minLength: 0,
    maxLength: 25,
    selector: (s) => s.shareId,
  });

// ---------------------------------------------------------------------------
// Fake pool that executes the privacy predicate faithfully
// ---------------------------------------------------------------------------

/**
 * Build a fake `DbPool` that models the joined `share_recipients ⨝ shares ⨝
 * profiles ⟕ share_reactions` universe and applies the repo's SQL predicate
 * against the **entire** population: only rows whose `recipient_id` equals the
 * bound `$1` parameter and whose `recipient_deleted_at IS NULL` are returned —
 * exactly the `WHERE sr.recipient_id = $1 AND sr.recipient_deleted_at IS NULL`
 * boundary. This lets the property observe that the repo scopes reads to the
 * requester and never leaks another recipient's row.
 */
function makeFakePool(population: ReadonlyArray<ShareModel>): DbPool {
  const fake = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      // Guard the projection shape so a future rewrite that drops the
      // recipient scoping or the not-deleted filter fails loudly here.
      if (
        !text.includes('FROM share_recipients sr') ||
        !text.includes('WHERE sr.recipient_id = $1') ||
        !text.includes('sr.recipient_deleted_at IS NULL')
      ) {
        throw new Error(`unexpected SQL in inbox privacy test: ${text}`);
      }

      const boundRecipient = params[0];

      // Emit one joined row per (share, recipient) pair that satisfies the
      // predicate: recipient matches the bound param AND the row is not
      // soft-deleted. Rows for other recipients — and the requester's own
      // soft-deleted rows — are excluded, just as Postgres would.
      const rows: Array<Record<string, unknown>> = [];
      for (const share of population) {
        for (const rr of share.recipients) {
          if (rr.recipientId !== boundRecipient) continue;
          if (rr.deleted) continue;
          rows.push({
            share_id: share.shareId,
            read: rr.read,
            sender_id: share.senderId,
            sender_display_name: share.senderDisplayName,
            payload_kind: share.payloadKind,
            payload_snapshot: share.payload,
            sent_at: share.sentAt,
            my_reaction:
              rr.recipientId === REQUESTER_ID ? share.requesterReaction : null,
          });
        }
      }
      // Mirror the repo's ORDER BY s.sent_at DESC, sr.share_id ASC so the
      // returned ordering is deterministic (not relied on by the property).
      rows.sort((a, b) => {
        const bt = (b.sent_at as Date).getTime();
        const at = (a.sent_at as Date).getTime();
        if (bt !== at) return bt - at;
        return (a.share_id as string).localeCompare(b.share_id as string);
      });
      return { rows };
    },
    async connect() {
      throw new Error('connect() is not used by listInbox');
    },
  };
  return fake as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 12: inbox discloses only the requesting recipient\'s shares', () => {
  it(
    'returns exactly u\'s non-deleted shares and never leaks another recipient\'s sender/payload/timestamp',
    async () => {
      await fc.assert(
        fc.asyncProperty(populationArb, async (population) => {
          const repo = createSharingRepo(makeFakePool(population));

          const inbox = await repo.listInbox(REQUESTER_ID);

          // Expected: exactly the shares with a non-deleted recipient row for
          // the requester `u`.
          const expectedShareIds = new Set(
            population
              .filter((s) =>
                s.recipients.some(
                  (r) => r.recipientId === REQUESTER_ID && !r.deleted,
                ),
              )
              .map((s) => s.shareId),
          );

          const returnedShareIds = inbox.items.map((it) => it.shareId);

          // No duplicates in the result.
          expect(new Set(returnedShareIds).size).toBe(returnedShareIds.length);

          // The result set equals exactly u's non-deleted delivered shares.
          expect(new Set(returnedShareIds)).toEqual(expectedShareIds);

          // Build the set of shares NOT delivered to u (delivered only to
          // other recipients, or delivered to u but soft-deleted). None of
          // their sender/payload/timestamp may appear in u's inbox.
          const forbidden = population.filter(
            (s) => !expectedShareIds.has(s.shareId),
          );
          const forbiddenShareIds = new Set(forbidden.map((s) => s.shareId));

          for (const item of inbox.items) {
            // Every returned item corresponds to a share u actually received.
            expect(forbiddenShareIds.has(item.shareId)).toBe(false);

            // The disclosed fields match the share u received, and the item
            // is not a masquerade of a share u did not receive.
            const source = population.find((s) => s.shareId === item.shareId)!;
            expect(item.senderId).toBe(source.senderId);
            expect(item.senderDisplayName).toBe(source.senderDisplayName);
            expect(item.payload).toEqual(source.payload);
            expect(item.sentAt).toBe(source.sentAt.toISOString());
          }

          // `unread` never counts shares outside u's disclosed set: it equals
          // the number of u's non-deleted rows whose read state is false.
          const expectedUnread = population.filter((s) =>
            s.recipients.some(
              (r) => r.recipientId === REQUESTER_ID && !r.deleted && !r.read,
            ),
          ).length;
          expect(inbox.unread).toBe(expectedUnread);
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );
});
