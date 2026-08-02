/**
 * Trip_Feed ordering.
 *
 * Pure, deterministic ordering of `Trip_Feed_Item`s for display in the
 * Trip_Detail_View. Items are ordered reverse-chronologically by their
 * creation timestamp, and ties between items sharing an identical timestamp
 * are broken by descending identifier so the resulting order is total and
 * deterministic (R13.3).
 *
 * The comparator reads only `createdAt` and `id`, performs no I/O, and does
 * not mutate its input, which keeps it cheap to property-test across many
 * inputs.
 *
 * Validates: Requirements R13.3
 */

/**
 * Minimal shape required to order a Trip_Feed.
 *
 * `id`        — the Trip_Feed_Item identifier; used as the deterministic
 *               tie-break and assumed unique across the items being ordered.
 * `createdAt` — the creation timestamp as an ISO-8601 string (the
 *               `TripFeedItemDTO.createdAt` shape), compared lexicographically
 *               which matches chronological order for UTC ISO-8601 values.
 */
export interface OrderableFeedItem {
  readonly id: string;
  readonly createdAt: string;
}

/**
 * Compare two feed items for reverse-chronological, deterministic order.
 *
 * Returns a negative number when `a` should sort before `b`, positive when
 * after, and `0` only when both `createdAt` and `id` are equal (which cannot
 * happen for distinct items given unique identifiers). More recent
 * `createdAt` sorts first; for identical timestamps, the larger `id` sorts
 * first.
 */
function compareFeedItems(a: OrderableFeedItem, b: OrderableFeedItem): number {
  if (a.createdAt !== b.createdAt) {
    // Descending by timestamp: the later createdAt comes first.
    return a.createdAt < b.createdAt ? 1 : -1;
  }
  if (a.id !== b.id) {
    // Descending by identifier as the deterministic tie-break.
    return a.id < b.id ? 1 : -1;
  }
  return 0;
}

/**
 * Order Trip_Feed_Items reverse-chronologically with a deterministic
 * tie-break.
 *
 * Returns a new array sorted by `createdAt` descending, breaking ties by `id`
 * descending. The input array is not mutated.
 *
 * @param items The Trip_Feed_Items to order.
 * @returns A new array in display order.
 */
export function orderFeed<T extends OrderableFeedItem>(items: readonly T[]): T[] {
  return [...items].sort(compareFeedItems);
}
