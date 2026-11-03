import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dedupeByKey, type StorableTicketPriceRow } from '../repo.js';

describe('dedupeByKey (Property 12 pure half)', () => {
  it('deduplicates identical primary keys', () => {
    const row1: StorableTicketPriceRow = {
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      park: 'any',
      startDate: '2026-11-01',
      priceCents: 50000,
      taxCents: 3250,
      validEndDate: '2026-11-07',
      productId: 'theme-park_4_A_0_0_RF_AF_SOF_progenstr',
    };
    const row2: StorableTicketPriceRow = {
      ...row1,
      priceCents: 52000, // Updated price
    };

    const deduped = dedupeByKey([row1, row2]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.priceCents).toBe(52000); // Last-write wins
  });

  // Feature: trip-budget, Property 12: Deduplication and upsert idempotency (pure half)
  it('Property 12 pure half: dedupeByKey produces strictly unique primary keys (fast-check, 100 runs)', () => {
    const rowArb = fc.record({
      discountGroup: fc.constantFrom<'std-gst' | 'fl-resident'>('std-gst', 'fl-resident'),
      numDays: fc.integer({ min: 1, max: 10 }),
      ageGroup: fc.constantFrom<'adult' | 'child'>('adult', 'child'),
      optionCode: fc.constantFrom<'base' | 'park_hopper' | 'park_hopper_plus' | 'water_parks_sports'>(
        'base',
        'park_hopper',
        'park_hopper_plus',
        'water_parks_sports',
      ),
      park: fc.constantFrom<'any' | 'mk' | 'ep' | 'hs' | 'ak'>('any', 'mk', 'ep', 'hs', 'ak'),
      startDate: fc.constantFrom('2026-11-01', '2026-11-02', '2026-11-03'),
      priceCents: fc.integer({ min: 1000, max: 100000 }),
      taxCents: fc.integer({ min: 0, max: 10000 }),
      validEndDate: fc.constant('2026-11-10'),
      productId: fc.constant('product_id_test'),
    });

    fc.assert(
      fc.property(fc.array(rowArb, { minLength: 0, maxLength: 50 }), (rows) => {
        const deduped = dedupeByKey(rows);
        const keys = deduped.map(
          (r) => `${r.discountGroup}|${r.numDays}|${r.ageGroup}|${r.optionCode}|${r.park}|${r.startDate}`,
        );
        const uniqueKeys = new Set(keys);
        expect(keys.length).toBe(uniqueKeys.size);

        // Idempotence: dedupeByKey(deduped) === deduped
        const dedupedAgain = dedupeByKey(deduped);
        expect(dedupedAgain).toEqual(deduped);
      }),
      { numRuns: 100 },
    );
  });
});

