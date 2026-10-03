// Feature: admin-panel, Property 3: Sampling_Run_History is written exactly once per executed pass, never for a skipped one
/**
 * Validates: Requirements 7.1, 7.2
 */

import { describe, expect, it } from 'vitest';
import type { RecordSamplingRunInput } from '../IntelligenceRepo.js';
import { createSamplingService } from '../samplingService.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';

describe('samplingService — Property 3: sampling run persistence', () => {
  const T0 = new Date('2026-08-06T13:00:00Z').getTime();

  function makeTestSetup() {
    let nowMs = T0;
    const recordedRuns: RecordSamplingRunInput[] = [];

    const fakeWeatherClient = {
      getWDWWeather: async () => ({ current: null, forecast: [] }),
    } as any;

    const fakeCatalogClient = {
      async getDestinations() {
        return {
          destinations: [
            {
              id: 'wdw-dest',
              name: 'Walt Disney World',
              parks: [
                { id: 'mk-park', name: 'Magic Kingdom' },
              ],
            },
          ],
        };
      },
    } as unknown as ThemeParksClient;

    const fakeLiveClient = {
      async getEntityLive(id: string) {
        return {
          id,
          name: 'Magic Kingdom',
          entityType: 'PARK',
          timezone: 'America/New_York',
          liveData: [
            {
              id: 'pirates-tp-id',
              name: 'Pirates of the Caribbean',
              queue: {
                STANDBY: { waitTime: 35 },
              },
            },
          ],
        };
      },
      async getEntitySchedule() {
        return { schedule: [] };
      },
    } as unknown as ThemeParksLiveClient;

    const fakeRepo = {
      getExperiencesWithUpstreamIds: async () => [
        {
          id: 'exp-pirates-uuid',
          upstream_entity_id: 'pirates-enterprise-id',
          park: 'Magic Kingdom',
        },
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
      pruneSamplingRuns: async () => {},
      getRideShapesForBucket: async () => [],
      getSeasonHoursForBucket: async () => [],
      getExperienceSignals: async () => [],
      recordSamplingRun: async (run: RecordSamplingRunInput) => {
        recordedRuns.push(run);
      },
    } as any;

    const fakeDirectory = {
      resolveEntityId: async (upstreamId: string) => {
        if (upstreamId === 'pirates-enterprise-id') return 'pirates-tp-id';
        return null;
      },
      prime: async () => {},
    } as any;

    const service = createSamplingService({
      repo: fakeRepo,
      liveClient: fakeLiveClient,
      catalogClient: fakeCatalogClient,
      directory: fakeDirectory,
      weatherClient: fakeWeatherClient,
      now: () => new Date(nowMs),
    });

    return {
      service,
      recordedRuns,
      fakeRepo,
      advanceTime: (ms: number) => {
        nowMs += ms;
      },
    };
  }

  it('inserts one success row with accurate counts on a successful pass', async () => {
    const { service, recordedRuns } = makeTestSetup();

    await service.runSamplingPass();

    expect(recordedRuns).toHaveLength(1);
    const run = recordedRuns[0]!;
    expect(run.outcome).toBe('success');
    expect(run.error_message).toBeUndefined();
    expect(run.parks_sampled_count).toBe(1);
    expect(run.experiences_mapped_count).toBe(1);
    expect(run.started_at).toBeInstanceOf(Date);
    expect(run.completed_at).toBeInstanceOf(Date);
  });

  it('inserts one failed row with error_message set when executePass throws', async () => {
    const { service, recordedRuns, fakeRepo } = makeTestSetup();

    fakeRepo.getExperiencesWithUpstreamIds = async () => {
      throw new Error('Database pool connection lost');
    };

    await service.runSamplingPass();

    expect(recordedRuns).toHaveLength(1);
    const run = recordedRuns[0]!;
    expect(run.outcome).toBe('failed');
    expect(run.error_message).toContain('Database pool connection lost');
    expect(run.started_at).toBeInstanceOf(Date);
    expect(run.completed_at).toBeInstanceOf(Date);
  });

  it('inserts zero rows for debounced or overlapping invocations', async () => {
    const { service, recordedRuns, advanceTime } = makeTestSetup();

    // First execution: executes and records 1 success row
    await service.runSamplingPass();
    expect(recordedRuns).toHaveLength(1);

    // Second execution only 10s later (less than MIN_SAMPLE_INTERVAL_MS = 5 min): throttled
    advanceTime(10 * 1000);
    await service.runSamplingPass();
    expect(recordedRuns).toHaveLength(1); // No new row!

    // Third execution only 1 minute later: still throttled
    advanceTime(60 * 1000);
    await service.runSamplingPass();
    expect(recordedRuns).toHaveLength(1); // No new row!

    // Fourth execution after 6 minutes (> 5 min): executes and records a 2nd row
    advanceTime(5 * 60 * 1000);
    await service.runSamplingPass();
    expect(recordedRuns).toHaveLength(2);
  });
});
