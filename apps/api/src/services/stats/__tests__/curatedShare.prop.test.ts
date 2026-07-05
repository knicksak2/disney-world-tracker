// Feature: expanded-stats, Property 12: Curated share snapshot selects the top facet and excludes verbose stats
/**
 * Property-based tests for the Stats_Service curated Progress_Share snapshot.
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8
 *
 * Design Property 12 says, in essence:
 *
 *   For any computed stats snapshot, the curated Progress_Share payload
 *   (`CuratedProgressStats`)
 *     - includes `overallPercent` in [0.0, 100.0] (R10.1),
 *     - includes `percentileRank` in [0.0, 100.0], 0.0 when the sender has zero
 *       completions (R10.3),
 *     - includes `topFacet` — the facet statistic with the highest `completed`
 *       count, ties broken by highest `percent` then ascending case-insensitive
 *       label — whenever the sender has at least one facet statistic, even when
 *       its completed count is 0 (R10.2, R10.4, R10.7), and omits it entirely
 *       when the sender has no facet statistic (R10.8),
 *     - never carries the rating distribution, per-group breakdown maps, or the
 *       highest/lowest-rated experiences (R10.5) — the curated shape exposes
 *       only `overallPercent`, optional `topFacet`, and `percentileRank`.
 *
 * These tests exercise the pure `buildCuratedProgressStats` (over a generated
 * `StatsSnapshot`) and the pure `selectTopFacet` (over generated facet lists)
 * directly, with no I/O or mocks. Each `fc.assert` runs `{ numRuns: 100 }` per
 * the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { toCompletionCell, type CompletionCell } from '../coverage.js';
import type { FacetCoverage, RawFacetExperienceRow } from '../facets.js';
import { rollUpFacets } from '../facets.js';
import type { RawCoverageCell } from '../coverage.js';
import type { PercentileInput, StatsSnapshot } from '../repo.js';
import {
  buildCuratedProgressStats,
  selectTopFacet,
  type CuratedProgressStats,
} from '../curatedShare.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Reference top-facet ordering (mirrors design R10.4)
// ---------------------------------------------------------------------------

/**
 * Compare two labels case-insensitively, falling back to exact comparison so
 * the ordering is total (matches the module's own tie-break).
 */
function compareCaseInsensitive(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Reference "top" ordering: a facet sorts BEFORE another (negative) when it is
 * the better top candidate — higher `completed`, then higher `percent`, then
 * the case-insensitively-first label (R10.4).
 */
function topCompare(a: FacetCoverage, b: FacetCoverage): number {
  if (a.cell.completed !== b.cell.completed) {
    return b.cell.completed - a.cell.completed;
  }
  if (a.cell.percent !== b.cell.percent) {
    return b.cell.percent - a.cell.percent;
  }
  return compareCaseInsensitive(a.label, b.label);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** A raw coverage cell over active experiences with `0 <= completed <= total`. */
function rawCoverageCellArb(): fc.Arbitrary<RawCoverageCell> {
  return fc.nat({ max: 50 }).chain((total) =>
    fc
      .record({
        park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
        category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
        areaType: fc.constantFrom(...AREA_TYPES),
        land: fc.option(fc.string(), { nil: null }),
        resortArea: fc.option(fc.string(), { nil: null }),
        isResortRepresentation: fc.boolean(),
        completed: fc.nat({ max: total }),
      })
      .map(
        (r): RawCoverageCell => ({
          park: r.park,
          category: r.category,
          areaType: r.areaType,
          land: r.land,
          resortArea: r.resortArea,
          isResortRepresentation: r.isResortRepresentation,
          completed: r.completed,
          total,
        }),
      ),
  );
}

/** A single Facet_Value `{ id, name }` pair. */
const facetValueArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  name: fc.string({ minLength: 1, maxLength: 6 }),
});

/** A `grouped_facets` JSONB map: group name -> facet values. */
const groupedFacetsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 5 }),
  fc.array(facetValueArb, { maxLength: 4 }),
  { maxKeys: 4 },
);

