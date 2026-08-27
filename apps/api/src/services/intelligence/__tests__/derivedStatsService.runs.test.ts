import { describe, expect, it, vi } from 'vitest';
import { createDerivedStatsService } from '../derivedStatsService.js';
import type { PredictionService } from '../predictionService.js';

describe('derivedStatsService — per-leg run isolation and outcome recording', () => {
  function makeFakeRepo(overrides: Record<string, unknown> = {}) {
    return {
      getParkCrowdIndices: async () => [],
      getForecastLogsToReconcile: async () => [],
      getForecastAccuracies: async () => [],
      upsertForecastAccuracies: async () => {},
      upsertForecastLogs: async () => {},
      getRecentPercentiles: async () => [],
      getExperiencesWithUpstreamIds: async () => [],
      getRideShapes: async () => [],
      upsertRideShapes: async () => {},
      getWaitWeatherAggregates: async () => [],
      upsertWeatherSensitivities: async () => {},
      getTrailingShowtimeSignals: async () => [],
      upsertShowTimePatterns: async () => {},
      pruneStaleShowTimePatterns: async () => {},
      pruneWeatherObservations: async () => {},
      recordDerivedStatRun: vi.fn(async () => {}),
      ...overrides,
    } as any;
  }

  const fakePrediction: PredictionService = {
    getRawForecast: async () => 1.0,
    // captureForecasts freezes the CALIBRATED forecast (R7.7); without this the
    // leg would throw, be swallowed per-lead, and capture nothing silently.
    getCalibratedForecast: async () => 1.0,
    getDaySnapshot: vi.fn(),
    getCrowdMultiplier: vi.fn(),
    getCrowdCalendarDay: vi.fn(),
    getWaitInsights: vi.fn(),
  } as unknown as PredictionService;

  it('runs all remaining legs when one leg rejects, records 1 failure and 5 successes, and logs at warn', async () => {
    const recordDerivedStatRun = vi.fn<
      (leg: string, outcome: { ok: true } | { ok: false; error: unknown }) => Promise<void>
    >(async () => {});
    const pruneWeatherObservations = vi.fn(async () => {});
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    // Make recomputePercentiles fail by having getRecentPercentiles throw
    const repo = makeFakeRepo({
      getRecentPercentiles: async () => {
        throw new Error('Postgres connection terminated during percentiles calculation');
      },
      recordDerivedStatRun,
      pruneWeatherObservations,
    });

    const service = createDerivedStatsService({
      repo,
      predictionService: fakePrediction,
      logger,
      now: () => new Date('2026-08-16T12:00:00Z'),
    });

    await service.runDailyRecompute();

    // Assert the last leg (pruneWeatherObservations) still executed despite percentiles failing
    expect(pruneWeatherObservations).toHaveBeenCalledTimes(1);

    // Assert all 12 legs had their outcome recorded (R17 added archiveWaitSamples
    // + pruneWaitArchive; R18 added the three wait-forecast legs. R13.1's bound
    // is one row per leg, not a fixed count.)
    expect(recordDerivedStatRun).toHaveBeenCalledTimes(12);

    const recordedCalls = recordDerivedStatRun.mock.calls.map(([leg, outcome]) => ({
      leg,
      outcome,
    }));

    // Find the failing leg
    const failingRecorded = recordedCalls.find((c) => c.leg === 'recomputePercentiles');
    expect(failingRecorded).toBeDefined();
    expect(failingRecorded?.outcome.ok).toBe(false);
    expect((failingRecorded?.outcome as any).error.message).toContain('Postgres connection terminated');

    // All other 7 legs should be recorded as successes
    const successfulLegs = recordedCalls.filter((c) => c.outcome.ok === true);
    expect(successfulLegs).toHaveLength(11);
    expect(successfulLegs.map((c) => c.leg)).toEqual([
      'reconcileForecasts',
      'captureForecasts',
      'learnWeatherSensitivities',
      'recomputeShowtimePatterns',
      'pruneWeatherObservations',
      'archiveWaitSamples',
      'pruneWaitArchive',
      'pruneCrowdForecastLog',
      'reconcileWaitForecasts',
      'captureWaitForecasts',
      'pruneWaitForecastLog',
    ]);

    // Assert logger logged at warn with structured summary, and did NOT log overall success at info
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const warnCall = logger.warn.mock.calls[0]!;
    expect(warnCall[0]).toEqual({
      succeededLegs: [
        'reconcileForecasts',
        'captureForecasts',
        'learnWeatherSensitivities',
        'recomputeShowtimePatterns',
        'pruneWeatherObservations',
        'archiveWaitSamples',
        'pruneWaitArchive',
        'pruneCrowdForecastLog',
        'reconcileWaitForecasts',
        'captureWaitForecasts',
        'pruneWaitForecastLog',
      ],
      failedLegs: ['recomputePercentiles'],
      total: 12,
    });
    expect(warnCall[1]).toContain('Completed daily derived stats recompute with failures (1/12 legs failed)');

    // Ensure success summary was not logged at info
    const infoMessages = logger.info.mock.calls.map((c) => c[1] ?? c[0]);
    expect(infoMessages).not.toContain('Completed daily derived stats recompute successfully');
  });

  it('logs at info with all succeeded legs when all 12 legs pass', async () => {
    const recordDerivedStatRun = vi.fn<
      (leg: string, outcome: { ok: true } | { ok: false; error: unknown }) => Promise<void>
    >(async () => {});
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const repo = makeFakeRepo({
      recordDerivedStatRun,
    });

    const service = createDerivedStatsService({
      repo,
      predictionService: fakePrediction,
      logger,
      now: () => new Date('2026-08-16T12:00:00Z'),
    });

    await service.runDailyRecompute();

    expect(recordDerivedStatRun).toHaveBeenCalledTimes(12);
    expect(recordDerivedStatRun.mock.calls.every(([_, outcome]) => outcome.ok === true)).toBe(true);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      {
        succeededLegs: [
          'reconcileForecasts',
          'captureForecasts',
          'learnWeatherSensitivities',
          'recomputePercentiles',
          'recomputeShowtimePatterns',
          'pruneWeatherObservations',
          'archiveWaitSamples',
          'pruneWaitArchive',
          'pruneCrowdForecastLog',
          'reconcileWaitForecasts',
          'captureWaitForecasts',
          'pruneWaitForecastLog',
        ],
        total: 12,
      },
      'Completed daily derived stats recompute successfully',
    );
  });

  it('swallows errors thrown by recordDerivedStatRun without breaking execution', async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    const repo = makeFakeRepo({
      recordDerivedStatRun: vi.fn(async () => {
        throw new Error('Database disk full while writing outcome');
      }),
    });

    const service = createDerivedStatsService({
      repo,
      predictionService: fakePrediction,
      logger,
      now: () => new Date('2026-08-16T12:00:00Z'),
    });

    // Should complete cleanly without throwing
    await expect(service.runDailyRecompute()).resolves.not.toThrow();

    // Logger should have logged error for recording failures
    expect(logger.error).toHaveBeenCalled();
  });
});

