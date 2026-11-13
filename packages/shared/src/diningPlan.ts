/**
 * Dining Plan Calculator: shared contracts (dining-plan-calculator tasks 1.1, 1.3 and 1.4).
 *
 * Constants, vocabularies, Zod request schemas, the admin config and seed-rule schemas, and the DTOs of the Trip
 * route, the stateless route and the Budget export. Both apps import these so the wire contracts cannot drift.
 *
 * Money is integer cents; rates are integer basis points. Every schema is `.strict()`.
 *
 * Validates: Requirements 2.1, 5.8, 6.1 to 6.4, 8.8, 8.9, 16.4, 17.6, 23.1, 25.3, 25.9, 25.11, 25.14, 25.17, 25.18,
 * 26.1, 26.4
 */

import { z } from 'zod';

import { AGE_BRACKETS, STAY_TYPES, TRAVELER_PASS_TYPES, type AgeBracket, type StayType, type TravelerPassType } from './enums.js';
import { uuidSchema } from './schemas/primitives.js';
import { BUDGET_DEFAULT_DINING_TIP_BPS, BUDGET_DEFAULT_TAX_BPS } from './tripBudget.js';
import { tripCalendarDateSchema } from './trips.js';
import { personKeySchema, type EffectiveStaySource, type StayRecord } from './tripStays.js';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const DINING_PLAN_CODES = ['quick_service', 'table_service', 'deluxe'] as const;
export type DiningPlanCode = (typeof DINING_PLAN_CODES)[number];

/** `none` is No_Plan; `mix` is a Combination that is not the same plan on every compared stay (Requirement 25.11). */
export const DINING_SCENARIO_CODES = ['none', ...DINING_PLAN_CODES, 'mix'] as const;
export type DiningScenarioCode = (typeof DINING_SCENARIO_CODES)[number];

/** What one Plan_Stay can be set to in a Combination: no plan, or one plan for the whole stay. */
export const DINING_STAY_OPTION_CODES = ['none', ...DINING_PLAN_CODES] as const;
export type DiningStayOptionCode = (typeof DINING_STAY_OPTION_CODES)[number];

/** Per Plan_Eligible_Person per night (Requirement 2.1). A mug is included in every plan. */
export const DINING_PLAN_ENTITLEMENTS_PER_NIGHT: Readonly<
  Record<DiningPlanCode, { readonly ts: number; readonly qs: number; readonly snack: number }>
> = {
  quick_service: { ts: 0, qs: 2, snack: 1 },
  table_service: { ts: 1, qs: 1, snack: 1 },
  deluxe: { ts: 2, qs: 1, snack: 1 },
};

export const DINING_MEAL_PERIODS = ['breakfast', 'lunch', 'dinner'] as const;
export type DiningMealPeriod = (typeof DINING_MEAL_PERIODS)[number];

export const DINING_ORDER_STYLES = ['budget', 'typical', 'splurge', 'max_value'] as const;
export type DiningOrderStyle = (typeof DINING_ORDER_STYLES)[number];
export const DINING_ORDER_STYLE_PERCENTILE: Readonly<Record<DiningOrderStyle, number>> = {
  budget: 25,
  typical: 50,
  splurge: 85,
  max_value: 100,
};

export const DINING_BEVERAGES = ['water', 'soft_drink', 'specialty'] as const;
export type DiningBeverage = (typeof DINING_BEVERAGES)[number];

/** The single-stay booking channel of the earlier design; with dated Trip stays it is replaced by `stayPlans`. */
export const DINING_STAY_TYPES = ['disney_resort_package', 'dvc_or_passholder_resort', 'not_disney_resort'] as const;
export type DiningStayType = (typeof DINING_STAY_TYPES)[number];

export const DINING_SERVICE_TYPES = ['table_service', 'quick_service', 'snack_only', 'not_eligible'] as const;
export type DiningServiceType = (typeof DINING_SERVICE_TYPES)[number];

export const DINING_ENTRY_KINDS = ['restaurant', 'placeholder', 'skip'] as const;
export type DiningEntryKind = (typeof DINING_ENTRY_KINDS)[number];

