/**
 * Regression: an empty ThemeParks.wiki `liveData` feed must NOT produce
 * `live_unavailable`.
 *
 * ThemeParks.wiki returns `liveData: []` for entities it tracks (resolution
 * succeeds, the fetch succeeds) but has no live status to report for —
 * verified directly against the real API for Casey's Corner and Cove Bar,
 * both quick-service `RESTAURANT` entities with no standby queue to publish.
 * Before this fix, `selectLiveEntry` threw on an empty feed, which the
 * orchestrator's catch treated identically to a genuine fetch failure,
 * producing the "Live information currently unavailable" error card for
 * every such restaurant even though nothing actually failed.
 */

import { describe, expect, it } from 'vitest';
import { liveDetailSchema } from '@dwt/shared';

import type { CachedLiveDetail, LiveCache } from '../cache.js';
import type { LiveRepo } from '../repo.js';
import { createThemeParksLiveService } from '../themeParksLiveService.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveResponse,
} from '../themeParksLiveClient.js';

const EXPERIENCE_ID = '11111111-2222-3333-4444-555555555555';
const ENTERPRISE_ID = '90002458;entityType=restaurant';
const THEMEPARKS_ID = '48d0c81e-3f47-4ff9-aa3c-331cb83a0af9';

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

/** A ThemeParks.wiki live client stub returning the given response verbatim. */
function createStubClient(response: ThemeParksLiveResponse): ThemeParksLiveClient {
  return {
    async getEntityLive(): Promise<ThemeParksLiveResponse> {
      return response;
    },
    async getEntitySchedule(): Promise<any> {
      return { schedule: [] };
    },
  };
}

describe('themeParksLiveService — empty liveData feed (regression)', () => {
  it('projects an Unknown-status Live_Detail rather than throwing live_unavailable', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    // Exactly the real shape `GET /entity/{id}/live` returns for Casey's
    // Corner / Cove Bar: the entity is tracked, the request succeeds, and
    // `liveData` is an empty array.
    const client = createStubClient({
      id: THEMEPARKS_ID,
      name: "Casey's Corner",
      entityType: 'RESTAURANT',
      timezone: 'America/New_York',
      liveData: [],
    });

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      resolveEntityId: async () => THEMEPARKS_ID,
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    // No error thrown; a fresh (non-stale) result is served.
    expect(result.stale).toBe(false);
    // The pure projector's total default for a missing input (R11.8).
    expect(result.liveDetail.status).toBe('Unknown');
    expect(result.liveDetail.waitMinutes).toBeUndefined();
    expect(result.liveDetail.showtimes).toEqual([]);
    expect(result.liveDetail.diningAvailability).toEqual([]);
    expect(liveDetailSchema.safeParse(result.liveDetail).success).toBe(true);
  });

  it('caches the Unknown-status result so a second read is a cache hit', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    let calls = 0;
    const client: ThemeParksLiveClient = {
      async getEntityLive(): Promise<ThemeParksLiveResponse> {
        calls += 1;
        return {
          id: THEMEPARKS_ID,
          timezone: 'America/New_York',
          liveData: [],
        };
      },
      async getEntitySchedule(): Promise<any> {
        return { schedule: [] };
      },
    };
    const now = new Date('2024-01-02T15:05:00.000Z');

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      resolveEntityId: async () => THEMEPARKS_ID,
      now: () => now,
    });

    const first = await service.getLiveDetail(EXPERIENCE_ID);
    const second = await service.getLiveDetail(EXPERIENCE_ID);

    expect(first.stale).toBe(false);
    expect(second.stale).toBe(false);
    expect(second.liveDetail.status).toBe('Unknown');
    // Only the first read contacted ThemeParks.wiki; the second was a cache hit.
    expect(calls).toBe(1);
  });

  it('still fails over to live_unavailable when the feed genuinely errors (not just empty)', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    const client: ThemeParksLiveClient = {
      async getEntityLive(): Promise<ThemeParksLiveResponse> {
        throw new Error('simulated network failure');
      },
      async getEntitySchedule(): Promise<any> {
        return { schedule: [] };
      },
    };

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      resolveEntityId: async () => THEMEPARKS_ID,
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    // A genuine transport failure (distinct from an empty-but-successful
    // feed) still degrades to live_unavailable when no cache exists — the
    // fix narrows the empty-array case only, it doesn't swallow real errors.
    await expect(service.getLiveDetail(EXPERIENCE_ID)).rejects.toMatchObject({
      code: 'live_unavailable',
    });
  });
});
