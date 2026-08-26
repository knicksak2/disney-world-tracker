import type { ExperienceCategory, Park, PlannedItemType, WalkingSpeed, WaitSnapshot } from '@dwt/shared';
import { travelFromPrev, type Coordinates } from './travel.js';
import {
  wdwIsoAtMinutes as toISOString,
  wdwMinutesFromMidnight as parseMinutesFromMidnightET,
} from '../trips/wdwClock.js';

export interface OptimizeInputItem {
  readonly id: string;
  readonly experienceId: string | null;
  readonly park: Park | null;
  readonly category?: ExperienceCategory | null;
  readonly subType?: string | null;
  readonly catalogDurationMinutes?: number | null;
  readonly coords: Coordinates | null;
  readonly plannedTime: string | null;
  readonly isFixed: boolean;
  readonly isLightningLane: boolean;
  readonly useSingleRider: boolean;
  readonly priority: number;
  readonly itemType: PlannedItemType;
  readonly durationMinutes: number | null;
  readonly windowStartMinutes?: number | null;
  readonly windowEndMinutes?: number | null;
  readonly mealPeriod?: string | null;
  /**
   * Whether this Experience operates during the park's Early Entry window
   * (sourced from `experiences.operates_during_early_entry`; R3.12). `true`
   * → may be scheduled from early-entry open; `false`/`null`/absent (unknown)
   * → clamped to official open on an early-entry day.
   */
  readonly operatesDuringEarlyEntry?: boolean | null;
  /**
   * Whether this Experience operates during Extended Evening hours (R3.13).
   * When the day uses Extended Evening, only `true` rides may be scheduled into
   * the +120-min evening extension; others (incl. unknown) close at normal hours.
   */
  readonly operatesDuringExtendedEvening?: boolean | null;
  /**
   * Whether this Experience operates during a Special Ticketed / After-Hours
   * event (R3.13). When the day has an after-hours ticket, only `true` rides may
   * be scheduled into the +180-min extension; others (incl. unknown) do not.
   */
  readonly operatesDuringTicketedEvent?: boolean | null;
}

export interface OptimizeInput {
  readonly items: readonly OptimizeInputItem[];
  readonly date: string;
  readonly walkingSpeed: WalkingSpeed;
  readonly earlyEntryEligible: boolean;
  readonly useExtendedEvening?: boolean;
  readonly hasAfterHoursTicket?: boolean;
  readonly startingPark?: Park;
  readonly startHour?: number;
  readonly endHour?: number;
  readonly snapshots: Record<string, WaitSnapshot>;
  readonly seed?: number;
}

export interface OptimizedItem {
  readonly plannedItemId: string;
  readonly suggestedArrival: string;
  readonly predictedWaitMinutes: number;
  readonly scheduledShowtime?: string | null;
  readonly travelFromPrev: {
    readonly kind: 'walk' | 'park_hop';
    readonly minutes: number;
  } | null;
}

export interface OptimizeResult {
  readonly items: readonly OptimizedItem[];
  readonly totalWaitMinutes: number;
  readonly totalWalkMinutes: number;
  readonly unfittedItemIds: readonly string[];
  readonly warnings: readonly string[];
}

const DEFAULT_START_HOUR = 9;
const DEFAULT_END_HOUR = 21;
const EARLY_ENTRY_MINUTES = 30;
const LL_WAIT_MINS = 10;
export const DEFAULT_RIDE_DUR = 15;
export const DEFAULT_BREAK_DUR = 60;
export const DEFAULT_SHOW_DURATION_MIN = 30;
export const DEFAULT_WALKTHROUGH_DUR = 25;
export const DEFAULT_PLAY_AREA_DUR = 30;
export const DEFAULT_GAME_DUR = 20;
export const SAME_KIND_ADJACENCY_PENALTY = 500;
const ROPE_DROP_WINDOW_MINUTES = 30;
const ROPE_DROP_WALKON_MINS = 5;

