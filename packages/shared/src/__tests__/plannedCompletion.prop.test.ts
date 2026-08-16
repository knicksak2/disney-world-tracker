/**
 * Property-based tests for the pure Planned List Completion Sync derivation
 * core (`packages/shared/src/plannedCompletion.ts`).
 *
 * This file is shared across the derivation properties: Property 1 (the
 * completion match) lives here now; Properties 2 and 4 (the Done/not-Done
 * partition and the progress count) are appended by later tasks. The shared
 * generators below are defined once so every property can reuse them.
 *
 * All properties run with `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { PARKS } from '../enums.js';
import type { Park } from '../enums.js';
import type { PlannedItemDTO, TripFeedItemDTO } from '../trips.js';
import {
  completedExperienceIdsFromFeed,
  derivePlannedCounts,
  derivePlannedListPresentation,
} from '../plannedCompletion.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

/**
 * A small pool of Experience ids so that a randomly generated Planned_List and
 * completed set overlap often enough to exercise both the `done` and `not_done`
 * branches within a single run.
 */
const experienceIdArb = fc.constantFrom(
  'exp-a',
  'exp-b',
  'exp-c',
  'exp-d',
  'exp-e',
  'exp-f',
  'exp-g',
  'exp-h',
);

const parkArb: fc.Arbitrary<Park> = fc.constantFrom(...PARKS);

/**
 * One Planned_Item. The adder display name may be empty (an item whose adder
 * could not be resolved is still a valid Planned_Item, retained rather than
 * dropped).
 */
const plannedItemArb: fc.Arbitrary<PlannedItemDTO> = fc.record({
  id: fc.uuid(),
  experienceId: fc.option(experienceIdArb, { nil: null }),
  experienceName: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
  park: fc.option(parkArb, { nil: null }),
  customTitle: fc.option(fc.string({ maxLength: 40 }), { nil: null }),
  addedByDisplayName: fc.oneof(fc.constant(''), fc.string({ maxLength: 30 })),
  plannedDate: fc.option(fc.constant('2026-10-01'), { nil: null }),
  plannedTime: fc.option(fc.constant('2026-10-01T10:00:00Z'), { nil: null }),
  isFixed: fc.boolean(),
  isLightningLane: fc.boolean(),
  useSingleRider: fc.boolean(),
  priority: fc.integer({ min: 1, max: 3 }),
  itemType: fc.constantFrom('experience', 'break'),
  durationMinutes: fc.option(fc.integer({ min: 1, max: 120 }), { nil: null }),
  windowStartMinutes: fc.option(fc.integer({ min: 0, max: 1440 }), { nil: null }),
  windowEndMinutes: fc.option(fc.integer({ min: 0, max: 1440 }), { nil: null }),
  mealPeriod: fc.option(fc.constantFrom('breakfast', 'lunch', 'dinner'), { nil: null }),
  scheduledShowtime: fc.option(fc.constant('2026-10-01T14:00:00.000Z'), { nil: null }),
  predictedWaitMinutes: fc.option(fc.integer({ min: 0, max: 180 }), { nil: null }),
  travelFromPrev: fc.option(
    fc.record({
      kind: fc.constantFrom('walk', 'park_hop'),
      minutes: fc.integer({ min: 0, max: 60 }),
    }),
    { nil: null },
  ),
  optimizedAt: fc.option(fc.constant('2026-10-01T12:00:00.000Z'), { nil: null }),
});

/** A Planned_List: an array of Planned_Items (possibly empty). */
const plannedListArb: fc.Arbitrary<readonly PlannedItemDTO[]> = fc.array(
  plannedItemArb,
  { maxLength: 20 },
);

/** A set of completed Experience ids drawn from the same pool. */
const completedSetArb: fc.Arbitrary<ReadonlySet<string>> = fc
  .array(experienceIdArb, { maxLength: 8 })
  .map((ids) => new Set(ids));

/**
 * A `completion_logged` feed item for the given Experience id, attributed to
 * an arbitrary Trip_Member (the actor is irrelevant to the match — R2.3).
 */
