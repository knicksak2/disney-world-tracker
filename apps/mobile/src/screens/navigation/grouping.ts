/**
 * Pure grouping folds for the Friend_Profile_View and Own_Stats_View.
 *
 * Framework-free folds over already-loaded Completion_Entries. These functions
 * hold the grouping-integrity guarantees (R6): each named entry lands in
 * exactly one group, unnamed entries are dropped everywhere, group order is
 * the canonical catalog order, and source order is preserved within each
 * group. Percentages and counts are computed by the existing Stats_Service and
 * are not derived here.
 *
 * Validates: Requirements 3.1, 3.4, 3.6, 4.1, 4.3, 4.5, 4.6, 6.1, 6.2, 6.3, 6.4
 */

import type { AreaType, CompletionEntryDTO, ExperienceCategory, Park } from '@dwt/shared';

/**
 * Entries that have an available (non-empty, non-whitespace) Experience name,
 * in the source order of the originating read (R3.6, R4.6, R5.3, R13.3).
 */
export function namedEntries(
  entries: readonly CompletionEntryDTO[],
): readonly CompletionEntryDTO[] {
  return entries.filter((entry) => entry.experienceName.trim().length > 0);
}

export interface ParkGroup {
  readonly park: Park;
  readonly entries: readonly CompletionEntryDTO[]; // source order preserved (R3.4)
}

/**
 * One ParkGroup per catalog Park, in catalog order. Each named entry lands in
 * exactly the group whose Park equals the entry's Park; entries of other Parks
 * are excluded; unnamed entries are dropped (R3.4, R3.6, R6.1). Order within a
 * group is the source order from the originating read.
 */
export function groupByPark(
  entries: readonly CompletionEntryDTO[],
  parks: readonly Park[],
): readonly ParkGroup[] {
  const named = namedEntries(entries);
  return parks.map((park) => ({
    park,
    entries: named.filter((entry) => entry.park === park),
  }));
}

export interface AreaTypeGroup {
  readonly areaType: AreaType;
  readonly entries: readonly CompletionEntryDTO[]; // source order preserved (R5.2)
}

/**
 * One AreaTypeGroup per Area_Type, in the canonical AREA_TYPES order. Each named
 * entry lands in exactly the group whose Area_Type equals the entry's
 * areaType; unnamed entries are dropped (R5.2). Order within a group is the
 * source order from the originating read. Mirrors groupByPark; Park-less
 * entries that are excluded from every Park group are partitioned here by their
 * Area_Type instead.
 */
export function groupByAreaType(
  entries: readonly CompletionEntryDTO[],
  areaTypes: readonly AreaType[],
): readonly AreaTypeGroup[] {
  const named = namedEntries(entries);
  return areaTypes.map((areaType) => ({
    areaType,
    entries: named.filter((entry) => entry.areaType === areaType),
  }));
}

export interface CategoryGroup {
  readonly category: ExperienceCategory;
  readonly entries: readonly CompletionEntryDTO[]; // source order preserved (R4.5)
}

/**
 * One CategoryGroup per Experience_Category, in enumerated order. Same
 * partition guarantees as groupByPark (R4.3, R4.6, R6.2).
 */
export function groupByCategory(
  entries: readonly CompletionEntryDTO[],
  categories: readonly ExperienceCategory[],
): readonly CategoryGroup[] {
  const named = namedEntries(entries);
  return categories.map((category) => ({
    category,
    entries: named.filter((entry) => entry.category === category),
  }));
}
