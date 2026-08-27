/**
 * Feature: crowd-calendar — task 19.7. Asserts `getDaySnapshot` actually REACHES
 * the R15/R16 tier logic with the right arguments.
 *
 * `shrinkToPooled` and the tier-1 de-meaning are proven at the unit level, but
 * unit coverage of the math says nothing about whether the service passes it the
 * pooled mean or the raw forecast index. A wrong argument here would leave every
 * existing test green while the feature did nothing — so these assert the
 * returned `predictedWaitMinutes`, not the helper.
 *
 * Test date 2026-08-05T16:00:00Z -> 12:00 ET, day-of-week 3 (Wednesday).
 */
import { describe, expect, it, vi } from 'vitest';
import { createPredictionService } from '../predictionService.js';
import { DOW_SHRINKAGE_K } from '../waitMath.js';
import type { IntelligenceRepo } from '../IntelligenceRepo.js';
import type { WeatherClient } from '../weatherClient.js';

const TARGET = new Date('2026-08-05T16:00:00Z');
const NOW = new Date('2026-08-05T16:00:00Z');
const DOW = 3;
const HOUR = 14;
const EXP = 'exp-under-test';

const weatherClient: WeatherClient = {
  getWDWWeather: vi.fn().mockResolvedValue({
    // No forecast entry for the target date -> weatherAdjustment is a 1.0 no-op,
    // so the assertions below are about tier arithmetic only.
    current: { condition: 'Clear', tempF: 82, precip: 0 },
    forecast: [],
  }),
};

function shapeRow(dow: number, hour: number, avg: number, sampleCount: number) {
  return {
    experience_id: EXP,
    day_of_week: dow,
    hour,
    avg_wait_minutes: avg,
    sample_count: sampleCount,
    sr_avg_wait_minutes: null,
    sr_sample_count: null,
    stddev_wait: 4,
    p50_wait: avg,
    p90_wait: avg + 10,
    down_rate: 0,
    baseline_wait_minutes: avg,
    baseline_sample_count: sampleCount,
  };
}

/**
 * `crowdIndex` is injected as a `source: 'seed'` row, which `computeRawForecast`
 * returns verbatim — giving the test exact control of `forecastIndex`.
 */
function makeService(opts: { shapes: any[]; seasons?: any[]; crowdIndex: number }) {
  const repo = {
    getParkCrowdIndices: vi.fn(async (park: string, dates: Date[]) => [
      {
        park,
        date: dates[0],
        crowd_index: opts.crowdIndex,
        daily_avg_wait: 20,
        sample_count: 0,
        source: 'seed',
      },
    ]),
    getParkScheduleSignals: vi.fn().mockResolvedValue([]),
    getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
    getForecastAccuracies: vi.fn().mockResolvedValue([]),
    getRideShapes: vi.fn().mockResolvedValue(opts.shapes),
    getSeasonHours: vi.fn().mockResolvedValue(opts.seasons ?? []),
    getExperienceSignals: vi.fn().mockResolvedValue([]),
    getWeatherSensitivities: vi.fn().mockResolvedValue([]),
    getExperienceDailySignals: vi.fn().mockResolvedValue([]),
    getShowTimePatterns: vi.fn().mockResolvedValue([]),
  } as unknown as IntelligenceRepo;

  return createPredictionService({ repo, weatherClient, now: () => NOW });
}

async function waitAtHour(service: ReturnType<typeof makeService>, hour: number) {
  const snapshot = await service.getDaySnapshot([EXP], 'Magic Kingdom', TARGET);
  return snapshot[EXP]!.waits.find((w) => w.hour === hour)!.predictedWaitMinutes;
}

