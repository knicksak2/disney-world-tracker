/**
 * Unit and edge-case tests for the pure `plannedCompletion` derivation module.
 *
 * These example-based tests complement the property tests in
 * `plannedCompletion.prop.test.ts` by pinning down the concrete boundary
 * behaviors called out in the design's Testing Strategy:
 *
 *  - the empty Planned_List (`0 of 0`),
 *  - one Experience matched by several completions counted at most once,
 *  - a `done` item whose adder display name is empty being retained in the
 *    Done_Section (rather than omitted) with its attribution preserved, and
 *  - the feed-unavailable (`null`) branch that fails safe to all `not_done`.
 *
 * Validates: Requirements 2.7, 3.4, 4.4, 5.4
 */

import { describe, expect, it } from 'vitest';

import {
  completedExperienceIdsFromFeed,
  derivePlannedCounts,
  derivePlannedListPresentation,
} from '../plannedCompletion.js';
import type { PlannedItemDTO, TripFeedItemDTO } from '../trips.js';

/** Build a minimal PlannedItemDTO for tests, overriding only what matters. */
function plannedItem(overrides: Partial<PlannedItemDTO> = {}): PlannedItemDTO {
  return {
    id: `pi_${overrides.experienceId ?? 'x'}`,
    experienceId: 'exp_1',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    addedByDisplayName: 'Ada',
    ...overrides,
  } as PlannedItemDTO;
}

/** Build a minimal completion_logged feed item referencing an Experience. */
function completionFeedItem(
  experienceId: string,
  overrides: Partial<TripFeedItemDTO> = {},
): TripFeedItemDTO {
  return {
    id: `feed_${experienceId}_${Math.random().toString(36).slice(2)}`,
    type: 'completion_logged',
    actorDisplayName: 'Ada',
    actorAvatarPreset: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    metadata: { experienceId },
    reactions: [],
    comments: [],
    ...overrides,
  };
}

describe('completedExperienceIdsFromFeed', () => {
  it('returns null when the feed is unavailable (not loaded / load failed)', () => {
    // R2.7: a null feed must fail safe, letting callers force not_done.
    expect(completedExperienceIdsFromFeed(null)).toBeNull();
  });

  it('returns an empty set for an empty feed', () => {
    const set = completedExperienceIdsFromFeed([]);
    expect(set).not.toBeNull();
    expect(set?.size).toBe(0);
  });

  it('collects experienceIds only from completion_logged items', () => {
    const feed: TripFeedItemDTO[] = [
      completionFeedItem('exp_1'),
      {
        // A non-completion item is ignored even if it carries an experienceId.
        id: 'feed_other',
        type: 'planned_item_added',
        actorDisplayName: 'Grace',
        actorAvatarPreset: null,
        createdAt: '2024-01-02T00:00:00.000Z',
        metadata: { experienceId: 'exp_2' },
        reactions: [],
        comments: [],
      },
      completionFeedItem('exp_3'),
    ];

    const set = completedExperienceIdsFromFeed(feed);
    expect(set).not.toBeNull();
    expect([...(set ?? [])].sort()).toEqual(['exp_1', 'exp_3']);
  });

  it('deduplicates an Experience completed several times', () => {
    // R5.5 / R4.2: an Experience with several completions is counted once.
    const feed: TripFeedItemDTO[] = [
      completionFeedItem('exp_1'),
      completionFeedItem('exp_1'),
      completionFeedItem('exp_1'),
    ];

    const set = completedExperienceIdsFromFeed(feed);
    expect(set?.size).toBe(1);
    expect(set?.has('exp_1')).toBe(true);
  });

  it('ignores completion items with a missing or non-string experienceId', () => {
    const feed: TripFeedItemDTO[] = [
      completionFeedItem('exp_1'),
      { ...completionFeedItem('ignored'), metadata: {} },
      { ...completionFeedItem('ignored'), metadata: { experienceId: '' } },
      { ...completionFeedItem('ignored'), metadata: { experienceId: 42 } },
    ];

    const set = completedExperienceIdsFromFeed(feed);
    expect([...(set ?? [])]).toEqual(['exp_1']);
  });
});

