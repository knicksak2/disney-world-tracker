import { describe, expect, it } from 'vitest';
import { createSamplingService } from '../samplingService.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';

describe('Sampling Isolation (Task 4.4)', () => {
  it('swallows ThemeParksLiveClient errors and continues processing other parks', async () => {
    let mkCalls = 0;
    const fakeLiveClient: ThemeParksLiveClient = {
      async getEntityLive(id: string) {
        if (id === 'mk') {
          mkCalls++;
          throw new Error('WAF block or timeout on MK');
        }
        return { id, name: 'EPCOT', entityType: 'PARK', timezone: 'America/New_York', liveData: [] };
      },
      async getEntitySchedule(id: string) {
        if (id === 'mk') throw new Error('WAF block on MK schedule');
        return { schedule: [] };
      }
    };

    const fakeCatalogClient = {
      async getDestinations() {
        return {
          destinations: [{
            id: 'wdw',
            name: 'Walt Disney World Resort',
            parks: [{ id: 'mk', name: 'Magic Kingdom' }, { id: 'ep', name: 'EPCOT' }]
          }]
        };
      }
    } as unknown as ThemeParksClient;

    const fakeRepo = {
      getExperiencesWithUpstreamIds: async () => [],
      upsertWeatherObservations: async () => {},
      upsertParkScheduleSignals: async () => {},
      insertWaitSamples: async () => {},
      upsertExperienceDailySignals: async () => {},
      upsertRideShapes: async () => {},
      upsertSeasonHours: async () => {},
      upsertExperienceSignals: async () => {},
      getParkCrowdIndices: async () => [],
      upsertParkCrowdIndices: async () => {},
      pruneWaitSamples: async () => {},
      getRideShapes: async () => [],
      getSeasonHours: async () => [],
      getExperienceSignals: async () => []
    } as any;

    const fakeDirectory = {
      resolveEntityId: async () => null,
      prime: async () => {},
    } as any;

    const fakeWeatherClient = {
      getWDWWeather: async () => ({ current: null, forecast: [] })
    } as any;

    const service = createSamplingService({
      repo: fakeRepo,
      liveClient: fakeLiveClient,
      catalogClient: fakeCatalogClient,
      directory: fakeDirectory,
      weatherClient: fakeWeatherClient,
      now: () => new Date('2024-01-02T12:00:00Z')
    });

    // Should not throw
    await service.runSamplingPass();

    // Verify it attempted MK and swallowed the error
    expect(mkCalls).toBe(1);
  });
});
