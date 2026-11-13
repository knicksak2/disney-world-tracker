/**
 * Unit tests for the Dining Plan shared contracts (dining-plan-calculator tasks 1.1, 1.3 and 1.4).
 *
 * Validates: Requirements 2.1, 5.8, 6.1 to 6.4, 8.8, 8.9, 16.4, 17.6, 25.3, 25.9, 25.14, 25.17, 26.1, 26.4
 */
import { describe, expect, it } from 'vitest';

import {
  BUDGET_DEFAULT_DINING_TIP_BPS,
  BUDGET_DEFAULT_TAX_BPS,
  DINING_CONFIG_DEFAULTS,
  DINING_EXPORT_KEY_MAX,
  DINING_EXPORT_KEY_PREFIX,
  DINING_PLAN_COMPARE_STAYS_MAX,
  DINING_ORDER_STYLE_PERCENTILE,
  DINING_PLAN_ENTITLEMENTS_PER_NIGHT,
  DINING_PLAN_READ_MAX_STATEMENTS,
  DINING_PLAN_SPAN_MAX_DAYS,
  DINING_PLAN_STAYS_MAX,
  DINING_SCENARIO_CODES,
  diningBudgetExportBodySchema,
  diningCalculateBodySchema,
  diningConfigSchema,
  diningCreditCostByPeriodSchema,
  diningExportKey,
  diningPlanEntryBodySchema,
  diningPlanImportBodySchema,
  diningPlanSettingsSchema,
  diningSeedRuleSchema,
  stayPlanSettingSchema,
} from '../index.js';
import * as shared from '../index.js';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('constants', () => {
  it('entitlements per night match the Disney Dining Plans page', () => {
    expect(DINING_PLAN_ENTITLEMENTS_PER_NIGHT).toEqual({
      quick_service: { ts: 0, qs: 2, snack: 1 },
      table_service: { ts: 1, qs: 1, snack: 1 },
      deluxe: { ts: 2, qs: 1, snack: 1 },
    });
  });

  it('order-style percentiles are 25, 50, 85 and 100', () => {
    expect(DINING_ORDER_STYLE_PERCENTILE).toEqual({ budget: 25, typical: 50, splurge: 85, max_value: 100 });
  });

  it('every runtime export is reachable from the package entry (guards the named-export list)', () => {
    const names = [
      'DINING_PLAN_CODES', 'DINING_SCENARIO_CODES', 'DINING_STAY_OPTION_CODES', 'DINING_PLAN_ENTITLEMENTS_PER_NIGHT',
      'DINING_MEAL_PERIODS', 'DINING_ORDER_STYLES', 'DINING_ORDER_STYLE_PERCENTILE', 'DINING_BEVERAGES', 'DINING_STAY_TYPES',
      'DINING_SERVICE_TYPES', 'DINING_ENTRY_KINDS', 'DINING_PLACEHOLDER_KINDS', 'DINING_MENU_BASES', 'DINING_VERDICTS',
      'DINING_UNAVAILABLE_REASONS', 'DINING_COVERAGE', 'DINING_UNCOVERED_REASONS', 'DINING_RULE_STATUSES',
      'DINING_STAY_PLAN_STATUSES', 'DINING_STAY_CHANNELS', 'DINING_PLAN_STAY_SOURCES', 'DINING_EXPORT_GROUPS',
      'DINING_PLAN_PARTY_MAX', 'DINING_PLAN_ENTRIES_MAX', 'DINING_PLAN_MAX_NIGHTS', 'DINING_EVEN_FLOOR_CENTS', 'DINING_EVEN_BPS',
      'DINING_PLAN_READ_MAX_STATEMENTS', 'DINING_STANDALONE_DEBOUNCE_MS', 'DINING_PLAN_COMPARE_STAYS_MAX',
      'DINING_PLAN_SPAN_MAX_DAYS', 'DINING_PLAN_STAYS_MAX', 'DINING_STAY_KEY_MAX', 'DINING_EXCLUDED_KEYS_MAX',
      'DINING_SOURCE_NOTE_MAX', 'DINING_EXPORT_KEY_PREFIX', 'DINING_EXPORT_KEY_MAX', 'diningExportKey', 'diningConfigSchema',
      'DINING_CONFIG_DEFAULTS', 'stayPlanSettingSchema', 'DINING_STAY_PLAN_SETTING_DEFAULT', 'diningPlanSettingsSchema',
      'diningPlanEntryBodySchema', 'diningPlanImportBodySchema', 'diningCalculateStaySchema', 'diningCalculateBodySchema',
      'diningCreditCostByPeriodSchema', 'diningSeedRuleSchema', 'diningBudgetExportBodySchema', 'classifyMenuGroup',
      'menuGroupItemCents',
    ];
    const missing = names.filter((n) => (shared as Record<string, unknown>)[n] === undefined);
    expect(missing).toEqual([]);
  });

  it('tax and tip defaults are the trip-budget dining defaults, not copies', () => {
    expect(DINING_CONFIG_DEFAULTS.taxBps).toBe(BUDGET_DEFAULT_TAX_BPS.dining);
    expect(DINING_CONFIG_DEFAULTS.tipBps).toBe(BUDGET_DEFAULT_DINING_TIP_BPS);
  });

  it('the multi-stay limits and the read budget', () => {
    expect([DINING_PLAN_COMPARE_STAYS_MAX, DINING_PLAN_SPAN_MAX_DAYS, DINING_PLAN_STAYS_MAX]).toEqual([3, 60, 8]);
    // The design's ceiling of 19, pinned to the measured 17 in task 8 (routes.statementCount.test.ts).
    expect(DINING_PLAN_READ_MAX_STATEMENTS).toBe(17);
    expect(DINING_SCENARIO_CODES).toEqual(['none', 'quick_service', 'table_service', 'deluxe', 'mix']);
  });

  it('DINING_CONFIG_DEFAULTS parses against its own schema', () => {
    expect(diningConfigSchema.parse(DINING_CONFIG_DEFAULTS)).toEqual(DINING_CONFIG_DEFAULTS);
  });
});

