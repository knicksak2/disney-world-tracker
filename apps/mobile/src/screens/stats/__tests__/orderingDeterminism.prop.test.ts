// Feature: stats-experience-redesign, Property 9: Ordering determinism
//
// Validates: Requirements 9.2
//
// Property 9 (from design.md):
//   The stats display ordering is deterministic and canonical:
//     - park tiles follow the canonical `PARKS` order,
//     - category tiles follow the canonical `EXPERIENCE_CATEGORIES` order,
//     - facet ("interests") order is a TOTAL order: percent descending, then
//       total descending, then case-insensitive label ascending, then exact
//       label ascending.
//
// This targets the pure display transforms in `../statsView`:
//   - `buildParkTiles(byPark)`     — one tile per park, always in `PARKS` order.
//   - `buildCategoryTiles(byCat)`  — one tile per category, always in
//                                    `EXPERIENCE_CATEGORIES` order.
//   - `sortFacetsForDisplay(list)` — the total-order facet sort.
//
// Test strategy:
//   - All three transforms are framework-free pure functions, so the property
//     runs without rendering — no React / navigation / expo mocks needed.
//   - `buildParkTiles` / `buildCategoryTiles`: generate arbitrary fixed-enum
//     `byPark` / `byCategory` maps (one arbitrary VALID cell per member via the
//     shared `makeCell` fixture builder) and assert the emitted tile `key`
//     sequence equals the canonical enum array exactly — regardless of the
//     (arbitrary) cell values — and that each tile carries the matching cell.
//   - `sortFacetsForDisplay`: generate arbitrary facet lists. To prove a TOTAL
//     order we need the comparator to be strict on distinct elements, so the
//     permutation-invariance generator uses distinct exact labels drawn from a
//     pool that includes case variants ("Thrill" vs "thrill") — exercising the
//     case-insensitive-then-exact tiebreak. Cells use small totals so percent
//     and total ties occur often, exercising the higher-priority keys too.
//   - Total order is verified two ways: (a) every adjacent pair in the output
//     respects the ordering predicate, and (b) sorting the same set in a
//     different input permutation yields a byte-identical result (a comparator
//     that is not a total order would let permutations diverge). Determinism
//     (equal input → equal output) and purity (input not mutated) are also
//     asserted.

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';
import fc from 'fast-check';

import { buildCategoryTiles, buildParkTiles, sortFacetsForDisplay } from '../statsView';
import { makeCell } from '../__testSupport__/statsFixture';
import type { CompletionCell, FacetCoverage } from '../../../api/statsTypes';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * An arbitrary VALID `CompletionCell`: `total` in `[0, 20]`, `completed` in
 * `[0, total]`, every other field derived by the shared `makeCell` so the cell
 * upholds the server invariants. Small totals make percent / total ties common,
 * exercising the lower-priority tiebreaks of the facet sort.
 */
const cellArb: fc.Arbitrary<CompletionCell> = fc
  .nat({ max: 20 })
  .chain((total) => fc.nat({ max: total }).map((completed) => makeCell(completed, total)));

/** Build a fixed-enum cell map (one arbitrary cell per enum member). */
function enumCellMapArb<K extends string>(
  keys: readonly K[],
): fc.Arbitrary<Record<K, CompletionCell>> {
  return fc
    .array(cellArb, { minLength: keys.length, maxLength: keys.length })
    .map((cells) => {
      const map = {} as Record<K, CompletionCell>;
      keys.forEach((key, i) => {
        map[key] = cells[i]!;
      });
      return map;
    });
}

const byParkArb = enumCellMapArb<Park>(PARKS);
const byCategoryArb = enumCellMapArb<ExperienceCategory>(EXPERIENCE_CATEGORIES);

/**
 * A pool of facet labels including case variants of the same word so the
 * case-insensitive-ascending tiebreak (and its exact-label follow-up) is
 * exercised when two labels compare equal case-insensitively.
 */
const LABEL_POOL = [
  'Thrill Rides',
  'thrill rides',
  'Dark Rides',
  'dark rides',
  'Water Rides',
  'Shows',
  'shows',
  'Dining',
  'dining',
  'Parades',
  'Tours',
  'Characters',
  'characters',
  'Spa',
  'Events',
  'Alpha',
  'alpha',
  'Beta',
  'beta',
] as const;

/**
 * An arbitrary facet list with DISTINCT exact labels. Distinct exact labels
 * make the comparator strict on every pair (the exact-label tiebreak never
 * returns 0), so the sort is a genuine total order — a prerequisite for
 * permutation invariance.
 */
const uniqueFacetsArb: fc.Arbitrary<readonly FacetCoverage[]> = fc
  .uniqueArray(fc.constantFrom(...LABEL_POOL), { maxLength: LABEL_POOL.length })
  .chain((labels) =>
    fc
      .tuple(...labels.map(() => cellArb))
      .map((cells) =>
        labels.map((label, i) => ({
          key: `facet-${i}`,
          label,
          cell: cells[i]!,
        })),
      ),
  );

/**
 * An arbitrary facet list that MAY contain repeated labels (looser than
 * `uniqueFacetsArb`). Used for determinism / purity / adjacency checks that do
 * not depend on strictness.
 */
