/**
 * The ordered purge stages (account-deletion R8.4, R9.1). `users.purge_stage` stores the number of
 * COMPLETED stages (0..4); a rewind therefore sets it back to 0.
 */

export const PURGE_STAGES = ['photos', 'trips', 'anonymize', 'personal_data', 'finalize'] as const;

export type PurgeStage = (typeof PURGE_STAGES)[number];

/**
 * The stage to run after `completed` stages have finished: `nextStage(0)` is `'photos'`,
 * `nextStage(4)` is `'finalize'`. `finalize` has no successor, so any value outside the integers
 * 0..4 returns null.
 */
export function nextStage(completed: number): PurgeStage | null {
  if (!Number.isInteger(completed) || completed < 0 || completed >= PURGE_STAGES.length) {
    return null;
  }
  return PURGE_STAGES[completed]!;
}
