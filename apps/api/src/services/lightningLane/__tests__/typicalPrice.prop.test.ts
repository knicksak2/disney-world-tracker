import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { medianCents, typicalLlPrice } from '../typicalPrice.js';
import { wdwDayOfWeek } from '../../trips/wdwClock.js';
import { daysBetween, addDays } from '../../ticketPrices/dates.js';

describe('typicalPrice', () => {
  describe('medianCents', () => {
    it('throws RangeError on empty array', () => {
      expect(() => medianCents([])).toThrow(RangeError);
    });

    it('returns exact value for single element', () => {
      expect(medianCents([1500])).toBe(1500);
    });

    it('returns middle element for odd length arrays', () => {
      expect(medianCents([100, 300, 200])).toBe(200);
      expect(medianCents([500, 100, 400, 200, 300])).toBe(300);
    });

    it('handles even-length rounding unit cases', () => {
      // (100 + 200) / 2 = 150
      expect(medianCents([100, 200])).toBe(150);
      // (100 + 201) / 2 = 150.5 -> 151
      expect(medianCents([100, 201])).toBe(151);
      // (100 + 202) / 2 = 151
      expect(medianCents([100, 202])).toBe(151);
      // Unsorted even array
      expect(medianCents([400, 100, 200, 300])).toBe(250);
    });
  });

  // Feature: trip-budget, Property 20: The typical price is bounded and conservative
  describe('Property 20: The typical price is bounded and conservative', () => {
    // Generate valid YYYY-MM-DD dates relative to a base date
    const baseDate = '2026-06-15';

    const sampleGen = fc.record({
      offsetDays: fc.integer({ min: -180, max: 30 }),
      cents: fc.integer({ min: 1000, max: 50000 }),
    });

    it('satisfies Property 20 across randomized inputs (100 runs)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: -60, max: 60 }), // today offset
          fc.integer({ min: -30, max: 120 }), // target offset
          fc.integer({ min: 30, max: 120 }), // lookbackDays
          fc.integer({ min: 1, max: 5 }), // minSamples
          fc.array(sampleGen, { minLength: 0, maxLength: 40 }),
          (todayOffset, targetOffset, lookbackDays, minSamples, sampleSpecs) => {
            const today = addDays(baseDate, todayOffset);
            const target = { date: addDays(baseDate, targetOffset) };
            const cfg = { lookbackDays, minSamples };

            const history = sampleSpecs.map((s) => ({
              date: addDays(today, s.offsetDays),
              cents: s.cents,
            }));

            const result = typicalLlPrice(history, target, today, cfg);

            // Calculate expected oracle
            const eligible = history.filter((row) => {
              if (row.date >= today) return false;
              const diff = daysBetween(row.date, today);
              return diff > 0 && diff <= lookbackDays;
            });

            const targetWeekday = wdwDayOfWeek(target.date);
            const targetMonth = target.date.slice(5, 7);

            const step1 = eligible.filter(
              (row) =>
                wdwDayOfWeek(row.date) === targetWeekday &&
                row.date.slice(5, 7) === targetMonth,
            );

            const step2 = eligible.filter(
              (row) => wdwDayOfWeek(row.date) === targetWeekday,
            );

            if (step1.length >= minSamples) {
              expect(result.priceCents).not.toBeNull();
              if (result.priceCents !== null) {
                expect(result.basis).toBe('weekday_month');
                expect(result.sampleCount).toBe(step1.length);
                const step1Cents = step1.map((s) => s.cents);
                const minCents = Math.min(...step1Cents);
                const maxCents = Math.max(...step1Cents);
                expect(result.priceCents).toBeGreaterThanOrEqual(minCents);
                expect(result.priceCents).toBeLessThanOrEqual(maxCents);
                const maxDate = step1.map((s) => s.date).sort().reverse()[0];
                expect(result.newestSampleDate).toBe(maxDate);
                expect(result.newestSampleDate < today).toBe(true);
              }
            } else if (step2.length >= minSamples) {
              expect(result.priceCents).not.toBeNull();
              if (result.priceCents !== null) {
                expect(result.basis).toBe('weekday');
                expect(result.sampleCount).toBe(step2.length);
                const step2Cents = step2.map((s) => s.cents);
                const minCents = Math.min(...step2Cents);
                const maxCents = Math.max(...step2Cents);
                expect(result.priceCents).toBeGreaterThanOrEqual(minCents);
                expect(result.priceCents).toBeLessThanOrEqual(maxCents);
                const maxDate = step2.map((s) => s.date).sort().reverse()[0];
                expect(result.newestSampleDate).toBe(maxDate);
                expect(result.newestSampleDate < today).toBe(true);
              }
            } else {
              expect(result).toEqual({ priceCents: null, reason: 'no_estimate' });
            }

            // Permutation invariance: shuffling history gives identical result
            const shuffled = [...history].reverse();
            const shuffledResult = typicalLlPrice(shuffled, target, today, cfg);
            expect(shuffledResult).toEqual(result);

            // Adding samples on or after today or outside lookback doesn't alter result
            const paddedHistory = [
              ...history,
              { date: today, cents: 99999 },
              { date: addDays(today, 1), cents: 99999 },
              { date: addDays(today, -(lookbackDays + 1)), cents: 99999 },
              { date: addDays(today, -(lookbackDays + 10)), cents: 99999 },
            ];
            const paddedResult = typicalLlPrice(paddedHistory, target, today, cfg);
            expect(paddedResult).toEqual(result);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

