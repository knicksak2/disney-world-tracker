import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  budgetSuggestionDtoSchema,
  TICKET_OPTIONS,
  TICKET_DISCOUNT_GROUPS,
  type TicketOption,
  type TicketDiscountGroup,
  type TravelerProfileDTO,
} from '@dwt/shared';
import { deriveSuggestions } from '../suggestions.js';
import type { PlannedItemRow } from '../types.js';

describe('suggestions', () => {
  // Feature: trip-budget, Property 22: Suggestions are deterministic, idempotent and side-effect free
  // Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5, 16.7, 16.8, 6.7, 9.7
  it('Property 22: deterministic, sorted by key, excludes existing/dismissed keys, omits under3 and passType != none from tickets, and validates schema', () => {
    const plannedItemArb: fc.Arbitrary<PlannedItemRow> = fc.record({
      id: fc.uuid(),
      experienceId: fc.option(fc.uuid(), { nil: null }),
      plannedDate: fc.option(fc.constantFrom('2026-11-01', '2026-11-02'), { nil: null }),
      reservationKind: fc.option(fc.constantFrom('dining', 'ride', 'hotel'), { nil: null }),
      partySize: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
      isLightningLane: fc.boolean(),
    });

    const profileArb: fc.Arbitrary<TravelerProfileDTO> = fc.record({
      id: fc.uuid(),
      memberId: fc.uuid(),
      guestId: fc.constant(null),
      label: fc.string({ minLength: 1, maxLength: 20 }),
      ageBracket: fc.constantFrom('adult', 'child', 'under3'),
      ticketOption: fc.option(fc.constantFrom<TicketOption>(...TICKET_OPTIONS), { nil: null }),
      ticketDays: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
      ticketStartDate: fc.option(fc.constantFrom('2026-11-01', '2026-11-02'), { nil: null }),
      discountGroup: fc.constantFrom<TicketDiscountGroup>(...TICKET_DISCOUNT_GROUPS),
      passType: fc.constantFrom('none', 'annual_pass', 'dvc'),
    });

    fc.assert(
      fc.property(
        fc.array(plannedItemArb, { minLength: 0, maxLength: 6 }),
        fc.array(profileArb, { minLength: 0, maxLength: 6 }),
        (plannedItems, profiles) => {
          const expParkMap = new Map<string, string | null>();
          const serviceStyleMap = new Map<string, readonly string[]>();
          for (const item of plannedItems) {
            if (item.experienceId) {
              expParkMap.set(item.experienceId, 'Magic Kingdom');
              serviceStyleMap.set(item.experienceId, ['table service']);
            }
          }

          const input = {
            plannedItems,
            dayTouringHours: {
              '2026-11-01': { startingPark: 'Magic Kingdom' },
              '2026-11-02': { startingPark: 'EPCOT' },
            },
            profiles,
            tripStart: '2026-11-01',
            existingKeys: new Set<string>(),
            dismissedKeys: new Set<string>(),
            llSingleAvailable: new Set<string>(),
            experiencePark: expParkMap,
            serviceStyleByExperience: serviceStyleMap,
          };

          const s1 = deriveSuggestions(input);
          const s2 = deriveSuggestions(input);

          // 1. Determinism
          expect(s1).toEqual(s2);

          // 2. Sorted by key
          for (let i = 1; i < s1.length; i++) {
            expect(s1[i - 1]!.suggestionKey.localeCompare(s1[i]!.suggestionKey)).toBeLessThanOrEqual(0);
          }

          // 3. No produced key contains 'null'
          for (const s of s1) {
            expect(s.suggestionKey).not.toContain('null');
          }

          // 4. Accepting a suggestion (adding to existingKeys) removes exactly that suggestion
          if (s1.length > 0) {
            const chosen = s1[0]!;
            const filtered = deriveSuggestions({
              ...input,
              existingKeys: new Set([chosen.suggestionKey]),
            });
            expect(filtered.some((s) => s.suggestionKey === chosen.suggestionKey)).toBe(false);
            expect(filtered).toHaveLength(s1.length - 1);
          }

          // 5. Dismissed keys are excluded
          if (s1.length > 0) {
            const chosen = s1[0]!;
            const filtered = deriveSuggestions({
              ...input,
              dismissedKeys: new Set([chosen.suggestionKey]),
            });
            expect(filtered.some((s) => s.suggestionKey === chosen.suggestionKey)).toBe(false);
          }

          // 6. Ticket suggestions omit under3 and passType != none
          for (const s of s1) {
            if (s.kind === 'tickets') {
              for (const alloc of s.draft.allocations) {
                const p = profiles.find((prof) => prof.memberId === alloc.memberId);
                if (p) {
                  expect(p.ageBracket).not.toBe('under3');
                  expect(p.passType).toBe('none');
                }
              }
            }
          }

          // 7. Every produced draft passes schema validation
          for (const s of s1) {
            const parseResult = budgetSuggestionDtoSchema.safeParse(s);
            expect(parseResult.success).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('unit cases', () => {
    it('produces each of the three kinds: dining, LL multi/single, tickets', () => {
      const diningItem: PlannedItemRow = {
        id: 'item-dine',
        experienceId: '11111111-1111-1111-1111-111111111111',
        plannedDate: '2026-11-01',
        reservationKind: 'dining',
        partySize: 4,
        isLightningLane: false,
      };

      const llMultiItem: PlannedItemRow = {
        id: 'item-ll-multi',
        experienceId: '22222222-2222-2222-2222-222222222222',
        plannedDate: '2026-11-01',
        reservationKind: 'ride',
        partySize: 4,
        isLightningLane: true,
      };

      const llSingleItem: PlannedItemRow = {
        id: 'item-ll-single',
        experienceId: '33333333-3333-3333-3333-333333333333',
        plannedDate: '2026-11-02',
        reservationKind: 'ride',
        partySize: 4,
        isLightningLane: true,
      };

      const profile: TravelerProfileDTO = {
        id: 'p1',
        memberId: '44444444-4444-4444-4444-444444444444',
        guestId: null,
        label: 'Alice',
        ageBracket: 'adult',
        ticketOption: 'base',
        ticketDays: 1,
        ticketStartDate: '2026-11-01',
        discountGroup: 'std-gst',
        passType: 'none',
      };

      const res = deriveSuggestions({
        plannedItems: [diningItem, llMultiItem, llSingleItem],
        dayTouringHours: {
          '2026-11-01': { startingPark: 'Magic Kingdom' },
          '2026-11-02': { startingPark: 'EPCOT' },
        },
        profiles: [profile],
        tripStart: '2026-11-01',
        existingKeys: new Set(),
        dismissedKeys: new Set(),
        llSingleAvailable: new Set(['2026-11-02:33333333-3333-3333-3333-333333333333']),
        experiencePark: new Map([
          ['11111111-1111-1111-1111-111111111111', 'Magic Kingdom'],
          ['22222222-2222-2222-2222-222222222222', 'Magic Kingdom'],
          ['33333333-3333-3333-3333-333333333333', 'EPCOT'],
        ]),
        serviceStyleByExperience: new Map([['11111111-1111-1111-1111-111111111111', ['table service']]]),
      });

      expect(res).toHaveLength(4);
      expect(res.map((s) => s.kind).sort()).toEqual([
        'dining',
        'lightning_lane',
        'lightning_lane',
        'tickets',
      ]);
    });

    it('enforces park precedence: Experience park, then dayTouringHours startingPark, then null', () => {
      // 1. Experience park wins over day startingPark
      const dine1: PlannedItemRow = {
        id: 'item-1',
        experienceId: '11111111-1111-1111-1111-111111111111',
        plannedDate: '2026-11-01',
        reservationKind: 'dining',
        partySize: 2,
        isLightningLane: false,
      };

      // 2. Starting park wins when Experience park is null
      const dine2: PlannedItemRow = {
        id: 'item-2',
        experienceId: '22222222-2222-2222-2222-222222222222',
        plannedDate: '2026-11-01',
        reservationKind: 'dining',
        partySize: 2,
        isLightningLane: false,
      };

      // 3. Null when both are missing / non-canonical
      const dine3: PlannedItemRow = {
        id: 'item-3',
        experienceId: '33333333-3333-3333-3333-333333333333',
        plannedDate: '2026-11-03',
        reservationKind: 'dining',
        partySize: 2,
        isLightningLane: false,
      };

      const res = deriveSuggestions({
        plannedItems: [dine1, dine2, dine3],
        dayTouringHours: {
          '2026-11-01': { startingPark: 'EPCOT' },
          '2026-11-03': { startingPark: 'invalid-park-name' },
        },
        profiles: [],
        tripStart: '2026-11-01',
        existingKeys: new Set(),
        dismissedKeys: new Set(),
        llSingleAvailable: new Set(),
        experiencePark: new Map([
          ['11111111-1111-1111-1111-111111111111', 'Magic Kingdom'],
          ['22222222-2222-2222-2222-222222222222', null],
          ['33333333-3333-3333-3333-333333333333', null],
        ]),
        serviceStyleByExperience: new Map(),
      });

      const s1 = res.find((s) => s.suggestionKey === 'planned:item-1');
      expect(s1?.draft.park).toBe('Magic Kingdom');

      const s2 = res.find((s) => s.suggestionKey === 'planned:item-2');
      expect(s2?.draft.park).toBe('EPCOT');

      const s3 = res.find((s) => s.suggestionKey === 'planned:item-3');
      expect(s3?.draft.park).toBeNull();
    });

    it('startingPark mapping: exact canonical name in different case maps; "mk", "Magic Kingdom Park", and "" give null', () => {
      const makeItem = (id: string, date: string): PlannedItemRow => ({
        id,
        experienceId: '11111111-1111-1111-1111-111111111111',
        plannedDate: date,
        reservationKind: 'dining',
        partySize: 2,
        isLightningLane: false,
      });

      const res = deriveSuggestions({
        plannedItems: [
          makeItem('d1', '2026-11-01'),
          makeItem('d2', '2026-11-02'),
          makeItem('d3', '2026-11-03'),
          makeItem('d4', '2026-11-04'),
        ],
        dayTouringHours: {
          '2026-11-01': { startingPark: 'magic kingdom' }, // case-insensitive exact canonical
          '2026-11-02': { startingPark: 'mk' }, // non-canonical
          '2026-11-03': { startingPark: 'Magic Kingdom Park' }, // non-canonical
          '2026-11-04': { startingPark: '' }, // empty
        },
        profiles: [],
        tripStart: '2026-11-01',
        existingKeys: new Set(),
        dismissedKeys: new Set(),
        llSingleAvailable: new Set(),
        experiencePark: new Map([['11111111-1111-1111-1111-111111111111', null]]),
        serviceStyleByExperience: new Map(),
      });

      expect(res.find((s) => s.suggestionKey === 'planned:d1')?.draft.park).toBe('Magic Kingdom');
      expect(res.find((s) => s.suggestionKey === 'planned:d2')?.draft.park).toBeNull();
      expect(res.find((s) => s.suggestionKey === 'planned:d3')?.draft.park).toBeNull();
      expect(res.find((s) => s.suggestionKey === 'planned:d4')?.draft.park).toBeNull();
    });

    it('ticket draft fields (Round 4 L3): 4-day Park Hopper group yields description, plannedDate, park null; 1-day base maps startingPark or null', () => {
      const p1: TravelerProfileDTO = {
        id: 'p1',
        memberId: '11111111-1111-1111-1111-111111111111',
        guestId: null,
        label: 'Alice',
        ageBracket: 'adult',
        ticketOption: 'park_hopper',
        ticketDays: 4,
        ticketStartDate: '2027-03-02',
        discountGroup: 'std-gst',
        passType: 'none',
      };

      const p2: TravelerProfileDTO = {
        id: 'p2',
        memberId: '22222222-2222-2222-2222-222222222222',
        guestId: null,
        label: 'Bob',
        ageBracket: 'adult',
        ticketOption: 'base',
        ticketDays: 1,
        ticketStartDate: '2026-11-01',
        discountGroup: 'std-gst',
        passType: 'none',
      };

      const p3: TravelerProfileDTO = {
        id: 'p3',
        memberId: '33333333-3333-3333-3333-333333333333',
        guestId: null,
        label: 'Charlie',
        ageBracket: 'child',
        ticketOption: 'base',
        ticketDays: 1,
        ticketStartDate: '2026-11-02',
        discountGroup: 'std-gst',
        passType: 'none',
      };

      const res = deriveSuggestions({
        plannedItems: [],
        dayTouringHours: {
          '2026-11-01': { startingPark: 'EPCOT' },
          '2026-11-02': { startingPark: 'mk' }, // non-canonical
        },
        profiles: [p1, p2, p3],
        tripStart: '2026-11-01',
        existingKeys: new Set(),
        dismissedKeys: new Set(),
        llSingleAvailable: new Set(),
        experiencePark: new Map(),
        serviceStyleByExperience: new Map(),
      });

      // 4-day Park Hopper
      const sHopper = res.find((s) => s.suggestionKey.startsWith('ticket:park_hopper'));
      expect(sHopper).toBeDefined();
      expect(sHopper?.draft.description).toBe('4-day Park Hopper tickets');
      expect(sHopper?.draft.plannedDate).toBe('2027-03-02');
      expect(sHopper?.draft.park).toBeNull();
      expect(sHopper?.draft.applyTip).toBe(false);

      // 1-day base with startingPark 'EPCOT'
      const sBaseEpcot = res.find((s) => s.suggestionKey === 'ticket:base:1:2026-11-01:std-gst');
      expect(sBaseEpcot?.draft.park).toBe('EPCOT');
      expect(sBaseEpcot?.draft.priceRef?.park).toBe('ep');

      // 1-day base with non-canonical startingPark 'mk'
      const sBaseMk = res.find((s) => s.suggestionKey === 'ticket:base:1:2026-11-02:std-gst');
      expect(sBaseMk?.draft.park).toBeNull();
      expect(sBaseMk?.draft.priceRef?.park).toBeUndefined();
    });

    it('applies tip for buffet, prix fixe, family style, table service (true), quick service (false), empty list (false), no menu (false)', () => {
      const makeDineItem = (id: string, expId: string): PlannedItemRow => ({
        id,
        experienceId: expId,
        plannedDate: '2026-11-01',
        reservationKind: 'dining',
        partySize: 2,
        isLightningLane: false,
      });

      const res = deriveSuggestions({
        plannedItems: [
          makeDineItem('d-buffet', '11111111-1111-1111-1111-111111111111'),
          makeDineItem('d-prixfixe', '22222222-2222-2222-2222-222222222222'),
          makeDineItem('d-familystyle', '33333333-3333-3333-3333-333333333333'),
          makeDineItem('d-tableservice', '44444444-4444-4444-4444-444444444444'),
          makeDineItem('d-quickservice', '55555555-5555-5555-5555-555555555555'),
          makeDineItem('d-empty', '66666666-6666-6666-6666-666666666666'),
          makeDineItem('d-nomenu', '77777777-7777-7777-7777-777777777777'),
        ],
        dayTouringHours: {},
        profiles: [],
        tripStart: '2026-11-01',
        existingKeys: new Set(),
        dismissedKeys: new Set(),
        llSingleAvailable: new Set(),
        experiencePark: new Map(),
        serviceStyleByExperience: new Map([
          ['11111111-1111-1111-1111-111111111111', ['buffet']],
          ['22222222-2222-2222-2222-222222222222', ['prix fixe']],
          ['33333333-3333-3333-3333-333333333333', ['family style']],
          ['44444444-4444-4444-4444-444444444444', ['table service']],
          ['55555555-5555-5555-5555-555555555555', ['quick service']],
          ['66666666-6666-6666-6666-666666666666', []],
          // '77777777-7777-7777-7777-777777777777' is absent from map
        ]),
      });

      expect(res.find((s) => s.suggestionKey === 'planned:d-buffet')?.draft.applyTip).toBe(true);
      expect(res.find((s) => s.suggestionKey === 'planned:d-prixfixe')?.draft.applyTip).toBe(true);
      expect(res.find((s) => s.suggestionKey === 'planned:d-familystyle')?.draft.applyTip).toBe(true);
      expect(res.find((s) => s.suggestionKey === 'planned:d-tableservice')?.draft.applyTip).toBe(true);
      expect(res.find((s) => s.suggestionKey === 'planned:d-quickservice')?.draft.applyTip).toBe(false);
      expect(res.find((s) => s.suggestionKey === 'planned:d-empty')?.draft.applyTip).toBe(false);
      expect(res.find((s) => s.suggestionKey === 'planned:d-nomenu')?.draft.applyTip).toBe(false);
    });

    it('Round 5 L9: isLightningLane row with null planned_date or null park yields no suggestion, and no key contains "null"', () => {
      const itemNullDate: PlannedItemRow = {
        id: 'll-no-date',
        experienceId: '11111111-1111-1111-1111-111111111111',
        plannedDate: null, // null date
        reservationKind: null,
        partySize: null,
        isLightningLane: true,
      };

      const itemNullPark: PlannedItemRow = {
        id: 'll-no-park',
        experienceId: '22222222-2222-2222-2222-222222222222',
        plannedDate: '2026-11-01',
        reservationKind: null,
        partySize: null,
        isLightningLane: true,
      };

      const itemNoExp: PlannedItemRow = {
        id: 'll-no-exp',
        experienceId: null,
        plannedDate: '2026-11-01',
        reservationKind: null,
        partySize: null,
        isLightningLane: true,
      };

      const itemValid: PlannedItemRow = {
        id: 'll-valid',
        experienceId: '33333333-3333-3333-3333-333333333333',
        plannedDate: '2026-11-01',
        reservationKind: null,
        partySize: null,
        isLightningLane: true,
      };

      const res = deriveSuggestions({
        plannedItems: [itemNullDate, itemNullPark, itemNoExp, itemValid],
        dayTouringHours: {},
        profiles: [],
        tripStart: '2026-11-01',
        existingKeys: new Set(),
        dismissedKeys: new Set(),
        llSingleAvailable: new Set(),
        experiencePark: new Map([
          ['11111111-1111-1111-1111-111111111111', 'Magic Kingdom'],
          ['22222222-2222-2222-2222-222222222222', null], // no park
          ['33333333-3333-3333-3333-333333333333', 'Magic Kingdom'],
        ]),
        serviceStyleByExperience: new Map(),
      });

      // Only the valid item produces a suggestion
      expect(res).toHaveLength(1);
      expect(res[0]?.suggestionKey).toBe('ll:multi:2026-11-01:Magic Kingdom');
      expect(res[0]?.suggestionKey).not.toContain('null');
    });
  });
});