/**
 * Feature: crowd-calendar, Property 19.1 — R7.1 / R7.4 / R7.7.
 *
 * Accuracy must be measured against the forecast **as issued**. The calendar
 * publishes the bias-calibrated value, so `captureForecasts` has to freeze that
 * same number. Freezing the uncalibrated model output instead would score a
 * forecast no user ever saw, and the calibration loop would never converge —
 * every cycle would re-measure the raw model's bias and re-apply it forever.
 *
 * The fake below returns deliberately DIFFERENT values for the two methods so
 * this test can tell which one was called. It fails against a `captureForecasts`
 * wired to `getRawForecast`.
 */
describe('derivedStatsService — captureForecasts freezes the calibrated forecast', () => {
  const RAW = 1.0;
  const CALIBRATED = 0.8;

  function makeFakeRepo(overrides: Record<string, unknown> = {}) {
    return {
      getParkCrowdIndices: async () => [],
      getForecastLogsToReconcile: async () => [],
      getForecastAccuracies: async () => [],
      upsertForecastAccuracies: async () => {},
      upsertForecastLogs: async () => {},
      getRecentPercentiles: async () => [],
      getExperiencesWithUpstreamIds: async () => [],
      getRideShapes: async () => [],
      upsertRideShapes: async () => {},
      getWaitWeatherAggregates: async () => [],
      upsertWeatherSensitivities: async () => {},
      getTrailingShowtimeSignals: async () => [],
      upsertShowTimePatterns: async () => {},
      pruneStaleShowTimePatterns: async () => {},
      pruneWeatherObservations: async () => {},
      recordDerivedStatRun: vi.fn(async () => {}),
      ...overrides,
    } as any;
  }

  it('logs the calibrated value, never the raw model output', async () => {
    const logged: Array<{ park: string; lead_days: number; forecast_index: number }> = [];
    const repo = makeFakeRepo({
      upsertForecastLogs: async (rows: Array<{ park: string; lead_days: number; forecast_index: number }>) => {
        logged.push(...rows);
      },
    });

    const prediction = {
      getRawForecast: async () => RAW,
      getCalibratedForecast: async () => CALIBRATED,
      getDaySnapshot: vi.fn(),
      getCrowdMultiplier: vi.fn(),
      getCrowdCalendarDay: vi.fn(),
      getWaitInsights: vi.fn(),
    } as unknown as PredictionService;

    const service = createDerivedStatsService({
      repo,
      predictionService: prediction,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      now: () => new Date('2026-08-26T12:00:00Z'),
    });

    await service.runDailyRecompute();

    // 4 theme parks x 5 lead times.
    expect(logged.length).toBe(20);
    for (const row of logged) {
      expect(row.forecast_index).toBe(CALIBRATED);
      expect(row.forecast_index).not.toBe(RAW);
    }
  });
});