export const DINING_PLACEHOLDER_KINDS = ['quick_service', 'table_service'] as const;
export type DiningPlaceholderKind = (typeof DINING_PLACEHOLDER_KINDS)[number];

export const DINING_MENU_BASES = [
  'admin_override',
  'menu_offer',
  'menu_items',
  'menu_estimate',
  'tier_estimate',
  'default_estimate',
] as const;
export type DiningMenuBasis = (typeof DINING_MENU_BASES)[number];

export const DINING_VERDICTS = ['plan_saves', 'about_even', 'plan_costs_more', 'plan_unavailable'] as const;
export type DiningVerdict = (typeof DINING_VERDICTS)[number];

export const DINING_UNAVAILABLE_REASONS = [
  'not_disney_resort',
  'no_nights',
  'stay_too_long',
  'no_eligible_guests',
  'no_price_for_dates',
] as const;
export type DiningUnavailableReason = (typeof DINING_UNAVAILABLE_REASONS)[number];

export const DINING_COVERAGE = ['all', 'partial', 'none'] as const;
export type DiningCoverage = (typeof DINING_COVERAGE)[number];

export const DINING_UNCOVERED_REASONS = ['not_eligible', 'no_matching_credits', 'better_use_elsewhere'] as const;
export type DiningUncoveredReason = (typeof DINING_UNCOVERED_REASONS)[number];

/** A stored Location_Rule's status; `derived` (no stored row) is computed, never stored (Requirement 8.6). */
export const DINING_RULE_STATUSES = ['verified', 'unverified'] as const;
export type DiningRuleStatus = (typeof DINING_RULE_STATUSES)[number];
export type DiningRuleBasis = DiningRuleStatus | 'derived';

/** Stay_Plan_Setting statuses (Requirement 25.3). */
export const DINING_STAY_PLAN_STATUSES = ['compare', 'have_plan', 'no_plan'] as const;
export type DiningStayPlanStatus = (typeof DINING_STAY_PLAN_STATUSES)[number];

/** How a Plan_Stay's plan is bought; the Kids Eat Free promotion applies only to `package` (Requirement 25.13). */
export const DINING_STAY_CHANNELS = ['package', 'dvc_or_passholder'] as const;
export type DiningStayChannel = (typeof DINING_STAY_CHANNELS)[number];

/**
 * The runtime values of `EffectiveStaySource` (declared as a type in `tripStays.ts`). `satisfies` plus the check below
 * fail the build if the two ever disagree.
 */
export const DINING_PLAN_STAY_SOURCES = ['stay', 'legacy_resorts', 'implicit_no_lodging', 'implicit_gap'] as const satisfies readonly EffectiveStaySource[];
type MissingStaySource = Exclude<EffectiveStaySource, (typeof DINING_PLAN_STAY_SOURCES)[number]>;
const ALL_STAY_SOURCES_LISTED: MissingStaySource extends never ? true : never = true;
void ALL_STAY_SOURCES_LISTED;

/** Budget export groups (Requirement 26.4). */
export const DINING_EXPORT_GROUPS = ['plan', 'out_of_pocket', 'tips'] as const;
export type DiningExportGroup = (typeof DINING_EXPORT_GROUPS)[number];

// ---------------------------------------------------------------------------
// Limits and code constants (not admin-editable)
// ---------------------------------------------------------------------------

export const DINING_PLAN_PARTY_MAX = 50;
export const DINING_PLAN_ENTRIES_MAX = 120;
export const DINING_PLAN_MAX_NIGHTS = 30;
/** Even_Threshold floor and share of the No_Plan total (Requirement 13.5). */
export const DINING_EVEN_FLOOR_CENTS = 2000;
export const DINING_EVEN_BPS = 200;
/**
 * The read path's statements, as measured by `routes.statementCount.test.ts` (task 8): 16 for a Party with a guest,
 * plus 1 roster read while the Trip has no active Organizer. The design's starting ceiling was 19 (18 plus the stays
 * read); it is pinned lower to the measured value and must not be raised without amending the design.
 */
