import { describe, expect, it } from 'vitest';
import { createSamplingService } from '../samplingService.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';
import type { WaitSampleRow, RideShapeRow } from '../IntelligenceRepo.js';

/**
 * Regression test for the standby-basket crowd-index fix (R2.7 / R2.8).
 *
 * A mixed park has:
 *   - A headliner ride (45-min standby wait)
 *   - A walk-on ride (0-min standby wait)
 *   - A show (OPERATING, no STANDBY queue — showtimes only)
 *   - A restaurant (OPERATING, no queue at all)
 *
 * After a sampling pass:
 *   1. wait_samples should contain ONLY the two rides (not the show/restaurant).
 *   2. park_crowd_index should be the per-ride-relative aggregate over those
 *      two rides — NOT the old all-entries average (which would have dragged
 *      the index down by averaging in the show/restaurant zeros).
 *
 * This test MUST fail against the pre-change code that averaged all entries.
 */
describe('Feature: crowd-calendar — standby basket crowd-index regression', () => {
  function makeFixture() {
    const insertedWaitSamples: WaitSampleRow[] = [];
    const crowdIndexUpserts: any[] = [];

    // Ride shapes for expected waits (used by relativeCrowdIndex)
    // Test date: 2026-08-05T16:00:00Z → 12:00 ET (DOW 3 Wed, hour 12)
    const rideShapes: RideShapeRow[] = [
      {
        experience_id: 'headliner-db', day_of_week: 3, hour: 12,
        avg_wait_minutes: 60, sample_count: 50,
        sr_avg_wait_minutes: null, sr_sample_count: null,
        stddev_wait: 10, p50_wait: 55, p90_wait: 80, down_rate: 0.02,
        // R14: the Crowd_Index now divides by the slow baseline, not
        // avg_wait_minutes. Set equal here so this fixture's expected index is
        // unchanged by the denominator swap and keeps testing what it was
        // written to test (basket membership, not baseline mechanics).
        baseline_wait_minutes: 60, baseline_sample_count: 50,
      },
      {
        experience_id: 'walkOn-db', day_of_week: 3, hour: 12,
        avg_wait_minutes: 10, sample_count: 30,
        sr_avg_wait_minutes: null, sr_sample_count: null,
        stddev_wait: 3, p50_wait: 8, p90_wait: 15, down_rate: 0.01,
        baseline_wait_minutes: 10, baseline_sample_count: 30,
      },
    ];

    const fakeLiveClient: ThemeParksLiveClient = {
      async getEntityLive(id: string) {
        if (id === 'mk-park') {
          return {
            id,
            name: 'Magic Kingdom',
            entityType: 'PARK',
            timezone: 'America/New_York',
            liveData: [
              // Headliner ride — 45-min standby
              {
                id: 'headliner-tp',
                name: 'Space Mountain',
                status: 'OPERATING',
                queue: { STANDBY: { waitTime: 45 } },
              },
              // Walk-on ride — 0-min standby (real low-crowd signal)
              {
                id: 'walkOn-tp',
                name: "it's a small world",
                status: 'OPERATING',
                queue: { STANDBY: { waitTime: 0 } },
              },
              // Show — OPERATING but no STANDBY queue
              {
                id: 'show-tp',
                name: 'Festival of Fantasy Parade',
                status: 'OPERATING',
                showtimes: [{ startTime: '2026-08-05T15:00:00Z', endTime: '2026-08-05T15:30:00Z' }],
                // No queue at all
              },
              // Restaurant — OPERATING but no queue
              {
                id: 'restaurant-tp',
                name: 'Be Our Guest Restaurant',
                status: 'OPERATING',
                // No queue at all
              },
            ],
          };
        }
        return { id, name: 'Other', entityType: 'PARK', timezone: 'America/New_York', liveData: [] };
      },
      async getEntitySchedule() {
        return { schedule: [] };
      },
    };

    const fakeCatalogClient = {
      async getDestinations() {
        return {
          destinations: [{
            id: 'wdw',
            name: 'Walt Disney World Resort',
            parks: [{ id: 'mk-park', name: 'Magic Kingdom' }],
          }],
        };
      },
    } as unknown as ThemeParksClient;

    const fakeRepo = {
      getExperiencesWithUpstreamIds: async () => [
        { id: 'headliner-db', upstream_entity_id: 'headliner-tp', park: 'Magic Kingdom' },
        { id: 'walkOn-db', upstream_entity_id: 'walkOn-tp', park: 'Magic Kingdom' },
        { id: 'show-db', upstream_entity_id: 'show-tp', park: 'Magic Kingdom' },
        { id: 'restaurant-db', upstream_entity_id: 'restaurant-tp', park: 'Magic Kingdom' },
      ],
      upsertWeatherObservations: async () => {},
      upsertParkScheduleSignals: async () => {},
      insertWaitSamples: async (rows: WaitSampleRow[]) => {
        insertedWaitSamples.push(...rows);
      },
      upsertExperienceDailySignals: async () => {},
      upsertRideShapes: async () => {},
      upsertSeasonHours: async () => {},
      upsertExperienceSignals: async () => {},
      getParkCrowdIndices: async () => [],
      upsertParkCrowdIndices: async (rows: any[]) => {
        crowdIndexUpserts.push(...rows);
      },
      pruneWaitSamples: async () => {},
      getRideShapes: async () => rideShapes,
      getSeasonHours: async () => [],
      getExperienceSignals: async () => [],
    } as any;

    const fakeDirectory = {
      resolveEntityId: async (id: string) => id,
      prime: async () => {},
    } as any;

    const fakeWeatherClient = {
      getWDWWeather: async () => ({ current: null, forecast: [] }),
    } as any;

    const service = createSamplingService({
      repo: fakeRepo,
      liveClient: fakeLiveClient,
      catalogClient: fakeCatalogClient,
      directory: fakeDirectory,
      weatherClient: fakeWeatherClient,
      now: () => new Date('2026-08-05T16:00:00Z'),
    });

    return { service, insertedWaitSamples, crowdIndexUpserts };
  }

  it('wait_samples are written ONLY for the two rides (not show/restaurant)', async () => {
    const { service, insertedWaitSamples } = makeFixture();

    await service.runSamplingPass();

    // Only the headliner and walk-on rides should produce wait_samples
    const sampleExpIds = insertedWaitSamples.map(s => s.experience_id);
    expect(sampleExpIds).toHaveLength(2);
    expect(sampleExpIds).toContain('headliner-db');
    expect(sampleExpIds).toContain('walkOn-db');

    // The show and restaurant must NOT produce wait_samples
    expect(sampleExpIds).not.toContain('show-db');
    expect(sampleExpIds).not.toContain('restaurant-db');

    // The walk-on ride's wait should be 0 (real low-crowd signal, not excluded)
    const walkOnSample = insertedWaitSamples.find(s => s.experience_id === 'walkOn-db')!;
    expect(walkOnSample.wait_minutes).toBe(0);
  });

  it('crowd_index is the per-ride-relative aggregate over the two rides', async () => {
    const { service, crowdIndexUpserts } = makeFixture();

    await service.runSamplingPass();

    // A crowd index should be written for Magic Kingdom
    expect(crowdIndexUpserts).toHaveLength(1);
    expect(crowdIndexUpserts[0].park).toBe('Magic Kingdom');

    // Per-ride-relative index:
    //   headliner: observed 45 / expected 60 = 0.75
    //   walk-on:   observed 0  / expected 10 = 0.0
    //   mean = (0.75 + 0.0) / 2 = 0.375
    const expectedRelativeIndex = (45 / 60 + 0 / 10) / 2;
    expect(crowdIndexUpserts[0].crowd_index).toBeCloseTo(expectedRelativeIndex, 5);

    // The old all-entries logic would have computed:
    //   (45 + 0 + 0 + 0) / 4 = 11.25  (raw average)
    //   then normalized by a 35-min baseline → 11.25/35 ≈ 0.321
    // This is DIFFERENT from the per-ride-relative value above, which
    // correctly reflects that the headliner is at 75% of its typical
    // wait while the walk-on is at 0% — a deliberately different and
    // more accurate signal. The old code also included the show and
    // restaurant zeros, further suppressing the index.
    const oldAllEntriesAvg = (45 + 0 + 0 + 0) / 4;
    const oldNormalizedIndex = oldAllEntriesAvg / 35; // ≈ 0.321
    // The new per-ride-relative index MUST differ from the old one
    expect(crowdIndexUpserts[0].crowd_index).not.toBeCloseTo(oldNormalizedIndex, 2);
  });

  it('daily_avg_wait is the basket mean posted wait (informational only)', async () => {
    const { service, crowdIndexUpserts } = makeFixture();

    await service.runSamplingPass();

    // daily_avg_wait = basket mean = (45 + 0) / 2 = 22.5
    expect(crowdIndexUpserts[0].daily_avg_wait).toBeCloseTo(22.5, 5);
  });
});
