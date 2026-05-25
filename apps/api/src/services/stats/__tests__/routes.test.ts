/**
 * Unit tests for the Stats_Service routes plugin (task 11.1).
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake `StatsRepo`, a fake DB pool, and a stub session pre-handler. No
 * Postgres or Redis traffic is involved.
 *
 * Coverage focuses on the requirements scoped to this task:
 *
 *   - R3.1, R3.2, R3.3 — overall, byPark, byCategory percentages are
 *     produced by `computePercent` from the snapshot's counts.
 *   - R3.4              — the response carries `completed`, `total`,
 *                         and `percent` for every dimension.
 *   - R3.6, R3.7        — Park/Category buckets with no active
 *                         Experience report `0/0/0.0`.
 *   - R3.8              — every reported percent is in `[0.0, 100.0]`,
 *                         enforced by `computePercent`.
 *   - R7.4              — `/me/stats/summary?for=<userId>` accepts
 *                         self-reads and reads from accepted Friends.
 *   - R7.4 (deny path)  — non-friend read returns `profile_forbidden`.
 *
 * Notes on what is NOT tested here (covered elsewhere or out of scope):
 *
 *   - The `REPEATABLE READ` snapshot semantics live in `repo.ts`; the
 *     route layer is agnostic to whether it is reading a snapshot or a
 *     plain pair of queries.
 *   - The single-line analytics-on-deny rule (R7.8 reuse) is asserted
 *     in the auth/profileRoutes test suite for the `GET /users/:id/profile`
 *     endpoint that shares the same gate; we re-assert here only that
 *     no DB call beyond the friendship lookup runs on the deny path.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  buildResponse,
  statsRoutes,
  type StatsBreakdown,
  type StatsResponse,
  type StatsRoutesOptions,
} from '../routes.js';
import type { StatsCell, StatsRepo, StatsSnapshot } from '../repo.js';

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
  callsForUser: string[];
} {
  const callsForUser: string[] = [];
  return {
    callsForUser,
    repo: {
      async getStatsSnapshot(userId: string): Promise<StatsSnapshot> {
        callsForUser.push(userId);
        const snapshot = snapshotByUser.get(userId);
        if (!snapshot) {
          throw new Error(`unexpected getStatsSnapshot for ${userId}`);
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

/**
 * Build a synthetic snapshot with one cell. Most tests only need to drive
 * a small part of the (Park × Category) grid.
 */
function snapshotOf(cells: readonly StatsCell[]): StatsSnapshot {
  return { cells };
}

function expectBreakdown(
  actual: StatsBreakdown | undefined,
  completed: number,
  total: number,
  percent: number,
): void {
  expect(actual).toBeDefined();
  expect(actual!.completed).toBe(completed);
  expect(actual!.total).toBe(total);
  expect(actual!.percent).toBe(percent);
}

// ---------------------------------------------------------------------------
// buildResponse — pure roll-up
// ---------------------------------------------------------------------------

