/**
 * Pure formatting for the Dining Plan screens (dining-plan-calculator Requirements 13.8, 14.5, 15.3, 15.4, 15.6, 19.7,
 * 19.9, 21.2, 22.1). Every figure comes from the server's result and is only formatted here: nothing is added up, so
 * the screen shows exactly what the engine computed (a scenario whose terms do not sum is shown unchanged). The one
 * operation on a figure is taking the absolute value of a net saving to word it ("about $12 cheaper").
 */

import {
  DINING_MEAL_PERIODS,
  formatCentsAsDollarString,
  type DiningBudgetExportLineDTO,
  type DiningBudgetExportResultDTO,
  type DiningCreditSummaryDTO,
  type DiningExportGroup,
  type DiningPlanSettings,
  type DiningSuggestionDTO,
  type DiningEntryDTO,
  type DiningMealLineDTO,
  type DiningMealPeriod,
  type DiningOrderStyle,
  type DiningPlanCode,
  type DiningPlanResultDTO,
  type DiningPlanStayResultDTO,
  type DiningStayOptionCode,
  type DiningScenarioCode,
  type DiningScenarioResultDTO,
  type DiningUnavailableReason,
  type DiningUncoveredReason,
} from '@dwt/shared';

export const money = formatCentsAsDollarString;

/** Ionicons names; every icon is paired with text (Requirement 22.1). */
export type ViewIcon =
  | 'checkmark-circle-outline'
  | 'swap-horizontal-outline'
  | 'close-circle-outline'
  | 'remove-circle-outline'
  | 'ellipse-outline'
  | 'contrast-outline'
  | 'alert-circle-outline'
  | 'help-circle-outline'
  | 'cash-outline';

const MEAL_PERIOD_LABEL: Readonly<Record<DiningMealPeriod, string>> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function mealPeriodLabel(period: DiningMealPeriod): string {
  return MEAL_PERIOD_LABEL[period];
}

