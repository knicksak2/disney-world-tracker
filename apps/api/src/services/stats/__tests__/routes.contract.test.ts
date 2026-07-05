/**
 * Contract test for the Stats_Service endpoint shape.
 *
 * Pins the wire contract of `GET /me/stats` for the coverage dimensions under
 * the superset response's `coverage` object:
 *
 *   - `coverage.byAreaType` — a record keyed by every `AREA_TYPES` value, each
 *     a `CompletionCell` (R2.1, R2.3).
 *   - `coverage.resort`     — the hotels-visited Resort_Statistic cell (R2.1).
 *
 * It asserts the zero-shape for both dimensions when the snapshot is empty and
 * that every `AREA_TYPES` key is present regardless of the snapshot contents.
 *
 * The plugin is registered against an in-process Fastify instance with a fake
 * `StatsRepo`, a fake DB pool, and a stub session pre-handler — no Postgres or
 * Redis traffic is involved.
 *
 * Validates: Requirements 2.1, 2.3.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { AREA_TYPES } from '@dwt/shared';
import type { AreaType } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  statsRoutes,
  type StatsResponse,
  type StatsRoutesOptions,
} from '../routes.js';
import type { CompletionCell } from '../coverage.js';
import type { RawCoverageCell, StatsRepo, StatsSnapshot } from '../repo.js';

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

type CellInput = Omit<RawCoverageCell, 'land' | 'resortArea'> &
  Partial<Pick<RawCoverageCell, 'land' | 'resortArea'>>;

function snapshotOf(cells: readonly CellInput[]): StatsSnapshot {
  return {
    coverage: cells.map((c) => ({ land: null, resortArea: null, ...c })),
    facetExperiences: [],
    userRatings: [],
    resortCoverage: [],
    percentile: null,
  };
}

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

/** Assert a cell is a well-formed `CompletionCell` of finite numbers/flags. */
function expectCellShape(actual: unknown): asserts actual is CompletionCell {
  expect(actual).toBeDefined();
  const c = actual as CompletionCell;
  expect(typeof c.completed).toBe('number');
  expect(typeof c.total).toBe('number');
  expect(typeof c.percent).toBe('number');
  expect(typeof c.remaining).toBe('number');
  expect(typeof c.completeBadge).toBe('boolean');
}

/** Assert a cell equals the zero-shape. */
function expectZeroShape(actual: CompletionCell | undefined): void {
  expect(actual).toEqual({
    completed: 0,
    total: 0,
    percent: 0,
    remaining: 0,
    completeBadge: false,
  });
}

// ---------------------------------------------------------------------------
// Contract: GET /me/stats coverage.byAreaType + coverage.resort shape
// ---------------------------------------------------------------------------

describe('GET /me/stats — coverage.byAreaType + coverage.resort contract (R2.1, R2.3)', () => {
  it('returns a byAreaType key for every AREA_TYPES value, each a CompletionCell', async () => {
    const cells: CellInput[] = [
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
      // A resort-representing row: sole source of `resort`, excluded from byAreaType.
      {
        park: null,
        category: 'Resort',
        areaType: 'Resort',
        isResortRepresentation: true,
        completed: 3,
        total: 8,
      },
    ];

    const body = await fetchStats(snapshotOf(cells));

    const areaKeys = Object.keys(body.coverage.byAreaType) as AreaType[];
    expect(new Set(areaKeys)).toEqual(new Set(AREA_TYPES));
    for (const area of AREA_TYPES) {
      expectCellShape(body.coverage.byAreaType[area]);
    }

    // `resort` counts only the representing row (kept distinct from byAreaType.Resort).
    expectCellShape(body.coverage.resort);
    expect(body.coverage.resort).toEqual({
      completed: 3,
      total: 8,
      percent: 37.5,
      remaining: 5,
      completeBadge: false,
    });
    // Resort Area_Statistic counts the resort-area activity only.
    expect(body.coverage.byAreaType['Resort']).toEqual({
      completed: 1,
      total: 2,
      percent: 50,
      remaining: 1,
      completeBadge: false,
    });
  });

  it('reports the zero-shape for every byAreaType key and for resort when the snapshot is empty', async () => {
    const body = await fetchStats(snapshotOf([]));

    const areaKeys = Object.keys(body.coverage.byAreaType) as AreaType[];
    expect(new Set(areaKeys)).toEqual(new Set(AREA_TYPES));
    for (const area of AREA_TYPES) {
      expectZeroShape(body.coverage.byAreaType[area]);
    }
    expectCellShape(body.coverage.resort);
    expectZeroShape(body.coverage.resort);
  });
});