describe('buildResponse — roll-up of snapshot cells (R3.1, R3.2, R3.3, R3.6, R3.7, R3.8)', () => {
  it('produces zero/zero/0.0 for an empty snapshot in every Park/Category bucket', () => {
    const response = buildResponse(snapshotOf([]));

    expect(response.overall).toEqual({ completed: 0, total: 0, percent: 0 });
    for (const park of PARKS) {
      expectBreakdown(response.byPark[park], 0, 0, 0);
      for (const category of EXPERIENCE_CATEGORIES) {
        expectBreakdown(response.byParkAndCategory[park][category], 0, 0, 0);
      }
    }
    for (const category of EXPERIENCE_CATEGORIES) {
      expectBreakdown(response.byCategory[category], 0, 0, 0);
    }
  });

  it('rolls up overall, per-Park, per-Category, and per-Park-and-Category dimensions correctly', () => {
    // Construct a small grid:
    //   Magic Kingdom Ride: 4/10 → 40.0%
    //   Magic Kingdom Show: 1/2  → 50.0%
    //   EPCOT Restaurant:    2/5  → 40.0%
    //
    // Overall: 7 / 17 → 41.176... → 41.2%
    // byPark.MK:    5 / 12 → 41.666... → 41.7%
    // byPark.EPCOT: 2 / 5  → 40.0%
    // byCategory.Ride: 4 / 10 → 40.0%
    // byCategory.Show: 1 / 2 → 50.0%
    // byCategory.Restaurant: 2 / 5 → 40.0%
    const cells: StatsCell[] = [
      { park: 'Magic Kingdom', category: 'Ride', completed: 4, total: 10 },
      { park: 'Magic Kingdom', category: 'Show', completed: 1, total: 2 },
      { park: 'EPCOT', category: 'Restaurant', completed: 2, total: 5 },
    ];

    const response = buildResponse(snapshotOf(cells));

    // Overall
    expect(response.overall).toEqual({ completed: 7, total: 17, percent: 41.2 });

    // By Park
    expectBreakdown(response.byPark['Magic Kingdom'], 5, 12, 41.7);
    expectBreakdown(response.byPark['EPCOT'], 2, 5, 40);
    expectBreakdown(response.byPark['Hollywood Studios'], 0, 0, 0);
    expectBreakdown(response.byPark['Disney Springs'], 0, 0, 0);

    // By Category
    expectBreakdown(response.byCategory['Ride'], 4, 10, 40);
    expectBreakdown(response.byCategory['Show'], 1, 2, 50);
    expectBreakdown(response.byCategory['Restaurant'], 2, 5, 40);
    expectBreakdown(response.byCategory['Parade'], 0, 0, 0);
    expectBreakdown(response.byCategory['Character_Meet'], 0, 0, 0);
    expectBreakdown(response.byCategory['Other'], 0, 0, 0);

    // By Park and Category
    expectBreakdown(
      response.byParkAndCategory['Magic Kingdom']['Ride'],
      4,
      10,
      40,
    );
    expectBreakdown(
      response.byParkAndCategory['Magic Kingdom']['Show'],
      1,
      2,
      50,
    );
    expectBreakdown(
      response.byParkAndCategory['Magic Kingdom']['Restaurant'],
      0,
      0,
      0,
    );
    expectBreakdown(
      response.byParkAndCategory['EPCOT']['Restaurant'],
      2,
      5,
      40,
    );
  });

  it('caps every percentage at 100.0 even when a cell reports completed > total (R3.8)', () => {
    // This shouldn't happen in practice (the snapshot reads numerator and
    // denominator atomically) but the route must remain safe regardless.
    const cells: StatsCell[] = [
      { park: 'Magic Kingdom', category: 'Ride', completed: 99, total: 10 },
    ];
    const response = buildResponse(snapshotOf(cells));

    expect(response.overall.percent).toBe(100);
    expect(response.byPark['Magic Kingdom'].percent).toBe(100);
    expect(response.byCategory['Ride'].percent).toBe(100);
    expect(response.byParkAndCategory['Magic Kingdom']['Ride'].percent).toBe(100);
  });

  it('every reported percent is within [0, 100]', () => {
    const cells: StatsCell[] = [];
    for (const park of PARKS) {
      for (const category of EXPERIENCE_CATEGORIES) {
        cells.push({ park, category, completed: 1, total: 3 });
      }
    }
    const response = buildResponse(snapshotOf(cells));

    const checkPercent = (b: StatsBreakdown): void => {
      expect(b.percent).toBeGreaterThanOrEqual(0);
      expect(b.percent).toBeLessThanOrEqual(100);
    };

    checkPercent(response.overall);
    for (const park of PARKS) {
      checkPercent(response.byPark[park]);
      for (const category of EXPERIENCE_CATEGORIES) {
        checkPercent(response.byParkAndCategory[park][category]);
      }
    }
    for (const category of EXPERIENCE_CATEGORIES) {
      checkPercent(response.byCategory[category]);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /me/stats — owner self-read
// ---------------------------------------------------------------------------

describe('GET /me/stats', () => {
  it('returns the requester own stats with computed percentages (R3.1-R3.4)', async () => {
    const snapshot: StatsSnapshot = {
      cells: [
        { park: 'Magic Kingdom', category: 'Ride', completed: 3, total: 10 },
      ],
    };
    const { repo, callsForUser } = makeFakeRepo(
      new Map([['user-self', snapshot]]),
    );
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: '/me/stats',
      headers: { 'x-test-user-id': 'user-self' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expectBreakdown(body.overall, 3, 10, 30);
    expectBreakdown(body.byPark['Magic Kingdom'], 3, 10, 30);
    expectBreakdown(body.byCategory['Ride'], 3, 10, 30);
    expectBreakdown(body.byParkAndCategory['Magic Kingdom']['Ride'], 3, 10, 30);

    // The repo was queried with the requester id.
    expect(callsForUser).toEqual(['user-self']);
    // /me/stats does not need to consult friendships at all.
    expect(pool.calls).toHaveLength(0);
  });

  it('returns 401 unauthorized when the session pre-handler did not set userId', async () => {
    const { repo, callsForUser } = makeFakeRepo(new Map());
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({ method: 'GET', url: '/me/stats' });

    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'unauthorized',
    );
    // No repo call is made on the unauthenticated path.
    expect(callsForUser).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /me/stats/summary — owner-or-friend read
// ---------------------------------------------------------------------------

const VIEWER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

describe('GET /me/stats/summary?for=<userId>', () => {
  it('allows the owner to read their own stats without consulting friendships', async () => {
    const snapshot: StatsSnapshot = {
      cells: [
        { park: 'EPCOT', category: 'Restaurant', completed: 2, total: 4 },
      ],
    };
    const { repo, callsForUser } = makeFakeRepo(
      new Map([[VIEWER_ID, snapshot]]),
    );
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/me/stats/summary?for=${VIEWER_ID}`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as StatsResponse;
    expectBreakdown(body.overall, 2, 4, 50);
    expectBreakdown(body.byPark['EPCOT'], 2, 4, 50);

    // Self-view: no friendship lookup.
    expect(
      pool.calls.find((c) => c.text.includes('FROM friendships')),
    ).toBeUndefined();
    expect(callsForUser).toEqual([VIEWER_ID]);
  });

  it('allows an accepted Friend to read the target stats (R7.4)', async () => {
    const snapshot: StatsSnapshot = {
      cells: [
        { park: 'Animal Kingdom', category: 'Ride', completed: 1, total: 5 },
      ],
    };
    const { repo, callsForUser } = makeFakeRepo(
      new Map([[TARGET_ID, snapshot]]),
    );
    // VIEWER < TARGET lexicographically → canonical pair (VIEWER, TARGET).
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
    expectBreakdown(body.byPark['Animal Kingdom'], 1, 5, 20);

    // Friendship lookup ran with canonical (lo, hi) = (VIEWER, TARGET).
    const friendCall = pool.calls.find((c) =>
      c.text.includes('FROM friendships'),
    );
    expect(friendCall?.params).toEqual([VIEWER_ID, TARGET_ID]);

    // The repo was called with the TARGET's id, not the viewer's.
    expect(callsForUser).toEqual([TARGET_ID]);
  });

  it('denies a non-friend with profile_forbidden and does not read the target stats', async () => {
    const { repo, callsForUser } = makeFakeRepo(new Map());
    const pool = makeFakePool((call) => {
      if (call.text.includes('FROM friendships')) {
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

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'profile_forbidden',
    );

    // The friendship lookup ran exactly once.
    expect(
      pool.calls.filter((c) => c.text.includes('FROM friendships')),
    ).toHaveLength(1);
    // The repo was NOT consulted for the target on the deny path —
    // no stats were read for the unauthorized user.
    expect(callsForUser).toEqual([]);
  });

  it('returns 400 validation_failed when the for= query parameter is missing', async () => {
    const { repo, callsForUser } = makeFakeRepo(new Map());
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
    // No friendship lookup, no repo call.
    expect(pool.calls).toHaveLength(0);
    expect(callsForUser).toEqual([]);
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
// Type assertion: the response keys cover every Park and Category
// ---------------------------------------------------------------------------

describe('Response shape covers every Park and Category', () => {
  it('exposes byPark with every Park enum member and byCategory with every Category enum member', () => {
    const response = buildResponse(snapshotOf([]));
    const parkKeys = Object.keys(response.byPark) as Park[];
    const categoryKeys = Object.keys(response.byCategory) as ExperienceCategory[];

    expect(new Set(parkKeys)).toEqual(new Set(PARKS));
    expect(new Set(categoryKeys)).toEqual(new Set(EXPERIENCE_CATEGORIES));

    // byParkAndCategory has the same coverage on both axes.
    for (const park of PARKS) {
      const sub = response.byParkAndCategory[park];
      expect(new Set(Object.keys(sub))).toEqual(new Set(EXPERIENCE_CATEGORIES));
    }
  });
});
