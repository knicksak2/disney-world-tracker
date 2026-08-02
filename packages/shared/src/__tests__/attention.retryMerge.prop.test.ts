// Feature: notification-center, Property 10: Retry recomputes state from the latest per-source outcomes
/**
 * Property-based test for the Notification_Center retry recomputation
 * (`mergeOutcomes` + `recomputeAfterRetry`).
 *
 * Property 10 (design.md → Correctness Properties):
 *
 *   For any prior set of successful sources and any set of retried-source
 *   outcomes, the Attention_State after a retry equals the state computed from
 *   the latest outcome of every source (retried successes replace their prior
 *   failure and merge with the previously loaded successful items; still-failed
 *   sources remain in the failed-domain set).
 *
 * The oracle recomputes the expected state independently: for every domain it
 * takes the retried outcome when that domain was re-requested, otherwise the
 * prior outcome, then feeds that "latest outcome per domain" set to
 * `buildAttentionState`. The test asserts:
 *
 *   1. `recomputeAfterRetry(prior, retried, sortMode)` deep-equals
 *      `buildAttentionState(latestOutcomePerDomain, sortMode)`.
 *   2. A retried success replaces a prior failure and merges with the
 *      previously loaded successful items (its items are present; its domain is
 *      not in `failedDomains`).
 *   3. A source whose latest outcome is a failure remains in `failedDomains`.
 *   4. Prior successes for domains that were not re-requested are preserved.
 *
 * Validates: Requirements 8.5, 8.6
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildAttentionState,
  recomputeAfterRetry,
  DOMAIN_ORDER,
  type AttentionDomain,
  type AttentionItem,
  type AttentionSourceOutcome,
  type SortMode,
} from '../attention.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** An ISO-8601 timestamp drawn from a wide but bounded instant range. */
const timestampArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970 .. ~2100
  .map((ms) => new Date(ms).toISOString());

/**
 * A single {@link AttentionItem} for the given domain. Every item gets a unique
 * `id` from a run-scoped counter shared across the prior and retried sets, so
 * items never collide when the feed is compared as a multiset by `id` and a
 * "previously loaded" item can be distinguished from a "newly retried" one.
 */
const itemArb = (
  domain: AttentionDomain,
  nextId: () => string,
): fc.Arbitrary<AttentionItem> =>
  fc
    .tuple(timestampArb, fc.string({ maxLength: 40 }))
    .map(([sourceTimestamp, summary]) => ({
      domain,
      id: nextId(),
      sourceTimestamp,
      summary,
      ref: {},
    }));

/**
 * A per-source outcome for `domain`: either a `success` carrying an arbitrary
 * (possibly empty) set of pending items, or a `failure` carrying none.
 */
const outcomeArb = (
  domain: AttentionDomain,
  nextId: () => string,
): fc.Arbitrary<AttentionSourceOutcome> =>
  fc.oneof(
    fc
      .array(itemArb(domain, nextId), { maxLength: 5 })
      .map((items) => ({ domain, status: 'success' as const, items })),
    fc.constant({ domain, status: 'failure' as const }),
  );

/** One outcome per domain in `domains`, sharing the run-scoped id counter. */
const outcomesForDomains = (
  domains: readonly AttentionDomain[],
  nextId: () => string,
): fc.Arbitrary<AttentionSourceOutcome[]> =>
  domains.length === 0
    ? fc.constant<AttentionSourceOutcome[]>([])
    : fc.tuple(...domains.map((d) => outcomeArb(d, nextId)));

/**
 * A retry scenario: a `prior` set of per-source outcomes (a mix of success and
 * failure over an arbitrary subset of the four domains) and a `retried` set
 * (over an arbitrary subset of domains — typically the previously-failed ones,
 * but generated freely so overriding a prior success is exercised too). Both
 * sets share a single id counter so every generated item id is globally unique.
 */
const scenarioArb: fc.Arbitrary<{
  prior: AttentionSourceOutcome[];
  retried: AttentionSourceOutcome[];
}> = fc
  .tuple(
    fc.subarray([...DOMAIN_ORDER], { minLength: 0, maxLength: DOMAIN_ORDER.length }),
    fc.subarray([...DOMAIN_ORDER], { minLength: 0, maxLength: DOMAIN_ORDER.length }),
  )
  .chain(([priorDomains, retriedDomains]) => {
    let counter = 0;
    const nextId = () => `item-${counter++}`;
    return fc.record({
      prior: outcomesForDomains(priorDomains, nextId),
      retried: outcomesForDomains(retriedDomains, nextId),
    });
  });

const sortModeArb: fc.Arbitrary<SortMode> = fc.constantFrom(
  'timestampDesc',
  'groupByDomain',
);

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/**
 * The latest outcome for every source: the retried outcome for any domain that
 * was re-requested, otherwise the prior outcome. Ordering is irrelevant to
 * `buildAttentionState` (it orders items deterministically), so a plain map
 * suffices as an independent oracle.
 */
function latestOutcomePerDomain(
  prior: readonly AttentionSourceOutcome[],
  retried: readonly AttentionSourceOutcome[],
): AttentionSourceOutcome[] {
  const latest = new Map<AttentionDomain, AttentionSourceOutcome>();
  for (const o of prior) latest.set(o.domain, o);
  for (const o of retried) latest.set(o.domain, o);
  return [...latest.values()];
}

const successItemIds = (outcomes: readonly AttentionSourceOutcome[]): string[] =>
  outcomes
    .filter((o): o is Extract<AttentionSourceOutcome, { status: 'success' }> => o.status === 'success')
    .flatMap((o) => o.items.map((i) => i.id))
    .sort();

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Property 10: Retry recomputes state from the latest per-source outcomes', () => {
  it('post-retry state equals the state computed from the latest per-source outcomes (R8.5, R8.6)', () => {
    fc.assert(
      fc.property(scenarioArb, sortModeArb, ({ prior, retried }, sortMode) => {
        const actual = recomputeAfterRetry(prior, retried, sortMode);

        const latest = latestOutcomePerDomain(prior, retried);
        const expected = buildAttentionState(latest, sortMode);

        // 1. The retried state is exactly the state derived from the latest
        //    outcome of every source (R8.5, R8.6).
        expect(actual).toEqual(expected);

        const retriedDomains = new Set(retried.map((o) => o.domain));
        const feedIds = actual.items.map((i) => i.id).sort();

        // 2. Retried successes replace their prior outcome and merge with the
        //    previously loaded successful items: every item from a retried
        //    success is present in the feed, and its domain is not failed.
        for (const o of retried) {
          if (o.status === 'success') {
            for (const item of o.items) {
              expect(feedIds).toContain(item.id);
            }
            expect(actual.failedDomains).not.toContain(o.domain);
          }
        }

        // 3. Every source whose latest outcome is a failure remains in the
        //    failed-domain set, and no other domain does.
        const expectedFailed = latest
          .filter((o) => o.status === 'failure')
          .map((o) => o.domain)
          .sort();
        expect([...actual.failedDomains].sort()).toEqual(expectedFailed);

        // 4. Prior successes for domains that were NOT re-requested are
        //    preserved unchanged in the merged feed.
        for (const o of prior) {
          if (o.status === 'success' && !retriedDomains.has(o.domain)) {
            for (const item of o.items) {
              expect(feedIds).toContain(item.id);
            }
          }
        }

        // Sanity: the feed is exactly the multiset of items from the latest
        //  successful outcomes — nothing lost, nothing invented.
        expect(feedIds).toEqual(successItemIds(latest));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
