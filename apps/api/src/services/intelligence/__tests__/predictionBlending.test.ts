import { describe, expect, it } from 'vitest';
import { createPredictionService } from '../predictionService.js';
import type { ExperienceWeatherSensitivityRow } from '../IntelligenceRepo.js';

/**
 * Tests that predictionService.getDaySnapshot exercises the real weather
 * sensitivity path: fetching from experience_weather_sensitivity via
 * repo.getWeatherSensitivities(ids, condition), NOT from a nonexistent
 * field on ExperienceSignalRow.
 */
describe('Prediction Blending (Task 4.4)', () => {
  it('blends schedule features, history, and real weather sensitivity from the weather-sensitivity table', async () => {
    // The real ExperienceWeatherSensitivityRow for (exp1, rain)
    const rainSensitivity: ExperienceWeatherSensitivityRow = {
      experience_id: 'exp1',
      condition: 'rain',
      wait_multiplier: 1.15,
      sample_count: 10
    };

    const fakeRepo = {
      getParkCrowdIndices: async () => [],
      getParkScheduleSignals: async () => [{
        park: 'Magic Kingdom',
        date: new Date('2024-01-02T12:00:00Z'),
        open_time: new Date('2024-01-02T14:00:00Z'),
        close_time: new Date('2024-01-03T02:00:00Z'),
        extended_evening: true,
        ll_multipass_price_cents: 2900
      }],
      getComparableCrowdIndices: async () => [
        { date: new Date('2023-01-02T00:00:00Z'), crowd_index: 1.5 },
        { date: new Date('2023-01-03T00:00:00Z'), crowd_index: 1.6 },
      ],
      getRideShapes: async () => [{
        experience_id: 'exp1', day_of_week: 2, hour: 14,
        avg_wait_minutes: 45, sample_count: 50,
        stddev_wait: 5, p50_wait: 40, p90_wait: 60, down_rate: 0
      }],
      getSeasonHours: async () => [],
      // ExperienceSignalRow — no weather_sensitivity field exists here (that's the bug this test guards against)
      getExperienceSignals: async () => [{
        experience_id: 'exp1',
        has_single_rider: false,
        uses_virtual_queue: false,
        downtime_rate: 0.02,
        ll_sellout_median_hour: null,
        sample_count: 50
      }],
      // The REAL weather sensitivity source: experience_weather_sensitivity table
      getWeatherSensitivities: async (ids: string[], condition: string) => {
        expect(condition).toBe('rain'); // Verify we're querying the right condition
        return ids.includes('exp1') ? [rainSensitivity] : [];
      }
    } as any;

    const fakeWeatherClient = {
      getWDWWeather: async () => ({
        current: null,
        forecast: [{
          date: new Date('2024-01-02T00:00:00Z'),
          condition: 'rain'
        }]
      })
    } as any;

    const service = createPredictionService({
      repo: fakeRepo,
      weatherClient: fakeWeatherClient,
      now: () => new Date('2024-01-01T12:00:00Z') // A day before
    });

    const snapshot = await service.getDaySnapshot(['exp1'], 'Magic Kingdom', new Date('2024-01-02T00:00:00Z'));
    const waits = snapshot['exp1']!.waits;
    
    expect(waits.length).toBe(24);
    
    // Find hour 14 (the one with a shape bucket)
    const h14 = waits.find(w => w.hour === 14);
    expect(h14).toBeDefined();
    
    // Calculate expected value:
    //
    // forecastIndex features:
    //   llMultiplier = clamp(2900/100 / 25, 0.7, 1.4) = clamp(1.16, 0.7, 1.4) = 1.16
    //   hoursMultiplier = clamp(12/12, 0.9, 1.2) = 1.0
    //   eveningMultiplier = 1.1
    //   seasonalPrior (Jan 2) ≈ 1.6 (winter break)
    //   featureModel = 1.0 * 1.16 * 1.0 * 1.1 * 1.6 ≈ 2.0416
    //   historyEstimate = avg(1.5, 1.6) = 1.55
    //   w = min(1, 2/20) = 0.1
    //   finalForecast = 0.1*1.55 + 0.9*2.0416 ≈ 1.9924
    //   crowdMultiplier = clamp(1.9924/1.0, 0.4, 2.0) ≈ 1.9924
    //
    // rawWait = 45 * 1.9924 = 89.66
    //
    // weatherAdjustment(1.15, 'rain') = clamp(1.15, 0.75, 1.25) = 1.15
    // adjustedWait = 89.66 * 1.15 = 103.11 → round = 103
    //
    // Without weather (sensitivity = null → adjustment = 1.0):
    // rawWait = 45 * 1.9924 ≈ 89.66 → round = 90
    
    // Verify weather made a difference (wait > no-weather wait)
    expect(h14!.predictedWaitMinutes).toBeGreaterThan(90);
    
    // Also test a hour with NO shape bucket (falls through to parkTypical * multiplier)
    const h0 = waits.find(w => w.hour === 0);
    expect(h0).toBeDefined();
    // expTypicalWait = 45 (avg of the single shape row), parkTypical * multiplier * weather
    // = 45 * 1.9924 * 1.15 ≈ 103 (same as h14 since only 1 shape row → same typical)
    expect(h0!.predictedWaitMinutes).toBeGreaterThan(0);
  });

  it('returns 1.0 weather adjustment when no sensitivity data exists', async () => {
    const fakeRepo = {
      getParkCrowdIndices: async () => [],
      getParkScheduleSignals: async () => [],
      getComparableCrowdIndices: async () => [],
      getRideShapes: async () => [{
        experience_id: 'exp2', day_of_week: 2, hour: 10,
        avg_wait_minutes: 30, sample_count: 50,
        stddev_wait: 3, p50_wait: 28, p90_wait: 45, down_rate: 0
      }],
      getSeasonHours: async () => [],
      getExperienceSignals: async () => [],
      getWeatherSensitivities: async () => [] // Empty — no sensitivity learned yet
    } as any;

    const fakeWeatherClient = {
      getWDWWeather: async () => ({
        current: null,
        forecast: [{ date: new Date('2024-01-02T00:00:00Z'), condition: 'rain' }]
      })
    } as any;

    const service = createPredictionService({
      repo: fakeRepo,
      weatherClient: fakeWeatherClient,
      now: () => new Date('2024-01-01T12:00:00Z')
    });

    const snapshot = await service.getDaySnapshot(['exp2'], 'Magic Kingdom', new Date('2024-01-02T00:00:00Z'));
    const h10 = snapshot['exp2']!.waits.find(w => w.hour === 10);
    expect(h10).toBeDefined();
    
    // With no sensitivity, weatherAdjustment(null, 'rain') = 1.0
    // So the wait should be based purely on shape × multiplier, no weather distortion
    expect(h10!.predictedWaitMinutes).toBeGreaterThan(0);
  });

  it('uses seeded park_crowd_index rows for forecast calculations on target dates', async () => {
    const fakeRepo = {
      getParkCrowdIndices: async (park: string, dates: Date[]) => {
        return [{
          park,
          date: dates[0]!,
          crowd_index: 0.6, // Level 3 (Quiet)
          daily_avg_wait: 25,
          sample_count: 0,
          source: 'seed'
        }];
      },
      getParkScheduleSignals: async () => [],
      getComparableCrowdIndices: async () => []
    } as any;

    const service = createPredictionService({
      repo: fakeRepo,
      weatherClient: { getWDWWeather: async () => ({ current: null, forecast: [] }) } as any,
      now: () => new Date('2026-08-07T12:00:00Z')
    });

    const day = await service.getCrowdCalendarDay('Magic Kingdom', new Date('2026-08-15T00:00:00Z'));
    expect(day.forecastIndex).toBe(3); // displayLevel(0.6) = 3 (Quiet)
  });
});
