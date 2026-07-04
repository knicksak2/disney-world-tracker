// Feature: social-sharing-loop, Property 21: Completion diff is the
// friend-minus-viewer set difference by Experience identity
//
// Validates: Requirements 13.1, 13.4
//
// Property 21 (from design.md):
//   For any viewer completed-Experience set `V` and Friend completed-Experience
//   set `F`, the Completion_Diff equals `{ e ∈ F : e.id ∉ V }` compared by
//   Experience identity, and is empty if and only if every Friend-completed
//   Experience is present in `V`.
//
// This targets the pure `deriveCompletionDiff(viewerEntries, friendEntries)`
// helper (task 25.1) directly — no rendering, so no React / navigation / expo
// mocks are needed.
//
// Test strategy:
//   - Draw both the viewer's and the Friend's `CompletionEntryDTO[]` from a
//     small shared pool of `experienceId`s so overlap between the two sets is
//     frequent (the interesting case for a set difference). Values below,
//     equal to, and above any overlap boundary are naturally exercised because
//     each list independently samples the pool and may repeat ids.
//   - Independently recompute the reference difference by Experience identity:
//     the Friend entries whose `experienceId` is not in the viewer's id set,
//     in Friend source order, deduplicated by `experienceId` keeping the first
//     occurrence. Assert `deriveCompletionDiff` equals this reference exactly
//     (R13.1).
//   - Assert the emptiness biconditional (R13.4): the result is empty if and
//     only if every Friend-completed Experience id is present in the viewer's
//     id set.
//   - Assert the structural invariants of a set difference by identity: every
//     returned entry's id is in `F` and not in `V`, and the returned ids are
//     distinct (a proper set by Experience identity).
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
 * that collisions (the case a set difference must resolve) occur often. Kept
 * intentionally tiny relative to list length so viewer/Friend overlap spans
 * "none", "partial", and "total".
 */
const ID_POOL = ['exp-1', 'exp-2', 'exp-3', 'exp-4', 'exp-5'] as const;

const experienceIdArb: fc.Arbitrary<string> = fc.constantFrom(...ID_POOL);

/**
 * A `CompletionEntryDTO` whose `experienceId` is drawn from the shared pool and
 * whose remaining fields are arbitrary-but-valid. Only `experienceId` drives
 * the difference; the other fields ride along so we can confirm the helper
 * returns the Friend entries unchanged (identity, not just id).
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
// Reference implementation (independent of the code under test)
// ---------------------------------------------------------------------------

/**
 * Reference friend-minus-viewer set difference by Experience identity: keep the
 * Friend entries whose id is absent from the viewer's id set, in Friend source
 * order, deduplicated by id keeping the first occurrence.
 */
function referenceDiff(
  viewerEntries: readonly CompletionEntryDTO[],
  friendEntries: readonly CompletionEntryDTO[],
): CompletionEntryDTO[] {
  const viewerIds = new Set(viewerEntries.map((e) => e.experienceId));
  const seen = new Set<string>();
  const out: CompletionEntryDTO[] = [];
  for (const entry of friendEntries) {
    const id = entry.experienceId;
    if (viewerIds.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 21: Completion diff is the friend-minus-viewer set difference by Experience identity (R13.1, R13.4)', () => {
  test('equals { e ∈ F : e.id ∉ V } by Experience identity, empty iff F ⊆ V', () => {
    fc.assert(
      fc.property(entryListArb, entryListArb, (viewerEntries, friendEntries) => {
        const result = deriveCompletionDiff(viewerEntries, friendEntries);

        // R13.1: equals the reference friend-minus-viewer difference by
        // identity, exactly (order-preserving, deduplicated by id).
        const expected = referenceDiff(viewerEntries, friendEntries);
        expect(result).toEqual(expected);

        const viewerIds = new Set(viewerEntries.map((e) => e.experienceId));
        const friendIds = new Set(friendEntries.map((e) => e.experienceId));
        const resultIds = result.map((e) => e.experienceId);

        // Every returned entry belongs to F and not to V (set difference).
        for (const entry of result) {
          expect(friendIds.has(entry.experienceId)).toBe(true);
          expect(viewerIds.has(entry.experienceId)).toBe(false);
        }

        // The result is a proper set by Experience identity: distinct ids.
        expect(new Set(resultIds).size).toBe(resultIds.length);

        // R13.4: empty if and only if every Friend-completed Experience is
        // present in the viewer's set.
        const everyFriendInViewer = [...friendIds].every((id) =>
          viewerIds.has(id),
        );
        expect(result.length === 0).toBe(everyFriendInViewer);
      }),
      { numRuns: 100 },
    );
  });
});
