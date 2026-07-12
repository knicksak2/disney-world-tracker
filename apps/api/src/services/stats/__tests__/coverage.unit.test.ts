/**
 * Example-based unit tests for the Stats_Service Coverage_Statistic roll-up
 * (`services/stats/coverage.ts`), task 2.7 of the Expanded Stats plan.
 *
 * These cover the coverage edge cases the property tests are not aimed at:
 *   - Empty catalog (no cells at all).
 *   - Single-group catalog (one cell contributing to one Park/Category/etc.).
 *   - Whitespace-only / trimmed Land label selection (label chosen among the
 *     trimmed forms, first under ascending case-insensitive comparison), plus
 *     exclusion of null/empty/whitespace-only Land values.
 *   - All-inactive input, which upstream (the repository SQL) reduces to an
 *     empty cell list because inactive experiences are filtered from both the
 *     numerator and denominator (R1.10).
 *
 * The roll-up under test is the pure `rollUpCoverage(cells)` and the
 * `toCompletionCell(completed, total)` constructor. Both are pure over their
 * inputs — no I/O, no clock, no DB — so these are plain example assertions.
 *
 * Validates: Requirements 1.8, 1.9, 1.10, 1.12.
 */

import { describe, expect, it } from 'vitest';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import {
  rollUpCoverage,
  toCompletionCell,
  type CompletionCell,
  type RawCoverageCell,
} from '../coverage.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The empty-group Coverage_Statistic every dimension reports for total 0 (R1.12). */
const EMPTY_CELL: CompletionCell = {
  completed: 0,
  total: 0,
  percent: 0.0,
  remaining: 0,
  completeBadge: false,
};

/** Build a `RawCoverageCell`, defaulting the fields a given test does not exercise. */
function makeCell(overrides: Partial<RawCoverageCell> = {}): RawCoverageCell {
  return {
    park: null,
    category: 'Ride',
    areaType: 'ThemePark',
    land: null,
    resortArea: null,
    worldShowcaseCountry: null,
    isResortRepresentation: false,
    completed: 0,
    total: 0,
    ...overrides,
  };
}

/** Assert a cell equals the canonical empty-group cell (R1.12). */
function expectEmptyCell(cell: CompletionCell): void {
  expect(cell).toEqual(EMPTY_CELL);
}

// ---------------------------------------------------------------------------
// Empty catalog
// ---------------------------------------------------------------------------

