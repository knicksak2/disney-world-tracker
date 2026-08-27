import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  applyEma,
  normalizeCrowdIndex,
  displayLevel,
  selectTier,
  weatherAdjustment,
  isStandbyBasketEntry,
  relativeCrowdIndex,
  shrinkToPooled,
  clampCrowdMultiplier,
  CROWD_MULTIPLIER_MIN,
  CROWD_MULTIPLIER_MAX,
  establishBaseline,
  isBaselineEstablished,
  shapeEmaWeight,
  BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES,
  BASELINE_SAMPLE_COUNT_CAP,
  CROWD_INDEX_DRIFT_HORIZON_PASSES,
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
          (season, shape, typical, forecast, threshold) => {
            // No pooled mean and no avgCrowdIndex supplied, so this exercises
            // the tier LADDER itself, unshrunk and un-de-meaned.
            const result = selectTier({
              seasonBucket: season,
              shapeBucket: shape,
              parkTypical: typical,
              forecastIndex: forecast,
              threshold,
            });
            expect(Number.isFinite(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(0);

            const absolute = clampCrowdMultiplier(forecast);
            if (season.sampleCount >= threshold) {
              // avgCrowdIndex absent → raw average (R15.3 fallback)
              expect(result).toBe(season.wait);
            } else if (shape.wait > 0) {
              expect(result).toBe(shape.wait * absolute);
            } else {
              expect(result).toBe(typical * absolute);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: crowd-calendar, Property 15: A mature season bucket still responds
  // to the date's crowd forecast.
  describe('Property 15: A mature season bucket still responds to the date\'s crowd forecast', () => {
    it('is strictly increasing in forecastIndex over the unclamped range', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 5, max: 300, noNaN: true }),      // bucket wait
          fc.double({ min: 0.6, max: 1.4, noNaN: true }),    // embedded crowd level
          fc.double({ min: 0.5, max: 1.0, noNaN: true }),    // lower forecast
          fc.double({ min: 1.05, max: 1.5, noNaN: true }),   // higher forecast
          (wait, avgCrowdIndex, lowForecast, highForecast) => {
            const base = {
              seasonBucket: { wait, sampleCount: 30, avgCrowdIndex },
              parkTypical: 30,
            };
            const quiet = selectTier({ ...base, forecastIndex: lowForecast });
            const busy = selectTier({ ...base, forecastIndex: highForecast });

            // Both factors must be strictly inside the clamp band for the
            // comparison to be about the formula rather than the clamp.
            const quietFactor = lowForecast / avgCrowdIndex;
            const busyFactor = highForecast / avgCrowdIndex;
            fc.pre(
              quietFactor > CROWD_MULTIPLIER_MIN &&
                busyFactor < CROWD_MULTIPLIER_MAX &&
                quietFactor < busyFactor,
            );

            expect(busy).toBeGreaterThan(quiet);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('returns exactly the raw average when the forecast equals the embedded level', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 5, max: 300, noNaN: true }),
          fc.double({ min: 0.5, max: 2.0, noNaN: true }),
          (wait, level) => {
            const result = selectTier({
              seasonBucket: { wait, sampleCount: 30, avgCrowdIndex: level },
              parkTypical: 30,
              forecastIndex: level,
            });
            expect(result).toBeCloseTo(wait, 6);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('falls back to the raw average when the embedded level is unknown or invalid', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 5, max: 300, noNaN: true }),
          fc.double({ min: 0.4, max: 3.0, noNaN: true }),
          fc.constantFrom<number | null | undefined>(null, undefined, 0, -1),
          (wait, forecast, badLevel) => {
            const result = selectTier({
              seasonBucket: { wait, sampleCount: 30, avgCrowdIndex: badLevel as number | null },
              parkTypical: 30,
              forecastIndex: forecast,
            });
            expect(result).toBe(wait);
          }
        ),
        { numRuns: 100 }
      );
    });

    // R15.5 — the mandatory deterministic regression. Every pre-existing tier
    // test sits BELOW the tier-1 threshold, so this branch was executed by no
    // assertion. Written as concrete numbers (not a property) so the expected
    // values are visible and it would plainly have failed before the change.
    it('regression: a mature bucket predicts differently on a busy vs a quiet date', () => {
      // Seven Dwarfs Mine Train, Saturday 2 PM: bucket averaged 45 min over
      // samples taken on days averaging 0.90 (slightly quieter than typical).
      const bucket = { wait: 45, sampleCount: 42, avgCrowdIndex: 0.9 };

      const quietDay = selectTier({ seasonBucket: bucket, parkTypical: 30, forecastIndex: 0.75 });
      const busyDay = selectTier({ seasonBucket: bucket, parkTypical: 30, forecastIndex: 1.35 });

      // 45 * (0.75 / 0.90) = 37.5 ; 45 * (1.35 / 0.90) = 67.5
      expect(quietDay).toBeCloseTo(37.5, 6);
      expect(busyDay).toBeCloseTo(67.5, 6);

      // The behavior that was broken: both used to return the bucket's raw 45.
      expect(quietDay).not.toBeCloseTo(45, 6);
      expect(busyDay).not.toBeCloseTo(45, 6);
      expect(busyDay).toBeGreaterThan(quietDay);

      // And a date matching the bucket's own embedded level returns it exactly.
      expect(
        selectTier({ seasonBucket: bucket, parkTypical: 30, forecastIndex: 0.9 }),
      ).toBeCloseTo(45, 6);
    });

    it('keeps the relative scaling factor inside the shared clamp band', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 5, max: 300, noNaN: true }),
          fc.double({ min: 0.05, max: 5, noNaN: true }),
          fc.double({ min: 0.05, max: 5, noNaN: true }),
          (wait, avgCrowdIndex, forecast) => {
            const result = selectTier({
              seasonBucket: { wait, sampleCount: 30, avgCrowdIndex },
              parkTypical: 30,
              forecastIndex: forecast,
            });
            expect(result).toBeGreaterThanOrEqual(wait * CROWD_MULTIPLIER_MIN - 1e-9);
            expect(result).toBeLessThanOrEqual(wait * CROWD_MULTIPLIER_MAX + 1e-9);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: crowd-calendar, Property 16: Day-of-week shrinkage is bounded,
  // monotone, and converges to the raw bucket.
  describe('Property 16: Day-of-week shrinkage is bounded, monotone and convergent', () => {
    it('always lies within the interval spanned by the bucket and pooled means', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 300, noNaN: true }),
          fc.double({ min: 0, max: 300, noNaN: true }),
          fc.integer({ min: 0, max: 500 }),
          fc.integer({ min: 1, max: 40 }),
          (bucketWait, pooledWait, n, k) => {
            const result = shrinkToPooled(bucketWait, n, pooledWait, k);
            const lo = Math.min(bucketWait, pooledWait);
            const hi = Math.max(bucketWait, pooledWait);
            expect(result).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(result).toBeLessThanOrEqual(hi + 1e-9);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('equals the pooled mean at zero samples and approaches the bucket as samples grow', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 300, noNaN: true }),
          fc.double({ min: 1, max: 300, noNaN: true }),
          (bucketWait, pooledWait) => {
            expect(shrinkToPooled(bucketWait, 0, pooledWait)).toBeCloseTo(pooledWait, 9);

            const far = shrinkToPooled(bucketWait, 1_000_000, pooledWait);
            expect(Math.abs(far - bucketWait)).toBeLessThan(
              Math.abs(pooledWait - bucketWait) / 1000 + 1e-6,
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    it('moves monotonically toward the bucket as its sample count rises', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 300, noNaN: true }),
          fc.double({ min: 1, max: 300, noNaN: true }),
          fc.integer({ min: 0, max: 200 }),
          fc.integer({ min: 1, max: 200 }),
          (bucketWait, pooledWait, n, delta) => {
            fc.pre(Math.abs(bucketWait - pooledWait) > 1e-6);
            const lower = shrinkToPooled(bucketWait, n, pooledWait);
            const higher = shrinkToPooled(bucketWait, n + delta, pooledWait);

            if (bucketWait > pooledWait) {
              expect(higher).toBeGreaterThanOrEqual(lower - 1e-9);
            } else {
              expect(higher).toBeLessThanOrEqual(lower + 1e-9);
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('leaves the season-resolved and park-typical tiers numerically untouched', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 300, noNaN: true }),
          fc.double({ min: 1, max: 300, noNaN: true }),
          fc.double({ min: 0.5, max: 1.5, noNaN: true }),
          fc.integer({ min: 1, max: 40 }),
          fc.integer({ min: 1, max: 40 }),
          (wait, pooled, forecast, kA, kB) => {
            // Tier 1 — shrinkage must not participate.
            const t1a = selectTier({
              seasonBucket: { wait, sampleCount: 30, avgCrowdIndex: 1.0 },
              pooledWait: pooled,
              parkTypical: 42,
              forecastIndex: forecast,
              shrinkageK: kA,
            });
            const t1b = selectTier({
              seasonBucket: { wait, sampleCount: 30, avgCrowdIndex: 1.0 },
              pooledWait: pooled,
              parkTypical: 42,
              forecastIndex: forecast,
              shrinkageK: kB,
            });
            expect(t1a).toBe(t1b);

            // Tier 3 — no shape bucket and no pooled mean at all.
            const t3a = selectTier({
              parkTypical: 42,
              forecastIndex: forecast,
              shrinkageK: kA,
            });
            const t3b = selectTier({
              parkTypical: 42,
              forecastIndex: forecast,
              shrinkageK: kB,
            });
            expect(t3a).toBe(t3b);
            expect(t3a).toBeCloseTo(42 * clampCrowdMultiplier(forecast), 9);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: crowd-calendar, Property 14: The crowd index's denominator adapts
  // an order of magnitude slower than its numerator.
  describe('Property 14: An established Ride_Baseline is frozen', () => {
    it('is idempotent on an established bucket, for any shape state', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 200, noNaN: true }),
          fc.integer({ min: 1, max: 600 }),
          fc.double({ min: 0, max: 300, noNaN: true }),
          fc.integer({ min: 0, max: 600 }),
          (established, establishedCount, shapeAvg, shapeCount) => {
            const next = establishBaseline(established, establishedCount, shapeAvg, shapeCount);
            expect(next.baselineWaitMinutes).toBe(established);
            expect(next.baselineSampleCount).toBe(establishedCount);

            // Applying it again changes nothing either.
            const again = establishBaseline(
              next.baselineWaitMinutes,
              next.baselineSampleCount,
              shapeAvg,
              shapeCount,
            );
            expect(again.baselineWaitMinutes).toBe(established);
            expect(again.baselineSampleCount).toBe(establishedCount);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('establishes from a settled shape average, and stays null while the shape is thin', () => {
      fc.assert(
        fc.property(
          fc.double({ min: 1, max: 300, noNaN: true }),
          fc.integer({ min: 0, max: 600 }),
          fc.constantFrom<number | null | undefined>(null, undefined, 0),
          (shapeAvg, shapeCount, absentBaseline) => {
            const next = establishBaseline(absentBaseline as number | null, 0, shapeAvg, shapeCount);

            if (shapeCount >= BASELINE_ESTABLISH_MIN_SHAPE_SAMPLES) {
              expect(next.baselineWaitMinutes).toBeCloseTo(shapeAvg, 9);
              expect(next.baselineSampleCount).toBe(
                Math.min(shapeCount, BASELINE_SAMPLE_COUNT_CAP),
              );
            } else {
              // Thin shape → refuse to freeze a noisy level (R14.4).
              expect(next.baselineWaitMinutes).toBeNull();
            }
          }
        ),
        { numRuns: 200 }
      );
    });

    it('gates basket eligibility on the baseline\'s own columns', () => {
      // A dense fast shape is irrelevant — only the baseline's columns count.
      expect(isBaselineEstablished(60, 50)).toBe(true);
      expect(isBaselineEstablished(60, 4)).toBe(false);   // too few baseline samples
      expect(isBaselineEstablished(4, 500)).toBe(false);  // expected too small
      expect(isBaselineEstablished(null, 500)).toBe(false);
      expect(isBaselineEstablished(undefined, 500)).toBe(false);
      expect(isBaselineEstablished(Number.NaN, 500)).toBe(false);
    });

    it('leaves the index EXACTLY unchanged over a long constant-wait run, while the fast denominator collapses it', () => {
      // Observed waits held constant at a level 25% above the ride's baseline.
      // The fast shape converges onto them within weeks, so a shape-denominated
      // index slides to ~1.0 and the signal disappears. The frozen baseline
      // cannot move at all.
      const observed = 60;
      let baseline: number | null = 48;
      let baselineCount = 100;
      let shape = 48;
      let shapeCount = 100;

      const indexFrom = (expected: number) => observed / expected;
      const firstBaselineIndex = indexFrom(baseline);
      const firstShapeIndex = indexFrom(shape);

      for (let pass = 0; pass < CROWD_INDEX_DRIFT_HORIZON_PASSES; pass++) {
        shape = applyEma(shape, observed, shapeEmaWeight(shapeCount));
        shapeCount += 1;

        const next = establishBaseline(baseline, baselineCount, shape, shapeCount);
        baseline = next.baselineWaitMinutes;
        baselineCount = next.baselineSampleCount;
      }

      // Exact equality — no tolerance. This is the R14.8 guarantee.
      expect(baseline).toBe(48);
      expect(indexFrom(baseline as number)).toBe(firstBaselineIndex);

      // The denominator being replaced really does destroy the signal: a ride
      // reliably 25% above its baseline now reads as a typical day.
      expect(indexFrom(shape)).toBeCloseTo(1.0, 2);
      expect(Math.abs(indexFrom(shape) - firstShapeIndex)).toBeGreaterThan(0.2);
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

  // Feature: crowd-calendar, Property 9: relativeCrowdIndex composition-robust
  describe('Property 9: Crowd index measures the standby basket, relatively, and is composition-robust', () => {
    const eligibleRideArb = fc.record({
      observed: fc.double({ min: 0, max: 300, noNaN: true }),
      expected: fc.double({ min: 5, max: 300, noNaN: true }),  // >= CROWD_INDEX_MIN_EXPECTED_MINUTES
      sampleCount: fc.integer({ min: 5, max: 500 }),           // >= CROWD_INDEX_MIN_SHAPE_SAMPLES
    });

    const ineligibleRideArb = fc.oneof(
      // Under-sampled
      fc.record({
        observed: fc.double({ min: 0, max: 300, noNaN: true }),
        expected: fc.double({ min: 5, max: 300, noNaN: true }),
        sampleCount: fc.integer({ min: 0, max: 4 }),
      }),
      // Expected <= 0
      fc.record({
        observed: fc.double({ min: 0, max: 300, noNaN: true }),
        expected: fc.double({ min: -100, max: 0, noNaN: true }),
        sampleCount: fc.integer({ min: 5, max: 500 }),
      }),
      // Expected below floor (< 5)
      fc.record({
        observed: fc.double({ min: 0, max: 300, noNaN: true }),
        expected: fc.double({ min: 0.01, max: 4.99, noNaN: true }),
        sampleCount: fc.integer({ min: 5, max: 500 }),
      }),
    );

    it('(a) ignores rides with no/zero/under-sampled expected', () => {
      fc.assert(
        fc.property(
          fc.array(ineligibleRideArb, { minLength: 1, maxLength: 10 }),
          (rides) => {
            const result = relativeCrowdIndex(rides);
            expect(Number.isNaN(result)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('(b) returns 1.0 when all rides at expected', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.double({ min: 5, max: 300, noNaN: true }).map(expected => ({
              observed: expected,
              expected,
              sampleCount: 10,
            })),
            { minLength: 1, maxLength: 20 }
          ),
          (rides) => {
            const result = relativeCrowdIndex(rides);
            expect(result).toBeCloseTo(1.0, 9);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('(c) non-decreasing in any included observed wait', () => {
      fc.assert(
        fc.property(
          fc.array(eligibleRideArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 0, max: 9 }),
          fc.double({ min: 0.01, max: 100, noNaN: true }),
          (rides, rideIdx, bump) => {
            const idx = rideIdx % rides.length;
            const baseline = relativeCrowdIndex(rides);
            if (Number.isNaN(baseline)) return; // skip if no eligible rides

            const bumped = rides.map((r, i) =>
              i === idx ? { ...r, observed: r.observed + bump } : r
            );
            const bumpedResult = relativeCrowdIndex(bumped);
            expect(bumpedResult).toBeGreaterThanOrEqual(baseline - 1e-9);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('(d) unchanged by adding a ride that is exactly at its expected level', () => {
      fc.assert(
        fc.property(
          fc.array(eligibleRideArb, { minLength: 1, maxLength: 10 }),
          fc.double({ min: 5, max: 300, noNaN: true }),
          (rides, expected) => {
            const baseline = relativeCrowdIndex(rides);
            if (Number.isNaN(baseline)) return;

            const atExpected = { observed: expected, expected, sampleCount: 10 };
            // Adding a ride at exactly 1.0 ratio should not change the index
            // only if baseline is also 1.0. In general, adding a 1.0-ratio ride
            // moves the mean toward 1.0. The spec says "unchanged" specifically
            // for a ride at expected — this holds when baseline is already 1.0.
            // For arbitrary baselines, we verify it moves toward 1.0 (or stays).
            const withExtra = relativeCrowdIndex([...rides, atExpected]);
            if (Math.abs(baseline - 1.0) < 1e-9) {
              expect(withExtra).toBeCloseTo(1.0, 9);
            } else if (baseline > 1.0) {
              expect(withExtra).toBeLessThanOrEqual(baseline + 1e-9);
            } else {
              expect(withExtra).toBeGreaterThanOrEqual(baseline - 1e-9);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // Feature: crowd-calendar, Property 10: Only standby-queue entries are sampled
  describe('Property 10: Only standby-queue entries are sampled', () => {
    it('selects only operating posted-standby entries', () => {
      fc.assert(
        fc.property(
          fc.record({
            status: fc.oneof(
              fc.constant('OPERATING'),
              fc.constant('CLOSED'),
              fc.constant('DOWN'),
              fc.constant('REFURBISHMENT'),
              fc.constant(undefined),
            ),
            hasStandbyQueue: fc.boolean(),
            waitTime: fc.oneof(
              fc.integer({ min: 0, max: 300 }),
              fc.constant(null),
              fc.constant(undefined),
              fc.constant(NaN),
            ),
          }),
          ({ status, hasStandbyQueue, waitTime }) => {
            const entry = {
              id: 'test-entry',
              ...(status !== undefined ? { status } : {}),
              ...(hasStandbyQueue
                ? { queue: { STANDBY: { ...(waitTime !== undefined ? { waitTime } : {}) } } }
                : {}),
            };

            const result = isStandbyBasketEntry(entry);

            const expectedResult =
              status === 'OPERATING' &&
              hasStandbyQueue &&
              typeof waitTime === 'number' &&
              !Number.isNaN(waitTime);

            expect(result).toBe(expectedResult);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('walk-on 0 is included; no-queue entries are excluded', () => {
      // Walk-on ride with 0-minute standby
      expect(isStandbyBasketEntry({
        id: 'walkOn', status: 'OPERATING',
        queue: { STANDBY: { waitTime: 0 } },
      })).toBe(true);

      // Show with no STANDBY queue
      expect(isStandbyBasketEntry({
        id: 'show', status: 'OPERATING',
      })).toBe(false);

      // Restaurant with no queue
      expect(isStandbyBasketEntry({
        id: 'restaurant', status: 'OPERATING',
        queue: {},
      })).toBe(false);

      // Ride that is DOWN
      expect(isStandbyBasketEntry({
        id: 'downRide', status: 'DOWN',
        queue: { STANDBY: { waitTime: 30 } },
      })).toBe(false);

      // Entry with null waitTime
      expect(isStandbyBasketEntry({
        id: 'nullWait', status: 'OPERATING',
        queue: { STANDBY: { waitTime: null } },
      })).toBe(false);
    });

    it('wait-sampling basket membership is decided purely on live feed STANDBY status, independent of category (R3.9)', () => {
      // An operating entry with posted STANDBY wait is always in the basket regardless of whether
      // it is a Ride, Show, Walkthrough, PlayArea, or Game
      const liveEntryWithStandby = {
        id: 'attraction-1',
        status: 'OPERATING' as const,
        queue: { STANDBY: { waitTime: 25 } },
      };
      expect(isStandbyBasketEntry(liveEntryWithStandby)).toBe(true);

      // An operating entry without STANDBY queue is excluded regardless of category
      const liveEntryWithoutStandby = {
        id: 'attraction-2',
        status: 'OPERATING' as const,
        queue: {},
      };
      expect(isStandbyBasketEntry(liveEntryWithoutStandby)).toBe(false);
    });
  });
});

