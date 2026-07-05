// Feature: experience-detail-redesign — property test for the pure
// community-aggregate formatting core in `aggregateFormat.ts` (tasks.md → 6.4).
//
// This suite implements the feature's Property 13 against the framework-free
// `formatCommunityAggregate` projection that carries the Community_Rating_Section
// display guarantee. The property runs with `fast-check` at `numRuns: 100`.
//
//   - Property 13 — Community aggregate formatting (formatCommunityAggregate).
//       Validates: Requirements 8.6

import fc from 'fast-check';

import type { AggregateRatingDTO } from '@dwt/shared';

import { formatCommunityAggregate } from '../aggregateFormat';

const NUM_RUNS = 100;

// The contributing-rating count is a non-negative integer that always
// accompanies the aggregate (R10.3, R10.4).
const countArb = fc.nat({ max: 1_000_000 });

// A non-null mean spanning the published `[1.0, 10.0]` range (R10.5) plus the
// broader real line — the formatting rule is `value.toFixed(1)` regardless of
// range, so we exercise negatives, zero, and large magnitudes too.
const nonNullValueArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 1, max: 10, noNaN: true }) },
  {
    weight: 2,
    arbitrary: fc.double({ min: -1000, max: 1000, noNaN: true }),
  },
  { weight: 1, arbitrary: fc.constantFrom(0, -0, 9.95, 9.949999, 0.05) },
);

// A populated aggregate: a non-null mean together with a count.
const populatedAggregateArb: fc.Arbitrary<AggregateRatingDTO> = fc.record({
  value: nonNullValueArb,
  count: countArb,
});

// A below-threshold aggregate: `value` is null while the count is still carried
// (R10.4 / R8.5).
const emptyAggregateArb: fc.Arbitrary<AggregateRatingDTO> = fc.record({
  value: fc.constant(null),
  count: countArb,
});

// ---------------------------------------------------------------------------
// Property 13 — Community aggregate formatting
// ---------------------------------------------------------------------------
//
// Validates: Requirements 8.6

describe('Property 13: formatCommunityAggregate renders the mean to one decimal place and carries the count', () => {
  it('projects any non-null aggregate to a populated variant whose mean equals value.toFixed(1) and whose count is carried through (R8.6)', () => {
    fc.assert(
      fc.property(populatedAggregateArb, (aggregate) => {
        const result = formatCommunityAggregate(aggregate);

        // A non-null mean always projects to the populated variant.
        expect(result.kind).toBe('populated');
        if (result.kind !== 'populated') {
          return;
        }

        // R8.6 — the rendered mean is exactly `value.toFixed(1)` (one decimal).
        expect(result.mean).toBe(aggregate.value!.toFixed(1));
        // The formatted mean always has exactly one digit after the decimal.
        expect(result.mean).toMatch(/^-?\d+\.\d$/);

        // R8.6 — the contributing rating count is carried through unchanged.
        expect(result.count).toBe(aggregate.count);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('projects any null-valued aggregate to the empty variant regardless of count (R8.5)', () => {
    fc.assert(
      fc.property(emptyAggregateArb, (aggregate) => {
        const result = formatCommunityAggregate(aggregate);

        // A null mean projects to the empty variant carrying no mean/count.
        expect(result).toEqual({ kind: 'empty' });
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
