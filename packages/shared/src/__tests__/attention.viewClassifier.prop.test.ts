// Feature: notification-center, Property 12: View classification is mutually exclusive
/**
 * Property-based test for the Notification_Center pure attention model's view
 * classifier (`classifyView`).
 *
 * Property 12 (design.md → Correctness Properties):
 *
 *   For any combination of in-flight status and per-source outcomes, the view
 *   classifier returns exactly one view: it returns loading whenever at least
 *   one read is still in flight; it returns empty only when all four reads
 *   succeeded and the total number of pending items is zero; otherwise it
 *   returns the error view (when applicable) or the populated list — never more
 *   than one at a time.
 *
 * Validates: Requirements 9.2, 9.3, 9.6
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  classifyView,
  DOMAIN_ORDER,
  type AttentionDomain,
  type AttentionItem,
  type AttentionSourceOutcome,
  type AttentionView,
} from '../attention.js';

const NUM_RUNS = 100;

// The complete set of views the classifier can ever return. Used to assert
// mutual exclusivity: exactly one of these is the returned value (R9.6).
const ALL_VIEWS: readonly AttentionView[] = ['loading', 'empty', 'error', 'list'];

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** An ISO-8601 timestamp drawn from a wide but bounded instant range. */
const timestampArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970 .. ~2100
  .map((ms) => new Date(ms).toISOString());

/**
 * A single {@link AttentionItem} for the given domain. The classifier only ever
 * looks at item counts, so the field values are otherwise unconstrained.
 */
const itemArb = (domain: AttentionDomain): fc.Arbitrary<AttentionItem> =>
  fc
    .tuple(timestampArb, fc.string({ maxLength: 40 }), fc.string({ maxLength: 12 }))
    .map(([sourceTimestamp, summary, id]) => ({
      domain,
      id,
      sourceTimestamp,
      summary,
      ref: {},
    }));

/**
 * A per-source outcome for `domain`: either a `success` carrying an arbitrary
 * (possibly empty) set of pending items, or a `failure` carrying none.
 */
const outcomeArb = (domain: AttentionDomain): fc.Arbitrary<AttentionSourceOutcome> =>
  fc.oneof(
    fc
      .array(itemArb(domain), { maxLength: 6 })
      .map((items) => ({ domain, status: 'success' as const, items })),
    fc.constant({ domain, status: 'failure' as const }),
  );

/**
 * An arbitrary set of per-source outcomes — one outcome per domain, over an
 * arbitrary (possibly empty) subset of the four domains, in an arbitrary order.
 */
const outcomesArb: fc.Arbitrary<AttentionSourceOutcome[]> = fc
  .subarray([...DOMAIN_ORDER], { minLength: 0, maxLength: DOMAIN_ORDER.length })
  .chain((domains) =>
    // Shuffle so source order is arbitrary, not always DOMAIN_ORDER.
    fc.shuffledSubarray(domains, { minLength: domains.length, maxLength: domains.length }),
  )
  .chain((domains) =>
    domains.length === 0
      ? fc.constant<AttentionSourceOutcome[]>([])
      : fc.tuple(...domains.map((d) => outcomeArb(d))),
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const totalPendingItems = (outcomes: readonly AttentionSourceOutcome[]): number =>
  outcomes.reduce(
    (sum, o) => (o.status === 'success' ? sum + o.items.length : sum),
    0,
  );

const anyFailed = (outcomes: readonly AttentionSourceOutcome[]): boolean =>
  outcomes.some((o) => o.status === 'failure');

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

describe('Property 12: View classification is mutually exclusive', () => {
  it('returns exactly one view, with loading winning while any read is in flight (R9.2, R9.3, R9.6)', () => {
    fc.assert(
      fc.property(fc.boolean(), outcomesArb, (inFlight, outcomes) => {
        const view = classifyView(inFlight, outcomes);

        // Mutual exclusivity: the result is exactly one of the known views
        // (R9.6). Being a single scalar return value, it can never be two at
        // once; we also assert it is a recognized view.
        expect(ALL_VIEWS).toContain(view);
        expect(ALL_VIEWS.filter((v) => v === view)).toHaveLength(1);

        // Loading wins whenever at least one read is still in flight, no matter
        // what outcomes have been gathered so far (R9.3).
        if (inFlight) {
          expect(view).toBe('loading');
          return;
        }

        // Nothing in flight → the classifier never reports loading.
        expect(view).not.toBe('loading');

        if (anyFailed(outcomes)) {
          // Any failed source (including total failure) → error, never empty
          // or list.
          expect(view).toBe('error');
        } else if (totalPendingItems(outcomes) === 0) {
          // All reads succeeded with zero total pending items → empty (R9.2).
          expect(view).toBe('empty');
        } else {
          // All reads succeeded with at least one pending item → list.
          expect(view).toBe('list');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('classifies loading regardless of outcomes when a read is in flight (R9.3)', () => {
    fc.assert(
      fc.property(outcomesArb, (outcomes) => {
        // With inFlight true, the view is loading for every possible outcome
        // set — the loading indication is preferred over empty until every
        // read resolves.
        expect(classifyView(true, outcomes)).toBe('loading');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
