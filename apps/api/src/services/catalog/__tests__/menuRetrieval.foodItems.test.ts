/**
 * Integration test for Menu_Retrieval seeding Food_Items (Feature: food-item-logging).
 *
 * Validates:
 *   - `upsertFoodItemsFromMenus` is invoked exactly once per real fetch with the projected menus;
 *   - never invoked on a fresh-cache serve;
 *   - never invoked on a fetch failure.
 *
 * Validates: Requirements 1.1, 1.4
 */

import { describe, expect, it } from 'vitest';

import type { MenuDTO } from '@dwt/shared';

import type { RawMenu } from '../disney/menu.js';
import {
  createMenuRetrieval,
  type MenuFetchClient,
  type MenuRetrievalLogger,
  type MenuRetrievalRepo,
} from '../menuRetrieval.js';
import type { MenuFetchState } from '../repo.js';

const FRESHNESS_MS = 86_400_000; // 24h
const EXP_ID = '11111111-1111-4111-8111-111111111111';

const RAW_MENU: readonly RawMenu[] = [
  {
    menuType: 'Dinner',
    cuisineType: 'American',
    groups: [
      {
        name: 'Mains',
        items: [
          { name: 'Grey Stuff', price: '$5.99' },
          { name: 'Roast Beef', price: '$24.99' },
        ],
      },
    ],
  },
];

const CACHED: readonly MenuDTO[] = [
  {
    menuType: 'Dinner',
    cuisineType: 'American',
    groups: [{ name: 'Mains', items: [{ name: 'Old Dish', price: '$10.00' }] }],
  },
];

interface RepoCalls {
  upsertMenusCalls: { experienceId: string; menus: readonly MenuDTO[]; fetchedAt: Date }[];
  upsertFoodItemsCalls: { experienceId: string; menus: readonly MenuDTO[]; seenAt: Date }[];
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
      calls.upsertMenusCalls.push({ experienceId, menus, fetchedAt });
    },
    async upsertFoodItemsFromMenus(experienceId, menus, seenAt) {
      calls.upsertFoodItemsCalls.push({ experienceId, menus, seenAt });
    },
  };
}

function makeClient(
  onGet: (id: string) => Promise<readonly RawMenu[]>,
): MenuFetchClient {
  return {
    async getMenus(id: string) {
      return onGet(id);
    },
  };
}

const silentLogger: MenuRetrievalLogger = { warn() {} };

describe('MenuRetrieval Food Items Seeding Hook (Requirement 1.1, 1.4)', () => {
  it('calls upsertFoodItemsFromMenus exactly once on cache-miss fetch', async () => {
    const calls: RepoCalls = {
      upsertMenusCalls: [],
      upsertFoodItemsCalls: [],
    };
    const repo = makeRepo(
      { upstreamEntityId: 'upstream-1', cached: null },
      calls,
    );
    const client = makeClient(async () => RAW_MENU);

    const retrieval = createMenuRetrieval({
      repo,
      client,
      freshnessMs: FRESHNESS_MS,
      logger: silentLogger,
    });

    const result = await retrieval.getMenuForRestaurant(EXP_ID);

    expect(result).toHaveLength(1);
    expect(calls.upsertMenusCalls).toHaveLength(1);
    expect(calls.upsertFoodItemsCalls).toHaveLength(1);
    expect(calls.upsertFoodItemsCalls[0]!.experienceId).toBe(EXP_ID);
    expect(calls.upsertFoodItemsCalls[0]!.menus).toEqual(result);
  });

  it('calls upsertFoodItemsFromMenus on stale-cache refresh', async () => {
    const calls: RepoCalls = {
      upsertMenusCalls: [],
      upsertFoodItemsCalls: [],
    };
    const repo = makeRepo(
      {
        upstreamEntityId: 'upstream-1',
        cached: {
          menus: CACHED,
          fetchedAt: new Date(Date.now() - FRESHNESS_MS - 10_000), // stale
        },
      },
      calls,
    );
    const client = makeClient(async () => RAW_MENU);

    const retrieval = createMenuRetrieval({
      repo,
      client,
      freshnessMs: FRESHNESS_MS,
      logger: silentLogger,
    });

    const result = await retrieval.getMenuForRestaurant(EXP_ID);

    expect(result).toHaveLength(1);
    expect(calls.upsertFoodItemsCalls).toHaveLength(1);
    expect(calls.upsertFoodItemsCalls[0]!.experienceId).toBe(EXP_ID);
  });

  it('never calls upsertFoodItemsFromMenus on fresh-cache serve', async () => {
    const calls: RepoCalls = {
      upsertMenusCalls: [],
      upsertFoodItemsCalls: [],
    };
    const repo = makeRepo(
      {
        upstreamEntityId: 'upstream-1',
        cached: {
          menus: CACHED,
          fetchedAt: new Date(), // fresh
        },
      },
      calls,
    );
    const client = makeClient(async () => RAW_MENU);

    const retrieval = createMenuRetrieval({
      repo,
      client,
      freshnessMs: FRESHNESS_MS,
      logger: silentLogger,
    });

    const result = await retrieval.getMenuForRestaurant(EXP_ID);

    expect(result).toEqual(CACHED);
    expect(calls.upsertMenusCalls).toHaveLength(0);
    expect(calls.upsertFoodItemsCalls).toHaveLength(0);
  });

  it('never calls upsertFoodItemsFromMenus on fetch failure', async () => {
    const calls: RepoCalls = {
      upsertMenusCalls: [],
      upsertFoodItemsCalls: [],
    };
    const repo = makeRepo(
      {
        upstreamEntityId: 'upstream-1',
        cached: {
          menus: CACHED,
          fetchedAt: new Date(Date.now() - FRESHNESS_MS - 10_000), // stale
        },
      },
      calls,
    );
    const client = makeClient(async () => {
      throw new Error('Disney Menu_Service HTTP 500');
    });

    const retrieval = createMenuRetrieval({
      repo,
      client,
      freshnessMs: FRESHNESS_MS,
      logger: silentLogger,
    });

    const result = await retrieval.getMenuForRestaurant(EXP_ID);

    // Serves stale cache on failure
    expect(result).toEqual(CACHED);
    expect(calls.upsertMenusCalls).toHaveLength(0);
    expect(calls.upsertFoodItemsCalls).toHaveLength(0);
  });
});
