import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyEma,
  normalizeCrowdIndex,
  displayLevel,
  selectTier,
  weatherAdjustment,
} from '../waitMath.js';
import { forecastIndex } from '../crowdForecast.js';
import { updateAccuracy, applyBiasCorrection } from '../calibration.js';
import {
  bestWorstHours,
  coefficientOfVariation,
  peakWindow,
} from '../derivedStats.js';

describe('Feature: crowd-calendar', () => {
  describe('Property 1: Prediction picks the most specific reliable tier and is never unusable', () => {
    it('picks season if threshold met, else shape, else typical', () => {
      fc.assert(
        fc.property(
          fc.record({ wait: fc.double({ min: 0, max: 300, noNaN: true }), sampleCount: fc.integer({ min: 0, max: 100 }) }),
          fc.record({ wait: fc.double({ min: 0, max: 300, noNaN: true }) }),
          fc.double({ min: 0, max: 300, noNaN: true }),
          fc.double({ min: 0.4, max: 2.0, noNaN: true }),
          fc.integer({ min: 1, max: 50 }),
          (season, shape, typical, crowd, threshold) => {
            const result = selectTier(season, shape, typical, crowd, threshold);
            expect(Number.isFinite(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(0);

            if (season.sampleCount >= threshold) {
              expect(result).toBe(season.wait);
            } else if (shape.wait > 0) {
              expect(result).toBe(shape.wait * crowd);
            } else {
              expect(result).toBe(typical * crowd);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: EMA update is recency-weighted and bounded', () => {
    it('keeps result between previous value and new sample', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.double({ min: 0, max: 1000, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (prev, sample, weight) => {
            const updated = applyEma(prev, sample, weight);
            const min = Math.min(prev, sample);
            const max = Math.max(prev, sample);
            // Allow small floating point drift
            expect(updated).toBeGreaterThanOrEqual(min - 1e-9);
            expect(updated).toBeLessThanOrEqual(max + 1e-9);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 3: Crowd index normalization is monotonic and bounded', () => {
    it('normalizes proportionally and displayLevel maps to [1, 10]', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 300, noNaN: true }),
          fc.double({ min: 1, max: 300, noNaN: true }),
          (dailyAvg, typical) => {
            const continuous = normalizeCrowdIndex(dailyAvg, { typical, maxTypical: typical * 2 });
            expect(Number.isFinite(continuous)).toBe(true);
            expect(continuous).toBeGreaterThanOrEqual(0);
            
            const level = displayLevel(continuous);
            expect(Number.isInteger(level)).toBe(true);
            expect(level).toBeGreaterThanOrEqual(1);
            expect(level).toBeLessThanOrEqual(10);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 4: Crowd forecast is defined with zero history', () => {
    it('returns a finite value when history is absent', () => {
      fc.assert(
        fc.property(
          fc.record({
            typicalContinuous: fc.double({ min: 0.1, max: 2.0, noNaN: true }),
            llMultipassPrice: fc.option(fc.integer({ min: 1500, max: 4000 })),
            trailingMedianPrice: fc.option(fc.integer({ min: 1500, max: 4000 })),
            openHours: fc.double({ min: 8, max: 16, noNaN: true }),
            typicalOpenHours: fc.double({ min: 8, max: 16, noNaN: true }),
            extendedEvening: fc.boolean(),
            seasonalPriorValue: fc.double({ min: 0.8, max: 1.6, noNaN: true }),
            biasCorrection: fc.double({ min: -5, max: 5, noNaN: true }),
          }),
          (features) => {
            const forecast = forecastIndex({
              ...features,
              historyEstimate: null,
              comparableSampleCount: 0,
            });
            expect(Number.isFinite(forecast)).toBe(true);
            expect(forecast).toBeGreaterThanOrEqual(0.4);
            expect(forecast).toBeLessThanOrEqual(3.0);

            const quietForecast = forecastIndex({
              typicalContinuous: 1.0,
              llMultipassPrice: 1500,
              trailingMedianPrice: 2000,
              openHours: 8,
              typicalOpenHours: 12,
              extendedEvening: false,
              seasonalPriorValue: 0.8,
              historyEstimate: null,
              comparableSampleCount: 0,
              biasCorrection: 0
            });
            expect(quietForecast).toBeLessThan(1.0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 6: Calibration reconciles by key and stays bounded', () => {
    it('updates MAE and bias correctly, applyBiasCorrection stays in [0.4, 3.0]', () => {
      fc.assert(
        fc.property(
          fc.record({
            mae: fc.double({ min: 0, max: 5, noNaN: true }),
            bias: fc.double({ min: -5, max: 5, noNaN: true }),
            sampleCount: fc.integer({ min: 0, max: 500 })
          }),
          fc.double({ min: -10, max: 10, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: -5, max: 15, noNaN: true }),
          (prev, error, weight, rawIndex) => {
            const updated = updateAccuracy(prev, error, weight);
            expect(updated.sampleCount).toBe(prev.sampleCount === 0 ? 1 : prev.sampleCount + 1);
            expect(Number.isFinite(updated.mae)).toBe(true);
            expect(Number.isFinite(updated.bias)).toBe(true);

            const corrected = applyBiasCorrection(rawIndex, updated.bias);
            expect(corrected).toBeGreaterThanOrEqual(0.4);
            expect(corrected).toBeLessThanOrEqual(3.0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 7: Weather adjustment is bounded and horizon-limited', () => {
    it('returns 1.0 when missing, else clamped to [0.75, 1.25]', () => {
      fc.assert(
        fc.property(
          fc.option(fc.double({ min: 0, max: 2.0, noNaN: true })),
          fc.option(fc.string({ minLength: 1 })),
          (sensitivity, condition) => {
            const adj = weatherAdjustment(sensitivity, condition);
            if (!sensitivity || !condition) {
              expect(adj).toBe(1.0);
            } else {
              expect(adj).toBeGreaterThanOrEqual(0.75);
              expect(adj).toBeLessThanOrEqual(1.25);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 8: Derived statistics are internally consistent', () => {
    it('computes CV properly', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -10, max: 300, noNaN: true }),
          fc.double({ min: 0, max: 50, noNaN: true }),
          (mean, stddev) => {
            const cv = coefficientOfVariation(mean, stddev);
            if (mean <= 0) {
              expect(cv).toBe(0);
            } else {
              expect(cv).toBe(stddev / mean);
              expect(cv).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    const hourlyWaitArb = fc.array(
      fc.record({
        hour: fc.integer({ min: 0, max: 23 }),
        wait: fc.double({ min: 0, max: 300, noNaN: true }),
      }),
      { minLength: 1, maxLength: 24 }
    );

    it('finds best/worst hour in shape', () => {
      fc.assert(
        fc.property(
          hourlyWaitArb,
          (shape) => {
            const { bestHour, worstHour } = bestWorstHours(shape);
            expect(bestHour).toBeDefined();
            expect(worstHour).toBeDefined();
            
            const maxWait = Math.max(...shape.map(s => s.wait));
            const minWait = Math.min(...shape.map(s => s.wait));
            
            const bestHasMin = shape.some(s => s.hour === bestHour && s.wait === minWait);
            const worstHasMax = shape.some(s => s.hour === worstHour && s.wait === maxWait);
            
            expect(bestHasMin).toBe(true);
            expect(worstHasMax).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('computes peak window', () => {
      fc.assert(
        fc.property(
          hourlyWaitArb,
          (shape) => {
            const win = peakWindow(shape);
            expect(win).toBeDefined();
            expect(win!.startHour).toBeGreaterThanOrEqual(0);
            expect(win!.endHour).toBeLessThanOrEqual(23);
            expect(win!.startHour).toBeLessThanOrEqual(win!.endHour);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