export function resolveDefaultDuration(item: OptimizeInputItem): number {
  // 1. User override always wins
  if (item.durationMinutes != null) return item.durationMinutes;

  // 2. Break items default to 60 minutes
  if (item.itemType === 'break') return DEFAULT_BREAK_DUR;

  // 3. Dining items derive default from sub_type
  if (item.category === 'Restaurant') {
    const sub = (item.subType ?? '').toLowerCase();
    if (sub.includes('quick service') || sub.includes('counter')) return 30;
    if (sub.includes('signature') || sub.includes('fine')) return 90;
    return 60; // Table Service / default restaurant
  }

  // 4. Show and Parade items derive from catalog duration if present, else default show duration
  if (item.category === 'Show' || item.category === 'Parade') {
    return item.catalogDurationMinutes ?? DEFAULT_SHOW_DURATION_MIN;
  }

  // 5. New categories (R4.1–R4.5)
  if (item.category === 'Walkthrough') {
    return item.catalogDurationMinutes ?? DEFAULT_WALKTHROUGH_DUR;
  }
  if (item.category === 'PlayArea') {
    return item.catalogDurationMinutes ?? DEFAULT_PLAY_AREA_DUR;
  }
  if (item.category === 'Game') {
    return item.catalogDurationMinutes ?? DEFAULT_GAME_DUR;
  }

  // 6. Non-ride catalog categories (Resort, Recreation, Spa, Tour, Event, Other)
  if (
    item.category === 'Resort' ||
    item.category === 'Recreation' ||
    item.category === 'Spa' ||
    item.category === 'Tour' ||
    item.category === 'Event' ||
    item.category === 'Other'
  ) {
    return item.catalogDurationMinutes ?? 60;
  }

  // 7. Rides/attractions/Character_Meet default to 15 minutes (covers ride length + load/unload)
  return DEFAULT_RIDE_DUR;
}

/**
 * Does this snapshot carry a usable posted wait? Pure; the single place the
 * optimizer decides whether an item has a queue (R3.1).
 *
 * TRUE when the snapshot exists and carries a numeric, non-negative standby
 * wait (or the single-rider wait when the item requests it). Virtual-queue and
 * Lightning Lane items remain Standby_Bearing so their existing substitutions
 * (LL_WAIT_MINS, VQ handling) continue to apply.
 */
export function isStandbyBearing(
  snapshot: WaitSnapshot | undefined,
  useSingleRider: boolean,
): boolean {
  if (!snapshot) {
    return false;
  }
  if (snapshot.isVirtualQueue) {
    return true;
  }
  if (snapshot.waits && snapshot.waits.length > 0) {
    return snapshot.waits.some((w) => {
      if (useSingleRider && w.singleRiderWaitMinutes !== undefined) {
        return (
          typeof w.singleRiderWaitMinutes === 'number' &&
          w.singleRiderWaitMinutes >= 0
        );
      }
      return (
        typeof w.predictedWaitMinutes === 'number' &&
        w.predictedWaitMinutes >= 0
      );
    });
  }
  return false;
}

export function ropeDropAdjust(rawWait: number, arrivalMins: number, dayStartMins: number): number {
  const minutesIntoWindow = arrivalMins - dayStartMins;
  if (minutesIntoWindow < 0 || minutesIntoWindow >= ROPE_DROP_WINDOW_MINUTES) {
    return rawWait;
  }
  if (rawWait <= ROPE_DROP_WALKON_MINS) {
    return rawWait;
  }
  const frac = minutesIntoWindow / ROPE_DROP_WINDOW_MINUTES;
  return Math.round(ROPE_DROP_WALKON_MINS + (rawWait - ROPE_DROP_WALKON_MINS) * frac);
}

// WDW-local time conversions come from the shared `wdwClock` (see the
// "Reuse these" steering note). Aliased to the names this module already uses
// so the call sites below read unchanged.

export const SHOW_ARRIVAL_BUFFER_MIN = 15;
export const SHOW_MISS_PENALTY_PER_MIN = 1000;

export interface WaitAndDurationResult {
  readonly wait: number;
  readonly dur: number;
  readonly isVQ: boolean;
  readonly isShow: boolean;
  readonly isSingleRider: boolean;
  readonly slotArrival?: number;
  readonly scheduledShowtimeMinutes?: number;
  readonly missMinutes?: number;
  readonly showtimesUnavailable?: boolean;
}

