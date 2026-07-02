/**
 * End-to-end restaurant menu read integration test
 * (restaurant-menu-display, task 7.2).
 *
 * This test wires the demand-driven retrieval seam exactly as the composition
 * root does in production — `createMenuRetrieval({ repo, client, freshnessMs })`
 * with the catalog detail route's `getMenusFor` port delegating to
 * `menuRetrieval.getMenuForRestaurant(id)` — and drives it through the REAL
 * `catalogRoutes` Fastify plugin via `app.inject`. Only the two true edges are
 * faked: the Menu_Service (`client.getMenus`, a call-counting stub) and the
 * Menu_Cache repo (an in-memory `getMenuFetchState`/`upsertMenus`/`getExperience`
 * fake). Everything between the HTTP boundary and those edges — the route's
 * category gate, `toDetailResponse`'s include/omit rule, the seam's freshness
 * decision, projection, and cache write — runs verbatim.
 *
 * It asserts the design's "End-to-end read" integration coverage:
 *
 *   - First read (cache miss): the restaurant's menu is fetched from the
 *     Menu_Service exactly once, the cache is populated with a fresh
 *     `fetched_at`, and the `GET /catalog/:experienceId` response carries the
 *     `menus` field in MenuDTO shape (R1.1, R3.1).
 *   - Second read within the freshness window: the response is served from the
 *     cache and the Menu_Service is NOT contacted again — the call count stays
 *     at 1 (R1.3).
 *
 * Validates: Requirements 1.1, 1.3, 3.1
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { ExperienceDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../src/errors/handler.js';
import { catalogRoutes } from '../../src/services/catalog/routes.js';
import {
  createMenuRetrieval,
  type MenuRetrievalRepo,
  type MenuFetchClient,
} from '../../src/services/catalog/menuRetrieval.js';
import type {
  MenuCacheEntry,
  MenuFetchState,
} from '../../src/services/catalog/repo.js';
import type { RawMenu } from '../../src/services/catalog/disney/menu.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const RESTAURANT_UPSTREAM_ID = '80010177;entityType=Restaurant';

/** The Restaurant Experience served by the fake `getExperience`. */
const RESTAURANT: ExperienceDTO = {
  id: RESTAURANT_ID,
  name: 'Cinderella Royal Table',
  park: 'Magic Kingdom',
  category: 'Restaurant',
  description: 'Dine inside the castle.',
  active: true,
  imageUrl: null,
  areaType: 'ThemePark',
};

/**
 * The raw Menu_Service payload for the restaurant. A single request returns all
 * of the restaurant's menus in one response (R2.2), so the two menu types below
 * arrive in one `getMenus` call and project into two MenuDTOs in order.
 */
