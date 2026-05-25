// Feature: disney-world-tracker, Property 24: inbox preview reveals sender/content/timestamp iff opened_at is set
/**
 * Property-based test for inbox disclosure (task 12.4).
 *
 * Validates: Requirements 9.8, 9.9
 *
 * Design Property 24 (design.md → Correctness Properties → "Inbox
 * disclosure depends on opened state"):
 *
 *   For any recipient inbox state, the rendered preview reveals the
 *   sender, content, and timestamp of a Share if and only if the
 *   recipient's `opened_at` is set for that Share; otherwise the preview
 *   reveals only an unopened indicator and the recipient's unread Share
 *   count.
 *
 * Test strategy: a `fast-check` property over a randomly generated
 * population of `share_recipients` rows for a single recipient. Each row
 * has either `opened_at = null` (unopened) or `opened_at = <timestamp>`
 * (opened). The repo's `listInbox` issues exactly one `SELECT`; we drive
 * it through a fake `pg.Pool` whose `query()` returns the SQL projection
 * the repo expects:
 *
 *     { share_id, is_opened, sender_id, payload_kind, payload_snapshot, sent_at }
 *
 * `is_opened` is what the production query computes via
 * `(sr.opened_at IS NOT NULL)` — the fake pool simply mirrors that
 * derivation so the test exercises the repo's projection logic, not a
 * stub of it.
 *
 * The property asserts both halves of R9.8/R9.9:
 *
 *   - For every row whose `opened_at IS NULL`, the corresponding
 *     `InboxItem` has exactly `{ shareId, isOpened: false }` and no
 *     leakage of `senderId`, `payloadKind`, `payload`, or `sentAt`
 *     (R9.8).
 *   - For every row whose `opened_at IS NOT NULL`, the corresponding
 *     `InboxItem` carries `{ shareId, isOpened: true, senderId,
 *     payloadKind, payload, sentAt }` populated from the underlying
 *     `shares` row (R9.9).
 *   - The `unread` count equals the number of rows with
 *     `opened_at IS NULL` (the "recipient's unread Share count" half of
 *     R9.8).
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
const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111';

// The set of fields a route layer would consider "leaked" if they
// appeared on an unopened item; the property explicitly checks that
// none of these keys are present in the response shape for a row whose
// `opened_at IS NULL` (R9.8).
const FORBIDDEN_KEYS_WHEN_UNOPENED = [
  'senderId',
  'payloadKind',
  'payload',
  'sentAt',
] as const;

// ---------------------------------------------------------------------------
// Synthetic row shape (mirrors the repo's SQL projection)
// ---------------------------------------------------------------------------

/**
 * One synthetic `share_recipients ⨝ shares` row, modeled after the
 * repo's actual SELECT. `openedAt = null` corresponds to
 * `is_opened = false`; otherwise `is_opened = true` and the timestamp
 * carries through opaquely (the repo does not surface `openedAt` in
 * the response — only the `is_opened` boolean — so we keep it local).
 */
interface SyntheticInboxRow {
  shareId: string;
  openedAt: Date | null;
  senderId: string;
  payloadKind: SharePayloadKind;
  payload: SharePayload;
  sentAt: Date;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * UUID-ish string. The repo does not parse share/sender ids beyond
 * pass-through, so a stable 36-character placeholder is sufficient and
 * keeps shrinking fast.
 */
const idArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 0xffffffff })
  .map((n) => {
    const hex = n.toString(16).padStart(8, '0');
    return `${hex}-aaaa-4aaa-8aaa-${hex}${hex}aaaa`;
  });

