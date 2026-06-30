// Feature: experience-live-details, Property 13: Showtime view is sorted ascending by start, empty when none
//
// Validates: Requirements 5.1, 5.2
//
// Property 13 (from design.md → Correctness Properties):
//   For any list of current-day Showtimes, `sortedShowtimes(showtimes)`:
//     - returns the showtimes sorted ascending (non-decreasing) by start time,
//       expressed as park-local instants (R5.1);
//     - preserves cardinality one-for-one — nothing is dropped, duplicated, or
//       fabricated, and every input showtime appears in the output (R5.1);
//     - is stable on ties (entries sharing the same start keep their input
//       order), making the result fully deterministic;
//     - returns [] for an empty input, which drives the "no performances
//       scheduled for the current day" empty state (R5.2).
//
// Test strategy:
//   - Generate Showtime lists from millisecond instants so the oracle can
//     reason about ordering directly from numbers. Distinct instants are NOT
//     forced, so ties on start are sampled and the stable-ordering contract is
//     exercised.
//   - Tag each generated showtime with a unique id so cardinality/permutation
//     and stability-on-ties can be checked precisely against the input.
//   - `sortedShowtimes` is pure/total/deterministic, so the test asserts
//     directly on the returned array — no mocking, no clock, no I/O.

import fc from 'fast-check';
import type { Showtime } from '@dwt/shared';

import { sortedShowtimes } from '../liveView';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A bounded instant range (a single park-local day) so start times cluster and
// ties are sampled frequently.
const MIN_MS = Date.UTC(2024, 5, 1, 8, 0, 0);
const MAX_MS = Date.UTC(2024, 5, 2, 2, 0, 0); // ~18h window

const instantMsArb: fc.Arbitrary<number> = fc.integer({ min: MIN_MS, max: MAX_MS });

// A Showtime carrying a unique `__id` (via the optional `type` label) so the
// oracle can match output entries back to specific input entries — this lets
// the test verify exact one-for-one preservation and stable tie ordering.
interface TaggedShowtime extends Showtime {
  readonly type: string; // doubles as the unique tag
}

const taggedShowtimeArb = (id: number): fc.Arbitrary<TaggedShowtime> =>
  fc.record({
    start: instantMsArb.map((ms) => new Date(ms).toISOString()),
    end: fc.option(instantMsArb.map((ms) => new Date(ms).toISOString()), {
      nil: undefined,
    }),
  }).map(({ start, end }) =>
    // Under `exactOptionalPropertyTypes`, an optional `end` must be omitted
    // entirely when absent rather than set to `undefined`.
    end === undefined
      ? { start, type: `st-${id}` }
      : { start, end, type: `st-${id}` },
  );

// Build a list whose entries each have a unique tag (`st-0`, `st-1`, ...).
const showtimeListArb: fc.Arbitrary<readonly TaggedShowtime[]> = fc
  .integer({ min: 0, max: 12 })
  .chain((length) =>
    length === 0
      ? fc.constant([] as readonly TaggedShowtime[])
      : fc.tuple(...Array.from({ length }, (_, i) => taggedShowtimeArb(i))),
  );

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 13: Showtime view is sorted ascending by start, empty when none (R5.1, R5.2)', () => {
  test('sortedShowtimes sorts ascending by start, stable on ties, and preserves cardinality', () => {
    fc.assert(
      fc.property(showtimeListArb, (showtimes) => {
        const sorted = sortedShowtimes(showtimes);

        // R5.1 — cardinality preserved one-for-one (nothing dropped/added).
        expect(sorted.length).toBe(showtimes.length);

        // R5.1 — sorted ascending (non-decreasing) by start instant.
        for (let i = 1; i < sorted.length; i += 1) {
          const prev = sorted[i - 1];
          const curr = sorted[i];
          expect(prev).toBeDefined();
          expect(curr).toBeDefined();
          expect(Date.parse(prev!.start)).toBeLessThanOrEqual(
            Date.parse(curr!.start),
          );
        }

        // R5.1 — output is a permutation of the input: the same set of unique
        // tags appears, so no entry is fabricated, dropped, or duplicated.
        const inputTags = [...showtimes].map((s) => (s as TaggedShowtime).type).sort();
        const outputTags = sorted.map((s) => (s as TaggedShowtime).type).sort();
        expect(outputTags).toEqual(inputTags);

        // Stable on ties — entries sharing the same start keep their input
        // order. Group output indices by start instant and assert each group's
        // tags appear in their original input sequence.
        const inputOrder = new Map(
          showtimes.map((s, idx) => [(s as TaggedShowtime).type, idx] as const),
        );
        for (let i = 1; i < sorted.length; i += 1) {
          const prev = sorted[i - 1] as TaggedShowtime;
          const curr = sorted[i] as TaggedShowtime;
          if (Date.parse(prev.start) === Date.parse(curr.start)) {
            expect(inputOrder.get(prev.type)!).toBeLessThan(inputOrder.get(curr.type)!);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  test('empty input yields an empty showtime list (R5.2)', () => {
    expect(sortedShowtimes([])).toEqual([]);
  });
});
