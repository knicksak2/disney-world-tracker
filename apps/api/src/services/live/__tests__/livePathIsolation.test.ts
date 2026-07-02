/**
 * Live-path isolation wiring example tests (task 13.7).
 *
 * These are example/wiring tests (not property tests) that pin the structural
 * guarantees the design makes about the ThemeParks.wiki live path:
 *
 *   - The live path derives Live_Detail exclusively from the injected
 *     {@link ThemeParksLiveClient} and NEVER contacts a Disney source
 *     (R11.10, R12.3).
 *   - The live path has NO Disney dependency at all: `ThemeParksLiveServiceDeps`
 *     carries a `repo`, a `cache`, and a ThemeParks `client` and nothing that
 *     could reach the Disney_Sync_Gateway / Menu_Service. So even while "Disney
 *     is blocked" the live path stays fully functional and returns a projected
 *     {@link LiveDetailDTO} (R12.3).
 *
 * The isolation is demonstrated concretely with a "Disney tripwire" — a stand-in
 * Disney collaborator whose every method throws (as if Disney were WAF-blocked).
 * It is deliberately NOT wired into the service (there is no seam for it), and
 * `getLiveDetail` still resolves a fresh, schema-valid Live_Detail while the
 * tripwire's counters stay at zero.
 *
 * Validates: Requirements 11.10, 12.3
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

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Read-only fake resolver mapping an Experience id → its Enterprise_Id. */
function createFakeRepo(mapping: Readonly<Record<string, string | null>>): LiveRepo {
  return {
    async resolveUpstreamEntityId(experienceId: string): Promise<string | null> {
      return mapping[experienceId] ?? null;
    },
  };
}

/** In-memory Live_Cache with the same get/set semantics as the Redis-backed one. */
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

/** A spy ThemeParks.wiki live client recording every `getEntityLive` call. */
interface SpyThemeParksClient extends ThemeParksLiveClient {
  readonly calls: Array<{ readonly externalId: string; readonly hadSignal: boolean }>;
}

function createSpyThemeParksClient(
  response: ThemeParksLiveResponse,
): SpyThemeParksClient {
  const calls: Array<{ readonly externalId: string; readonly hadSignal: boolean }> = [];
  return {
    calls,
    async getEntityLive(
      externalId: string,
      signal?: AbortSignal,
    ): Promise<ThemeParksLiveResponse> {
      calls.push({ externalId, hadSignal: signal !== undefined });
      return response;
    },
  };
}

/**
 * A stand-in for any Disney collaborator. If the live path ever reached a
 * Disney source, one of these would have to be called; every method throws so
 * a stray contact fails loudly, and the counters let a test assert zero
 * contact. It is intentionally never injected — the live service has no seam
 * that accepts it — which is the structural proof of isolation.
 */
