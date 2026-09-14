/**
 * Property-based tests for festival stats roll-up.
 *
 * Feature: festival-booth-tagging, Property 28: Festival Stats Are Counts, Never Percentages
 *
 * Validates: Requirements 5.3, 6.1
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FESTIVAL_SLUGS, festivalStatsSchema, type FestivalSlug } from '@dwt/shared';
import { rollUpFestivalStats, type RawFestivalCountRow } from '../festivals.js';

const festivalRowsArb: fc.Arbitrary<RawFestivalCountRow[]> = fc
  .shuffledSubarray([...FESTIVAL_SLUGS])
  .chain((slugs: FestivalSlug[]) =>
    slugs.length === 0
      ? fc.constant<RawFestivalCountRow[]>([])
      : fc.tuple<RawFestivalCountRow[]>(
          ...slugs.map((slug) =>
            fc.record<RawFestivalCountRow>({
              slug: fc.constant(slug),
              n: fc.oneof(
                fc.nat({ max: 1000 }),
                fc.nat({ max: 1000 }).map((n) => String(n)),
              ),
            }),
          ),
        ),
  );

describe('Festival Stats Property Tests', () => {
  it('Feature: festival-booth-tagging, Property 28: Festival Stats Are Counts, Never Percentages', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5000 }),
        festivalRowsArb,
        (lifetimeCount, rawRows) => {
          const result = rollUpFestivalStats(lifetimeCount, rawRows);

          // 1. Zod strict schema parsing succeeds — rejects any extra ratio/percent/total fields
          const parsed = festivalStatsSchema.parse(result);
          expect(parsed).toBeDefined();

          // 2. Strict key verification at runtime
          const topLevelKeys = Object.keys(result).sort();
          expect(topLevelKeys).toEqual(['byFestival', 'lifetimeCount']);

          for (const item of result.byFestival) {
            const itemKeys = Object.keys(item).sort();
            expect(itemKeys).toEqual(['count', 'slug']);
            // count must be a positive integer
            expect(item.count).toBeGreaterThan(0);
            expect(Number.isInteger(item.count)).toBe(true);
            expect(FESTIVAL_SLUGS).toContain(item.slug);
          }

          // 3. lifetimeCount is a non-negative integer
          expect(Number.isInteger(result.lifetimeCount)).toBe(true);
          expect(result.lifetimeCount).toBeGreaterThanOrEqual(0);

          // 4. Sorting invariant: count desc, then slug asc
          for (let i = 1; i < result.byFestival.length; i++) {
            const prev = result.byFestival[i - 1]!;
            const curr = result.byFestival[i]!;
            if (prev.count === curr.count) {
              expect(prev.slug.localeCompare(curr.slug)).toBeLessThan(0);
            } else {
              expect(prev.count).toBeGreaterThan(curr.count);
            }
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
