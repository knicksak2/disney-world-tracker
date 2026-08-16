/**
 * Pure, I/O-free derivation core for Planned List Completion Sync.
 *
 * This module is the single canonical `Planned_Completion_Match` surface shared
 * by the mobile client (for the `Planned_List` presentation) and the server
 * (for the `Trip_Summary` planned counts), so the two cannot drift.
 *
 * Every value here is derived at read time from data the Trip_Detail_View
 * already loads — the `PlannedItemDTO[]` from `GET /trips/:id/planned-items`
 * and the `TripFeedItemDTO[]` from `GET /trips/:id/feed`. Nothing is persisted:
 * a `Planned_Item` is `done` iff its referenced `Experience` id is a member of
 * the set of `Experience` ids completed in the same Trip (R2.6, R6.1).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 3.2, 3.3, 3.4,
 * 4.1, 4.2, 4.3, 4.4, 4.6, 5.4, 5.5
 */

import type { PlannedItemDTO, TripFeedItemDTO } from './trips.js';

/** Derived completion state of a Planned_Item; never persisted (R2.6). */
export type PlannedItemCompletionState = 'done' | 'not_done';

/** A Planned_Item annotated with its derived completion state. */
export interface PlannedItemView extends PlannedItemDTO {
  readonly completionState: PlannedItemCompletionState;
}

/** Completed-of-total progress for a Trip's Planned_List (R4). */
export interface PlannedListProgress {
  /** Number of Completed_Planned_Items; `0 <= completed <= total`. */
  readonly completed: number;
  /** Total number of Planned_Items; `>= 0`. */
  readonly total: number;
}

/** The full derived presentation of a Trip's Planned_List. */
export interface PlannedListPresentation {
  /** Completed_Planned_Items, in input order (R3.2). */
  readonly doneSection: readonly PlannedItemView[];
  /** not_done items, in input order (R3.2). */
  readonly notDoneSection: readonly PlannedItemView[];
  /** Completed-of-total progress (R4). */
  readonly progress: PlannedListProgress;
  /**
   * `false` when the completed set could not be determined (feed unavailable):
   * every item is forced `not_done` and the UI shows an "undetermined" hint
   * without ever rendering `done` from unavailable data (R2.7).
   */
  readonly completionAvailable: boolean;
}

/** The feed item type that marks an Experience completed in a Trip. */
const COMPLETION_LOGGED_TYPE = 'completion_logged';

/**
 * Collect the set of Experience ids completed in a Trip from its already-loaded
 * Trip_Activity feed: the `metadata.experienceId` of every `completion_logged`
 * item. Returns `null` when `feed` is `null` (not yet loaded / load failed) so
 * the caller can fail safe (R2.7).
 */
export function completedExperienceIdsFromFeed(
  feed: readonly TripFeedItemDTO[] | null,
): ReadonlySet<string> | null {
  if (feed === null) {
    return null;
  }

  const completed = new Set<string>();
  for (const item of feed) {
    if (item.type !== COMPLETION_LOGGED_TYPE) {
      continue;
    }
    const experienceId = item.metadata['experienceId'];
    if (typeof experienceId === 'string' && experienceId.length > 0) {
      completed.add(experienceId);
    }
  }
  return completed;
}

/**
 * Derive the Planned_List presentation from the two already-loaded collections
 * (R2, R3, R4, R6.3). `completedExperienceIds === null` means the feed is
 * unavailable: every item is `not_done`, `completionAvailable` is `false`
 * (R2.7). Grouping is a total partition — every Planned_Item appears in exactly
 * one of the two sections (R3.2) — and each item keeps its Experience, Park, and
 * adder attribution unchanged (R3.3).
 */
export function derivePlannedListPresentation(
  plannedItems: readonly PlannedItemDTO[],
  completedExperienceIds: ReadonlySet<string> | null,
): PlannedListPresentation {
  const completionAvailable = completedExperienceIds !== null;

  const doneSection: PlannedItemView[] = [];
  const notDoneSection: PlannedItemView[] = [];

  for (const item of plannedItems) {
    const done =
      completedExperienceIds !== null &&
      item.experienceId !== null &&
      completedExperienceIds.has(item.experienceId);

    if (done) {
      doneSection.push({ ...item, completionState: 'done' });
    } else {
      notDoneSection.push({ ...item, completionState: 'not_done' });
    }
  }

  return {
    doneSection,
    notDoneSection,
    progress: {
      completed: doneSection.length,
      total: plannedItems.length,
    },
    completionAvailable,
  };
}

/**
 * Derive the planned-total and planned-completed counts for the Trip_Summary
 * (R5). Shares the set-membership match with the client presentation: a
 * Planned_Item is completed iff its Experience id is in `completedExperienceIds`,
 * counted at most once (R5.5). `0/0` for an empty Planned_List (R5.4). The
 * completed count is clamped `0 <= completed <= total` by construction — it only
 * counts items present in `plannedItems`, so it can never exceed the total.
 */
export function derivePlannedCounts(
  plannedItems: readonly { readonly experienceId: string | null }[],
  completedExperienceIds: ReadonlySet<string>,
): { readonly plannedTotalCount: number; readonly plannedCompletedCount: number } {
  let plannedCompletedCount = 0;
  for (const item of plannedItems) {
    if (item.experienceId !== null && completedExperienceIds.has(item.experienceId)) {
      plannedCompletedCount += 1;
    }
  }

  return {
    plannedTotalCount: plannedItems.length,
    plannedCompletedCount,
  };
}
