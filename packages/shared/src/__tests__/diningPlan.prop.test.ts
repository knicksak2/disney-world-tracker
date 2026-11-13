// Feature: dining-plan-calculator, Property 28: Admin and shared schemas round-trip
// Validates: Requirements 6.1, 6.3, 6.4, 16.4, 17.6, 25.3, 25.17
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  AGE_BRACKETS,
  DINING_BEVERAGES,
  DINING_CONFIG_DEFAULTS,
  DINING_MEAL_PERIODS,
  DINING_ORDER_STYLES,
  DINING_PLAN_CODES,
  DINING_STAY_CHANNELS,
  DINING_STAY_TYPES,
  STAY_TYPES,
  TRAVELER_PASS_TYPES,
  addCalendarDays,
  diningCalculateBodySchema,
  diningConfigSchema,
  diningPlanEntryBodySchema,
  diningPlanSettingsSchema,
} from '../index.js';

const RUNS = 100;
const BASE = '2027-03-01';
const day = (n: number): string => addCalendarDays(BASE, n);

const keyArb = fc
  .tuple(fc.constantFrom('m', 'g'), fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/))
  .map(([p, id]) => `${p}:${id}`);
const uuidArb = fc.uuid().map((u) => u.toLowerCase());

const stayPlanArb = fc.oneof(
  fc.record({ status: fc.constant('have_plan' as const), heldPlan: fc.constantFrom(...DINING_PLAN_CODES), channel: fc.constantFrom(...DINING_STAY_CHANNELS) }),
  fc.record({ status: fc.constantFrom('compare' as const, 'no_plan' as const), heldPlan: fc.constant(null), channel: fc.constantFrom(...DINING_STAY_CHANNELS) }),
);

const settingsArb = fc.record({
  stay: fc.option(fc.tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 20 })).map(([a, n]) => ({ checkIn: day(a), checkOut: day(a + n) })), {
    nil: null,
  }),
  stayType: fc.constantFrom(...DINING_STAY_TYPES),
  orderStyle: fc.constantFrom(...DINING_ORDER_STYLES),
  beverage: fc.constantFrom(...DINING_BEVERAGES),
  alcoholDrinkerKeys: fc.array(keyArb, { maxLength: 5 }),
  orderDessert: fc.boolean(),
  appetizersPerTable: fc.integer({ min: 0, max: 4 }),
  snacksPerPersonPerDay: fc.integer({ min: 0, max: 4 }),
  mugsWanted: fc.integer({ min: 0, max: 50 }),
  kidsEatFree: fc.boolean(),
  tipBps: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
  taxBps: fc.option(fc.integer({ min: 0, max: 2500 }), { nil: null }),
  stayPlans: fc.dictionary(fc.oneof(uuidArb, fc.integer({ min: 0, max: 60 }).map((n) => `implicit:${day(n)}`)), stayPlanArb, { maxKeys: 4 }),
});

const entryArb = fc.oneof(
  fc.record({ kind: fc.constant('restaurant' as const), experienceId: uuidArb, placeholderKind: fc.constant(null), excludedKeys: fc.array(keyArb, { maxLength: 4 }) }),
  fc.record({
    kind: fc.constant('placeholder' as const),
    experienceId: fc.constant(null),
    placeholderKind: fc.constantFrom('quick_service' as const, 'table_service' as const),
    excludedKeys: fc.array(keyArb, { maxLength: 4 }),
  }),
  fc.record({ kind: fc.constant('skip' as const), experienceId: fc.constant(null), placeholderKind: fc.constant(null), excludedKeys: fc.array(keyArb, { maxLength: 4 }) }),
);

const calculateArb = fc.record({
  party: fc.array(
    fc.record({ key: keyArb, label: fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}[A-Za-z]$/), ageBracket: fc.constantFrom(...AGE_BRACKETS), passType: fc.constantFrom(...TRAVELER_PASS_TYPES) }),
    { minLength: 1, maxLength: 6 },
  ),
  stay: fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 14 })).map(([a, n]) => ({ checkIn: day(a), checkOut: day(a + n) })),
  settings: settingsArb,
  entries: fc.array(
    fc.tuple(entryArb, fc.integer({ min: 0, max: 40 }), fc.constantFrom(...DINING_MEAL_PERIODS)).map(([e, n, mealPeriod]) => ({ ...e, date: day(n), mealPeriod })),
    { maxLength: 6 },
  ),
  stays: fc.option(
    fc.array(
      fc.record({
        key: fc.stringMatching(/^[a-z0-9-]{1,20}$/),
        label: fc.stringMatching(/^[A-Za-z][A-Za-z ]{0,20}[A-Za-z]$/),
        lodgingKind: fc.constantFrom(...STAY_TYPES),
        source: fc.constantFrom('stay' as const, 'legacy_resorts' as const, 'implicit_no_lodging' as const, 'implicit_gap' as const),
        checkIn: fc.integer({ min: 0, max: 10 }).map(day),
        checkOut: fc.integer({ min: 11, max: 20 }).map(day),
        partyKeys: fc.option(fc.array(keyArb, { maxLength: 3 }), { nil: null }),
        setting: stayPlanArb,
      }),
      { minLength: 1, maxLength: 8 },
    ),
    { nil: undefined },
  ),
}).map((v) => (v.stays === undefined ? { party: v.party, stay: v.stay, settings: v.settings, entries: v.entries } : v));

