/**
 * Integration tests for percentile opt-in and failure isolation
 * (expanded-stats task 8.4).
 *
 * These tests drive the real `statsRoutes` plugin through an in-process
 * Fastify instance with a fake `StatsRepo`, a fake DB pool, and a stub session
 * pre-handler — the same hermetic harness the task 8.1 suite uses — but focus
 * exclusively on the two Requirement 7 behaviours this task owns:
 *
 *   - **Percentile opt-in (R7.2):** when a request does NOT ask for the
 *     Percentile_Rank, the field is omitted from the response AND the repo is
 *     invoked with `includePercentile: false`, so no percentile material is
 *     read and no percentile computation runs. When `?percentile=true` IS
 *     supplied, the repo is asked for percentile material and the computed
 *     `percentileRank` is present.
 *   - **Percentile failure isolation (R7.9):** when the percentile cannot be
 *     computed (the snapshot succeeded but carries no percentile material), the
 *     response omits `percentileRank`, sets `percentileUnavailable: true`, and
 *     returns every OTHER statistic (coverage dimensions and rating statistics)
 *     byte-for-byte unchanged from the same request made without percentile.
 *
 * Validates: Requirements 7.2, 7.9.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { GroupedFacetsDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  statsRoutes,
  type StatsResponse,
  type StatsRoutesOptions,
} from '../routes.js';
import type { RawCoverageCell } from '../coverage.js';
import type { RawFacetExperienceRow } from '../facets.js';
import type { RawUserRatingRow } from '../ratingStats.js';
import type {
  PercentileInput,
  StatsRepo,
  StatsSnapshot,
  StatsSnapshotInput,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Snapshot builders
// ---------------------------------------------------------------------------

/** A partial coverage cell; `land`/`resortArea` default to null. */
type CellInput = Omit<RawCoverageCell, 'land' | 'resortArea'> &
  Partial<Pick<RawCoverageCell, 'land' | 'resortArea'>>;

function cell(input: CellInput): RawCoverageCell {
  return { land: null, resortArea: null, ...input };
}

/**
 * Build a rich `StatsSnapshot` with populated coverage, facet, and rating
 * material so the "all other statistics unchanged" assertion (R7.9) exercises
 * the whole response, not just an empty shell. `percentile` defaults to null.
 */
function richSnapshot(percentile: PercentileInput | null): StatsSnapshot {
  const coverage: readonly CellInput[] = [
    {
      park: 'Magic Kingdom',
      category: 'Ride',
      areaType: 'ThemePark',
      isResortRepresentation: false,
      completed: 4,
      total: 10,
    },
    {
      park: 'EPCOT',
      category: 'Restaurant',
      areaType: 'ThemePark',
      isResortRepresentation: false,
      completed: 2,
      total: 5,
    },
    {
      park: null,
      category: 'Resort',
      areaType: 'Resort',
      isResortRepresentation: true,
      completed: 3,
      total: 8,
    },
  ];

  const thrill: GroupedFacetsDTO = {
    interests: [{ id: 'thrill', name: 'Thrill Rides' }],
  };
  const facetExperiences: readonly RawFacetExperienceRow[] = [
    { experienceId: 'e1', completedByUser: true, groupedFacets: thrill },
    { experienceId: 'e2', completedByUser: false, groupedFacets: thrill },
  ];

  // Four active ratings — at/above the Minimum_Ratings_Threshold (3) so the
  // rating statistics are "sufficient" and the payload is non-trivial.
  const userRatings: readonly RawUserRatingRow[] = [
    {
      experienceId: 'e1',
      experienceName: 'Space Mountain',
      value: 9,
      park: 'Magic Kingdom',
      category: 'Ride',
    },
    {
      experienceId: 'e2',
      experienceName: 'Big Thunder',
      value: 7,
      park: 'Magic Kingdom',
      category: 'Ride',
    },
    {
      experienceId: 'e3',
      experienceName: 'Spaceship Earth',
      value: 8,
      park: 'EPCOT',
      category: 'Ride',
    },
    {
      experienceId: 'e4',
      experienceName: 'Le Cellier',
      value: 6,
      park: 'EPCOT',
      category: 'Restaurant',
    },
  ];

  return {
    coverage: coverage.map(cell),
    facetExperiences,
    userRatings,
    resortCoverage: [],
    percentile,
  };
}

// ---------------------------------------------------------------------------
// Fake DB pool (no friendship / existence hops exercised on self-reads)
// ---------------------------------------------------------------------------

interface FakePoolCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