/** One active experience's facet material. */
const rawFacetRowArb: fc.Arbitrary<RawFacetExperienceRow> = fc.record({
  experienceId: fc.string({ minLength: 1, maxLength: 8 }),
  completedByUser: fc.boolean(),
  groupedFacets: groupedFacetsArb,
});

/** Percentile material: the target's total plus every other tracker's (>= 1). */
const percentileArb: fc.Arbitrary<PercentileInput> = fc.record({
  targetTotal: fc.nat({ max: 100 }),
  otherTotals: fc.array(fc.integer({ min: 1, max: 100 }), { maxLength: 25 }),
});

/** A full stats snapshot. `userRatings` is irrelevant to the curated fold. */
const snapshotArb: fc.Arbitrary<StatsSnapshot> = fc.record({
  coverage: fc.array(rawCoverageCellArb(), { maxLength: 25 }),
  facetExperiences: fc.array(rawFacetRowArb, { maxLength: 15 }),
  userRatings: fc.constant([]),
  resortCoverage: fc.constant([]),
  percentile: fc.option(percentileArb, { nil: null }),
});

/** A `FacetCoverage` whose cell is a well-formed `CompletionCell`. */
const facetCoverageArb: fc.Arbitrary<FacetCoverage> = fc
  .nat({ max: 50 })
  .chain((total) =>
    fc
      .record({
        key: fc.string({ minLength: 1, maxLength: 6 }),
        label: fc.string({ minLength: 0, maxLength: 6 }),
        completed: fc.nat({ max: total }),
      })
      .map(
        (r): FacetCoverage => ({
          key: r.key,
          label: r.label,
          cell: toCompletionCell(r.completed, total),
        }),
      ),
  );

// ---------------------------------------------------------------------------
// selectTopFacet (R10.2, R10.4, R10.7, R10.8)
// ---------------------------------------------------------------------------