function getWaitAndDuration(
  item: OptimizeInputItem,
  arrivalMins: number,
  date: string,
  snapshots: Record<string, WaitSnapshot>,
  dayStartMins: number,
): WaitAndDurationResult {
  const dur = resolveDefaultDuration(item);

  // Break items have ZERO queue wait (R3.4). Cost is duration only.
  if (item.itemType === 'break') {
    return { wait: 0, dur, isVQ: false, isShow: false, isSingleRider: false };
  }

  const snap = item.experienceId ? snapshots[item.experienceId] : undefined;

  // Shows and Parades follow showtime path when showtimes exist (R3.5)
  if (item.category === 'Show' || item.category === 'Parade') {
    if (snap?.showtimes && snap.showtimes.length > 0) {
      let nextShow = Infinity;
      let lastDoors = -Infinity;
      for (const st of snap.showtimes) {
        const showMins = parseMinutesFromMidnightET(date, st);
        const doorsMins = showMins - SHOW_ARRIVAL_BUFFER_MIN;
        if (doorsMins > lastDoors) {
          lastDoors = doorsMins;
        }
        if (doorsMins >= arrivalMins && showMins < nextShow) {
          nextShow = showMins;
        }
      }
      if (nextShow !== Infinity) {
        const slotArrival = nextShow - SHOW_ARRIVAL_BUFFER_MIN;
        return {
          wait: SHOW_ARRIVAL_BUFFER_MIN,
          dur,
          isVQ: false,
          isShow: true,
          isSingleRider: false,
          slotArrival,
          scheduledShowtimeMinutes: nextShow,
        };
      } else {
        const missMinutes = Math.max(0, arrivalMins - lastDoors);
        return {
          wait: SHOW_ARRIVAL_BUFFER_MIN,
          dur,
          isVQ: false,
          isShow: true,
          isSingleRider: false,
          missMinutes,
          showtimesUnavailable: true,
        };
      }
    }

    // R3.6: Show/Parade without showtimes but Standby_Bearing falls through to standby path
    if (!isStandbyBearing(snap, item.useSingleRider)) {
      return {
        wait: 0,
        dur,
        isVQ: false,
        isShow: true,
        isSingleRider: false,
        showtimesUnavailable: true,
      };
    }
  }

  // Missing snapshot entirely: keep existing default wait ONLY for Ride/Character_Meet (R3.7, R3.8)
  if (!snap) {
    const isRideLike = item.category === 'Ride' || item.category === 'Character_Meet';
    if (isRideLike) {
      if (item.isLightningLane) {
        return { wait: LL_WAIT_MINS, dur, isVQ: false, isShow: false, isSingleRider: false };
      }
      return { wait: 30, dur, isVQ: false, isShow: false, isSingleRider: false };
    }
    return { wait: 0, dur, isVQ: false, isShow: false, isSingleRider: false };
  }

  // Standby Bearing gate (R3.1, R3.2, R3.3):
  if (!isStandbyBearing(snap, item.useSingleRider)) {
    return { wait: 0, dur, isVQ: false, isShow: false, isSingleRider: false };
  }

  // Standby path:
  if (item.isLightningLane) {
    return { wait: LL_WAIT_MINS, dur, isVQ: false, isShow: false, isSingleRider: false };
  }

  if (snap.isVirtualQueue) {
    return { wait: 0, dur, isVQ: true, isShow: false, isSingleRider: false };
  }

  const hour = Math.floor(arrivalMins / 60);
  const hourEntry = snap.waits.find((w: { hour: number }) => w.hour === hour) || snap.waits[snap.waits.length - 1];

  let wait = 30;
  let isSingleRider = false;
  if (hourEntry) {
    if (item.useSingleRider && hourEntry.singleRiderWaitMinutes !== undefined) {
      wait = hourEntry.singleRiderWaitMinutes;
      isSingleRider = true;
    } else {
      wait = hourEntry.predictedWaitMinutes;
    }
  }

  wait = ropeDropAdjust(wait, arrivalMins, dayStartMins);

  return { wait, dur, isVQ: false, isShow: false, isSingleRider };
}