const configArb = fc.record({
  taxBps: fc.integer({ min: 0, max: 2500 }),
  tipBps: fc.integer({ min: 0, max: 5000 }),
  planPricesIncludeTax: fc.boolean(),
  mugCents: fc.integer({ min: 0, max: 10000 }),
  snackCents: fc.integer({ min: 0, max: 5000 }),
  softDrinkCents: fc.integer({ min: 0, max: 3000 }),
  specialtyBeverageCents: fc.integer({ min: 0, max: 3000 }),
  alcoholBeverageCents: fc.integer({ min: 0, max: 5000 }),
  dessertCents: fc.integer({ min: 0, max: 5000 }),
  appetizerCents: fc.integer({ min: 0, max: 5000 }),
  childFallbackBps: fc.integer({ min: 1000, max: 10000 }),
  passDiningDiscountBps: fc.integer({ min: 0, max: 5000 }),
  placeholderQsCents: fc.integer({ min: 100, max: 10000 }),
  placeholderTsCents: fc.integer({ min: 100, max: 20000 }),
  tierEstimates: fc.record({
    table_service: fc.record({ '1': fc.integer({ min: 100, max: 30000 }), '2': fc.integer({ min: 100, max: 30000 }), '3': fc.integer({ min: 100, max: 30000 }), '4': fc.integer({ min: 100, max: 30000 }) }),
    quick_service: fc.record({ '1': fc.integer({ min: 100, max: 10000 }), '2': fc.integer({ min: 100, max: 10000 }), '3': fc.integer({ min: 100, max: 10000 }), '4': fc.integer({ min: 100, max: 10000 }) }),
  }),
});

/** parse, serialize through JSON (the wire), parse again: the two parsed values are equal. */
function roundTrips(schema: { parse: (v: unknown) => unknown }, value: unknown): void {
  const once = schema.parse(value);
  const twice = schema.parse(JSON.parse(JSON.stringify(once)));
  expect(twice).toEqual(once);
}

describe('Property 28: Admin and shared schemas round-trip', () => {
  it('settings round-trip and keep every supplied value', () => {
    fc.assert(
      fc.property(settingsArb, (s) => {
        roundTrips(diningPlanSettingsSchema, s);
        expect(diningPlanSettingsSchema.parse(s)).toEqual(s);
      }),
      { numRuns: RUNS },
    );
  });

  it('entry bodies round-trip', () => {
    fc.assert(fc.property(entryArb, (e) => roundTrips(diningPlanEntryBodySchema, e)), { numRuns: RUNS });
  });

  it('calculate bodies round-trip, with and without stays', () => {
    fc.assert(fc.property(calculateArb, (b) => roundTrips(diningCalculateBodySchema, b)), { numRuns: RUNS });
  });

  it('configs round-trip; DINING_CONFIG_DEFAULTS itself parses', () => {
    expect(diningConfigSchema.parse(DINING_CONFIG_DEFAULTS)).toEqual(DINING_CONFIG_DEFAULTS);
    fc.assert(fc.property(configArb, (c) => roundTrips(diningConfigSchema, c)), { numRuns: RUNS });
  });

  it('any out-of-range number in settings or config is rejected', () => {
    const settingsBounds: [string, number, number][] = [
      ['appetizersPerTable', 0, 4],
      ['snacksPerPersonPerDay', 0, 4],
      ['mugsWanted', 0, 50],
      ['tipBps', 0, 5000],
      ['taxBps', 0, 2500],
    ];
    const configBounds: [string, number, number][] = [
      ['taxBps', 0, 2500],
      ['tipBps', 0, 5000],
      ['mugCents', 0, 10000],
      ['childFallbackBps', 1000, 10000],
      ['placeholderQsCents', 100, 10000],
      ['placeholderTsCents', 100, 20000],
    ];
    const outside = (min: number, max: number) =>
      fc.oneof(fc.integer({ min: max + 1, max: max + 100000 }), fc.integer({ min: min - 100000, max: min - 1 }), fc.double({ min, max, noInteger: true }));
    fc.assert(
      fc.property(fc.constantFrom(...settingsBounds), fc.context(), (bound, ctx) => {
        const [key, min, max] = bound;
        fc.assert(
          fc.property(outside(min, max), (n) => {
            ctx.log(`${key}=${n}`);
            expect(diningPlanSettingsSchema.safeParse({ [key]: n }).success).toBe(false);
          }),
          { numRuns: 20 },
        );
      }),
      { numRuns: RUNS },
    );
    fc.assert(
      fc.property(fc.constantFrom(...configBounds), (bound) => {
        const [key, min, max] = bound;
        fc.assert(
          fc.property(outside(min, max), (n) => {
            expect(diningConfigSchema.safeParse({ ...DINING_CONFIG_DEFAULTS, [key]: n }).success).toBe(false);
          }),
          { numRuns: 20 },
        );
      }),
      { numRuns: RUNS },
    );
  });

  it('any unknown key or malformed person key is rejected', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{3,12}$/).filter((k) => !(k in diningPlanSettingsSchema.shape)),
        fc.string({ maxLength: 20 }).filter((s) => !/^[mg]:[A-Za-z0-9_-]{1,64}$/u.test(s)),
        (unknownKey, badPersonKey) => {
          expect(diningPlanSettingsSchema.safeParse({ [unknownKey]: 1 }).success).toBe(false);
          expect(diningPlanSettingsSchema.safeParse({ alcoholDrinkerKeys: [badPersonKey] }).success).toBe(false);
          expect(diningPlanEntryBodySchema.safeParse({ kind: 'skip', excludedKeys: [badPersonKey] }).success).toBe(false);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