describe('diningConfigSchema', () => {
  // Each key just above its upper bound (Configuration & Constants), plus the lower bounds that are not 0.
  it.each([
    ['taxBps', 2501],
    ['tipBps', 5001],
    ['mugCents', 10001],
    ['snackCents', 5001],
    ['softDrinkCents', 3001],
    ['specialtyBeverageCents', 3001],
    ['alcoholBeverageCents', 5001],
    ['dessertCents', 5001],
    ['appetizerCents', 5001],
    ['childFallbackBps', 10001],
    ['passDiningDiscountBps', 5001],
    ['placeholderQsCents', 10001],
    ['placeholderTsCents', 20001],
    ['tipBps', -1],
    ['childFallbackBps', 999],
    ['placeholderQsCents', 99],
    ['placeholderTsCents', 99],
    ['mugCents', 12.5],
  ])('rejects %s = %s', (key, value) => {
    expect(diningConfigSchema.safeParse({ ...DINING_CONFIG_DEFAULTS, [key]: value }).success).toBe(false);
  });

  it('rejects a non-boolean planPricesIncludeTax', () => {
    expect(diningConfigSchema.safeParse({ ...DINING_CONFIG_DEFAULTS, planPricesIncludeTax: 'yes' }).success).toBe(false);
  });

  it('rejects a tier estimate out of range, a missing tier and an unknown key', () => {
    const tiers = DINING_CONFIG_DEFAULTS.tierEstimates;
    expect(
      diningConfigSchema.safeParse({ ...DINING_CONFIG_DEFAULTS, tierEstimates: { ...tiers, quick_service: { ...tiers.quick_service, '4': 10001 } } })
        .success,
    ).toBe(false);
    expect(
      diningConfigSchema.safeParse({ ...DINING_CONFIG_DEFAULTS, tierEstimates: { ...tiers, table_service: { '1': 2800, '2': 4200, '3': 6500 } } })
        .success,
    ).toBe(false);
    expect(diningConfigSchema.safeParse({ ...DINING_CONFIG_DEFAULTS, surprise: 1 }).success).toBe(false);
  });
});

