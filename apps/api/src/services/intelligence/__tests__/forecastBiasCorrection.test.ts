/**
 * Feature: crowd-calendar, Property 19 — R7.4 calibration loop, R7.7 scope.
 *
 * `reconcileForecasts` had been measuring per-(park, lead_days) bias since the
 * forecast log shipped and nothing consumed it: `applyBiasCorrection` existed
 * with a single caller, a property test. The measured bias is overwhelmingly
 * systematic rather than noise — Magic Kingdom ran MAE 0.266 against bias
 * +0.236 (~89% of its error) and Animal Kingdom MAE 0.220 against -0.203
 * (~92%) — so subtracting it is the largest crowd-accuracy gain available.
 *
 * It is applied to the PUBLISHED forecast only. The bias is measured against a
 * park-level crowd ratio; pushing +0.236 through the Crowd_Multiplier would
 * move every Magic Kingdom wait prediction ~24% — about 11 minutes on a
 * 45-minute headliner, which EXCEEDS that model's own ~10-minute MAE. A holdout
 * test also found the index's day-to-day component carried no usable wait
 * signal (de-meaning it raised wait MAE from 5.87 to 6.52 min). So the wait path
 * stays uncalibrated until R18 can score both variants (R7.7).
 *
 * The correction assertions fail against the pre-change code; the invariance
 * assertions fail against the first version of this change, which propagated the
 * correction into every wait prediction.
 */
import { describe, expect, it, vi } from 'vitest';
import { createPredictionService } from '../predictionService.js';
import type { IntelligenceRepo } from '../IntelligenceRepo.js';
import type { WeatherClient } from '../weatherClient.js';
import { displayLevel } from '../waitMath.js';

const weatherClient: WeatherClient = {
  getWDWWeather: vi.fn().mockResolvedValue({
    current: { condition: 'Clear', tempF: 82, precip: 0 },
    forecast: [],
  }),
};

/** Fixed "now" so lead-day arithmetic in the service is deterministic. */
const NOW = new Date('2026-08-26T15:00:00Z');
/** 7 days past the fixed NOW. */
const TARGET = new Date('2026-09-02T16:00:00Z');

const EXP = 'exp-seven-dwarfs';

interface AccuracyRow {
  park: string;
  lead_days: number;
  mae: number;
  bias: number;
  sample_count: number;
}

/**
 * A ride shape dense enough to drive tier 2, so the wait-path invariance
 * assertions are about a real predicted wait rather than a fallback constant.
 */
function shapeRows() {
  const rows = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 9; hour <= 20; hour++) {
      rows.push({
        experience_id: EXP,
        day_of_week: dow,
        hour,
        avg_wait_minutes: 45,
        sample_count: 40,
        sr_avg_wait_minutes: null,
        sr_sample_count: null,
        stddev_wait: 8,
        p50_wait: 44,
        p90_wait: 60,
        down_rate: 0.02,
        baseline_wait_minutes: 45,
        baseline_sample_count: 40,
      });
    }
  }
  return rows;
}

function makeService(accuracies: AccuracyRow[], repoOverrides: Record<string, unknown> = {}) {
  const repo = {
    // No observed/seed index for the target date, so the feature model runs.
    getParkCrowdIndices: vi.fn().mockResolvedValue([]),
    getParkScheduleSignals: vi.fn().mockResolvedValue([]),
    getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
    getForecastAccuracies: vi.fn().mockResolvedValue(accuracies),
    getRideShapes: vi.fn().mockResolvedValue(shapeRows()),
    // No season bucket, so tier 2 (shape x absolute crowd factor) is selected.
    getSeasonHours: vi.fn().mockResolvedValue([]),
    getExperienceSignals: vi.fn().mockResolvedValue([]),
    getWeatherSensitivities: vi.fn().mockResolvedValue([]),
    getExperienceDailySignals: vi.fn().mockResolvedValue([]),
    getShowTimePatterns: vi.fn().mockResolvedValue([]),
    ...repoOverrides,
  } as unknown as IntelligenceRepo;

  return createPredictionService({ repo, weatherClient, now: () => NOW });
}

/** Magic Kingdom's real measured shape: we read it ~0.24 ratio units busy. */
const MK_BIAS: AccuracyRow[] = [
  { park: 'Magic Kingdom', lead_days: 7, mae: 0.238, bias: 0.236, sample_count: 8 },
];

