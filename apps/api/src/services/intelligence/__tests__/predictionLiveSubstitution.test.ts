/**
 * Feature: crowd-calendar — same-day current-hour live wait substitution
 * (R4.5, Property 18).
 *
 * The park-wide R4.3 live correction only nudges the whole day's crowd
 * multiplier from the PARK-WIDE observed average, which can move in the
 * opposite direction from one specific ride's own live wait (e.g. the park
 * average reads normal-to-low while a single headliner is running hot).
 * These tests exercise `getDaySnapshot`'s substitution of a ride's own
 * current live standby wait into the CURRENT hour bucket only, when the
 * request is for today and a fresh, operating, numeric live wait exists.
 *
 * Validates: Requirements 4.5 (Correctness Property 18)
 */
import { describe, expect, it, vi } from 'vitest';
import { createPredictionService } from '../predictionService.js';
import type { IntelligenceRepo } from '../IntelligenceRepo.js';
import type { WeatherClient } from '../weatherClient.js';
import type { ThemeParksLiveService } from '../../live/themeParksLiveService.js';

// 2026-09-19 (Saturday) at 16:00Z = 12:00 ET (noon, EDT). Hour bucket 12.
const NOW = new Date('2026-09-19T16:00:00.000Z');
const EXP = 'exp-under-test';

const weatherClient: WeatherClient = {
  getWDWWeather: vi.fn().mockResolvedValue({ current: null, forecast: [] }),
};

function shapeRow(dow: number, hour: number, avg: number) {
  return {
    experience_id: EXP,
    day_of_week: dow,
    hour,
    avg_wait_minutes: avg,
    sample_count: 40,
    sr_avg_wait_minutes: null,
    sr_sample_count: null,
    stddev_wait: 4,
    p50_wait: avg,
    p90_wait: avg + 10,
    down_rate: 0,
    baseline_wait_minutes: avg,
    baseline_sample_count: 40,
  };
}

function makeRepo(): IntelligenceRepo {
  const shapes = Array.from({ length: 7 }, (_, d) => shapeRow(d, 12, 20));
  return {
    getParkCrowdIndices: vi.fn().mockResolvedValue([]),
    getParkScheduleSignals: vi.fn().mockResolvedValue([]),
    getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
    getForecastAccuracies: vi.fn().mockResolvedValue([]),
    getRideShapes: vi.fn().mockResolvedValue(shapes),
    getSeasonHours: vi.fn().mockResolvedValue([]),
    getExperienceSignals: vi.fn().mockResolvedValue([]),
    getWeatherSensitivities: vi.fn().mockResolvedValue([]),
    getExperienceDailySignals: vi.fn().mockResolvedValue([]),
    getShowTimePatterns: vi.fn().mockResolvedValue([]),
  } as unknown as IntelligenceRepo;
}

function makeLiveService(result: Partial<Awaited<ReturnType<ThemeParksLiveService['getLiveDetail']>>>): ThemeParksLiveService {
  return {
    getLiveDetail: vi.fn().mockResolvedValue({
      liveDetail: { status: 'Operating', waitMinutes: 55, showtimes: [], operatingHours: [], diningAvailability: [] },
      retrievedAt: NOW.toISOString(),
      stale: false,
      ...result,
    }),
  };
}

function makeService(opts: { liveService?: ThemeParksLiveService; now?: Date }) {
  return createPredictionService({
    repo: makeRepo(),
    weatherClient,
    now: () => opts.now ?? NOW,
    ...(opts.liveService ? { liveService: opts.liveService } : {}),
  });
}

async function waitAtHour(service: ReturnType<typeof makeService>, date: Date, hour: number) {
  const snapshot = await service.getDaySnapshot([EXP], 'Animal Kingdom', date);
  return snapshot[EXP]!.waits.find((w) => w.hour === hour)!.predictedWaitMinutes;
}

describe('getDaySnapshot same-day live wait substitution (R4.5, Property 18)', () => {
  it('substitutes the live wait into the CURRENT hour bucket when fresh and operating, for today', async () => {
    const liveService = makeLiveService({ liveDetail: { status: 'Operating', waitMinutes: 55, showtimes: [], operatingHours: [], diningAvailability: [] } });
    const service = makeService({ liveService });

    const actual = await waitAtHour(service, NOW, 12);
    expect(actual).toBe(55);
    // Sanity: the model's own value (20, unmultiplied) would NOT have been 55 —
    // proving the live value actually overrode it, not a coincidence.
    expect(actual).not.toBe(20);
  });

  it('does NOT substitute a different hour bucket — only the current hour', async () => {
    const liveService = makeLiveService({});
    const service = makeService({ liveService });

    const snapshot = await service.getDaySnapshot([EXP], 'Animal Kingdom', NOW);
    const otherHour = snapshot[EXP]!.waits.find((w) => w.hour === 8)!.predictedWaitMinutes;
    // Hour 8 was never queried for shape data at DOW=6 above beyond the flat
    // 20 fixture, so it stays model-driven, not the live 55.
    expect(otherHour).not.toBe(55);
  });

  it('does NOT substitute when the live reading is stale', async () => {
    const liveService = makeLiveService({ stale: true });
    const service = makeService({ liveService });

    expect(await waitAtHour(service, NOW, 12)).not.toBe(55);
  });

  it('does NOT substitute when the ride is not Operating', async () => {
    const liveService = makeLiveService({
      liveDetail: { status: 'Closed', waitMinutes: 55, showtimes: [], operatingHours: [], diningAvailability: [] },
    });
    const service = makeService({ liveService });

    expect(await waitAtHour(service, NOW, 12)).not.toBe(55);
  });

  it('does NOT substitute when waitMinutes is absent (e.g. a no-standby entity)', async () => {
    const liveService = makeLiveService({
      liveDetail: { status: 'Operating', showtimes: [], operatingHours: [], diningAvailability: [] },
    });
    const service = makeService({ liveService });

    expect(await waitAtHour(service, NOW, 12)).not.toBe(55);
  });

  it('does NOT substitute for a date other than today (falls back to the model)', async () => {
    const liveService = makeLiveService({});
    const service = makeService({ liveService });

    const futureDate = new Date('2026-10-15T16:00:00.000Z');
    const actual = await waitAtHour(service, futureDate, 12);
    expect(actual).not.toBe(55);
  });

  it('is best-effort: a Live_Service failure falls back silently to the model value', async () => {
    const liveService: ThemeParksLiveService = {
      getLiveDetail: vi.fn().mockRejectedValue(new Error('upstream timeout')),
    };
    const service = makeService({ liveService });

    await expect(waitAtHour(service, NOW, 12)).resolves.not.toThrow();
    const actual = await waitAtHour(service, NOW, 12);
    expect(actual).not.toBe(55);
  });

  it('skips substitution entirely when no liveService dependency is provided (existing callers unaffected)', async () => {
    const service = makeService({});
    const actual = await waitAtHour(service, NOW, 12);
    expect(actual).not.toBe(55);
  });
});
