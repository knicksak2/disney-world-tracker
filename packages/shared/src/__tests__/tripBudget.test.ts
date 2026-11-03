import { describe, expect, it } from 'vitest';
import {
  BUDGET_CATEGORIES,
  BUDGET_DEFAULT_DINING_TIP_BPS,
  BUDGET_DEFAULT_TAX_BPS,
  BUDGET_TO_EXPENSE_CATEGORY,
  EXPENSE_CATEGORIES,
  PRICE_LABEL_KINDS,
  PRICE_SOURCES,
  TICKET_PARK_BY_CANONICAL_PARK,
  TIP_BEARING_SERVICE_STYLES,
  isTipBearingServiceStyle,
  budgetAllocationInputSchema,
  budgetLineInputSchema,
  budgetSettingsPatchSchema,
  budgetSuggestionDtoSchema,
  dismissSuggestionBodySchema,
  formatCalendarDateAsOf,
  priceLabelText,
  priceQuoteBodySchema,
  priceQuoteRequestSchema,
  priceRefSchema,
  travelerProfileInputSchema,
} from '../index.js';

describe('Trip Budget Contracts and Schemas (Task 1.1)', () => {
  const validMemberId = '11111111-1111-4111-8111-111111111111';
  const validGuestId = '22222222-2222-4222-8222-222222222222';
  const validExpId = '33333333-3333-4333-8333-333333333333';

  describe('Enums, constants, and mappings', () => {
    it('BUDGET_TO_EXPENSE_CATEGORY is total across BUDGET_CATEGORIES and targets EXPENSE_CATEGORIES', () => {
      expect(PRICE_LABEL_KINDS.length).toBe(5);
      expect(PRICE_SOURCES.length).toBe(5);
      for (const cat of BUDGET_CATEGORIES) {
        const mapped = BUDGET_TO_EXPENSE_CATEGORY[cat];
        expect(mapped).toBeDefined();
        expect(EXPENSE_CATEGORIES).toContain(mapped);
      }
    });

    it('TICKET_PARK_BY_CANONICAL_PARK covers the four canonical theme parks', () => {
      expect(TICKET_PARK_BY_CANONICAL_PARK['Magic Kingdom']).toBe('mk');
      expect(TICKET_PARK_BY_CANONICAL_PARK['EPCOT']).toBe('ep');
      expect(TICKET_PARK_BY_CANONICAL_PARK['Hollywood Studios']).toBe('hs');
      expect(TICKET_PARK_BY_CANONICAL_PARK['Animal Kingdom']).toBe('ak');
    });

    it('TIP_BEARING_SERVICE_STYLES is sorted and non-empty, and isTipBearingServiceStyle matches case-insensitively (e.g. "Buffet")', () => {
      expect(TIP_BEARING_SERVICE_STYLES.length).toBeGreaterThan(0);
      const sorted = [...TIP_BEARING_SERVICE_STYLES].sort();
      expect([...TIP_BEARING_SERVICE_STYLES]).toEqual(sorted);
      // B3: Test exported isTipBearingServiceStyle helper directly with "Buffet" and case variations
      expect(isTipBearingServiceStyle('Buffet')).toBe(true);
      expect(isTipBearingServiceStyle('TABLE SERVICE')).toBe(true);
      expect(isTipBearingServiceStyle('  Family Style  ')).toBe(true);
      expect(isTipBearingServiceStyle('prix fixe')).toBe(true);
      expect(isTipBearingServiceStyle('Quick Service')).toBe(false);
      expect(isTipBearingServiceStyle(null)).toBe(false);
      expect(isTipBearingServiceStyle(undefined)).toBe(false);
      expect(isTipBearingServiceStyle('')).toBe(false);
    });

    it('BUDGET_DEFAULT_TAX_BPS and TIP_BPS constants exist and have expected defaults', () => {
      expect(BUDGET_DEFAULT_TAX_BPS.tickets).toBe(650);
      expect(BUDGET_DEFAULT_TAX_BPS.dining).toBe(650);
      expect(BUDGET_DEFAULT_TAX_BPS.lodging).toBe(0);
      expect(BUDGET_DEFAULT_DINING_TIP_BPS).toBe(1800);
    });
  });

  describe('priceLabelText and formatCalendarDateAsOf (Requirement 5.3)', () => {
    it('formats calendar dates purely without timezone shifting', () => {
      expect(formatCalendarDateAsOf('2026-10-25')).toBe('Oct 25, 2026');
      expect(formatCalendarDateAsOf('2026-05-04')).toBe('May 4, 2026');
      expect(formatCalendarDateAsOf('2026-01-01')).toBe('Jan 1, 2026');
    });

    it('produces exact strings for your_price and add_your_price regardless of source or date', () => {
      expect(priceLabelText('your_price', 'user_entered', '2026-10-25')).toBe('Your price');
      expect(priceLabelText('your_price', 'disney_ticket_calendar')).toBe('Your price');
      expect(priceLabelText('add_your_price', 'user_entered')).toBe('Add your price');
      expect(priceLabelText('add_your_price', 'themeparks_ll')).toBe('Add your price');
    });

    it('produces exact strings for estimate with and without date', () => {
      expect(priceLabelText('estimate', 'disney_ticket_calendar', '2026-10-25')).toBe('Estimate, as of Oct 25, 2026');
      expect(priceLabelText('estimate', 'themeparks_ll', null)).toBe('Estimate');
      expect(priceLabelText('estimate', 'typical_estimate', '2026-10-25')).toBe('Estimate, as of Oct 25, 2026');
    });

    it('produces exact strings for current across all sources', () => {
      expect(priceLabelText('current', 'disney_ticket_calendar', '2026-10-25')).toBe('Disney price, as of Oct 25, 2026');
      expect(priceLabelText('current', 'themeparks_ll', '2026-10-25')).toBe('Lightning Lane price, as of Oct 25, 2026');
      expect(priceLabelText('current', 'disney_menu', '2026-10-25')).toBe('Disney menu price (before tax), as of Oct 25, 2026');
    });

    it('produces exact strings for may_have_changed across all sources', () => {
      expect(priceLabelText('may_have_changed', 'disney_ticket_calendar', '2026-10-25')).toBe(
        'Disney price, as of Oct 25, 2026 (may have changed)'
      );
      expect(priceLabelText('may_have_changed', 'themeparks_ll', '2026-10-25')).toBe(
        'Lightning Lane price, as of Oct 25, 2026 (may have changed)'
      );
      expect(priceLabelText('may_have_changed', 'disney_menu', '2026-10-25')).toBe(
        'Disney menu price (before tax), as of Oct 25, 2026 (may have changed)'
      );
    });
  });

  describe('priceRefSchema', () => {
    it('validates a ticket priceRef', () => {
      const parsed = priceRefSchema.safeParse({
        kind: 'ticket',
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        startDate: '2026-10-25',
        park: 'mk',
      });
      expect(parsed.success).toBe(true);
    });

    it('validates a lightning lane priceRef', () => {
      const parsed = priceRefSchema.safeParse({
        kind: 'll',
        passType: 'multi',
        park: 'Magic Kingdom',
        date: '2026-10-25',
      });
      expect(parsed.success).toBe(true);
    });

    it('validates a menu priceRef with items XOR tier', () => {
      // Valid with items
      const withItems = priceRefSchema.safeParse({
        kind: 'menu',
        items: [
          { name: 'Burger', priceCents: 1500, priceLabel: '$15.00', quantity: 1, isAlcohol: false },
        ],
      });
      expect(withItems.success).toBe(true);

      // Valid with tier
      const withTier = priceRefSchema.safeParse({
        kind: 'menu',
        tier: { name: 'Adult Buffet', priceCents: 4500 },
      });
      expect(withTier.success).toBe(true);

      // Invalid with both
      const withBoth = priceRefSchema.safeParse({
        kind: 'menu',
        items: [{ name: 'Burger', priceCents: 1500, priceLabel: null, quantity: 1 }],
        tier: { name: 'Adult Buffet', priceCents: 4500 },
      });
      expect(withBoth.success).toBe(false);

      // Invalid with neither
      const withNeither = priceRefSchema.safeParse({
        kind: 'menu',
      });
      expect(withNeither.success).toBe(false);
    });

    it('reports discriminator error for unknown kind', () => {
      const result = priceRefSchema.safeParse({
        kind: 'flight',
        priceCents: 50000,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('budgetAllocationInputSchema', () => {
    it('accepts valid member allocation with amountCents', () => {
      const res = budgetAllocationInputSchema.safeParse({
        memberId: validMemberId,
        amountCents: 2500,
      });
      expect(res.success).toBe(true);
    });

    it('accepts valid guest allocation', () => {
      const res = budgetAllocationInputSchema.safeParse({
        guestId: validGuestId,
        amountCents: 1500,
      });
      expect(res.success).toBe(true);
    });

    it('enforces XOR on memberId and guestId', () => {
      // Both
      const both = budgetAllocationInputSchema.safeParse({
        memberId: validMemberId,
        guestId: validGuestId,
        amountCents: 1500,
      });
      expect(both.success).toBe(false);

      // Neither
      const neither = budgetAllocationInputSchema.safeParse({
        amountCents: 1500,
      });
      expect(neither.success).toBe(false);
    });

    it('rejects unknown properties strictly', () => {
      const res = budgetAllocationInputSchema.safeParse({
        memberId: validMemberId,
        amountCents: 1500,
        extraProp: 'bad',
      });
      expect(res.success).toBe(false);
    });
  });

  describe('budgetLineInputSchema', () => {
    it('rejects typical_estimate as creatable priceSource', () => {
      const res = budgetLineInputSchema.safeParse({
        category: 'lightning_lane',
        description: 'LL Pass',
        priceSource: 'typical_estimate',
        allocations: [{ memberId: validMemberId, amountCents: 3500 }],
      });
      expect(res.success).toBe(false);
    });

    it('requires amountCents on every allocation when priceSource is user_entered', () => {
      const res = budgetLineInputSchema.safeParse({
        category: 'lodging',
        description: 'Hotel room',
        priceSource: 'user_entered',
        allocations: [{ memberId: validMemberId }], // missing amountCents
      });
      expect(res.success).toBe(false);
    });

    it('disney_menu requires category dining, non-null experienceId, and menu priceRef on every allocation', () => {
      // Missing dining category
      const nonDining = budgetLineInputSchema.safeParse({
        category: 'shopping',
        description: 'Merch',
        experienceId: validExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: validMemberId,
            priceRef: { kind: 'menu', tier: { name: 'Tier', priceCents: 2000 } },
          },
        ],
      });
      expect(nonDining.success).toBe(false);

      // Missing experienceId
      const missingExp = budgetLineInputSchema.safeParse({
        category: 'dining',
        description: 'Dinner',
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: validMemberId,
            priceRef: { kind: 'menu', tier: { name: 'Tier', priceCents: 2000 } },
          },
        ],
      });
      expect(missingExp.success).toBe(false);

      // Allocation lacking menu priceRef
      const missingPriceRef = budgetLineInputSchema.safeParse({
        category: 'dining',
        description: 'Dinner',
        experienceId: validExpId,
        priceSource: 'disney_menu',
        allocations: [{ memberId: validMemberId, amountCents: 2000 }],
      });
      expect(missingPriceRef.success).toBe(false);

      // All three present -> accepted
      const validMenuLine = budgetLineInputSchema.safeParse({
        category: 'dining',
        description: 'Dinner',
        experienceId: validExpId,
        priceSource: 'disney_menu',
        allocations: [
          {
            memberId: validMemberId,
            priceRef: { kind: 'menu', tier: { name: 'Tier', priceCents: 2000 } },
          },
        ],
      });
      expect(validMenuLine.success).toBe(true);
    });

    it('rejects applyTip: true on non-dining categories and accepts on dining (R2.3, R7.8)', () => {
      const nonDiningWithTip = budgetLineInputSchema.safeParse({
        category: 'lodging',
        description: 'Hotel',
        priceSource: 'user_entered',
        applyTip: true,
        allocations: [{ memberId: validMemberId, amountCents: 10000 }],
      });
      expect(nonDiningWithTip.success).toBe(false);

      const diningWithTip = budgetLineInputSchema.safeParse({
        category: 'dining',
        description: 'Lunch',
        priceSource: 'user_entered',
        applyTip: true,
        allocations: [{ memberId: validMemberId, amountCents: 5000 }],
      });
      expect(diningWithTip.success).toBe(true);
    });

    it('rejects more than 50 allocations per line', () => {
      const allocations = Array.from({ length: 51 }, (_, i) => ({
        guestId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        amountCents: 100,
      }));
      const res = budgetLineInputSchema.safeParse({
        category: 'shopping',
        description: 'Party Souvenirs',
        priceSource: 'user_entered',
        allocations,
      });
      expect(res.success).toBe(false);
    });

    it('rejects line when total menu items across allocations exceeds BUDGET_MENU_ITEMS_PER_LINE_MAX (100)', () => {
      const items = Array.from({ length: 60 }, (_, i) => ({
        name: `Item ${i}`,
        priceCents: 1000,
        priceLabel: '$10.00',
        quantity: 1,
      }));
      const alloc1 = {
        memberId: validMemberId,
        priceRef: { kind: 'menu' as const, items },
      };
      const alloc2 = {
        guestId: validGuestId,
        priceRef: { kind: 'menu' as const, items },
      };
      // 60 + 60 = 120 items > 100
      const res = budgetLineInputSchema.safeParse({
        category: 'dining',
        description: 'Banquet',
        experienceId: validExpId,
        priceSource: 'disney_menu',
        allocations: [alloc1, alloc2],
      });
      expect(res.success).toBe(false);
    });
  });

  describe('travelerProfileInputSchema and budgetSettingsPatchSchema', () => {
    it('validates traveler profile input with XOR person check', () => {
      const valid = travelerProfileInputSchema.safeParse({
        memberId: validMemberId,
        ageBracket: 'adult',
        ticketOption: 'park_hopper',
        ticketDays: 5,
        ticketStartDate: '2026-10-25',
        discountGroup: 'std-gst',
        passType: 'annual_pass',
      });
      expect(valid.success).toBe(true);

      const both = travelerProfileInputSchema.safeParse({
        memberId: validMemberId,
        guestId: validGuestId,
        ageBracket: 'adult',
      });
      expect(both.success).toBe(false);
    });

    it('validates budget settings patch with range checks', () => {
      const valid = budgetSettingsPatchSchema.safeParse({
        taxBps: { dining: 750, tickets: 650 },
        diningTipBps: 2000,
        savedCents: 50000,
        savingsTargetCents: 200000,
      });
      expect(valid.success).toBe(true);

      // taxBps > 2500 rejected
      const invalidTax = budgetSettingsPatchSchema.safeParse({
        taxBps: { dining: 3000 },
      });
      expect(invalidTax.success).toBe(false);

      // diningTipBps > 5000 rejected
      const invalidTip = budgetSettingsPatchSchema.safeParse({
        diningTipBps: 6000,
      });
      expect(invalidTip.success).toBe(false);
    });
  });

  describe('budgetSuggestionDtoSchema and price quotes', () => {
    it('accepts valid draft and rejects missing needsPrice or invalid park', () => {
      const validSuggestion = {
        suggestionKey: 'sug-123',
        kind: 'dining' as const,
        draft: {
          category: 'dining' as const,
          description: 'Chef Mickey Dinner',
          plannedDate: '2026-10-25',
          park: 'Magic Kingdom' as const,
          experienceId: validExpId,
          priceSource: 'user_entered' as const,
          priceRef: null,
          applyTip: true,
          suggestionKey: 'sug-123',
          partySize: 4,
          allocations: [],
          needsPrice: true,
          needsPeople: true,
        },
      };
      expect(budgetSuggestionDtoSchema.safeParse(validSuggestion).success).toBe(true);

      // Missing needsPrice
      const { needsPrice: _, ...withoutNeedsPrice } = validSuggestion.draft;
      expect(
        budgetSuggestionDtoSchema.safeParse({
          ...validSuggestion,
          draft: withoutNeedsPrice,
        }).success
      ).toBe(false);

      // Invalid park
      expect(
        budgetSuggestionDtoSchema.safeParse({
          ...validSuggestion,
          draft: { ...validSuggestion.draft, park: 'Universal Studios' },
        }).success
      ).toBe(false);
    });

    it('validates price quote body with 1 to 40 requests', () => {
      const singleRequest = {
        kind: 'ticket' as const,
        discountGroup: 'std-gst' as const,
        numDays: 1,
        ageGroup: 'adult' as const,
        optionCode: 'base' as const,
        startDate: '2026-10-25',
        park: 'mk' as const,
      };
      expect(priceQuoteRequestSchema.safeParse(singleRequest).success).toBe(true);

      const singleQuote = {
        requests: [singleRequest],
      };
      expect(priceQuoteBodySchema.safeParse(singleQuote).success).toBe(true);

      expect(priceQuoteBodySchema.safeParse({ requests: [] }).success).toBe(false);
    });

    it('validates dismiss suggestion body', () => {
      expect(dismissSuggestionBodySchema.safeParse({ suggestionKey: 'abc' }).success).toBe(true);
      expect(dismissSuggestionBodySchema.safeParse({ suggestionKey: '' }).success).toBe(false);
    });
  });
});

