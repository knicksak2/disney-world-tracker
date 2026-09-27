/**
 * Regression: a PERMANENT resolution miss must NOT produce `live_unavailable`.
 *
 * Two distinct cases both mean "ThemeParks.wiki will never have data for this
 * Experience, no matter how many times you retry":
 *
 *   1. `experiences.upstream_entity_id` is null/absent for this Experience.
 *   2. The Enterprise_Id is present, but ThemeParks.wiki tracks no entity
 *      whose `externalId` equals it — verified directly against the real API
 *      for "Aloha Isle" (Magic Kingdom, Adventureland): no entity exists
 *      under its id or name anywhere in the WDW destination tree.
 *
 * Both previously threw `AppError('live_unavailable')` when no cache existed,
 * which the mobile app renders as "Live information currently unavailable...
 * Please try again later" — copy that is actively wrong here, since trying
 * again can never succeed. Both must now serve the same calm, total
 * `Unknown`/empty `LiveDetailDTO` projection the empty-`liveData`-feed case
 * gets, so the UI renders its normal thin-data state instead of an error.
 */

import { describe, expect, it } from 'vitest';
import { liveDetailSchema } from '@dwt/shared';

import type { CachedLiveDetail, LiveCache } from '../cache.js';
import type { LiveRepo } from '../repo.js';
import { createThemeParksLiveService } from '../themeParksLiveService.js';
import type { ThemeParksLiveClient } from '../themeParksLiveClient.js';

const EXPERIENCE_ID = '11111111-2222-3333-4444-555555555555';
const ENTERPRISE_ID = '90002426;entityType=restaurant'; // Aloha Isle's real Enterprise_Id

function createFakeRepo(mapping: Readonly<Record<string, string | null>>): LiveRepo {
  return {
    async resolveUpstreamEntityId(experienceId: string): Promise<string | null> {
      return mapping[experienceId] ?? null;
    },
  };
}

function createFakeCache(): LiveCache & { readonly store: Map<string, CachedLiveDetail> } {
  const store = new Map<string, CachedLiveDetail>();
  return {
    store,
    async get(experienceId: string): Promise<CachedLiveDetail | null> {
      return store.get(experienceId) ?? null;
    },
    async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
      store.set(experienceId, entry);
    },
  };
}

/** A client that must never be called for a permanent-absence case. */
function createTripwireClient(): ThemeParksLiveClient & { calls: number } {
  return {
    calls: 0,
    async getEntityLive() {
      this.calls += 1;
      throw new Error('should never contact ThemeParks.wiki for an unresolvable entity');
    },
    async getEntitySchedule() {
      return { schedule: [] };
    },
  };
}

describe('themeParksLiveService — permanent resolution miss (regression)', () => {
  it('serves Unknown-status Live_Detail when the Experience has no Enterprise_Id on file', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: null });
    const cache = createFakeCache();
    const client = createTripwireClient();

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      resolveEntityId: async () => {
        throw new Error('resolveEntityId must never be called without an Enterprise_Id');
      },
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    expect(result.stale).toBe(false);
    expect(result.liveDetail.status).toBe('Unknown');
    expect(result.liveDetail.diningAvailability).toEqual([]);
    expect(liveDetailSchema.safeParse(result.liveDetail).success).toBe(true);
    expect(client.calls).toBe(0);
  });

  it('serves Unknown-status Live_Detail when ThemeParks.wiki tracks no matching entity (Aloha Isle case)', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    const client = createTripwireClient();

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      // Mirrors the real directory: no entity in the WDW tree has this
      // externalId, under any park or the destination itself.
      resolveEntityId: async () => null,
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    expect(result.stale).toBe(false);
    expect(result.liveDetail.status).toBe('Unknown');
    expect(liveDetailSchema.safeParse(result.liveDetail).success).toBe(true);
    // The resolution miss never reaches the live fetch at all.
    expect(client.calls).toBe(0);
  });

  it('does NOT throw live_unavailable for a permanent miss even with no cache present', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: null });
    const cache = createFakeCache();
    const client = createTripwireClient();

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      resolveEntityId: async () => null,
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    // Must resolve, not reject — this is the exact regression: previously
    // this threw AppError('live_unavailable') here.
    await expect(service.getLiveDetail(EXPERIENCE_ID)).resolves.toMatchObject({
      stale: false,
      liveDetail: { status: 'Unknown' },
    });
  });

  it('still fails over to live_unavailable for a genuine transient fetch failure (unaffected by this fix)', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    const client: ThemeParksLiveClient = {
      async getEntityLive() {
        throw new Error('simulated network failure');
      },
      async getEntitySchedule() {
        return { schedule: [] };
      },
    };

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      // Resolution SUCCEEDS here — the failure is purely in the live fetch —
      // so this must still degrade to live_unavailable, distinguishing a
      // genuine transient error from a permanent resolution miss.
      resolveEntityId: async () => 'some-themeparks-guid',
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    await expect(service.getLiveDetail(EXPERIENCE_ID)).rejects.toMatchObject({
      code: 'live_unavailable',
    });
  });
});
