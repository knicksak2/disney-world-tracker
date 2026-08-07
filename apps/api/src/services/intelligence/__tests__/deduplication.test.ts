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

  it('logs reverse-mapping warning for unmapped live entries with standby wait, skips non-live, logs unresolved debug, and outputs per-pass summary', async () => {
    const warnLogs: Array<{ payload: any; msg: string }> = [];
    const infoLogs: Array<{ payload: any; msg: string }> = [];
    const debugLogs: Array<{ payload: any; msg: string }> = [];

    const fakeLogger = {
      debug: (payload: any, msg: string) => debugLogs.push({ payload, msg }),
      info: (payload: any, msg: string) => infoLogs.push({ payload, msg }),
      warn: (payload: any, msg: string) => warnLogs.push({ payload, msg }),
      error: () => {},
    };

    const fakeLiveClient: ThemeParksLiveClient = {
      async getEntityLive(id: string) {
        if (id === 'mk') {
          return {
            id,
            name: 'Magic Kingdom',
            entityType: 'PARK',
            timezone: 'America/New_York',
            liveData: [
              // Mapped experience
              {
                id: 'exp1-tp',
                name: 'Space Mountain',
                status: 'OPERATING',
                queue: { STANDBY: { waitTime: 30 } },
              },
              // Unmapped experience WITH a standby wait (e.g. Big Thunder with wrong DB upstream id)
              {
                id: 'big-thunder-tp',
                name: 'Big Thunder Mountain Railroad',
                status: 'OPERATING',
                queue: { STANDBY: { waitTime: 45 } },
              },
              // Benign non-live entity WITHOUT a standby wait (e.g. Restaurant)
              {
                id: 'be-our-guest-tp',
                name: 'Be Our Guest Restaurant',
                status: 'OPERATING',
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
          destinations: [
            {
              id: 'wdw',
              name: 'Walt Disney World Resort',
              parks: [{ id: 'mk', name: 'Magic Kingdom' }],
            },
          ],
        };
      },
    } as unknown as ThemeParksClient;

    const fakeRepo = {
      getExperiencesWithUpstreamIds: async () => [
        { id: 'exp1-db', upstream_entity_id: 'exp1-tp', park: 'mk' },
        { id: 'unresolved-db', upstream_entity_id: 'unresolved-tp', park: 'mk' },
      ],
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
      getExperienceSignals: async () => [],
      getParkRollingBaseline: async () => 35,
    } as any;

    const fakeDirectory = {
      resolveEntityId: async (id: string) => {
        if (id === 'exp1-tp') return 'exp1-tp';
        if (id === 'unresolved-tp') return null; // fails to resolve
        return null;
      },
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
      logger: fakeLogger,
      now: () => new Date('2026-08-05T12:00:00Z'),
    });

    await service.runSamplingPass();

    // 1. Assert logger.debug was called for the unresolved experience
    const unresolvedDebugLog = debugLogs.find(
      l => l.payload?.upstreamEntityId === 'unresolved-tp' || l.msg.includes('Could not resolve')
    );
    expect(unresolvedDebugLog).toBeDefined();

    // 2. Assert reverse-mapping logger.warn fired for big-thunder-tp and NOT be-our-guest-tp
    const reverseMapWarn = warnLogs.find(l => l.payload?.count !== undefined && l.msg.includes('Unmapped live experiences'));
    expect(reverseMapWarn).toBeDefined();
    expect(reverseMapWarn?.payload.count).toBe(1);
    expect(reverseMapWarn?.payload.unmappedIds).toContain('big-thunder-tp');
    expect(reverseMapWarn?.payload.unmappedIds).not.toContain('be-our-guest-tp');
    expect(JSON.stringify(reverseMapWarn?.payload.sample)).toContain('Big Thunder Mountain Railroad');

    // 3. Assert per-pass summary logger.info was output with all 5 metrics
    const summaryLog = infoLogs.find(l => l.msg.includes('Sampling pass summary'));
    expect(summaryLog).toBeDefined();
    expect(summaryLog?.payload).toEqual({
      parksSampled: 1,
      experiencesMapped: 1,
      totalWaitSamples: 1,
      unmappedWithWaitCount: 1,
      unresolvedCount: 1,
    });
  });
});