function simulate(
  sequence: readonly OptimizeInputItem[],
  input: OptimizeInput,
): { cost: number; result: OptimizeResult | null } {
  const {
    date,
    snapshots,
    walkingSpeed = 'moderate',
    earlyEntryEligible,
    useExtendedEvening,
    hasAfterHoursTicket,
    startingPark,
    startHour,
    endHour,
  } = input;

  let effStartHour = startHour ?? DEFAULT_START_HOUR;
  let effEndHour = endHour ?? DEFAULT_END_HOUR;

  if (hasAfterHoursTicket && (startHour === undefined || startHour === DEFAULT_START_HOUR)) {
    effStartHour = 16;
  }

  const startMins = earlyEntryEligible ? effStartHour * 60 - EARLY_ENTRY_MINUTES : effStartHour * 60;
  const officialOpenMins = earlyEntryEligible ? startMins + EARLY_ENTRY_MINUTES : startMins;
  const baseCloseMins = effEndHour * 60;

  let currentMins = startMins;
  let prevItem: OptimizeInputItem | null = null;
  let prevDowntimeKind: 'dining' | 'break' | null = null;

  let totalWait = 0;
  let totalWalk = 0;
  let penalty = 0;
  const resultItems: OptimizedItem[] = [];
  const warnings = new Set<string>();

  if (startingPark && sequence.length > 0 && sequence[0]!.park !== startingPark) {
    penalty += 50000;
  }

  for (const item of sequence) {
    // Travel calculation keyed on linkage (experienceId != null, A1, R3.4)
    const travel =
      prevItem != null && prevItem.experienceId != null && item.experienceId != null
        ? travelFromPrev(prevItem.coords, prevItem.park, item.coords, item.park, walkingSpeed)
        : null;
    const travelMins = travel ? travel.minutes : 0;

    let arrival = currentMins + travelMins;
    let idleGap = 0;

    // Same-kind downtime adjacency penalty (A3, R3.18)
    const currentDowntimeKind: 'dining' | 'break' | null =
      item.itemType === 'break' ? 'break' : item.category === 'Restaurant' ? 'dining' : null;

    if (
      prevDowntimeKind != null &&
      currentDowntimeKind != null &&
      prevDowntimeKind === currentDowntimeKind &&
      !(prevItem?.isFixed && item.isFixed)
    ) {
      penalty += SAME_KIND_ADJACENCY_PENALTY;
      warnings.add(`adjacent_${currentDowntimeKind}:${item.id}`);
    }

    prevDowntimeKind = currentDowntimeKind;

    if (item.isFixed && item.plannedTime) {
      const fixedArrival = parseMinutesFromMidnightET(date, item.plannedTime);
      if (fixedArrival < arrival) {
        penalty += (arrival - fixedArrival) * 10000;
        warnings.add('infeasible_fixed_gap');
      } else if (fixedArrival > arrival) {
        idleGap = fixedArrival - arrival;
      }
      arrival = Math.max(arrival, fixedArrival);
    } else if (item.isLightningLane && item.plannedTime) {
      const llStart = parseMinutesFromMidnightET(date, item.plannedTime);
      const llMinArrival = llStart - 5; // 5 min early grace period
      const llMaxArrival = llStart + 75; // 60 min return window + 15 min late grace period

      if (arrival < llMinArrival) {
        // Arrived before pass valid window: wait until start of window
        idleGap = llMinArrival - arrival;
        arrival = llMinArrival;
      } else if (arrival > llMaxArrival) {
        // Arrived after late grace period expired
        penalty += (arrival - llMaxArrival) * 10000;
        warnings.add('expired_lightning_lane');
      }
    } else if (item.windowStartMinutes != null && item.windowEndMinutes != null) {
      if (arrival < item.windowStartMinutes) {
        idleGap = item.windowStartMinutes - arrival;
        arrival = item.windowStartMinutes;
      } else if (arrival > item.windowEndMinutes) {
        const lateMinutes = arrival - item.windowEndMinutes;
        penalty += lateMinutes * 100;
        warnings.add(`outside_window:${item.id}`);
      }
    }

    // Early-entry availability (R3.12): a flexible standby item that does NOT
    // operate during early entry cannot be ridden before official open — clamp
    // its arrival up. The pre-open idle is charged like other idle so the
    // optimizer prefers to fill the early-entry window with eligible rides.
    const itemEarlyEntry = earlyEntryEligible && item.operatesDuringEarlyEntry === true;
    const hasWindow = item.windowStartMinutes != null && item.windowEndMinutes != null;
    if (earlyEntryEligible && !itemEarlyEntry && !item.isFixed && !item.isLightningLane && !hasWindow) {
      if (arrival < officialOpenMins) {
        idleGap += officialOpenMins - arrival;
        arrival = officialOpenMins;
      }
    }

    // Anchor the rope-drop ramp (R3.11) to when THIS item can first be ridden:
    // early-entry open for early-entry rides on an early-entry day, else official
    // open — so a ride that opens at park open ramps from official open (R3.12).
    const itemOpenMins = itemEarlyEntry ? startMins : officialOpenMins;

    const {
      wait,
      dur,
      isVQ,
      isShow,
      isSingleRider,
      slotArrival,
      scheduledShowtimeMinutes,
      missMinutes,
      showtimesUnavailable,
    } = getWaitAndDuration(item, arrival, date, snapshots, itemOpenMins);

    if (slotArrival != null && slotArrival > arrival) {
      idleGap += slotArrival - arrival;
      arrival = slotArrival;
    }

    if (missMinutes != null && missMinutes > 0) {
      penalty += missMinutes * SHOW_MISS_PENALTY_PER_MIN;
      warnings.add(`show_missed:${item.id}`);
    } else if (showtimesUnavailable) {
      penalty += 10000;
      warnings.add(`showtimes_unavailable:${item.id}`);
    }

    const completion = arrival + wait + dur;

    // Per-item close: a ride may run into the Extended Evening / after-hours
    // extension only if it operates during that window; otherwise it closes at
    // base hours (R3.13). Unknown flags are treated as not-operating.
    const itemEndMins =
      baseCloseMins +
      (useExtendedEvening && item.operatesDuringExtendedEvening === true ? 120 : 0) +
      (hasAfterHoursTicket && item.operatesDuringTicketedEvent === true ? 180 : 0);

    if (completion > itemEndMins) {
      return { cost: Infinity, result: null };
    }

    resultItems.push({
      plannedItemId: item.id,
      suggestedArrival: toISOString(date, arrival),
      predictedWaitMinutes: wait,
      scheduledShowtime:
        scheduledShowtimeMinutes != null ? toISOString(date, scheduledShowtimeMinutes) : null,
      travelFromPrev: travel ? { kind: travel.kind, minutes: travel.minutes } : null,
    });

    totalWait += wait + idleGap;
    totalWalk += travelMins;

    if (isVQ) warnings.add(`virtual_queue:${item.id}`);
    if (isShow) {
      warnings.add(`show:${item.id}`);
      if (item.experienceId && snapshots[item.experienceId]?.showtimesAreTypical) {
        warnings.add(`typical_showtimes:${item.id}`);
      }
    }
    if (isSingleRider) warnings.add(`single_rider:${item.id}`);
    if (item.isLightningLane) warnings.add(`lightning_lane:${item.id}`);

    currentMins = completion;
    if (item.experienceId != null) {
      prevItem = item;
    }
  }

  return {
    cost: totalWait + totalWalk + penalty,
    result: {
      items: resultItems,
      totalWaitMinutes: totalWait,
      totalWalkMinutes: totalWalk,
      unfittedItemIds: [],
      warnings: Array.from(warnings),
    },
  };
}

