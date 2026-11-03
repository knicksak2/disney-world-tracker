/**
 * Unit and property tests for menuRetrieval shape version handling and lazy refill.
 *
 * Validates: Requirements 10.7
 */

import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { MenuDTO } from '@dwt/shared';
import {
  createMenuRetrieval,
  decideMenuFetch,
  decideMenuRefresh,
  type MenuFetchClient,
  type MenuRetrievalRepo,
} from '../menuRetrieval.js';

const FRESHNESS_MS = 24 * 60 * 60 * 1000; // 24 hours

const SAMPLE_MENU_V1: readonly MenuDTO[] = [
  {
    menuType: 'Dinner',
    cuisineType: 'American',
    groups: [
      {
        name: 'Mains',
        items: [{ name: 'Burger', price: '$15.00' }],
      },
    ],
  },
];

const SAMPLE_MENU_V2: readonly MenuDTO[] = [
  {
    menuType: 'Dinner',
    cuisineType: 'American',
    serviceStyle: 'Table Service',
    experience: 'Casual',
    groups: [
      {
        name: 'Mains',
        type: 'Entree',
        items: [
          {
            name: 'Burger',
            price: '$15.00',
            priceCents: 1500,
            prices: [{ cents: 1500, label: 'Per Serving' }],
          },
        ],
      },
    ],
  },
];

