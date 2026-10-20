import type { PhotoStatus } from '@dwt/shared';

export const POLL_INTERVAL_FAST_MS = 3000;
export const POLL_INTERVAL_SLOW_MS = 15000;
export const POLL_FAST_THRESHOLD_MS = 60000;
export const MAX_IDS_PER_POLL_REQUEST = 10;

/**
 * Returns true if a status is considered final and should stop being polled.
 */
export function isFinalPhotoStatus(status: PhotoStatus): boolean {
  return status === 'approved' || status === 'rejected' || status === 'deleted';
}

/**
 * Cadence: 3s for the first 60s, then 15s afterwards.
 */
export function getPollInterval(elapsedMs: number): number {
  return elapsedMs < POLL_FAST_THRESHOLD_MS ? POLL_INTERVAL_FAST_MS : POLL_INTERVAL_SLOW_MS;
}

/**
 * Filters a list of photo IDs to only those that are still pending (not final).
 */
export function filterPendingPhotoIds(
  ids: readonly string[],
  finalIds: ReadonlySet<string>
): readonly string[] {
  return ids.filter((id) => !finalIds.has(id));
}

/**
 * Selects the single chunk of up to 10 IDs for a given tick.
 * Returns null / empty if no IDs are pending.
 */
export function getBatchForTick(
  pendingIds: readonly string[],
  tickIndex: number = 0
): readonly string[] {
  if (pendingIds.length === 0) {
    return [];
  }

  const numChunks = Math.ceil(pendingIds.length / MAX_IDS_PER_POLL_REQUEST);
  const chunkIndex = numChunks > 0 ? tickIndex % numChunks : 0;
  const start = chunkIndex * MAX_IDS_PER_POLL_REQUEST;
  const end = start + MAX_IDS_PER_POLL_REQUEST;

  return pendingIds.slice(start, end);
}
