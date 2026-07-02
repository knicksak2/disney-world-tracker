/**
 * Unit tests for the Disney-sourced Live_Service orchestrator.
 *
 * Cover the five-step lifecycle: resolve → cache-decision → fresh fetch →
 * stale fallback → live_unavailable. All collaborators are in-memory fakes and
 * the clock is injected, so no Redis/DB/network is touched. These assert the
 * Disney live path keyed by Enterprise_Id (R9.1) and the ThemeParks.wiki-free
 * failure behavior (R14.4).
 */

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../errors/index.js';
import type { CachedLiveDetail, LiveCache } from '../../../live/cache.js';
import type { LiveRepo } from '../../../live/repo.js';
import type { LiveProjectionInput } from '../liveProject.js';
import {
  createDisneyLiveService,
  type DisneyLiveClient,
} from '../liveService.js';

const EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';
const ENTERPRISE_ID = '80010177;entityType=Attraction';
const NOW = new Date('2024-06-01T15:00:00Z');

/** In-memory LiveCache backed by a Map. */
class MapCache implements LiveCache {
  private readonly store = new Map<string, CachedLiveDetail>();
  constructor(seed?: Record<string, CachedLiveDetail>) {
    if (seed) {
      for (const [k, v] of Object.entries(seed)) this.store.set(k, v);
    }
  }
  async get(experienceId: string): Promise<CachedLiveDetail | null> {
    return this.store.get(experienceId) ?? null;
  }
  async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
    this.store.set(experienceId, entry);
  }
  peek(experienceId: string): CachedLiveDetail | null {
    return this.store.get(experienceId) ?? null;
  }
}

function repoResolving(enterpriseId: string | null): LiveRepo {
  return { resolveUpstreamEntityId: async () => enterpriseId };
}

function clientReturning(input: LiveProjectionInput): DisneyLiveClient {
  return { getEntityLiveInput: async () => input };
}

function clientFailing(): DisneyLiveClient {
  return {
    getEntityLiveInput: async () => {
      throw new Error('sync gateway unavailable');
    },
  };
}

describe('createDisneyLiveService.getLiveDetail', () => {
  it('resolves the Enterprise_Id and projects a fresh Disney fetch (R9.1)', async () => {
    const repo: LiveRepo = {
      resolveUpstreamEntityId: vi.fn().mockResolvedValue(ENTERPRISE_ID),
    };
    const cache = new MapCache();
    const client = clientReturning({ status: { status: 'Operating' } });

    const service = createDisneyLiveService({
      repo,
      cache,
      client,
      now: () => NOW,
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    expect(repo.resolveUpstreamEntityId).toHaveBeenCalledWith(EXPERIENCE_ID);
    expect(result.stale).toBe(false);
    expect(result.retrievedAt).toBe(NOW.toISOString());
    expect(result.liveDetail.status).toBe('Operating');
    // Fresh entry is stored with the Retrieved_At time (R2.4).
    expect(cache.peek(EXPERIENCE_ID)?.retrievedAt).toBe(NOW.toISOString());
  });

  it('serves a fresh-enough cached entry without contacting Disney (R2.2)', async () => {
    const cachedAt = new Date(NOW.getTime() - 60_000).toISOString(); // 1 min old
    const cache = new MapCache({
      [EXPERIENCE_ID]: {
        liveDetail: {
          status: 'Closed',
          showtimes: [],
          operatingHours: [],
          diningAvailability: [],
        },
        retrievedAt: cachedAt,
      },
    });
    const client: DisneyLiveClient = {
      getEntityLiveInput: vi.fn(),
    };

    const service = createDisneyLiveService({
      repo: repoResolving(ENTERPRISE_ID),
      cache,
      client,
      now: () => NOW,
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    expect(client.getEntityLiveInput).not.toHaveBeenCalled();
    expect(result.stale).toBe(false);
    expect(result.retrievedAt).toBe(cachedAt);
    expect(result.liveDetail.status).toBe('Closed');
  });

  it('serves the most recent cached value stale on a Disney failure without overwriting (R14.4)', async () => {
    const oldAt = new Date(NOW.getTime() - 6 * 60 * 60 * 1000).toISOString(); // 6h old
    const cached: CachedLiveDetail = {
      liveDetail: {
        status: 'Operating',
        waitMinutes: 30,
        showtimes: [],
        operatingHours: [],
        diningAvailability: [],
      },
      retrievedAt: oldAt,
    };
    const cache = new MapCache({ [EXPERIENCE_ID]: cached });

    const service = createDisneyLiveService({
      repo: repoResolving(ENTERPRISE_ID),
      cache,
      client: clientFailing(),
      now: () => NOW,
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    expect(result.stale).toBe(true);
    expect(result.retrievedAt).toBe(oldAt); // not overwritten
    expect(cache.peek(EXPERIENCE_ID)?.retrievedAt).toBe(oldAt);
  });

  it('throws live_unavailable when a fresh fetch fails and no cache exists (R2.8)', async () => {
    const service = createDisneyLiveService({
      repo: repoResolving(ENTERPRISE_ID),
      cache: new MapCache(),
      client: clientFailing(),
      now: () => NOW,
    });

    await expect(service.getLiveDetail(EXPERIENCE_ID)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('never contacts Disney when the Enterprise_Id cannot be resolved', async () => {
    const client: DisneyLiveClient = { getEntityLiveInput: vi.fn() };
    const service = createDisneyLiveService({
      repo: repoResolving(null),
      cache: new MapCache(),
      client,
      now: () => NOW,
    });

    await expect(service.getLiveDetail(EXPERIENCE_ID)).rejects.toBeInstanceOf(
      AppError,
    );
    expect(client.getEntityLiveInput).not.toHaveBeenCalled();
  });
});