/** "Tue, Mar 2" for a `YYYY-MM-DD` calendar date (read in UTC so the device zone never shifts it). */
export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]!.slice(0, 3)}, ${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCDate()}`;
}

/** "Tuesday, March 2" */
export function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Every calendar date from check-in to check-out, inclusive (the meal grid's rows). */
export function stayDates(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = new Date(`${checkIn}T00:00:00Z`); d.toISOString().slice(0, 10) <= checkOut && out.length < 62; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const UNAVAILABLE_TEXT: Readonly<Record<DiningUnavailableReason, string>> = {
  not_disney_resort: 'Only guests staying at a Disney Resort hotel can buy a dining plan.',
  no_nights: 'A dining plan needs at least one night at the hotel.',
  stay_too_long: 'The calculator handles stays of up to 30 nights.',
  no_eligible_guests: 'Nobody in the party is aged 3 or over.',
  no_price_for_dates: 'There is no price for this plan on some of your dates.',
};

export function unavailableReasonText(reason: DiningUnavailableReason | null): string {
  return reason === null ? 'Not available for this stay.' : UNAVAILABLE_TEXT[reason];
}

function scenarioOf(result: DiningPlanResultDTO, code: DiningScenarioCode): DiningScenarioResultDTO | undefined {
  return result.scenarios.find((s) => s.code === code);
}

/** The best plan option the verdict was judged on: the uniform `bestPlan`, or the per-hotel `mix`. */
export function bestScenario(result: DiningPlanResultDTO): DiningScenarioResultDTO | null {
  if (result.bestPlan !== null) return scenarioOf(result, result.bestPlan) ?? null;
  return scenarioOf(result, 'mix') ?? null;
}

/** True when the result leans on estimates or unverified data (Requirement 15.3); `derivedRules` never counts. */
export function isProvisional(result: DiningPlanResultDTO): boolean {
  const q = result.dataQuality;
  return q.estimatedEntries > 0 || q.unverifiedRules > 0 || q.unverifiedPrices > 0;
}

export interface VerdictView {
  readonly title: string;
  readonly detail: string;
  readonly icon: ViewIcon;
  /** "Estimated" wording is part of `title` when true. */
  readonly provisional: boolean;
}

const ABOUT_EVEN_CHOICE =
  'The choice is up to you. A plan is paid in advance and leaves nothing to track at the table; no plan means no unused credits and free choice of where to eat.';

export function verdictHeadline(result: DiningPlanResultDTO): VerdictView {
  const provisional = isProvisional(result);
  const prefix = provisional ? 'Estimated: ' : '';
  const best = bestScenario(result);
  switch (result.verdict) {
    case 'plan_saves': {
      const recommended = scenarioOf(result, result.recommended) ?? best;
      return {
        title: `${prefix}${recommended?.displayName ?? 'A dining plan'} saves about ${money(recommended?.netSavingsCents ?? 0)}`,
        detail: 'Compared with paying for the meals you listed yourself, tax and tips included.',
        icon: 'checkmark-circle-outline',
        provisional,
      };
    }
    case 'plan_costs_more':
      return {
        title: `${prefix}No dining plan: ${best?.displayName ?? 'the best plan'} would cost about ${money(result.breakEvenGapCents)} more`,
        detail: 'Paying as you go is cheaper for the meals you listed.',
        icon: 'close-circle-outline',
        provisional,
      };
    case 'about_even': {
      const net = best?.netSavingsCents ?? 0;
      const title =
        net > 0
          ? `${prefix}About even: ${best?.displayName ?? 'the plan'} would save about ${money(net)}, less than the margin of these estimates`
          : net < 0
            ? `${prefix}About even: no plan is about ${money(Math.abs(net))} cheaper`
            : `${prefix}About even: the plan and no plan cost the same`;
      return { title, detail: `Too close to call. ${ABOUT_EVEN_CHOICE}`, icon: 'swap-horizontal-outline', provisional };
    }
    default: {
      const first = result.scenarios.find((s) => s.code !== 'none' && !s.available);
      return {
        title: 'No dining plan is available for this stay',
        detail: unavailableReasonText(first?.unavailableReason ?? null),
        icon: 'remove-circle-outline',
        provisional,
      };
    }
  }
}

export interface ScenarioRowView {
  readonly code: DiningScenarioCode;
  readonly name: string;
  readonly available: boolean;
  /** The reason in words for an unavailable plan; null when available. */
  readonly unavailableText: string | null;
  /** Shown only for `plan_saves` and `plan_costs_more`; never for an about-even result (Requirement 15.6). */
  readonly recommended: boolean;
  readonly promoLabel: string | null;
  /** "Price not yet verified" for an available plan whose prices have no `verified_at` (Requirement 21.3). */
  readonly priceNote: string | null;
  readonly planCost: string;
  readonly foodOutOfPocket: string;
  readonly tax: string;
  readonly tip: string;
  readonly snacks: string;
  readonly mugs: string;
  readonly total: string;
  /** "Saves $X", "Costs $X more", or null for No plan and unavailable plans. */
  readonly netSavings: string | null;
}

export function netSavingsText(cents: number): string {
  if (cents > 0) return `Saves ${money(cents)}`;
  if (cents < 0) return `Costs ${money(Math.abs(cents))} more`;
  return 'Same as no plan';
}

export function scenarioRows(result: DiningPlanResultDTO): ScenarioRowView[] {
  const labelRecommended = result.verdict === 'plan_saves' || result.verdict === 'plan_costs_more';
  return result.scenarios.map((s) => ({
    code: s.code,
    name: s.displayName,
    available: s.available,
    unavailableText: s.available ? null : unavailableReasonText(s.unavailableReason),
    recommended: labelRecommended && s.available && s.code === result.recommended,
    promoLabel: s.promoLabel,
    priceNote: s.code !== 'none' && s.available && s.priceVerifiedAt === null ? 'Price not yet verified' : null,
    planCost: money(s.planCostCents),
    foodOutOfPocket: money(s.foodOutOfPocketCents),
    tax: money(s.taxCents),
    tip: money(s.tipCents),
    snacks: money(s.snackOutOfPocketCents),
    mugs: money(s.mugOutOfPocketCents),
    total: money(s.totalCents),
    netSavings: s.code === 'none' || !s.available ? null : netSavingsText(s.netSavingsCents),
  }));
}

/** The text of a meal slot: what is planned there. */
export function slotLabel(entry: DiningEntryDTO | undefined): string {
  if (entry === undefined) return 'Add a meal';
  if (entry.kind === 'skip') return 'Skipped';
  if (entry.kind === 'placeholder') return entry.placeholderKind === 'table_service' ? 'Typical table-service meal' : 'Typical quick-service meal';
  return entry.experienceName ?? 'A restaurant';
}

/** Requirement 22.2: a slot announces its date, meal period and content. */
export function slotAccessibilityLabel(date: string, mealPeriod: DiningMealPeriod, entry: DiningEntryDTO | undefined): string {
  return `${longDate(date)}, ${mealPeriodLabel(mealPeriod).toLowerCase()}: ${slotLabel(entry)}`;
}

const REASON_TEXT: Readonly<Record<DiningUncoveredReason, string>> = {
  not_eligible: 'This restaurant does not take dining plan credits.',
  no_matching_credits: 'This plan has no credit for this kind of meal.',
  better_use_elsewhere: 'Your credits are worth more at other meals.',
};

export interface ActionView {
  readonly text: string;
  readonly icon: ViewIcon;
  readonly reason: string | null;
}

export function actionLabel(line: Pick<DiningMealLineDTO, 'action' | 'reason'>): ActionView {
  const reason = line.reason === null ? null : REASON_TEXT[line.reason];
  switch (line.action) {
    case 'use_plan':
      return { text: 'Use plan', icon: 'checkmark-circle-outline', reason };
    case 'partly_covered':
      return { text: 'Partly covered', icon: 'contrast-outline', reason };
    case 'pay_out_of_pocket':
      return { text: 'Pay out of pocket', icon: 'cash-outline', reason };
    default:
      return { text: 'No plan', icon: 'ellipse-outline', reason };
  }
}

/** The text badges of a meal line (Requirements 14.3, 21.2): each is words, never a colour alone. */
export function lineBadges(line: Pick<DiningMealLineDTO, 'twoCredit' | 'gratuityIncluded' | 'basis' | 'unverifiedRule'>): string[] {
  const out: string[] = [];
  if (line.twoCredit) out.push('2 credits');
  if (line.gratuityIncluded) out.push('Gratuity included');
  if (line.basis === 'tier_estimate' || line.basis === 'default_estimate') out.push('Estimate');
  if (line.unverifiedRule) out.push('Unverified rule');
  return out;
}

export interface QualityView {
  /** The visible notice (Requirement 15.3); null when nothing is estimated or unverified. */
  readonly notice: string | null;
  /** The secondary detail line for derived rules; never makes the result provisional. */
  readonly derivedLine: string | null;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function qualityNotice(result: DiningPlanResultDTO): QualityView {
  const q = result.dataQuality;
  const parts: string[] = [];
  if (q.estimatedEntries > 0) parts.push(`${count(q.estimatedEntries, 'meal is', 'meals are')} priced from an estimate`);
  if (q.unverifiedRules > 0) parts.push(`${count(q.unverifiedRules, 'meal uses', 'meals use')} an unverified credit rule`);
  if (q.unverifiedPrices > 0) parts.push(`${count(q.unverifiedPrices, 'plan price is', 'plan prices are')} not yet verified`);
  return {
    notice: parts.length === 0 ? null : `Some figures are estimates: ${parts.join('; ')}.`,
    derivedLine: q.derivedRules > 0 ? `${count(q.derivedRules, 'restaurant uses', 'restaurants use')} the standard rules: one credit per meal.` : null,
  };
}

/** Requirement 21.3: the plan prices' "as of" date, or that they are not yet verified. */
export function pricesAsOfText(result: DiningPlanResultDTO): string {
  return result.assumptions.pricesAsOf === null ? 'Plan prices: price not yet verified.' : `Plan prices as of ${result.assumptions.pricesAsOf}.`;
}

/** Requirement 12.8: the tax and tip rates used, and whether each is the default. */
export function ratesText(result: DiningPlanResultDTO): string {
  const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
  const a = result.assumptions;
  return `Tax ${pct(a.taxBps)} (${a.taxIsDefault ? 'default' : 'your setting'}), tip ${pct(a.tipBps)} (${a.tipIsDefault ? 'default' : 'your setting'}).`;
}

const ORDER_STYLE_LABEL: Readonly<Record<DiningOrderStyle, string>> = {
  budget: 'Budget',
  typical: 'Typical',
  splurge: 'Splurge',
  max_value: 'Most expensive',
};

export function orderStyleLabel(style: DiningOrderStyle): string {
  return ORDER_STYLE_LABEL[style];
}

/** The display name of a scenario code in this result ("No Dining Plan" for `none` or a null best plan). */
export function scenarioName(result: DiningPlanResultDTO, code: DiningScenarioCode | null): string {
  if (code === null) return scenarioOf(result, 'none')?.displayName ?? 'No Dining Plan';
  return scenarioOf(result, code)?.displayName ?? code;
}

export interface SensitivityRowView {
  readonly orderStyle: DiningOrderStyle;
  readonly label: string;
  readonly current: boolean;
  readonly best: string;
  readonly net: string;
}

/** Requirement 15.1/15.4: the best option under each Order_Style, from the server's sensitivity runs. */
export function sensitivityRows(result: DiningPlanResultDTO, currentOrderStyle: DiningOrderStyle): SensitivityRowView[] {
  return result.sensitivity.map((s) => {
    const effectiveCode: DiningScenarioCode | null = s.bestPlan ?? (s.recommended === 'mix' ? 'mix' : null);
    return {
      orderStyle: s.orderStyle,
      label: ORDER_STYLE_LABEL[s.orderStyle],
      current: s.orderStyle === currentOrderStyle,
      best: effectiveCode === 'mix' ? 'Per-Hotel Plan Mix' : scenarioName(result, effectiveCode),
      net: effectiveCode === null ? 'No plan is cheapest' : netSavingsText(s.netSavingsCents),
    };
  });
}

/**
 * The credit summary lines of one scenario (Requirements 9.6, 10.3, 10.5); the counts are the party's totals; kinds
 * the plan does not issue are left out.
 */
export function creditRows(credits: DiningCreditSummaryDTO): string[] {
  const out: string[] = [];
  const row = (name: string, c: { issued: number; used: number; unused: number }) => {
    if (c.issued > 0) out.push(`${name}: ${c.issued} for the party, ${c.used} used, ${c.unused} left over`);
  };
  row('Table-service credits', credits.ts);
  row('Quick-service credits', credits.qs);
  row('Snack credits', credits.snack);
  if (credits.snack.issued > 0) out.push(`Use about ${credits.snacksPerDayToUseAll} snack ${credits.snacksPerDayToUseAll === 1 ? 'credit' : 'credits'} a day to use them all`);
  if (credits.mugsCovered > 0) {
    out.push(
      `${count(credits.mugsCovered, 'refillable mug', 'refillable mugs')} included. Refills work only at self-service stations in Disney Resort hotel quick-service locations, not in the parks or Disney Springs.`,
    );
  }
  return out;
}

/** Requirement 19.5: "2 added, 1 already planned" after an import. */
export function importResultText(r: { created: number; skippedExisting: number; skippedOutOfStay: number }): string {
  const parts = [`${r.created} added`];
  if (r.skippedExisting > 0) parts.push(`${r.skippedExisting} already planned`);
  if (r.skippedOutOfStay > 0) parts.push(`${r.skippedOutOfStay} outside your stay`);
  return parts.join(', ');
}

/** "Add 2 reservations": the suggestions not already in a slot. */
export function importActionLabel(newSuggestions: number): string {
  return `Add ${count(newSuggestions, 'reservation', 'reservations')}`;
}

export function partySummaryText(party: readonly { label: string }[]): string {
  if (party.length === 0) return 'No one in the party yet';
  return `${count(party.length, 'person', 'people')}: ${party.map((p) => p.label).join(', ')}`;
}

export function staySummaryText(stay: { checkIn: string; checkOut: string; nights: number }): string {
  return `${shortDate(stay.checkIn)} to ${shortDate(stay.checkOut)}, ${count(stay.nights, 'night', 'nights')}`;
}

// ---------------------------------------------------------------------------
// Several hotel stays (Requirements 25.2, 25.11, 25.15, 25.16)
// ---------------------------------------------------------------------------

export const PLAN_NAME: Readonly<Record<DiningPlanCode, string>> = {
  quick_service: 'Quick-Service Dining Plan',
  table_service: 'Table-Service Dining Plan',
  deluxe: 'Deluxe Table-Service Dining Plan',
};

const PLAN_SHORT_NAME: Readonly<Record<DiningPlanCode, string>> = {
  quick_service: 'Quick-Service plan',
  table_service: 'Table-Service plan',
  deluxe: 'Deluxe plan',
};

export const HAND_OFF_MARKER = "Switching hotels: either hotel's credits can be used today, and the calculator picks whichever saves the most.";
export const HAND_OFF_EXPLANATION = "Credits do not carry between hotels. Meals on the day you switch can use either hotel's credits.";
export const NO_LODGING_TEXT = 'No lodging recorded; assuming a Disney Resort package';

/** "Dec 15 to 20", or "Dec 30 to Jan 2" across months. */
export function stayRangeText(checkIn: string, checkOut: string): string {
  const a = new Date(`${checkIn}T00:00:00Z`);
  const b = new Date(`${checkOut}T00:00:00Z`);
  const mon = (d: Date) => MONTHS[d.getUTCMonth()]!.slice(0, 3);
  const end = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear() ? `${b.getUTCDate()}` : `${mon(b)} ${b.getUTCDate()}`;
  return `${mon(a)} ${a.getUTCDate()} to ${end}`;
}

/** True for a segment the resolver made up because no lodging is recorded for those dates. */
export function isSynthesizedStay(stay: Pick<DiningPlanStayResultDTO, 'source'>): boolean {
  return stay.source === 'implicit_no_lodging' || stay.source === 'implicit_gap';
}

/** "Table-Service plan for Contemporary (Dec 15 to 20); no plan for Pop Century (Dec 20 to 26)". */
export function combinationSentence(
  stays: readonly DiningPlanStayResultDTO[],
  combination: Readonly<Record<string, DiningStayOptionCode>>,
): string {
  const parts = stays
    .filter((s) => combination[s.key] !== undefined)
    .map((s) => {
      const option = combination[s.key]!;
      const plan = option === 'none' ? 'no plan' : `${PLAN_SHORT_NAME[option]}${s.status === 'have_plan' ? ' (already booked)' : ''}`;
      return `${plan} for ${s.label} (${stayRangeText(s.checkIn, s.checkOut)})`;
    });
  const text = parts.join('; ');
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

export interface CombinationView {
  readonly heading: string;
  readonly sentence: string;
}

/**
 * The recommended Combination in words, for a Trip with more than one stay. "Recommended" only where the comparison
 * says so too (Requirement 15.6): an about-even result shows the no-new-plan Combination under a neutral heading.
 */
export function combinationView(result: DiningPlanResultDTO): CombinationView | null {
  const stays = result.stays ?? [];
  if (stays.length < 2 || result.recommendedCombination === undefined) return null;
  const heading =
    result.verdict === 'plan_saves' || result.verdict === 'plan_costs_more'
      ? 'Recommended for your hotels'
      : result.verdict === 'about_even'
        ? 'Without a new plan (too close to call)'
        : 'Your hotels';
  return { heading, sentence: combinationSentence(stays, result.recommendedCombination) };
}

export interface StayResultRowView {
  readonly key: string;
  readonly label: string;
  readonly dates: string;
  readonly plan: string;
  readonly planCost: string | null;
  readonly contribution: string | null;
  readonly credits: readonly string[];
  readonly unavailableText: string | null;
}

/** The per-stay table: each stay's plan in the recommended Combination, its cost and what it adds. */
export function stayResultRows(result: DiningPlanResultDTO): StayResultRowView[] {
  return (result.stays ?? []).map((s) => {
    const option = result.recommendedCombination?.[s.key] ?? s.recommendedPlan;
    const hasPlan = option !== 'none';
    const c = s.contributionCents;
    return {
      key: s.key,
      label: s.label,
      dates: `${stayRangeText(s.checkIn, s.checkOut)}, ${count(s.nights, 'night', 'nights')}`,
      plan: hasPlan ? `${PLAN_NAME[option]}${s.status === 'have_plan' ? ' (already booked)' : ''}` : 'No plan',
      planCost: hasPlan ? money(s.planCostCents) : null,
      contribution: !hasPlan || c === 0 ? null : c > 0 ? `Saves about ${money(c)} at this hotel` : `Costs about ${money(Math.abs(c))} more than no plan at this hotel`,
      credits: hasPlan && s.credits !== null ? creditRows(s.credits) : [],
      unavailableText: s.available ? null : unavailableReasonText(s.unavailableReason),
    };
  });
}

export interface AlternativeView {
  readonly sentence: string;
  readonly total: string;
  readonly net: string;
}

export function alternativeRows(result: DiningPlanResultDTO): AlternativeView[] {
  const stays = result.stays ?? [];
  return (result.alternatives ?? []).map((a) => ({
    sentence: combinationSentence(stays, a.combination),
    total: money(a.totalCents),
    net: netSavingsText(a.netSavingsCents),
  }));
}

export interface DayNote {
  /** The hotels of that date, in date order: one on a normal day, two on a switch day. */
  readonly hotels: readonly string[];
  readonly handOff: boolean;
}

/** Per-date hotel names and switch days for the meal grid; empty for a single stay (nothing new to show). */
export function stayDayNotes(stays: readonly DiningPlanStayResultDTO[] | undefined): ReadonlyMap<string, DayNote> {
  const out = new Map<string, DayNote>();
  if (stays === undefined || stays.length < 2) return out;
  const ordered = [...stays].sort((x, y) => (x.checkIn < y.checkIn ? -1 : x.checkIn > y.checkIn ? 1 : 0));
  for (const s of ordered) {
    for (const date of stayDates(s.checkIn, s.checkOut)) {
      const prev = out.get(date);
      const hotels = prev === undefined ? [s.label] : [...prev.hotels, s.label];
      out.set(date, { hotels, handOff: hotels.length > 1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Import suggestions (Requirements 5.3, 5.8, 5.9) and the Budget export (Requirement 26.12)
// ---------------------------------------------------------------------------

export function suggestionSourceLabel(source: DiningSuggestionDTO['source']): string {
  return source === 'reservation' ? 'Reservation' : 'Planned';
}

/** "Pecos Bill, Thu, Mar 4, lunch" */
export function suggestionText(s: Pick<DiningSuggestionDTO, 'experienceName' | 'date' | 'mealPeriod'>): string {
  return `${s.experienceName}, ${shortDate(s.date)}, ${mealPeriodLabel(s.mealPeriod).toLowerCase()}`;
}

export const PARTY_SIZE_MISMATCH_TEXT = 'The reservation is for fewer people than your party';

/** Requirement 5.9: planned restaurants that could not be placed in a meal slot. */
export function needsMealTimeText(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? '1 planned restaurant has no meal time; add it by hand' : `${n} planned restaurants have no meal time; add them by hand`;
}

/** The export group an Export_Key belongs to (`dining_plan:plan:<stay>`, `dining_plan:oop`, `dining_plan:tips`). */
export function exportGroupOf(key: string): DiningExportGroup | null {
  if (key.startsWith('dining_plan:plan:')) return 'plan';
  if (key === 'dining_plan:oop') return 'out_of_pocket';
  if (key === 'dining_plan:tips') return 'tips';
  return null;
}

export const EXPORT_GROUP_LABEL: Readonly<Record<DiningExportGroup, string>> = {
  plan: 'Dining plan cost',
  out_of_pocket: 'Meals, snacks and mugs you pay for',
  tips: 'Tips',
};

/** The Budget's own category names (TripBudgetScreen). */
export function exportCategoryLabel(category: DiningBudgetExportLineDTO['category']): string {
  return category === 'dining' ? 'Dining & Snacks' : 'Other & Extras';
}

export const EXPORT_REPLACE_NOTE =
  'Adding again later updates these same Budget lines. Changes you make to them in the Budget will be overwritten.';

export const EXPORT_PRE_TAX_NOTE = 'Amounts are before tax; the Budget adds its own tax to the dining lines.';

export function exportWarningText(w: DiningBudgetExportResultDTO['warnings'][number]): string {
  if (w.code === 'tax_rate_mismatch') {
    const calc = w.calculatorTaxBps === undefined ? 'the calculator rate' : `${w.calculatorTaxBps / 100}%`;
    const budget = w.budgetTaxBps === undefined ? 'its own rate' : `${w.budgetTaxBps / 100}%`;
    return `The Budget taxes dining at ${budget} and the calculator used ${calc}, so the Budget's totals will differ slightly.`;
  }
  return 'Your Budget taxes the Other category, so the tips line will have tax added.';
}

