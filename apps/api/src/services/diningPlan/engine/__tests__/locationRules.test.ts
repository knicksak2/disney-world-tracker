import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DINING_MEAL_PERIODS, DINING_RULE_STATUSES, DINING_SERVICE_TYPES } from '@dwt/shared';

import { creditCostFor, deriveServiceType, isLoungeOnly, resolveLocationRule } from '../locationRules.js';
import type { LocationRuleRow } from '../types.js';

// Real catalog shapes (`experiences.grouped_facets`, as synced from the Disney facility documents).
const TABLE_SERVICE_FACETS = {
  dining: [{ id: 'table-service-type', name: 'Table Service' }],
  tableService: [
    { id: 'casual-dining', name: 'Casual Dining' },
    { id: 'reservations-accepted', name: 'Reservations Accepted' },
  ],
};
const QUICK_SERVICE_FACETS = {
  dining: [{ id: 'quick-service-type', name: 'Quick Service' }],
  quickService: [{ id: 'counter-service', name: 'Counter Service' }],
};

function row(overrides: Partial<LocationRuleRow> = {}): LocationRuleRow {
  return {
    serviceType: null,
    creditCost: 1,
    creditCostByPeriod: null,
    gratuityIncluded: false,
    passDiscountEligible: null,
    overrideAdultCents: null,
    overrideChildCents: null,
    ruleStatus: 'unverified',
    verifiedAt: null,
    sourceNote: null,
    ...overrides,
  };
}

describe('deriveServiceType', () => {
  it('is table_service for a non-empty tableService group', () => {
    expect(deriveServiceType(TABLE_SERVICE_FACETS)).toBe('table_service');
  });

  it('is quick_service for an empty tableService with a non-empty quickService', () => {
    expect(deriveServiceType({ tableService: [], quickService: [{ id: 'counter-service', name: 'Counter Service' }] })).toBe(
      'quick_service',
    );
    expect(deriveServiceType(QUICK_SERVICE_FACETS)).toBe('quick_service');
  });

  it('prefers table_service when both groups are present', () => {
    expect(deriveServiceType({ ...QUICK_SERVICE_FACETS, ...TABLE_SERVICE_FACETS })).toBe('table_service');
  });

  it('is not_eligible when neither group is present or both are empty', () => {
    expect(deriveServiceType({ dining: [{ id: 'barslounges-type', name: 'Bars/Lounges' }] })).toBe('not_eligible');
    expect(deriveServiceType({ tableService: [], quickService: [] })).toBe('not_eligible');
    expect(deriveServiceType({})).toBe('not_eligible');
  });

  // Shapes as synced to the catalog (2026-11): 64 of 452 active Restaurants are lounge-only.
  it.each([
    ['Sanaa Lounge', { dining: [{ id: 'barslounges-type', name: 'Bars/Lounges' }], tableService: [{ id: 'lounges', name: 'Bar-Lounge' }] }],
    ["Oga's Cantina", { dining: [{ id: 'barslounges-type', name: 'Bars/Lounges' }], tableService: [{ id: 'reservations-accepted', name: 'Reservations Accepted' }, { id: 'lounges', name: 'Bar-Lounge' }] }],
    ['Dockside Margaritas', { tableService: [{ id: 'speciality-food-beverage', name: 'Specialty Food & Beverage' }, { id: 'lounges', name: 'Bar-Lounge' }] }],
    ['Barcelona Lounge', { tableService: [{ id: 'lounges', name: 'Bar-Lounge' }], quickService: [{ id: 'quick-service-coffee', name: 'Coffee' }] }],
  ])('derives the lounge %s as not_eligible (Requirement 8.11)', (_name, facets) => {
    expect(deriveServiceType(facets)).toBe('not_eligible');
    expect(isLoungeOnly(facets)).toBe(true);
  });

  it('keeps a restaurant with a bar as table service, and a pool bar as quick service', () => {
    const raglanRoad = {
      dining: [{ id: 'barslounges-type', name: 'Bars/Lounges' }, { id: 'table-service-type', name: 'Table Service' }],
      tableService: [{ id: 'reservations-accepted', name: 'Reservations Accepted' }, { id: 'casual-dining', name: 'Casual Dining' }, { id: 'a-la-carte', name: 'a la Carte' }, { id: 'lounges', name: 'Bar-Lounge' }],
    };
    expect(deriveServiceType(raglanRoad)).toBe('table_service');
    expect(isLoungeOnly(raglanRoad)).toBe(false);
    const poolBar = { dining: [{ id: 'barslounges-type', name: 'Bars/Lounges' }], quickService: [{ id: 'pool-bars', name: 'Pool Bars' }] };
    expect(deriveServiceType(poolBar)).toBe('quick_service');
  });

  it('lets a stored table-service rule make a lounge eligible', () => {
    const sanaa = { tableService: [{ id: 'lounges', name: 'Bar-Lounge' }] };
    expect(resolveLocationRule(null, { groupedFacets: sanaa }).serviceType).toBe('not_eligible');
    expect(resolveLocationRule(row({ serviceType: 'table_service' }), { groupedFacets: sanaa }).serviceType).toBe('table_service');
    expect(resolveLocationRule(row({ serviceType: null }), { groupedFacets: sanaa }).serviceType).toBe('not_eligible');
  });

  it.each([null, undefined, 'tableService', 42, true, [], [TABLE_SERVICE_FACETS]])(
    'treats a non-object grouped_facets (%j) as empty',
    (value) => {
      expect(deriveServiceType(value)).toBe('not_eligible');
    },
  );

  it('treats non-array group values as empty', () => {
    expect(deriveServiceType({ tableService: 'yes' })).toBe('not_eligible');
    expect(deriveServiceType({ tableService: { 0: { id: 'casual-dining' } } })).toBe('not_eligible');
    expect(deriveServiceType({ tableService: null, quickService: 'counter' })).toBe('not_eligible');
    expect(deriveServiceType({ tableService: 'yes', quickService: [{ id: 'counter-service' }] })).toBe('quick_service');
  });
});

