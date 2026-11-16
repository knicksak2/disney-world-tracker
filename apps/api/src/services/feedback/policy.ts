/**
 * Pure rules for in-app feedback (`.kiro/specs/in-app-feedback`): the per-user caps, the retention cutoff and the
 * admin list preview. No I/O.
 *
 * Validates: Requirements 3.1, 3.3, 5.2, 6.1
 */

export interface FeedbackCaps {
  readonly perHour: number;
  readonly perDay: number;
}

export interface RecentCounts {
  /** The caller's submissions created in the trailing 1 hour. */
  readonly lastHour: number;
  /** The caller's submissions created in the trailing 24 hours. */
  readonly lastDay: number;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** `'limit'` iff either window has reached its cap. A caller with `cap - 1` submissions is still `'ok'`. */
export function checkCaps(counts: RecentCounts, caps: FeedbackCaps): 'ok' | 'limit' {
  return counts.lastHour >= caps.perHour || counts.lastDay >= caps.perDay ? 'limit' : 'ok';
}

/**
 * `now - retentionDays * 86_400_000` ms. Resolved submissions whose status changed before this instant are pruned.
 * `retentionDays` must be an integer from 1 to 3650, otherwise this throws a `RangeError`.
 */
export function pruneCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new RangeError(`retentionDays must be an integer from 1 to 3650, got ${String(retentionDays)}`);
  }
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * The first `max` characters of `message` counted by code point (so a surrogate pair is never split), with a trailing
 * ellipsis only when something was cut. `max` must be at least 1.
 */
export function previewMessage(message: string, max: number): string {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError(`max must be an integer >= 1, got ${String(max)}`);
  }
  const points = Array.from(message);
  if (points.length <= max) return message;
  return `${points.slice(0, max).join('')}…`;
}
