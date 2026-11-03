/**
 * Pure refresh planning for Disney ticket pricing calendar.
 *
 * Decides whether a background ticket prices refresh should run, and whether
 * it should be a probe-only run or a full fetch.
 *
 * Validates: Requirements 12.2, 12.3, 12.4, 13.1, 13.4, 13.6
 */

import { daysBetween, wdwDateOf } from './dates.js';

export interface RefreshDecisionInput {
  readonly enabled: boolean;
  readonly now: Date;
  readonly today: string;
  readonly control: {
    readonly lastAttemptAt: Date | null;
    readonly lastProbeAt: Date | null;
    readonly blockedUntil: Date | null;
    readonly inProgressSince: Date | null;
    /** maxPricingCalendarDate last seen by a probe (review F25); null before the first probe. */
    readonly observedHorizonDate: string | null;
  };
  readonly sets: readonly {
    readonly discountGroup: string;
    readonly numDays: number;
    readonly asOf: Date | null;
    readonly horizonDate: string | null;
    readonly lastError: string | null;
  }[];
  readonly demand: {
    readonly groups: readonly string[];
    readonly numDays: readonly number[];
    readonly maxStartDate: string | null;
  };
  /** Permitted (group -> numDays[]) pairs from config: std-gst => 1..10; fl-resident => TICKET_PRICES_FL_RESIDENT_NUMDAYS; a group not in TICKET_PRICES_GROUPS => []. */
  readonly allowedNumDaysByGroup: Readonly<Record<string, readonly number[]>>;
  readonly cfg: {
    readonly staleAfterDays: number;
    readonly attemptIntervalHours: number;
    readonly probeIntervalHours: number;
    readonly claimTimeoutMinutes: 15;
  };
}

export type RefreshDecision =
  | { readonly action: 'none'; readonly reason: 'disabled' | 'blocked' | 'in_flight' | 'fresh' | 'attempt_cooldown' | 'probe_cooldown' }
  | { readonly action: 'probe_only' | 'full'; readonly neededNumDays: number[] };

export function decideRefresh(i: RefreshDecisionInput): RefreshDecision {
  // 1. Kill switch
  if (!i.enabled) {
    return { action: 'none', reason: 'disabled' };
  }

  // 2. Blocked
  if (i.control.blockedUntil !== null && i.control.blockedUntil > i.now) {
    return { action: 'none', reason: 'blocked' };
  }

  // 3. In flight
  if (
    i.control.inProgressSince !== null &&
    i.now.getTime() - i.control.inProgressSince.getTime() < i.cfg.claimTimeoutMinutes * 60_000
  ) {
    return { action: 'none', reason: 'in_flight' };
  }

  // 4. Demanded pairs: filter to permitted and not not_offered
  interface ActivePair {
    readonly group: string;
    readonly numDays: number;
  }

  const activePairs: ActivePair[] = [];
  const neededNumDaysSet = new Set<number>();

  for (const group of i.demand.groups) {
    const allowed = i.allowedNumDaysByGroup[group] ?? [];
    for (const numDays of i.demand.numDays) {
      if (!allowed.includes(numDays)) {
        continue;
      }
      const set = i.sets.find((s) => s.discountGroup === group && s.numDays === numDays);
      if (set?.lastError === 'not_offered') {
        continue;
      }
      activePairs.push({ group, numDays });
      neededNumDaysSet.add(numDays);
    }
  }

  // Maintain demand.numDays ordering for neededNumDays
  const neededNumDays = i.demand.numDays.filter((n) => neededNumDaysSet.has(n));

  // 5. Stale check
  let isStale = false;
  for (const pair of activePairs) {
    const set = i.sets.find((s) => s.discountGroup === pair.group && s.numDays === pair.numDays);
    if (!set || set.asOf === null) {
      isStale = true;
      break;
    }
    const daysOld = daysBetween(wdwDateOf(set.asOf), i.today);
    if (daysOld >= i.cfg.staleAfterDays) {
      isStale = true;
      break;
    }
    if (
      set.horizonDate !== null &&
      i.control.observedHorizonDate !== null &&
      set.horizonDate < i.control.observedHorizonDate
    ) {
      isStale = true;
      break;
    }
  }

  if (isStale) {
    const attemptCooldownMs = i.cfg.attemptIntervalHours * 3_600_000;
    const attemptCooled =
      i.control.lastAttemptAt === null ||
      i.now.getTime() - i.control.lastAttemptAt.getTime() >= attemptCooldownMs;

    if (attemptCooled) {
      return { action: 'full', neededNumDays };
    }
    return { action: 'none', reason: 'attempt_cooldown' };
  }

  // 6. Beyond check
  let isBeyond = false;
  if (i.demand.maxStartDate !== null) {
    const knownHorizons = activePairs
      .map((p) => i.sets.find((s) => s.discountGroup === p.group && s.numDays === p.numDays)?.horizonDate)
      .filter((h): h is string => h != null);

    if (knownHorizons.length === 0) {
      isBeyond = true;
    } else {
      const minHorizon = knownHorizons.reduce((min, curr) => (curr < min ? curr : min));
      if (i.demand.maxStartDate > minHorizon) {
        isBeyond = true;
      }
    }
  }

  if (isBeyond) {
    const probeCooldownMs = i.cfg.probeIntervalHours * 3_600_000;
    const probeCooled =
      i.control.lastProbeAt === null ||
      i.now.getTime() - i.control.lastProbeAt.getTime() >= probeCooldownMs;

    if (probeCooled) {
      return { action: 'probe_only', neededNumDays };
    }
    return { action: 'none', reason: 'probe_cooldown' };
  }

  // 7. Fresh
  return { action: 'none', reason: 'fresh' };
}