export function exportResultText(r: Pick<DiningBudgetExportResultDTO, 'created' | 'updated' | 'deleted'>): string {
  return `${count(r.created, 'line', 'lines')} added, ${r.updated} updated, ${r.deleted} removed.`;
}

/**
 * Requirement 26.12 / task 11.6: nothing to export when no plan is available and the recommended option pays
 * nothing out of pocket. Each term is checked on its own; no total is formed.
 */
export function canExportToBudget(result: DiningPlanResultDTO): boolean {
  if (result.scenarios.some((s) => s.code !== 'none' && s.available)) return true;
  const rec = scenarioOf(result, result.recommended);
  if (rec === undefined) return false;
  return rec.planCostCents > 0 || rec.foodOutOfPocketCents > 0 || rec.snackOutOfPocketCents > 0 || rec.mugOutOfPocketCents > 0 || rec.tipCents > 0;
}

export const DINING_DISCLAIMER =
  'Estimate only. Not affiliated with or endorsed by Disney. Plan prices and rules change; confirm in the Disney booking flow before you buy.';

// ---------------------------------------------------------------------------
// 4-Tab Resort Chapters Redesign Helpers (Requirement 27)
// ---------------------------------------------------------------------------

export type DiningCalFilter = 'all' | 'credits' | 'cash';

