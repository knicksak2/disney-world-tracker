// Feature: social-sharing-loop, Property 2: Entry point projects content faithfully into composer params
//
// Validates: Requirements 1.3, 1.4, 1.5, 1.8
//
// Property 2 (from design.md → Correctness Properties):
//   For any Experience detail with any viewer Rating (integer 1–10) and any
//   viewer Note (≤2000 chars), activating the Experience_Detail_View entry
//   point produces `experience` composer params carrying that same
//   experienceId, name, Park, Experience_Category, the same integer Rating,
//   and the same Note text (R1.3, R1.4, R1.5); and for any completion data,
//   activating the Progress_Screen entry point produces `progress` params
//   whose overall, per-Park, and per-Experience_Category percentages equal the
//   displayed one-decimal values (R1.8).
//
// Test strategy:
//   - Experience projection: generate a ShareableExperienceDetail plus a
//     viewer Rating that is either absent (null) or a whole number in [1, 10]
//     (the RatingDTO invariant), and a viewer Note that is either absent or a
//     trimmed, non-empty body ≤2000 code points (the NoteDTO invariant). Assert
//     `buildExperienceShareParams` reproduces id/name/Park/Category verbatim,
//     carries the exact integer Rating only when present, and carries the exact
//     Note text only when present — compared against an independent oracle built
//     straight from the requirement text.
//   - Progress projection: generate a full `GET /me/stats` response whose
//     per-breakdown `percent` values carry many decimals (so the one-decimal
//     snap is exercised) and whose `total` may be zero (the display-as-0.0
//     branch). Assert `buildProgressShareParams` yields overall/per-Park/
//     per-Category percentages equal to the displayed one-decimal value, where
//     the displayed value is `Number(percent.toFixed(1))` for a non-zero,
//     finite breakdown and `0` for a zero-total or non-finite one.

import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type NoteDTO,
  type Park,
  type RatingDTO,
} from '@dwt/shared';

import {
  buildExperienceShareParams,
  type ShareableExperienceDetail,
} from '../shareEntryPoint';
import { buildProgressShareParams } from '../../stats/statsView';
import type { CompletionCell, StatsResponse } from '../../../api/statsTypes';
import { makeStatsResponse } from '../../stats/__testSupport__/statsFixture';

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

// ---------------------------------------------------------------------------
// Experience-projection generators (R1.3, R1.4, R1.5)
// ---------------------------------------------------------------------------

const detailArb: fc.Arbitrary<ShareableExperienceDetail> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.length > 0),
  park: parkArb,
  category: categoryArb,
});

// The RatingDTO invariant: an integer in [1, 10] (R1.4). Absent when the viewer
// has recorded no Rating.
const ratingArb: fc.Arbitrary<RatingDTO | null> = fc.oneof(
  fc.constant<RatingDTO | null>(null),
  fc.record({
    userId: fc.uuid(),
    experienceId: fc.uuid(),
    value: fc.integer({ min: 1, max: 10 }),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  }),
);

// The NoteDTO invariant: a trimmed, non-empty body of 1–2000 code points
// (R1.5). Absent when the viewer has recorded no Note. Bodies are generated
// already trimmed so the projection reproduces them verbatim.
const noteBodyArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 2000 })
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const noteArb: fc.Arbitrary<NoteDTO | null> = fc.oneof(
  fc.constant<NoteDTO | null>(null),
  fc.record({
    userId: fc.uuid(),
    experienceId: fc.uuid(),
    body: noteBodyArb,
    shareable: fc.boolean(),
    updatedAt: fc.constant('2024-01-01T00:00:00.000Z'),
  }),
);

// ---------------------------------------------------------------------------
// Progress-projection generators (R1.8)
// ---------------------------------------------------------------------------