describe('derivePlannedListPresentation', () => {
  it('returns 0 of 0 with empty sections for an empty Planned_List', () => {
    // R4.4: an empty list reports 0 of 0.
    const presentation = derivePlannedListPresentation([], new Set());

    expect(presentation.doneSection).toEqual([]);
    expect(presentation.notDoneSection).toEqual([]);
    expect(presentation.progress).toEqual({ completed: 0, total: 0 });
    expect(presentation.completionAvailable).toBe(true);
  });

  it('counts a single Experience matched by several completions exactly once', () => {
    // One planned item; its Experience was completed multiple times. Set
    // membership is idempotent, so the item is done once and progress is 1/1.
    const items = [plannedItem({ id: 'pi_1', experienceId: 'exp_1' })];
    const completedIds = completedExperienceIdsFromFeed([
      completionFeedItem('exp_1'),
      completionFeedItem('exp_1'),
    ]);

    const presentation = derivePlannedListPresentation(items, completedIds);

    expect(presentation.doneSection).toHaveLength(1);
    expect(presentation.doneSection[0]?.completionState).toBe('done');
    expect(presentation.notDoneSection).toHaveLength(0);
    expect(presentation.progress).toEqual({ completed: 1, total: 1 });
  });

  it('retains a done item with an empty adder name and preserves its attribution', () => {
    // R3.4: an item whose adder display name is empty is retained in the
    // Done_Section (not omitted), with its Experience, Park, and (empty)
    // attribution preserved unchanged.
    const items = [
      plannedItem({
        id: 'pi_empty',
        experienceId: 'exp_1',
        experienceName: "Peter Pan's Flight",
        park: 'Magic Kingdom',
        addedByDisplayName: '',
      }),
    ];
    const completedIds = new Set(['exp_1']);

    const presentation = derivePlannedListPresentation(items, completedIds);

    expect(presentation.doneSection).toHaveLength(1);
    const view = presentation.doneSection[0];
    expect(view?.completionState).toBe('done');
    expect(view?.id).toBe('pi_empty');
    expect(view?.experienceId).toBe('exp_1');
    expect(view?.experienceName).toBe("Peter Pan's Flight");
    expect(view?.park).toBe('Magic Kingdom');
    // Attribution is preserved verbatim (empty), never dropped.
    expect(view?.addedByDisplayName).toBe('');
  });

  it('partitions items into done and not-done preserving input order', () => {
    const items = [
      plannedItem({ id: 'pi_1', experienceId: 'exp_1' }),
      plannedItem({ id: 'pi_2', experienceId: 'exp_2' }),
      plannedItem({ id: 'pi_3', experienceId: 'exp_3' }),
      plannedItem({ id: 'pi_4', experienceId: 'exp_2' }),
    ];
    const completedIds = new Set(['exp_2']);

    const presentation = derivePlannedListPresentation(items, completedIds);

    expect(presentation.doneSection.map((v) => v.id)).toEqual(['pi_2', 'pi_4']);
    expect(presentation.notDoneSection.map((v) => v.id)).toEqual(['pi_1', 'pi_3']);
    expect(presentation.progress).toEqual({ completed: 2, total: 4 });
    // Every input item lands in exactly one section.
    expect(
      presentation.doneSection.length + presentation.notDoneSection.length,
    ).toBe(items.length);
  });

  it('forces every item not_done with completionAvailable=false when the feed is unavailable', () => {
    // R2.7: a null completed set (feed unavailable) must never render done.
    const items = [
      plannedItem({ id: 'pi_1', experienceId: 'exp_1' }),
      plannedItem({ id: 'pi_2', experienceId: 'exp_2' }),
    ];

    const presentation = derivePlannedListPresentation(items, null);

    expect(presentation.completionAvailable).toBe(false);
    expect(presentation.doneSection).toHaveLength(0);
    expect(presentation.notDoneSection).toHaveLength(2);
    expect(
      presentation.notDoneSection.every((v) => v.completionState === 'not_done'),
    ).toBe(true);
    expect(presentation.progress).toEqual({ completed: 0, total: 2 });
  });
});

describe('derivePlannedCounts', () => {
  it('reports 0 of 0 for an empty Planned_List', () => {
    // R5.4: an empty list reports both counts as 0.
    expect(derivePlannedCounts([], new Set())).toEqual({
      plannedTotalCount: 0,
      plannedCompletedCount: 0,
    });
  });

  it('counts each planned item at most once regardless of completion multiplicity', () => {
    // R5.5: an Experience with several completions still counts its item once.
    const items = [
      { experienceId: 'exp_1' },
      { experienceId: 'exp_2' },
      { experienceId: 'exp_3' },
    ];
    // exp_1 appears in the completed set once (a Set is already deduplicated).
    const completedIds = new Set(['exp_1', 'exp_2']);

    expect(derivePlannedCounts(items, completedIds)).toEqual({
      plannedTotalCount: 3,
      plannedCompletedCount: 2,
    });
  });

  it('clamps completed to total when the completed set has unrelated ids', () => {
    // R5.6: completed can never exceed total; ids not in the list do not count.
    const items = [{ experienceId: 'exp_1' }];
    const completedIds = new Set(['exp_1', 'exp_99', 'exp_100']);

    const counts = derivePlannedCounts(items, completedIds);
    expect(counts.plannedCompletedCount).toBeLessThanOrEqual(counts.plannedTotalCount);
    expect(counts).toEqual({ plannedTotalCount: 1, plannedCompletedCount: 1 });
  });
});
