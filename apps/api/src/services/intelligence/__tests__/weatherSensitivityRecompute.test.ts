import { describe, expect, it, vi } from 'vitest';
import { createDerivedStatsService } from '../derivedStatsService.js';
import type { PredictionService } from '../predictionService.js';

/**
 * Orchestration test for the weather-sensitivity leg of the daily recompute:
 * it must join-aggregate waits×weather, learn a per-condition multiplier vs the
 * clear baseline, upsert only the trusted ones, and prune old observations.
 */
describe('derivedStatsService — weather sensitivity recompute (Task 4.5)', () => {
  function makeFakeRepo(overrides: Record<string, unknown> = {}) {
    return {
      // reconcile / capture legs — inert
      getParkCrowdIndices: async () => [],
      getForecastLogsToReconcile: async () => [],
      getForecastAccuracies: async () => [],
      upsertForecastAccuracies: async () => {},
      upsertForecastLogs: async () => {},
      // percentiles leg — inert
      getRecentPercentiles: async () => [],
      getExperiencesWithUpstreamIds: async () => [],
      getRideShapes: async () => [],
      upsertRideShapes: async () => {},
      // weather leg — under test
      getWaitWeatherAggregates: async () => [],
      upsertWeatherSensitivities: vi.fn(async () => {}),
      pruneWeatherObservations: vi.fn(async () => {}),
      ...overrides,
    } as any;
  }

  const fakePrediction: PredictionService = {
    getRawForecast: async () => 1.0,
    getDaySnapshot: vi.fn(),
    getCrowdMultiplier: vi.fn(),
    getCrowdCalendarDay: vi.fn(),
    getWaitInsights: vi.fn(),
  } as unknown as PredictionService;

  it('learns multipliers for well-sampled conditions and skips under-sampled ones', async () => {
    const upsertWeatherSensitivities = vi.fn(async (_rows: any[]) => {});
    const repo = makeFakeRepo({
      getWaitWeatherAggregates: async () => [
        // exp1: clear baseline 30 (n=100), rain 45 (n=60) → 1.5; storm n=3 → skipped
        { experience_id: 'exp1', condition: 'clear', avg_wait: 30, sample_count: 100 },
        { experience_id: 'exp1', condition: 'rain', avg_wait: 45, sample_count: 60 },
        { experience_id: 'exp1', condition: 'storm', avg_wait: 90, sample_count: 3 },
        // exp2: no clear baseline → nothing learned
        { experience_id: 'exp2', condition: 'rain', avg_wait: 50, sample_count: 80 },
      ],
      upsertWeatherSensitivities,
    });

    const service = createDerivedStatsService({
      repo,
      predictionService: fakePrediction,
      now: () => new Date('2026-08-05T12:00:00Z'),
    });

    await service.runDailyRecompute();

    expect(upsertWeatherSensitivities).toHaveBeenCalledTimes(1);
    const rows = upsertWeatherSensitivities.mock.calls[0]![0] as any[];
    expect(rows).toEqual([
      { experience_id: 'exp1', condition: 'rain', wait_multiplier: 1.5, sample_count: 60 },
    ]);
  });

  it('prunes observed weather to a bounded window on every recompute', async () => {
    const pruneWeatherObservations = vi.fn(async (_before: Date) => {});
    const repo = makeFakeRepo({ pruneWeatherObservations });

    const service = createDerivedStatsService({
      repo,
      predictionService: fakePrediction,
      now: () => new Date('2026-08-05T12:00:00Z'),
    });

    await service.runDailyRecompute();

    expect(pruneWeatherObservations).toHaveBeenCalledTimes(1);
    const cutoff = pruneWeatherObservations.mock.calls[0]![0] as Date;
    // 90-day retention: cutoff is well before "now".
    expect(cutoff.getTime()).toBeLessThan(new Date('2026-08-05T12:00:00Z').getTime());
    expect(cutoff.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('writes nothing when there is no overlapping wait/weather history yet', async () => {
    const upsertWeatherSensitivities = vi.fn(async (_rows: any[]) => {});
    const repo = makeFakeRepo({
      getWaitWeatherAggregates: async () => [],
      upsertWeatherSensitivities,
    });

    const service = createDerivedStatsService({
      repo,
      predictionService: fakePrediction,
      now: () => new Date('2026-08-05T12:00:00Z'),
    });

    await service.runDailyRecompute();
    expect(upsertWeatherSensitivities).not.toHaveBeenCalled();
  });
});
