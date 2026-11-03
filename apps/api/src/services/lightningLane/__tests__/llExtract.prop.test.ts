// Feature: trip-budget, Property 18: Schedule array converts to deterministic, deduplicated price maps
/**
 * Property 18 (design.md):
 * extractLlPrices produces at most one multi and one premier price per calendar date
 * and dedupes singles by purchaseId; within each date, the first valid purchase wins;
 * dates are sorted ascending; non-positive, non-integer or non-USD amounts are ignored;
 * package purchases with prefix lightninglanemultipass_ are never classified as single.
 *
 * Validates: Requirements 15.2, 15.3
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { classifyPurchase, extractLlPrices } from '../llExtract.js';
import type { ThemeParksScheduleEntry, ThemeParksPurchase } from '../../live/themeParksLiveClient.js';

const NUM_RUNS = 100;

describe('llExtract unit tests and fixtures', () => {
  it('correctly extracts from a realistic per-park schedule fixture', () => {
    const schedule: ThemeParksScheduleEntry[] = [
      {
        date: '2026-10-25T00:00:00Z',
        type: 'OPERATING',
        openingTime: '2026-10-25T09:00:00Z',
        closingTime: '2026-10-25T21:00:00Z',
        purchases: [
          {
            id: 'lightninglanemultipass_80007944',
            name: 'Lightning Lane Multi Pass',
            type: 'PACKAGE',
            available: true,
            price: { amount: 3200, currency: 'USD' },
          },
          {
            id: 'premierpass_80007944',
            name: 'Lightning Lane Premier Pass',
            type: 'PACKAGE',
            available: true,
            price: { amount: 39900, currency: 'USD' },
          },
          {
            id: 'lightninglane_16767284',
            name: 'Space Mountain',
            type: 'ATTRACTION',
            available: true,
            price: { amount: 1400, currency: 'USD' },
          },
        ],
      },
      {
        date: '2026-10-25T00:00:00Z',
        type: 'TICKETED_EVENT',
        openingTime: '2026-10-25T19:00:00Z',
        closingTime: '2026-10-25T23:59:00Z',
        // TICKETED_EVENT without purchases on the same date
      },
      {
        date: '2026-10-26T00:00:00Z',
        type: 'OPERATING',
        // A date with no purchases
        purchases: [],
      },
    ];

    const extracted = extractLlPrices(schedule);
    expect(extracted).toHaveLength(2);

    // 2026-10-25
    expect(extracted[0]!.date).toBe('2026-10-25');
    expect(extracted[0]!.multi).toEqual({ cents: 3200, available: true });
    expect(extracted[0]!.premier).toEqual({ cents: 39900, available: true });
    expect(extracted[0]!.singles).toEqual([
      {
        purchaseId: 'lightninglane_16767284',
        attractionName: 'Space Mountain',
        cents: 1400,
        available: true,
      },
    ]);

    // 2026-10-26
    expect(extracted[1]!.date).toBe('2026-10-26');
    expect(extracted[1]!.multi).toBeUndefined();
    expect(extracted[1]!.premier).toBeUndefined();
    expect(extracted[1]!.singles).toEqual([]);
  });

  it('lightninglanemultipass_ is NEVER classified as single, even under ATTRACTION type', () => {
    const maliciousPurchase: ThemeParksPurchase = {
      id: 'lightninglanemultipass_80007944',
      type: 'ATTRACTION',
      name: 'Sneaky Multi Pass',
      price: { amount: 3000, currency: 'USD' },
    };
    expect(classifyPurchase(maliciousPurchase)).toBeNull();
  });

  it('a renamed package with the same id prefix is still classified by id prefix', () => {
    const renamedMulti: ThemeParksPurchase = {
      id: 'lightninglanemultipass_custom123',
      type: 'PACKAGE',
      name: 'Super Magic Pass Deluxe',
      price: { amount: 3500, currency: 'USD' },
    };
    expect(classifyPurchase(renamedMulti)).toEqual({
      kind: 'multi',
      id: 'lightninglanemultipass_custom123',
    });

    const renamedPremier: ThemeParksPurchase = {
      id: 'premierpass_custom456',
      type: 'PACKAGE',
      name: 'VIP Premier Service',
      price: { amount: 45000, currency: 'USD' },
    };
    expect(classifyPurchase(renamedPremier)).toEqual({
      kind: 'premier',
      id: 'premierpass_custom456',
    });
  });

  it('first-valid-wins within a date', () => {
    const schedule: ThemeParksScheduleEntry[] = [
      {
        date: '2026-11-01T00:00:00Z',
        purchases: [
          {
            id: 'lightninglanemultipass_first',
            type: 'PACKAGE',
            price: { amount: 2800, currency: 'USD' },
          },
          {
            id: 'lightninglanemultipass_second',
            type: 'PACKAGE',
            price: { amount: 3500, currency: 'USD' },
          },
          {
            id: 'lightninglane_attraction_1',
            type: 'ATTRACTION',
            name: 'First Attraction Name',
            price: { amount: 1200, currency: 'USD' },
          },
          {
            id: 'lightninglane_attraction_1',
            type: 'ATTRACTION',
            name: 'Second Duplicate Name',
            price: { amount: 1500, currency: 'USD' },
          },
        ],
      },
    ];

    const res = extractLlPrices(schedule);
    expect(res).toHaveLength(1);
    expect(res[0]!.multi?.cents).toBe(2800);
    expect(res[0]!.singles).toHaveLength(1);
    expect(res[0]!.singles[0]!.cents).toBe(1200);
    expect(res[0]!.singles[0]!.attractionName).toBe('First Attraction Name');
  });

  it('ignores non-positive, non-integer, or non-USD prices', () => {
    const schedule: ThemeParksScheduleEntry[] = [
      {
        date: '2026-11-02T00:00:00Z',
        purchases: [
          {
            id: 'lightninglanemultipass_zero',
            type: 'PACKAGE',
            price: { amount: 0, currency: 'USD' },
          },
          {
            id: 'lightninglanemultipass_negative',
            type: 'PACKAGE',
            price: { amount: -500, currency: 'USD' },
          },
          {
            id: 'lightninglanemultipass_float',
            type: 'PACKAGE',
            price: { amount: 25.5, currency: 'USD' },
          },
          {
            id: 'lightninglanemultipass_eur',
            type: 'PACKAGE',
            price: { amount: 3000, currency: 'EUR' },
          },
        ],
      },
    ];

    const res = extractLlPrices(schedule);
    expect(res).toHaveLength(1);
    expect(res[0]!.multi).toBeUndefined();
  });
});

describe('Property 18: Schedule array converts to deterministic, deduplicated price maps', () => {
  const arbitraryPurchase = fc.record({
    id: fc.oneof(
      fc.string().map((s) => `lightninglanemultipass_${s}`),
      fc.string().map((s) => `premierpass_${s}`),
      fc.string().map((s) => `lightninglane_${s}`),
      fc.string(),
    ),
    name: fc.oneof(
      fc.constant('Lightning Lane Multi Pass'),
      fc.constant('Lightning Lane Premier Pass'),
      fc.string(),
    ),
    type: fc.oneof(
      fc.constant('PACKAGE'),
      fc.constant('ATTRACTION'),
      fc.constant('OPERATING'),
      fc.string(),
    ),
    available: fc.oneof(fc.boolean(), fc.constant(undefined)),
    amount: fc.oneof(fc.integer({ min: -500, max: 100000 }), fc.double(), fc.constant(undefined)),
    currency: fc.oneof(fc.constant('USD'), fc.constant('EUR'), fc.string(), fc.constant(undefined)),
  }).map(({ id, name, type, available, amount, currency }) => {
    const p: { id?: string; name?: string; type?: string; available?: boolean; price?: { amount?: number; currency?: string } } = {};
    if (id !== undefined) p.id = id;
    if (name !== undefined) p.name = name;
    if (type !== undefined) p.type = type;
    if (available !== undefined) p.available = available;
    if (amount !== undefined) {
      const pr: { amount?: number; currency?: string } = { amount: amount as number };
      if (currency !== undefined) pr.currency = currency;
      p.price = pr;
    }
    return p;
  });

  const arbitraryScheduleEntry = fc.record({
    date: fc.date({ min: new Date('2026-01-01'), max: new Date('2028-12-31') }).map((d) => d.toISOString()),
    type: fc.oneof(fc.constant('OPERATING'), fc.constant('TICKETED_EVENT'), fc.string()),
    purchases: fc.array(arbitraryPurchase, { maxLength: 8 }),
  });

  it('produces at most one multi/premier per date, dedupes singles by purchaseId, and sorts dates ascending', () => {
    fc.assert(
      fc.property(fc.array(arbitraryScheduleEntry, { maxLength: 10 }), (schedule) => {
        const extracted = extractLlPrices(schedule);

        // Dates are sorted strictly ascending
        for (let i = 1; i < extracted.length; i++) {
          expect(extracted[i - 1]!.date < extracted[i]!.date).toBe(true);
        }

        for (const day of extracted) {
          // At most one multi
          if (day.multi) {
            expect(day.multi.cents).toBeGreaterThan(0);
            expect(Number.isInteger(day.multi.cents)).toBe(true);
          }

          // At most one premier
          if (day.premier) {
            expect(day.premier.cents).toBeGreaterThan(0);
            expect(Number.isInteger(day.premier.cents)).toBe(true);
          }

          // Singles are deduped by purchaseId
          const singleIds = new Set<string>();
          for (const s of day.singles) {
            expect(singleIds.has(s.purchaseId)).toBe(false);
            singleIds.add(s.purchaseId);
            expect(s.cents).toBeGreaterThan(0);
            expect(Number.isInteger(s.cents)).toBe(true);
            expect(s.purchaseId.startsWith('lightninglane_')).toBe(true);
            expect(s.purchaseId.startsWith('lightninglanemultipass_')).toBe(false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