describe('selectTopFacet — Property 12: top facet selection is optimal under the ordering', () => {
  it('returns a member of the list that is no worse than every other facet (R10.4)', () => {
    fc.assert(
      fc.property(
        fc.array(facetCoverageArb, { minLength: 1, maxLength: 20 }),
        (facets) => {
          const top = selectTopFacet(facets);
          expect(top).toBeDefined();
          // The chosen facet must be one of the inputs (by label + cell).
          const isMember = facets.some(
            (f) =>
              f.label === top!.label &&
              f.cell.completed === top!.cell.completed &&
              f.cell.total === top!.cell.total &&
              f.cell.percent === top!.cell.percent,
          );
          expect(isMember).toBe(true);

          // No other facet is strictly better under the top ordering.
          const chosen: FacetCoverage = {
            key: '',
            label: top!.label,
            cell: top!.cell,
          };
          for (const other of facets) {
            expect(topCompare(chosen, other)).toBeLessThanOrEqual(0);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('omits the top facet exactly when the list is empty (R10.8)', () => {
    expect(selectTopFacet([])).toBeUndefined();
    fc.assert(
      fc.property(
        fc.array(facetCoverageArb, { minLength: 1, maxLength: 20 }),
        (facets) => {
          // Non-empty ⇒ always present, even when every completed is 0 (R10.7).
          expect(selectTopFacet(facets)).toBeDefined();
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('selects a facet even when every completed count is 0 (R10.7)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            key: fc.string({ minLength: 1, maxLength: 6 }),
            label: fc.string({ maxLength: 6 }),
            total: fc.integer({ min: 1, max: 30 }),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        (rows) => {
          const facets: FacetCoverage[] = rows.map((r) => ({
            key: r.key,
            label: r.label,
            cell: toCompletionCell(0, r.total),
          }));
          const top = selectTopFacet(facets);
          expect(top).toBeDefined();
          expect(top!.cell.completed).toBe(0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// buildCuratedProgressStats (R10.1, R10.2, R10.3, R10.5, R10.7, R10.8)
// ---------------------------------------------------------------------------

/** The exact, complete set of keys the curated shape is allowed to carry. */
const ALLOWED_CURATED_KEYS = new Set(['overallPercent', 'topFacet', 'percentileRank']);

describe('buildCuratedProgressStats — Property 12: curated snapshot is well-formed and minimal', () => {
  it('overallPercent and percentileRank are always in [0.0, 100.0] (R10.1, R10.3)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const curated = buildCuratedProgressStats(snapshot);
        expect(curated.overallPercent).toBeGreaterThanOrEqual(0.0);
        expect(curated.overallPercent).toBeLessThanOrEqual(100.0);
        expect(curated.percentileRank).toBeGreaterThanOrEqual(0.0);
        expect(curated.percentileRank).toBeLessThanOrEqual(100.0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('percentileRank is 0.0 when the sender has zero completions (R10.3)', () => {
    fc.assert(
      fc.property(
        fc.array(rawCoverageCellArb(), { maxLength: 25 }),
        fc.array(rawFacetRowArb, { maxLength: 15 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { maxLength: 25 }),
        (coverage, facetExperiences, otherTotals) => {
          const snapshot: StatsSnapshot = {
            coverage,
            facetExperiences,
            userRatings: [],
            resortCoverage: [],
            // Zero completions for the sender: targetTotal === 0.
            percentile: { targetTotal: 0, otherTotals },
          };
          expect(buildCuratedProgressStats(snapshot).percentileRank).toBe(0.0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('percentileRank falls back to 0.0 when percentile material is absent (R10.3)', () => {
    fc.assert(
      fc.property(
        fc.array(rawCoverageCellArb(), { maxLength: 25 }),
        fc.array(rawFacetRowArb, { maxLength: 15 }),
        (coverage, facetExperiences) => {
          const snapshot: StatsSnapshot = {
            coverage,
            facetExperiences,
            userRatings: [],
            resortCoverage: [],
            percentile: null,
          };
          expect(buildCuratedProgressStats(snapshot).percentileRank).toBe(0.0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('topFacet is present iff the sender has >= 1 facet statistic, and matches the selected top (R10.2, R10.7, R10.8)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const curated = buildCuratedProgressStats(snapshot);
        const facets = rollUpFacets(snapshot.facetExperiences);
        const expectedTop = selectTopFacet(facets);

        if (facets.length === 0) {
          // R10.8: no facet statistic at all ⇒ topFacet omitted entirely.
          expect(curated.topFacet).toBeUndefined();
          expect('topFacet' in curated).toBe(false);
        } else {
          // R10.7: >= 1 facet statistic ⇒ topFacet present (even if completed 0).
          expect(curated.topFacet).toBeDefined();
          expect(curated.topFacet).toEqual(expectedTop);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries only overallPercent, optional topFacet, and percentileRank — nothing verbose (R10.5)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const curated: CuratedProgressStats = buildCuratedProgressStats(snapshot);
        const keys = Object.keys(curated);

        // Every present key is one of the three allowed curated fields; the
        // rating distribution, per-group breakdown maps (byPark/byCategory/
        // byLand/byResortArea/byFacetValue), and highest/lowest experiences
        // can never appear.
        for (const key of keys) {
          expect(ALLOWED_CURATED_KEYS.has(key)).toBe(true);
        }
        // The two always-present scalars are there.
        expect(keys).toContain('overallPercent');
        expect(keys).toContain('percentileRank');

        // Explicitly assert none of the verbose fields leaked in.
        for (const forbidden of [
          'distribution',
          'ratings',
          'byPark',
          'byCategory',
          'byLand',
          'byResortArea',
          'byFacetValue',
          'byAreaType',
          'highest',
          'lowest',
          'coverage',
        ]) {
          expect(forbidden in curated).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('topFacet, when present, is a well-formed CompletionCell with a label (R10.2)', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const curated = buildCuratedProgressStats(snapshot);
        if (curated.topFacet !== undefined) {
          const cell: CompletionCell = curated.topFacet.cell;
          expect(typeof curated.topFacet.label).toBe('string');
          expect(cell.completed).toBeGreaterThanOrEqual(0);
          expect(cell.completed).toBeLessThanOrEqual(cell.total);
          expect(cell.percent).toBeGreaterThanOrEqual(0.0);
          expect(cell.percent).toBeLessThanOrEqual(100.0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