describe('Feature: crowd-calendar — getDaySnapshot applies day-of-week shrinkage (R16)', () => {
  it('blends a thin weekday bucket toward the pooled per-hour mean', async () => {
    // Wednesday at 14:00 reads 60 min off only 2 samples; the other six weekdays
    // read 20 min at the same hour. Pooled mean = (60 + 6*20) / 7 = 25.714.
    const shapes = [shapeRow(DOW, HOUR, 60, 2)];
    for (let d = 0; d < 7; d++) {
      if (d !== DOW) shapes.push(shapeRow(d, HOUR, 20, 30));
    }

    const service = makeService({ shapes, crowdIndex: 1.0 });
    const actual = await waitAtHour(service, HOUR);

    const pooled = (60 + 6 * 20) / 7;
    const expected = Math.round(
      (60 * 2 + pooled * DOW_SHRINKAGE_K) / (2 + DOW_SHRINKAGE_K),
    );
    expect(actual).toBe(expected);
    expect(actual).toBe(33);

    // It is neither the raw bucket nor the pooled mean — the two behaviors this
    // change sits between.
    expect(actual).not.toBe(60);
    expect(actual).not.toBe(Math.round(pooled));
  });

  it('converges on the raw weekday bucket once that bucket is dense', async () => {
    // Same fixture, but Wednesday now has 400 samples behind it.
    const shapes = [shapeRow(DOW, HOUR, 60, 400)];
    for (let d = 0; d < 7; d++) {
      if (d !== DOW) shapes.push(shapeRow(d, HOUR, 20, 30));
    }

    const service = makeService({ shapes, crowdIndex: 1.0 });
    // (60*400 + 25.714*8) / 408 = 59.33 -> 59, within a minute of the raw 60.
    expect(await waitAtHour(service, HOUR)).toBe(59);
  });

  it('uses the raw bucket unchanged when no other weekday has data to pool', async () => {
    const service = makeService({ shapes: [shapeRow(DOW, HOUR, 60, 2)], crowdIndex: 1.0 });
    // Pooled mean over a single weekday IS that weekday, so the blend is a no-op.
    expect(await waitAtHour(service, HOUR)).toBe(60);
  });
});

describe('Feature: crowd-calendar — getDaySnapshot passes the raw forecast to tier 1 (R15)', () => {
  const seasonBucket = (avgCrowdIndex: number | null) => [
    {
      experience_id: EXP,
      season: 2,
      day_of_week: DOW,
      hour: HOUR,
      avg_wait_minutes: 45,
      sample_count: 40,
      avg_crowd_index: avgCrowdIndex,
    },
  ];

  it('predicts differently for a quiet and a busy date once the bucket is mature', async () => {
    const shapes = [shapeRow(DOW, HOUR, 30, 40)];

    const quiet = makeService({ shapes, seasons: seasonBucket(0.9), crowdIndex: 0.75 });
    const busy = makeService({ shapes, seasons: seasonBucket(0.9), crowdIndex: 1.35 });

    // 45 * (0.75 / 0.9) = 37.5 -> 38 ; 45 * (1.35 / 0.9) = 67.5 -> 68
    expect(await waitAtHour(quiet, HOUR)).toBe(38);
    expect(await waitAtHour(busy, HOUR)).toBe(68);

    // Before this change both returned the bucket's raw 45 regardless of date.
    expect(await waitAtHour(quiet, HOUR)).not.toBe(45);
    expect(await waitAtHour(busy, HOUR)).not.toBe(45);
  });

  it('returns the bucket average when the date matches the level the bucket was built under', async () => {
    const service = makeService({
      shapes: [shapeRow(DOW, HOUR, 30, 40)],
      seasons: seasonBucket(0.9),
      crowdIndex: 0.9,
    });
    expect(await waitAtHour(service, HOUR)).toBe(45);
  });

  it('falls back to the raw bucket average when the embedded crowd level is unknown', async () => {
    const shapes = [shapeRow(DOW, HOUR, 30, 40)];

    const quiet = makeService({ shapes, seasons: seasonBucket(null), crowdIndex: 0.75 });
    const busy = makeService({ shapes, seasons: seasonBucket(null), crowdIndex: 1.35 });

    // R15.3 — no measured level, so no scaling is asserted in either direction.
    expect(await waitAtHour(quiet, HOUR)).toBe(45);
    expect(await waitAtHour(busy, HOUR)).toBe(45);
  });

  it('ignores an immature season bucket and uses the shape tier instead', async () => {
    const shapes = [shapeRow(DOW, HOUR, 30, 40)];
    const immature = [{ ...seasonBucket(0.9)[0]!, sample_count: 5 }];

    const service = makeService({ shapes, seasons: immature, crowdIndex: 1.2 });
    // Tier 2: single weekday so no shrinkage, 30 * clamp(1.2) = 36.
    expect(await waitAtHour(service, HOUR)).toBe(36);
  });
});