interface StatsBreakdownLike {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

// A breakdown whose `percent` carries several decimals (so snapping to one
// decimal is meaningful) and whose `total` may be zero (the display-as-0.0
// branch). `completed` is unused by the projection but kept structurally valid.
const breakdownArb: fc.Arbitrary<StatsBreakdownLike> = fc.record({
  completed: fc.nat({ max: 500 }),
  total: fc.nat({ max: 500 }),
  percent: fc.double({ min: 0, max: 100, noNaN: true }),
});

function mapArb<K extends string>(
  keys: readonly K[],
): fc.Arbitrary<Record<K, StatsBreakdownLike>> {
  const shape: Record<string, fc.Arbitrary<StatsBreakdownLike>> = {};
  for (const key of keys) shape[key] = breakdownArb;
  return fc.record(shape) as fc.Arbitrary<Record<K, StatsBreakdownLike>>;
}

/**
 * Lift a generated breakdown into a nested `CompletionCell`, preserving the
 * generated `percent`/`total` verbatim (so the one-decimal snap and the
 * zero-total display branch stay exercised). Only `total`/`percent` feed
 * `buildProgressShareParams`; `remaining`/`completeBadge` are derived to keep
 * the cell structurally valid.
 */
const toCell = (b: StatsBreakdownLike): CompletionCell => ({
  completed: b.completed,
  total: b.total,
  percent: b.percent,
  remaining: Math.max(b.total - b.completed, 0),
  completeBadge: b.total > 0 && b.completed >= b.total,
});

// A full nested `StatsResponse` whose `coverage.overall` / `coverage.byPark` /
// `coverage.byCategory` carry the generated breakdowns (task 11.1). The share
// projection reads only these three dimensions; the shared fixture builder
// fills every other field with a valid default.
const statsResponseArb: fc.Arbitrary<StatsResponse> = fc
  .record({
    overall: breakdownArb,
    byPark: mapArb<Park>(PARKS),
    byCategory: mapArb<ExperienceCategory>(EXPERIENCE_CATEGORIES),
  })
  .map((spec) =>
    makeStatsResponse({
      coverage: {
        overall: toCell(spec.overall),
        byPark: Object.fromEntries(
          PARKS.map((park) => [park, toCell(spec.byPark[park])]),
        ) as Record<Park, CompletionCell>,
        byCategory: Object.fromEntries(
          EXPERIENCE_CATEGORIES.map((category) => [
            category,
            toCell(spec.byCategory[category]),
          ]),
        ) as Record<ExperienceCategory, CompletionCell>,
      },
    }),
  );

// ---------------------------------------------------------------------------
// Independent oracle (encodes the requirement text directly)
// ---------------------------------------------------------------------------

// Displayed one-decimal completion percentage, mirroring the Progress_Screen
// rule (R1.8): a zero total or non-finite percent displays as 0.0; every other
// value is the server percentage snapped to one decimal with `toFixed(1)`.
function displayedPercent(breakdown: StatsBreakdownLike): number {
  if (breakdown.total === 0 || !Number.isFinite(breakdown.percent)) {
    return 0;
  }
  return Number(breakdown.percent.toFixed(1));
}

// ---------------------------------------------------------------------------
// Property 2a — Experience entry point projection (R1.3, R1.4, R1.5)
// ---------------------------------------------------------------------------

describe('Property 2: Entry point projects content faithfully into composer params (R1.3, R1.4, R1.5, R1.8)', () => {
  test('experience entry point carries id/name/Park/Category, the exact Rating, and the exact Note (R1.3, R1.4, R1.5)', () => {
    fc.assert(
      fc.property(detailArb, ratingArb, noteArb, (detail, rating, note) => {
        const params = buildExperienceShareParams(detail, rating, note);

        // R1.3: a discriminated `experience` payload referencing the displayed
        // Experience, projected verbatim.
        expect(params.kind).toBe('experience');
        expect(params.experienceId).toBe(detail.id);
        expect(params.experienceName).toBe(detail.name);
        expect(params.park).toBe(detail.park);
        expect(params.category).toBe(detail.category);

        // R1.4: the viewer's Rating is included as a whole number 1–10 exactly
        // when present, and absent otherwise.
        if (rating === null) {
          expect(params.rating).toBeUndefined();
        } else {
          expect(params.rating).toBe(rating.value);
          expect(Number.isInteger(params.rating)).toBe(true);
          expect(params.rating as number).toBeGreaterThanOrEqual(1);
          expect(params.rating as number).toBeLessThanOrEqual(10);
        }

        // R1.5: the viewer's Note text is included verbatim (≤2000 chars) when
        // present, and absent otherwise.
        if (note === null) {
          expect(params.note).toBeUndefined();
        } else {
          expect(params.note).toBe(note.body);
          expect((params.note as string).length).toBeLessThanOrEqual(2000);
        }

        // The projection introduces no fields beyond the discriminated shape.
        const keys = Object.keys(params).sort();
        const expectedKeys = ['category', 'experienceId', 'experienceName', 'kind', 'park'];
        if (rating !== null) expectedKeys.push('rating');
        if (note !== null) expectedKeys.push('note');
        expect(keys).toEqual(expectedKeys.sort());
      }),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 2b — Progress entry point projection (R1.8)
  // -------------------------------------------------------------------------

  test('progress entry point carries overall/per-Park/per-Category percentages equal to the displayed one-decimal values (R1.8)', () => {
    fc.assert(
      fc.property(statsResponseArb, (stats) => {
        const params = buildProgressShareParams(stats);

        expect(params.kind).toBe('progress');
        if (params.kind !== 'progress') return; // narrow for TypeScript

        // Overall percentage equals the displayed one-decimal value.
        expect(params.overallPercent).toBe(
          displayedPercent(stats.coverage.overall),
        );

        // One entry per catalog Park, each equal to its displayed one-decimal
        // value.
        for (const park of PARKS) {
          expect(params.perParkPercent[park]).toBe(
            displayedPercent(stats.coverage.byPark[park]),
          );
        }
        expect(Object.keys(params.perParkPercent).sort()).toEqual(
          [...PARKS].sort(),
        );

        // One entry per Experience_Category, each equal to its displayed
        // one-decimal value.
        for (const category of EXPERIENCE_CATEGORIES) {
          expect(params.perCategoryPercent[category]).toBe(
            displayedPercent(stats.coverage.byCategory[category]),
          );
        }
        expect(Object.keys(params.perCategoryPercent).sort()).toEqual(
          [...EXPERIENCE_CATEGORIES].sort(),
        );

        // Every projected percentage is a one-decimal value in [0.0, 100.0].
        const allPercents = [
          params.overallPercent,
          ...Object.values(params.perParkPercent),
          ...Object.values(params.perCategoryPercent),
        ];
        for (const p of allPercents) {
          const value = p as number;
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
          // Snapped to one decimal: re-snapping is a fixed point.
          expect(Number(value.toFixed(1))).toBe(value);
        }
      }),
      { numRuns: 100 },
    );
  });
});
