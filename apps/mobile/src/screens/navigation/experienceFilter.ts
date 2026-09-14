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

/** The independent selections of an Experience_Filter, each defaulting to "All" / "" (R14.2, R14.10). */
export interface ExperienceFilterState {
  readonly park: FilterParkSelection;
  readonly category: FilterCategorySelection;
  readonly search?: string | undefined;
}

/** The default Experience_Filter state: all selections "All" and empty search (R14.2, R14.10). */
export const DEFAULT_FILTER: ExperienceFilterState = {
  park: 'All',
  category: 'All',
  search: '',
};

/**
 * Returns true when any non-default selection or search query is active (R14.11).
 */
export function hasActiveFilter(state: ExperienceFilterState): boolean {
  return (
    state.park !== 'All' ||
    state.category !== 'All' ||
    (state.search !== undefined && state.search.trim().length > 0)
  );
}

/**
 * Returns the default, cleared Experience_Filter state (R14.11).
 */
export function clearFilter(): ExperienceFilterState {
  return DEFAULT_FILTER;
}

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
 * Keep every named entry whose Park matches `state.park` (or `'All'`), whose
 * Experience_Category matches `state.category` (or `'All'`), and if a non-empty
 * `state.search` query is provided, whose Experience name, Park, Category, or
 * shared Note contains the query (case-insensitive), in the source order of the
 * originating read; exclude every entry that fails any condition or that has no
 * available Experience name (R14.5, R14.10).
 *
 * With both selections `'All'` and no search query, the result equals the
 * unfiltered named-entry set in source order (R14.6). Because the work is a
 * single synchronous pass over already-loaded entries, the result is produced
 * well within the 300 ms budget and without any read (R14.7).
 */
export function applyExperienceFilter(
  entries: readonly CompletionEntryDTO[],
  state: ExperienceFilterState,
): readonly CompletionEntryDTO[] {
  const query = state.search?.trim().toLowerCase();
  const hasQuery = query !== undefined && query.length > 0;

  return entries.filter((entry) => {
    if (!hasAvailableName(entry)) {
      return false;
    }
    if (state.park !== 'All' && entry.park !== state.park) {
      return false;
    }
    if (state.category !== 'All' && entry.category !== state.category) {
      return false;
    }
    if (hasQuery) {
      const nameMatch = entry.experienceName.toLowerCase().includes(query);
      const parkMatch = entry.park !== null && entry.park.toLowerCase().includes(query);
      const categoryRawMatch = entry.category.toLowerCase().includes(query);
      const categoryReadableMatch = entry.category.replace(/_/g, ' ').toLowerCase().includes(query);
      const noteMatch =
        entry.sharedNote !== null && entry.sharedNote.toLowerCase().includes(query);

      if (!nameMatch && !parkMatch && !categoryRawMatch && !categoryReadableMatch && !noteMatch) {
        return false;
      }
    }
    return true;
  });
}
