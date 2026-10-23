/**
 * Account lifecycle state machine: pure functions, no I/O (account-deletion design,
 * "Pure modules, exact contracts" and "The state machine").
 *
 * Validates: Requirements 3.1, 4.1, 4.4, 8.3, 8.5, 8.12, 17.2
 */

export type DeletionState = 'active' | 'pending_deletion' | 'purging' | 'tombstone';

/** A claim older than this is stale and may be re-claimed (R8.5). Passed to the claim SQL as a parameter. */
export const PURGE_STALE_CLAIM_MS = 15 * 60 * 1000;

/** `purge_attempts` at which the runner logs one `error` for an account that keeps failing (R8.12). */
export const PURGE_ATTEMPTS_ALERT = 5;

const DAY_MS = 86_400_000;

/**
 * Allowed edges only: active->pending_deletion, pending_deletion->active,
 * pending_deletion->purging, purging->purging (re-claim or release). Everything
 * else, including every edge into or out of `tombstone`, is false.
 */
export function canTransition(from: DeletionState, to: DeletionState): boolean {
  switch (from) {
    case 'active':
      return to === 'pending_deletion';
    case 'pending_deletion':
      return to === 'active' || to === 'purging';
    case 'purging':
      return to === 'purging';
    default:
      return false;
  }
}

/** requestedAt + graceDays * 86_400_000 ms (UTC). `graceDays` must be an integer 1..365 or this throws RangeError. */
export function computeScheduledPurgeAt(requestedAt: Date, graceDays: number): Date {
  if (!Number.isInteger(graceDays) || graceDays < 1 || graceDays > 365) {
    throw new RangeError(`graceDays must be an integer between 1 and 365, got ${String(graceDays)}`);
  }
  return new Date(requestedAt.getTime() + graceDays * DAY_MS);
}

/** True iff the account is `pending_deletion`, has a schedule, and `now < scheduledPurgeAt` (strict). */
export function isRestorable(
  s: { state: DeletionState; scheduledPurgeAt: Date | null },
  now: Date,
): boolean {
  return (
    s.state === 'pending_deletion' &&
    s.scheduledPurgeAt !== null &&
    now.getTime() < s.scheduledPurgeAt.getTime()
  );
}

/**
 * Login / forgot-password / reset eligibility: `active` for a live account, `restorable` for a
 * pending one inside its grace period, `ineligible` for everything else (the caller then behaves
 * exactly as for an unknown email).
 */
export function classifyLoginEligibility(
  s: { state: DeletionState; scheduledPurgeAt: Date | null },
  now: Date,
): 'active' | 'restorable' | 'ineligible' {
  if (s.state === 'active') return 'active';
  return isRestorable(s, now) ? 'restorable' : 'ineligible';
}

/**
 * True iff the purge claim may take the account: a pending account whose schedule has arrived, or a
 * `purging` account whose claim is released or at least `PURGE_STALE_CLAIM_MS` old. Mirrors the
 * claim SQL's WHERE exactly.
 */
export function isClaimable(
  s: { state: DeletionState; scheduledPurgeAt: Date | null; claimedAt: Date | null },
  now: Date,
): boolean {
  if (s.state === 'pending_deletion') {
    return s.scheduledPurgeAt !== null && s.scheduledPurgeAt.getTime() <= now.getTime();
  }
  if (s.state === 'purging') {
    return s.claimedAt === null || s.claimedAt.getTime() <= now.getTime() - PURGE_STALE_CLAIM_MS;
  }
  return false;
}

/**
 * Claim order: `purge_attempts` ascending, then `scheduledPurgeAt` ascending, then id ascending
 * (plain string compare). The pure twin of the claim SQL's ORDER BY, so a failing account is
 * retried behind every account with fewer failures and never starves the queue (Property 31).
 */
export function orderForClaim(
  a: { attempts: number; scheduledPurgeAt: Date; id: string },
  b: { attempts: number; scheduledPurgeAt: Date; id: string },
): number {
  if (a.attempts !== b.attempts) return a.attempts - b.attempts;
  const at = a.scheduledPurgeAt.getTime();
  const bt = b.scheduledPurgeAt.getTime();
  if (at !== bt) return at - bt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
