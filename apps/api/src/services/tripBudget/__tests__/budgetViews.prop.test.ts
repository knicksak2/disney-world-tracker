import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BUDGET_CATEGORIES, BUDGET_DEFAULT_TAX_BPS, type BudgetCategory } from '@dwt/shared';
import { computeBudgetViews } from '../budgetViews.js';
import type { BudgetSettingsEffective, PersonIndex, PersonInfo, PersonKey, ResolvedLine } from '../types.js';

const PARKS_SAMPLE = [
  'Magic Kingdom',
  'EPCOT',
  'Hollywood Studios',
  'Animal Kingdom',
  'Typhoon Lagoon',
  'Blizzard Beach',
] as const;

function makeSettings(overrides?: Partial<BudgetSettingsEffective>): BudgetSettingsEffective {
  return {
    taxBps: BUDGET_DEFAULT_TAX_BPS,
    diningTipBps: 1800,
    savedCents: 0,
    savingsTargetCents: null,
    ...overrides,
  };
}

describe('budgetViews', () => {
  // Feature: trip-budget, Property 2: View partitions agree
  // Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.9
  it('Property 2: sums of by-person, by-day, by-park, and by-category each equal whole-party total exactly, with no negative buckets', () => {
    const personKeyArb: fc.Arbitrary<PersonKey> = fc.oneof(
      fc.uuid().map((id) => `m:${id}` as PersonKey),
      fc.uuid().map((id) => `g:${id}` as PersonKey),
    );

    const allocArb = fc.record({
      allocationId: fc.uuid(),
      personKey: personKeyArb,
      storedCents: fc.nat(100_000),
      effectiveCents: fc.nat(100_000),
      labelKind: fc.constant('current' as const),
      effectivePriceSource: fc.constant('user_entered' as const),
      asOf: fc.constant(new Date('2026-10-25T12:00:00Z')),
      priceRef: fc.constant(null),
    });

    const lineArb = fc.record({
      id: fc.uuid(),
      category: fc.constantFrom<BudgetCategory>(...BUDGET_CATEGORIES),
      description: fc.string({ minLength: 1, maxLength: 50 }),
      plannedDate: fc.option(fc.constantFrom('2026-11-01', '2026-11-02', '2026-11-03'), { nil: null }),
      park: fc.option(fc.constantFrom(...PARKS_SAMPLE), { nil: null }),
      experienceId: fc.constant(null),
      priceSource: fc.constant('user_entered' as const),
      priceAsOf: fc.constant(new Date('2026-10-25T12:00:00Z')),
      priceRef: fc.constant(null),
      applyTip: fc.boolean(),
      allocations: fc.array(allocArb, { minLength: 1, maxLength: 6 }),
      effectivePriceSource: fc.constant('user_entered' as const),
      priceLabelKind: fc.constant('current' as const),
      asOf: fc.constant(new Date('2026-10-25T12:00:00Z')),
      soldOut: fc.constant(false),
      attribution: fc.constant(null),
    });

    const settingsArb = fc.record({
      taxBps: fc.record(
        Object.fromEntries(BUDGET_CATEGORIES.map((c) => [c, fc.integer({ min: 0, max: 2500 })])),
      ) as unknown as fc.Arbitrary<Readonly<Record<BudgetCategory, number>>>,
      diningTipBps: fc.integer({ min: 0, max: 5000 }),
      savedCents: fc.nat(1_000_000),
      savingsTargetCents: fc.option(fc.nat(1_000_000), { nil: null }),
    });

    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 0, maxLength: 8 }),
        settingsArb,
        (lines, settings) => {
          const people = new Map<PersonKey, PersonInfo>();
          for (const line of lines) {
            for (const alloc of line.allocations) {
              if (!people.has(alloc.personKey)) {
                people.set(alloc.personKey, {
                  label: `User ${alloc.personKey.slice(2, 6)}`,
                  sponsorMemberId: alloc.personKey.startsWith('g:') ? 'sponsor-123' : null,
                  deleted: false,
                });
              }
            }
          }

          const views = computeBudgetViews(lines as ResolvedLine[], settings, people);

          // Total consistency
          expect(views.total.totalCents).toBe(
            views.total.subtotalCents + views.total.taxCents + views.total.tipCents,
          );

          // Partition sum agreement
          const personSum = views.byPerson.reduce((sum, b) => sum + b.totalCents, 0);
          const daySum = views.byDay.reduce((sum, b) => sum + b.totalCents, 0);
          const parkSum = views.byPark.reduce((sum, b) => sum + b.totalCents, 0);
          const categorySum = views.byCategory.reduce((sum, b) => sum + b.totalCents, 0);

          expect(personSum).toBe(views.total.totalCents);
          expect(daySum).toBe(views.total.totalCents);
          expect(parkSum).toBe(views.total.totalCents);
          expect(categorySum).toBe(views.total.totalCents);

          // No negative buckets in any view
          for (const b of views.byPerson) {
            expect(b.totalCents).toBeGreaterThanOrEqual(0);
          }
          for (const b of views.byDay) {
            expect(b.totalCents).toBeGreaterThanOrEqual(0);
          }
          for (const b of views.byPark) {
            expect(b.totalCents).toBeGreaterThanOrEqual(0);
          }
          for (const b of views.byCategory) {
            expect(b.totalCents).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('unit cases', () => {
    it('places a line with no plannedDate into "unassigned" labelled "Unassigned"', () => {
      const line: ResolvedLine = {
        id: 'l1',
        category: 'tickets',
        description: 'Multi-day tickets',
        plannedDate: null,
        park: null,
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: false,
        allocations: [
          {
            allocationId: 'a1',
            personKey: 'm:11111111-1111-1111-1111-111111111111',
            storedCents: 5000,
            effectiveCents: 5000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const views = computeBudgetViews([line], makeSettings(), new Map());
      const dayBucket = views.byDay.find((b) => b.key === 'unassigned');
      expect(dayBucket).toEqual({
        key: 'unassigned',
        label: 'Unassigned',
        totalCents: 5325, // 5000 + 650 bps tax (325)
      });
      expect(views.byDay).toHaveLength(1);
    });

    it('places a line with no park into "other_resort" labelled "Other (resort or multi-park)"', () => {
      const line: ResolvedLine = {
        id: 'l1',
        category: 'lodging',
        description: 'Resort stay',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: false,
        allocations: [
          {
            allocationId: 'a1',
            personKey: 'm:11111111-1111-1111-1111-111111111111',
            storedCents: 20000,
            effectiveCents: 20000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const views = computeBudgetViews([line], makeSettings(), new Map());
      const parkBucket = views.byPark.find((b) => b.key === 'other_resort');
      expect(parkBucket).toEqual({
        key: 'other_resort',
        label: 'Other (resort or multi-park)',
        totalCents: 20000, // lodging default tax is 0 bps
      });
      expect(views.byPark).toHaveLength(1);
    });

    it('orders person buckets by label then key, days ascending with unassigned last, parks by name with other_resort last, categories in BUDGET_CATEGORIES order', () => {
      const line1: ResolvedLine = {
        id: 'l1',
        category: 'shopping',
        description: 'Souvenirs',
        plannedDate: '2026-11-03',
        park: 'EPCOT',
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: false,
        allocations: [
          {
            allocationId: 'a1',
            personKey: 'm:user-b',
            storedCents: 1000,
            effectiveCents: 1000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const line2: ResolvedLine = {
        id: 'l2',
        category: 'dining',
        description: 'Dinner',
        plannedDate: '2026-11-01',
        park: 'Animal Kingdom',
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: true,
        allocations: [
          {
            allocationId: 'a2',
            personKey: 'm:user-a',
            storedCents: 1000,
            effectiveCents: 1000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const line3: ResolvedLine = {
        id: 'l3',
        category: 'tickets',
        description: 'Pass',
        plannedDate: null,
        park: null,
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: false,
        allocations: [
          {
            allocationId: 'a3',
            personKey: 'm:user-a',
            storedCents: 1000,
            effectiveCents: 1000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const people: PersonIndex = new Map([
        ['m:user-a', { label: 'Alice', sponsorMemberId: null, deleted: false }],
        ['m:user-b', { label: 'Bob', sponsorMemberId: null, deleted: false }],
      ]);

      const views = computeBudgetViews([line1, line2, line3], makeSettings(), people);

      // Persons: Alice before Bob
      expect(views.byPerson.map((b) => b.label)).toEqual(['Alice', 'Bob']);

      // Days: '2026-11-01', '2026-11-03', 'unassigned'
      expect(views.byDay.map((b) => b.key)).toEqual(['2026-11-01', '2026-11-03', 'unassigned']);

      // Parks: 'Animal Kingdom', 'EPCOT', 'other_resort'
      expect(views.byPark.map((b) => b.key)).toEqual(['Animal Kingdom', 'EPCOT', 'other_resort']);

      // Categories: tickets, dining, shopping in BUDGET_CATEGORIES order
      expect(views.byCategory.map((b) => b.key)).toEqual(['tickets', 'dining', 'shopping']);
    });

    it('attaches sponsorMemberId to guest bucket when present', () => {
      const line: ResolvedLine = {
        id: 'l1',
        category: 'dining',
        description: 'Lunch',
        plannedDate: '2026-11-01',
        park: 'Magic Kingdom',
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: false,
        allocations: [
          {
            allocationId: 'a1',
            personKey: 'g:guest-1',
            storedCents: 3000,
            effectiveCents: 3000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const people: PersonIndex = new Map([
        ['g:guest-1', { label: 'Guest Timmy', sponsorMemberId: 'm:sponsor-alice', deleted: false }],
      ]);

      const views = computeBudgetViews([line], makeSettings(), people);
      expect(views.byPerson[0]).toEqual({
        key: 'g:guest-1',
        label: 'Guest Timmy',
        totalCents: 3195, // 3000 + 195 (650 bps)
        sponsorMemberId: 'm:sponsor-alice',
      });
    });

    it('uses "Deleted user" for a person missing from the people index', () => {
      const line: ResolvedLine = {
        id: 'l1',
        category: 'other',
        description: 'Miscellaneous',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: false,
        allocations: [
          {
            allocationId: 'a1',
            personKey: 'm:purged-user',
            storedCents: 1000,
            effectiveCents: 1000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const views = computeBudgetViews([line], makeSettings(), new Map());
      expect(views.byPerson[0]?.label).toBe('Deleted user');
    });

    it('gives a person with only 0-cent allocations a by-person total of exactly 0', () => {
      const line: ResolvedLine = {
        id: 'l1',
        category: 'dining',
        description: 'Snack',
        plannedDate: '2026-11-01',
        park: 'EPCOT',
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: true,
        allocations: [
          {
            allocationId: 'a1',
            personKey: 'm:user-zero',
            storedCents: 0,
            effectiveCents: 0,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
          {
            allocationId: 'a2',
            personKey: 'm:user-paying',
            storedCents: 1000,
            effectiveCents: 1000,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const people: PersonIndex = new Map([
        ['m:user-zero', { label: 'Zero Payer', sponsorMemberId: null, deleted: false }],
        ['m:user-paying', { label: 'Full Payer', sponsorMemberId: null, deleted: false }],
      ]);

      const views = computeBudgetViews([line], makeSettings(), people);
      const zeroBucket = views.byPerson.find((b) => b.key === 'm:user-zero');
      expect(zeroBucket).toBeDefined();
      expect(zeroBucket!.totalCents).toBe(0);
    });

    it('omits empty buckets for unreferenced categories, days, parks, and people', () => {
      const people: PersonIndex = new Map([
        ['m:user-1', { label: 'User 1', sponsorMemberId: null, deleted: false }],
        ['m:user-2', { label: 'User 2', sponsorMemberId: null, deleted: false }],
        ['m:user-3', { label: 'User 3', sponsorMemberId: null, deleted: false }],
      ]);

      // Only lines for user-1 in 'dining' on '2026-11-01' in 'EPCOT'
      const line: ResolvedLine = {
        id: 'l1',
        category: 'dining',
        description: 'Snack',
        plannedDate: '2026-11-01',
        park: 'EPCOT',
        experienceId: null,
        priceSource: 'user_entered',
        priceAsOf: new Date('2026-10-25T12:00:00Z'),
        priceRef: null,
        applyTip: false,
        allocations: [
          {
            allocationId: 'a1',
            personKey: 'm:user-1',
            storedCents: 500,
            effectiveCents: 500,
            labelKind: 'current',
            effectivePriceSource: 'user_entered',
            asOf: new Date('2026-10-25T12:00:00Z'),
            priceRef: null,
          },
        ],
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'current',
        asOf: new Date('2026-10-25T12:00:00Z'),
        soldOut: false,
        attribution: null,
      };

      const views = computeBudgetViews([line], makeSettings(), people);

      // Only user-1 is present in byPerson; user-2 and user-3 are omitted
      expect(views.byPerson).toHaveLength(1);
      expect(views.byPerson[0]?.key).toBe('m:user-1');

      // Only dining is present in byCategory; other 6 categories are omitted
      expect(views.byCategory).toHaveLength(1);
      expect(views.byCategory[0]?.key).toBe('dining');

      // Only EPCOT is present in byPark; other parks and other_resort are omitted
      expect(views.byPark).toHaveLength(1);
      expect(views.byPark[0]?.key).toBe('EPCOT');

      // Only 2026-11-01 is present in byDay; other days and unassigned are omitted
      expect(views.byDay).toHaveLength(1);
      expect(views.byDay[0]?.key).toBe('2026-11-01');
    });
  });
});