describe('rollUpCoverage — empty catalog (no cells)', () => {
  const coverage = rollUpCoverage([]);

  it('reports the empty-group cell for overall and the Resort_Statistic (R1.12)', () => {
    expectEmptyCell(coverage.overall);
    expectEmptyCell(coverage.resort);
  });

  it('reports the empty-group cell for every fixed-enum group (R1.12)', () => {
    for (const park of PARKS) {
      expectEmptyCell(coverage.byPark[park]);
    }
    for (const category of EXPERIENCE_CATEGORIES) {
      expectEmptyCell(coverage.byCategory[category]);
    }
    for (const areaType of AREA_TYPES) {
      expectEmptyCell(coverage.byAreaType[areaType]);
    }
  });

  it('reports no open-ended per-Land or per-Resort_Area rows', () => {
    expect(coverage.byLand).toEqual([]);
    expect(coverage.byResortArea).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Single-group catalog
// ---------------------------------------------------------------------------

describe('rollUpCoverage — single-group catalog', () => {
  it('rolls one cell into exactly its Park/Category/Area_Type and leaves all other groups empty', () => {
    const cell = makeCell({
      park: 'EPCOT',
      category: 'Ride',
      areaType: 'ThemePark',
      land: 'World Showcase',
      completed: 3,
      total: 4,
    });

    const coverage = rollUpCoverage([cell]);

    const filled: CompletionCell = {
      completed: 3,
      total: 4,
      percent: 75.0,
      remaining: 1,
      completeBadge: false,
    };

    // overall equals the single contributing cell.
    expect(coverage.overall).toEqual(filled);

    // The one populated Park is EPCOT; every other Park is empty.
    expect(coverage.byPark.EPCOT).toEqual(filled);
    for (const park of PARKS) {
      if (park !== 'EPCOT') {
        expectEmptyCell(coverage.byPark[park]);
      }
    }

    // The one populated Category is Ride; every other Category is empty.
    expect(coverage.byCategory.Ride).toEqual(filled);
    for (const category of EXPERIENCE_CATEGORIES) {
      if (category !== 'Ride') {
        expectEmptyCell(coverage.byCategory[category]);
      }
    }

    // The one populated Area_Type is ThemePark; every other Area_Type is empty.
    expect(coverage.byAreaType.ThemePark).toEqual(filled);
    for (const areaType of AREA_TYPES) {
      if (areaType !== 'ThemePark') {
        expectEmptyCell(coverage.byAreaType[areaType]);
      }
    }

    // Exactly one per-Land row; no Resort_Area row; not a resort-representing row.
    expect(coverage.byLand).toEqual([{ label: 'World Showcase', cell: filled }]);
    expect(coverage.byResortArea).toEqual([]);
    expectEmptyCell(coverage.resort);
  });

  it('reports a fully-complete single group with completeBadge true and remaining 0 (R2.4)', () => {
    const coverage = rollUpCoverage([
      makeCell({ park: 'Magic Kingdom', category: 'Show', completed: 5, total: 5 }),
    ]);

    expect(coverage.byPark['Magic Kingdom']).toEqual({
      completed: 5,
      total: 5,
      percent: 100.0,
      remaining: 0,
      completeBadge: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Whitespace-only Land: exclusion (R1.8, R1.9) and trimmed label selection
// ---------------------------------------------------------------------------

describe('rollUpCoverage — Land/Resort_Area whitespace exclusion (R1.8, R1.9)', () => {
  it('excludes null, empty, and whitespace-only Land values from every per-Land row (R1.8)', () => {
    const coverage = rollUpCoverage([
      makeCell({ land: null, completed: 1, total: 2 }),
      makeCell({ land: '', completed: 1, total: 1 }),
      makeCell({ land: '   ', completed: 0, total: 3 }),
      makeCell({ land: '\t\n', completed: 2, total: 2 }),
    ]);

    // No Land value is groupable, so byLand is empty even though the overall
    // totals still count these active experiences.
    expect(coverage.byLand).toEqual([]);
    expect(coverage.overall).toEqual({
      completed: 4,
      total: 8,
      percent: 50.0,
      remaining: 4,
      completeBadge: false,
    });
  });

  it('excludes null, empty, and whitespace-only Resort_Area values from every per-Resort_Area row (R1.9)', () => {
    const coverage = rollUpCoverage([
      makeCell({ resortArea: null, completed: 1, total: 2 }),
      makeCell({ resortArea: '  ', completed: 1, total: 4 }),
    ]);

    expect(coverage.byResortArea).toEqual([]);
  });

  it('keeps a group whose only surrounding whitespace is trimmed away and reports the trimmed label', () => {
    const coverage = rollUpCoverage([
      makeCell({ land: '  Fantasyland  ', completed: 1, total: 2 }),
    ]);

    expect(coverage.byLand).toEqual([
      {
        label: 'Fantasyland',
        cell: { completed: 1, total: 2, percent: 50.0, remaining: 1, completeBadge: false },
      },
    ]);
  });
});

describe('rollUpCoverage — Land label selection among trimmed forms', () => {
  it('collapses whitespace/case variants into one group and labels it with the trimmed form that sorts first case-insensitively', () => {
    // All three variants normalize to the same key ("fantasyland"); their
    // trimmed forms are 'Fantasyland', 'fantasyland', and 'FANTASYLAND'.
    // Case-insensitive comparison ties, so the raw fallback picks the form with
    // the smallest code points: 'FANTASYLAND' (all uppercase) sorts first.
    const coverage = rollUpCoverage([
      makeCell({ land: '  Fantasyland ', completed: 1, total: 2 }),
      makeCell({ land: 'fantasyland', completed: 2, total: 3 }),
      makeCell({ land: '\tFANTASYLAND\n', completed: 0, total: 4 }),
    ]);

    // One merged group summing all three contributions.
    expect(coverage.byLand).toHaveLength(1);
    const row = coverage.byLand[0]!;
    expect(row.label).toBe('FANTASYLAND');
    expect(row.cell.completed).toBe(3);
    expect(row.cell.total).toBe(9);
  });

  it('orders distinct Land groups by ascending case-insensitive label', () => {
    const coverage = rollUpCoverage([
      makeCell({ land: 'Tomorrowland', completed: 1, total: 1 }),
      makeCell({ land: 'adventureland', completed: 0, total: 2 }),
      makeCell({ land: 'Fantasyland', completed: 1, total: 3 }),
    ]);

    expect(coverage.byLand.map((r) => r.label)).toEqual([
      'adventureland',
      'Fantasyland',
      'Tomorrowland',
    ]);
  });
});

// ---------------------------------------------------------------------------
// All-inactive input
// ---------------------------------------------------------------------------

describe('rollUpCoverage — all-inactive input (R1.10)', () => {
  it('produces the same all-empty roll-up as an empty catalog, since inactive experiences are filtered upstream', () => {
    // The repository SQL excludes inactive experiences from both numerator and
    // denominator, so a catalog with only inactive experiences reaches the pure
    // roll-up as an empty cell list.
    const coverage = rollUpCoverage([]);

    expectEmptyCell(coverage.overall);
    expectEmptyCell(coverage.resort);
    expect(coverage.byLand).toEqual([]);
    expect(coverage.byResortArea).toEqual([]);
    for (const park of PARKS) {
      expectEmptyCell(coverage.byPark[park]);
    }
    for (const category of EXPERIENCE_CATEGORIES) {
      expectEmptyCell(coverage.byCategory[category]);
    }
    for (const areaType of AREA_TYPES) {
      expectEmptyCell(coverage.byAreaType[areaType]);
    }
  });
});

// ---------------------------------------------------------------------------
// toCompletionCell empty-group short-circuit (R1.12)
// ---------------------------------------------------------------------------

describe('toCompletionCell — empty-group short-circuit (R1.12)', () => {
  it('returns the canonical empty cell when total is 0, ignoring the completed argument', () => {
    expectEmptyCell(toCompletionCell(0, 0));
    // Defensive: even a nonsensical completed count on an empty group collapses.
    expectEmptyCell(toCompletionCell(5, 0));
  });
});
