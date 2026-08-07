import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeWeatherSensitivities,
  WEATHER_BASELINE_CONDITION,
  WEATHER_MIN_SAMPLES,
  WEATHER_MULTIPLIER_MIN,
  WEATHER_MULTIPLIER_MAX,
  type ConditionWaitAggregate,
} from '../weatherLearning.js';

const NUM_RUNS = 200;

describe('computeWeatherSensitivities (pure)', () => {
  it('learns a rain multiplier relative to the clear baseline', () => {
    const aggregates: ConditionWaitAggregate[] = [
      { condition: 'clear', avgWait: 30, sampleCount: 50 },
      { condition: 'rain', avgWait: 45, sampleCount: 40 },
    ];
    const [rain] = computeWeatherSensitivities(aggregates);
    expect(rain).toEqual({ condition: 'rain', waitMultiplier: 1.5, sampleCount: 40 });
  });

  it('never emits a row for the baseline condition itself', () => {
    const aggregates: ConditionWaitAggregate[] = [
      { condition: 'clear', avgWait: 30, sampleCount: 100 },
      { condition: 'cloudy', avgWait: 33, sampleCount: 50 },
    ];
    const result = computeWeatherSensitivities(aggregates);
    expect(result.some((r) => r.condition === WEATHER_BASELINE_CONDITION)).toBe(false);
    expect(result).toHaveLength(1);
    expect(result[0]!.condition).toBe('cloudy');
    expect(result[0]!.waitMultiplier).toBeCloseTo(1.1, 5);
  });

  it('omits an under-sampled condition (below the trust threshold)', () => {
    const aggregates: ConditionWaitAggregate[] = [
      { condition: 'clear', avgWait: 30, sampleCount: 50 },
      { condition: 'storm', avgWait: 80, sampleCount: WEATHER_MIN_SAMPLES - 1 },
    ];
    expect(computeWeatherSensitivities(aggregates)).toEqual([]);
  });

  it('returns nothing when the baseline is missing entirely', () => {
    const aggregates: ConditionWaitAggregate[] = [
      { condition: 'rain', avgWait: 45, sampleCount: 100 },
    ];
    expect(computeWeatherSensitivities(aggregates)).toEqual([]);
  });

  it('returns nothing when the baseline itself is under-sampled', () => {
    const aggregates: ConditionWaitAggregate[] = [
      { condition: 'clear', avgWait: 30, sampleCount: WEATHER_MIN_SAMPLES - 1 },
      { condition: 'rain', avgWait: 45, sampleCount: 100 },
    ];
    expect(computeWeatherSensitivities(aggregates)).toEqual([]);
  });

  it('clamps an extreme ratio to the storage bounds', () => {
    const aggregates: ConditionWaitAggregate[] = [
      { condition: 'clear', avgWait: 5, sampleCount: 50 },
      { condition: 'storm', avgWait: 200, sampleCount: 50 }, // raw ratio 40 → clamp
    ];
    const [storm] = computeWeatherSensitivities(aggregates);
    expect(storm!.waitMultiplier).toBe(WEATHER_MULTIPLIER_MAX);
  });

  // Feature: crowd-calendar, Property 7: Weather adjustment is bounded and horizon-limited.
  it('Property 7: every learned multiplier is bounded, never baseline, and only from sufficient data', () => {
    const conditionArb = fc.constantFrom('clear', 'cloudy', 'rain', 'storm');
    const aggArb = fc.record({
      condition: conditionArb,
      avgWait: fc.double({ min: 0, max: 300, noNaN: true }),
      sampleCount: fc.integer({ min: 0, max: 5000 }),
    });

    fc.assert(
      fc.property(fc.array(aggArb, { maxLength: 8 }), (rawAggs) => {
        // De-dupe by condition (the repo groups by condition, so inputs are unique per condition).
        const seen = new Map<string, ConditionWaitAggregate>();
        for (const a of rawAggs) if (!seen.has(a.condition)) seen.set(a.condition, a);
        const aggregates = [...seen.values()];

        const results = computeWeatherSensitivities(aggregates);
        const baseline = aggregates.find((a) => a.condition === WEATHER_BASELINE_CONDITION);

        for (const r of results) {
          // bounded
          expect(r.waitMultiplier).toBeGreaterThanOrEqual(WEATHER_MULTIPLIER_MIN);
          expect(r.waitMultiplier).toBeLessThanOrEqual(WEATHER_MULTIPLIER_MAX);
          // never the baseline
          expect(r.condition).not.toBe(WEATHER_BASELINE_CONDITION);
          // only from a trusted amount of data
          expect(r.sampleCount).toBeGreaterThanOrEqual(WEATHER_MIN_SAMPLES);
        }

        // If baseline is missing or under-sampled, nothing is learned.
        if (!baseline || baseline.sampleCount < WEATHER_MIN_SAMPLES || baseline.avgWait <= 0) {
          expect(results).toEqual([]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