export const DINING_PLAN_READ_MAX_STATEMENTS = 17;
export const DINING_STANDALONE_DEBOUNCE_MS = 400;
/** Multi-stay bounds (Requirements 25.9, 25.14). */
export const DINING_PLAN_COMPARE_STAYS_MAX = 3;
export const DINING_PLAN_SPAN_MAX_DAYS = 60;
export const DINING_PLAN_STAYS_MAX = 8;
/** Longest Plan_Stay key: a Trip stay id, `implicit:<date>`, or a client key on the stateless route. */
export const DINING_STAY_KEY_MAX = 80;
export const DINING_EXCLUDED_KEYS_MAX = 50;
export const DINING_SOURCE_NOTE_MAX = 200;

/** Prefix of every Budget_Line the export owns (Requirement 26.7). */
export const DINING_EXPORT_KEY_PREFIX = 'dining_plan:';
/** The Budget's `suggestion_key` column limit; every Export_Key fits in it. */
export const DINING_EXPORT_KEY_MAX = 120;

/** The Export_Key of one export line: `dining_plan:plan:<stayKey>`, `dining_plan:oop` or `dining_plan:tips`. */
export function diningExportKey(group: DiningExportGroup, stayKey?: string): string {
  if (group === 'plan') {
    if (stayKey === undefined || stayKey.length === 0) throw new Error('A plan export key needs a stay key.');
    return `${DINING_EXPORT_KEY_PREFIX}plan:${stayKey}`;
  }
  return `${DINING_EXPORT_KEY_PREFIX}${group === 'out_of_pocket' ? 'oop' : 'tips'}`;
}

// ---------------------------------------------------------------------------
// Admin config (Configuration & Constants)
// ---------------------------------------------------------------------------

const centsIn = (min: number, max: number) => z.number().int().min(min).max(max);
const tierSchema = (max: number) =>
  z.object({ '1': centsIn(100, max), '2': centsIn(100, max), '3': centsIn(100, max), '4': centsIn(100, max) }).strict();

/** Every Dining_Config key with its bounds. A stored config is merged over `DINING_CONFIG_DEFAULTS` before parsing. */
export const diningConfigSchema = z
  .object({
    taxBps: z.number().int().min(0).max(2500),
    tipBps: z.number().int().min(0).max(5000),
    planPricesIncludeTax: z.boolean(),
    mugCents: centsIn(0, 10000),
    snackCents: centsIn(0, 5000),
    softDrinkCents: centsIn(0, 3000),
    specialtyBeverageCents: centsIn(0, 3000),
    alcoholBeverageCents: centsIn(0, 5000),
    dessertCents: centsIn(0, 5000),
    appetizerCents: centsIn(0, 5000),
    childFallbackBps: z.number().int().min(1000).max(10000),
    passDiningDiscountBps: z.number().int().min(0).max(5000),
    placeholderQsCents: centsIn(100, 10000),
    placeholderTsCents: centsIn(100, 20000),
    tierEstimates: z
      .object({ table_service: tierSchema(30000), quick_service: tierSchema(10000) })
      .strict(),
  })
  .strict();
export type DiningConfig = z.infer<typeof diningConfigSchema>;

/**
 * Starting values (design.md Configuration & Constants). Tax and tip are the `trip-budget` dining defaults by
 * reference, so the two features cannot drift apart.
 */
