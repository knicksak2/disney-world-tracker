/**
 * Unit tests for the Stats_Service routes plugin (expanded-stats task 8.1).
 *
 * The plugin is registered against an in-process Fastify instance with a fake
 * `StatsRepo`, a fake DB pool, and a stub session pre-handler. No Postgres or
 * Redis traffic is involved.
 *
 * Coverage focuses on the wiring this task owns:
 *
 *   - `assembleResponse` folds the raw snapshot into the superset
 *     `StatsResponse` (nested `coverage`, `ratings`, optional percentile).
 *   - Every coverage dimension is a `CompletionCell`; empty groups report the
 *     zero-shape.
 *   - `GET /me/stats` reads the requester's own snapshot.
 *   - `GET /me/stats/summary?for=<userId>` accepts self and Friend reads and
 *     denies a non-Friend with `profile_forbidden` (R9.2), reading no stats.
 *   - `?percentile=true` opts into the Percentile_Rank (R7.2).
 *
 * The deeper property/integration coverage (friend parity, timeout/error
 * mapping, percentile failure isolation, performance) lives in the dedicated
 * task 8.2-8.6 suites.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  assembleResponse,
  statsRoutes,
  type StatsResponse,
  type StatsRoutesOptions,
} from '../routes.js';
import type { CompletionCell } from '../coverage.js';
import type { RawResortCoverageRow, ResortCoverage } from '../resorts.js';
import type {
  RawCoverageCell,
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

/** Build a `StatsSnapshot` whose only populated field is the coverage list. */
function snapshotOf(cells: readonly CellInput[]): StatsSnapshot {
  return {
    coverage: cells.map(cell),
    facetExperiences: [],
    userRatings: [],
    resortCoverage: [],
    percentile: null,
  };
}

/**
 * Build a `StatsSnapshot` carrying only per-resort raw counts, so the
 * `byResort` roll-up and its total-order sort can be asserted in isolation.
 */
function snapshotWithResorts(
  rows: readonly RawResortCoverageRow[],
): StatsSnapshot {
  return {
    coverage: [],
    facetExperiences: [],
    userRatings: [],
    resortCoverage: rows,
    percentile: null,
  };
}

/**
 * Sample per-resort raw rows exercising the total-order sort
 * (percent desc → total desc → case-insensitive label asc). Intentionally
 * supplied out of sorted order so the roll-up's sort is actually observed.
 */
const SAMPLE_RESORT_ROWS: readonly RawResortCoverageRow[] = [
  // 0.0% — sorts last.
  { resortId: 'r-all-star', label: 'All-Star', completed: 0, total: 4 },
  // 50.0%, total 6 — after the two total-10 rows on the total tiebreak.
  { resortId: 'r-beach', label: 'Beach Club', completed: 3, total: 6 },
  // 50.0%, total 10 — 'polynesian' loses the case-insensitive label tiebreak.
  { resortId: 'r-poly', label: 'Polynesian', completed: 5, total: 10 },
  // 44.4% — between the 50% cluster and 0%.
  { resortId: 'r-grand', label: 'Grand Floridian', completed: 4, total: 9 },
  // 50.0%, total 10 — 'contemporary' wins the case-insensitive label tiebreak.
  { resortId: 'r-contemp', label: 'Contemporary', completed: 5, total: 10 },
  // 100.0% — sorts first, complete badge set.
  { resortId: 'r-yacht', label: 'Yacht Club', completed: 7, total: 7 },
];

/** The expected `byResort` order for {@link SAMPLE_RESORT_ROWS}. */
const EXPECTED_RESORT_LABEL_ORDER: readonly string[] = [
  'Yacht Club', // 100.0%
  'Contemporary', // 50.0%, total 10, label tiebreak
  'Polynesian', // 50.0%, total 10
  'Beach Club', // 50.0%, total 6
  'Grand Floridian', // 44.4%
  'All-Star', // 0.0%
];