const RAW_MENUS: readonly RawMenu[] = [
  {
    menuType: 'Dinner',
    cuisineType: 'American',
    groups: [
      {
        name: 'Entrees',
        items: [
          { name: 'Chef-inspired Beef Tenderloin', price: '$62' },
          { name: 'Roasted Chicken', price: '$45' },
        ],
      },
    ],
  },
  {
    menuType: 'Breakfast',
    cuisineType: null,
    groups: [
      {
        name: 'Mains',
        items: [{ name: 'Royal Breakfast Platter', price: '$42' }],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// In-memory fakes (the only faked edges: the Menu_Service and the Menu_Cache)
// ---------------------------------------------------------------------------

/**
 * A call-counting stub of the Menu_Service edge of the Facilities_Client. It
 * records how many times `getMenus` is invoked so the test can prove the second
 * (fresh-cache) read never contacts the Menu_Service again (R1.3).
 */
function createCallCountingClient(menus: readonly RawMenu[]): {
  client: MenuFetchClient;
  getCallCount: () => number;
  getRequestedIds: () => readonly string[];
} {
  let callCount = 0;
  const requestedIds: string[] = [];
  return {
    client: {
      async getMenus(enterpriseId: string): Promise<readonly RawMenu[]> {
        callCount += 1;
        requestedIds.push(enterpriseId);
        return menus;
      },
    },
    getCallCount: () => callCount,
    getRequestedIds: () => requestedIds,
  };
}

/**
 * An in-memory fake of the Menu_Cache repo surface the retrieval seam and the
 * detail route depend on. It simulates the persisted `experience_menus` cache:
 * `getMenuFetchState` reflects whatever `upsertMenus` last wrote, so a first
 * (miss) read followed by a write makes the second read see a populated cache.
 */
function createFakeRepo(experiences: readonly ExperienceDTO[]): {
  repo: MenuRetrievalRepo & {
    getExperience(id: string): Promise<ExperienceDTO | null>;
  };
  getCached: (id: string) => MenuCacheEntry | null;
} {
  const byId = new Map(experiences.map((exp) => [exp.id, exp] as const));
  const upstreamById = new Map<string, string>([
    [RESTAURANT_ID, RESTAURANT_UPSTREAM_ID],
  ]);
  const cache = new Map<string, MenuCacheEntry>();

  return {
    repo: {
      async getExperience(id: string): Promise<ExperienceDTO | null> {
        return byId.get(id) ?? null;
      },
      async getMenuFetchState(
        experienceId: string,
      ): Promise<MenuFetchState | null> {
        const upstreamEntityId = upstreamById.get(experienceId);
        if (upstreamEntityId === undefined) {
          return null;
        }
        return {
          upstreamEntityId,
          cached: cache.get(experienceId) ?? null,
        };
      },
      async upsertMenus(experienceId, menus, fetchedAt): Promise<void> {
        cache.set(experienceId, { menus, fetchedAt });
      },
    },
    getCached: (id: string) => cache.get(id) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function buildApp(): Promise<{
  app: FastifyInstance;
  getMenuCallCount: () => number;
  getRequestedIds: () => readonly string[];
  getCached: (id: string) => MenuCacheEntry | null;
}> {
  const { repo, getCached } = createFakeRepo([RESTAURANT]);
  const { client, getCallCount, getRequestedIds } =
    createCallCountingClient(RAW_MENUS);

  // A fixed clock so both reads fall within the freshness window: the second
  // read's cache age is 0 ms <= freshnessMs, so it serves from cache (R1.3).
  const fixedNow = new Date('2024-06-01T12:00:00Z');
  const menuRetrieval = createMenuRetrieval({
    repo,
    client,
    freshnessMs: 86_400_000,
    now: () => fixedNow,
  });

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    catalogRoutes({
      decideRead: async () => ({ staleCache: false }),
      listActiveExperiences: async () => [],
      getExperience: (id) => repo.getExperience(id),
      // Wired exactly like the composition root (design § "Backend wiring").
      getMenusFor: (id) => menuRetrieval.getMenuForRestaurant(id),
    }),
  );

  return {
    app,
    getMenuCallCount: getCallCount,
    getRequestedIds,
    getCached,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('End-to-end restaurant menu read (R1.1, R1.3, R3.1)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('first read fetches from the Menu_Service, populates the cache, and carries menus; second read serves from cache without a further fetch', async () => {
    const harness = await buildApp();
    app = harness.app;

    // --- First read: cache miss ------------------------------------------
    const first = await app.inject({
      method: 'GET',
      url: `/catalog/${RESTAURANT_ID}`,
    });

    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      id: string;
      category: string;
      menus?: readonly unknown[];
    };

    // The Menu_Service was contacted exactly once, for this restaurant's
    // upstream Enterprise_Id (R1.1, R2.2).
    expect(harness.getMenuCallCount()).toBe(1);
    expect(harness.getRequestedIds()).toEqual([RESTAURANT_UPSTREAM_ID]);

    // The response carries the projected menus in MenuDTO shape and in
    // upstream order (R3.1).
    expect(firstBody.id).toBe(RESTAURANT_ID);
    expect(firstBody.menus).toEqual([
      {
        menuType: 'Dinner',
        cuisineType: 'American',
        groups: [
          {
            name: 'Entrees',
            items: [
              { name: 'Chef-inspired Beef Tenderloin', price: '$62' },
              { name: 'Roasted Chicken', price: '$45' },
            ],
          },
        ],
      },
      {
        menuType: 'Breakfast',
        cuisineType: null,
        groups: [
          {
            name: 'Mains',
            items: [{ name: 'Royal Breakfast Platter', price: '$42' }],
          },
        ],
      },
    ]);

    // The cache was populated with a fresh fetched_at (R1.1).
    const cached = harness.getCached(RESTAURANT_ID);
    expect(cached).not.toBeNull();
    expect(cached?.menus).toEqual(firstBody.menus);
    expect(cached?.fetchedAt).toBeInstanceOf(Date);

    // --- Second read: fresh cache ---------------------------------------
    const second = await app.inject({
      method: 'GET',
      url: `/catalog/${RESTAURANT_ID}`,
    });

    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { menus?: readonly unknown[] };

    // Served from cache within the freshness window — the Menu_Service was NOT
    // contacted again (call count stays at 1) and the menus are identical
    // (R1.3).
    expect(harness.getMenuCallCount()).toBe(1);
    expect(secondBody.menus).toEqual(firstBody.menus);
  });
});
