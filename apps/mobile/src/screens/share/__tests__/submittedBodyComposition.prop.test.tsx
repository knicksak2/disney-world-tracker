// Feature: social-sharing-loop, Property 4: Composer submits derived content with only marked values
//
// Validates: Requirements 2.8, 2.14
//
// Property 4 (from design.md → Correctness Properties):
//   For any pre-populated composer params and any states of the Rating/Note
//   include toggles (each defaulting to included when the value is present),
//   the submitted `POST /me/shares` body carries the kind and content derived
//   from the entry point and includes the sender's Rating and Note if and only
//   if their toggles are marked included (R2.8, R2.14).
//
// Test strategy:
//   - `buildShareCreateBody` is the framework-free body-composition core the
//     Share_Composer's `handleSend` now delegates to, so the property runs
//     without rendering — no React, react-navigation, or expo mocks needed.
//   - Experience side: generate an `experience` `ShareComposerParams` whose
//     Rating is either absent or a whole 1–10 (the entry-point invariant) and
//     whose Note is either absent or a non-empty string ≤2000 chars, crossed
//     with all four include-toggle combinations and any recipient-id list.
//     Assert against an independent oracle built straight from the requirement
//     text: the body reproduces kind + experienceId + recipientIds, and carries
//     `rating`/`includeRating` (resp. `note`) if and only if the value is
//     present AND its toggle is on. Also assert the negative direction: a value
//     absent from params, or present-but-toggled-off, never appears in the body.
//   - Progress side: generate a `progress` `ShareComposerParams` and assert the
//     body carries the overall/per-Park/per-Category snapshot verbatim and
//     never a Rating or Note, regardless of the toggle states.

import fc from 'fast-check';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type Park,
} from '@dwt/shared';

import type { ShareComposerParams } from '../../../navigation/RootNavigator';
import { buildShareCreateBody, type IncludeToggles } from '../shareBody';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

// A Rating that is either absent (viewer recorded none) or a whole number in
// [1, 10] — the value the entry point projects into params (R1.4).
const ratingArb: fc.Arbitrary<number | undefined> = fc.oneof(
  fc.constant<number | undefined>(undefined),
  fc.integer({ min: 1, max: 10 }),
);

// A Note that is either absent or a non-empty body of ≤2000 chars (R1.5). The
// empty string is excluded because an empty Note is treated as absent by the
// composer's presence rule.
const noteArb: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constant<string | undefined>(undefined),
  fc.string({ minLength: 1, maxLength: 2000 }).filter((s) => s.length > 0),
);

const experienceParamsArb: fc.Arbitrary<
  Extract<ShareComposerParams, { kind: 'experience' }>
> = fc
  .record({
    experienceId: fc.uuid(),
    experienceName: fc.string({ minLength: 1, maxLength: 60 }),
    park: parkArb,
    category: categoryArb,
    rating: ratingArb,
    note: noteArb,
  })
  .map(({ experienceId, experienceName, park, category, rating, note }) => ({
    kind: 'experience' as const,
    experienceId,
    experienceName,
    park,
    category,
    ...(rating !== undefined ? { rating } : {}),
    ...(note !== undefined ? { note } : {}),
  }));

// A percentage snapped to one decimal in [0.0, 100.0] as displayed (R1.8).
const percentArb: fc.Arbitrary<number> = fc
  .double({ min: 0, max: 100, noNaN: true })
  .map((n) => Number(n.toFixed(1)));

function partialPercentMapArb<K extends string>(
  keys: readonly K[],
): fc.Arbitrary<{ [key in K]?: number }> {
  const shape: Record<string, fc.Arbitrary<number | undefined>> = {};
  for (const key of keys) {
    shape[key] = fc.oneof(fc.constant<number | undefined>(undefined), percentArb);
  }
  return fc.record(shape) as fc.Arbitrary<{ [key in K]?: number }>;
}

const progressParamsArb: fc.Arbitrary<
  Extract<ShareComposerParams, { kind: 'progress' }>
