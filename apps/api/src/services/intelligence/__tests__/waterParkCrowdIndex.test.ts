import { describe, expect, it } from 'vitest';
import { createSamplingService } from '../samplingService.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';

/**
 * Water parks post no standby waits, so a Crowd_Index over their "operating,
 * 0-wait" entries is meaningless. The sampler must write a Crowd_Index only for
 * the four theme parks — but still collect other signals everywhere.
 */
describe('Sampling — Crowd_Index restricted to theme parks', () => {
  function makeFixture() {
    const crowdIndexUpserts: any[] = [];

    const fakeLiveClient: ThemeParksLiveClient = {
      async getEntityLive(id: string) {
        if (id === 'mk') {
          return {
            id, name: 'Magic Kingdom', entityType: 'PARK', timezone: 'America/New_York',
            liveData: [{ id: 'mk-ride-tp', status: 'OPERATING', queue: { STANDBY: { waitTime: 30 } } }],
          };
        }
        if (id === 'bb') {
          return {
            id, name: 'Blizzard Beach', entityType: 'PARK', timezone: 'America/New_York',
            // Operating slide, but no standby wait posted (0) — the junk case.
            liveData: [{ id: 'bb-slide-tp', status: 'OPERATING', queue: { STANDBY: { waitTime: 0 } } }],
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
            id: 'wdw', name: 'Walt Disney World Resort',
            parks: [{ id: 'mk', name: 'Magic Kingdom' }, { id: 'bb', name: 'Blizzard Beach' }],
          }],
        };
      },
    } as unknown as ThemeParksClient;

    const fakeRepo = {
      getExperiencesWithUpstreamIds: async () => [
        { id: 'mk-ride-db', upstream_entity_id: 'mk-ride-tp', park: 'Magic Kingdom' },
        { id: 'bb-slide-db', upstream_entity_id: 'bb-slide-tp', park: 'Blizzard Beach' },
      ],
      upsertWeatherObservations: async () => {},
      upsertParkScheduleSignals: async () => {},
      insertWaitSamples: async () => {},
      upsertExperienceDailySignals: async () => {},
      upsertRideShapes: async () => {},
      upsertSeasonHours: async () => {},
      upsertExperienceSignals: async () => {},
      getParkCrowdIndices: async () => [],
      upsertParkCrowdIndices: async (rows: any[]) => { crowdIndexUpserts.push(...rows); },
      pruneWaitSamples: async () => {},
      getRideShapes: async () => [],
      getSeasonHours: async () => [],
      getExperienceSignals: async () => [],
      getParkRollingBaseline: async () => 35,
    } as any;

    const fakeDirectory = { resolveEntityId: async (id: string) => id, prime: async () => {} } as any;
    const fakeWeatherClient = { getWDWWeather: async () => ({ current: null, forecast: [] }) } as any;

    const service = createSamplingService({
      repo: fakeRepo,
      liveClient: fakeLiveClient,
      catalogClient: fakeCatalogClient,
      directory: fakeDirectory,
      weatherClient: fakeWeatherClient,
      now: () => new Date('2026-08-05T18:00:00Z'),
    });

    return { service, crowdIndexUpserts };
  }

  it('writes a Crowd_Index for the theme park but not the water park', async () => {
    const { service, crowdIndexUpserts } = makeFixture();

    await service.runSamplingPass();

    expect(crowdIndexUpserts.length).toBeGreaterThan(0);
    expect(crowdIndexUpserts.every((r) => r.park === 'Magic Kingdom')).toBe(true);
    expect(crowdIndexUpserts.some((r) => r.park === 'Blizzard Beach')).toBe(false);
  });
});