describe('resolveLocationRule', () => {
  it('derives a rule when there is no row: credit cost 1, no gratuity, status derived', () => {
    expect(resolveLocationRule(null, { groupedFacets: TABLE_SERVICE_FACETS })).toEqual({
      serviceType: 'table_service',
      creditCost: 1,
      creditCostByPeriod: null,
      gratuityIncluded: false,
      passDiscountEligible: null,
      overrideAdultCents: null,
      overrideChildCents: null,
      status: 'derived',
    });
    expect(resolveLocationRule(null, { groupedFacets: QUICK_SERVICE_FACETS }).serviceType).toBe('quick_service');
  });

  it('lets stored fields override the derived ones (Cinderella Royal Table shape)', () => {
    const resolved = resolveLocationRule(
      row({
        serviceType: 'table_service',
        creditCost: 2,
        gratuityIncluded: true,
        passDiscountEligible: false,
        overrideAdultCents: 7_900,
        overrideChildCents: 4_700,
        ruleStatus: 'verified',
        verifiedAt: '2026-11-09',
      }),
      { groupedFacets: QUICK_SERVICE_FACETS },
    );
    expect(resolved).toEqual({
      serviceType: 'table_service',
      creditCost: 2,
      creditCostByPeriod: null,
      gratuityIncluded: true,
      passDiscountEligible: false,
      overrideAdultCents: 7_900,
      overrideChildCents: 4_700,
      status: 'verified',
    });
  });

  it('derives the service type when the stored service type is NULL, keeping the other stored fields', () => {
    const resolved = resolveLocationRule(row({ serviceType: null, overrideAdultCents: 3_000 }), {
      groupedFacets: QUICK_SERVICE_FACETS,
    });
    expect(resolved.serviceType).toBe('quick_service');
    expect(resolved.overrideAdultCents).toBe(3_000);
    expect(resolved.status).toBe('unverified');
  });

  it('reports the stored status: verified, unverified; and derived only without a row', () => {
    expect(resolveLocationRule(row({ ruleStatus: 'verified', verifiedAt: '2026-11-09' }), { groupedFacets: {} }).status).toBe(
      'verified',
    );
    expect(resolveLocationRule(row({ ruleStatus: 'unverified' }), { groupedFacets: {} }).status).toBe('unverified');
    expect(resolveLocationRule(null, { groupedFacets: {} }).status).toBe('derived');
  });

  it('keeps a stored snack_only or not_eligible service type over a table-service derivation', () => {
    expect(resolveLocationRule(row({ serviceType: 'snack_only' }), { groupedFacets: TABLE_SERVICE_FACETS }).serviceType).toBe(
      'snack_only',
    );
    expect(
      resolveLocationRule(row({ serviceType: 'not_eligible' }), { groupedFacets: TABLE_SERVICE_FACETS }).serviceType,
    ).toBe('not_eligible');
  });

  it('never yields two credits, a period map or included gratuity outside table service', () => {
    const resolved = resolveLocationRule(
      row({ serviceType: null, creditCost: 2, creditCostByPeriod: { dinner: 2 }, gratuityIncluded: true }),
      { groupedFacets: QUICK_SERVICE_FACETS },
    );
    expect(resolved.creditCost).toBe(1);
    expect(resolved.creditCostByPeriod).toBeNull();
    expect(resolved.gratuityIncluded).toBe(false);
  });

  it('ignores override cents that are not positive integers', () => {
    const resolved = resolveLocationRule(row({ overrideAdultCents: 0, overrideChildCents: 12.5 }), { groupedFacets: {} });
    expect(resolved.overrideAdultCents).toBeNull();
    expect(resolved.overrideChildCents).toBeNull();
  });

  it('drops period-map entries other than breakfast, lunch or dinner with value 1 or 2', () => {
    const malformed = { dinner: 2, brunch: 2, lunch: 3 } as unknown as LocationRuleRow['creditCostByPeriod'];
    const resolved = resolveLocationRule(row({ serviceType: 'table_service', creditCostByPeriod: malformed }), {
      groupedFacets: {},
    });
    expect(resolved.creditCostByPeriod).toEqual({ dinner: 2 });
  });
});

