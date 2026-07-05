// Feature: stats-experience-redesign, Property 11: Highlight derivation determinism & totality
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.9
//
// Property 11 (from design.md):
//   `buildOverviewHighlights` is a pure, total, deterministic projection from
//   any valid Stats_Response to the ordered list of Overview_Hub highlight
//   cards:
//     - totality  (R2.1): total over any valid Stats_Response, always returning
//                          an ordered list (never throws / returns nullish).
//     - determinism (R2.2): equal inputs → equal ordered outputs.
//     - fixed order (R2.3): coverage, ratings, interests (only when facets
//                           exist), experiences.
//     - length     (R2.4/R2.5): 3 when `byFacetValue` is empty (interests
//                           omitted), 4 when it is non-empty (interests
//                           included).
//     - valid targets (R2.9): every card's `target.route` is a real StatsStack
//                           detail route — never the hub `StatsOverview`.
//     - completed-park rule (R2.6): WHERE any `byPark` cell has `completeBadge`
//                           true, the coverage highlight is `complete: true`
//                           with `percent: 100`.
//     - highest-percent park (R2.7): WHERE no park is complete but at least one
//                           `byPark` cell has `total > 0`, the coverage
//                           highlight leads with the highest-percent park, ties
//                           broken by canonical `PARKS` order.
//
// This targets the pure Overview-hub selector in `../statsView`
// (`buildOverviewHighlights` and its `pickCoverageHighlight` /
// `pickRatingsHighlight` / `pickInterestsHighlight` helpers).
//
// Test strategy:
//   - The selector is a framework-free pure function, so the property runs
//     without rendering — no React / navigation / expo mocks needed.
//   - Build arbitrary VALID `StatsResponse`s from the shared `statsFixture`
//     factories (`makeStatsResponse`, `makeSufficientRatings`,
//     `makeInsufficientRatings`, `makeCell`), overriding only the slices the
//     property branches on: `byPark`, `byFacetValue`, and `ratings`. Using the
//     factories keeps every generated cell / ratings object indistinguishable
//     from real wire data (all server invariants upheld).
//   - Dedicated `byPark` generators force the two coverage branches: one that
//     guarantees at least one complete park (R2.6), and one where every park is
//     incomplete but non-empty (R2.7). A general generator (random parks,
//     random facets, sufficient-or-insufficient ratings, optional percentile)
//     covers totality / determinism / order / length / valid-targets.

import { PARKS } from '@dwt/shared';
import type { Park } from '@dwt/shared';
import fc from 'fast-check';

import {
  buildOverviewHighlights,
  displayedPercent,
  displayedPercentLabel,
} from '../statsView';
import type { OverviewHighlight } from '../statsView';
import {
  makeCell,
  makeInsufficientRatings,
  makeStatsResponse,
  makeSufficientRatings,
} from '../__testSupport__/statsFixture';
import type {
  CompletionCell,
  FacetCoverage,
  RatingStatistics,
} from '../../../api/statsTypes';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The real StatsStack detail routes a highlight `target` may name (R2.9). The
 * hub `StatsOverview` is intentionally excluded — no highlight may target the
 * hub itself.
 */
const VALID_DETAIL_ROUTES = [
  'CoverageDetail',
  'RatingsDetail',
  'InterestsDetail',
  'ExperiencesDetail',
] as const;

// ---------------------------------------------------------------------------
// Cell generators
// ---------------------------------------------------------------------------

/**
 * An arbitrary VALID `CompletionCell`: `total` in `[0, 20]`, `completed` in
 * `[0, total]`, every derived field produced by the shared `makeCell` so the
 * cell upholds the server invariants. Small totals make percent ties common,
 * exercising the canonical-order tiebreak of the coverage pick.
 */
const cellArb: fc.Arbitrary<CompletionCell> = fc
  .nat({ max: 20 })
  .chain((total) => fc.nat({ max: total }).map((completed) => makeCell(completed, total)));

/** An arbitrary COMPLETE cell (`total >= 1`, `completed === total`). */
const completeCellArb: fc.Arbitrary<CompletionCell> = fc
  .integer({ min: 1, max: 20 })
  .map((total) => makeCell(total, total));

/** An arbitrary INCOMPLETE non-empty cell (`total >= 1`, `completed < total`). */
const incompleteNonEmptyCellArb: fc.Arbitrary<CompletionCell> = fc
  .integer({ min: 1, max: 20 })
  .chain((total) => fc.nat({ max: total - 1 }).map((completed) => makeCell(completed, total)));

// ---------------------------------------------------------------------------
// byPark generators
// ---------------------------------------------------------------------------

