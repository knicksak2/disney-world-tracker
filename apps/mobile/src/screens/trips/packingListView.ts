/**
 * Pure presentation, grouping, filtering, and validation helpers for Trip Packing List (Task 11.3).
 *
 * Validates: Requirements 11.5, 13.2, 13.3, 13.5, 13.6, 13.7, 13.12
 */

import {
  PACKING_CATEGORIES,
  packingItemCreateSchema,
  type PackingCategory,
  type PackingItemCreateInput,
  type PackingListDTO,
  type TripRole,
} from '@dwt/shared';

export type PackingFilter = 'all' | 'mine' | 'unpacked';

export interface PackingCategoryGroup<T> {
  readonly category: PackingCategory;
  readonly items: readonly T[];
}

/**
 * Groups packing items by category in canonical vocabulary order, omitting empty groups (R11.5, R13.2).
 * Items within a category are ordered by creation time, oldest first.
 */
export function groupByCategory<T extends { category: PackingCategory; createdAt: string }>(
  items: readonly T[],
): PackingCategoryGroup<T>[] {
  const groups: PackingCategoryGroup<T>[] = [];
  for (const cat of PACKING_CATEGORIES) {
    const matching = items
      .filter((it) => it.category === cat)
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (matching.length > 0) {
      groups.push({ category: cat, items: matching });
    }
  }
  return groups;
}

/**
 * Filters items by All, Mine (assigned to viewer), or Unpacked (R13.5).
 */
export function applyFilter<T extends { packed: boolean; assigneeId: string | null }>(
  items: readonly T[],
  filter: PackingFilter,
  viewerId: string,
): readonly T[] {
  switch (filter) {
    case 'all':
      return items;
    case 'mine':
      return items.filter((it) => it.assigneeId === viewerId);
    case 'unpacked':
      return items.filter((it) => !it.packed);
  }
}

/**
 * Optimistically toggles an item's packed state and recalculates packedCount (R13.3).
 */
export function togglePackedOptimistic(
  list: PackingListDTO,
  itemId: string,
  packed: boolean,
): PackingListDTO {
  const items = list.items.map((it) => {
    if (it.id === itemId) {
      return { ...it, packed };
    }
    return it;
  });
  const packedCount = items.filter((it) => it.packed).length;
  return {
    items,
    totalCount: list.totalCount,
    packedCount,
  };
}

export type PackingFormValidationResult =
  | { readonly ok: true; readonly data: PackingItemCreateInput }
  | { readonly ok: false; readonly field: string; readonly message: string };

/**
 * Validates packing add/edit form using the shared packingItemCreateSchema (R13.12).
 */
export function validatePackingForm(values: unknown): PackingFormValidationResult {
  const parsed = packingItemCreateSchema.safeParse(values);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  const issue = parsed.error.issues[0];
  const field = (issue?.path[0] as string | undefined) ?? 'name';
  const message = issue?.message ?? 'trip_validation_failed';
  return { ok: false, field, message };
}

/**
 * Permission rule for modifying or removing a packing item (R12.4, R13.7).
 * True iff viewer is an Organizer or the adder of the item.
 */
export function canEditItem(
  role: TripRole,
  viewerId: string,
  item: { addedById: string },
): boolean {
  return role === 'organizer' || viewerId === item.addedById;
}
