// Feature: expanded-stats, Property 4: Land and Resort_Area grouping normalizes by trim + case-insensitive
/**
 * Property-based tests for the Stats_Service Coverage_Statistic roll-up
 * (`services/stats/coverage.ts`), Property 4.
 *
 * Validates: Requirements 1.6, 1.7, 1.8, 1.9
 *
 * Property 4 (design):
 *   For any set of active experiences, two experiences fall in the same
 *   per-Land (resp. per-Resort_Area) group if and only if their Land (resp.
 *   Resort_Area) values are equal after trimming leading/trailing whitespace
 *   and comparing case-insensitively; and experiences whose value is null,
 *   empty, or whitespace-only are excluded from every per-Land (resp.
 *   per-Resort_Area) statistic.
 *
 * `rollUpCoverage` consumes pre-aggregated `RawCoverageCell`s. Each generated
 * cell here models a single active experience (an atomic `(completed, total)`
 * contribution) carrying a raw Land / Resort_Area value, so the cell-level
 * grouping is exactly the experience-level grouping the property describes.
 *
 * The oracle groups the same cells by the normalization rule directly
 * (`trim().toLowerCase()`), excluding null/empty/whitespace-only values, and
 * asserts the roll-up's `byLand` / `byResortArea` output matches it group for
 * group: one row per distinct normalized key, and each row's summed
 * `completed`/`total` equal the oracle's.
 *
 * Each `fc.assert` runs with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';
import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { rollUpCoverage, type RawCoverageCell } from '../coverage.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park | null> = fc.oneof(
  fc.constant(null),
  fc.constantFrom(...PARKS),
);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);
const areaTypeArb: fc.Arbitrary<AreaType> = fc.constantFrom(...AREA_TYPES);

/**
 * A small pool of "base" names drawn from without whitespace/case decoration.
 * Keeping the pool small guarantees collisions across case/whitespace variants
 * so the "same group iff normalized-equal" direction is actually exercised.
 */
const baseNameArb = fc.constantFrom(
  'Fantasyland',
  'Tomorrowland',
  'World Showcase',
  'a',
  'ABC',
  'café',
);

/** Wrap a base name in random leading/trailing whitespace and case variants. */
const decoratedNameArb: fc.Arbitrary<string> = baseNameArb.chain((base) =>
  fc
    .record({
      lead: fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 }),
      trail: fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { maxLength: 3 }),
      casing: fc.constantFrom('lower', 'upper', 'as-is'),
    })
    .map(({ lead, trail, casing }) => {
      const cased =
        casing === 'lower'
          ? base.toLowerCase()
          : casing === 'upper'
            ? base.toUpperCase()
            : base;
      return `${lead}${cased}${trail}`;
    }),
);

/**
 * A value that MUST be excluded from grouping: `null`, empty string, or a
 * whitespace-only string.
 */
const excludedValueArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(''),
  fc.stringOf(fc.constantFrom(' ', '\t', '\n'), { minLength: 1, maxLength: 4 }),
);

/** A Land / Resort_Area raw value: either a groupable decorated name or an excluded value. */
const rawValueArb: fc.Arbitrary<string | null> = fc.oneof(
  { weight: 3, arbitrary: decoratedNameArb },
  { weight: 1, arbitrary: excludedValueArb },
);

/** Non-negative `(completed, total)` counts with `completed <= total`. */
const countsArb = fc
  .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }))
  .map(([a, b]) => ({ completed: Math.min(a, b), total: Math.max(a, b) }));

const cellArb: fc.Arbitrary<RawCoverageCell> = fc
  .record({
    park: parkArb,
    category: categoryArb,
    areaType: areaTypeArb,
    land: rawValueArb,
    resortArea: rawValueArb,
    isResortRepresentation: fc.boolean(),
    counts: countsArb,
  })
  .map(
    ({ park, category, areaType, land, resortArea, isResortRepresentation, counts }) => ({
      park,
      category,
      areaType,
      land,
      resortArea,
      isResortRepresentation,
      completed: counts.completed,
      total: counts.total,
    }),
  );