describe('diningPlanSettingsSchema', () => {
  it('fills every default from an empty object', () => {
    expect(diningPlanSettingsSchema.parse({})).toEqual({
      stay: null,
      stayType: 'disney_resort_package',
      orderStyle: 'typical',
      beverage: 'soft_drink',
      alcoholDrinkerKeys: [],
      orderDessert: true,
      appetizersPerTable: 0,
      snacksPerPersonPerDay: 1,
      mugsWanted: 0,
      kidsEatFree: true,
      tipBps: null,
      taxBps: null,
      stayPlans: {},
    });
  });

  it.each([
    ['an inverted custom stay', { stay: { checkIn: '2027-05-10', checkOut: '2027-05-09' } }],
    ['a tax rate over 2500', { taxBps: 2501 }],
    ['a tip rate over 5000', { tipBps: 5001 }],
    ['five appetizers per table', { appetizersPerTable: 5 }],
    ['a malformed drinker key', { alcoholDrinkerKeys: ['user-1'] }],
    ['an unknown order style', { orderStyle: 'lavish' }],
    ['an unknown key', { surprise: true }],
  ])('rejects %s', (_name, body) => {
    expect(diningPlanSettingsSchema.safeParse(body).success).toBe(false);
  });

  it('rejects 51 alcohol drinker keys and accepts 50', () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `m:p${i}`);
    expect(diningPlanSettingsSchema.safeParse({ alcoholDrinkerKeys: keys(51) }).success).toBe(false);
    expect(diningPlanSettingsSchema.safeParse({ alcoholDrinkerKeys: keys(50) }).success).toBe(true);
  });

  it('accepts a one-day custom stay (check-out equal to check-in)', () => {
    expect(diningPlanSettingsSchema.parse({ stay: { checkIn: '2027-05-10', checkOut: '2027-05-10' } }).stay).toEqual({
      checkIn: '2027-05-10',
      checkOut: '2027-05-10',
    });
  });
});