function shuffle<T>(array: T[], prng: () => number): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [array[i] as T, array[j] as T] = [array[j] as T, array[i] as T];
  }
}

function localSearch(
  sequence: OptimizeInputItem[],
  input: OptimizeInput,
): { sequence: OptimizeInputItem[]; cost: number; result: OptimizeResult | null } {
  let currentSeq = [...sequence];
  let { cost: currentCost, result: currentResult } = simulate(currentSeq, input);

  let improved = true;
  let iterations = 0;

  while (improved && iterations < 50) {
    improved = false;
    iterations++;

    // Or-opt
    for (let i = 0; i < currentSeq.length; i++) {
      if (currentSeq[i]!.isFixed) continue;

      for (let j = 0; j <= currentSeq.length; j++) {
        if (i === j || i === j - 1) continue;

        const testSeq = [...currentSeq];
        const [moved] = testSeq.splice(i, 1);
        const insertPos = j > i ? j - 1 : j;
        testSeq.splice(insertPos, 0, moved!);

        const { cost, result } = simulate(testSeq, input);
        if (cost < currentCost) {
          currentCost = cost;
          currentSeq = testSeq;
          currentResult = result;
          improved = true;
        }
      }
    }

    // 2-opt
    for (let i = 0; i < currentSeq.length - 1; i++) {
      for (let j = i + 2; j <= currentSeq.length; j++) {
        const sub = currentSeq.slice(i, j);
        const fixedInSub = sub.filter((item) => item.isFixed);
        if (fixedInSub.length > 1) continue;

        const testSeq = [...currentSeq.slice(0, i), ...sub.reverse(), ...currentSeq.slice(j)];

        const { cost, result } = simulate(testSeq, input);
        if (cost < currentCost) {
          currentCost = cost;
          currentSeq = testSeq;
          currentResult = result;
          improved = true;
        }
      }
    }
  }

  return { sequence: currentSeq, cost: currentCost, result: currentResult };
}

