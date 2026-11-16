/**
 * Feature: trip-budget, Requirement 15: Sampling integration with live DB
 *
 * Real-SQL integration test against local Postgres for:
 * - SamplingService running against real IntelligenceRepo
 * - Non-destructive upsert preserving Multi, Premier, and timestamps when schedule yields no purchases
 * - lookupLlPrice returns 'may_have_changed' once LL_PRICES_STALE_HOURS elapses
 * - Independent per-pass timestamps: pass with only Multi updates Multi captured_at while Premier retains old captured_at,
 *   so Multi is 'current' while Premier is 'may_have_changed'.
 *
 * Validates: Requirements 15.1, 15.4, 15.5
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createLiveTestDb, probeDatabase, type LiveTestDb } from '../../../test/liveDbTemplate.js';
import { IntelligenceRepo } from '../IntelligenceRepo.js';
import { createSamplingService } from '../samplingService.js';
import { lookupLlPrice } from '../../lightningLane/lookupLlPrice.js';
import type { StoredLlRow } from '../../lightningLane/types.js';

const DB_AVAILABLE = await probeDatabase();

describe.skipIf(!DB_AVAILABLE)(
  'samplingService — Lightning Lane livedb integration',
  () => {
    let liveDb: LiveTestDb;
    let testPool: DbPool;
    let repo: IntelligenceRepo;

    beforeAll(async () => {
      liveDb = await createLiveTestDb('dwt_ll_samp', { maxConnections: 5 });
      testPool = liveDb.pool as unknown as DbPool;
      repo = new IntelligenceRepo(testPool as any);

      // Seed catalog experience so Magic Kingdom is mapped
      await testPool.query(`
        INSERT INTO experiences (id, upstream_entity_id, park, category, name)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        randomUUID(),
        'mk-upstream-space-mountain',
        'Magic Kingdom',
        'Ride',
        'Space Mountain',
      ]);
    }, 120_000);

    afterAll(async () => {
      await liveDb?.cleanup();
    });

    it('preserves non-destructive LL values on second pass and exhibits per-pass timestamp independence', async () => {
      const T1 = new Date('2026-07-01T12:00:00.000Z');
      let currentClock = T1;
      let currentSchedule: any[] = [];

      const fakeLiveClient = {
        async getEntityLive(id: string) {
          return {
            id,
            name: 'Magic Kingdom',
            entityType: 'PARK',
            timezone: 'America/New_York',
            liveData: [
              {
                id: 'mk-tp-space-mountain',
                name: 'Space Mountain',
                queue: { STANDBY: { waitTime: 25 } },
              },
            ],
          };
        },
        async getEntitySchedule() {
          return { schedule: currentSchedule };
        },
      } as any;

      const fakeCatalogClient = {
        async getDestinations() {
          return {
            destinations: [
              {
                id: 'wdw',
                name: 'Walt Disney World Resort',
                parks: [{ id: 'mk-id', name: 'Magic Kingdom' }],
              },
            ],
          };
        },
      } as any;

      const fakeDirectory = {
        resolveEntityId: async (upstreamId: string) => {
          if (upstreamId === 'mk-upstream-space-mountain') return 'mk-tp-space-mountain';
          return null;
        },
        prime: async () => {},
      } as any;

      const fakeWeatherClient = {
        getWDWWeather: async () => ({ current: null, forecast: [] }),
      } as any;

      const service = createSamplingService({
        repo,
        liveClient: fakeLiveClient,
        catalogClient: fakeCatalogClient,
        directory: fakeDirectory,
        weatherClient: fakeWeatherClient,
        now: () => currentClock,
        llConfig: { minRefreshHours: 12, retentionDays: 400 },
      });

      // Pass 1: Schedule has Multi (2700) and Premier (39900)
      currentClock = T1;
      currentSchedule = [
        {
          date: '2026-07-02T00:00:00.000Z',
          type: 'OPERATING',
          openingTime: '2026-07-02T09:00:00.000Z',
          closingTime: '2026-07-02T21:00:00.000Z',
          purchases: [
            {
              id: 'lightninglanemultipass_80007944',
              name: 'Multi Pass',
              type: 'PACKAGE',
              available: true,
              price: { amount: 2700, currency: 'USD' },
            },
            {
              id: 'premierpass_80007944',
              name: 'Premier Pass',
              type: 'PACKAGE',
              available: true,
              price: { amount: 39900, currency: 'USD' },
            },
          ],
        },
      ];

      await service.runSamplingPass();

      // Read stored row from real DB
      const res1 = await testPool.query(`
        SELECT * FROM park_schedule_signals
        WHERE park = 'Magic Kingdom' AND date = '2026-07-02'
      `);
      expect(res1.rowCount).toBe(1);
      const row1 = res1.rows[0];
      expect(row1.ll_multipass_price_cents).toBe(2700);
      expect(row1.ll_multipass_available).toBe(true);
      expect(row1.ll_premier_price_cents).toBe(39900);
      expect(row1.ll_premier_available).toBe(true);
      expect(new Date(row1.ll_multipass_captured_at).toISOString()).toBe(T1.toISOString());
      expect(new Date(row1.ll_premier_captured_at).toISOString()).toBe(T1.toISOString());

      // Pass 2: Schedule yields no purchases, 80 hours later (>72h stale threshold)
      const T2 = new Date(T1.getTime() + 80 * 3600 * 1000);
      currentClock = T2;
      currentSchedule = [
        {
          date: '2026-07-02T00:00:00.000Z',
          type: 'OPERATING',
          openingTime: '2026-07-02T09:00:00.000Z',
          closingTime: '2026-07-02T21:00:00.000Z',
          purchases: [], // No purchases
        },
      ];

      await service.runSamplingPass();

      // Read stored row again: all LL columns and timestamps MUST be unchanged
      const res2 = await testPool.query(`
        SELECT * FROM park_schedule_signals
        WHERE park = 'Magic Kingdom' AND date = '2026-07-02'
      `);
      expect(res2.rowCount).toBe(1);
      const row2 = res2.rows[0];
      expect(row2.ll_multipass_price_cents).toBe(2700);
      expect(row2.ll_multipass_available).toBe(true);
      expect(row2.ll_premier_price_cents).toBe(39900);
      expect(row2.ll_premier_available).toBe(true);
      expect(new Date(row2.ll_multipass_captured_at).toISOString()).toBe(T1.toISOString());
      expect(new Date(row2.ll_premier_captured_at).toISOString()).toBe(T1.toISOString());

      // Test lookupLlPrice with the stored row at T2 (80 hours after T1, with staleHours 72)
      const storedRowMulti: StoredLlRow = {
        park: 'Magic Kingdom',
        date: '2026-07-02',
        passType: 'multi',
        experienceId: null,
        purchaseId: null,
        cents: row2.ll_multipass_price_cents,
        available: row2.ll_multipass_available,
        capturedAt: new Date(row2.ll_multipass_captured_at),
      };
      const quoteMultiAtT2 = lookupLlPrice(
        { kind: 'll', park: 'Magic Kingdom', date: '2026-07-02', passType: 'multi' },
        [storedRowMulti],
        [],
        '2026-07-02',
        T2,
        { staleHours: 72, lookbackDays: 400, minSamples: 4 },
      );
      expect(quoteMultiAtT2.priceLabelKind).toBe('may_have_changed');
      expect(quoteMultiAtT2.priceCents).toBe(2700);

      // Pass 3 (round 4 L1): Schedule carries ONLY Multi Pass price 2800 at T3 (15 min after T2 to avoid throttle)
      const T3 = new Date(T2.getTime() + 15 * 60 * 1000);
      currentClock = T3;
      currentSchedule = [
        {
          date: '2026-07-02T00:00:00.000Z',
          type: 'OPERATING',
          openingTime: '2026-07-02T09:00:00.000Z',
          closingTime: '2026-07-02T21:00:00.000Z',
          purchases: [
            {
              id: 'lightninglanemultipass_80007944',
              name: 'Multi Pass',
              type: 'PACKAGE',
              available: true,
              price: { amount: 2800, currency: 'USD' },
            },
          ],
        },
      ];

      await service.runSamplingPass();

      const res3 = await testPool.query(`
        SELECT * FROM park_schedule_signals
        WHERE park = 'Magic Kingdom' AND date = '2026-07-02'
      `);
      expect(res3.rowCount).toBe(1);
      const row3 = res3.rows[0];
      // Multi updated to 2800 with T3 timestamp
      expect(row3.ll_multipass_price_cents).toBe(2800);
      expect(new Date(row3.ll_multipass_captured_at).toISOString()).toBe(T3.toISOString());
      // Premier preserved 39900 with old T1 timestamp
      expect(row3.ll_premier_price_cents).toBe(39900);
      expect(new Date(row3.ll_premier_captured_at).toISOString()).toBe(T1.toISOString());

      // lookupLlPrice evaluated at T3:
      // Multi is fresh (capturedAt = T3, 0 hours old) -> 'current'
      const freshStoredMulti: StoredLlRow = {
        park: 'Magic Kingdom',
        date: '2026-07-02',
        passType: 'multi',
        experienceId: null,
        purchaseId: null,
        cents: row3.ll_multipass_price_cents,
        available: row3.ll_multipass_available,
        capturedAt: new Date(row3.ll_multipass_captured_at),
      };
      const quoteMultiAtT3Fresh = lookupLlPrice(
        { kind: 'll', park: 'Magic Kingdom', date: '2026-07-02', passType: 'multi' },
        [freshStoredMulti],
        [],
        '2026-07-02',
        T3,
        { staleHours: 72, lookbackDays: 400, minSamples: 4 },
      );
      expect(quoteMultiAtT3Fresh.priceLabelKind).toBe('current');
      expect(quoteMultiAtT3Fresh.priceCents).toBe(2800);

      // Premier is stale (capturedAt = T1, >80 hours old) -> 'may_have_changed'
      const oldStoredPremier: StoredLlRow = {
        park: 'Magic Kingdom',
        date: '2026-07-02',
        passType: 'premier',
        experienceId: null,
        purchaseId: null,
        cents: row3.ll_premier_price_cents,
        available: row3.ll_premier_available,
        capturedAt: new Date(row3.ll_premier_captured_at),
      };
      const quotePremierAtT3Old = lookupLlPrice(
        { kind: 'll', park: 'Magic Kingdom', date: '2026-07-02', passType: 'premier' },
        [oldStoredPremier],
        [],
        '2026-07-02',
        T3,
        { staleHours: 72, lookbackDays: 400, minSamples: 4 },
      );
      expect(quotePremierAtT3Old.priceLabelKind).toBe('may_have_changed');
      expect(quotePremierAtT3Old.priceCents).toBe(39900);
    });
  },
);