describe('stayPlans (task 1.3)', () => {
  it('defaults a stay plan setting and round-trips a map of them', () => {
    expect(stayPlanSettingSchema.parse({})).toEqual({ status: 'compare', heldPlan: null, channel: 'package' });
    const settings = diningPlanSettingsSchema.parse({
      stayPlans: {
        [UUID]: { status: 'have_plan', heldPlan: 'table_service' },
        'implicit:2027-05-12': { status: 'no_plan', channel: 'dvc_or_passholder' },
      },
    });
    expect(settings.stayPlans).toEqual({
      [UUID]: { status: 'have_plan', heldPlan: 'table_service', channel: 'package' },
      'implicit:2027-05-12': { status: 'no_plan', heldPlan: null, channel: 'dvc_or_passholder' },
    });
    expect(diningPlanSettingsSchema.parse(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it('heldPlan is required exactly when the status is have_plan', () => {
    expect(stayPlanSettingSchema.safeParse({ status: 'have_plan' }).success).toBe(false);
    expect(stayPlanSettingSchema.safeParse({ status: 'compare', heldPlan: 'deluxe' }).success).toBe(false);
    expect(stayPlanSettingSchema.safeParse({ status: 'no_plan', heldPlan: 'quick_service' }).success).toBe(false);
    expect(stayPlanSettingSchema.safeParse({ status: 'have_plan', heldPlan: 'deluxe' }).success).toBe(true);
  });

  it('rejects an unknown status, an unknown channel and an over-long stay key', () => {
    expect(stayPlanSettingSchema.safeParse({ status: 'maybe' }).success).toBe(false);
    expect(stayPlanSettingSchema.safeParse({ channel: 'cruise' }).success).toBe(false);
    expect(diningPlanSettingsSchema.safeParse({ stayPlans: { ['k'.repeat(81)]: {} } }).success).toBe(false);
    expect(diningPlanSettingsSchema.safeParse({ stayPlans: { '': {} } }).success).toBe(false);
  });
});

describe('diningPlanEntryBodySchema (mirrors chk_dpe_shape)', () => {
  it('accepts each kind in its shape and fills defaults', () => {
    expect(diningPlanEntryBodySchema.parse({ kind: 'restaurant', experienceId: UUID })).toEqual({
      kind: 'restaurant',
      experienceId: UUID,
      placeholderKind: null,
      excludedKeys: [],
    });
    expect(diningPlanEntryBodySchema.parse({ kind: 'placeholder', placeholderKind: 'table_service' }).placeholderKind).toBe(
      'table_service',
    );
    expect(diningPlanEntryBodySchema.parse({ kind: 'skip' })).toEqual({
      kind: 'skip',
      experienceId: null,
      placeholderKind: null,
      excludedKeys: [],
    });
  });

  it.each([
    ['a restaurant without an experience', { kind: 'restaurant' }, 'experienceId'],
    ['a restaurant with a placeholder kind', { kind: 'restaurant', experienceId: UUID, placeholderKind: 'quick_service' }, 'placeholderKind'],
    ['a placeholder without its kind', { kind: 'placeholder' }, 'placeholderKind'],
    ['a placeholder with an experience', { kind: 'placeholder', placeholderKind: 'quick_service', experienceId: UUID }, 'experienceId'],
    ['a skip with an experience', { kind: 'skip', experienceId: UUID }, 'experienceId'],
    ['a skip with a placeholder kind', { kind: 'skip', placeholderKind: 'table_service' }, 'placeholderKind'],
  ])('rejects %s', (_name, body, path) => {
    const res = diningPlanEntryBodySchema.safeParse(body);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues.map((i) => i.path.join('.'))).toContain(path);
  });

  it('rejects 51 excluded keys and a non-UUID experience', () => {
    const keys = Array.from({ length: 51 }, (_, i) => `m:${i}`);
    expect(diningPlanEntryBodySchema.safeParse({ kind: 'skip', excludedKeys: keys }).success).toBe(false);
    expect(diningPlanEntryBodySchema.safeParse({ kind: 'restaurant', experienceId: 'abc' }).success).toBe(false);
  });
});

describe('diningPlanImportBodySchema', () => {
  it('defaults overwrite and leaves plannedItemIds optional', () => {
    expect(diningPlanImportBodySchema.parse({})).toEqual({ overwrite: false });
  });
  it('rejects an empty id list and an unknown key', () => {
    expect(diningPlanImportBodySchema.safeParse({ plannedItemIds: [] }).success).toBe(false);
    expect(diningPlanImportBodySchema.safeParse({ all: true }).success).toBe(false);
  });
});

describe('diningCalculateBodySchema', () => {
  const base = {
    party: [{ key: 'g:alice', label: 'Alice', ageBracket: 'adult' }],
    stay: { checkIn: '2027-05-10', checkOut: '2027-05-14' },
    settings: {},
    entries: [{ kind: 'placeholder', placeholderKind: 'quick_service', date: '2027-05-10', mealPeriod: 'lunch' }],
  };
  const stay = (i: number) => ({
    key: `s${i}`,
    label: `Stay ${i}`,
    lodgingKind: 'resort',
    checkIn: '2027-05-10',
    checkOut: '2027-05-11',
  });

  it('accepts a single-stay body and fills defaults', () => {
    const parsed = diningCalculateBodySchema.parse(base);
    expect(parsed.party[0]?.passType).toBe('none');
    expect(parsed.entries[0]?.excludedKeys).toEqual([]);
    expect(parsed.stays).toBeUndefined();
  });

  it('accepts 8 stays with defaults and rejects 9 (Requirement 25.14)', () => {
    const eight = diningCalculateBodySchema.parse({ ...base, stays: Array.from({ length: 8 }, (_, i) => stay(i)) });
    expect(eight.stays).toHaveLength(8);
    expect(eight.stays?.[0]).toMatchObject({
      source: 'stay',
      partyKeys: null,
      setting: { status: 'compare', heldPlan: null, channel: 'package' },
    });
    expect(diningCalculateBodySchema.safeParse({ ...base, stays: Array.from({ length: 9 }, (_, i) => stay(i)) }).success).toBe(false);
  });

  it('rejects 51 people and 121 entries, and accepts 50 and 120', () => {
    const people = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `g:p${i}`, label: `P${i}`, ageBracket: 'adult' }));
    const entries = (n: number) => Array.from({ length: n }, () => ({ kind: 'skip', date: '2027-05-10', mealPeriod: 'lunch' }));
    expect(diningCalculateBodySchema.safeParse({ ...base, party: people(51) }).success).toBe(false);
    expect(diningCalculateBodySchema.safeParse({ ...base, party: people(50) }).success).toBe(true);
    expect(diningCalculateBodySchema.safeParse({ ...base, entries: entries(121) }).success).toBe(false);
    expect(diningCalculateBodySchema.safeParse({ ...base, entries: entries(120) }).success).toBe(true);
  });

  it('rejects an empty party, a snack meal period, an entry in the wrong shape and an inverted stay', () => {
    expect(diningCalculateBodySchema.safeParse({ ...base, party: [] }).success).toBe(false);
    expect(
      diningCalculateBodySchema.safeParse({ ...base, entries: [{ ...base.entries[0], mealPeriod: 'snack' }] }).success,
    ).toBe(false);
    expect(diningCalculateBodySchema.safeParse({ ...base, entries: [{ kind: 'restaurant', date: '2027-05-10', mealPeriod: 'lunch' }] }).success).toBe(
      false,
    );
    expect(diningCalculateBodySchema.safeParse({ ...base, stays: [{ ...stay(0), checkOut: '2027-05-09' }] }).success).toBe(false);
  });
});

