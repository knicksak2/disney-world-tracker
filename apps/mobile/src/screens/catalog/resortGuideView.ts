import { DEFAULT_RESORT_SECTION_LIMIT } from '@dwt/shared';

export type DiningCategoryFilter = 'all' | 'table' | 'quick' | 'lounge';

export interface ComputeVisibleItemsOptions<T> {
  readonly items: readonly T[];
  readonly limit?: number | undefined;
  readonly expanded: boolean;
  readonly isFiltered?: boolean | undefined;
}

export interface VisibleItemsResult<T> {
  readonly visibleItems: readonly T[];
  readonly totalCount: number;
  readonly hiddenCount: number;
  readonly isTruncated: boolean;
  readonly canExpand: boolean;
}

/**
 * Computes visible items for progressive disclosure cards (e.g. ResortGuideSection dining/recreation).
 *
 * Invariant (Property 1):
 * - When expanded is false and isFiltered is false, returns at most min(N, limit) items.
 * - When expanded is true or isFiltered is true, returns all N items (no truncation).
 * - Reported hiddenCount equals max(0, N - limit) when expanded is false and isFiltered is false, 0 otherwise.
 */
export function computeVisibleItems<T>(options: ComputeVisibleItemsOptions<T>): VisibleItemsResult<T> {
  const { items, limit = DEFAULT_RESORT_SECTION_LIMIT, expanded, isFiltered = false } = options;
  const totalCount = items.length;

  if (expanded || isFiltered) {
    return {
      visibleItems: items,
      totalCount,
      hiddenCount: 0,
      isTruncated: false,
      canExpand: totalCount > limit,
    };
  }

  const effectiveLimit = Math.max(0, limit);
  const isTruncated = totalCount > effectiveLimit;
  const visibleItems = isTruncated ? items.slice(0, effectiveLimit) : items;
  const hiddenCount = Math.max(0, totalCount - effectiveLimit);

  return {
    visibleItems,
    totalCount,
    hiddenCount,
    isTruncated,
    canExpand: isTruncated,
  };
}

/**
 * Classifies a dining venue into 'lounge', 'quick', or 'table' following Requirement 5.4a:
 *
 * Case-insensitive keyword rule checked in order (first match wins):
 * 1. Contains "lounge", "bar", or "tiki" -> lounge
 * 2. Contains "quick", "counter", or "snack" -> quick
 * 3. Otherwise (including "signature", "character", "buffet", "table service", "fine dining") -> table
 */
export function classifyDiningCategory(venue: {
  readonly tag?: string | null | undefined;
  readonly tags?: readonly string[] | null | undefined;
  readonly category?: string | null | undefined;
}): 'table' | 'quick' | 'lounge' {
  const parts: string[] = [];
  if (venue.tag) parts.push(venue.tag);
  if (venue.tags && Array.isArray(venue.tags)) parts.push(...venue.tags);
  if (venue.category) parts.push(venue.category);

  const rawText = parts.join(' ').toLowerCase();

  if (rawText.includes('lounge') || rawText.includes('bar') || rawText.includes('tiki')) {
    return 'lounge';
  }
  if (rawText.includes('quick') || rawText.includes('counter') || rawText.includes('snack')) {
    return 'quick';
  }
  return 'table';
}

/**
 * Filters dining venues by category.
 *
 * Invariant (Property 2):
 * - Soundness: Every returned venue matches the selected category filter.
 * - Completeness: No venue in the input matching the category is omitted.
 */
export function filterDiningByCategory<
  T extends {
    readonly tag?: string | null | undefined;
    readonly tags?: readonly string[] | null | undefined;
    readonly category?: string | null | undefined;
  },
>(venues: readonly T[], filter: DiningCategoryFilter): readonly T[] {
  if (filter === 'all') {
    return venues;
  }
  return venues.filter((venue) => classifyDiningCategory(venue) === filter);
}

/**
 * Extracts frequency-ranked unique dynamic quick chips from a list of experiences.
 *
 * Invariant (Property 3):
 * - Relevance: Every returned chip label corresponds to at least one experience in the active list.
 * - Uniqueness: No duplicate chip labels.
 * - Determinism: Ordered by occurrence frequency descending, with alphabetical label as tie-breaker.
 */
export function extractDynamicQuickChips(
  experiences: readonly {
    readonly category?: string | null | undefined;
    readonly tags?: readonly string[] | null | undefined;
    readonly tag?: string | null | undefined;
    readonly thrill?: boolean | null | undefined;
    readonly heightMin?: number | null | undefined;
  }[],
  activeTab: string,
): readonly string[] {
  if (!experiences || experiences.length === 0) {
    return [];
  }

  const counts = new Map<string, number>();

  const tabLower = activeTab.toLowerCase();

  for (const exp of experiences) {
    const candidateChips = new Set<string>();

    if (exp.thrill) {
      candidateChips.add('Thrill Ride');
    }
    if (typeof exp.heightMin === 'number' && exp.heightMin >= 40) {
      candidateChips.add(`Height ${exp.heightMin}"+`);
    }

    if (exp.tag && exp.tag.trim()) {
      candidateChips.add(exp.tag.trim());
    }

    if (exp.tags && Array.isArray(exp.tags)) {
      for (const t of exp.tags) {
        if (t && t.trim()) {
          candidateChips.add(t.trim());
        }
      }
    }

    if (tabLower === 'dining') {
      const diningCat = classifyDiningCategory({
        tag: exp.tag,
        tags: exp.tags,
        category: exp.category,
      });
      if (diningCat === 'table') candidateChips.add('Table Service');
      if (diningCat === 'quick') candidateChips.add('Quick Service');
      if (diningCat === 'lounge') candidateChips.add('Lounges & Bars');
    }

    for (const chip of candidateChips) {
      counts.set(chip, (counts.get(chip) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => {
      // Primary: Frequency descending
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      // Secondary tie-breaker: alphabetical ascending
      return a[0].localeCompare(b[0]);
    })
    .map(([label]) => label);
}