/** "{ weekday: 'Tue', monthDay: 'Mar 2' }" in UTC for compact day-column cells. */
export function weekdayAndMonthDay(date: string): { readonly weekday: string; readonly monthDay: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    weekday: WEEKDAYS[d.getUTCDay()]!.slice(0, 3),
    monthDay: `${MONTHS[d.getUTCMonth()]!.slice(0, 3)} ${d.getUTCDate()}`,
  };
}

export interface CompactMiniStat {
  readonly code: DiningScenarioCode;
  readonly label: string;
  readonly total: string;
  readonly isRecommended: boolean;
}

export interface VerdictCompactView {
  readonly headline: string;
  readonly totalText: string | null;
  readonly bestSummary: string;
  readonly bestMain: string;
  readonly bestAside: string | null;
  readonly detail: string;
  readonly icon: ViewIcon;
  readonly provisional: boolean;
  readonly miniStats: readonly CompactMiniStat[];
}

function explicitMixSummary(result: DiningPlanResultDTO): { readonly main: string; readonly aside: string | null; readonly inline: string } | null {
  const stays = result.stays ?? [];
  const combo = result.recommendedCombination;
  if (stays.length < 2 || combo === undefined) return null;
  const planStays = stays.filter((s) => combo[s.key] !== undefined && combo[s.key] !== 'none');
  if (planStays.length === 0) {
    return { main: 'No plan (pay cash at all hotels)', aside: null, inline: 'No plan (pay cash at all hotels)' };
  }
  if (planStays.length < stays.length) {
    const parts = planStays.map((s) => `${PLAN_NAME[combo[s.key]! as DiningPlanCode]} at ${shortHotelLabel(s.label)}`);
    const main = parts.join(', ');
    const aside = '(pay cash elsewhere)';
    return { main, aside, inline: `${main} ${aside}` };
  }
  const main = stays.map((s) => `${PLAN_NAME[combo[s.key]! as DiningPlanCode]} at ${shortHotelLabel(s.label)}`).join(', ');
  return { main, aside: null, inline: main };
}