describe('menuRetrieval.shape — unit tests (R10.7)', () => {
  it('stale shape (shapeVersion = 1) refetches once even when within 24-hour freshness window', async () => {
    const now = new Date('2026-10-25T12:00:00.000Z');
    const fetchedAt = new Date('2026-10-25T11:59:00.000Z'); // 1 minute ago (fresh)

    let currentShapeVersion = 1;
    let currentCachedMenus = SAMPLE_MENU_V1;
    const clientCalls: string[] = [];
    const client: MenuFetchClient = {
      getMenus: vi.fn().mockImplementation(async (term: string) => {
        clientCalls.push(term);
        currentShapeVersion = 2; // Refreshed to v2
        return [
          {
            menuType: 'Dinner',
            cuisineType: 'American',
            serviceStyle: 'Table Service',
            experience: 'Casual',
            groups: [
              {
                name: 'Mains',
                type: 'Entree',
                items: [
                  {
                    name: 'Burger',
                    price: '$15.00',
                    priceCents: 1500,
                    prices: [{ cents: 1500, label: 'Per Serving' }],
                  },
                ],
              },
            ],
          },
        ];
      }),
    };

    const upserts: { menus: readonly MenuDTO[]; fetchedAt: Date }[] = [];
    const repo: MenuRetrievalRepo = {
      getMenuFetchState: vi.fn().mockImplementation(async () => ({
        upstreamEntityId: '90001212',
        cached: {
          menus: currentCachedMenus,
          fetchedAt,
          shapeVersion: currentShapeVersion,
        },
        shapeVersion: currentShapeVersion,
      })),
      upsertMenus: vi.fn().mockImplementation(async (_id, menus, ts) => {
        upserts.push({ menus, fetchedAt: ts });
        currentCachedMenus = menus;
      }),
    };

    const retrieval = createMenuRetrieval({
      repo,
      client,
      freshnessMs: FRESHNESS_MS,
      now: () => now,
    });

    // First call: stale shape_version = 1 triggers fetch despite recent fetchedAt
    const menusFirst = await retrieval.getMenuForRestaurant('exp-1', now);
    expect(clientCalls).toHaveLength(1);
    expect(upserts).toHaveLength(1);
    expect(menusFirst[0]?.serviceStyle).toBe('Table Service');

    // Second call: now shape_version is 2, fresh within 24h -> serves cache, no new fetch
    const menusSecond = await retrieval.getMenuForRestaurant('exp-1', now);
    expect(clientCalls).toHaveLength(1); // Still 1, no second call
    expect(upserts).toHaveLength(1);
    expect(menusSecond).toEqual(menusFirst);
  });

  it('fresh shape (shapeVersion = 2) within 24 hours does not refetch', async () => {
    const now = new Date('2026-10-25T12:00:00.000Z');
    const fetchedAt = new Date('2026-10-25T00:00:00.000Z'); // 12 hours ago

    const clientCalls: string[] = [];
    const client: MenuFetchClient = {
      getMenus: vi.fn().mockImplementation(async (term: string) => {
        clientCalls.push(term);
        return [];
      }),
    };

    const repo: MenuRetrievalRepo = {
      getMenuFetchState: vi.fn().mockResolvedValue({
        upstreamEntityId: '90001212',
        cached: {
          menus: SAMPLE_MENU_V2,
          fetchedAt,
          shapeVersion: 2,
        },
        shapeVersion: 2,
      }),
      upsertMenus: vi.fn(),
    };

    const retrieval = createMenuRetrieval({
      repo,
      client,
      freshnessMs: FRESHNESS_MS,
      now: () => now,
    });

    const menus = await retrieval.getMenuForRestaurant('exp-1', now);
    expect(menus).toEqual(SAMPLE_MENU_V2);
    expect(clientCalls).toHaveLength(0);
  });

  it('fetch failure serves the old cache without throwing', async () => {
    const now = new Date('2026-10-25T12:00:00.000Z');
    const fetchedAt = new Date('2026-10-25T11:59:00.000Z');

    const client: MenuFetchClient = {
      getMenus: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const repo: MenuRetrievalRepo = {
      getMenuFetchState: vi.fn().mockResolvedValue({
        upstreamEntityId: '90001212',
        cached: {
          menus: SAMPLE_MENU_V1,
          fetchedAt,
          shapeVersion: 1, // Stale shape
        },
        shapeVersion: 1,
      }),
      upsertMenus: vi.fn(),
    };

    const warnings: unknown[] = [];
    const logger = { warn: (obj: unknown) => warnings.push(obj) };

    const retrieval = createMenuRetrieval({
      repo,
      client,
      freshnessMs: FRESHNESS_MS,
      now: () => now,
      logger,
    });

    // Fetch threw, but getMenuForRestaurant served old cached menus
    const menus = await retrieval.getMenuForRestaurant('exp-1', now);
    expect(menus).toEqual(SAMPLE_MENU_V1);
    expect(warnings).toHaveLength(1);
  });
});

describe('decideMenuRefresh — property tests (R10.7)', () => {
  it('decideMenuRefresh implies decideMenuFetch for the same row when the shape is current', () => {
    fc.assert(
      fc.property(
        fc.record({
          fetchedAt: fc.oneof(fc.date(), fc.constant(null)),
          now: fc.date(),
          intervalMs: fc.integer({ min: 1, max: 7 * 24 * 3600 * 1000 }),
          currentShape: fc.integer({ min: 1, max: 10 }),
        }),
        ({ fetchedAt, now, intervalMs, currentShape }) => {
          // When shape is current (shapeVersion === currentShape)
          const refreshCurrent = decideMenuRefresh(
            { fetchedAt, shapeVersion: currentShape },
            now,
            intervalMs,
            currentShape,
          );
          const fetchDecision = decideMenuFetch(fetchedAt, now, intervalMs);

          // Must be strictly identical
          expect(refreshCurrent).toBe(fetchDecision);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('when shapeVersion is less than currentShape, decideMenuRefresh is always true', () => {
    fc.assert(
      fc.property(
        fc.record({
          fetchedAt: fc.oneof(fc.date(), fc.constant(null)),
          now: fc.date(),
          intervalMs: fc.integer({ min: 1, max: 7 * 24 * 3600 * 1000 }),
          shapeVersion: fc.integer({ min: 0, max: 5 }),
          delta: fc.integer({ min: 1, max: 5 }),
        }),
        ({ fetchedAt, now, intervalMs, shapeVersion, delta }) => {
          const currentShape = shapeVersion + delta; // strictly greater
          const refresh = decideMenuRefresh(
            { fetchedAt, shapeVersion },
            now,
            intervalMs,
            currentShape,
          );
          expect(refresh).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
