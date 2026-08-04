import { describe, expect, it } from 'vitest';
import { createPredictionService } from '../predictionService.js';
import type { RideShapeRow } from '../IntelligenceRepo.js';

/**
 * Tests predictionService.getWaitInsights: the ride's park is resolved from
 * experiences.park (never a hardcoded default), and the confidence/percentile
 * fields are aggregated across the day's operating-hour buckets rather than
 * read from a single arbitrary hour bucket.
 */
describe('getWaitInsights (Task 6 backend)', () => {
  // Shape rows for every day-of-week so the test is timezone-independent
  // (the service derives dow from the local-time getDay()).
  function shapesForAllDows(): RideShapeRow[] {
    const hours = [
      { hour: 9, avg: 20, count: 40, sr: null as number | null, srCount: null as number | null },
      { hour: 10, avg: 40, count: 60, sr: 15, srCount: 30 },
      { hour: 11, avg: 60, count: 50, sr: null, srCount: null },
      { hour: 12, avg: 30, count: 20, sr: null, srCount: null },
    ];
    const rows: RideShapeRow[] = [];
    for (let dow = 0; dow < 7; dow++) {
      for (const h of hours) {
        rows.push({
          experience_id: 'exp1',
          day_of_week: dow,
          hour: h.hour,
          avg_wait_minutes: h.avg,
          sample_count: h.count,
          sr_avg_wait_minutes: h.sr,
          sr_sample_count: h.srCount,
          stddev_wait: 5,
          p50_wait: h.avg,
          p90_wait: h.avg + 10,
          down_rate: 0,
        });
      }
    }
    return rows;
  }

  function makeRepo(overrides: Record<string, unknown> = {}) {
    return {
      getRideShapes: async () => shapesForAllDows(),
      getExperienceSignals: async () => [{
        experience_id: 'exp1',
        has_single_rider: true,
        uses_virtual_queue: false,
        downtime_rate: 0.1,
        ll_sellout_median_hour: 13,
        sample_count: 170,
      }],
      getExperiencePark: async () => 'EPCOT',
      getParkScheduleSignals: async (park: string) => {
        expect(park).toBe('EPCOT'); // park must come from experiences.park, not a default
        return [{
          park: 'EPCOT',
          date: new Date('2024-06-12T00:00:00Z'),
          open_time: null,
          close_time: null,
          early_entry: false,
          extended_evening: false,
          ticketed_event: false,
          ll_multipass_price_cents: 1500,
        }];
      },
      getParkCrowdIndices: async () => [],
      getComparableCrowdIndices: async () => [],
      ...overrides,
    } as any;
  }

  const weatherClient = { getWDWWeather: async () => ({ current: null, forecast: [] }) } as any;

  it('aggregates confidence + percentiles across the day and populates the new fields', async () => {
    const service = createPredictionService({
      repo: makeRepo(),
      weatherClient,
      now: () => new Date('2024-05-01T12:00:00Z'), // far from target: no live bias correction
    });

    const insights = await service.getWaitInsights('exp1', new Date('2024-06-12T00:00:00Z'));
    expect(insights).not.toBeNull();

    // 4 operating-hour buckets -> 4 points on the curve
    expect(insights!.waits!.length).toBe(4);

    // sampleCount is the SUM across buckets (40+60+50+20), not a single hour's count
    expect(insights!.sampleCount).toBe(170);

    // percentiles are day-representative and ordered
    expect(insights!.p90WaitMinutes).toBeGreaterThanOrEqual(insights!.p50WaitMinutes);

    // reliability comes from the rolling experience signal
    expect(insights!.downRate).toBeCloseTo(0.1, 5);

    // single-rider surfaced from sr_avg_wait_minutes where offered
    expect(insights!.hasSingleRider).toBe(true);
    expect(insights!.singleRiderP50WaitMinutes).toBeGreaterThan(0);

    // LL price passed through from the schedule signal
    expect(insights!.llMultipassPriceCents).toBe(1500);

    // best/worst hours resolved from the curve
    expect(insights!.bestHour).toBeDefined();
    expect(insights!.worstHour).toBeDefined();
  });

  it('returns null when the ride has no resolvable park', async () => {
    const service = createPredictionService({
      repo: makeRepo({ getExperiencePark: async () => null }),
      weatherClient,
      now: () => new Date('2024-05-01T12:00:00Z'),
    });

    const insights = await service.getWaitInsights('exp1', new Date('2024-06-12T00:00:00Z'));
    expect(insights).toBeNull();
  });
});