const MINI_STAT_ORDER: Readonly<Record<DiningScenarioCode, number>> = {
  none: 0,
  mix: 1,
  quick_service: 2,
  table_service: 3,
  deluxe: 4,
};

const MINI_STAT_LABEL: Readonly<Record<DiningScenarioCode, string>> = {
  none: 'No Plan',
  quick_service: 'All QS Plan',
  table_service: 'All Dining',
  deluxe: 'All Deluxe',
  mix: 'Best Mix',
};

function explicitComboName(
  stays: readonly DiningPlanStayResultDTO[],
  combination: Readonly<Record<string, DiningStayOptionCode>>,
): string {
  const chosen = stays.filter((s) => (combination[s.key] ?? 'none') !== 'none');
  if (chosen.length === 0) return 'No plan';
  return chosen.map((s) => `${PLAN_NAME[combination[s.key]! as DiningPlanCode]} at ${shortHotelLabel(s.label)}`).join(', ');
}

function slightEdgeText(leaderName: string | null, netSavingsCents: number): string {
  if (netSavingsCents > 0 && leaderName !== null) return `Slight edge: ${leaderName} (saves ${money(netSavingsCents)})`;
  if (netSavingsCents < 0) return `Slight edge: Paying cash / No plan (saves ${money(Math.abs(netSavingsCents))})`;
  return leaderName !== null ? `Tied with ${leaderName} ($0.00 difference)` : 'Too close to call';
}