const anyFacetsArb: fc.Arbitrary<readonly FacetCoverage[]> = fc.array(
  fc.record({
    key: fc.string({ minLength: 1, maxLength: 6 }),
    label: fc.constantFrom(...LABEL_POOL),
    cell: cellArb,
  }),
  { maxLength: 12 },
);

// ---------------------------------------------------------------------------
// Ordering predicate mirroring `sortFacetsForDisplay`
// ---------------------------------------------------------------------------

/**
 * Returns a negative number when `a` MUST come before `b` under the display
 * order (percent desc → total desc → case-insensitive label asc → exact label
 * asc), positive when after, and 0 only for fully-equal-by-order elements. This
 * mirrors the comparator in `sortFacetsForDisplay` and is used to check every
 * adjacent pair of the produced ordering.
 */
function facetOrder(a: FacetCoverage, b: FacetCoverage): number {
  if (b.cell.percent !== a.cell.percent) return b.cell.percent - a.cell.percent;
  if (b.cell.total !== a.cell.total) return b.cell.total - a.cell.total;
  const al = a.label.toLowerCase();
  const bl = b.label.toLowerCase();
  if (al !== bl) return al < bl ? -1 : 1;
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
}

/** A fixed shuffle: reverse then interleave, deterministic and non-trivial. */
function permute<T>(items: readonly T[]): readonly T[] {
  const reversed = [...items].reverse();
  const out: T[] = [];
  const mid = Math.ceil(reversed.length / 2);
  for (let i = 0; i < mid; i += 1) {
    out.push(reversed[i]!);
    const j = reversed.length - 1 - i;
    if (j > i) out.push(reversed[j]!);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property 9: Ordering determinism — park tiles follow PARKS
// ---------------------------------------------------------------------------

describe('Property 9: Ordering determinism (R9.2)', () => {
  test('park tiles follow the canonical PARKS order for any byPark map', () => {
    fc.assert(
      fc.property(byParkArb, (byPark) => {
        const tiles = buildParkTiles(byPark);

        // One tile per park, in canonical order (keys and titles both == PARKS).
        expect(tiles.map((t) => t.key)).toEqual([...PARKS]);
        expect(tiles.map((t) => t.title)).toEqual([...PARKS]);

        // Each tile carries the exact cell from the input map.
        tiles.forEach((tile) => {
          expect(tile.cell).toBe(byPark[tile.key as Park]);
        });

        // Determinism: equal input → equal ordered output.
        expect(buildParkTiles(byPark)).toEqual(tiles);
      }),
      { numRuns: 200 },
    );
  });

  test('category tiles follow the canonical EXPERIENCE_CATEGORIES order for any byCategory map', () => {
    fc.assert(
      fc.property(byCategoryArb, (byCategory) => {
        const tiles = buildCategoryTiles(byCategory);

        // One tile per category, in canonical order (keys == EXPERIENCE_CATEGORIES).
        expect(tiles.map((t) => t.key)).toEqual([...EXPERIENCE_CATEGORIES]);

        // Each tile carries the exact cell from the input map.
        tiles.forEach((tile) => {
          expect(tile.cell).toBe(byCategory[tile.key as ExperienceCategory]);
        });

        // Determinism: equal input → equal ordered output.
        expect(buildCategoryTiles(byCategory)).toEqual(tiles);
      }),
      { numRuns: 200 },
    );
  });

  test('facet order is a total order: every adjacent pair respects the display predicate', () => {
    fc.assert(
      fc.property(anyFacetsArb, (facets) => {
        const sorted = sortFacetsForDisplay(facets);

        // Same multiset (nothing added/dropped).
        expect(sorted).toHaveLength(facets.length);

        // Every adjacent pair is ordered: predecessor comes before-or-equal.
        for (let i = 0; i + 1 < sorted.length; i += 1) {
          expect(facetOrder(sorted[i]!, sorted[i + 1]!)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('facet order is invariant to input permutation (total order) and deterministic', () => {
    fc.assert(
      fc.property(uniqueFacetsArb, (facets) => {
        const sorted = sortFacetsForDisplay(facets);

        // Determinism: equal input → equal output.
        expect(sortFacetsForDisplay(facets)).toEqual(sorted);

        // Permutation invariance: reordering the input yields the identical
        // ordering. Only possible if the comparator defines a total order.
        const permuted = permute(facets);
        expect(sortFacetsForDisplay(permuted)).toEqual(sorted);

        // With distinct exact labels the order is strict on every adjacent pair.
        for (let i = 0; i + 1 < sorted.length; i += 1) {
          expect(facetOrder(sorted[i]!, sorted[i + 1]!)).toBeLessThan(0);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('sortFacetsForDisplay does not mutate its input (purity)', () => {
    fc.assert(
      fc.property(anyFacetsArb, (facets) => {
        const snapshot = [...facets];
        sortFacetsForDisplay(facets);
        // Input array reference order unchanged.
        expect(facets).toEqual(snapshot);
      }),
      { numRuns: 100 },
    );
  });
});
