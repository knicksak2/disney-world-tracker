import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveLinePrices } from '../resolveLinePrices.js';
import type { StoredLine } from '../types.js';
import type { TicketBook } from '../../ticketPrices/resolveTicketPrice.js';
import type { LlBook, ResolveCfg, StoredLlRow } from '../../lightningLane/types.js';
import type { TicketPriceRow, TicketPriceSetMeta } from '../../ticketPrices/types.js';

function makeCfg(overrides?: Partial<ResolveCfg>): ResolveCfg {
  return {
    freshDays: 1,
    estimateAfterDays: 7,
    llStaleHours: 24,
    lookbackDays: 400,
    minSamples: 5,
    allowedNumDaysByGroup: {
      'std-gst': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      'fl-resident': [3, 4],
    },
    ...overrides,
  };
}

const emptyTicketBook: TicketBook = { rows: [], sets: [] };
const emptyLlBook: LlBook = { stored: [], history: new Map() };

describe('resolveLinePrices', () => {
  // Feature: trip-budget, Property 17: A user's price is never overwritten and reads never write
  // Validates: Requirements 5.4, 5.5, 5.6, 5.8, 5.10
  it('Property 17: user_entered and disney_menu allocations preserve stored snapshot amounts, and resolveLinePrices does not mutate its inputs', () => {
    const personKeyArb = fc.uuid().map((id) => `m:${id}` as const);

    const allocArb = fc.record({
      id: fc.uuid(),
      personKey: personKeyArb,
      storedCents: fc.nat(100_000),
      priceRef: fc.constant(null),
    });

    const userLineArb = fc.record({
      id: fc.uuid(),
      category: fc.constant('dining' as const),
      description: fc.string({ minLength: 1, maxLength: 50 }),
      plannedDate: fc.constant('2026-11-01'),
      park: fc.constant(null),
      experienceId: fc.constant(null),
      priceSource: fc.constant('user_entered' as const),
      priceAsOf: fc.constant(new Date('2026-10-25T12:00:00.000Z')),
      priceRef: fc.constant(null),
      applyTip: fc.constant(false),
      allocations: fc.array(allocArb, { minLength: 1, maxLength: 4 }),
    });

    const menuLineArb = fc.record({
      id: fc.uuid(),
      category: fc.constant('dining' as const),
      description: fc.string({ minLength: 1, maxLength: 50 }),
      plannedDate: fc.constant('2026-11-01'),
      park: fc.constant(null),
      experienceId: fc.constant('11111111-1111-1111-1111-111111111111'),
      priceSource: fc.constant('disney_menu' as const),
      priceAsOf: fc.constant(new Date('2026-10-25T12:00:00.000Z')),
      priceRef: fc.constant(null),
      applyTip: fc.constant(true),
      allocations: fc.array(allocArb, { minLength: 1, maxLength: 4 }),
    });

    fc.assert(
      fc.property(
        fc.array(fc.oneof(userLineArb, menuLineArb), { minLength: 1, maxLength: 5 }),
        (lines) => {
          // Deep clone to check immutability
          const linesSnapshot = JSON.parse(JSON.stringify(lines));

          const resolved = resolveLinePrices({
            lines,
            ticketBook: emptyTicketBook,
            llBook: emptyLlBook,
            today: '2026-10-25',
            now: new Date('2026-10-25T12:00:00.000Z'),
            cfg: makeCfg(),
          });

          // Input immutability check
          expect(JSON.parse(JSON.stringify(lines))).toEqual(linesSnapshot);

          // Output guarantees
          for (let i = 0; i < lines.length; i++) {
            const orig = lines[i]!;
            const res = resolved[i]!;

            expect(res.id).toBe(orig.id);
            expect(res.allocations).toHaveLength(orig.allocations.length);

            if (orig.priceSource === 'user_entered') {
              expect(res.effectivePriceSource).toBe('user_entered');
              expect(res.priceLabelKind).toBe('your_price');
              expect(res.attribution).toBeNull();
              for (let j = 0; j < orig.allocations.length; j++) {
                expect(res.allocations[j]!.effectiveCents).toBe(orig.allocations[j]!.storedCents);
                expect(res.allocations[j]!.labelKind).toBe('your_price');
                expect(res.allocations[j]!.effectivePriceSource).toBe('user_entered');
              }
            } else if (orig.priceSource === 'disney_menu') {
              expect(res.effectivePriceSource).toBe('disney_menu');
              expect(res.attribution).toBe('disney');
              for (let j = 0; j < orig.allocations.length; j++) {
                expect(res.allocations[j]!.effectiveCents).toBe(orig.allocations[j]!.storedCents);
                expect(res.allocations[j]!.effectivePriceSource).toBe('disney_menu');
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('unit cases', () => {
    it('ticket line re-prices after a cache change', () => {
      const line: StoredLine = {
        id: 'line-t1',
        category: 'tickets',
        description: '3-day base tickets',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceAsOf: new Date('2026-10-20T12:00:00.000Z'),
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 3,
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2026-11-01',
        },
        applyTip: false,
        allocations: [
          {
            id: 'a1',
            personKey: 'm:user-1',
            storedCents: 35000,
            priceRef: null,
          },
        ],
      };

      const setMeta: TicketPriceSetMeta = {
        discountGroup: 'std-gst',
        numDays: 3,
        asOf: new Date('2026-10-25T12:00:00.000Z'),
        horizonDate: '2026-12-31',
        lastError: null,
      };

      const rowV1: TicketPriceRow = {
        discountGroup: 'std-gst',
        numDays: 3,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-01',
        priceCents: 38000,
        taxCents: 2470,
        validEndDate: '2026-11-05',
        productId: 'prod-1',
      };

      const bookV1: TicketBook = { rows: [rowV1], sets: [setMeta] };

      const resV1 = resolveLinePrices({
        lines: [line],
        ticketBook: bookV1,
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });
      expect(resV1[0]?.allocations[0]?.effectiveCents).toBe(38000);
      expect(resV1[0]?.priceLabelKind).toBe('current');

      // Now cache updates with higher price
      const rowV2: TicketPriceRow = { ...rowV1, priceCents: 39500 };
      const bookV2: TicketBook = { rows: [rowV2], sets: [setMeta] };

      const resV2 = resolveLinePrices({
        lines: [line],
        ticketBook: bookV2,
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });
      expect(resV2[0]?.allocations[0]?.effectiveCents).toBe(39500);
      expect(resV2[0]?.priceLabelKind).toBe('current');
    });

    it('sets estimate label beyond horizon for ticket line', () => {
      const line: StoredLine = {
        id: 'line-t1',
        category: 'tickets',
        description: 'Future ticket beyond horizon',
        plannedDate: '2027-02-01',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceAsOf: new Date('2026-10-25T12:00:00.000Z'),
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 3,
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2027-02-01',
        },
        applyTip: false,
        allocations: [{ id: 'a1', personKey: 'm:user-1', storedCents: 35000, priceRef: null }],
      };

      const setMeta: TicketPriceSetMeta = {
        discountGroup: 'std-gst',
        numDays: 3,
        asOf: new Date('2026-10-25T12:00:00.000Z'),
        horizonDate: '2026-12-31', // horizon is well before 2027-02-01
        lastError: null,
      };

      // Candidate row in horizon on same weekday (Monday: 2026-11-02 and 2027-02-01)
      const row: TicketPriceRow = {
        discountGroup: 'std-gst',
        numDays: 3,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-02',
        priceCents: 37000,
        taxCents: 2405,
        validEndDate: '2026-11-06',
        productId: 'prod-1',
      };

      const res = resolveLinePrices({
        lines: [line],
        ticketBook: { rows: [row], sets: [setMeta] },
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      expect(res[0]?.allocations[0]?.effectiveCents).toBe(37000);
      expect(res[0]?.allocations[0]?.labelKind).toBe('estimate');
      expect(res[0]?.priceLabelKind).toBe('estimate');
    });

    it('falls back to stored snapshot when the ticket cache is empty', () => {
      const line: StoredLine = {
        id: 'line-t1',
        category: 'tickets',
        description: 'Ticket line with empty cache',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceAsOf: new Date('2026-10-25T12:00:00.000Z'),
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 3,
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2026-11-01',
        },
        applyTip: false,
        allocations: [{ id: 'a1', personKey: 'm:user-1', storedCents: 32000, priceRef: null }],
      };

      const res = resolveLinePrices({
        lines: [line],
        ticketBook: emptyTicketBook,
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      expect(res[0]?.allocations[0]?.effectiveCents).toBe(32000); // stored snapshot
      // Worsened to at least may_have_changed
      expect(res[0]?.allocations[0]?.labelKind).toBe('may_have_changed');
      expect(res[0]?.priceLabelKind).toBe('may_have_changed');
      expect(res[0]?.asOf).toEqual(new Date('2026-10-25T12:00:00.000Z'));
    });

    it('shows stored snapshot with stored asOf and aged label for a past-dated ticket line (R14.10)', () => {
      const storedAsOf = new Date('2026-10-10T12:00:00.000Z');
      const line: StoredLine = {
        id: 'line-past',
        category: 'tickets',
        description: 'Past ticket',
        plannedDate: '2026-10-15',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceAsOf: storedAsOf,
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 2,
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2026-10-15', // startDate before today (2026-10-25)
        },
        applyTip: false,
        allocations: [{ id: 'a1', personKey: 'm:user-1', storedCents: 25000, priceRef: null }],
      };

      // Even if cache has rows for future dates
      const setMeta: TicketPriceSetMeta = {
        discountGroup: 'std-gst',
        numDays: 2,
        asOf: new Date('2026-10-25T12:00:00.000Z'),
        horizonDate: '2026-12-31',
        lastError: null,
      };
      const futureRow: TicketPriceRow = {
        discountGroup: 'std-gst',
        numDays: 2,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-01',
        priceCents: 30000,
        taxCents: 1950,
        validEndDate: '2026-11-04',
        productId: 'prod-1',
      };

      const res = resolveLinePrices({
        lines: [line],
        ticketBook: { rows: [futureRow], sets: [setMeta] },
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      // Shows stored snapshot (25000) not future price (30000)
      expect(res[0]?.allocations[0]?.effectiveCents).toBe(25000);
      expect(res[0]?.asOf).toEqual(storedAsOf);
      // Aged label: storedAsOf is 15 days before today (> estimateAfterDays 7), so 'estimate'
      expect(res[0]?.priceLabelKind).toBe('estimate');
    });

    it('maps 1-day base ticket line park through TICKET_PARK_BY_CANONICAL_PARK to resolve that park row', () => {
      const line: StoredLine = {
        id: 'line-1d',
        category: 'tickets',
        description: '1-day Magic Kingdom ticket',
        plannedDate: '2026-11-01',
        park: 'Magic Kingdom', // canonical park name
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceAsOf: new Date('2026-10-25T12:00:00.000Z'),
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 1,
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2026-11-01',
          // park is intentionally omitted here to test mapping from line.park
        },
        applyTip: false,
        allocations: [{ id: 'a1', personKey: 'm:user-1', storedCents: 15000, priceRef: null }],
      };

      const setMeta: TicketPriceSetMeta = {
        discountGroup: 'std-gst',
        numDays: 1,
        asOf: new Date('2026-10-25T12:00:00.000Z'),
        horizonDate: '2026-12-31',
        lastError: null,
      };

      const mkRow: TicketPriceRow = {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'mk',
        startDate: '2026-11-01',
        priceCents: 18900,
        taxCents: 1228,
        validEndDate: '2026-11-01',
        productId: 'prod-mk',
      };

      const epRow: TicketPriceRow = {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'ep',
        startDate: '2026-11-01',
        priceCents: 16900,
        taxCents: 1098,
        validEndDate: '2026-11-01',
        productId: 'prod-ep',
      };

      const res = resolveLinePrices({
        lines: [line],
        ticketBook: { rows: [mkRow, epRow], sets: [setMeta] },
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      // Resolves mkRow (18900) because park was mapped to 'mk'
      expect(res[0]?.allocations[0]?.effectiveCents).toBe(18900);
      expect(res[0]?.allocations[0]?.priceRef).toEqual({
        kind: 'ticket',
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        startDate: '2026-11-01',
        park: 'mk',
      });
    });

    it('gives allocation priceRef precedence over line priceRef', () => {
      const line: StoredLine = {
        id: 'line-mixed',
        category: 'tickets',
        description: 'Family tickets',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceAsOf: new Date('2026-10-25T12:00:00.000Z'),
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 3,
          ageGroup: 'adult', // line-level default adult
          optionCode: 'base',
          startDate: '2026-11-01',
        },
        applyTip: false,
        allocations: [
          {
            id: 'a1',
            personKey: 'm:adult-1',
            storedCents: 35000,
            priceRef: null, // inherits line ref (adult)
          },
          {
            id: 'a2',
            personKey: 'm:child-1',
            storedCents: 33000,
            priceRef: {
              kind: 'ticket',
              discountGroup: 'std-gst',
              numDays: 3,
              ageGroup: 'child', // allocation-specific override (child)
              optionCode: 'base',
              startDate: '2026-11-01',
            },
          },
        ],
      };

      const setMeta: TicketPriceSetMeta = {
        discountGroup: 'std-gst',
        numDays: 3,
        asOf: new Date('2026-10-25T12:00:00.000Z'),
        horizonDate: '2026-12-31',
        lastError: null,
      };

      const adultRow: TicketPriceRow = {
        discountGroup: 'std-gst',
        numDays: 3,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-01',
        priceCents: 38000,
        taxCents: 2470,
        validEndDate: '2026-11-05',
        productId: 'prod-adult',
      };

      const childRow: TicketPriceRow = {
        discountGroup: 'std-gst',
        numDays: 3,
        ageGroup: 'child',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-01',
        priceCents: 36000,
        taxCents: 2340,
        validEndDate: '2026-11-05',
        productId: 'prod-child',
      };

      const res = resolveLinePrices({
        lines: [line],
        ticketBook: { rows: [adultRow, childRow], sets: [setMeta] },
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      expect(res[0]?.allocations[0]?.effectiveCents).toBe(38000);
      expect(res[0]?.allocations[1]?.effectiveCents).toBe(36000);
    });

    it('Review F2: themeparks_ll line resolves to typical_estimate while no stored price exists and resolves to real price once stored row appears', () => {
      const line: StoredLine = {
        id: 'line-ll-1',
        category: 'lightning_lane',
        description: 'Multi Pass Magic Kingdom',
        plannedDate: '2026-11-20',
        park: 'Magic Kingdom',
        experienceId: null,
        priceSource: 'themeparks_ll',
        priceAsOf: new Date('2026-10-20T12:00:00.000Z'),
        priceRef: {
          kind: 'll',
          passType: 'multi',
          park: 'Magic Kingdom',
          date: '2026-11-20',
        },
        applyTip: false,
        allocations: [{ id: 'a1', personKey: 'm:user-1', storedCents: 2900, priceRef: null }],
      };

      // History for typical estimate: 5 samples on Friday in November
      const historyKey = 'multi|Magic Kingdom|';
      const historyRows = [
        { date: '2025-11-07', cents: 3200 },
        { date: '2025-11-14', cents: 3200 },
        { date: '2025-11-21', cents: 3500 },
        { date: '2025-11-28', cents: 3500 },
        { date: '2026-10-16', cents: 3400 },
      ];
      const llBookWithHistoryOnly: LlBook = {
        stored: [],
        history: new Map([[historyKey, historyRows]]),
      };

      // 1. When no stored price row exists: resolves to typical_estimate / estimate
      const res1 = resolveLinePrices({
        lines: [line],
        ticketBook: emptyTicketBook,
        llBook: llBookWithHistoryOnly,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      expect(res1[0]?.allocations[0]?.effectivePriceSource).toBe('typical_estimate');
      expect(res1[0]?.allocations[0]?.labelKind).toBe('estimate');
      expect(res1[0]?.effectivePriceSource).toBe('typical_estimate');
      expect(res1[0]?.priceLabelKind).toBe('estimate');
      expect(res1[0]?.allocations[0]?.effectiveCents).toBeGreaterThan(0);

      // 2. In the SAME test: add a stored real price row for 2026-11-20
      const storedRow: StoredLlRow = {
        passType: 'multi',
        park: 'Magic Kingdom',
        date: '2026-11-20',
        experienceId: null,
        purchaseId: null,
        cents: 3900,
        available: true,
        capturedAt: new Date('2026-10-25T10:00:00.000Z'),
      };
      const llBookWithStored: LlBook = {
        stored: [storedRow],
        history: new Map([[historyKey, historyRows]]),
      };

      const res2 = resolveLinePrices({
        lines: [line],
        ticketBook: emptyTicketBook,
        llBook: llBookWithStored,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      expect(res2[0]?.allocations[0]?.effectiveCents).toBe(3900);
      expect(res2[0]?.allocations[0]?.effectivePriceSource).toBe('themeparks_ll');
      expect(res2[0]?.allocations[0]?.labelKind).toBe('current');
      expect(res2[0]?.effectivePriceSource).toBe('themeparks_ll');
      expect(res2[0]?.priceLabelKind).toBe('current');
    });

    it('stored typical_estimate row with an ll priceRef re-resolves dynamically; without priceRef stays frozen', () => {
      // Line with ll priceRef
      const lineWithRef: StoredLine = {
        id: 'line-te-1',
        category: 'lightning_lane',
        description: 'Multi Pass with ref',
        plannedDate: '2026-11-20',
        park: 'Magic Kingdom',
        experienceId: null,
        priceSource: 'typical_estimate',
        priceAsOf: new Date('2026-10-20T12:00:00.000Z'),
        priceRef: {
          kind: 'll',
          passType: 'multi',
          park: 'Magic Kingdom',
          date: '2026-11-20',
        },
        applyTip: false,
        allocations: [{ id: 'a1', personKey: 'm:user-1', storedCents: 2900, priceRef: null }],
      };

      // Line without priceRef
      const lineWithoutRef: StoredLine = {
        id: 'line-te-2',
        category: 'lightning_lane',
        description: 'Multi Pass without ref',
        plannedDate: '2026-11-20',
        park: 'Magic Kingdom',
        experienceId: null,
        priceSource: 'typical_estimate',
        priceAsOf: new Date('2026-10-20T12:00:00.000Z'),
        priceRef: null,
        applyTip: false,
        allocations: [{ id: 'a2', personKey: 'm:user-1', storedCents: 2900, priceRef: null }],
      };

      const storedRow: StoredLlRow = {
        passType: 'multi',
        park: 'Magic Kingdom',
        date: '2026-11-20',
        experienceId: null,
        purchaseId: null,
        cents: 4200,
        available: true,
        capturedAt: new Date('2026-10-25T10:00:00.000Z'),
      };
      const llBook: LlBook = { stored: [storedRow], history: new Map() };

      const res = resolveLinePrices({
        lines: [lineWithRef, lineWithoutRef],
        ticketBook: emptyTicketBook,
        llBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg(),
      });

      // lineWithRef re-resolved to real price (4200) and themeparks_ll
      expect(res[0]?.allocations[0]?.effectiveCents).toBe(4200);
      expect(res[0]?.effectivePriceSource).toBe('themeparks_ll');
      expect(res[0]?.priceLabelKind).toBe('current');

      // lineWithoutRef stayed frozen as typical_estimate at storedCents (2900)
      expect(res[1]?.allocations[0]?.effectiveCents).toBe(2900);
      expect(res[1]?.effectivePriceSource).toBe('typical_estimate');
      expect(res[1]?.priceLabelKind).toBe('estimate');
    });

    it('Round 5 M3: stored fl-resident ticket line whose pair is no longer permitted falls back to stored snapshot with aged label and no throw', () => {
      const line: StoredLine = {
        id: 'line-fl-1',
        category: 'tickets',
        description: 'Florida Resident 1-day ticket (now unpermitted)',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceAsOf: new Date('2026-10-20T12:00:00.000Z'),
        priceRef: {
          kind: 'ticket',
          discountGroup: 'fl-resident',
          numDays: 1, // Only 3,4 days are permitted in cfg!
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2026-11-01',
        },
        applyTip: false,
        allocations: [{ id: 'a1', personKey: 'm:user-1', storedCents: 11000, priceRef: null }],
      };

      // Set exists in DB
      const setMeta: TicketPriceSetMeta = {
        discountGroup: 'fl-resident',
        numDays: 1,
        asOf: new Date('2026-10-20T12:00:00.000Z'),
        horizonDate: '2026-12-31',
        lastError: null,
      };

      const res = resolveLinePrices({
        lines: [line],
        ticketBook: { rows: [], sets: [setMeta] },
        llBook: emptyLlBook,
        today: '2026-10-25',
        now: new Date('2026-10-25T12:00:00.000Z'),
        cfg: makeCfg({ allowedNumDaysByGroup: { 'std-gst': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'fl-resident': [3, 4] } }),
      });

      // Falls back to stored snapshot (11000)
      expect(res[0]?.allocations[0]?.effectiveCents).toBe(11000);
      // Aged label (worsened to at least may_have_changed)
      expect(res[0]?.priceLabelKind).toBe('may_have_changed');
      expect(res[0]?.asOf).toEqual(new Date('2026-10-20T12:00:00.000Z'));
    });
  });
});
