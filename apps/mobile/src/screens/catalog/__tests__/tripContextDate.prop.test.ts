// Feature: experience-detail-redesign — property tests for tripContextDate.ts
//
// Property 20: Trip_Context_Date precedence
// Property 21: Trip_Context_Date is total and deterministic
//
// Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5

import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';
import { resolveTripContextDate } from '../tripContextDate';

const NUM_RUNS = 100;

// Helper to generate padded YYYY-MM-DD date strings
const dateArb = fc
  .record({
    year: fc.integer({ min: 2024, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ year, month, day }) => {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  });

// Trip range with startDate <= endDate
const tripRangeArb = fc
  .tuple(dateArb, dateArb)
  .map(([d1, d2]) => {
    const [startDate, endDate] = d1 <= d2 ? [d1, d2] : [d2, d1];
    return { startDate, endDate };
  });

// Arbitrary for todayWdw that specifically targets inside, on boundaries, and outside the trip range
function makeTodayWdwArb(range: { startDate: string; endDate: string } | null) {
  if (!range) {
    return dateArb;
  }
  return fc.oneof(
    { weight: 2, arbitrary: fc.constant(range.startDate) }, // inclusive start boundary
    { weight: 2, arbitrary: fc.constant(range.endDate) },   // inclusive end boundary
    {
      weight: 3,
      arbitrary: dateArb.filter((d) => d >= range.startDate && d <= range.endDate),
    },
    {
      weight: 3,
      arbitrary: dateArb.filter((d) => d < range.startDate || d > range.endDate),
    },
    { weight: 2, arbitrary: dateArb },
  );
}

// Full input generator covering the cross-product
const inputArb = fc
  .record({
    plannedDate: fc.option(dateArb, { nil: null }),
    activeTripRange: fc.option(tripRangeArb, { nil: null }),
    rawToday: dateArb,
  })
  .chain(({ plannedDate, activeTripRange, rawToday }) =>
    makeTodayWdwArb(activeTripRange).map((todayWdw) => ({
      plannedDate,
      activeTripRange,
      todayWdw: todayWdw ?? rawToday,
    })),
  );

describe('tripContextDate pure module', () => {
  // Static check: framework-free contract (R9.1 convention)
  it('imports neither React nor react-navigation', () => {
    const filePath = path.resolve(__dirname, '../tripContextDate.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]react['"]/);
    expect(content).not.toMatch(/from\s+['"]react-native['"]/);
    expect(content).not.toMatch(/from\s+['"]@react-navigation/);
  });

  // Feature: experience-detail-redesign, Property 20: Trip_Context_Date precedence
  // Validates: Requirements 16.1, 16.2, 16.3, 16.4, 16.5
  it('Property 20: resolves trip date per exact precedence rules', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = resolveTripContextDate(input);

        if (input.plannedDate !== null) {
          // R16.1: plannedDate takes top precedence
          expect(result).toBe(input.plannedDate);
        } else if (input.activeTripRange !== null) {
          const { startDate, endDate } = input.activeTripRange;
          if (input.todayWdw >= startDate && input.todayWdw <= endDate) {
            // R16.2: today's date if in trip range
            expect(result).toBe(input.todayWdw);
          } else {
            // R16.3: fallback to trip startDate
            expect(result).toBe(startDate);
          }
        } else {
          // R16.4: no trip -> unresolvable (null)
          expect(result).toBeNull();
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: experience-detail-redesign, Property 21: Trip_Context_Date is total and deterministic
  // Validates: Requirements 16.1, 16.2, 16.3, 16.4
  it('Property 21: is total, never throws, and is deterministic on repeated calls', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        let firstResult: string | null = null;
        let secondResult: string | null = null;

        expect(() => {
          firstResult = resolveTripContextDate(input);
          secondResult = resolveTripContextDate(input);
        }).not.toThrow();

        expect(firstResult).toBe(secondResult);
        if (firstResult !== null) {
          expect(typeof firstResult).toBe('string');
          expect(firstResult).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