export const DINING_CONFIG_DEFAULTS: DiningConfig = {
  taxBps: BUDGET_DEFAULT_TAX_BPS.dining,
  tipBps: BUDGET_DEFAULT_DINING_TIP_BPS,
  planPricesIncludeTax: true,
  mugCents: 2299,
  snackCents: 650,
  softDrinkCents: 450,
  specialtyBeverageCents: 750,
  alcoholBeverageCents: 1300,
  dessertCents: 1000,
  appetizerCents: 1500,
  childFallbackBps: 6000,
  passDiningDiscountBps: 1000,
  placeholderQsCents: 1800,
  placeholderTsCents: 4500,
  tierEstimates: {
    table_service: { '1': 2800, '2': 4200, '3': 6500, '4': 9500 },
    quick_service: { '1': 1400, '2': 1700, '3': 2000, '4': 2400 },
  },
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const dateRangeSchema = z
  .object({ checkIn: tripCalendarDateSchema, checkOut: tripCalendarDateSchema })
  .strict()
  .superRefine((v, ctx) => {
    if (v.checkOut < v.checkIn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkOut'], message: 'checkOut must not be before checkIn' });
    }
  });

/** One Plan_Stay's setting (Requirement 25.3): `heldPlan` is set exactly when the status is `have_plan`. */
export const stayPlanSettingSchema = z
  .object({
    status: z.enum(DINING_STAY_PLAN_STATUSES).default('compare'),
    heldPlan: z.enum(DINING_PLAN_CODES).nullable().default(null),
    channel: z.enum(DINING_STAY_CHANNELS).default('package'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === 'have_plan' && v.heldPlan === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['heldPlan'], message: 'heldPlan is required when status is have_plan' });
    }
    if (v.status !== 'have_plan' && v.heldPlan !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['heldPlan'], message: 'heldPlan is only allowed when status is have_plan' });
    }
  });
export type StayPlanSetting = z.output<typeof stayPlanSettingSchema>;

export const DINING_STAY_PLAN_SETTING_DEFAULT: StayPlanSetting = { status: 'compare', heldPlan: null, channel: 'package' };

const stayKeySchema = z.string().min(1).max(DINING_STAY_KEY_MAX);

export const diningPlanSettingsSchema = z
  .object({
    /** A custom check-in and check-out; applies only to a single undated or implicit segment (Multi-Stay Extension). */
    stay: dateRangeSchema.nullable().default(null),
    stayType: z.enum(DINING_STAY_TYPES).default('disney_resort_package'),
    orderStyle: z.enum(DINING_ORDER_STYLES).default('typical'),
    beverage: z.enum(DINING_BEVERAGES).default('soft_drink'),
    alcoholDrinkerKeys: z.array(personKeySchema).max(DINING_PLAN_PARTY_MAX).default([]),
    orderDessert: z.boolean().default(true),
    appetizersPerTable: z.number().int().min(0).max(4).default(0),
    snacksPerPersonPerDay: z.number().int().min(0).max(4).default(1),
    mugsWanted: z.number().int().min(0).max(DINING_PLAN_PARTY_MAX).default(0),
    kidsEatFree: z.boolean().default(true),
    tipBps: z.number().int().min(0).max(5000).nullable().default(null),
    taxBps: z.number().int().min(0).max(2500).nullable().default(null),
    stayPlans: z.record(stayKeySchema, stayPlanSettingSchema).default({}),
  })
  .strict();
export type DiningPlanSettings = z.output<typeof diningPlanSettingsSchema>;
export type DiningPlanSettingsInput = z.input<typeof diningPlanSettingsSchema>;

// ---------------------------------------------------------------------------
// Entries, import and the stateless calculate body
// ---------------------------------------------------------------------------

const diningEntryFields = z
  .object({
    kind: z.enum(DINING_ENTRY_KINDS),
    experienceId: uuidSchema.nullable().default(null),
    placeholderKind: z.enum(DINING_PLACEHOLDER_KINDS).nullable().default(null),
    excludedKeys: z.array(personKeySchema).max(DINING_EXCLUDED_KEYS_MAX).default([]),
  })
  .strict();

/**
 * restaurant: experienceId set, placeholderKind null; placeholder: placeholderKind set, experienceId null; skip: both
 * null. Mirrors `chk_dpe_shape` in the migration.
 */