/** Build a fixed-enum `byPark` map (one cell per `Park`) from a per-cell arb. */
function byParkArbFrom(
  perCellArb: fc.Arbitrary<CompletionCell>,
): fc.Arbitrary<Record<Park, CompletionCell>> {
  return fc
    .array(perCellArb, { minLength: PARKS.length, maxLength: PARKS.length })
    .map((cells) => {
      const map = {} as Record<Park, CompletionCell>;
      PARKS.forEach((park, i) => {
        map[park] = cells[i]!;
      });
      return map;
    });
}

/** Fully arbitrary `byPark` (cells may be empty, partial, or complete). */
const byParkArb = byParkArbFrom(cellArb);

/**
 * A `byPark` map guaranteed to have at least one COMPLETE park: a fully
 * arbitrary map with one arbitrary park slot overwritten by a complete cell.
 * Exercises the R2.6 completed-park branch.
 */
const byParkWithCompleteArb: fc.Arbitrary<Record<Park, CompletionCell>> = fc
  .tuple(byParkArb, fc.constantFrom(...PARKS), completeCellArb)
  .map(([map, park, cell]) => ({ ...map, [park]: cell }));

/**
 * A `byPark` map where every park is incomplete but non-empty (`total >= 1`,
 * `completed < total`): no complete park, and at least one `total > 0`.
 * Exercises the R2.7 highest-percent-park branch.
 */
const byParkNoCompleteArb = byParkArbFrom(incompleteNonEmptyCellArb);

// ---------------------------------------------------------------------------
// Facet + ratings generators
// ---------------------------------------------------------------------------

const facetArb: fc.Arbitrary<FacetCoverage> = fc.record({
  key: fc.string({ minLength: 1, maxLength: 8 }),
  label: fc.constantFrom(
    'Thrill Rides',
    'Dark Rides',
    'Water Rides',
    'Shows',
    'Dining',
    'Characters',
  ),
  cell: cellArb,
});

/** An arbitrary facet list that MAY be empty (drives the length 3 vs 4 branch). */
const facetsArb: fc.Arbitrary<readonly FacetCoverage[]> = fc.array(facetArb, {
  maxLength: 8,
});

/** A non-empty facet list (forces the interests card / length 4). */
const nonEmptyFacetsArb: fc.Arbitrary<readonly FacetCoverage[]> = fc.array(facetArb, {
  minLength: 1,
  maxLength: 8,
});

/**
 * An arbitrary VALID `RatingStatistics`: either a sufficient object (every
 * gated field present, via the fixture factory) with a random average and
 * count, or an insufficient object reporting only `ratedCompletionsCount`.
 */
const ratingsArb: fc.Arbitrary<RatingStatistics> = fc.oneof(
  fc
    .record({
      average: fc.double({ min: 1, max: 10, noNaN: true }),
      ratedCompletionsCount: fc.integer({ min: 3, max: 200 }),
    })
    .map(({ average, ratedCompletionsCount }) =>
      makeSufficientRatings({ average, ratedCompletionsCount }),
    ),
  fc.integer({ min: 0, max: 2 }).map((count) => makeInsufficientRatings(count)),
);

// ---------------------------------------------------------------------------
// StatsResponse generator (general — random parks, facets, ratings, percentile)
// ---------------------------------------------------------------------------

const statsArb = fc
  .record({
    byPark: byParkArb,
    byFacetValue: facetsArb,
    ratings: ratingsArb,
    percentile: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  })
  .map(({ byPark, byFacetValue, ratings, percentile }) =>
    makeStatsResponse({
      coverage: { byPark, byFacetValue },
      ratings,
      ...(percentile !== undefined ? { percentileRank: percentile } : {}),
    }),
  );

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Assert every highlight targets a real detail route (never the hub). */
function expectValidTargets(highlights: readonly OverviewHighlight[]): void {
  for (const h of highlights) {
    expect(VALID_DETAIL_ROUTES).toContain(h.target.route);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((h.target as any).route).not.toBe('StatsOverview');
  }
}

// ---------------------------------------------------------------------------
// Property 11: totality, determinism, order, length, valid targets
// ---------------------------------------------------------------------------