function aboutEvenParts(result: DiningPlanResultDTO): { readonly main: string; readonly aside: string; readonly summary: string } {
  const stays = result.stays ?? [];
  const margin = money(result.evenThresholdCents);
  const best = bestScenario(result);

  if (stays.length >= 2 && (result.alternatives?.length ?? 0) > 0) {
    const close = (result.alternatives ?? []).filter((a) => Math.abs(a.netSavingsCents) <= result.evenThresholdCents);
    if (close.length > 0) {
      const leader = close[0]!;
      const leaderName = explicitComboName(stays, leader.combination);
      const main =
        close.length === 1
          ? `No plan and 1 combo are within ~2% (${margin})`
          : `No plan and ${close.length} combos are within ~2% (${margin})`;
      const aside = slightEdgeText(leaderName, leader.netSavingsCents);
      return { main, aside, summary: `${main}. ${aside}` };
    }
  }

  const closePlans = result.scenarios
    .filter((s) => s.code !== 'none' && s.code !== 'mix' && s.available && Math.abs(s.netSavingsCents) <= result.evenThresholdCents)
    .sort((a, b) => a.totalCents - b.totalCents);
  if (closePlans.length > 0) {
    const leader = closePlans[0]!;
    const main =
      closePlans.length === 1
        ? `No plan and ${leader.displayName} are within ~2% (${margin})`
        : `No plan and ${closePlans.length} plans are within ~2% (${margin})`;
    const aside = slightEdgeText(leader.displayName, leader.netSavingsCents);
    return { main, aside, summary: `${main}. ${aside}` };
  }

  const main = `No plan and dining plans are within ~2% (${margin})`;
  const aside = slightEdgeText(best !== null && best.code !== 'none' ? best.displayName : null, best?.netSavingsCents ?? 0);
  return { main, aside, summary: `${main}. ${aside}` };
}

/**
 * Compact 2-line verdict bar summary for Requirement 27.1. Reuses `verdictHeadline` and server scenario cents with
 * explicit official plan names (never `DDP`).
 */
