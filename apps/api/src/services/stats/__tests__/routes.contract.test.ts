/**
 * Contract test for the Stats_Service endpoint shape (task 6.7).
 *
 * This test pins the wire contract of `GET /me/stats` for the two new
 * dimensions this feature adds:
 *
 *   - `byAreaType` — a record keyed by every `AREA_TYPES` value, each a
 *     `{ completed, total, percent }` breakdown (R2.1, R2.3).
 *   - `resort`     — the hotels-visited Resort_Statistic breakdown (R4.2).
 *
 * It asserts the "zero-shape" (`{ completed: 0, total: 0, percent: 0.0 }`)
 * for both dimensions when the snapshot is empty (no cells), and that every
 * `AREA_TYPES` key is present regardless of what the snapshot contains.
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake `StatsRepo`, a fake DB pool, and a stub session pre-handler — no
 * Postgres or Redis traffic is involved, matching the convention in
 * `routes.test.ts`.
 *
 * Validates: Requirements 2.1, 2.3, 4.2.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { AREA_TYPES } from '@dwt/shared';
import type { AreaType } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  statsRoutes,
  type StatsBreakdown,
  type StatsResponse,
  type StatsRoutesOptions,
} from '../routes.js';
import type { StatsCell, StatsRepo, StatsSnapshot } from '../repo.js';

// ---------------------------------------------------------------------------
// Fake DB pool (unused by /me/stats, but required by the plugin options)
// ---------------------------------------------------------------------------

interface FakePool {
  query: (text: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: unknown[] }>;
}

function makeFakePool(): FakePool {
  return {
    async query() {
      return { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake StatsRepo
// ---------------------------------------------------------------------------

function makeFakeRepo(snapshot: StatsSnapshot): StatsRepo {
  return {
    async getStatsSnapshot(): Promise<StatsSnapshot> {
      return snapshot;
    },
  };
}

// ---------------------------------------------------------------------------
// Stub session pre-handler
// ---------------------------------------------------------------------------

const requireSession: StatsRoutesOptions['requireSession'] = (
  request,
  _reply,
  done,
) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
  }
  done();
};

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

async function buildApp(snapshot: StatsSnapshot): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    statsRoutes({
      pool: makeFakePool() as unknown as StatsRoutesOptions['pool'],
      repo: makeFakeRepo(snapshot),
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

async function fetchStats(snapshot: StatsSnapshot): Promise<StatsResponse> {
  const app = await buildApp(snapshot);
  try {
    const res = await app.inject({
      method: 'GET',
      url: '/me/stats',
      headers: { 'x-test-user-id': 'user-self' },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as StatsResponse;
  } finally {
    await app.close();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Assert a breakdown is a well-formed `{ completed, total, percent }` triple
 * of finite numbers. This is the structural half of the contract.
 */
function expectBreakdownShape(actual: unknown): asserts actual is StatsBreakdown {
  expect(actual).toBeDefined();
  const b = actual as StatsBreakdown;
  expect(typeof b.completed).toBe('number');
  expect(typeof b.total).toBe('number');
  expect(typeof b.percent).toBe('number');
}

/** Assert a breakdown equals the zero-shape `{ 0, 0, 0.0 }`. */
function expectZeroShape(actual: StatsBreakdown | undefined): void {
  expect(actual).toEqual({ completed: 0, total: 0, percent: 0 });
}

// ---------------------------------------------------------------------------
// Contract: GET /me/stats byAreaType + resort shape
// ---------------------------------------------------------------------------

describe('GET /me/stats — byAreaType + resort contract (R2.1, R2.3, R4.2)', () => {
  it('returns a byAreaType key for every AREA_TYPES value, each a {completed,total,percent} breakdown', async () => {
    // A populated snapshot: one real Experience per Area_Type plus a
    // resort-representing row, so no key is present merely because the
    // response object was seeded with zeros.
    const cells: StatsCell[] = [
      {
        park: 'Magic Kingdom',
        category: 'Ride',
        areaType: 'ThemePark',
        isResortRepresentation: false,
        completed: 2,
        total: 5,
      },
      {
        park: null,
        category: 'Recreation',
        areaType: 'WaterPark',
        isResortRepresentation: false,
        completed: 1,
        total: 3,
      },
      {
        park: 'Disney Springs',
        category: 'Restaurant',
        areaType: 'DisneySprings',
        isResortRepresentation: false,
        completed: 0,
        total: 4,
      },
      {
        park: null,
        category: 'Spa',
        areaType: 'Resort',
        isResortRepresentation: false,
        completed: 1,
        total: 2,
      },
      // A resort-representing row: sole source of `resort`, carries the real
      // `Resort` category, excluded from byAreaType.
      {
        park: null,
        category: 'Resort',
        areaType: 'Resort',
        isResortRepresentation: true,
        completed: 3,
        total: 8,
      },
    ];

    const body = await fetchStats({ cells });

    // Every AREA_TYPES key is present and well-formed.
    const areaKeys = Object.keys(body.byAreaType) as AreaType[];
    expect(new Set(areaKeys)).toEqual(new Set(AREA_TYPES));
    for (const area of AREA_TYPES) {
      expectBreakdownShape(body.byAreaType[area]);
    }

    // The `resort` breakdown is present and well-formed, and counts only the
    // representing row (kept distinct from byAreaType['Resort'] — R4.4).
    expectBreakdownShape(body.resort);
    expect(body.resort).toEqual({ completed: 3, total: 8, percent: 37.5 });
    // Resort Area_Statistic counts the resort-*area* activity only.
    expect(body.byAreaType['Resort']).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
    });
  });

  it('reports the zero-shape for every byAreaType key and for resort when the snapshot is empty', async () => {
    const body = await fetchStats({ cells: [] });

    // byAreaType still exposes every key, each the zero-shape (R2.3).
    const areaKeys = Object.keys(body.byAreaType) as AreaType[];
    expect(new Set(areaKeys)).toEqual(new Set(AREA_TYPES));
    for (const area of AREA_TYPES) {
      expectZeroShape(body.byAreaType[area]);
    }

    // The resort breakdown is present with the zero-shape (R4.2).
    expectBreakdownShape(body.resort);
    expectZeroShape(body.resort);
  });
});
