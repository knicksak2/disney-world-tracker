import {
  PACKING_CATEGORIES,
  PACKING_LIST_MAX_ITEMS,
  type PackingCategory,
  type StarterPackingEntry,
} from '@dwt/shared';

export const normalizeName = (s: string) => s.trim();
export const nameKey = (s: string) => s.trim().toLowerCase(); // R11.10 dedupe key

/**
 * Starter entries not already present (case-insensitive after trim).
 * Pure, order-preserving.
 */
export function selectStarterToAdd(
  existingNames: readonly string[],
  starter: readonly StarterPackingEntry[]
): StarterPackingEntry[] {
  const existingSet = new Set(existingNames.map(nameKey));
  return starter.filter(entry => !existingSet.has(nameKey(entry.name)));
}

export function wouldExceedCap(
  existingCount: number,
  addCount: number,
  cap = PACKING_LIST_MAX_ITEMS
): boolean {
  return existingCount + addCount > cap;
}

/**
 * Sorts packing items by category index in PACKING_CATEGORIES, then createdAt asc, then id asc.
 */
export function sortPackingItems<T extends { category: PackingCategory; createdAt: string; id: string }>(
  items: readonly T[]
): T[] {
  return [...items].sort((a, b) => {
    const catDiff =
      PACKING_CATEGORIES.indexOf(a.category) - PACKING_CATEGORIES.indexOf(b.category);
    if (catDiff !== 0) return catDiff;
    const dateDiff = a.createdAt.localeCompare(b.createdAt);
    if (dateDiff !== 0) return dateDiff;
    return a.id.localeCompare(b.id);
  });
}

export function summarizePacking(
  items: readonly { packed: boolean }[]
): { totalCount: number; packedCount: number } {
  return {
    totalCount: items.length,
    packedCount: items.filter(i => i.packed).length,
  };
}

/**
 * R11.9: A non-member assignee is projected as unassigned without changing the stored row.
 */
export function projectAssignee(row: {
  assigneeId: string | null;
  assigneeName: string | null;
  assigneeIsMember: boolean;
}): { assigneeId: string | null; assigneeDisplayName: string | null } {
  if (!row.assigneeIsMember || row.assigneeId === null) {
    return { assigneeId: null, assigneeDisplayName: null };
  }
  return { assigneeId: row.assigneeId, assigneeDisplayName: row.assigneeName };
}

/**
 * R11.6: Same state ⇒ unchanged; true ⇒ (userId, nowIso); false ⇒ nulls.
 */
export function nextPackedState(
  prev: { packed: boolean; packedBy: string | null; packedAt: string | null },
  packed: boolean,
  userId: string,
  nowIso: string
): { packed: boolean; packedBy: string | null; packedAt: string | null } {
  if (prev.packed === packed) {
    return prev;
  }
  if (packed) {
    return { packed: true, packedBy: userId, packedAt: nowIso };
  }
  return { packed: false, packedBy: null, packedAt: null };
}
