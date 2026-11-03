import { describe, expect, it } from 'vitest';
import { createSamplingService } from '../samplingService.js';
import type { ThemeParksLiveClient } from '../../live/themeParksLiveClient.js';
import type { ThemeParksClient } from '../../catalog/themeparks.js';
import type { ScheduleSignalRow } from '../IntelligenceRepo.js';

describe('samplingService — Lightning Lane sampling integration (Task 6.4)', () => {
  const T0 = new Date('2026-07-01T12:00:00Z');

  function makeBaseHarness(overrides?: {
    lastSinglePricesCapturedAt?: Date | null;
    schedulesByParkId?: Record<string, any[]>;
    now?: Date;
  }) {
    const scheduledParkIds: string[] = [];
    const upsertedSignalBatches: ScheduleSignalRow[][] = [];
    let upsertedSingles: any[] | null = null;
    let prunedSinglesDate: string | null = null;

    const fakeLiveClient = {
      async getEntityLive(id: string) {
        return {
          id,
          name: id,
          entityType: 'PARK',
          timezone: 'America/New_York',
          liveData: [
            {
              id: `${id}-exp`,
              name: `${id} Experience`,
              queue: { STANDBY: { waitTime: 20 } },
            },
          ],
        };
      },
      async getEntitySchedule(id: string) {
        scheduledParkIds.push(id);
        const sched = overrides?.schedulesByParkId?.[id] ?? [];
        return { schedule: sched };
      },
    } as unknown as ThemeParksLiveClient;

    const fakeCatalogClient = {
      async getDestinations() {
        return {
          destinations: [
            {
              id: 'wdw',
              name: 'Walt Disney World Resort',
              parks: [
                { id: 'mk-id', name: 'Magic Kingdom' },
                { id: 'ep-id', name: 'EPCOT' },
                { id: 'hs-id', name: 'Disney’s Hollywood Studios' },
                { id: 'ak-id', name: 'Disney’s Animal Kingdom' },
                { id: 'tl-id', name: 'Disney’s Typhoon Lagoon Water Park' }, // Unmapped water park
              ],
            },
          ],
        };
      },
    } as unknown as ThemeParksClient;

    const fakeRepo = {
      getExperiencesWithUpstreamIds: async () => [
        { id: 'mk-uuid', upstream_entity_id: 'mk-id-exp', park: 'Magic Kingdom' },
        { id: 'ep-uuid', upstream_entity_id: 'ep-id-exp', park: 'EPCOT' },
        { id: 'hs-uuid', upstream_entity_id: 'hs-id-exp', park: 'Disney’s Hollywood Studios' },
        { id: 'ak-uuid', upstream_entity_id: 'ak-id-exp', park: 'Disney’s Animal Kingdom' },
        // Notice tl-id is intentionally not in the mapped experiences
      ],
      upsertWeatherObservations: async () => {},
      upsertParkScheduleSignals: async (rows: ScheduleSignalRow[]) => {
        upsertedSignalBatches.push(rows);
      },
      insertWaitSamples: async () => {},
      upsertExperienceDailySignals: async () => {},
      upsertRideShapes: async () => {},
      upsertSeasonHours: async () => {},
      upsertExperienceSignals: async () => {},
      getParkCrowdIndices: async () => [],
      upsertParkCrowdIndices: async () => {},
      pruneWaitSamples: async () => {},
      getRideShapesForBucket: async () => [],
      getSeasonHoursForBucket: async () => [],
      getExperienceSignals: async () => [],
      recordSamplingRun: async () => {},
      pruneSamplingRuns: async () => {},
      getLlSinglePricesLastCapturedAt: async () => overrides?.lastSinglePricesCapturedAt ?? null,
      upsertLightningLaneSinglePrices: async (singles: any[]) => {
        upsertedSingles = singles;
      },
      pruneLightningLaneSinglePrices: async (olderThan: string) => {
        prunedSinglesDate = olderThan;
      },
    } as any;

    const fakeDirectory = {
      resolveEntityId: async (upstreamId: string) => upstreamId,
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
      now: () => overrides?.now ?? T0,
      llConfig: { minRefreshHours: 12, retentionDays: 400 },
    });

    return {
      service,
      scheduledParkIds,
      upsertedSignalBatches,
      getUpsertedSingles: () => upsertedSingles,
      getPrunedSinglesDate: () => prunedSinglesDate,
    };
  }

  it('calls getEntitySchedule exactly once per mapped park and no other schedule URL', async () => {
    const harness = makeBaseHarness();
    await harness.service.runSamplingPass();

    // 4 mapped parks; Typhoon Lagoon is not mapped so it is skipped
    expect(harness.scheduledParkIds).toEqual(['mk-id', 'ep-id', 'hs-id', 'ak-id']);
  });

  it('propagates extracted park-level LL fields to upsertParkScheduleSignals (renamed package, id-prefix match)', async () => {
    const mkSchedule = [
      {
        date: '2026-07-01',
        type: 'OPERATING',
        openingTime: '2026-07-01T09:00:00',
        closingTime: '2026-07-01T21:00:00',
        purchases: [
          // Renamed package with id prefix match
          {
            id: 'lightninglanemultipass_80007944',
            name: 'Lightning Lane Multi Pass (Renamed Name)',
            type: 'PACKAGE',
            available: true,
            price: { amount: 2700, currency: 'USD' },
          },
          // Premier pass
          {
            id: 'premierpass_80007944',
            name: 'Premier Pass',
            type: 'PACKAGE',
            available: false,
            price: { amount: 39900, currency: 'USD' },
          },
          // Single pass
          {
            id: 'lightninglane_12345',
            name: 'Space Mountain Single Pass',
            type: 'ATTRACTION',
            available: true,
            price: { amount: 1400, currency: 'USD' },
          },
        ],
      },
    ];

    const harness = makeBaseHarness({
      schedulesByParkId: { 'mk-id': mkSchedule },
    });

    await harness.service.runSamplingPass();

    expect(harness.upsertedSignalBatches.length).toBe(4);
    const mkBatch = harness.upsertedSignalBatches[0];
    expect(mkBatch).toBeDefined();
    const row = mkBatch?.find((r) => r.park === 'Magic Kingdom' && (r.date instanceof Date ? r.date.toISOString() : String(r.date)).includes('2026-07-01'));
    expect(row).toBeDefined();
    expect(row?.ll_multipass_price_cents).toBe(2700);
    expect(row?.ll_multipass_available).toBe(true);
    expect(row?.ll_premier_price_cents).toBe(39900);
    expect(row?.ll_premier_available).toBe(false);
    expect(row?.ll_prices_captured_at).toBeInstanceOf(Date);
  });

  it('persists and prunes singles when lastSinglePricesCapturedAt is null or older than 12 hours', async () => {
    const mkSchedule = [
      {
        date: '2026-07-01',
        type: 'OPERATING',
        openingTime: '2026-07-01T09:00:00',
        closingTime: '2026-07-01T21:00:00',
        purchases: [
          {
            id: 'lightninglane_99999',
            name: 'Tron Single Pass',
            type: 'ATTRACTION',
            available: true,
            price: { amount: 2000, currency: 'USD' },
          },
        ],
      },
    ];

    // Case A: null last capture
    const harnessNull = makeBaseHarness({
      lastSinglePricesCapturedAt: null,
      schedulesByParkId: { 'mk-id': mkSchedule },
    });
    await harnessNull.service.runSamplingPass();
    expect(harnessNull.getUpsertedSingles()).toHaveLength(1);
    expect(harnessNull.getPrunedSinglesDate()).toBeDefined();

    // Case B: 13 hours ago (>12h)
    const harnessStale = makeBaseHarness({
      lastSinglePricesCapturedAt: new Date(T0.getTime() - 13 * 3600 * 1000),
      schedulesByParkId: { 'mk-id': mkSchedule },
    });
    await harnessStale.service.runSamplingPass();
    expect(harnessStale.getUpsertedSingles()).toHaveLength(1);
  });

  it('skips single pass persistence on second pass within 12 hours', async () => {
    const mkSchedule = [
      {
        date: '2026-07-01',
        type: 'OPERATING',
        openingTime: '2026-07-01T09:00:00',
        closingTime: '2026-07-01T21:00:00',
        purchases: [
          {
            id: 'lightninglane_99999',
            name: 'Tron Single Pass',
            type: 'ATTRACTION',
            available: true,
            price: { amount: 2000, currency: 'USD' },
          },
        ],
      },
    ];

    // 2 hours ago (<12h)
    const harnessRecent = makeBaseHarness({
      lastSinglePricesCapturedAt: new Date(T0.getTime() - 2 * 3600 * 1000),
      schedulesByParkId: { 'mk-id': mkSchedule },
    });
    await harnessRecent.service.runSamplingPass();
    expect(harnessRecent.getUpsertedSingles()).toBeNull();
  });

  it('throwing extractor for one park does not stop other parks or the pass, and passes null LL fields for that park', async () => {
    const badSchedule = [
      {
        date: '2026-07-01',
        type: 'OPERATING',
        openingTime: '2026-07-01T09:00:00',
        closingTime: '2026-07-01T21:00:00',
        get purchases(): any {
          throw new Error('extractor simulated failure');
        },
      },
    ];

    const goodSchedule = [
      {
        date: '2026-07-01',
        type: 'OPERATING',
        openingTime: '2026-07-01T09:00:00',
        closingTime: '2026-07-01T21:00:00',
        purchases: [
          {
            id: 'lightninglanemultipass_80007944',
            name: 'Multi Pass',
            type: 'PACKAGE',
            available: true,
            price: { amount: 2500, currency: 'USD' },
          },
        ],
      },
    ];

    const harness = makeBaseHarness({
      schedulesByParkId: {
        'mk-id': badSchedule,
        'ep-id': goodSchedule,
      },
    });

    // Should complete without throwing
    await harness.service.runSamplingPass();

    // All 4 parks were processed
    expect(harness.upsertedSignalBatches.length).toBe(4);

    // MK rows have null LL fields
    const mkBatch = harness.upsertedSignalBatches[0];
    const mkRow = mkBatch?.find((r) => r.park === 'Magic Kingdom');
    expect(mkRow).toBeDefined();
    expect(mkRow?.ll_multipass_price_cents).toBeNull();
    expect(mkRow?.ll_multipass_available).toBeNull();
    expect(mkRow?.ll_premier_price_cents).toBeNull();
    expect(mkRow?.ll_premier_available).toBeNull();
    expect(mkRow?.ll_prices_captured_at).toBeNull();

    // EP rows have extracted LL fields
    const epBatch = harness.upsertedSignalBatches[1];
    const epRow = epBatch?.find((r) => r.park === 'EPCOT');
    expect(epRow).toBeDefined();
    expect(epRow?.ll_multipass_price_cents).toBe(2500);
    expect(epRow?.ll_multipass_available).toBe(true);
  });
});
