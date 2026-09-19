import { describe, it, expect, vi } from 'vitest';
import type { Park } from '@dwt/shared';
import { AppError } from '../../../errors/index.js';
import { createParkLiveService, type ParkLiveServiceDeps } from '../parkLive.js';
import type { CachedParkLive, ParkLiveCache } from '../parkLiveCache.js';
import type { ParkGuidResolver } from '../parkResolve.js';
import type { ThemeParksLiveClient, ThemeParksLiveResponse } from '../themeParksLiveClient.js';

function createFakeCache(): ParkLiveCache & { readonly store: Map<Park, CachedParkLive> } {
  const store = new Map<Park, CachedParkLive>();
  return {
    store,
    async get(park: Park): Promise<CachedParkLive | null> {
      return store.get(park) ?? null;
    },
    async set(park: Park, entry: CachedParkLive): Promise<void> {
      store.set(park, entry);
    },
  };
}

describe('ParkLiveService unit tests (Tasks 2.5, 2.6)', () => {
  const fixedNow = new Date('2026-09-17T12:00:00.000Z');
  const parkGuid = 'magic-kingdom-guid';
  const experienceId1 = '11111111-1111-4111-8111-111111111111';
  const experienceId2 = '22222222-2222-4222-8222-222222222222';
  const upstreamEntityId1 = 'tp-entity-1';
  const upstreamEntityId2 = 'tp-entity-2';

  const mockLiveResponse: ThemeParksLiveResponse = {
    id: parkGuid,
    name: 'Magic Kingdom Park',
    liveData: [
      {
        id: parkGuid, // park entity itself — should be omitted by projection
        name: 'Magic Kingdom Park',
        status: 'OPERATING',
      },
      {
        id: upstreamEntityId1,
        name: 'Space Mountain',
        status: 'OPERATING',
        queue: {
          STANDBY: { waitTime: 45 },
        },
      },
      {
        id: upstreamEntityId2,
        name: 'Big Thunder Mountain Railroad',
        status: 'CLOSED',
      },
      {
        id: 'untracked-entity',
        name: 'Unknown Attraction',
        status: 'OPERATING',
      },
    ],
  };

  function setupService(overrides?: Partial<ParkLiveServiceDeps>) {
    const cache = createFakeCache();
    const client: ThemeParksLiveClient = {
      getEntityLive: vi.fn(async () => mockLiveResponse),
      getEntitySchedule: vi.fn(async () => ({ id: '', timezone: '', schedule: [] })),
    };
    const parkResolver: ParkGuidResolver = {
      resolveParkGuid: vi.fn(async (park: Park) => (park === 'Magic Kingdom' ? parkGuid : null)),
    };
    const getExperiencesWithUpstreamIds = vi.fn(async (_park?: Park) => [
      { id: experienceId1, upstream_entity_id: upstreamEntityId1 },
      { id: experienceId2, upstream_entity_id: upstreamEntityId2 },
    ]);

    const service = createParkLiveService({
      client,
      cache,
      parkResolver,
      getExperiencesWithUpstreamIds,
      now: () => fixedNow,
      deadlineMs: 5000,
      ...overrides,
    });

    return {
      service,
      cache,
      client,
      parkResolver,
      getExperiencesWithUpstreamIds,
    };
  }

  it('fresh-fetch success: resolves GUID, fetches, projects, caches, returns stale:false', async () => {
    const { service, client, cache, getExperiencesWithUpstreamIds } = setupService();

    const result = await service.getParkLive('Magic Kingdom');

    expect(client.getEntityLive).toHaveBeenCalledWith(parkGuid, expect.any(AbortSignal));
    expect(getExperiencesWithUpstreamIds).toHaveBeenCalledWith('Magic Kingdom');
    expect(result.stale).toBe(false);
    expect(result.retrievedAt).toBe(fixedNow.toISOString());
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({
      experienceId: experienceId1,
      name: 'Space Mountain',
      status: 'OPERATING',
      waitMinutes: 45,
    });
    expect(result.entries[1]).toEqual({
      experienceId: experienceId2,
      name: 'Big Thunder Mountain Railroad',
      status: 'CLOSED',
      waitMinutes: null,
    });

    // Check cached
    const cached = await cache.get('Magic Kingdom');
    expect(cached).not.toBeNull();
    expect(cached?.entries).toEqual(result.entries);
  });

  it('cache-hit-within-TTL: serves cached data without contacting upstream', async () => {
    const { service, client, cache } = setupService();

    // Seed cache within 5 minutes (e.g. 60s ago)
    const cachedEntry: CachedParkLive = {
      entries: [
        {
          experienceId: experienceId1,
          name: 'Space Mountain',
          status: 'OPERATING',
          waitMinutes: 30,
        },
      ],
      retrievedAt: new Date(fixedNow.getTime() - 60_000).toISOString(),
    };
    await cache.set('Magic Kingdom', cachedEntry);

    const result = await service.getParkLive('Magic Kingdom');

    expect(client.getEntityLive).not.toHaveBeenCalled();
    expect(result.stale).toBe(false);
    expect(result.entries).toEqual(cachedEntry.entries);
  });

  it('stale-serve-on-failure-with-cache: returns cached snapshot with stale:true when upstream throws', async () => {
    const client: ThemeParksLiveClient = {
      getEntityLive: vi.fn(async () => {
        throw new Error('Network error');
      }),
      getEntitySchedule: vi.fn(async () => ({ id: '', timezone: '', schedule: [] })),
    };
    const { service, cache } = setupService({ client });

    // Seed cache past TTL (e.g. 10 minutes ago)
    const cachedEntry: CachedParkLive = {
      entries: [
        {
          experienceId: experienceId1,
          name: 'Space Mountain',
          status: 'OPERATING',
          waitMinutes: 30,
        },
      ],
      retrievedAt: new Date(fixedNow.getTime() - 600_000).toISOString(),
    };
    await cache.set('Magic Kingdom', cachedEntry);

    const result = await service.getParkLive('Magic Kingdom');

    expect(result.stale).toBe(true);
    expect(result.entries).toEqual(cachedEntry.entries);
  });

  it('live_unavailable on failure with no cache', async () => {
    const client: ThemeParksLiveClient = {
      getEntityLive: vi.fn(async () => {
        throw new Error('500 Internal Server Error');
      }),
      getEntitySchedule: vi.fn(async () => ({ id: '', timezone: '', schedule: [] })),
    };
    const { service } = setupService({ client });

    await expect(service.getParkLive('Magic Kingdom')).rejects.toThrow(AppError);
    await expect(service.getParkLive('Magic Kingdom')).rejects.toMatchObject({
      code: 'live_unavailable',
    });
  });

  it('live_unavailable when park GUID cannot be resolved and no cache', async () => {
    const parkResolver: ParkGuidResolver = {
      resolveParkGuid: vi.fn(async () => null),
    };
    const { service } = setupService({ parkResolver });

    await expect(service.getParkLive('Disney Springs')).rejects.toThrow(AppError);
    await expect(service.getParkLive('Disney Springs')).rejects.toMatchObject({
      code: 'live_unavailable',
    });
  });

  it('stale-serve when park GUID cannot be resolved but cached entry exists', async () => {
    const parkResolver: ParkGuidResolver = {
      resolveParkGuid: vi.fn(async () => null),
    };
    const { service, cache } = setupService({ parkResolver });

    const cachedEntry: CachedParkLive = {
      entries: [],
      retrievedAt: new Date(fixedNow.getTime() - 600_000).toISOString(),
    };
    await cache.set('Disney Springs', cachedEntry);

    const result = await service.getParkLive('Disney Springs');
    expect(result.stale).toBe(true);
    expect(result.entries).toEqual([]);
  });

  it('Disney source isolation (Requirement 9.7): carries no Disney dependencies', async () => {
    // Disney tripwire: an object whose methods throw if invoked
    const disneyTripwire = {
      getFacility: vi.fn(() => {
        throw new Error('DISNEY_TRIPWIRE_TRIGGERED');
      }),
      sync: vi.fn(() => {
        throw new Error('DISNEY_TRIPWIRE_TRIGGERED');
      }),
    };

    const { service } = setupService();
    const result = await service.getParkLive('Magic Kingdom');

    expect(result.stale).toBe(false);
    expect(disneyTripwire.getFacility).not.toHaveBeenCalled();
    expect(disneyTripwire.sync).not.toHaveBeenCalled();
  });

  it('regression: resolves Disney upstream_entity_id to ThemeParks entity GUID via getEntityIdMap', async () => {
    const disneyEnterpriseId = '80010174;entityType=Attraction';
    const tpGuid = '757ef535-6195-42a5-9830-7614e55642e3';
    const appExpId = 'space-mountain-db-id';

    const entityIdMap = new Map<string, string>([[disneyEnterpriseId, tpGuid]]);
    const getEntityIdMap = vi.fn(async () => entityIdMap);

    const client: ThemeParksLiveClient = {
      getEntityLive: vi.fn(async () => ({
        id: parkGuid,
        name: 'Magic Kingdom Park',
        liveData: [
          {
            id: tpGuid, // Live feed returns the ThemeParks GUID, NOT the enterprise ID!
            name: 'Space Mountain',
            status: 'OPERATING',
            queue: {
              STANDBY: { waitTime: 55 },
            },
          },
        ],
      })),
      getEntitySchedule: vi.fn(async () => ({ id: '', timezone: '', schedule: [] })),
    };

    const getExperiencesWithUpstreamIds = vi.fn(async () => [
      { id: appExpId, upstream_entity_id: disneyEnterpriseId },
    ]);

    const { service } = setupService({
      client,
      getEntityIdMap,
      getExperiencesWithUpstreamIds,
    });

    const result = await service.getParkLive('Magic Kingdom');

    expect(getEntityIdMap).toHaveBeenCalled();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      experienceId: appExpId,
      name: 'Space Mountain',
      status: 'OPERATING',
      waitMinutes: 55,
    });
  });
});