function diningEntryShapeCheck(
  v: { kind: DiningEntryKind; experienceId: string | null; placeholderKind: DiningPlaceholderKind | null },
  ctx: z.RefinementCtx,
): void {
  const issue = (path: string, message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  };
  if (v.kind === 'restaurant') {
    if (v.experienceId === null) issue('experienceId', 'A restaurant entry needs an experienceId');
    if (v.placeholderKind !== null) issue('placeholderKind', 'A restaurant entry has no placeholderKind');
  } else if (v.kind === 'placeholder') {
    if (v.placeholderKind === null) issue('placeholderKind', 'A placeholder entry needs a placeholderKind');
    if (v.experienceId !== null) issue('experienceId', 'A placeholder entry has no experienceId');
  } else {
    if (v.experienceId !== null) issue('experienceId', 'A skip entry has no experienceId');
    if (v.placeholderKind !== null) issue('placeholderKind', 'A skip entry has no placeholderKind');
  }
}

export const diningPlanEntryBodySchema = diningEntryFields.superRefine(diningEntryShapeCheck);
export type DiningPlanEntryBody = z.output<typeof diningPlanEntryBodySchema>;

export const diningPlanImportBodySchema = z
  .object({
    /** Omitted means every current suggestion. */
    plannedItemIds: z.array(uuidSchema).min(1).max(DINING_PLAN_ENTRIES_MAX).optional(),
    overwrite: z.boolean().default(false),
  })
  .strict();
export type DiningPlanImportBody = z.output<typeof diningPlanImportBodySchema>;

const diningPartyPersonSchema = z
  .object({
    key: personKeySchema,
    label: z.string().trim().min(1).max(60),
    ageBracket: z.enum(AGE_BRACKETS),
    passType: z.enum(TRAVELER_PASS_TYPES).default('none'),
  })
  .strict();

/** A Plan_Stay supplied to the stateless route (Requirement 25.17). */
export const diningCalculateStaySchema = z
  .object({
    key: stayKeySchema,
    label: z.string().trim().min(1).max(100),
    lodgingKind: z.enum(STAY_TYPES),
    source: z.enum(DINING_PLAN_STAY_SOURCES).default('stay'),
    checkIn: tripCalendarDateSchema,
    checkOut: tripCalendarDateSchema,
    partyKeys: z.array(personKeySchema).max(DINING_PLAN_PARTY_MAX).nullable().default(null),
    setting: stayPlanSettingSchema.default(DINING_STAY_PLAN_SETTING_DEFAULT),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.checkOut < v.checkIn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkOut'], message: 'checkOut must not be before checkIn' });
    }
  });

export const diningCalculateBodySchema = z
  .object({
    party: z.array(diningPartyPersonSchema).min(1).max(DINING_PLAN_PARTY_MAX),
    stay: dateRangeSchema,
    settings: diningPlanSettingsSchema,
    entries: z
      .array(
        diningEntryFields
          .extend({ date: tripCalendarDateSchema, mealPeriod: z.enum(DINING_MEAL_PERIODS) })
          .superRefine(diningEntryShapeCheck),
      )
      .max(DINING_PLAN_ENTRIES_MAX),
    /** Omitted: one Plan_Stay spanning `stay` (the single-stay behavior). */
    stays: z.array(diningCalculateStaySchema).min(1).max(DINING_PLAN_STAYS_MAX).optional(),
  })
  .strict();
export type DiningCalculateBody = z.output<typeof diningCalculateBodySchema>;

// ---------------------------------------------------------------------------
// Location rules: credit cost by meal period and the seed file (Requirements 8.8, 8.9)
// ---------------------------------------------------------------------------

const creditCostSchema = z.union([z.literal(1), z.literal(2)]);

/** `{ dinner: 2 }`: the Credit_Cost at some meal periods; a missing period uses the rule's `creditCost`. */
export const diningCreditCostByPeriodSchema = z
  .object({ breakfast: creditCostSchema.optional(), lunch: creditCostSchema.optional(), dinner: creditCostSchema.optional() })
  .strict();
export type DiningCreditCostByPeriod = z.output<typeof diningCreditCostByPeriodSchema>;

/**
 * One entry of `locationRules.seed.json`; also the rule part of the Admin_Panel location form. The refinements mirror
 * the CHECK constraints of `dining_plan_location_rules`: a credit cost of 2, a period map or included gratuity need
 * `table_service`, and `verified` needs `verifiedAt`.
 */
