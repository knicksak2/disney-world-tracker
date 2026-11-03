// Feature: trip-budget, Property 9: Ticket product ids map totally and invertibly
/**
 * Property 9:
 * parseTicketProductId returns null or a record for any string and never throws;
 * for every combination of numDays 1..10, age A|C, option 0|P|PHP|WPS, resident 0|2
 * and park suffix (only for 1-day base), parseTicketProductId(buildTicketProductId(parts)) equals parts;
 * an id whose age, day or resident token disagrees with the response metadata is rejected by crossCheck.
 *
 * Validates: Requirements 11.4, 11.5
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TicketDiscountGroup, TicketOption } from '@dwt/shared';
import {
  buildTicketProductId,
  crossCheck,
  parseTicketProductId,
  type TicketProductParts,
} from '../idMapping.js';

const NUM_RUNS = 100;

const ALL_NUM_DAYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ALL_AGES: ('adult' | 'child')[] = ['adult', 'child'];
const ALL_OPTIONS: TicketOption[] = ['base', 'park_hopper', 'park_hopper_plus', 'water_parks_sports'];
const ALL_DISCOUNTS: TicketDiscountGroup[] = ['std-gst', 'fl-resident'];
const ALL_PARKS: ('any' | 'mk' | 'ep' | 'hs' | 'ak')[] = ['any', 'mk', 'ep', 'hs', 'ak'];

describe('idMapping — Property 9: Ticket product ids map totally and invertibly', () => {
  it('Property 9: build and parse are exact inverses for valid parts', () => {
    // Arbitrary generating valid parts
    const validPartsArb = fc
      .record({
        numDays: fc.constantFrom(...ALL_NUM_DAYS),
        ageGroup: fc.constantFrom(...ALL_AGES),
        optionCode: fc.constantFrom(...ALL_OPTIONS),
        discountGroup: fc.constantFrom(...ALL_DISCOUNTS),
        park: fc.constantFrom(...ALL_PARKS),
      })
      .map((p): TicketProductParts => {
        // Park suffix is only allowed on 1-day base tickets; otherwise park must be 'any'
        if (p.numDays !== 1 || p.optionCode !== 'base') {
          return { ...p, park: 'any' };
        }
        return p;
      });

    fc.assert(
      fc.property(validPartsArb, (parts) => {
        const id = buildTicketProductId(parts);
        const parsed = parseTicketProductId(id);
        expect(parsed).toEqual(parts);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 9: parseTicketProductId is total and never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseTicketProductId(s)).not.toThrow();
        const res = parseTicketProductId(s);
        if (res !== null) {
          expect(res.numDays).toBeGreaterThanOrEqual(1);
          expect(res.numDays).toBeLessThanOrEqual(10);
          expect(['adult', 'child']).toContain(res.ageGroup);
          expect(ALL_OPTIONS).toContain(res.optionCode);
          expect(ALL_DISCOUNTS).toContain(res.discountGroup);
          expect(ALL_PARKS).toContain(res.park);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 9: crossCheck accepts matching entry and requested parameters', () => {
    const parts: TicketProductParts = {
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'park_hopper',
      discountGroup: 'std-gst',
      park: 'any',
    };

    expect(
      crossCheck(parts, { ageGroup: 'adult' }, { numDays: 4, discountGroup: 'std-gst' }),
    ).toBe(true);

    expect(
      crossCheck(parts, { ageGroup: 'ADULT' }, { numDays: 4, discountGroup: 'std-gst' }),
    ).toBe(true);
  });

  it('Property 9: crossCheck rejects disagreeing age, numDays, or discountGroup', () => {
    const parts: TicketProductParts = {
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'park_hopper',
      discountGroup: 'std-gst',
      park: 'any',
    };

    // Age mismatch
    expect(
      crossCheck(parts, { ageGroup: 'child' }, { numDays: 4, discountGroup: 'std-gst' }),
    ).toBe(false);

    // Day mismatch
    expect(
      crossCheck(parts, { ageGroup: 'adult' }, { numDays: 5, discountGroup: 'std-gst' }),
    ).toBe(false);

    // Discount mismatch
    expect(
      crossCheck(parts, { ageGroup: 'adult' }, { numDays: 4, discountGroup: 'fl-resident' }),
    ).toBe(false);
  });

  it('Property 9: 1-day-base-only park suffix rule enforced by crossCheck', () => {
    // 1-day base with park suffix is accepted
    const valid1DayBase: TicketProductParts = {
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'base',
      discountGroup: 'std-gst',
      park: 'mk',
    };
    expect(
      crossCheck(valid1DayBase, { ageGroup: 'adult' }, { numDays: 1, discountGroup: 'std-gst' }),
    ).toBe(true);

    // Park suffix on multi-day is rejected
    const multiDayWithPark: TicketProductParts = {
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      discountGroup: 'std-gst',
      park: 'mk',
    };
    expect(
      crossCheck(multiDayWithPark, { ageGroup: 'adult' }, { numDays: 4, discountGroup: 'std-gst' }),
    ).toBe(false);

    // Park suffix on non-base option is rejected
    const hopperWithPark: TicketProductParts = {
      numDays: 1,
      ageGroup: 'adult',
      optionCode: 'park_hopper',
      discountGroup: 'std-gst',
      park: 'mk',
    };
    expect(
      crossCheck(hopperWithPark, { ageGroup: 'adult' }, { numDays: 1, discountGroup: 'std-gst' }),
    ).toBe(false);
  });
});