function makeFakePool(): {
  query: (text: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: unknown[] }>;
  calls: FakePoolCall[];
} {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      return { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake StatsRepo capturing the inputs it was called with
// ---------------------------------------------------------------------------

function makeFakeRepo(snapshotByUser: Map<string, StatsSnapshot>): {
  repo: StatsRepo;
  inputs: StatsSnapshotInput[];
} {
  const inputs: StatsSnapshotInput[] = [];
  return {
    inputs,
    repo: {
      async getStatsSnapshot(input: StatsSnapshotInput): Promise<StatsSnapshot> {
        inputs.push(input);
        const snapshot = snapshotByUser.get(input.targetUserId);
        if (!snapshot) {
          throw new Error(`unexpected getStatsSnapshot for ${input.targetUserId}`);
        }
        return snapshot;
      },
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

async function buildApp(
  repo: StatsRepo,
  pool: ReturnType<typeof makeFakePool>,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    statsRoutes({
      pool: pool as unknown as StatsRoutesOptions['pool'],
      repo,
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

const USER = 'user-self';

// ---------------------------------------------------------------------------
// R7.2 — percentile opt-in
// ---------------------------------------------------------------------------

describe('percentile opt-in (R7.2)', () => {
  it('omits percentileRank and reads no percentile material when not requested', async () => {
    const snapshot = richSnapshot(null);
    const { repo, inputs } = makeFakeRepo(new Map([[USER, snapshot]]));
    const pool = makeFakePool();
    const app = await buildApp(repo, pool);

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats',
      headers: { 'x-test-user-id': USER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;

    // The field is omitted entirely — neither the rank nor the failure flag.
    expect(body).not.toHaveProperty('percentileRank');
    expect(body).not.toHaveProperty('percentileUnavailable');

    // The repo was told NOT to read percentile material, so no percentile
    // query is issued and no percentile computation runs (R7.2).
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.includePercentile).toBe(false);

    await app.close();
  });

  it('reads percentile material and reports percentileRank when ?percentile=true', async () => {
    // 2 of 3 other trackers strictly below the target (5) → 66.7% (round-half-up).
    const snapshot = richSnapshot({ targetTotal: 5, otherTotals: [1, 2, 10] });
    const { repo, inputs } = makeFakeRepo(new Map([[USER, snapshot]]));
    const pool = makeFakePool();
    const app = await buildApp(repo, pool);

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats?percentile=true',
      headers: { 'x-test-user-id': USER },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;

    expect(body.percentileRank).toBe(66.7);
    expect(body).not.toHaveProperty('percentileUnavailable');

    // The repo was told to read percentile material (R7.2 opt-in).
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.includePercentile).toBe(true);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// R7.9 — percentile failure isolation
// ---------------------------------------------------------------------------

describe('percentile failure isolation (R7.9)', () => {
  it('omits percentileRank, flags percentileUnavailable, and leaves all other stats unchanged', async () => {
    // Percentile requested, but the snapshot succeeded WITHOUT percentile
    // material — the isolated-failure path. A second registration serves the
    // identical snapshot for the no-percentile baseline.
    const failSnapshot = richSnapshot(null);
    const baselineSnapshot = richSnapshot(null);
    const { repo } = makeFakeRepo(
      new Map([
        [USER, failSnapshot],
        ['user-baseline', baselineSnapshot],
      ]),
    );
    const pool = makeFakePool();
    const app = await buildApp(repo, pool);

    const failRes = await app.inject({
      method: 'GET',
      url: '/me/stats?percentile=true',
      headers: { 'x-test-user-id': USER },
    });
    const baselineRes = await app.inject({
      method: 'GET',
      url: '/me/stats',
      headers: { 'x-test-user-id': 'user-baseline' },
    });

    expect(failRes.statusCode).toBe(200);
    expect(baselineRes.statusCode).toBe(200);

    const failBody = failRes.json() as StatsResponse;
    const baselineBody = baselineRes.json() as StatsResponse;

    // The rank is omitted and the failure is flagged (R7.9).
    expect(failBody).not.toHaveProperty('percentileRank');
    expect(failBody.percentileUnavailable).toBe(true);

    // Every OTHER statistic is returned unchanged: the coverage dimensions and
    // the rating statistics match the no-percentile response exactly.
    expect(failBody.coverage).toEqual(baselineBody.coverage);
    expect(failBody.ratings).toEqual(baselineBody.ratings);

    // Sanity: the unchanged payload is genuinely non-trivial.
    expect(failBody.coverage.overall.completed).toBe(9);
    expect(failBody.coverage.overall.total).toBe(23);
    expect(failBody.coverage.resort.completed).toBe(3);
    expect(failBody.coverage.byFacetValue).toHaveLength(1);
    expect(failBody.ratings.sufficient).toBe(true);

    await app.close();
  });
});