/** Assert a `byResort` list matches the expected shape and total-order sort. */
function expectSampleByResort(byResort: readonly ResortCoverage[]): void {
  expect(byResort.map((r) => r.label)).toEqual(EXPECTED_RESORT_LABEL_ORDER);

  // Every entry carries the { resortId, label, cell } shape with a well-formed cell.
  for (const entry of byResort) {
    expect(typeof entry.resortId).toBe('string');
    expect(typeof entry.label).toBe('string');
    expect(typeof entry.cell.completed).toBe('number');
    expect(typeof entry.cell.total).toBe('number');
    expect(typeof entry.cell.percent).toBe('number');
    expect(typeof entry.cell.remaining).toBe('number');
    expect(typeof entry.cell.completeBadge).toBe('boolean');
  }

  // Spot-check the extremes: the complete (100%) row and the empty-progress row.
  const yacht = byResort.find((r) => r.resortId === 'r-yacht');
  expect(yacht).toEqual({
    resortId: 'r-yacht',
    label: 'Yacht Club',
    cell: {
      completed: 7,
      total: 7,
      percent: 100,
      remaining: 0,
      completeBadge: true,
    },
  });

  const contemporary = byResort.find((r) => r.resortId === 'r-contemp');
  expect(contemporary).toEqual({
    resortId: 'r-contemp',
    label: 'Contemporary',
    cell: {
      completed: 5,
      total: 10,
      percent: 50,
      remaining: 5,
      completeBadge: false,
    },
  });
}

// ---------------------------------------------------------------------------
// Fake DB pool
// ---------------------------------------------------------------------------

interface FakePoolCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

interface FakePool {
  query: (text: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: unknown[] }>;
  calls: FakePoolCall[];
  responder: (call: FakePoolCall) => { rows: unknown[] };
}

function makeFakePool(
  responder: (call: FakePoolCall) => { rows: unknown[] },
): FakePool {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    responder,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      const call: FakePoolCall = { text, params };
      calls.push(call);
      return responder(call);
    },
  };
}

// ---------------------------------------------------------------------------
// Fake StatsRepo
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

