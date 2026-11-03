/**
 * Pure cacheState resolution for ticket price quotes (round 5 M3, M4).
 *
 * Deterministic, total function with zero I/O or clock reads.
 *
 * Validates: Requirements 14.1, 14.2
 */

export interface CacheStateInput {
  readonly enabled: boolean;
  readonly now: Date;
  readonly control: {
    readonly blockedUntil: Date | null;
    readonly inProgressSince: Date | null;
    readonly lastAttemptAt: Date | null;
  };
  readonly pairPermitted: boolean;
  readonly set: { readonly asOf: Date | null; readonly lastError: string | null } | null;
  readonly cfg: { readonly attemptIntervalHours: number; readonly claimTimeoutMinutes: number };
}

export type TicketCacheState = 'disabled' | 'warming' | 'failed' | 'ready';

/**
 * Derives the quote-level cacheState in strictly specified rule order (first match wins):
 * 1. !enabled || (control.blockedUntil && control.blockedUntil > now) -> 'disabled'
 * 2. !pairPermitted || set?.lastError === 'not_offered' || set?.asOf != null -> 'ready'
 * 3. set?.lastError != null -> 'failed'
 * 4. inFlight || cooled -> 'warming'
 * 5. otherwise -> 'failed'
 */
export function ticketCacheState(i: CacheStateInput): TicketCacheState {
  // Rule 1: Kill switch or active block
  if (!i.enabled || (i.control.blockedUntil !== null && i.control.blockedUntil.getTime() > i.now.getTime())) {
    return 'disabled';
  }

  // Rule 2: Non-permitted pair, definitively not offered, or cached rows present
  if (!i.pairPermitted || i.set?.lastError === 'not_offered' || (i.set !== null && i.set.asOf !== null)) {
    return 'ready';
  }

  // Rule 3: Previous attempt failed with a real error (and no cached rows)
  if (i.set !== null && i.set.lastError !== null) {
    return 'failed';
  }

  // Rule 4: Run is in flight or cooldown elapsed (ready to be fetched)
  const inFlight =
    i.control.inProgressSince !== null &&
    i.now.getTime() - i.control.inProgressSince.getTime() < i.cfg.claimTimeoutMinutes * 60 * 1000;
  const cooled =
    i.control.lastAttemptAt === null ||
    i.now.getTime() - i.control.lastAttemptAt.getTime() >= i.cfg.attemptIntervalHours * 3600 * 1000;

  if (inFlight || cooled) {
    return 'warming';
  }

  // Rule 5: Cooldown active and no run in flight -> failed
  return 'failed';
}