const completionFeedItemArb = (experienceId: string): fc.Arbitrary<TripFeedItemDTO> =>
  fc.record({
    id: fc.uuid(),
    type: fc.constant('completion_logged'),
    actorDisplayName: fc.string({ maxLength: 30 }),
    actorAvatarPreset: fc.constant(null),
    createdAt: fc.date().map((d) => d.toISOString()),
    metadata: fc.constant({ experienceId } as Record<string, unknown>),
    reactions: fc.constant([]),
    comments: fc.constant([]),
  });

/** A non-completion feed item that must never contribute to the completed set. */
const nonCompletionFeedItemArb: fc.Arbitrary<TripFeedItemDTO> = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('planned_item_added', 'member_joined', 'reaction_added'),
  actorDisplayName: fc.string({ maxLength: 30 }),
  actorAvatarPreset: fc.constant(null),
  createdAt: fc.date().map((d) => d.toISOString()),
  metadata: fc.constant({}),
  reactions: fc.constant([]),
  comments: fc.constant([]),
});

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

// Feature: planned-list-completion-sync, Property 1: A Planned_Item is done exactly when its Experience was completed in the Trip
describe('Property 1: A Planned_Item is done exactly when its Experience was completed in the Trip', () => {
  it('derives done iff the item Experience is in the completed set, member-agnostic (R2.1, R2.2, R2.3)', () => {
    fc.assert(
      fc.property(plannedListArb, completedSetArb, (plannedItems, completedIds) => {
        const presentation = derivePlannedListPresentation(plannedItems, completedIds);

        // Every input item appears exactly once across the two sections with a
        // completionState that matches set membership on experienceId only.
        const byId = new Map(
          [...presentation.doneSection, ...presentation.notDoneSection].map(
            (view) => [view.id, view],
          ),
        );

        for (const item of plannedItems) {
          const view = byId.get(item.id);
          expect(view).toBeDefined();
          const expectedDone = item.experienceId !== null && completedIds.has(item.experienceId);
          expect(view!.completionState).toBe(expectedDone ? 'done' : 'not_done');
        }

        // The Done_Section is exactly the items whose Experience is completed.
        for (const view of presentation.doneSection) {
          expect(view.completionState).toBe('done');
          expect(view.experienceId !== null && completedIds.has(view.experienceId)).toBe(true);
        }
        for (const view of presentation.notDoneSection) {
          expect(view.completionState).toBe('not_done');
          expect(view.experienceId === null || !completedIds.has(view.experienceId)).toBe(true);
        }

        // completionAvailable is true whenever the completed set is known.
        expect(presentation.completionAvailable).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is a pure, deterministic function of its inputs (R2.1, R2.2)', () => {
    fc.assert(
      fc.property(plannedListArb, completedSetArb, (plannedItems, completedIds) => {
        const first = derivePlannedListPresentation(plannedItems, completedIds);
        const second = derivePlannedListPresentation(plannedItems, completedIds);
        expect(second).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('flips exactly the matching item to done when a completion is added, changing nothing else (R2.4)', () => {
    fc.assert(
      fc.property(
        fc.array(plannedItemArb, { minLength: 1, maxLength: 20 }),
        completedSetArb,
        fc.nat(),
        (plannedItems, completedIds, pick) => {
          // Choose an item that is currently not_done and has a valid experienceId, if one exists.
          const notDone = plannedItems.filter(
            (item) => item.experienceId !== null && !completedIds.has(item.experienceId),
          );
          fc.pre(notDone.length > 0);
          const target = notDone[pick % notDone.length]!;

          const before = derivePlannedListPresentation(plannedItems, completedIds);

          // Add the target's Experience to the completed set (recompute).
          const after = derivePlannedListPresentation(
            plannedItems,
            new Set([...completedIds, target.experienceId!]),
          );

          // Every item sharing the target Experience flips to done; all others
          // keep their prior state.
          const stateOf = (
            presentation: ReturnType<typeof derivePlannedListPresentation>,
            id: string,
          ) =>
            [...presentation.doneSection, ...presentation.notDoneSection].find(
              (view) => view.id === id,
            )!.completionState;

          for (const item of plannedItems) {
            const wasDone = stateOf(before, item.id) === 'done';
            const nowDone = stateOf(after, item.id) === 'done';
            if (item.experienceId === target.experienceId) {
              expect(nowDone).toBe(true);
            } else {
              expect(nowDone).toBe(wasDone);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('forces every item not_done with completionAvailable=false when the feed is unavailable (R2.7)', () => {
    fc.assert(
      fc.property(plannedListArb, (plannedItems) => {
        const presentation = derivePlannedListPresentation(plannedItems, null);

        expect(presentation.completionAvailable).toBe(false);
        expect(presentation.doneSection).toHaveLength(0);
        expect(presentation.notDoneSection).toHaveLength(plannedItems.length);
        for (const view of presentation.notDoneSection) {
          expect(view.completionState).toBe('not_done');
        }
        // No item is ever presented as done from unavailable data.
        expect(presentation.progress.completed).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('builds the completed set from completion_logged feed items only, and null when unloaded (R2.7)', () => {
    // A null feed yields a null set (fail-safe to not_done).
    expect(completedExperienceIdsFromFeed(null)).toBeNull();

    // A feed built from completion_logged items for a known set of Experience
    // ids, interleaved with non-completion noise, must derive exactly those ids.
    const feedWithExpectedArb = fc
      .array(experienceIdArb, { maxLength: 8 })
      .chain((completedExperienceIds) =>
        fc
          .tuple(
            fc.tuple(
              ...completedExperienceIds.map((id) => completionFeedItemArb(id)),
            ),
            fc.array(nonCompletionFeedItemArb, { maxLength: 8 }),
          )
          .chain(([completionItems, noise]) =>
            fc
              .shuffledSubarray([...completionItems, ...noise], {
                minLength: completionItems.length + noise.length,
              })
              .map((feed) => ({
                feed,
                expected: new Set(completedExperienceIds),
              })),
          ),
      );

    fc.assert(
      fc.property(feedWithExpectedArb, ({ feed, expected }) => {
        const set = completedExperienceIdsFromFeed(feed);
        expect(set).not.toBeNull();
        // The set contains exactly the completion_logged experienceIds.
        expect([...set!].sort()).toEqual([...expected].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2
// ---------------------------------------------------------------------------

// Feature: planned-list-completion-sync, Property 2: The Planned_List is a total, attribution-preserving partition into Done and not-Done
describe('Property 2: The Planned_List is a total, attribution-preserving partition into Done and not-Done', () => {
  it('partitions every Planned_Item into exactly one section: disjoint, total, no drops or dupes (R3.2)', () => {
    fc.assert(
      fc.property(plannedListArb, completedSetArb, (plannedItems, completedIds) => {
        const presentation = derivePlannedListPresentation(plannedItems, completedIds);

        const doneIds = presentation.doneSection.map((view) => view.id);
        const notDoneIds = presentation.notDoneSection.map((view) => view.id);

        // Total: the two sections together contain exactly the input count —
        // nothing dropped, nothing added.
        expect(doneIds.length + notDoneIds.length).toBe(plannedItems.length);

        // Disjoint: no id appears in both sections.
        const doneIdSet = new Set(doneIds);
        for (const id of notDoneIds) {
          expect(doneIdSet.has(id)).toBe(false);
        }

        // No duplicates within the combined output (each item appears once).
        const allIds = [...doneIds, ...notDoneIds];
        expect(new Set(allIds).size).toBe(allIds.length);

        // Every input item id appears exactly once across the two sections.
        const inputIds = plannedItems.map((item) => item.id);
        expect([...allIds].sort()).toEqual([...inputIds].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('places exactly the Completed_Planned_Items in Done and exactly the not_done items outside it (R3.2)', () => {
    fc.assert(
      fc.property(plannedListArb, completedSetArb, (plannedItems, completedIds) => {
        const presentation = derivePlannedListPresentation(plannedItems, completedIds);

        // Done_Section contains exactly the items whose Experience is completed.
        const expectedDoneIds = plannedItems
          .filter((item) => item.experienceId !== null && completedIds.has(item.experienceId))
          .map((item) => item.id);
        const expectedNotDoneIds = plannedItems
          .filter((item) => item.experienceId === null || !completedIds.has(item.experienceId))
          .map((item) => item.id);

        expect([...presentation.doneSection.map((v) => v.id)].sort()).toEqual(
          [...expectedDoneIds].sort(),
        );
        expect([...presentation.notDoneSection.map((v) => v.id)].sort()).toEqual(
          [...expectedNotDoneIds].sort(),
        );

        // Each section's items carry the matching completionState.
        for (const view of presentation.doneSection) {
          expect(view.completionState).toBe('done');
        }
        for (const view of presentation.notDoneSection) {
          expect(view.completionState).toBe('not_done');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves each item Experience, Park, and adder attribution unchanged, including empty adder names (R3.3, R3.4)', () => {
    fc.assert(
      fc.property(plannedListArb, completedSetArb, (plannedItems, completedIds) => {
        const presentation = derivePlannedListPresentation(plannedItems, completedIds);

        const sourceById = new Map(plannedItems.map((item) => [item.id, item]));

        for (const view of [
          ...presentation.doneSection,
          ...presentation.notDoneSection,
        ]) {
          const source = sourceById.get(view.id);
          expect(source).toBeDefined();
          // Source attribution is carried through unchanged (R3.3): Experience
          // id, Experience name, Park, and adder display name. An empty adder
          // display name is retained rather than omitted (R3.4).
          expect(view.experienceId).toBe(source!.experienceId);
          expect(view.experienceName).toBe(source!.experienceName);
          expect(view.park).toBe(source!.park);
          expect(view.addedByDisplayName).toBe(source!.addedByDisplayName);
        }

        // Items whose adder display name is empty are retained, never dropped.
        const emptyAdderSourceIds = plannedItems
          .filter((item) => item.addedByDisplayName === '')
          .map((item) => item.id);
        const outputIds = new Set([
          ...presentation.doneSection.map((v) => v.id),
          ...presentation.notDoneSection.map((v) => v.id),
        ]);
        for (const id of emptyAdderSourceIds) {
          expect(outputIds.has(id)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

// Feature: planned-list-completion-sync, Property 4: Planned_List_Progress is a clamped completed-of-total count over distinct items
describe('Property 4: Planned_List_Progress is a clamped completed-of-total count over distinct items', () => {
  it('reports total = |Planned_Items| and completed = |items whose Experience is completed|, as clamped non-negative integers (R4.1, R4.2, R4.3, R4.6)', () => {
    fc.assert(
      fc.property(plannedListArb, completedSetArb, (plannedItems, completedIds) => {
        const { progress } = derivePlannedListPresentation(plannedItems, completedIds);

        const expectedCompleted = plannedItems.filter((item) =>
          item.experienceId !== null && completedIds.has(item.experienceId),
        ).length;

        // total counts every Planned_Item once regardless of completion state.
        expect(progress.total).toBe(plannedItems.length);
        // completed counts exactly the items whose Experience is in the set.
        expect(progress.completed).toBe(expectedCompleted);

        // Both are non-negative integers.
        expect(Number.isInteger(progress.total)).toBe(true);
        expect(Number.isInteger(progress.completed)).toBe(true);
        expect(progress.total).toBeGreaterThanOrEqual(0);
        expect(progress.completed).toBeGreaterThanOrEqual(0);

        // Clamped: 0 <= completed <= total (R4.6).
        expect(progress.completed).toBeLessThanOrEqual(progress.total);

        // derivePlannedCounts derives the same total/completed from the same
        // match, keeping the client badge and the server summary consistent.
        const counts = derivePlannedCounts(plannedItems, completedIds);
        expect(counts.plannedTotalCount).toBe(progress.total);
        expect(counts.plannedCompletedCount).toBe(progress.completed);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports 0 of 0 for an empty Planned_List, overriding any computed value (R4.4)', () => {
    fc.assert(
      fc.property(completedSetArb, (completedIds) => {
        const { progress } = derivePlannedListPresentation([], completedIds);
        expect(progress.total).toBe(0);
        expect(progress.completed).toBe(0);

        const counts = derivePlannedCounts([], completedIds);
        expect(counts.plannedTotalCount).toBe(0);
        expect(counts.plannedCompletedCount).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts each Planned_Item at most once no matter how many Trip_Log_Entries reference its Experience (duplicate-completion idempotence) (R4.2)', () => {
    // Build a completed set from a feed of completion_logged items, then a feed
    // where every completion is duplicated (the same Experience logged twice, as
    // by two Trip_Members). The derived completed count must be identical: a
    // Planned_Item counts at most once regardless of how many entries match it.
    const duplicatedFeedArb = fc
      .array(experienceIdArb, { maxLength: 8 })
      .chain((ids) =>
        fc
          .tuple(...ids.map((id) => completionFeedItemArb(id)))
          .map((items) => ({
            feedOnce: [...items] as TripFeedItemDTO[],
            feedTwice: [...items, ...items] as TripFeedItemDTO[],
          })),
      );

    fc.assert(
      fc.property(plannedListArb, duplicatedFeedArb, (plannedItems, { feedOnce, feedTwice }) => {
        const setOnce = completedExperienceIdsFromFeed(feedOnce)!;
        const setTwice = completedExperienceIdsFromFeed(feedTwice)!;

        const once = derivePlannedListPresentation(plannedItems, setOnce).progress;
        const twice = derivePlannedListPresentation(plannedItems, setTwice).progress;

        // Duplicated completions never inflate the count.
        expect(twice.completed).toBe(once.completed);
        expect(twice.total).toBe(once.total);

        // And the completed count never exceeds the number of distinct planned
        // items whose Experience is completed.
        const distinctCompletedItemIds = new Set(
          plannedItems
            .filter((item) => item.experienceId !== null && setTwice.has(item.experienceId))
            .map((item) => item.id),
        );
        expect(twice.completed).toBe(distinctCompletedItemIds.size);
        expect(twice.completed).toBeLessThanOrEqual(twice.total);

        // derivePlannedCounts agrees under duplication too.
        expect(derivePlannedCounts(plannedItems, setTwice).plannedCompletedCount).toBe(
          twice.completed,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('increases completed by exactly one when a newly logged Experience completes a previously not_done item, and leaves it unchanged otherwise (R4.5)', () => {
    fc.assert(
      fc.property(
        fc.array(plannedItemArb, { minLength: 1, maxLength: 20 }),
        completedSetArb,
        fc.nat(),
        (plannedItems, completedIds, pick) => {
          const before = derivePlannedListPresentation(plannedItems, completedIds).progress
            .completed;

          // Case A: adding an Experience already in the completed set changes
          // nothing (idempotent — no newly completed item).
          const alreadyCompleted = plannedItems.find((item) =>
            item.experienceId !== null && completedIds.has(item.experienceId),
          );
          if (alreadyCompleted) {
            const afterSame = derivePlannedListPresentation(
              plannedItems,
              new Set([...completedIds, alreadyCompleted.experienceId!]),
            ).progress.completed;
            expect(afterSame).toBe(before);
          }

          // Case B: adding an Experience that newly completes a previously
          // not_done item, where exactly one Planned_Item references it, raises
          // completed by exactly one.
          const notDone = plannedItems.filter(
            (item) => item.experienceId !== null && !completedIds.has(item.experienceId),
          );
          fc.pre(notDone.length > 0);
          const target = notDone[pick % notDone.length]!;
          const sharing = plannedItems.filter(
            (item) => item.experienceId === target.experienceId,
          );
          fc.pre(sharing.length === 1);

          const afterAdd = derivePlannedListPresentation(
            plannedItems,
            new Set([...completedIds, target.experienceId!]),
          ).progress.completed;
          expect(afterAdd - before).toBe(1);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
