/**
 * Feature: crowd-calendar — R7.5, task 20.2.
 *
 * `CrowdCalendarDayDTO.observedIndex` existed in the contract and the mobile
 * screen rendered a comparison behind it, but `getCrowdCalendarDay` never
 * populated it — so that branch was unreachable for the entire life of the
 * feature. These tests assert the DTO now carries predicted-versus-actual, and
 * that it does so HONESTLY:
 *
 * the "we predicted" figure must come from the frozen `crowd_forecast_log`, not
 * from recomputing the forecast now. For a past date `computeRawForecast` returns
 * the observed index verbatim, so a recomputed value would always match the
 * actual exactly and the display would be meaningless.
 */
import { describe, expect, it, vi } from 'vitest';
import { createPredictionService } from '../predictionService.js';
import type { IntelligenceRepo } from '../IntelligenceRepo.js';
import type { WeatherClient } from '../weatherClient.js';

const NOW = new Date('2026-08-26T15:00:00Z');
const PAST = new Date('2026-08-20T12:00:00Z');
const FUTURE = new Date('2026-09-02T12:00:00Z');
const PARK = 'Magic Kingdom';

const weatherClient: WeatherClient = {
  getWDWWeather: vi.fn().mockResolvedValue({
    current: { condition: 'Clear', tempF: 82, precip: 0 },
    forecast: [],
  }),
};

interface Options {
  /** Observed crowd index rows keyed by nothing — returned for any date asked. */
  observed?: { crowd_index: number; sample_count: number; source: string } | null;
  captured?: { forecast_index: number; lead_days: number; forecasted_at: Date } | null;
  accuracies?: Array<{ park: string; lead_days: number; mae: number; bias: number; sample_count: number }>;
  omitCapturedMethod?: boolean;
}

function makeService(opts: Options = {}) {
  const repo: Record<string, unknown> = {
    getParkCrowdIndices: vi.fn(async (park: string, dates: Date[]) =>
      opts.observed
        ? [
            {
              park,
              date: dates[0],
              crowd_index: opts.observed.crowd_index,
              daily_avg_wait: 20,
              sample_count: opts.observed.sample_count,
              source: opts.observed.source,
            },
          ]
        : [],
    ),
    getParkScheduleSignals: vi.fn().mockResolvedValue([]),
    getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
    getForecastAccuracies: vi.fn(async () => opts.accuracies ?? []),
    getRideShapes: vi.fn().mockResolvedValue([]),
    getSeasonHours: vi.fn().mockResolvedValue([]),
    getExperienceSignals: vi.fn().mockResolvedValue([]),
    getWeatherSensitivities: vi.fn().mockResolvedValue([]),
    getExperienceDailySignals: vi.fn().mockResolvedValue([]),
    getShowTimePatterns: vi.fn().mockResolvedValue([]),
  };

  if (!opts.omitCapturedMethod) {
    repo.getCapturedForecast = vi.fn(async () => opts.captured ?? null);
  }

  return createPredictionService({
    repo: repo as unknown as IntelligenceRepo,
    weatherClient,
    now: () => NOW,
  });
}

describe('Feature: crowd-calendar — getCrowdCalendarDay surfaces predicted vs actual (R7.5)', () => {
  it('populates observedIndex as a display level for a finalized past date', async () => {
    // 1.06 ratio -> displayLevel round(5 * 1.06) = 5
    const service = makeService({
      observed: { crowd_index: 1.06, sample_count: 80, source: 'observed' },
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);
    expect(day.observedIndex).toBe(5);
  });

  it('does NOT set observedIndex for a future date', async () => {
    const service = makeService({
      observed: { crowd_index: 1.06, sample_count: 80, source: 'observed' },
    });

    const day = await service.getCrowdCalendarDay(PARK, FUTURE);
    expect(day.observedIndex).toBeUndefined();
  });

  it('ignores a seeded index — only the app\'s own observation counts as "actual"', async () => {
    const service = makeService({
      observed: { crowd_index: 1.4, sample_count: 0, source: 'seed' },
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);
    expect(day.observedIndex).toBeUndefined();
  });

  it('ignores an observed row with no samples behind it', async () => {
    const service = makeService({
      observed: { crowd_index: 1.4, sample_count: 0, source: 'observed' },
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);
    expect(day.observedIndex).toBeUndefined();
  });

  it('reports the FROZEN captured forecast, not the recomputed one', async () => {
    // The observed index for a past date is what computeRawForecast returns, so
    // `forecastIndex` echoes the actual. The captured value is deliberately
    // different, which is the whole point of reading the log.
    const service = makeService({
      observed: { crowd_index: 1.0, sample_count: 80, source: 'observed' },
      captured: {
        forecast_index: 1.28,
        lead_days: 7,
        forecasted_at: new Date('2026-08-13T11:10:00Z'),
      },
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);

    expect(day.observedIndex).toBe(5); // round(5 * 1.0)
    expect(day.capturedForecast).toEqual({
      index: 6, // round(5 * 1.28) = 6
      leadDays: 7,
      capturedAt: '2026-08-13T11:10:00.000Z',
    });
    // The recomputed forecast agrees with the actual, which is exactly why it
    // must not be presented as the prediction.
    expect(day.forecastIndex).toBe(5);
    expect(day.capturedForecast!.index).not.toBe(day.forecastIndex);
  });

  it('attaches measured accuracy at the SAME lead time as the capture', async () => {
    const service = makeService({
      observed: { crowd_index: 1.0, sample_count: 80, source: 'observed' },
      captured: {
        forecast_index: 1.28,
        lead_days: 7,
        forecasted_at: new Date('2026-08-13T11:10:00Z'),
      },
      accuracies: [
        { park: PARK, lead_days: 1, mae: 0.5, bias: 0.4, sample_count: 14 },
        { park: PARK, lead_days: 7, mae: 0.238, bias: 0.236, sample_count: 8 },
      ],
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);
    expect(day.forecastAccuracy).toEqual({
      // 0.238 ratio units x 5 = 1.19 display levels, rounded to 1 decimal.
      meanAbsoluteErrorLevels: 1.2,
      leadDays: 7,
      sampleCount: 8,
    });
  });

  it('omits accuracy when nothing has been scored at that lead time', async () => {
    const service = makeService({
      observed: { crowd_index: 1.0, sample_count: 80, source: 'observed' },
      captured: {
        forecast_index: 1.28,
        lead_days: 7,
        forecasted_at: new Date('2026-08-13T11:10:00Z'),
      },
      accuracies: [{ park: PARK, lead_days: 7, mae: 0, bias: 0, sample_count: 0 }],
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);
    expect(day.capturedForecast).toBeDefined();
    expect(day.forecastAccuracy).toBeUndefined();
  });

  it('omits capturedForecast when no capture survives for that date', async () => {
    const service = makeService({
      observed: { crowd_index: 1.0, sample_count: 80, source: 'observed' },
      captured: null,
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);
    expect(day.observedIndex).toBe(5);
    expect(day.capturedForecast).toBeUndefined();
    // No capture means no lead time to attach accuracy to.
    expect(day.forecastAccuracy).toBeUndefined();
  });

  it('still returns a usable day when the repo has no captured-forecast support', async () => {
    // Older repo shapes (and test fakes) must not break the calendar read.
    const service = makeService({
      observed: { crowd_index: 1.0, sample_count: 80, source: 'observed' },
      omitCapturedMethod: true,
    });

    const day = await service.getCrowdCalendarDay(PARK, PAST);
    expect(day.forecastIndex).toBe(5);
    expect(day.observedIndex).toBe(5);
    expect(day.capturedForecast).toBeUndefined();
  });
});