describe('diningCreditCostByPeriodSchema (task 1.4)', () => {
  it('accepts a dinner-only map and an empty map', () => {
    expect(diningCreditCostByPeriodSchema.parse({ dinner: 2 })).toEqual({ dinner: 2 });
    expect(diningCreditCostByPeriodSchema.parse({})).toEqual({});
  });
  it.each([
    ['a cost of 3', { dinner: 3 }],
    ['an unknown period', { brunch: 2 }],
    ['a non-object', 2],
    ['an array', [2]],
  ])('rejects %s', (_name, value) => {
    expect(diningCreditCostByPeriodSchema.safeParse(value).success).toBe(false);
  });
});

describe('diningSeedRuleSchema (task 1.4)', () => {
  const examples = [
    {
      name: "Cinderella's Royal Table",
      serviceType: 'table_service',
      creditCost: 2,
      gratuityIncluded: true,
      ruleStatus: 'verified',
      verifiedAt: '2026-11-09',
      sourceNote: 'Disney Dining Plans page 2026-11-09: 2 table-service meals per person; gratuity included',
    },
    {
      name: 'Akershus Royal Banquet Hall',
      serviceType: 'table_service',
      creditCost: 1,
      creditCostByPeriod: { lunch: 2, dinner: 2 },
      gratuityIncluded: false,
      ruleStatus: 'verified',
      verifiedAt: '2026-07-20',
      sourceNote: 'planDisney 2026-07-20: 2 table-service meals at lunch and dinner',
    },
    {
      name: 'Cape Town Lounge and Wine Bar',
      serviceType: 'table_service',
      creditCost: 2,
      gratuityIncluded: false,
      ruleStatus: 'unverified',
      sourceNote: 'The Magic For Less 2026-11 (third party only); confirm in the booking flow',
    },
    {
      name: 'California Grill',
      serviceType: 'not_eligible',
      creditCost: 1,
      gratuityIncluded: false,
      ruleStatus: 'unverified',
      sourceNote:
        'Not on the plan per Disney Tourist Blog 2026-06 and The Magic For Less 2026-11; was 2 credits before its prix-fixe menu; recheck yearly',
    },
  ];

  it('accepts the design examples', () => {
    for (const e of examples) expect(diningSeedRuleSchema.safeParse(e).success).toBe(true);
  });

  it.each([
    ['verified without verifiedAt', { ...examples[0], verifiedAt: undefined }, 'verifiedAt'],
    ['credit cost 2 on quick_service', { ...examples[2], serviceType: 'quick_service' }, 'creditCost'],
    ['a period map on not_eligible', { ...examples[3], creditCostByPeriod: { dinner: 2 } }, 'creditCostByPeriod'],
    ['included gratuity on snack_only', { ...examples[3], serviceType: 'snack_only', gratuityIncluded: true }, 'gratuityIncluded'],
    ['a source note over 200 characters', { ...examples[2], sourceNote: 'x'.repeat(201) }, 'sourceNote'],
    ['an unknown key', { ...examples[2], priceCents: 100 }, ''],
  ])('rejects %s', (_name, body, path) => {
    const res = diningSeedRuleSchema.safeParse(body);
    expect(res.success).toBe(false);
    if (!res.success && path !== '') expect(res.error.issues.map((i) => i.path.join('.'))).toContain(path);
  });
});

