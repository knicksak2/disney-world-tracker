// Feature: experience-detail-navigation, Property 3: Navigation target is the exact Experience_Id when present, and absent otherwise
//
// Validates: Requirements 2.1, 3.1, 3.3, 6.1, 6.2, 11.3
//
// Property 3 (from design.md → Correctness Properties):
//   For any Completion_Entry, `resolveExperienceTarget(entry)` returns
//   `entry.experienceId` unchanged (same value, no modification) when the entry
//   has a present, non-empty Experience_Id, and returns `null` (no navigation
//   affordance) when the Experience_Id is missing, null, or blank.
//
// Test strategy:
//   - Generate Completion_Entries whose `experienceId` deliberately spans four
//     shapes: a present non-blank id (UUID-like and arbitrary non-blank
//     strings), the empty string, whitespace-only strings (blank), and the
//     missing/null cases (no field, or an explicit null). The remaining DTO
//     fields are filled with arbitrary valid values so they cannot influence
//     the resolver.
//   - For the present case assert the result is `=== entry.experienceId`
//     (referential identity proves the value is returned unmodified, R6.2).
//   - For the missing/null/blank cases assert the result is exactly `null`
//     (no navigation affordance, R6.1).
//   - An independent oracle encodes the requirement text directly and is
//     cross-checked against the implementation for every generated entry.

import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { CompletionEntryDTO, ExperienceCategory, Park } from '@dwt/shared';

import { resolveExperienceTarget } from '../experienceNavigation';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

const ratingArb: fc.Arbitrary<number | null> = fc.oneof(
  fc.constant(null),
  fc.integer({ min: 1, max: 10 }),
);

const sharedNoteArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.string({ minLength: 1, maxLength: 12 }),
);

const completedOnArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2018-01-01'), max: new Date('2025-12-31') })
  .map((d) => d.toISOString().slice(0, 10));

const experienceNameArb: fc.Arbitrary<string> = fc.string({
  minLength: 1,
  maxLength: 20,
});

// A present, non-blank Experience_Id: UUID-like values plus arbitrary strings
// that retain a non-whitespace character even when padded with surrounding
// whitespace (so the resolver must return them unmodified, not trimmed).
const presentIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.uuid(),
  fc
    .string({ minLength: 1, maxLength: 16 })
    .filter((s) => s.trim().length > 0),
  // Non-blank core with surrounding whitespace — still "present" (R6.2): the
  // value must be returned verbatim, never trimmed.
  fc
    .string({ minLength: 1, maxLength: 8 })
    .filter((s) => s.trim().length > 0)
    .chain((core) => fc.constantFrom(core, `  ${core}`, `${core}  `, ` ${core} `)),
);

// A blank Experience_Id: empty or whitespace-only.
const blankIdArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 6 }),
);

// The "missing / null" shapes: an explicit null id, or the field omitted
// entirely. Modeled as a partial so the resolver's defensive guard (R6.1) is
// exercised against malformed/partially-decoded entries.
type MaybeId = { readonly experienceId?: string | null };
const missingIdArb: fc.Arbitrary<MaybeId> = fc.oneof(
  fc.constant<MaybeId>({ experienceId: null }),
  fc.constant<MaybeId>({}),
);

// Base entry without the experienceId field; each property supplies the id
// shape under test.
const baseEntryArb = fc.record({
  experienceName: experienceNameArb,
  park: parkArb,
  category: categoryArb,
  completedOn: completedOnArb,
  rating: ratingArb,
  sharedNote: sharedNoteArb,
});

// ---------------------------------------------------------------------------
// Independent oracle (encodes the requirement text directly)
// ---------------------------------------------------------------------------

function expectedTarget(experienceId: unknown): string | null {
  if (typeof experienceId !== 'string' || experienceId.trim() === '') {
    return null;
  }
  return experienceId;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 3: resolveExperienceTarget returns the exact Experience_Id when present, null otherwise (R2.1, R3.1, R3.3, R6.1, R6.2, R11.3)', () => {
  test('returns entry.experienceId unmodified when present and non-blank', () => {
    fc.assert(
      fc.property(baseEntryArb, presentIdArb, (base, experienceId) => {
        const entry: CompletionEntryDTO = { ...base, experienceId };

        const result = resolveExperienceTarget(entry);

        // Returned verbatim — same value, no trimming or other modification
        // (R6.2). `===` on strings compares value; the surrounding-whitespace
        // generator cases prove the value is not trimmed.
        expect(result).toBe(experienceId);
        expect(result).toBe(expectedTarget(experienceId));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('returns null when the Experience_Id is blank (empty or whitespace-only)', () => {
    fc.assert(
      fc.property(baseEntryArb, blankIdArb, (base, experienceId) => {
        const entry: CompletionEntryDTO = { ...base, experienceId };

        const result = resolveExperienceTarget(entry);

        // No navigation affordance for a blank id (R6.1).
        expect(result).toBeNull();
        expect(result).toBe(expectedTarget(experienceId));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  test('returns null when the Experience_Id is missing or null', () => {
    fc.assert(
      fc.property(baseEntryArb, missingIdArb, (base, maybeId) => {
        // Model a malformed / partially-decoded entry whose experienceId is
        // null or absent; the resolver's defensive guard must yield null (R6.1).
        const entry = { ...base, ...maybeId } as unknown as CompletionEntryDTO;

        const result = resolveExperienceTarget(entry);

        expect(result).toBeNull();
        expect(result).toBe(expectedTarget(maybeId.experienceId));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