> = fc.record({
  kind: fc.constant('progress' as const),
  overallPercent: percentArb,
  perParkPercent: partialPercentMapArb<Park>(PARKS),
  perCategoryPercent: partialPercentMapArb<ExperienceCategory>(
    EXPERIENCE_CATEGORIES,
  ),
});

const togglesArb: fc.Arbitrary<IncludeToggles> = fc.record({
  includeRating: fc.boolean(),
  includeNote: fc.boolean(),
});

const recipientIdsArb: fc.Arbitrary<ReadonlyArray<string>> = fc.array(
  fc.uuid(),
  { minLength: 1, maxLength: 50 },
);

// ---------------------------------------------------------------------------
// Property 4a — Experience body composition (R2.8, R2.14)
// ---------------------------------------------------------------------------

describe('Property 4: Composer submits derived content with only marked values (R2.8, R2.14)', () => {
  test('experience body carries derived kind/id/recipients and includes Rating/Note iff present AND toggled on', () => {
    fc.assert(
      fc.property(
        experienceParamsArb,
        togglesArb,
        recipientIdsArb,
        (params, toggles, recipientIds) => {
          const body = buildShareCreateBody(params, toggles, recipientIds);

          // R2.8: kind and content are derived from the entry point.
          expect(body.kind).toBe('experience');
          if (body.kind !== 'experience') return; // narrow for TypeScript
          expect(body.experienceId).toBe(params.experienceId);
          expect(body.recipientIds).toEqual(recipientIds);

          // Oracle: a value is included iff it is present in params AND its
          // toggle is marked included (R2.14).
          const ratingPresent = params.rating !== undefined;
          const notePresent =
            params.note !== undefined && params.note.length > 0;
          const ratingIncluded = ratingPresent && toggles.includeRating;
          const noteIncluded = notePresent && toggles.includeNote;

          if (ratingIncluded) {
            expect(body.rating).toBe(params.rating);
            expect(body.includeRating).toBe(true);
          } else {
            // Excluded or absent Rating never leaks into the body.
            expect(body.rating).toBeUndefined();
            expect(body.includeRating).toBeUndefined();
          }

          if (noteIncluded) {
            expect(body.note).toBe(params.note);
          } else {
            expect(body.note).toBeUndefined();
          }

          // The body introduces no fields beyond the derived + included shape.
          const expectedKeys = ['kind', 'recipientIds', 'experienceId'];
          if (ratingIncluded) expectedKeys.push('rating', 'includeRating');
          if (noteIncluded) expectedKeys.push('note');
          expect(Object.keys(body).sort()).toEqual(expectedKeys.sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  // -------------------------------------------------------------------------
  // Property 4b — Progress body composition (R2.8)
  // -------------------------------------------------------------------------

  test('progress body carries the snapshot verbatim and never a Rating or Note, regardless of toggles', () => {
    fc.assert(
      fc.property(
        progressParamsArb,
        togglesArb,
        recipientIdsArb,
        (params, toggles, recipientIds) => {
          const body = buildShareCreateBody(params, toggles, recipientIds);

          expect(body.kind).toBe('progress');
          if (body.kind !== 'progress') return; // narrow for TypeScript
          expect(body.recipientIds).toEqual(recipientIds);

          // The overall/per-Park/per-Category snapshot is carried verbatim.
          expect(body.statsSnapshot.overallPercent).toBe(params.overallPercent);
          expect(body.statsSnapshot.perParkPercent).toEqual(
            params.perParkPercent,
          );
          expect(body.statsSnapshot.perCategoryPercent).toEqual(
            params.perCategoryPercent,
          );

          // A progress body never carries a Rating or Note (R2.8 — content is
          // derived from the entry point, which for progress has neither).
          expect((body as unknown as Record<string, unknown>).rating).toBeUndefined();
          expect(
            (body as unknown as Record<string, unknown>).includeRating,
          ).toBeUndefined();
          expect((body as unknown as Record<string, unknown>).note).toBeUndefined();

          expect(Object.keys(body).sort()).toEqual(
            ['kind', 'recipientIds', 'statsSnapshot'].sort(),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
