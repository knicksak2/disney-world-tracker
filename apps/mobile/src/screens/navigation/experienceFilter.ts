/**
 * Pure Experience_Filter logic for the Friend_Profile_View's Experiences mode
 * and the Own_Stats_View's Own_Experiences mode.
 *
 * The Experience_Filter is a presentation-only control composed of an
 * independent Park selection and an independent Experience_Category selection,
 * each defaulting to "All". It narrows which already-loaded Completion_Entries
 * the App displays without re-fetching from any service.
 *
 * This module is framework-free so the filter guarantees are unit- and
 * property-testable without rendering.
 *
 * Validates: Requirements 14.2, 14.3, 14.5, 14.6, 14.7
 */

import type { CompletionEntryDTO, ExperienceCategory, Park } from '@dwt/shared';

/** Current Park value of an Experience_Filter: "All" or one catalog Park (R14.3). */
export type FilterParkSelection = Park | 'All';

/**
 * Current Experience_Category value of an Experience_Filter: "All" or one of
 * the Experience_Categories (R14.3).
 */
export type FilterCategorySelection = ExperienceCategory | 'All';

/** The two independent selections of an Experience_Filter, each defaulting to "All" (R14.2). */
export interface ExperienceFilterState {
  readonly park: FilterParkSelection;
  readonly category: FilterCategorySelection;
}

/** The default Experience_Filter state: both selections "All" (R14.2). */
export const DEFAULT_FILTER: ExperienceFilterState = { park: 'All', category: 'All' };

/**
 * An Experience name is "available" when it is present and not blank — i.e. it
 * contains at least one non-whitespace character. This matches the named-entry
 * rule used by the grouping folds so the filtered list and the grouped views
 * agree on which entries are displayable.
 */
function hasAvailableName(entry: CompletionEntryDTO): boolean {
  return entry.experienceName.trim().length > 0;
}

/**
 * Keep every named entry whose Park matches `state.park` (or `'All'`) AND whose
 * Experience_Category matches `state.category` (or `'All'`), in the source order
 * of the originating read; exclude every entry that fails either selection or
 * that has no available Experience name (R14.5).
 *
 * With both selections `'All'` the result equals the unfiltered named-entry set
 * in source order (R14.6). Because the work is a single synchronous pass over
 * already-loaded entries, the result is produced well within the 300 ms budget
 * and without any read (R14.7).
 */
export function applyExperienceFilter(
  entries: readonly CompletionEntryDTO[],
  state: ExperienceFilterState,
): readonly CompletionEntryDTO[] {
  return entries.filter(
    (entry) =>
      hasAvailableName(entry) &&
      (state.park === 'All' || entry.park === state.park) &&
      (state.category === 'All' || entry.category === state.category),
  );
}