export const diningSeedRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    upstreamEntityId: z.string().trim().min(1).max(200).optional(),
    serviceType: z.enum(DINING_SERVICE_TYPES),
    creditCost: creditCostSchema,
    creditCostByPeriod: diningCreditCostByPeriodSchema.optional(),
    gratuityIncluded: z.boolean(),
    ruleStatus: z.enum(DINING_RULE_STATUSES),
    verifiedAt: tripCalendarDateSchema.optional(),
    sourceNote: z.string().trim().min(1).max(DINING_SOURCE_NOTE_MAX),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    const ts = v.serviceType === 'table_service';
    if (v.creditCost === 2 && !ts) issue('creditCost', 'A credit cost of 2 needs table_service');
    if (v.creditCostByPeriod !== undefined && !ts) issue('creditCostByPeriod', 'A credit cost by meal period needs table_service');
    if (v.gratuityIncluded && !ts) issue('gratuityIncluded', 'Included gratuity needs table_service');
    if (v.ruleStatus === 'verified' && v.verifiedAt === undefined) issue('verifiedAt', 'A verified rule needs verifiedAt');
  });
export type DiningSeedRule = z.output<typeof diningSeedRuleSchema>;

// ---------------------------------------------------------------------------
// Budget export (Requirement 26)
// ---------------------------------------------------------------------------

export const diningBudgetExportBodySchema = z
  .object({
    /** Plan_Stay key to option; omitted means the recommended Combination of the current result. */
    combination: z.record(stayKeySchema, z.enum(DINING_STAY_OPTION_CODES)).optional(),
    include: z
      .array(z.enum(DINING_EXPORT_GROUPS))
      .min(1)
      .max(DINING_EXPORT_GROUPS.length)
      .refine((v) => new Set(v).size === v.length, { message: 'include lists a group more than once' })
      .default([...DINING_EXPORT_GROUPS]),
    preview: z.boolean().default(false),
  })
  .strict();
export type DiningBudgetExportBody = z.output<typeof diningBudgetExportBodySchema>;

export type DiningBudgetExportWarningCode = 'tax_rate_mismatch' | 'other_category_taxed';

export interface DiningBudgetExportLineDTO {
  readonly key: string;
  /** Null in a preview. Lines the export deletes are not listed; `deleted` counts them. */
  readonly lineId: string | null;
  readonly description: string;
  readonly category: 'dining' | 'other';
  readonly subtotalCents: number;
}

export interface DiningBudgetExportResultDTO {
  readonly created: number;
  readonly updated: number;
  readonly deleted: number;
  readonly lines: readonly DiningBudgetExportLineDTO[];
  readonly warnings: readonly {
    readonly code: DiningBudgetExportWarningCode;
    readonly calculatorTaxBps?: number;
    readonly budgetTaxBps?: number;
  }[];
}

// ---------------------------------------------------------------------------
// Engine stay input (Multi-Stay Extension)
// ---------------------------------------------------------------------------

export interface EnginePlanStay {
  /** Trip stay id, `implicit:<checkIn>` for a synthesized segment, or the client key on the stateless route. */
  readonly key: string;
  readonly label: string;
  readonly lodgingKind: StayType;
  readonly source: EffectiveStaySource;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partyKeys: readonly string[] | null;
  /** Defaults applied. */
  readonly setting: StayPlanSetting;
}

/** The Trip's stored stays as the service reads them (re-exported shape, so the dining module needs one import). */
export type DiningTripStayRecord = StayRecord;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface DiningPartyPersonDTO {
  readonly key: string;
  readonly label: string;
  readonly ageBracket: AgeBracket;
  readonly passType: TravelerPassType;
}

export interface DiningStayDTO {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly days: number;
  readonly source: 'trip' | 'custom';
}

