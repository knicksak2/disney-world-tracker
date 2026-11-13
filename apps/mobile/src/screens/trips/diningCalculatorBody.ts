/**
 * The standalone Dining Plan calculator's request (dining-plan-calculator Requirements 20.2 to 20.4). Pure: the screen
 * keeps its form in local state and this turns it into the `POST /dining-plan/calculate` body. Nothing here is stored
 * anywhere; the body is rebuilt from the form on every edit.
 */

import {
  DINING_PLAN_MAX_NIGHTS,
  DINING_PLAN_PARTY_MAX,
  diningPlanSettingsSchema,
  type DiningCalculateBody,
  type DiningEntryDTO,
  type DiningPartyPersonDTO,
  type DiningPlanSettings,
} from '@dwt/shared';

import { stayDates } from './diningPlanView';

export interface CalculatorCounts {
  /** Aged 10 and over. */
  readonly adults: number;
  /** Aged 3 to 9. */
  readonly children: number;
  readonly under3: number;
}

export interface CalculatorForm {
  readonly counts: CalculatorCounts;
  readonly passHolder: boolean;
  /** `YYYY-MM-DD`, or '' while not chosen. */
  readonly checkIn: string;
  readonly checkOut: string;
  readonly settings: DiningPlanSettings;
  readonly entries: readonly DiningEntryDTO[];
}

/** The settings a new calculator starts from: the schema's own defaults. */
export const CALCULATOR_DEFAULT_SETTINGS: DiningPlanSettings = diningPlanSettingsSchema.parse({});

export const CALCULATOR_DEFAULT_COUNTS: CalculatorCounts = { adults: 2, children: 0, under3: 0 };

/** The most of one kind the steppers allow, keeping the whole party within `DINING_PLAN_PARTY_MAX`. */
export function countMax(counts: CalculatorCounts, kind: keyof CalculatorCounts): number {
  return DINING_PLAN_PARTY_MAX - (counts.adults + counts.children + counts.under3 - counts[kind]);
}

/**
 * The party: "Adult 1", "Child 1", "Under 3 (1)" with stable guest-style keys, so a meal's excluded diners and the
 * alcohol list survive a count change for the people who remain. A pass holder is marked on the first adult; one
 * pass holder is enough for the party-wide pass discount (Requirement 3.8).
 */
export function standaloneParty(counts: CalculatorCounts, passHolder: boolean): DiningPartyPersonDTO[] {
  const out: DiningPartyPersonDTO[] = [];
  for (let i = 1; i <= counts.adults; i++) {
    out.push({ key: `g:a${i}`, label: `Adult ${i}`, ageBracket: 'adult', passType: passHolder && i === 1 ? 'annual_pass' : 'none' });
  }
  for (let i = 1; i <= counts.children; i++) out.push({ key: `g:c${i}`, label: `Child ${i}`, ageBracket: 'child', passType: 'none' });
  for (let i = 1; i <= counts.under3; i++) out.push({ key: `g:u${i}`, label: `Under 3 (${i})`, ageBracket: 'under3', passType: 'none' });
  return out;
}

export type DatesProblem = 'missing' | 'order' | 'too_long' | null;

/** Why the dates cannot be calculated yet, or null when they can. */
export function datesProblem(checkIn: string, checkOut: string): DatesProblem {
  if (checkIn === '' || checkOut === '') return 'missing';
  if (checkOut < checkIn) return 'order';
  return stayDates(checkIn, checkOut).length - 1 > DINING_PLAN_MAX_NIGHTS ? 'too_long' : null;
}

export function datesProblemText(problem: Exclude<DatesProblem, null>): string {
  switch (problem) {
    case 'missing':
      return 'Choose your check-in and check-out dates to see the comparison.';
    case 'order':
      return 'Check-out must not be before check-in.';
    default:
      return `The calculator handles stays of up to ${DINING_PLAN_MAX_NIGHTS} nights.`;
  }
}

/**
 * The request body, or null while the dates cannot be calculated or the party is empty. Only meals inside the stay are sent (the grid shows
 * only those dates), and person keys that are no longer in the party are dropped from each meal and from the
 * alcohol list.
 */
export function buildCalculateBody(form: CalculatorForm): DiningCalculateBody | null {
  if (datesProblem(form.checkIn, form.checkOut) !== null) return null;
  const party = standaloneParty(form.counts, form.passHolder);
  if (party.length === 0) return null;
  const keys = new Set(party.map((p) => p.key));
  const adults = new Set(party.filter((p) => p.ageBracket === 'adult').map((p) => p.key));
  return {
    party,
    stay: { checkIn: form.checkIn, checkOut: form.checkOut },
    settings: { ...form.settings, stay: null, alcoholDrinkerKeys: form.settings.alcoholDrinkerKeys.filter((k) => adults.has(k)) },
    entries: form.entries
      .filter((e) => e.date >= form.checkIn && e.date <= form.checkOut)
      .map((e) => ({
        date: e.date,
        mealPeriod: e.mealPeriod,
        kind: e.kind,
        experienceId: e.experienceId,
        placeholderKind: e.placeholderKind,
        excludedKeys: e.excludedKeys.filter((k) => keys.has(k)),
      })),
  };
}