describe('diningBudgetExportBodySchema (task 1.4)', () => {
  it('defaults include to all three groups and preview to false', () => {
    expect(diningBudgetExportBodySchema.parse({})).toEqual({ include: ['plan', 'out_of_pocket', 'tips'], preview: false });
  });

  it('accepts a combination by stay key', () => {
    expect(
      diningBudgetExportBodySchema.parse({ combination: { [UUID]: 'table_service', 'implicit:2027-05-12': 'none' }, include: ['plan'] }),
    ).toEqual({ combination: { [UUID]: 'table_service', 'implicit:2027-05-12': 'none' }, include: ['plan'], preview: false });
  });

  it.each([
    ['an empty include', { include: [] }],
    ['a repeated group', { include: ['plan', 'plan'] }],
    ['an unknown group', { include: ['snacks'] }],
    ['an unknown plan code', { combination: { [UUID]: 'premium' } }],
    ['the mix code (not a per-stay option)', { combination: { [UUID]: 'mix' } }],
    ['an unknown key', { dryRun: true }],
  ])('rejects %s', (_name, body) => {
    expect(diningBudgetExportBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('Export_Key', () => {
  it('uses the dining_plan: prefix', () => {
    expect(DINING_EXPORT_KEY_PREFIX).toBe('dining_plan:');
    expect(diningExportKey('plan', UUID)).toBe(`dining_plan:plan:${UUID}`);
    expect(diningExportKey('out_of_pocket')).toBe('dining_plan:oop');
    expect(diningExportKey('tips')).toBe('dining_plan:tips');
    expect(() => diningExportKey('plan')).toThrow();
  });

  it('every key fits the Budget column for stay keys up to 80 characters', () => {
    for (const len of [1, 36, 47, 80]) {
      expect(diningExportKey('plan', 'k'.repeat(len)).length).toBeLessThanOrEqual(DINING_EXPORT_KEY_MAX);
    }
    expect(DINING_EXPORT_KEY_MAX).toBe(120);
  });
});
