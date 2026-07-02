/**
 * Unit tests for the lazy menu-retrieval seam (`menuRetrieval.ts`, task 9.1).
 *
 * These pin the orchestration behaviors around the pure `decideMenuFetch`
 * decision:
 *   - a fresh cache is served without contacting the Menu_Service (R8.4);
 *   - a missing/stale cache triggers a fetch that is projected, cached with a
 *     fresh `fetched_at`, and served (R8.2);
 *   - a Menu_Service failure serves any prior cached menu unchanged and does
 *     not raise (R8.5).
 *
 * The pure `decideMenuFetch` boundary sweep is Property 10 (task 9.2) and is
 * intentionally NOT duplicated here.
 */

import { describe, expect, it } from 'vitest';

import type { MenuDTO } from '@dwt/shared';

import type { RawMenu } from '../disney/menu.js';
import {
  createMenuRetrieval,
  decideMenuFetch,
  type MenuFetchClient,
  type MenuRetrievalLogger,
  type MenuRetrievalRepo,
} from '../menuRetrieval.js';
import type { MenuFetchState } from '../repo.js';

const FRESHNESS_MS = 86_400_000; // 24h

const RAW_MENU: readonly RawMenu[] = [
  {
    menuType: 'Dinner',
    cuisineType: 'American',
    groups: [{ name: 'Mains', items: [{ name: 'Steak', price: '$40' }] }],
  },
];

const PROJECTED: readonly MenuDTO[] = [
  {
    menuType: 'Dinner',
    cuisineType: 'American',
    groups: [{ name: 'Mains', items: [{ name: 'Steak', price: '$40' }] }],
  },
];

const CACHED: readonly MenuDTO[] = [
  { menuType: 'Lunch', cuisineType: null, groups: [] },
];

interface RepoCalls {
  readonly upserts: {
    experienceId: string;
    menus: readonly MenuDTO[];
    fetchedAt: Date;
  }[];
}

function makeRepo(
  state: MenuFetchState | null,
  calls: RepoCalls,
): MenuRetrievalRepo {
  return {
    async getMenuFetchState() {
      return state;
    },
    async upsertMenus(experienceId, menus, fetchedAt) {
      calls.upserts.push({ experienceId, menus, fetchedAt });
    },
  };
}

function makeClient(
  onGet: (id: string) => Promise<readonly RawMenu[]>,
  calls: string[],
): MenuFetchClient {
  return {
    async getMenus(id: string) {
      calls.push(id);
      return onGet(id);
    },
  };
}

const silentLogger: MenuRetrievalLogger = { warn() {} };

describe('decideMenuFetch', () => {
  it('fetches when the cache is missing', () => {
    expect(decideMenuFetch(null, new Date(1000), FRESHNESS_MS)).toBe(true);
  });

  it('serves the cache when fresh (inclusive boundary)', () => {
    const fetchedAt = new Date(0);
    const now = new Date(FRESHNESS_MS); // exactly interval old
    expect(decideMenuFetch(fetchedAt, now, FRESHNESS_MS)).toBe(false);
  });

  it('fetches when stale', () => {
    const fetchedAt = new Date(0);
    const now = new Date(FRESHNESS_MS + 1);
    expect(decideMenuFetch(fetchedAt, now, FRESHNESS_MS)).toBe(true);
  });
});

describe('createMenuRetrieval.getMenuForRestaurant', () => {
  it('serves the cached menu without contacting the Menu_Service when fresh (R8.4)', async () => {
    const now = new Date(FRESHNESS_MS);
    const state: MenuFetchState = {
      upstreamEntityId: 'ent-1',
      cached: { menus: CACHED, fetchedAt: new Date(1) },
    };
    const clientCalls: string[] = [];
    const repoCalls: RepoCalls = { upserts: [] };

    const retrieval = createMenuRetrieval({
      repo: makeRepo(state, repoCalls),
      client: makeClient(async () => RAW_MENU, clientCalls),
      freshnessMs: FRESHNESS_MS,
      now: () => now,
      logger: silentLogger,
    });

    const menus = await retrieval.getMenuForRestaurant('exp-1');

    expect(menus).toEqual(CACHED);
    expect(clientCalls).toHaveLength(0);
    expect(repoCalls.upserts).toHaveLength(0);
  });

  it('fetches, projects, caches with a fresh fetched_at, and serves when missing (R8.2)', async () => {
    const now = new Date(5_000);
    const state: MenuFetchState = { upstreamEntityId: 'ent-2', cached: null };
    const clientCalls: string[] = [];
    const repoCalls: RepoCalls = { upserts: [] };

    const retrieval = createMenuRetrieval({
      repo: makeRepo(state, repoCalls),
      client: makeClient(async () => RAW_MENU, clientCalls),
      freshnessMs: FRESHNESS_MS,
      now: () => now,
      logger: silentLogger,
    });

    const menus = await retrieval.getMenuForRestaurant('exp-2');

    expect(menus).toEqual(PROJECTED);
    expect(clientCalls).toEqual(['ent-2']);
    expect(repoCalls.upserts).toEqual([
      { experienceId: 'exp-2', menus: PROJECTED, fetchedAt: now },
    ]);
  });

  it('serves the prior cached menu unchanged and does not raise on fetch failure (R8.5)', async () => {
    const now = new Date(FRESHNESS_MS + 10);
    const state: MenuFetchState = {
      upstreamEntityId: 'ent-3',
      cached: { menus: CACHED, fetchedAt: new Date(1) }, // stale ⇒ tries fetch
    };
    const clientCalls: string[] = [];
    const repoCalls: RepoCalls = { upserts: [] };
    const warnings: string[] = [];

    const retrieval = createMenuRetrieval({
      repo: makeRepo(state, repoCalls),
      client: makeClient(async () => {
        throw new Error('Menu_Service exploded');
      }, clientCalls),
      freshnessMs: FRESHNESS_MS,
      now: () => now,
      logger: { warn: (_obj, msg) => warnings.push(msg) },
    });

    const menus = await retrieval.getMenuForRestaurant('exp-3');

    expect(menus).toEqual(CACHED); // unchanged
    expect(clientCalls).toEqual(['ent-3']); // it did attempt
    expect(repoCalls.upserts).toHaveLength(0); // nothing cached on failure
    expect(warnings).toHaveLength(1); // failure recorded
  });

  it('returns an empty array when the Experience does not exist', async () => {
    const clientCalls: string[] = [];
    const repoCalls: RepoCalls = { upserts: [] };

    const retrieval = createMenuRetrieval({
      repo: makeRepo(null, repoCalls),
      client: makeClient(async () => RAW_MENU, clientCalls),
      freshnessMs: FRESHNESS_MS,
      now: () => new Date(0),
      logger: silentLogger,
    });

    expect(await retrieval.getMenuForRestaurant('missing')).toEqual([]);
    expect(clientCalls).toHaveLength(0);
  });
});
