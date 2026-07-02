// Feature: friend-profile-navigation, Property 4: The Experience_Filter selects exactly the matching named entries in source order
//
// Validates: Requirements 14.5, 14.6, 14.7
//
// Property 4 (from design.md → Correctness Properties):
//   For any already-loaded list of Completion_Entries and any Experience_Filter
//   state (a Filter_Park_Selection of "All" or one catalog Park, and a
//   Filter_Category_Selection of "All" or one Experience_Category),
//   `applyExperienceFilter` returns exactly the entries that
//     (a) have an available (non-blank) Experience name, AND
//     (b) whose Park equals the Filter_Park_Selection or where it is "All", AND
//     (c) whose Experience_Category equals the Filter_Category_Selection or
//         where it is "All",
//   in the source order of the originating read, excluding every entry that
//   fails either selection (R14.5). In particular, when both selections are
//   "All" the result equals the unfiltered named-entry set in source order
//   (R14.6). The narrowing is a single synchronous pass over already-loaded
//   data, so the updated list is produced well within the 300 ms budget
//   without any read (R14.7).
//
// Test strategy:
//   - Generate Completion_Entry lists that mix named entries with blank-named
//     ones (empty and whitespace-only) so the "available name" predicate is
//     exercised on both sides, and draw Park/Category uniformly from the
//     closed shared tuples so every catalog value can appear.
//   - Generate the filter state from a `filterStateArb` that covers the
//     "All/All", single-axis ("All" on one axis, a concrete value on the
//     other), and both-axis (concrete Park AND concrete Category) shapes.
//   - Assert the result equals an independent oracle computed straight from
//     the requirement text (filter preserves input order), which simultaneously
//     pins membership, exclusion, and source order.
//   - Assert structurally that every kept entry satisfies all three conditions,
//     that no excluded entry satisfies all three, and that the result is a
//     subsequence of the input (source order preserved).
//   - Assert the "All/All" case equals the unfiltered named-entry set (R14.6).

import fc from 'fast-check';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { CompletionEntryDTO, ExperienceCategory, Park } from '@dwt/shared';

import {
  applyExperienceFilter,
  type ExperienceFilterState,
  type FilterCategorySelection,
  type FilterParkSelection,
} from '../experienceFilter';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);
const categoryArb: fc.Arbitrary<ExperienceCategory> = fc.constantFrom(
  ...EXPERIENCE_CATEGORIES,
);

// Names mix three shapes so the "available name" rule (trim().length > 0) is
// exercised on both sides: empty string, whitespace-only (blank), and a
// genuinely non-blank name. The non-blank case occasionally carries leading or
// trailing whitespace to confirm trimming is about availability, not content.
const blankNameArb: fc.Arbitrary<string> = fc.constantFrom('', ' ', '   ', '\t', '\n  ');
const namedArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((s) => s.trim().length > 0)
  .chain((core) =>
    fc.constantFrom(core, `  ${core}`, `${core}  `, ` ${core} `),
  );
const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: namedArb },
  { weight: 1, arbitrary: blankNameArb },
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

const completionEntryArb: fc.Arbitrary<CompletionEntryDTO> = fc.record({
  experienceId: fc.uuid(),
  experienceName: nameArb,
  park: parkArb,
  category: categoryArb,
  completedOn: completedOnArb,
  rating: ratingArb,
  sharedNote: sharedNoteArb,
});

const entriesArb: fc.Arbitrary<CompletionEntryDTO[]> = fc.array(
  completionEntryArb,
  { minLength: 0, maxLength: 40 },
);

// Park / Category selections each cover "All" plus every concrete catalog
// value, so the cross product yields the All/All, single-axis, and both-axis
// filter shapes the property requires.
const parkSelectionArb: fc.Arbitrary<FilterParkSelection> = fc.oneof(
  fc.constant<FilterParkSelection>('All'),
  parkArb,
);
const categorySelectionArb: fc.Arbitrary<FilterCategorySelection> = fc.oneof(
  fc.constant<FilterCategorySelection>('All'),
  categoryArb,
);
const filterStateArb: fc.Arbitrary<ExperienceFilterState> = fc.record({
  park: parkSelectionArb,
  category: categorySelectionArb,
});

// ---------------------------------------------------------------------------
// Independent oracle (encodes the requirement text directly)
// ---------------------------------------------------------------------------

function hasAvailableName(entry: CompletionEntryDTO): boolean {
  return entry.experienceName.trim().length > 0;
}

function matchesPark(entry: CompletionEntryDTO, sel: FilterParkSelection): boolean {
  return sel === 'All' || entry.park === sel;
}

function matchesCategory(
  entry: CompletionEntryDTO,
  sel: FilterCategorySelection,
): boolean {
  return sel === 'All' || entry.category === sel;
}

// Reference filter: keep named entries satisfying both selections, in input
// order. `Array.prototype.filter` preserves source order, matching R14.5/R14.7.
function expectedFilter(
  entries: readonly CompletionEntryDTO[],
  state: ExperienceFilterState,
): CompletionEntryDTO[] {
  return entries.filter(
    (e) =>
      hasAvailableName(e) &&
      matchesPark(e, state.park) &&
      matchesCategory(e, state.category),
  );
}

// True when `sub` is `entries` with zero or more elements removed but the
// relative order of the survivors preserved (same object references).
function isSubsequence(
  entries: readonly CompletionEntryDTO[],
  sub: readonly CompletionEntryDTO[],
): boolean {
  let i = 0;
  for (const entry of entries) {
    if (i < sub.length && sub[i] === entry) i += 1;
  }
  return i === sub.length;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 4: Experience_Filter selects exactly the matching named entries in source order (R14.5, R14.6, R14.7)', () => {
  test('result equals the named-and-matching entries in source order for any filter state', () => {
    fc.assert(
      fc.property(entriesArb, filterStateArb, (entries, state) => {
        const result = applyExperienceFilter(entries, state);
        const expected = expectedFilter(entries, state);

        // R14.5: exactly the entries satisfying name + both selections, in
        // source order, each kept once (same references, same order).
        expect(result).toEqual(expected);

        // Source order preserved: the result is a subsequence of the input.
        expect(isSubsequence(entries, result)).toBe(true);

        // Every kept entry satisfies all three conditions (membership).
        for (const e of result) {
          expect(hasAvailableName(e)).toBe(true);
          expect(matchesPark(e, state.park)).toBe(true);
          expect(matchesCategory(e, state.category)).toBe(true);
        }

        // Every excluded entry fails at least one condition (exclusion).
        const kept = new Set(result);
        for (const e of entries) {
          if (kept.has(e)) continue;
          const passesAll =
            hasAvailableName(e) &&
            matchesPark(e, state.park) &&
            matchesCategory(e, state.category);
          expect(passesAll).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  test('with both selections "All" the result equals the unfiltered named-entry set in source order (R14.6)', () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const allAll: ExperienceFilterState = { park: 'All', category: 'All' };
        const result = applyExperienceFilter(entries, allAll);

        // R14.6: All/All yields exactly the named entries, in source order.
        const namedInOrder = entries.filter(hasAvailableName);
        expect(result).toEqual(namedInOrder);
      }),
      { numRuns: 100 },
    );
  });
});