describe('Property 11: Highlight derivation determinism & totality', () => {
  test('is total over any valid StatsResponse (returns an ordered list, never throws)', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        const highlights = buildOverviewHighlights(stats);
        expect(Array.isArray(highlights)).toBe(true);
        // Coverage + ratings + experiences always present; interests optional.
        expect(highlights.length).toBeGreaterThanOrEqual(3);
        expect(highlights.length).toBeLessThanOrEqual(4);
      }),
      { numRuns: 300 },
    );
  });

  test('is deterministic: equal input → equal ordered output (R2.2)', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        expect(buildOverviewHighlights(stats)).toEqual(buildOverviewHighlights(stats));
      }),
      { numRuns: 300 },
    );
  });

  test('produces the fixed order coverage → ratings → [interests] → experiences (R2.3)', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        const ids = buildOverviewHighlights(stats).map((h) => h.id);

        // Coverage first, ratings second, experiences last — always.
        expect(ids[0]).toBe('coverage');
        expect(ids[1]).toBe('ratings');
        expect(ids[ids.length - 1]).toBe('experiences');

        // 'interests' appears iff facets are present, and only at index 2.
        const hasFacets = stats.coverage.byFacetValue.length > 0;
        if (hasFacets) {
          expect(ids).toEqual(['coverage', 'ratings', 'interests', 'experiences']);
        } else {
          expect(ids).toEqual(['coverage', 'ratings', 'experiences']);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('has length 3 when byFacetValue is empty (interests omitted, R2.4)', () => {
    fc.assert(
      fc.property(byParkArb, ratingsArb, (byPark, ratings) => {
        const stats = makeStatsResponse({
          coverage: { byPark, byFacetValue: [] },
          ratings,
        });
        const highlights = buildOverviewHighlights(stats);
        expect(highlights).toHaveLength(3);
        expect(highlights.some((h) => h.id === 'interests')).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  test('has length 4 when byFacetValue is non-empty (interests included, R2.5)', () => {
    fc.assert(
      fc.property(byParkArb, nonEmptyFacetsArb, ratingsArb, (byPark, byFacetValue, ratings) => {
        const stats = makeStatsResponse({
          coverage: { byPark, byFacetValue },
          ratings,
        });
        const highlights = buildOverviewHighlights(stats);
        expect(highlights).toHaveLength(4);

        const interests = highlights.find((h) => h.id === 'interests');
        expect(interests).toBeDefined();
        expect(interests?.target.route).toBe('InterestsDetail');
      }),
      { numRuns: 200 },
    );
  });

  test('every highlight target is a real StatsStack detail route, never the hub (R2.9)', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        expectValidTargets(buildOverviewHighlights(stats));
      }),
      { numRuns: 300 },
    );
  });

  test('fixed per-id targets: coverage→CoverageDetail, ratings→RatingsDetail, experiences→ExperiencesDetail', () => {
    fc.assert(
      fc.property(statsArb, (stats) => {
        const byId = new Map(buildOverviewHighlights(stats).map((h) => [h.id, h] as const));
        expect(byId.get('coverage')?.target.route).toBe('CoverageDetail');
        expect(byId.get('ratings')?.target.route).toBe('RatingsDetail');
        expect(byId.get('experiences')?.target.route).toBe('ExperiencesDetail');
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: completed-park ⇒ complete/100 (R2.6)
// ---------------------------------------------------------------------------

describe('Property 11: coverage highlight — completed-park rule (R2.6)', () => {
  test('when any byPark cell is complete, coverage highlight is complete: true, percent: 100', () => {
    fc.assert(
      fc.property(byParkWithCompleteArb, facetsArb, ratingsArb, (byPark, byFacetValue, ratings) => {
        const stats = makeStatsResponse({
          coverage: { byPark, byFacetValue },
          ratings,
        });
        const coverage = buildOverviewHighlights(stats)[0]!;

        expect(coverage.id).toBe('coverage');
        expect(coverage.complete).toBe(true);
        expect(coverage.percent).toBe(100);
        expect(coverage.target.route).toBe('CoverageDetail');
      }),
      { numRuns: 250 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: highest-percent park with canonical tiebreak (R2.7)
// ---------------------------------------------------------------------------

describe('Property 11: coverage highlight — highest-percent park (R2.7)', () => {
  test('when no park is complete but some have total > 0, leads with the highest-percent park (canonical tiebreak)', () => {
    fc.assert(
      fc.property(byParkNoCompleteArb, facetsArb, ratingsArb, (byPark, byFacetValue, ratings) => {
        const stats = makeStatsResponse({
          coverage: { byPark, byFacetValue },
          ratings,
        });
        const coverage = buildOverviewHighlights(stats)[0]!;

        // Expected best: highest raw percent among parks with total > 0, ties
        // broken by canonical PARKS order (first canonical park wins a tie).
        let best: { park: Park; cell: CompletionCell } | null = null;
        for (const park of PARKS) {
          const cell = byPark[park];
          if (cell.total > 0 && (best === null || cell.percent > best.cell.percent)) {
            best = { park, cell };
          }
        }
        expect(best).not.toBeNull();
        const chosen = best as { park: Park; cell: CompletionCell };

        expect(coverage.id).toBe('coverage');
        expect(coverage.complete).toBeFalsy();
        expect(coverage.percent).toBe(displayedPercent(chosen.cell));
        expect(coverage.headline).toBe(
          `Best park: ${chosen.park} ${displayedPercentLabel(chosen.cell)}%`,
        );
        expect(coverage.target.route).toBe('CoverageDetail');
      }),
      { numRuns: 300 },
    );
  });
});
