/**
 * Reservation and planned-restaurant suggestions (Requirements 5.1 to 5.3, 5.7 to 5.10; design.md "Reservation meal
 * period" and "Planned-restaurant import"; Properties 20 and 38).
 */

import { DINING_MEAL_PERIODS, type DiningMealPeriod, type DiningSuggestionDTO } from '@dwt/shared';

import { wdwMinutesFromMidnight } from '../../trips/wdwClock.js';
import { compareEntries } from './scenario.js';

const LUNCH_FROM_MINUTES = 11 * 60;
const DINNER_FROM_MINUTES = 16 * 60;

function isMealPeriod(value: unknown): value is DiningMealPeriod {
  return typeof value === 'string' && (DINING_MEAL_PERIODS as readonly string[]).includes(value);
}

/**
 * The stored period when it is breakfast, lunch or dinner; otherwise derived from the time in WDW local time: before
 * 11:00 breakfast, 11:00 to before 16:00 lunch, from 16:00 dinner. Null when there is no usable time (a `snack` or
 * NULL period without a time, or an unparseable instant).
 */
export function mealPeriodOfReservation(input: {
  readonly mealPeriod: string | null;
  readonly plannedTimeIso: string | null;
  readonly date: string;
}): DiningMealPeriod | null {
  if (isMealPeriod(input.mealPeriod)) return input.mealPeriod;
  if (input.plannedTimeIso === null || !Number.isFinite(Date.parse(input.plannedTimeIso))) return null;
  const minutes = wdwMinutesFromMidnight(input.date, input.plannedTimeIso);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < LUNCH_FROM_MINUTES) return 'breakfast';
  return minutes < DINNER_FROM_MINUTES ? 'lunch' : 'dinner';
}

/** One `planned_items` row joined to its Experience, as `repo.loadPlannedDiningItems` returns it. */
export interface PlannedDiningItemRow {
  readonly id: string;
  readonly itemType: string;
  readonly experienceId: string | null;
  readonly experienceName: string | null;
  readonly experienceCategory: string | null;
  readonly experienceActive: boolean | null;
  readonly plannedDate: string | null;
  /** ISO instant (`planned_time` is TIMESTAMPTZ). */
  readonly plannedTime: string | null;
  readonly mealPeriod: string | null;
  readonly partySize: number | null;
  readonly reservationKind: string | null;
}

/**
 * A dining reservation, or a plain planned item at an active Restaurant (Requirements 5.1, 5.8). The repo's statement
 * applies the same filter; repeating it here keeps the rule in one testable place and safe for any caller.
 */
export function isSuggestible(row: PlannedDiningItemRow): boolean {
  if (row.itemType !== 'experience' || row.plannedDate === null || row.experienceId === null) return false;
  if (row.reservationKind === 'dining') return true;
  return row.reservationKind === null && row.experienceCategory === 'Restaurant' && row.experienceActive === true;
}

export interface SuggestionContext {
  /** The Trip's stored entries' slots and links. */
  readonly entries: readonly { readonly date: string; readonly mealPeriod: DiningMealPeriod; readonly plannedItemId: string | null }[];
  /** Plan_Eligible_Persons in the Party (Requirement 5.3). */
  readonly eligibleCount: number;
}

export interface SuggestionResult {
  /** By (date, meal period); within a slot the import's winner first (reservation, then earlier time, then lower id). */
  readonly suggestions: DiningSuggestionDTO[];
  /** Suggestible rows that have no meal period and no time (Requirement 5.9). */
  readonly suggestionsNeedingMealPeriod: number;
}

type Candidate = DiningSuggestionDTO & { readonly plannedTime: string | null };

/** Within one slot: a reservation before a plain item, then the earlier time (untimed last), then the lower id. */
export function compareSuggestionPrecedence(
  a: Pick<Candidate, 'source' | 'plannedTime' | 'plannedItemId'>,
  b: Pick<Candidate, 'source' | 'plannedTime' | 'plannedItemId'>,
): number {
  if (a.source !== b.source) return a.source === 'reservation' ? -1 : 1;
  const ta = a.plannedTime === null ? Number.POSITIVE_INFINITY : Date.parse(a.plannedTime);
  const tb = b.plannedTime === null ? Number.POSITIVE_INFINITY : Date.parse(b.plannedTime);
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.plannedItemId < b.plannedItemId ? -1 : a.plannedItemId > b.plannedItemId ? 1 : 0;
}

export function suggestFromPlannedItems(rows: readonly PlannedDiningItemRow[], ctx: SuggestionContext): SuggestionResult {
  const linked = new Set(ctx.entries.map((e) => e.plannedItemId).filter((id): id is string => id !== null));
  const occupied = new Set(ctx.entries.map((e) => `${e.date}:${e.mealPeriod}`));
  const candidates: Candidate[] = [];
  let suggestionsNeedingMealPeriod = 0;
  for (const row of rows) {
    if (!isSuggestible(row) || linked.has(row.id)) continue;
    const date = row.plannedDate!;
    const mealPeriod = mealPeriodOfReservation({ mealPeriod: row.mealPeriod, plannedTimeIso: row.plannedTime, date });
    if (mealPeriod === null) {
      suggestionsNeedingMealPeriod += 1;
      continue;
    }
    const source = row.reservationKind === 'dining' ? 'reservation' : 'planned_item';
    candidates.push({
      plannedItemId: row.id,
      experienceId: row.experienceId!,
      experienceName: row.experienceName ?? '',
      date,
      mealPeriod,
      source,
      partySizeMismatch: source === 'reservation' && row.partySize !== null && row.partySize < ctx.eligibleCount,
      alreadyHasEntry: occupied.has(`${date}:${mealPeriod}`),
      plannedTime: row.plannedTime,
    });
  }
  candidates.sort((a, b) => compareEntries(a, b) || compareSuggestionPrecedence(a, b));
  return {
    suggestions: candidates.map(({ plannedTime: _plannedTime, ...suggestion }) => suggestion),
    suggestionsNeedingMealPeriod,
  };
}
