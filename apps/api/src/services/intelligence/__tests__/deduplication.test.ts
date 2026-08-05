import { describe, expect, it } from 'vitest';
import { createSamplingService } from '../samplingService.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';

describe('Sampling Deduplication Regression', () => {
  it('deduplicates schedule dates and live data experience IDs', async () => {
    let upsertedSchedules: any[] = [];
    let upsertedSignals: any[] = [];

    const fakeLiveClient: ThemeParksLiveClient = {
      async getEntityLive(id: string) {
        if (id === 'mk') {
          return {
            id,
            name: 'Magic Kingdom',
            entityType: 'PARK',
            timezone: 'America/New_York',
            liveData: [
              {
                id: 'exp1-tp',
                status: 'OPERATING',
                queue: { STANDBY: { waitTime: 30 } }
              },
              {
                id: 'exp1-tp',
                status: 'OPERATING',
                queue: { STANDBY: { waitTime: 45 } }
              }
            ]
          };
        }
        return { id, name: 'Other', entityType: 'PARK', timezone: 'America/New_York', liveData: [] };
      },
      async getEntitySchedule(id: string) {
        if (id === 'mk') {
          return {
            schedule: [
              {
                date: '2026-08-05',
                openingTime: '2026-08-05T09:00:00Z',
                closingTime: '2026-08-05T21:00:00Z',
                type: 'OPERATING',
                description: 'early entry'
              },
              {
                date: '2026-08-05',
                openingTime: '2026-08-05T21:00:00Z',
                closingTime: '2026-08-05T23:00:00Z',
                type: 'TICKETED_EVENT',
                description: 'special ticketed event'
              }
            ]
          };
        }
        return { schedule: [] };
      }
    };

    const fakeCatalogClient = {
      async getDestinations() {
        return {
          destinations: [{
            id: 'wdw',
            name: 'Walt Disney World Resort',
            parks: [{ id: 'mk', name: 'Magic Kingdom' }]
          }]
        };
      }
    } as unknown as ThemeParksClient;

    const fakeRepo = {
      getExperiencesWithUpstreamIds: async () => [
        { id: 'exp1-db', upstream_entity_id: 'exp1-tp', park: 'mk' }
      ],
      upsertWeatherObservations: async () => {},
      upsertParkScheduleSignals: async (rows: any[]) => {
        // Simulate Postgres unique constraint check
        const keys = new Set();
        for (const r of rows) {
          const key = `${r.park}-${r.date.toISOString()}`;
          if (keys.has(key)) throw new Error('Duplicate key constraint violation 21000');
          keys.add(key);
        }
        upsertedSchedules = rows;
      },
      insertWaitSamples: async () => {},
      upsertExperienceDailySignals: async () => {},
      upsertRideShapes: async () => {},
      upsertSeasonHours: async () => {},
      upsertExperienceSignals: async (rows: any[]) => {
        upsertedSignals = rows;
      },
      getParkCrowdIndices: async () => [],
      upsertParkCrowdIndices: async () => {},
      pruneWaitSamples: async () => {},
      getRideShapes: async () => [],
      getSeasonHours: async () => [],
      getExperienceSignals: async () => [],
      getParkRollingBaseline: async () => 35
    } as any;

    const fakeDirectory = {
      resolveEntityId: async (id: string) => id,
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
      now: () => new Date('2026-08-05T12:00:00Z')
    });

    await service.runSamplingPass();

    // Verify Schedule Deduplication and Aggregation
    expect(upsertedSchedules.length).toBe(1);
    const schedule = upsertedSchedules[0];
    expect(schedule.open_time?.toISOString()).toBe('2026-08-05T09:00:00.000Z');
    expect(schedule.close_time?.toISOString()).toBe('2026-08-05T23:00:00.000Z');
    expect(schedule.early_entry).toBe(true);
    expect(schedule.ticketed_event).toBe(true);

    // Verify Live Data Deduplication
    expect(upsertedSignals.length).toBe(1);
    const signal = upsertedSignals[0];
    expect(signal.sample_count).toBe(1); // Should only advance once despite two entries
  });
});
