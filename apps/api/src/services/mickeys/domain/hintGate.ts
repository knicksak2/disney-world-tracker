import type { MickeyHintLevel } from '@dwt/shared';

/**
 * Pure hint gating for spoiler protection (Property 1).
 *
 * List views never include clue2 or reveal. Detail views show clue2 only when
 * hintLevel >= 2 or found is true; and reveal only when hintLevel >= 3 or found is true.
 */
export function visibleLayers(
  m: { clue2: string; reveal: string },
  p: { hintLevel: number; found: boolean } | null,
): { clue2?: string; reveal?: string } {
  const level = p?.hintLevel ?? 1;
  const found = p?.found ?? false;
  return {
    ...(level >= 2 || found ? { clue2: m.clue2 } : {}),
    ...(level >= 3 || found ? { reveal: m.reveal } : {}),
  };
}

/**
 * Computes monotonic next hint level (Property 2, model part).
 * hint level never decreases.
 */
export function nextHintLevel(current: number, requested: number): MickeyHintLevel {
  const maxLevel = Math.max(current, requested, 1);
  return (maxLevel >= 3 ? 3 : maxLevel === 2 ? 2 : 1) as MickeyHintLevel;
}