export function verdictCompactView(result: DiningPlanResultDTO): VerdictCompactView {
  const base = verdictHeadline(result);
  const recommended = scenarioOf(result, result.recommended);
  const best = bestScenario(result);
  const active = recommended ?? best;
  const labelRec = result.verdict === 'plan_saves' || result.verdict === 'plan_costs_more';
  const prefix = base.provisional ? 'Estimated: ' : '';

  let headline = base.title;
  if (result.verdict === 'plan_saves' && recommended !== undefined) {
    headline = `${prefix}Saves about ${money(recommended.netSavingsCents)}`;
  } else if (result.verdict === 'plan_costs_more') {
    headline = `${prefix}No dining plan saves ${money(result.breakEvenGapCents)}`;
  } else if (result.verdict === 'about_even') {
    headline = `${prefix}Too close to call`;
  }

  let bestMain = base.detail;
  let bestAside: string | null = null;
  let bestSummary = base.detail;
  if (result.verdict === 'plan_saves') {
    const mixParts = result.recommended === 'mix' ? explicitMixSummary(result) : null;
    if (mixParts !== null) {
      bestMain = `Best: ${mixParts.main}`;
      bestAside = mixParts.aside;
      bestSummary = `Best: ${mixParts.inline}`;
    } else {
      bestMain = `Best: ${recommended?.displayName ?? 'A dining plan'}`;
      bestSummary = bestMain;
    }
  } else if (result.verdict === 'plan_costs_more') {
    const bestLabel = best?.code === 'mix' ? 'per-hotel plan mix' : best?.displayName ?? 'any dining plan';
    bestMain = `Paying as you go beats ${bestLabel}`;
    bestSummary = bestMain;
  } else if (result.verdict === 'about_even') {
    const parts = aboutEvenParts(result);
    bestMain = parts.main;
    bestAside = parts.aside;
    bestSummary = parts.summary;
  }

  let detail = base.detail;
  if (result.verdict === 'plan_saves' && recommended !== undefined) {
    const noneScenario = scenarioOf(result, 'none');
    const mixParts = result.recommended === 'mix' ? explicitMixSummary(result) : null;
    if (mixParts !== null && noneScenario !== undefined && noneScenario.available) {
      detail = `Buying ${mixParts.inline} saves ${money(recommended.netSavingsCents)} vs paying cash (${money(noneScenario.totalCents)}), tax and tips included.`;
    }
  }

  const miniStats: CompactMiniStat[] = result.scenarios
    .filter((s) => s.available)
    .sort((a, b) => MINI_STAT_ORDER[a.code] - MINI_STAT_ORDER[b.code])
    .map((s) => ({
      code: s.code,
      label: MINI_STAT_LABEL[s.code],
      total: money(s.totalCents),
      isRecommended: labelRec && s.code === result.recommended,
    }));

  return {
    headline,
    totalText: active !== undefined && active !== null && active.available ? `Total ${money(active.totalCents)}` : null,
    bestSummary,
    bestMain,
    bestAside,
    detail,
    icon: base.icon,
    provisional: base.provisional,
    miniStats,
  };
}

/** Whether a server meal line uses plan credits (`use_plan` or `partly_covered`). */
export function lineUsesCredit(line: Pick<DiningMealLineDTO, 'action'> | undefined): boolean {
  return line !== undefined && (line.action === 'use_plan' || line.action === 'partly_covered');
}

/** Filter predicate for the `All` / `Use Credits` / `Pay Cash` calendar filter pills (Requirement 27.5). */
export function slotMatchesFilter(
  entry: DiningEntryDTO | undefined,
  line: Pick<DiningMealLineDTO, 'action'> | undefined,
  filter: DiningCalFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'credits') return lineUsesCredit(line);
  return entry !== undefined && entry.kind !== 'skip' && !lineUsesCredit(line);
}

export interface ChapterDayView {
  readonly date: string;
  readonly weekday: string;
  readonly monthDay: string;
  readonly handOff: boolean;
  readonly hotelNames: readonly string[];
}

export interface StayChapterView {
  readonly stay: DiningPlanStayResultDTO;
  readonly datesText: string;
  readonly totalDays: number;
  readonly visibleDays: readonly ChapterDayView[];
  readonly matchingSlotCount: number;
  readonly isSynthesized: boolean;
}

function assignDatesToStays(stays: readonly DiningPlanStayResultDTO[]): Map<string, string[]> {
  const out = new Map<string, string[]>(stays.map((s) => [s.key, []]));
  if (stays.length === 0) return out;
  const ordered = [...stays].sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : 0));
  const minStart = ordered[0]!.checkIn;
  const maxEnd = ordered.reduce((acc, s) => (s.checkOut > acc ? s.checkOut : acc), ordered[0]!.checkOut);
  const allDates = stayDates(minStart, maxEnd);

  for (const date of allDates) {
    // Prefer the stay whose sleeping night covers `date` (`checkIn <= date < checkOut`), matching engine attribution.
    const nightStay = ordered.find((s) => date >= s.checkIn && date < s.checkOut);
    const owner = nightStay ?? [...ordered].reverse().find((s) => date >= s.checkIn && date <= s.checkOut) ?? ordered[ordered.length - 1]!;
    out.get(owner.key)!.push(date);
  }
  return out;
}

/**
 * Groups trip calendar dates into collapsible Resort Chapters without duplicating hand-off dates, then applies the
 * active calendar filter (`all` / `credits` / `cash`) at both the day and stay levels (Requirement 27.2, 27.5).
 */
export function groupStayChapters(
  stays: readonly DiningPlanStayResultDTO[],
  entries: readonly DiningEntryDTO[],
  lines: readonly DiningMealLineDTO[],
  filter: DiningCalFilter,
): StayChapterView[] {
  const byStay = assignDatesToStays(stays);
  const dayNotes = stayDayNotes(stays);
  const entryMap = new Map(entries.map((e) => [`${e.date}|${e.mealPeriod}`, e]));
  const lineMap = new Map(lines.map((l) => [`${l.date}|${l.mealPeriod}`, l]));

  return stays.map((stay) => {
    const dates = byStay.get(stay.key) ?? [];
    let matchingSlotCount = 0;
    const allDayViews: ChapterDayView[] = dates.map((date) => {
      const note = dayNotes.get(date);
      const { weekday, monthDay } = weekdayAndMonthDay(date);
      return {
        date,
        weekday,
        monthDay,
        handOff: note?.handOff ?? false,
        hotelNames: note?.hotels ?? [stay.label],
      };
    });

    const visibleDays = allDayViews.filter((day) => {
      let dayMatches = 0;
      for (const period of DINING_MEAL_PERIODS) {
        const key = `${day.date}|${period}`;
        if (slotMatchesFilter(entryMap.get(key), lineMap.get(key), filter)) {
          dayMatches += 1;
        }
      }
      matchingSlotCount += dayMatches;
      return filter === 'all' || dayMatches > 0;
    });

    return {
      stay,
      datesText: `${stayRangeText(stay.checkIn, stay.checkOut)}, ${count(stay.nights, 'night', 'nights')}`,
      totalDays: dates.length,
      visibleDays,
      matchingSlotCount,
      isSynthesized: isSynthesizedStay(stay),
    };
  });
}