describe('Feature: crowd-calendar — measured bias reaches the published forecast (R7.4)', () => {
  it('subtracts a positive bias, so a park we historically over-forecast publishes lower', async () => {
    const baseline = await makeService([]).getCalibratedForecast('Magic Kingdom', TARGET);
    const corrected = await makeService(MK_BIAS).getCalibratedForecast('Magic Kingdom', TARGET);

    expect(corrected).toBeCloseTo(baseline - 0.236, 6);
    expect(corrected).toBeLessThan(baseline);
  });

  it('adds back a negative bias, so a park we historically under-forecast publishes higher', async () => {
    const baseline = await makeService([]).getCalibratedForecast('Animal Kingdom', TARGET);
    const corrected = await makeService([
      { park: 'Animal Kingdom', lead_days: 7, mae: 0.197, bias: -0.197, sample_count: 8 },
    ]).getCalibratedForecast('Animal Kingdom', TARGET);

    expect(corrected).toBeCloseTo(baseline + 0.197, 6);
    expect(corrected).toBeGreaterThan(baseline);
  });

  it('leaves an uncalibrated park untouched rather than correcting by a fabricated zero', async () => {
    const baseline = await makeService([]).getCalibratedForecast('EPCOT', TARGET);
    // Rows exist but nothing has been reconciled yet (sample_count 0).
    const unscored = makeService([
      { park: 'EPCOT', lead_days: 7, mae: 0, bias: 0, sample_count: 0 },
    ]);
    expect(await unscored.getCalibratedForecast('EPCOT', TARGET)).toBeCloseTo(baseline, 9);
  });

  it('picks the accuracy row whose lead time is closest to the target date', async () => {
    // TARGET is 7 days out. The 7-day row must win over the 1- and 30-day rows.
    const service = makeService([
      { park: 'Hollywood Studios', lead_days: 1, mae: 0.5, bias: 0.5, sample_count: 14 },
      { park: 'Hollywood Studios', lead_days: 7, mae: 0.1, bias: 0.1, sample_count: 8 },
      { park: 'Hollywood Studios', lead_days: 30, mae: 0.4, bias: -0.4, sample_count: 3 },
    ]);
    const baseline = await makeService([]).getCalibratedForecast('Hollywood Studios', TARGET);

    expect(await service.getCalibratedForecast('Hollywood Studios', TARGET)).toBeCloseTo(
      baseline - 0.1,
      6,
    );
  });

  it('bounds the correction so a wild bias cannot push the forecast out of the ratio band', async () => {
    const corrected = await makeService([
      { park: 'EPCOT', lead_days: 7, mae: 9, bias: 9, sample_count: 20 },
    ]).getCalibratedForecast('EPCOT', TARGET);

    // applyBiasCorrection clamps the correction to +/-0.5 and the result to the
    // ratio band, so a 9.0 bias can neither be applied in full nor drive the
    // forecast below 0.4.
    expect(corrected).toBeGreaterThanOrEqual(0.4);
    expect(corrected).toBeLessThanOrEqual(3.0);
  });

  it('degrades to the uncorrected forecast when the accuracy store is unavailable', async () => {
    const baseline = await makeService([]).getCalibratedForecast('EPCOT', TARGET);

    const repo = {
      getParkCrowdIndices: vi.fn().mockResolvedValue([]),
      getParkScheduleSignals: vi.fn().mockResolvedValue([]),
      getComparableCrowdIndices: vi.fn().mockResolvedValue([]),
      getForecastAccuracies: vi.fn().mockRejectedValue(new Error('db down')),
      getRideShapes: vi.fn().mockResolvedValue([]),
      getSeasonHours: vi.fn().mockResolvedValue([]),
      getExperienceSignals: vi.fn().mockResolvedValue([]),
      getWeatherSensitivities: vi.fn().mockResolvedValue([]),
      getExperienceDailySignals: vi.fn().mockResolvedValue([]),
      getShowTimePatterns: vi.fn().mockResolvedValue([]),
    } as unknown as IntelligenceRepo;

    const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const service = createPredictionService({ repo, weatherClient, logger, now: () => NOW });

    // Calibration is an improvement, never a dependency.
    await expect(service.getCalibratedForecast('EPCOT', TARGET)).resolves.toBeCloseTo(baseline, 9);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('Feature: crowd-calendar — the correction is scoped to the published path (R7.7)', () => {
  it('publishes the calibrated value on the calendar, matching what captureForecasts freezes', async () => {
    const service = makeService(MK_BIAS);

    const calibrated = await service.getCalibratedForecast('Magic Kingdom', TARGET);
    const day = await service.getCrowdCalendarDay('Magic Kingdom', TARGET);

    // Property 19.1 — the frozen value and the displayed value are the same
    // number, so published accuracy describes the forecast a user actually saw.
    expect(day.forecastIndex).toBe(displayLevel(calibrated));
  });

  it('does NOT move getRawForecast — the wait path sees the model output unchanged', async () => {
    const uncalibrated = await makeService([]).getRawForecast('Magic Kingdom', TARGET);
    const withBias = await makeService(MK_BIAS).getRawForecast('Magic Kingdom', TARGET);

    expect(withBias).toBe(uncalibrated);
  });

  it('does NOT move getCrowdMultiplier — the Day Planning optimizer is unaffected', async () => {
    const uncalibrated = await makeService([]).getCrowdMultiplier('Magic Kingdom', TARGET);
    const withBias = await makeService(MK_BIAS).getCrowdMultiplier('Magic Kingdom', TARGET);

    expect(withBias).toBe(uncalibrated);
  });

  it('does NOT move a single predicted wait minute in getDaySnapshot', async () => {
    const without = await makeService([]).getDaySnapshot([EXP], 'Magic Kingdom', TARGET);
    const with_ = await makeService(MK_BIAS).getDaySnapshot([EXP], 'Magic Kingdom', TARGET);

    // Sanity: this fixture really does produce non-trivial waits, so the
    // equality below is about the correction being scoped and not about both
    // sides being empty.
    const waits = without[EXP]!.waits.filter((w) => w.predictedWaitMinutes > 0);
    expect(waits.length).toBeGreaterThan(0);

    // Bit-identical hour by hour (Property 19.2). Against the first version of
    // this change every one of these was ~24% lower.
    expect(with_[EXP]!.waits).toEqual(without[EXP]!.waits);
  });

  it('keeps the published and wait-path values genuinely different when a bias exists', async () => {
    // Guards against the invariance tests above passing vacuously because the
    // correction was never applied anywhere at all.
    const service = makeService(MK_BIAS);
    const raw = await service.getRawForecast('Magic Kingdom', TARGET);
    const calibrated = await service.getCalibratedForecast('Magic Kingdom', TARGET);

    expect(calibrated).not.toBeCloseTo(raw, 6);
    expect(raw - calibrated).toBeCloseTo(0.236, 6);
  });
});
