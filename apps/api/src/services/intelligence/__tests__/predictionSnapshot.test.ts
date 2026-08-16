import { describe, expect, it } from 'vitest';
import { createPredictionService } from '../predictionService.js';

/**
 * getDaySnapshot must expose the per-experience type signals the day-planning
 * optimizer relies on (crowd-calendar R9.5): single-rider wait (from the
 * single-rider shape, available for any date), plus showtimes and Lightning
 * Lane from the per-date signals when present.
 */
describe('getDaySnapshot signal enrichment (R9.5)', () => {
  const fakeWeatherClient = { getWDWWeather: async () => ({ current: null, forecast: [] }) } as any;

  function makeRepo(overrides: Record<string, unknown> = {}) {
    return {
      getParkCrowdIndices: async () => [],
      getParkScheduleSignals: async () => [],
      getComparableCrowdIndices: async () => [],
      getSeasonHours: async () => [],
      getWeatherSensitivities: async () => [],
      // dow for 2024-06-12 (noon ET) — computed the same way the service does.
      getRideShapes: async () => {
        const dow = new Date('2024-06-12T12:00:00-04:00').getDay();
        return [{
          experience_id: 'exp1', day_of_week: dow, hour: 10,
          avg_wait_minutes: 60, sample_count: 50,
          sr_avg_wait_minutes: 20, sr_sample_count: 30,
          stddev_wait: 5, p50_wait: 55, p90_wait: 80, down_rate: 0,
        }];
      },
      getExperienceSignals: async () => [{
        experience_id: 'exp1', has_single_rider: true, uses_virtual_queue: false,
        downtime_rate: 0, ll_sellout_median_hour: null, sample_count: 50,
      }],
      getExperienceDailySignals: async () => [{
        experience_id: 'exp1', date: new Date('2024-06-12T00:00:00Z'),
        ll_price_cents: 1500, ll_available: true, used_virtual_queue: null,
        showtimes: ['2024-06-12T16:00:00.000Z', '2024-06-12T19:00:00.000Z', '2024-06-12T22:00:00.000Z'],
      }],
      ...overrides,
    } as any;
  }

  it('populates singleRiderWaitMinutes, showtimes, and lightningLane', async () => {
    const service = createPredictionService({
      repo: makeRepo(),
      weatherClient: fakeWeatherClient,
      now: () => new Date('2024-05-01T12:00:00Z'),
    });

    const snap = await service.getDaySnapshot(['exp1'], 'EPCOT', new Date('2024-06-12T00:00:00Z'));
    const s = snap['exp1']!;

    // Single-rider wait present on the hour-10 bucket (sr shape × multiplier), and < standby.
    const h10 = s.waits.find(w => w.hour === 10)!;
    expect(h10.singleRiderWaitMinutes).toBeGreaterThan(0);
    expect(h10.singleRiderWaitMinutes!).toBeLessThan(h10.predictedWaitMinutes);

    // showtimes + lightningLane carried from the per-date signal.
    expect(s.showtimes).toEqual(['2024-06-12T16:00:00.000Z', '2024-06-12T19:00:00.000Z', '2024-06-12T22:00:00.000Z']);
    expect(s.lightningLane?.available).toBe(true);
    expect(s.lightningLane?.priceCents).toBe(1500);
  });

  it('omits per-date signals when none exist (far-future date), but still gives single-rider', async () => {
    const service = createPredictionService({
      repo: makeRepo({ getExperienceDailySignals: async () => [] }),
      weatherClient: fakeWeatherClient,
      now: () => new Date('2024-05-01T12:00:00Z'),
    });

    const snap = await service.getDaySnapshot(['exp1'], 'EPCOT', new Date('2024-06-12T00:00:00Z'));
    const s = snap['exp1']!;

    expect(s.showtimes).toBeUndefined();
    expect(s.lightningLane).toBeUndefined();
    // Single-rider still available (it comes from the shape, not per-date signals).
    expect(s.waits.find(w => w.hour === 10)!.singleRiderWaitMinutes).toBeGreaterThan(0);
  });
});