const cellsArb = fc.array(cellArb, { maxLength: 40 });

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

/** `true` when a raw value is null, empty, or whitespace-only (excluded). */
function isExcluded(raw: string | null): boolean {
  return raw === null || raw.trim() === '';
}

/**
 * Independent reference roll-up of the named dimension: group included cells by
 * `trim().toLowerCase()`, summing `(completed, total)` per normalized key.
 * Returns a map of normalized key -> summed counts.
 */
function oracleGroups(
  cells: readonly RawCoverageCell[],
  valueOf: (c: RawCoverageCell) => string | null,
): Map<string, { completed: number; total: number }> {
  const groups = new Map<string, { completed: number; total: number }>();
  for (const cell of cells) {
    const raw = valueOf(cell);
    if (isExcluded(raw)) continue;
    const key = (raw as string).trim().toLowerCase();
    const existing = groups.get(key) ?? { completed: 0, total: 0 };
    existing.completed += cell.completed;
    existing.total += cell.total;
    groups.set(key, existing);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Stats_Service coverage — Property 4: Land/Resort_Area normalization', () => {
  it('byLand groups by trim + case-insensitive and excludes null/empty/whitespace (R1.6, R1.8)', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const oracle = oracleGroups(cells, (c) => c.land);
        const { byLand } = rollUpCoverage(cells);

        // Exactly one output row per distinct normalized key (same group iff
        // normalized-equal; excluded values contribute no group).
        expect(byLand.length).toBe(oracle.size);

        for (const labeled of byLand) {
          const key = labeled.label.trim().toLowerCase();
          const expected = oracle.get(key);
          // Every reported group corresponds to a normalized oracle key.
          expect(expected).toBeDefined();
          // Summed counts match the oracle's for that group.
          expect(labeled.cell.completed).toBe(expected!.completed);
          expect(labeled.cell.total).toBe(expected!.total);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('byResortArea groups by trim + case-insensitive and excludes null/empty/whitespace (R1.7, R1.9)', () => {
    fc.assert(
      fc.property(cellsArb, (cells) => {
        const oracle = oracleGroups(cells, (c) => c.resortArea);
        const { byResortArea } = rollUpCoverage(cells);

        expect(byResortArea.length).toBe(oracle.size);

        for (const labeled of byResortArea) {
          const key = labeled.label.trim().toLowerCase();
          const expected = oracle.get(key);
          expect(expected).toBeDefined();
          expect(labeled.cell.completed).toBe(expected!.completed);
          expect(labeled.cell.total).toBe(expected!.total);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('two cells share a group iff their values normalize equally (R1.6, R1.7)', () => {
    // Directly probe the iff over three decorated variants: cells whose values
    // normalize to the same key must collapse into one summed row, while cells
    // with distinct keys stay separate.
    fc.assert(
      fc.property(
        decoratedNameArb,
        decoratedNameArb,
        decoratedNameArb,
        (variantA, variantB, variantC) => {
          const cells: RawCoverageCell[] = [
            makeLandCell(variantA, 1, 2),
            makeLandCell(variantB, 1, 3),
            makeLandCell(variantC, 0, 4),
          ];
          const { byLand } = rollUpCoverage(cells);
          const oracle = oracleGroups(cells, (c) => c.land);

          // One output row per distinct normalized key.
          expect(byLand.length).toBe(oracle.size);

          // Every row's summed counts match the oracle (so normalize-equal cells
          // are merged and their counts added).
          for (const labeled of byLand) {
            const key = labeled.label.trim().toLowerCase();
            const expected = oracle.get(key);
            expect(expected).toBeDefined();
            expect(labeled.cell.completed).toBe(expected!.completed);
            expect(labeled.cell.total).toBe(expected!.total);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

/** Build a minimal cell carrying a Land value and given counts. */
function makeLandCell(land: string, completed: number, total: number): RawCoverageCell {
  return {
    park: null,
    category: 'Ride',
    areaType: 'ThemePark',
    land,
    resortArea: null,
    isResortRepresentation: false,
    completed,
    total,
  };
}
