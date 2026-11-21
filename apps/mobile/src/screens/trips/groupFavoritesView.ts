/**
 * Pure view helpers for Trip Group Favorites (`GroupFavoritesSection`).
 *
 * Caps the inline preview on the Trip Detail hub so a long shared favorites
 * list does not push Finances, Prep & Memories, and Summary far down the page,
 * and powers the full-list bottom sheet's park-pill and search filtering.
 */

import { PARKS, type GroupFavoriteDTO } from '@dwt/shared';

/**
 * Maximum number of Group Favorites rendered inline on the Trip Detail hub
 * before showing the "See all N favorites" sheet trigger.
 */
export const GROUP_FAVORITES_PREVIEW_LIMIT = 5;

export interface GroupFavoritesPreview {
  readonly visibleItems: readonly GroupFavoriteDTO[];
  readonly hiddenCount: number;
  readonly hasMore: boolean;
}

export interface GroupFavoriteParkCount {
  readonly park: string;
  readonly count: number;
}

const PARK_ORDER = new Map<string, number>(PARKS.map((park, index) => [park, index]));

/**
 * Returns the leading `limit` Group Favorites items for inline hub display,
 * along with the hidden item count and overflow flag.
 */
export function sliceGroupFavoritesPreview(
  items: readonly GroupFavoriteDTO[],
  limit: number = GROUP_FAVORITES_PREVIEW_LIMIT,
): GroupFavoritesPreview {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const visibleItems = items.slice(0, safeLimit);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return {
    visibleItems,
    hiddenCount,
    hasMore: hiddenCount > 0,
  };
}

/**
 * Counts distinct non-null parks present in `items`, ordered canonically by
 * `PARKS` (with any unrecognized park labels sorted alphabetically afterward).
 */
export function deriveGroupFavoriteParks(
  items: readonly GroupFavoriteDTO[],
): readonly GroupFavoriteParkCount[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.park || item.park.trim().length === 0) continue;
    counts.set(item.park, (counts.get(item.park) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([park, count]) => ({ park, count }))
    .sort((a, b) => {
      const idxA = PARK_ORDER.get(a.park);
      const idxB = PARK_ORDER.get(b.park);
      if (idxA !== undefined && idxB !== undefined) return idxA - idxB;
      if (idxA !== undefined) return -1;
      if (idxB !== undefined) return 1;
      return a.park.localeCompare(b.park);
    });
}

/**
 * Filters `items` conjunctively by optional `selectedPark` and case-insensitive
 * `searchQuery` (matching experience name, park, or any favoriting member's
 * display name), preserving the original sequence order.
 */
export function filterGroupFavorites(
  items: readonly GroupFavoriteDTO[],
  selectedPark: string | null,
  searchQuery: string,
): readonly GroupFavoriteDTO[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (selectedPark === null && normalizedQuery.length === 0) {
    return items;
  }

  return items.filter((item) => {
    if (selectedPark !== null && item.park !== selectedPark) {
      return false;
    }
    if (normalizedQuery.length > 0) {
      const nameMatch = item.experienceName.toLowerCase().includes(normalizedQuery);
      const parkMatch = (item.park ?? '').toLowerCase().includes(normalizedQuery);
      const memberMatch = item.favoritingDisplayNames.some((name) =>
        name.toLowerCase().includes(normalizedQuery),
      );
      if (!nameMatch && !parkMatch && !memberMatch) {
        return false;
      }
    }
    return true;
  });
}
