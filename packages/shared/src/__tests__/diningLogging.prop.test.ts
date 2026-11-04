// Feature: unified-dining-logging, Property 4: Grouping Dishes by Visit Date Preserves All Dishes Per Date
//
// Validates: Requirements 1.1, 2.1, 4.2, 4.3

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createFoodItemLogInputSchema,
  groupDishesByVisitDate,
  hasVisitOnDate,
} from '../index.js';

const isoDateArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  );

const dishLogArb = fc.record({
  id: fc.uuid(),
  foodItemName: fc.string({ minLength: 1, maxLength: 50 }),
  visitedOn: isoDateArb,
  rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
});

describe('Feature: unified-dining-logging, Property 4: Grouping Dishes by Visit Date Preserves All Dishes Per Date', () => {
  it('hasVisitOnDate returns true iff at least one Experience_Log matches visitedOn', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ visitedOn: isoDateArb }), { maxLength: 30 }),
        isoDateArb,
        (logs, targetDate) => {
          const actual = hasVisitOnDate(logs, targetDate);
          const expected = logs.some((l) => l.visitedOn === targetDate);
          expect(actual).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('groupDishesByVisitDate maps every dish to its exact visitedOn key in input order', () => {
    fc.assert(
      fc.property(fc.array(dishLogArb, { maxLength: 40 }), (dishes) => {
        const grouped = groupDishesByVisitDate(dishes);

        let totalGrouped = 0;
        for (const [dateKey, bucket] of grouped.entries()) {
          totalGrouped += bucket.length;
          const expectedForDate = dishes.filter((d) => d.visitedOn === dateKey);
          expect(bucket).toEqual(expectedForDate);
        }
        expect(totalGrouped).toBe(dishes.length);
      }),
      { numRuns: 100 },
    );
  });
});

describe('createFoodItemLogInputSchema (Requirement 1.1)', () => {
  const validUuid = '11111111-1111-4111-8111-111111111111';
  const validUuid2 = '22222222-2222-4222-8222-222222222222';

  it('accepts optional tripId and rodeWith', () => {
    const parsed = createFoodItemLogInputSchema.parse({
      visitedOn: '2026-11-04',
      userTz: 'America/New_York',
      rating: 9,
      note: 'Great pod',
      tripId: validUuid,
      rodeWith: [validUuid2],
    });
    expect(parsed.tripId).toBe(validUuid);
    expect(parsed.rodeWith).toEqual([validUuid2]);
  });

  it('accepts null tripId and omitted tripId/rodeWith (backward compatible)', () => {
    const parsedNull = createFoodItemLogInputSchema.parse({
      visitedOn: '2026-11-04',
      userTz: 'America/New_York',
      tripId: null,
    });
    expect(parsedNull.tripId).toBeNull();

    const parsedOmitted = createFoodItemLogInputSchema.parse({
      visitedOn: '2026-11-04',
      userTz: 'America/New_York',
    });
    expect(parsedOmitted.tripId).toBeUndefined();
    expect(parsedOmitted.rodeWith).toBeUndefined();
  });

  it('rejects non-UUID tripId, non-UUID rodeWith entry, and unknown keys', () => {
    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: '2026-11-04',
        userTz: 'America/New_York',
        tripId: 'not-a-uuid',
      }).success,
    ).toBe(false);

    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: '2026-11-04',
        userTz: 'America/New_York',
        rodeWith: ['not-a-uuid'],
      }).success,
    ).toBe(false);

    expect(
      createFoodItemLogInputSchema.safeParse({
        visitedOn: '2026-11-04',
        userTz: 'America/New_York',
        extraField: true,
      }).success,
    ).toBe(false);
  });
});