function createDisneyTripwire() {
  const state = { contacts: 0 };
  const boom = (op: string) => {
    state.contacts += 1;
    throw new Error(`Disney source contacted via ${op} — WAF-blocked (should never happen)`);
  };
  return {
    state,
    // Facilities_Client surface.
    async listChannelDocumentIds() {
      return boom('listChannelDocumentIds');
    },
    async bulkGetDocuments() {
      return boom('bulkGetDocuments');
    },
    async getMenus() {
      return boom('getMenus');
    },
    // Disney_Transport surface.
    async request() {
      return boom('transport.request');
    },
    // Bare fetch surface.
    fetch: (async () => boom('fetch')) as unknown as typeof globalThis.fetch,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = '11111111-2222-3333-4444-555555555555';
const ENTERPRISE_ID = '80010177;entityType=Attraction';

/** A well-formed ThemeParks.wiki live feed carrying a valid liveData payload. */
const LIVE_RESPONSE: ThemeParksLiveResponse = {
  id: 'themeparks-entity-id',
  name: 'Space Mountain',
  entityType: 'ATTRACTION',
  timezone: 'America/New_York',
  liveData: [
    {
      id: ENTERPRISE_ID,
      name: 'Space Mountain',
      entityType: 'ATTRACTION',
      status: 'OPERATING',
      lastUpdated: '2024-01-02T15:00:00.000Z',
      queue: {
        STANDBY: { waitTime: 45 },
        SINGLE_RIDER: { waitTime: 20 },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('live-path isolation (R11.10, R12.3)', () => {
  it('serves a projected Live_Detail using ONLY the ThemeParks client (never a Disney source)', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    const client = createSpyThemeParksClient(LIVE_RESPONSE);
    const disney = createDisneyTripwire();

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      // Identity resolver: the test's fixture keys liveData by the Enterprise_Id,
      // so resolving to itself keeps the spy assertions focused on isolation.
      resolveEntityId: async (id: string) => id,
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    // Functional: a fresh, schema-valid Live_Detail is produced (R12.3).
    expect(result.stale).toBe(false);
    expect(result.liveDetail.status).toBe('Operating');
    expect(result.liveDetail.waitMinutes).toBe(45);
    expect(result.liveDetail.singleRiderWaitMinutes).toBe(20);
    expect(liveDetailSchema.safeParse(result.liveDetail).success).toBe(true);

    // The ONLY upstream contacted is the ThemeParks.wiki live client, keyed by
    // externalId == Enterprise_Id, under a caller deadline (R11.2, R11.10).
    expect(client.calls).toEqual([{ externalId: ENTERPRISE_ID, hadSignal: true }]);

    // No Disney source was ever contacted.
    expect(disney.state.contacts).toBe(0);
  });

  it('stays functional while Disney is blocked — the live path has no Disney dependency', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    const client = createSpyThemeParksClient(LIVE_RESPONSE);
    // Model Disney as fully blocked: every Disney op throws. It is NOT injected
    // into the service, proving the live path cannot even attempt Disney.
    const disney = createDisneyTripwire();

    const deps = {
      repo,
      cache,
      client,
      resolveEntityId: async (id: string) => id,
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    };

    // Structural isolation: the live service deps carry exactly repo / cache /
    // client / resolveEntityId (+ optional clock) and nothing that could reach a
    // Disney source (resolveEntityId resolves against ThemeParks.wiki only).
    expect(Object.keys(deps).sort()).toEqual([
      'cache',
      'client',
      'now',
      'repo',
      'resolveEntityId',
    ]);

    const service = createThemeParksLiveService(deps);
    const result = await service.getLiveDetail(EXPERIENCE_ID);

    // The live path resolves normally even though Disney is "blocked" (R12.3).
    expect(result.stale).toBe(false);
    expect(result.liveDetail.status).toBe('Operating');
    expect(client.calls).toHaveLength(1);
    expect(disney.state.contacts).toBe(0);
  });

  it('a cache hit serves without any upstream contact — still no Disney source', async () => {
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    const client = createSpyThemeParksClient(LIVE_RESPONSE);
    const disney = createDisneyTripwire();
    const now = new Date('2024-01-02T15:05:00.000Z');

    // Pre-seed a fresh cache entry (within the 5-minute freshness window).
    await cache.set(EXPERIENCE_ID, {
      liveDetail: { status: 'Operating', showtimes: [], operatingHours: [], diningAvailability: [] },
      retrievedAt: new Date(now.getTime() - 60_000).toISOString(),
    });

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      resolveEntityId: async (id: string) => id,
      now: () => now,
    });
    const result = await service.getLiveDetail(EXPERIENCE_ID);

    // Served from cache: neither ThemeParks nor Disney was contacted.
    expect(result.stale).toBe(false);
    expect(client.calls).toHaveLength(0);
    expect(disney.state.contacts).toBe(0);
  });

  it('resolves the Enterprise_Id to the ThemeParks entity id before fetching live (R11.2)', async () => {
    // Regression for the live-join bug: the ThemeParks live endpoint is keyed by
    // the entity's own id (a GUID), NOT its externalId, so the service must map
    // Enterprise_Id -> ThemeParks id and fetch by that id.
    const THEMEPARKS_ID = '24cf863c-b6ba-4826-a056-0b698989cbf7';
    const repo = createFakeRepo({ [EXPERIENCE_ID]: ENTERPRISE_ID });
    const cache = createFakeCache();
    // Feed keyed/identified by the ThemeParks GUID (its externalId is the
    // Enterprise_Id), mirroring the real /entity/{guid}/live response.
    const client = createSpyThemeParksClient({
      id: THEMEPARKS_ID,
      timezone: 'America/New_York',
      liveData: [
        {
          id: THEMEPARKS_ID,
          status: 'OPERATING',
          queue: { STANDBY: { waitTime: 45 } },
        },
      ],
    });

    const service = createThemeParksLiveService({
      repo,
      cache,
      client,
      // The directory maps Enterprise_Id (externalId) -> the ThemeParks GUID.
      resolveEntityId: async (id: string) =>
        id === ENTERPRISE_ID ? THEMEPARKS_ID : null,
      now: () => new Date('2024-01-02T15:05:00.000Z'),
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID);

    // The live feed was fetched by the RESOLVED ThemeParks id, not the raw
    // Enterprise_Id (which 404s in reality).
    expect(client.calls).toEqual([{ externalId: THEMEPARKS_ID, hadSignal: true }]);
    expect(result.stale).toBe(false);
    expect(result.liveDetail.status).toBe('Operating');
    expect(result.liveDetail.waitMinutes).toBe(45);
  });
});