describe('creditCostFor', () => {
  // Feature: dining-plan-calculator, Property 39: Credit cost follows the meal period (resolver half)
  // Validates: Requirements 8.8
  it('Property 39: an Akershus-shaped rule costs 1 at breakfast and 2 at lunch and dinner', () => {
    const akershus = resolveLocationRule(
      row({ serviceType: 'table_service', creditCost: 1, creditCostByPeriod: { lunch: 2, dinner: 2 } }),
      { groupedFacets: TABLE_SERVICE_FACETS },
    );
    expect(creditCostFor(akershus, 'breakfast')).toBe(1);
    expect(creditCostFor(akershus, 'lunch')).toBe(2);
    expect(creditCostFor(akershus, 'dinner')).toBe(2);
  });

  it('uses creditCost when there is no map, and when the map lacks the period', () => {
    const cinderella = resolveLocationRule(row({ serviceType: 'table_service', creditCost: 2 }), { groupedFacets: {} });
    for (const period of DINING_MEAL_PERIODS) expect(creditCostFor(cinderella, period)).toBe(2);
    const morimoto = resolveLocationRule(row({ serviceType: 'table_service', creditCostByPeriod: { dinner: 2 } }), {
      groupedFacets: {},
    });
    expect(creditCostFor(morimoto, 'lunch')).toBe(1);
    expect(creditCostFor(morimoto, 'dinner')).toBe(2);
  });

  it('lets the period map lower a two-credit rule at one period', () => {
    const rule = resolveLocationRule(row({ serviceType: 'table_service', creditCost: 2, creditCostByPeriod: { breakfast: 1 } }), {
      groupedFacets: {},
    });
    expect(creditCostFor(rule, 'breakfast')).toBe(1);
    expect(creditCostFor(rule, 'dinner')).toBe(2);
  });
});