const experiencePayloadArb: fc.Arbitrary<SharePayload> = fc.record({
  kind: fc.constant<'experience'>('experience'),
  experienceId: idArb,
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  note: fc.option(
    fc.string({ minLength: 1, maxLength: 50 }),
    { nil: undefined },
  ),
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

/**
 * `Date` arbitrary in a bounded range so shrinking lands on simple
 * timestamps. Dates are produced as actual `Date` instances to match
 * what the `pg` driver returns for `TIMESTAMPTZ` columns by default —
 * the repo's `toIsoTimestamp` helper expects this shape.
 */
const dateArb: fc.Arbitrary<Date> = fc
  .integer({ min: 0, max: 1_000_000_000_000 })
  .map((ms) => new Date(ms));

/** A single synthetic inbox row with random opened/unopened state. */
const rowArb: fc.Arbitrary<SyntheticInboxRow> = fc.record({
  shareId: idArb,
  openedAt: fc.option(dateArb, { nil: null }),
  senderId: idArb,
  payloadKind: fc.constantFrom<SharePayloadKind>('experience', 'progress'),
  payload: payloadArb,
  sentAt: dateArb,
}).map((r) => {
  // Make payloadKind agree with payload.kind so the row is internally
  // consistent (the repo would never surface a (kind=X, payload.kind=Y)
  // mix because the INSERT writes both from the same input).
  return { ...r, payloadKind: r.payload.kind };
});

/**
 * A population of inbox rows. Empty lists are allowed so the
 * `unread === 0` empty-inbox edge is also exercised.
 */
const populationArb: fc.Arbitrary<SyntheticInboxRow[]> = fc.array(rowArb, {
  minLength: 0,
  maxLength: 30,
});

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------

/**
 * Build a fake `DbPool` whose only behavior is: when `query()` is
 * called with the inbox SELECT, return the supplied population mapped
 * into the row shape the repo expects. Any other SQL is an error so a
 * future change to `listInbox` that issues additional statements will
 * surface as a clear test failure rather than silently returning empty
 * results.
 */
function makeFakePool(rows: ReadonlyArray<SyntheticInboxRow>): DbPool {
  const fake = {
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      if (
        !text.includes('FROM share_recipients sr') ||
        !text.includes('JOIN shares s')
      ) {
        throw new Error(`unexpected SQL in inbox property test: ${text}`);
      }
      // The repo scopes the query by the recipient id; mirror that here
      // so the test would catch a regression that drops the predicate.
      if (params[0] !== RECIPIENT_ID) {
        throw new Error(
          `unexpected recipient param: ${String(params[0])}`,
        );
      }
      return {
        rows: rows.map((r) => ({
          share_id: r.shareId,
          is_opened: r.openedAt !== null,
          sender_id: r.senderId,
          payload_kind: r.payloadKind,
          payload_snapshot: r.payload,
          sent_at: r.sentAt,
        })),
      };
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

describe('Property 24: inbox disclosure depends on opened state', () => {
  it(
    'reveals sender/content/timestamp iff opened_at is set; unread equals null-opened_at count',
    async () => {
      await fc.assert(
        fc.asyncProperty(populationArb, async (population) => {
          const repo = createSharingRepo(makeFakePool(population));

          const inbox = await repo.listInbox(RECIPIENT_ID);

          // 1) `unread` equals the count of rows with `opened_at IS NULL`
          //    (R9.8 — "recipient's unread Share count").
          const expectedUnread = population.filter(
            (r) => r.openedAt === null,
          ).length;
          expect(inbox.unread).toBe(expectedUnread);

          // 2) The repo preserves cardinality and the input ordering of
          //    rows (the SQL ORDER BY is exercised by the repo's test
          //    suite; here we only need a stable pairing so we can
          //    compare item-by-item).
          expect(inbox.items).toHaveLength(population.length);

          for (let i = 0; i < population.length; i += 1) {
            const row = population[i]!;
            const item = inbox.items[i]!;

            // Same shareId in either branch.
            expect(item.shareId).toBe(row.shareId);

            if (row.openedAt === null) {
              // R9.8: unopened item reveals only `{ shareId, isOpened }`.
              expect(item.isOpened).toBe(false);
              for (const key of FORBIDDEN_KEYS_WHEN_UNOPENED) {
                expect(item).not.toHaveProperty(key);
              }
              // Defensive: no extra keys at all beyond the allowed two.
              expect(Object.keys(item).sort()).toEqual([
                'isOpened',
                'shareId',
              ]);
            } else {
              // R9.9: opened item reveals sender, content, timestamp.
              expect(item.isOpened).toBe(true);
              expect(item.senderId).toBe(row.senderId);
              expect(item.payloadKind).toBe(row.payloadKind);
              expect(item.payload).toEqual(row.payload);
              expect(item.sentAt).toBe(row.sentAt.toISOString());
            }
          }
        }),
        { numRuns: NUM_RUNS },
      );
    },
  );
});
