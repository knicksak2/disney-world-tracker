// Feature: social-sharing-loop, Property 22: Each completion-diff entry
// carries name, Park, and Experience_Category
//
// Validates: Requirements 13.2
//
// Property 22 (from design.md):
//   For any non-empty Completion_Diff, each rendered entry shows the
//   Experience's name, Park, and Experience_Category.
//
// This targets the pure `deriveCompletionDiff(viewerEntries, friendEntries)`
// helper (task 25.1) directly. Each returned entry is a Friend
// `CompletionEntryDTO`, which is the exact shape the Completion_Diff list
// renders from — so confirming every returned entry carries a populated name,
// a Park field (a concrete Park or `null` for resort-area / resort entries),
// and a valid Experience_Category is what guarantees the rendered entry can
// show all three (R13.2). No rendering, so no React / navigation / expo mocks
// are needed.
//
// Test strategy:
//   - Draw the viewer's and the Friend's `CompletionEntryDTO[]` from a small
//     shared pool of `experienceId`s so the diff is non-empty across a wide
//     range of samples (the clause Property 22 quantifies over) while still
//     exercising the empty case. Every generated Friend entry is given a
//     populated name (minLength 1), a Park field (a real Park or `null`), and a
//     category from the closed `EXPERIENCE_CATEGORIES` set, so the source data
//     always genuinely carries the three fields.
//   - Build a by-id map of the Friend's entries (first occurrence, matching the
//     helper's dedup rule) as an independent reference.
//   - For every entry in the diff assert it carries name, Park, and category:
//       * `experienceName` is a non-empty string;
//       * `park` is either `null` or one of the closed `PARKS` set;
//       * `category` is one of the closed `EXPERIENCE_CATEGORIES` set;
//     and that all three equal the corresponding Friend source entry's values,
//     i.e. the entry carries the Friend's metadata rather than fabricated data.
//   - `fast-check` runs at numRuns: 100 per the plan's minimum.

import fc from 'fast-check';

import {
  AREA_TYPES,
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
} from '@dwt/shared';

import { deriveCompletionDiff } from '../completionDiff';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * A small pool of Experience ids shared by both the viewer and the Friend so
 * that the friend-minus-viewer difference is frequently non-empty — the clause
 * Property 22 quantifies over — while still occasionally producing the empty
 * diff.
 */
const ID_POOL = ['exp-1', 'exp-2', 'exp-3', 'exp-4', 'exp-5'] as const;

const experienceIdArb: fc.Arbitrary<string> = fc.constantFrom(...ID_POOL);

/**
 * A `CompletionEntryDTO` with a genuinely populated name, a Park field (a real
 * Park or `null` for resort-area / resort entries), and a valid
 * Experience_Category. Only `experienceId` drives the difference; the metadata
 * fields ride along so we can confirm each returned entry carries the Friend's
 * name/Park/category (R13.2).
 */
const completionEntryArb: fc.Arbitrary<CompletionEntryDTO> = fc.record({
  experienceId: experienceIdArb,
  experienceName: fc.string({ minLength: 1, maxLength: 24 }),
  park: fc.option(fc.constantFrom(...PARKS), { nil: null }),
  areaType: fc.constantFrom(...AREA_TYPES),
  category: fc.constantFrom(...EXPERIENCE_CATEGORIES),
  completedOn: fc.constant('2024-01-01'),
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  sharedNote: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
});

const entryListArb: fc.Arbitrary<readonly CompletionEntryDTO[]> = fc.array(
  completionEntryArb,
  { maxLength: 12 },
);

// ---------------------------------------------------------------------------
// Reference: Friend metadata by id (first occurrence, matching helper dedup)
// ---------------------------------------------------------------------------

function friendEntryById(
  friendEntries: readonly CompletionEntryDTO[],
): Map<string, CompletionEntryDTO> {
  const byId = new Map<string, CompletionEntryDTO>();
  for (const entry of friendEntries) {
    if (!byId.has(entry.experienceId)) {
      byId.set(entry.experienceId, entry);
    }
  }
  return byId;
}

const PARK_SET: ReadonlySet<string> = new Set(PARKS);
const CATEGORY_SET: ReadonlySet<string> = new Set(EXPERIENCE_CATEGORIES);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 22: Each completion-diff entry carries name, Park, and Experience_Category (R13.2)', () => {
  test('every diff entry carries a populated name, a Park field, and a valid category, matching the Friend source', () => {
    fc.assert(
      fc.property(entryListArb, entryListArb, (viewerEntries, friendEntries) => {
        const result = deriveCompletionDiff(viewerEntries, friendEntries);
        const sourceById = friendEntryById(friendEntries);

        for (const entry of result) {
          // Name is present and populated (R13.2).
          expect(typeof entry.experienceName).toBe('string');
          expect(entry.experienceName.length).toBeGreaterThan(0);

          // Park field is present: a concrete Park or `null` (R13.2).
          if (entry.park !== null) {
            expect(PARK_SET.has(entry.park)).toBe(true);
          }

          // Experience_Category is present and from the closed set (R13.2).
          expect(CATEGORY_SET.has(entry.category)).toBe(true);

          // The three fields are carried from the Friend source entry, not
          // fabricated: they equal the Friend's first entry for this id.
          const source = sourceById.get(entry.experienceId);
          expect(source).toBeDefined();
          expect(entry.experienceName).toBe(source!.experienceName);
          expect(entry.park).toBe(source!.park);
          expect(entry.category).toBe(source!.category);
        }
      }),
      { numRuns: 100 },
    );
  });
});