export function optimize(input: OptimizeInput): OptimizeResult {
  if (input.items.length === 0) {
    return {
      items: [],
      totalWaitMinutes: 0,
      totalWalkMinutes: 0,
      unfittedItemIds: [],
      warnings: [],
    };
  }

  let randomState = Math.abs(input.seed ?? 42);
  function randomFloat() {
    randomState = (randomState * 9301 + 49297) % 233280;
    if (randomState < 0) randomState += 233280;
    return randomState / 233280;
  }

  const fixedItems = input.items
    .filter((i) => i.isFixed)
    .sort((a, b) => {
      const aTime = a.plannedTime ? parseMinutesFromMidnightET(input.date, a.plannedTime) : 0;
      const bTime = b.plannedTime ? parseMinutesFromMidnightET(input.date, b.plannedTime) : 0;
      return aTime - bTime;
    });

  const flexibleItems = input.items.filter((i) => !i.isFixed).sort((a, b) => a.priority - b.priority);

  let bestCost = Infinity;
  let bestResult: OptimizeResult | null = null;
  let bestUnfitted: string[] = [];

  function buildSequence(flexOrder: OptimizeInputItem[]) {
    let sequence = [...fixedItems];
    const unfitted: string[] = [];

    for (const flex of flexOrder) {
      let bCost = Infinity;
      let bSeq: OptimizeInputItem[] | null = null;

      for (let i = 0; i <= sequence.length; i++) {
        const testSeq = [...sequence];
        testSeq.splice(i, 0, flex);
        
        const { cost } = simulate(testSeq, input);
        if (cost < bCost) {
          bCost = cost;
          bSeq = testSeq;
        }
      }

      if (bSeq) {
        sequence = bSeq;
      } else {
        unfitted.push(flex.id);
      }
    }

    return { sequence, unfitted };
  }

  const base = buildSequence(flexibleItems);
  if (base.sequence.length > 0) {
    const { cost, result } = localSearch(base.sequence, input);
    bestCost = cost;
    if (result) {
      bestResult = { ...result, unfittedItemIds: base.unfitted };
      bestUnfitted = base.unfitted;
    }
  }

  for (let r = 0; r < 5; r++) {
    const p1 = flexibleItems.filter((i) => i.priority === 1);
    const p2 = flexibleItems.filter((i) => i.priority === 2);
    const p3 = flexibleItems.filter((i) => i.priority === 3);

    shuffle(p1, randomFloat);
    shuffle(p2, randomFloat);
    shuffle(p3, randomFloat);

    const shuffledFlex = [...p1, ...p2, ...p3];
    const { sequence: startSeq, unfitted } = buildSequence(shuffledFlex);

    if (startSeq.length > 0) {
      const { cost, result } = localSearch(startSeq, input);
      if (cost < bestCost && result) {
        bestCost = cost;
        bestResult = { ...result, unfittedItemIds: unfitted };
        bestUnfitted = unfitted;
      }
    }
  }

  if (!bestResult) {
    const unfitted = input.items.map((i) => i.id);
    return {
      items: [],
      totalWaitMinutes: 0,
      totalWalkMinutes: 0,
      unfittedItemIds: unfitted,
      warnings: unfitted.length > 0 ? ['over_constrained'] : [],
    };
  }

  const hasDroppedItems = bestUnfitted.length > 0;
  if (hasDroppedItems && !bestResult.warnings.includes('over_constrained')) {
    bestResult = {
      ...bestResult,
      warnings: [...bestResult.warnings, 'over_constrained'],
    };
  }

  return bestResult;
}