export interface DiningEntryDTO {
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
  readonly kind: DiningEntryKind;
  readonly experienceId: string | null;
  readonly experienceName: string | null;
  readonly placeholderKind: DiningPlaceholderKind | null;
  readonly plannedItemId: string | null;
  readonly excludedKeys: readonly string[];
}

export interface DiningSuggestionDTO {
  readonly plannedItemId: string;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
  /** `reservation` for a dining reservation, `planned_item` for a planned restaurant without one (Requirement 5.8). */
  readonly source: 'reservation' | 'planned_item';
  readonly partySizeMismatch: boolean;
  readonly alreadyHasEntry: boolean;
}

/** One Dining_Entry in one scenario. */
export interface DiningMealLineDTO {
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
  readonly kind: DiningEntryKind;
  readonly experienceId: string | null;
  readonly label: string;
  readonly serviceType: DiningServiceType;
  readonly creditCost: 1 | 2;
  readonly gratuityIncluded: boolean;
  readonly twoCredit: boolean;
  readonly basis: DiningMenuBasis;
  readonly ruleBasis: DiningRuleBasis;
  /** True iff `ruleBasis` is `unverified`. */
  readonly unverifiedRule: boolean;
  readonly dinerCount: number;
  /** Pre-tax, after the pass discount, before coverage. */
  readonly perDinerFoodCents: { readonly adult: number | null; readonly child: number | null };
  readonly coverage: DiningCoverage;
  readonly creditsUsedPerDiner: number;
  readonly coveredDinerCount: number;
  readonly savingsCents: number;
  /** Food + tax + extras + tip actually paid for this entry. */
  readonly outOfPocketCents: number;
  readonly action: 'use_plan' | 'partly_covered' | 'pay_out_of_pocket' | 'not_applicable';
  readonly reason: DiningUncoveredReason | null;
  /** The Plan_Stay whose night or day this meal falls on (Requirement 25.11). */
  readonly stayKey?: string | null;
  /** The Plan_Stay whose credits cover it; on a Hand_Off_Date this can be either stay. */
  readonly coveredByStayKey?: string | null;
}

export interface CreditCount {
  readonly issued: number;
  readonly used: number;
  readonly unused: number;
}

export interface DiningCreditSummaryDTO {
  readonly ts: CreditCount;
  readonly qs: CreditCount;
  readonly snack: CreditCount;
  readonly snacksPerDayToUseAll: number;
  readonly mugsCovered: number;
}

/** Per-Person amounts of one scenario, for the Budget export only (engine option `includePerPerson`, Requirement 26.14). */
export interface DiningPerPersonAmounts {
  readonly key: string;
  readonly planCostByStay: Readonly<Record<string, number>>;
  readonly oopFoodCents: number;
  readonly oopSnackMugCents: number;
  readonly tipCents: number;
}

export interface DiningScenarioResultDTO {
  readonly code: DiningScenarioCode;
  readonly displayName: string;
  readonly available: boolean;
  readonly unavailableReason: DiningUnavailableReason | null;
  readonly planCostCents: number;
  readonly promoLabel: string | null;
  readonly foodOutOfPocketCents: number;
  readonly taxCents: number;
  readonly tipCents: number;
  readonly snackOutOfPocketCents: number;
  readonly mugOutOfPocketCents: number;
  readonly totalCents: number;
  /** `noPlan.totalCents - totalCents`; 0 for `none`. */
  readonly netSavingsCents: number;
  readonly credits: DiningCreditSummaryDTO | null;
  readonly meals: readonly DiningMealLineDTO[];
  readonly bestCreditUses: readonly {
    readonly date: string;
    readonly mealPeriod: DiningMealPeriod;
    readonly label: string;
    readonly savingsCents: number;
  }[];
  /** Latest `verified_at` among the periods in use; null if any is unverified. */
  readonly priceVerifiedAt: string | null;
  /** The Combination this scenario stands for, by Plan_Stay key (multi-stay results). */
  readonly combination?: Readonly<Record<string, DiningStayOptionCode>>;
  /** Present only when the engine ran with `includePerPerson`; never sent to the client. */
  readonly perPerson?: readonly DiningPerPersonAmounts[];
}