export interface AlternativeMatrixColumn {
  readonly stayKey: string;
  readonly stayLabel: string;
  readonly optionCode: DiningStayOptionCode;
  readonly optionShortLabel: string;
  readonly held: boolean;
}

export interface AlternativeMatrixRow {
  readonly columns: readonly AlternativeMatrixColumn[];
  readonly total: string;
  readonly net: string;
  readonly isCostMore: boolean;
  readonly withinMargin: boolean;
}

const SHORT_OPTION_LABEL: Readonly<Record<DiningStayOptionCode, string>> = {
  none: 'No Plan',
  quick_service: 'Quick-Service',
  table_service: 'Dining Plan',
  deluxe: 'Deluxe',
};

/** Structured 3-hotel combination matrix for the `Compare` tab (Requirement 27.6). */
export function alternativeMatrixRows(result: DiningPlanResultDTO): AlternativeMatrixRow[] {
  const stays = result.stays ?? [];
  return (result.alternatives ?? []).map((alt) => ({
    columns: stays.map((s) => {
      const code = alt.combination[s.key] ?? 'none';
      return {
        stayKey: s.key,
        stayLabel: s.label,
        optionCode: code,
        optionShortLabel: SHORT_OPTION_LABEL[code],
        held: s.status === 'have_plan' && code !== 'none',
      };
    }),
    total: money(alt.totalCents),
    net: netSavingsText(alt.netSavingsCents),
    isCostMore: alt.netSavingsCents < 0,
    withinMargin: result.verdict === 'about_even' && Math.abs(alt.netSavingsCents) <= result.evenThresholdCents,
  }));
}

/** Compact hotel name for narrow split-stay matrix columns (strips `"Disney's "` and trailing `" Resort"`). */
export function shortHotelLabel(label: string): string {
  const cleaned = label
    .replace(/^Disney[\u2019']s\s+/iu, '')
    .replace(/\s+Resort$/iu, '')
    .trim();
  return cleaned.length > 0 ? cleaned : label;
}

/** Compact single-line header subtitle: "3 guests · Dec 15–31 (16n)". */
export function headerMetaSummary(
  partyCount: number,
  stay: { readonly checkIn: string; readonly checkOut: string; readonly nights: number } | null,
): string {
  const guests = `${partyCount} ${partyCount === 1 ? 'guest' : 'guests'}`;
  if (stay === null) return guests;
  return `${guests} · ${compactRangeText(stay.checkIn, stay.checkOut)} (${stay.nights}n)`;
}

/** "Dec 15–31" or "Dec 30–Jan 2" across months. */
export function compactRangeText(checkIn: string, checkOut: string): string {
  const a = new Date(`${checkIn}T00:00:00Z`);
  const b = new Date(`${checkOut}T00:00:00Z`);
  const mon = (d: Date) => MONTHS[d.getUTCMonth()]!.slice(0, 3);
  const end = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear() ? `${b.getUTCDate()}` : `${mon(b)} ${b.getUTCDate()}`;
  return `${mon(a)} ${a.getUTCDate()}–${end}`;
}

/** "2 adults (Alex, Blair), 1 child 3–9 (Kit)" for the Settings party card. */
export function partyBreakdownText(
  party: readonly { readonly label: string; readonly ageBracket: 'adult' | 'child' | 'under3' }[],
): string {
  if (party.length === 0) return 'No one in the party yet';
  const groups: string[] = [];
  const adults = party.filter((p) => p.ageBracket === 'adult');
  const children = party.filter((p) => p.ageBracket === 'child');
  const under3 = party.filter((p) => p.ageBracket === 'under3');
  if (adults.length > 0) groups.push(`${count(adults.length, 'adult', 'adults')} (${adults.map((p) => p.label).join(', ')})`);
  if (children.length > 0) groups.push(`${count(children.length, 'child', 'children')} 3–9 (${children.map((p) => p.label).join(', ')})`);
  if (under3.length > 0) groups.push(`${under3.length} under 3 (${under3.map((p) => p.label).join(', ')})`);
  return groups.join(', ');
}

/** "Wed, Dec 16 Switch Day: Either All-Star Sports or Animal Kingdom Lodge credits can be used on Dec 16." */
export function switchDaySummary(date: string, prevStayLabel: string | null, nextStayLabel: string): string {
  const { weekday, monthDay } = weekdayAndMonthDay(date);
  if (prevStayLabel === null) return `${weekday}, ${monthDay} Switch Day: ${HAND_OFF_EXPLANATION}`;
  return `${weekday}, ${monthDay} Switch Day: Either ${shortHotelLabel(prevStayLabel)} or ${shortHotelLabel(nextStayLabel)} credits can be used on ${monthDay}.`;
}

/** Compact header button summary, e.g. "Splurge • 18% tip". */
export function settingsChipLabel(settings: Pick<DiningPlanSettings, 'orderStyle' | 'tipBps'>, defaultTipBps: number): string {
  const tip = settings.tipBps ?? defaultTipBps;
  const tipPct = `${(tip / 100).toFixed(tip % 100 === 0 ? 0 : 1)}%`;
  return `${ORDER_STYLE_LABEL[settings.orderStyle]} · ${tipPct} tip`;
}

