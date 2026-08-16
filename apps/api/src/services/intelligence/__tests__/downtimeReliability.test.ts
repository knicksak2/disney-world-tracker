import { describe, expect, it } from 'vitest';
import { createSamplingService } from '../samplingService.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';
import type { ExperienceSignalRow } from '../IntelligenceRepo.js';

/**
 * Regression test for the downtime/reliability-rate fix (R9.2).
 *
 * The rolling `experience_signals.downtime_rate` must reflect *operational*
 * reliability — the rate a ride is unexpectedly DOWN while it would otherwise
 * be operating. Before this fix, the sampling pass folded status `CLOSED`
 * (scheduled non-operation: pre-open, post-close, seasonal) into the same
 * EMA as `DOWN`, so a ride sampled during the many overnight/pre-open passes
 * accrued a large false "downtime" rate (observed ~22% in production).
 *
 * One pass over a park with three mapped rides:
 *   - an OPERATING ride  → downtime sample 0.0
 *   - a DOWN ride        → downtime sample 1.0
 *   - a CLOSED ride      → NOT a downtime observation; must be excluded
 *
 * With no prior signal (sample_count 0 ⇒ EMA weight 1.0), the resulting rate
 * equals the single folded sample. This test MUST fail against the pre-fix
 * code, where the CLOSED ride's rate would be 1.0.
 */
describe('Feature: crowd-calendar — downtime/reliability rate excludes scheduled CLOSED (R9.2)', () => {
  function makeFixture() {
    const signalUpserts: ExperienceSignalRow[] = [];

    const fakeLiveClient: ThemeParksLiveClient = {
      async getEntityLive(id: string) {
        if (id === 'mk-park') {
          return {
            id,
            name: 'Magic Kingdom',
            entityType: 'PARK',
            timezone: 'America/New_York',
            liveData: [
              // Operating ride with a posted standby wait
              {
                id: 'operating-tp',
                name: 'Space Mountain',
                status: 'OPERATING',
                queue: { STANDBY: { waitTime: 35 } },
              },
              // Ride currently DOWN (unexpected breakdown) — real downtime
              {
                id: 'down-tp',
                name: 'Big Thunder Mountain Railroad',
                status: 'DOWN',
              },
              // Ride CLOSED (scheduled non-operation, e.g. before open) —
              // must NOT be counted as downtime
              {
                id: 'closed-tp',
                name: 'Tomorrowland Speedway',
                status: 'CLOSED',
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
        { id: 'operating-db', upstream_entity_id: 'operating-tp', park: 'Magic Kingdom' },
        { id: 'down-db', upstream_entity_id: 'down-tp', park: 'Magic Kingdom' },
        { id: 'closed-db', upstream_entity_id: 'closed-tp', park: 'Magic Kingdom' },
      ],
      upsertWeatherObservations: async () => {},
      upsertParkScheduleSignals: async () => {},
      insertWaitSamples: async () => {},
      upsertExperienceDailySignals: async () => {},
      upsertRideShapes: async () => {},
      upsertSeasonHours: async () => {},
      upsertExperienceSignals: async (rows: ExperienceSignalRow[]) => {
        signalUpserts.push(...rows);
      },
      getParkCrowdIndices: async () => [],
      upsertParkCrowdIndices: async () => {},
      pruneWaitSamples: async () => {},
      getRideShapes: async () => [],
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

    return { service, signalUpserts };
  }

  it('a scheduled-CLOSED ride is not counted as downtime', async () => {
    const { service, signalUpserts } = makeFixture();

    await service.runSamplingPass();

    const closed = signalUpserts.find(s => s.experience_id === 'closed-db')!;
    expect(closed).toBeDefined();
    // Would be 1.0 under the pre-fix code that folded CLOSED as "down".
    expect(closed.downtime_rate).toBe(0);
    // The reliability EMA denominator must not advance for a non-reliability
    // observation.
    expect(closed.sample_count).toBe(0);
  });

  it('a DOWN ride folds a full downtime observation; an OPERATING ride folds zero', async () => {
    const { service, signalUpserts } = makeFixture();

    await service.runSamplingPass();

    const down = signalUpserts.find(s => s.experience_id === 'down-db')!;
    const operating = signalUpserts.find(s => s.experience_id === 'operating-db')!;

    // With no prior signal, weight = 2/(0+2) = 1.0 ⇒ rate == the folded sample.
    expect(down.downtime_rate).toBe(1);
    expect(down.sample_count).toBe(1);

    expect(operating.downtime_rate).toBe(0);
    expect(operating.sample_count).toBe(1);
  });
});