/** One Plan_Stay of a multi-stay result (Requirement 25.11). */
export interface DiningPlanStayResultDTO {
  readonly key: string;
  readonly label: string;
  readonly lodgingKind: StayType;
  readonly source: EffectiveStaySource;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly partyCount: number;
  readonly status: DiningStayPlanStatus;
  readonly heldPlan: DiningPlanCode | null;
  readonly channel: DiningStayChannel;
  readonly available: boolean;
  readonly unavailableReason: DiningUnavailableReason | null;
  readonly recommendedPlan: DiningStayOptionCode;
  readonly planCostCents: number;
  readonly credits: DiningCreditSummaryDTO | null;
  /** How much the recommended total rises if this stay's recommended plan is replaced by no plan. */
  readonly contributionCents: number;
}

export interface DiningCombinationAlternativeDTO {
  readonly combination: Readonly<Record<string, DiningStayOptionCode>>;
  readonly totalCents: number;
  readonly netSavingsCents: number;
}

export type DiningResultWarningCode =
  | 'outside_stay'
  | 'unknown_experience'
  | 'party_size_mismatch'
  | 'no_entries'
  | 'held_plan_price_unknown'
  | 'too_many_compare_stays';

export interface DiningPlanResultDTO {
  /** WDW_Today passed in. */
  readonly computedForDate: string;
  readonly stay: DiningStayDTO;
  readonly eligibleCount: number;
  /** Order: none, quick_service, table_service, deluxe, then mix when present. */
  readonly scenarios: readonly DiningScenarioResultDTO[];
  readonly recommended: DiningScenarioCode;
  readonly verdict: DiningVerdict;
  readonly bestPlan: DiningPlanCode | null;
  readonly evenThresholdCents: number;
  readonly breakEvenGapCents: number;
  readonly sensitivity: readonly {
    readonly orderStyle: DiningOrderStyle;
    readonly bestPlan: DiningPlanCode | null;
    /** The winning scenario code (`'mix'` when a split-stay combination beats uniform plans or cash). */
    readonly recommended?: DiningScenarioCode;
    readonly netSavingsCents: number;
  }[];
  readonly dataQuality: {
    readonly byBasis: Readonly<Record<DiningMenuBasis, number>>;
    readonly estimatedEntries: number;
    readonly unverifiedRules: number;
    readonly derivedRules: number;
    readonly unverifiedPrices: number;
    readonly outsideStayEntries: number;
  };
  readonly assumptions: {
    readonly taxBps: number;
    readonly taxIsDefault: boolean;
    readonly tipBps: number;
    readonly tipIsDefault: boolean;
    readonly planPricesIncludeTax: boolean;
    readonly passDiscountBps: number | null;
    readonly pricesAsOf: string | null;
  };
  readonly warnings: readonly {
    readonly code: DiningResultWarningCode;
    readonly date?: string;
    readonly mealPeriod?: DiningMealPeriod;
    readonly stayKey?: string;
  }[];
  /** Multi-stay detail (Requirement 25.11); present when the Trip has more than one Plan_Stay. */
  readonly stays?: readonly DiningPlanStayResultDTO[];
  readonly recommendedCombination?: Readonly<Record<string, DiningStayOptionCode>>;
  readonly alternatives?: readonly DiningCombinationAlternativeDTO[];
}

export interface DiningPlanDTO {
  readonly settings: DiningPlanSettings;
  readonly entries: readonly DiningEntryDTO[];
  readonly party: readonly DiningPartyPersonDTO[];
  readonly stay: DiningStayDTO;
  readonly suggestions: readonly DiningSuggestionDTO[];
  /** Planned restaurants that could not be placed in a meal slot because they have no meal period or time (Requirement 5.9). */
  readonly suggestionsNeedingMealPeriod: number;
  readonly result: DiningPlanResultDTO;
}

export interface DiningPlanImportResultDTO {
  readonly plan: DiningPlanDTO;
  readonly created: number;
  readonly skippedExisting: number;
  readonly skippedOutOfStay: number;
}