async function buildApp(opts: {
  pool: FakePool;
  repo: StatsRepo;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    statsRoutes({
      pool: opts.pool as unknown as StatsRoutesOptions['pool'],
      repo: opts.repo,
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expectCell(
  actual: CompletionCell | undefined,
  completed: number,
  total: number,
  percent: number,
): void {
  expect(actual).toBeDefined();
  expect(actual!.completed).toBe(completed);
  expect(actual!.total).toBe(total);
  expect(actual!.percent).toBe(percent);
}

const ZERO_CELL: CompletionCell = {
  completed: 0,
  total: 0,
  percent: 0,
  remaining: 0,
  completeBadge: false,
};

// ---------------------------------------------------------------------------
// assembleResponse — pure roll-up
// ---------------------------------------------------------------------------

describe('assembleResponse — coverage roll-up', () => {
  it('produces the zero-cell for an empty snapshot in every Park/Category/AreaType bucket', () => {
    const response = assembleResponse(snapshotOf([]), false);

    expect(response.coverage.overall).toEqual(ZERO_CELL);
    for (const park of PARKS) {
      expect(response.coverage.byPark[park]).toEqual(ZERO_CELL);
    }
    for (const category of EXPERIENCE_CATEGORIES) {
      expect(response.coverage.byCategory[category]).toEqual(ZERO_CELL);
    }
    for (const area of AREA_TYPES) {
      expect(response.coverage.byAreaType[area]).toEqual(ZERO_CELL);
    }
    expect(response.coverage.resort).toEqual(ZERO_CELL);
    expect(response.coverage.byLand).toEqual([]);
    expect(response.coverage.byResortArea).toEqual([]);
    expect(response.coverage.byFacetValue).toEqual([]);

    // Ratings are insufficient with no rows; percentile omitted when not asked.
    expect(response.ratings.sufficient).toBe(false);
    expect(response.ratings.ratedCompletionsCount).toBe(0);
    expect(response).not.toHaveProperty('percentileRank');
    expect(response).not.toHaveProperty('percentileUnavailable');
  });

  it('rolls up overall, per-Park, per-Category, and per-AreaType dimensions correctly', () => {
    // Magic Kingdom Ride: 4/10 → 40.0%
    // Magic Kingdom Show: 1/2  → 50.0%
    // EPCOT Restaurant:    2/5  → 40.0%
    //
    // Overall: 7 / 17 → 41.2%
    // byPark.MK:    5 / 12 → 41.7%
    // byPark.EPCOT: 2 / 5  → 40.0%
    const response = assembleResponse(
      snapshotOf([
        {
          park: 'Magic Kingdom',
          category: 'Ride',
          areaType: 'ThemePark',
          isResortRepresentation: false,
          completed: 4,
          total: 10,
        },
        {
          park: 'Magic Kingdom',
          category: 'Show',
          areaType: 'ThemePark',
          isResortRepresentation: false,
          completed: 1,
          total: 2,
        },
        {
          park: 'EPCOT',
          category: 'Restaurant',
          areaType: 'ThemePark',
          isResortRepresentation: false,
          completed: 2,
          total: 5,
        },
      ]),
      false,
    );

    expectCell(response.coverage.overall, 7, 17, 41.2);
    expectCell(response.coverage.byPark['Magic Kingdom'], 5, 12, 41.7);
    expectCell(response.coverage.byPark['EPCOT'], 2, 5, 40);
    expect(response.coverage.byPark['Hollywood Studios']).toEqual(ZERO_CELL);

    expectCell(response.coverage.byCategory['Ride'], 4, 10, 40);
    expectCell(response.coverage.byCategory['Show'], 1, 2, 50);
    expectCell(response.coverage.byCategory['Restaurant'], 2, 5, 40);
    expect(response.coverage.byCategory['Parade']).toEqual(ZERO_CELL);

    expectCell(response.coverage.byAreaType['ThemePark'], 7, 17, 41.2);
  });

  it('caps every percentage at 100.0 even when a cell reports completed > total', () => {
    const response = assembleResponse(
      snapshotOf([
        {
          park: 'Magic Kingdom',
          category: 'Ride',
          areaType: 'ThemePark',
          isResortRepresentation: false,
          completed: 99,
          total: 10,
        },
      ]),
      false,
    );

    expect(response.coverage.overall.percent).toBe(100);
    expect(response.coverage.byPark['Magic Kingdom'].percent).toBe(100);
    expect(response.coverage.byCategory['Ride'].percent).toBe(100);
  });

  it('reports the Resort_Statistic from resort-representing rows, distinct from byAreaType.Resort', () => {
    const response = assembleResponse(
      snapshotOf([
        {
          park: null,
          category: 'Spa',
          areaType: 'Resort',
          isResortRepresentation: false,
          completed: 1,
          total: 2,
        },
        {
          park: null,
          category: 'Resort',
          areaType: 'Resort',
          isResortRepresentation: true,
          completed: 3,
          total: 8,
        },
      ]),
      false,
    );

    // resort counts only the representing row.
    expectCell(response.coverage.resort, 3, 8, 37.5);
    // byAreaType.Resort counts only the non-representing resort-area row.
    expectCell(response.coverage.byAreaType['Resort'], 1, 2, 50);
  });
});

// ---------------------------------------------------------------------------
// assembleResponse — byResort roll-up (R7.12)
// ---------------------------------------------------------------------------

describe('assembleResponse — byResort roll-up', () => {
  it('surfaces byResort in the coverage object as an empty list when no resort rows exist', () => {
    const response = assembleResponse(snapshotOf([]), false);
    expect(response.coverage).toHaveProperty('byResort');
    expect(response.coverage.byResort).toEqual([]);
  });

  it('folds raw resort rows into a sorted ResortCoverage[] (percent desc → total desc → ci-label asc)', () => {
    const response = assembleResponse(
      snapshotWithResorts(SAMPLE_RESORT_ROWS),
      false,
    );
    expectSampleByResort(response.coverage.byResort);
  });
});

// ---------------------------------------------------------------------------
// GET /me/stats — owner self-read
// ---------------------------------------------------------------------------

describe('GET /me/stats', () => {
  it('returns the requester own stats with computed cells (no percentile requested)', async () => {
    const snapshot = snapshotOf([
      {
        park: 'Magic Kingdom',
        category: 'Ride',
        areaType: 'ThemePark',
        isResortRepresentation: false,
        completed: 3,
        total: 10,
      },
    ]);
    const { repo, inputs } = makeFakeRepo(new Map([['user-self', snapshot]]));
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats',
      headers: { 'x-test-user-id': 'user-self' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expectCell(body.coverage.overall, 3, 10, 30);
    expectCell(body.coverage.byPark['Magic Kingdom'], 3, 10, 30);
    expectCell(body.coverage.byCategory['Ride'], 3, 10, 30);
    expect(body).not.toHaveProperty('percentileRank');

    // The repo was queried with the requester id and percentile off.
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.targetUserId).toBe('user-self');
    expect(inputs[0]!.includePercentile).toBe(false);
    // /me/stats does not need to consult friendships at all.
    expect(pool.calls).toHaveLength(0);
  });

  it('returns byResort in the coverage object, sorted, on GET /me/stats (R7.12)', async () => {
    const snapshot = snapshotWithResorts(SAMPLE_RESORT_ROWS);
    const { repo } = makeFakeRepo(new Map([['user-self', snapshot]]));
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats',
      headers: { 'x-test-user-id': 'user-self' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expect(body.coverage).toHaveProperty('byResort');
    expectSampleByResort(body.coverage.byResort);
  });

  it('requests the percentile read when ?percentile=true (R7.2)', async () => {
    const snapshot: StatsSnapshot = {
      ...snapshotOf([]),
      percentile: { targetTotal: 5, otherTotals: [1, 2, 10] },
    };
    const { repo, inputs } = makeFakeRepo(new Map([['user-self', snapshot]]));
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats?percentile=true',
      headers: { 'x-test-user-id': 'user-self' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    // 2 of 3 other trackers strictly below 5 → 66.7%
    expect(body.percentileRank).toBe(66.7);
    expect(body).not.toHaveProperty('percentileUnavailable');
    expect(inputs[0]!.includePercentile).toBe(true);
  });

  it('isolates a percentile failure: omits percentileRank, flags percentileUnavailable (R7.9)', () => {
    // Requested but the repo returned no percentile material.
    const response = assembleResponse(snapshotOf([]), true);
    expect(response).not.toHaveProperty('percentileRank');
    expect(response.percentileUnavailable).toBe(true);
    // The rest of the response is intact.
    expect(response.coverage.overall).toEqual(ZERO_CELL);
    expect(response.ratings.sufficient).toBe(false);
  });

  it('returns 401 unauthorized when the session pre-handler did not set userId', async () => {
    const { repo, inputs } = makeFakeRepo(new Map());
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({ method: 'GET', url: '/me/stats' });

    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'unauthorized',
    );
    expect(inputs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /me/stats/summary — owner-or-friend read
// ---------------------------------------------------------------------------

const VIEWER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

describe('GET /me/stats/summary?for=<userId>', () => {
  it('allows the owner to read their own stats without consulting friendships', async () => {
    const snapshot = snapshotOf([
      {
        park: 'EPCOT',
        category: 'Restaurant',
        areaType: 'ThemePark',
        isResortRepresentation: false,
        completed: 2,
        total: 4,
      },
    ]);
    const { repo, inputs } = makeFakeRepo(new Map([[VIEWER_ID, snapshot]]));
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${VIEWER_ID}`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expectCell(body.coverage.overall, 2, 4, 50);
    expectCell(body.coverage.byPark['EPCOT'], 2, 4, 50);

    // Self-view: no friendship lookup, no existence check.
    expect(pool.calls).toHaveLength(0);
    expect(inputs[0]!.targetUserId).toBe(VIEWER_ID);
  });

  it('returns byResort in the coverage object for a self read on the summary endpoint (R7.12)', async () => {
    // Prove the summary self-read surfaces byResort identically to GET /me/stats,
    // establishing the self side of the "self and friend structurally identical"
    // guarantee (both flow through the shared assembleResponse).
    const selfByResort = assembleResponse(
      snapshotWithResorts(SAMPLE_RESORT_ROWS),
      false,
    ).coverage.byResort;

    const snapshot = snapshotWithResorts(SAMPLE_RESORT_ROWS);
    const { repo, inputs } = makeFakeRepo(new Map([[VIEWER_ID, snapshot]]));
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${VIEWER_ID}`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expect(body.coverage).toHaveProperty('byResort');
    expectSampleByResort(body.coverage.byResort);
    expect(body.coverage.byResort).toEqual(selfByResort);

    // Self-view: no friendship lookup, target is the requester.
    expect(pool.calls).toHaveLength(0);
    expect(inputs[0]!.targetUserId).toBe(VIEWER_ID);
  });

  it('allows an accepted Friend to read the target stats (R9.1)', async () => {
    const snapshot = snapshotOf([
      {
        park: 'Animal Kingdom',
        category: 'Ride',
        areaType: 'ThemePark',
        isResortRepresentation: false,
        completed: 1,
        total: 5,
      },
    ]);
    const { repo, inputs } = makeFakeRepo(new Map([[TARGET_ID, snapshot]]));
    const pool = makeFakePool((call) => {
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: true }] };
      }
      return { rows: [] };
    });

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${TARGET_ID}`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expectCell(body.coverage.byPark['Animal Kingdom'], 1, 5, 20);

    // Friendship lookup ran with canonical (lo, hi) = (VIEWER, TARGET).
    const friendCall = pool.calls.find((c) =>
      c.text.includes('FROM friendships'),
    );
    expect(friendCall?.params).toEqual([VIEWER_ID, TARGET_ID]);
    // A Friend implies existence, so no existence check is issued.
    expect(
      pool.calls.find((c) => c.text.includes('FROM users')),
    ).toBeUndefined();
    // The repo was called with the TARGET's id.
    expect(inputs[0]!.targetUserId).toBe(TARGET_ID);
  });

  it('returns byResort in the coverage object for a Friend read, structurally identical to self (R7.12, R9.1)', async () => {
    const rows = SAMPLE_RESORT_ROWS;
    // Self read of the same rows, to prove the friend response is structurally
    // identical (both flow through the shared assembleResponse).
    const selfByResort = assembleResponse(
      snapshotWithResorts(rows),
      false,
    ).coverage.byResort;

    const snapshot = snapshotWithResorts(rows);
    const { repo, inputs } = makeFakeRepo(new Map([[TARGET_ID, snapshot]]));
    const pool = makeFakePool((call) => {
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: true }] };
      }
      return { rows: [] };
    });

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${TARGET_ID}`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expect(body.coverage).toHaveProperty('byResort');
    expectSampleByResort(body.coverage.byResort);
    // The friend read is byte-identical to the self read for the same snapshot.
    expect(body.coverage.byResort).toEqual(selfByResort);
    expect(inputs[0]!.targetUserId).toBe(TARGET_ID);
  });

  it('denies a non-Friend of an existing target with profile_forbidden and reads no stats (R9.2)', async () => {
    const { repo, inputs } = makeFakeRepo(new Map());
    const pool = makeFakePool((call) => {
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: false }] };
      }
      if (call.text.includes('FROM users')) {
        // The target user exists; the requester is simply not a Friend.
        return { rows: [{ exists: true }] };
      }
      return { rows: [] };
    });

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${TARGET_ID}`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'profile_forbidden',
    );
    // The stats snapshot was never read on the deny path.
    expect(inputs).toEqual([]);
  });

  it('denies a request for a non-existent target with stats_target_not_found (R9.6)', async () => {
    const { repo, inputs } = makeFakeRepo(new Map());
    const pool = makeFakePool((call) => {
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: false }] };
      }
      if (call.text.includes('FROM users')) {
        // No such user.
        return { rows: [{ exists: false }] };
      }
      return { rows: [] };
    });

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${TARGET_ID}`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'stats_target_not_found',
    );
    expect(inputs).toEqual([]);
  });

  it('returns 400 validation_failed when the for= query parameter is missing', async () => {
    const { repo, inputs } = makeFakeRepo(new Map());
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats/summary',
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
    expect(pool.calls).toHaveLength(0);
    expect(inputs).toEqual([]);
  });

  it('returns 400 validation_failed when for= is not a UUID', async () => {
    const { repo } = makeFakeRepo(new Map());
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats/summary?for=not-a-uuid',
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
  });

  it('returns 401 unauthorized when the session pre-handler did not set userId', async () => {
    const { repo } = makeFakeRepo(new Map());
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${TARGET_ID}`,
    });

    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'unauthorized',
    );
  });
});

// ---------------------------------------------------------------------------
// Response shape covers every Park, Category, and AreaType
// ---------------------------------------------------------------------------

describe('Response shape covers every enum dimension', () => {
  it('exposes coverage.byPark/byCategory/byAreaType with every enum member', () => {
    const response = assembleResponse(snapshotOf([]), false);
    expect(new Set(Object.keys(response.coverage.byPark))).toEqual(
      new Set(PARKS),
    );
    expect(new Set(Object.keys(response.coverage.byCategory))).toEqual(
      new Set(EXPERIENCE_CATEGORIES),
    );
    expect(new Set(Object.keys(response.coverage.byAreaType))).toEqual(
      new Set(AREA_TYPES),
    );
  });
});