describe('location rule properties', () => {
  const facetGroupArb = fc.oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.constant([]),
    fc.array(fc.record({ id: fc.oneof(fc.string(), fc.constantFrom('lounges', 'reservations-accepted', 'speciality-food-beverage', 'casual-dining')), name: fc.string() }), { minLength: 1, maxLength: 3 }),
    fc.string(),
    fc.integer(),
    fc.dictionary(fc.string(), fc.string()),
  );
  const facetsArb = fc.oneof(
    fc.record({ tableService: facetGroupArb, quickService: facetGroupArb, dining: facetGroupArb }, { requiredKeys: [] }),
    fc.anything(),
  );
  const rowArb: fc.Arbitrary<LocationRuleRow> = fc.record({
    serviceType: fc.constantFrom(null, ...DINING_SERVICE_TYPES),
    creditCost: fc.constantFrom(1 as const, 2 as const),
    creditCostByPeriod: fc.oneof(
      fc.constant(null),
      fc.record(
        { breakfast: fc.constantFrom(1 as const, 2 as const), lunch: fc.constantFrom(1 as const, 2 as const), dinner: fc.constantFrom(1 as const, 2 as const) },
        { requiredKeys: [] },
      ),
    ),
    gratuityIncluded: fc.boolean(),
    passDiscountEligible: fc.constantFrom(null, true, false),
    overrideAdultCents: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 100_000 })),
    overrideChildCents: fc.oneof(fc.constant(null), fc.integer({ min: 1, max: 100_000 })),
    ruleStatus: fc.constantFrom(...DINING_RULE_STATUSES),
    verifiedAt: fc.constantFrom(null, '2026-11-09'),
    sourceNote: fc.constant(null),
  });

  function oracle(facets: unknown): string {
    if (facets === null || typeof facets !== 'object' || Array.isArray(facets)) return 'not_eligible';
    const f = facets as Record<string, unknown>;
    // Facet entries without a string id are ignored.
    const tsIds = (Array.isArray(f.tableService) ? f.tableService : [])
      .map((x: unknown) => (x !== null && typeof x === 'object' ? (x as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === 'string');
    const nonMeal = ['lounges', 'reservations-accepted', 'reservations-strongly-recommended', 'speciality-food-beverage'];
    if (tsIds.includes('lounges') && tsIds.every((id) => nonMeal.includes(id))) return 'not_eligible';
    if (Array.isArray(f.tableService) && f.tableService.length > 0) return 'table_service';
    if (Array.isArray(f.quickService) && f.quickService.length > 0) return 'quick_service';
    return 'not_eligible';
  }

  // Feature: dining-plan-calculator, Property 15: Service type derivation and rule constraints (derivation half)
  // Validates: Requirements 8.1, 8.2, 8.5, 8.6
  it('Property 15: derivation is total; a derived rule is 1 credit, no gratuity, derived; stored fields override; 2 credits only for table service', () => {
    fc.assert(
      fc.property(facetsArb, fc.option(rowArb, { nil: null }), (facets, stored) => {
        const derivedType = deriveServiceType(facets);
        expect(derivedType).toBe(oracle(facets));

        const resolved = resolveLocationRule(stored, { groupedFacets: facets });
        if (stored === null) {
          expect(resolved.serviceType).toBe(derivedType);
          expect(resolved.creditCost).toBe(1);
          expect(resolved.gratuityIncluded).toBe(false);
          expect(resolved.status).toBe('derived');
          for (const period of DINING_MEAL_PERIODS) expect(creditCostFor(resolved, period)).toBe(1);
          return;
        }
        expect(resolved.serviceType).toBe(stored.serviceType ?? derivedType);
        expect(resolved.status).toBe(stored.ruleStatus);
        expect(resolved.passDiscountEligible).toBe(stored.passDiscountEligible);
        expect(resolved.overrideAdultCents).toBe(stored.overrideAdultCents);
        expect(resolved.overrideChildCents).toBe(stored.overrideChildCents);
        const tableService = resolved.serviceType === 'table_service';
        expect(resolved.creditCost).toBe(tableService ? stored.creditCost : 1);
        expect(resolved.gratuityIncluded).toBe(tableService && stored.gratuityIncluded);
        for (const period of DINING_MEAL_PERIODS) {
          const cost = creditCostFor(resolved, period);
          if (!tableService) expect(cost).toBe(1);
          else expect(cost).toBe(stored.creditCostByPeriod?.[period] ?? stored.creditCost);
        }
      }),
      { numRuns: 300 },
    );
  });
});
