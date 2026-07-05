/**
 * Integration tests for Stats_Service authorization and target resolution
 * (expanded-stats task 8.3).
 *
 * These tests drive the real `statsRoutes` plugin through an in-process
 * Fastify instance with the real error handler, exercising the
 * `GET /me/stats/summary?for=<userId>` authorization + target-resolution path
 * end to end. Only the two injected leaf dependencies are faked: the `DbPool`
 * (whose single friendship lookup and existence read `authorizeTarget` issues)
 * and the `StatsRepo` (whose snapshot read must never run on a deny path).
 *
 * The behaviors under test map directly to Requirement 9:
 *
 *   - **R9.1 (owner-or-friend allowed)**: the owner (self) and an accepted
 *     Friend both receive a full `StatsResponse` for the target.
 *   - **R9.2 (non-Friend denied)**: a requester who is neither the target nor a
 *     Friend of an existing target is denied with `profile_forbidden`, and the
 *     target's statistics are never read.
 *   - **R9.3 (no analytics on deny)**: the deny path records no viewing-attempt
 *     event — the only DB traffic is the read-only friendship lookup and the
 *     existence check; no write / analytics / audit / telemetry statement runs,
 *     and the request logger emits no analytics-tagged event.
 *   - **R9.6 (non-existent target)**: a request for a target user id that does
 *     not exist is denied with `stats_target_not_found`, reading no statistics.
 *
 * _Validates: Requirements 9.2, 9.3, 9.6 (and R9.1 for the allowed paths)._
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { AREA_TYPES } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  statsRoutes,
  type StatsResponse,
  type StatsRoutesOptions,
} from '../routes.js';
import type {
  StatsRepo,
  StatsSnapshot,
  StatsSnapshotInput,
} from '../repo.js';

// Canonical pair invariant: VIEWER_ID < TARGET_ID lexicographically, so the
// friendship lookup runs with (lo, hi) = (VIEWER_ID, TARGET_ID).
const VIEWER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

// ---------------------------------------------------------------------------
// Fake DB pool — records every statement so tests can assert exactly which
// lookups ran and that no write / analytics statement occurred on deny.
// ---------------------------------------------------------------------------

interface FakePoolCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

interface FakePool {
  query: (
    text: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: unknown[] }>;
  calls: FakePoolCall[];
}

/**
 * Build a fake pool. `areFriends` controls whether the canonical friendship
 * pair is present; `targetExists` controls the existence check used only on
 * the deny path to distinguish `profile_forbidden` (R9.2) from
 * `stats_target_not_found` (R9.6).
 */
function makeFakePool(
  areFriends: boolean,
  targetExists = true,
): FakePool {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      calls.push({ text, params });
      if (text.includes('FROM friendships')) {
        return { rows: [{ exists: areFriends }] };
      }
      if (text.includes('FROM users')) {
        return { rows: [{ exists: targetExists }] };
      }
      return { rows: [] };
    },
  };
}

/**
 * Statement patterns that would indicate a mutation or a viewing-attempt
 * analytics/audit/telemetry write. The deny path (R9.3) must issue none of
 * these — every statement it runs must be a read-only SELECT.
 */
const WRITE_OR_ANALYTICS_PATTERNS: readonly RegExp[] = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bUPSERT\b/i,
  /analytics/i,
  /audit/i,
  /telemetry/i,
  /\bevent\b/i,
];

function assertNoWriteOrAnalytics(calls: readonly FakePoolCall[]): void {
  for (const call of calls) {
    for (const pattern of WRITE_OR_ANALYTICS_PATTERNS) {
      expect(
        pattern.test(call.text),
        `unexpected write/analytics statement matched ${pattern}: ${call.text}`,
      ).toBe(false);
    }
  }
}

// ---------------------------------------------------------------------------
// Fake StatsRepo — records every target id it was asked about so a deny path
// can be proven to have read no statistics.
// ---------------------------------------------------------------------------

interface FakeRepo {
  repo: StatsRepo;
  callsForUser: string[];
}

function makeFakeRepo(snapshotByUser: Map<string, StatsSnapshot>): FakeRepo {
  const callsForUser: string[] = [];
  return {
    callsForUser,
    repo: {
      async getStatsSnapshot(
        input: StatsSnapshotInput,
      ): Promise<StatsSnapshot> {
        callsForUser.push(input.targetUserId);
        const snapshot = snapshotByUser.get(input.targetUserId);
        if (!snapshot) {
          throw new Error(
            `unexpected getStatsSnapshot for ${input.targetUserId}`,
          );
        }
        return snapshot;
      },
    },
  };
}

/** An empty-but-valid snapshot (no coverage rows, ratings, or percentile). */
function emptySnapshot(): StatsSnapshot {
  return {
    coverage: [],
    facetExperiences: [],
    userRatings: [],
    resortCoverage: [],
    percentile: null,
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
// Test app builder with a captured logger so we can assert no analytics event
// is logged on the deny path (R9.3).
// ---------------------------------------------------------------------------

type LogSpy = ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;

interface LogSpies {
  info: LogSpy;
  debug: LogSpy;
}

async function buildApp(opts: {
  pool: FakePool;
  repo: StatsRepo;
}): Promise<{ app: FastifyInstance; logs: LogSpies }> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  // Capture request-scoped info/debug logs. The global error hook emits one
  // info line for a rejected domain error (operational logging of the error
  // response, carrying only the error code) — that is permitted. What R9.3
  // forbids is a *viewing-attempt* analytics record, which we detect by an
  // `event` tag on any captured log payload.
  const logs: LogSpies = {
    info: vi.fn<(...args: unknown[]) => void>(),
    debug: vi.fn<(...args: unknown[]) => void>(),
  };
  app.addHook('onRequest', async (request) => {
    const original = request.log;
    request.log = {
      ...original,
      info: (...args: unknown[]) => {
        logs.info(...args);
        return undefined as unknown as void;
      },
      debug: (...args: unknown[]) => {
        logs.debug(...args);
        return undefined as unknown as void;
      },
    } as typeof request.log;
  });

  await app.register(
    statsRoutes({
      pool: opts.pool as unknown as StatsRoutesOptions['pool'],
      repo: opts.repo,
      requireSession,
    }),
  );
  await app.ready();
  return { app, logs };
}

/** Assert no captured log payload carries a viewing-attempt `event` tag. */
function assertNoAnalyticsEventLogged(logs: LogSpies): void {
  for (const spy of [logs.info, logs.debug]) {
    for (const call of spy.mock.calls) {
      for (const arg of call) {
        if (typeof arg === 'object' && arg !== null && 'event' in arg) {
          expect(
            (arg as { event: unknown }).event,
            'a viewing-attempt analytics event was logged on the deny path',
          ).toBeUndefined();
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// R9.1 — owner-or-friend allowed
// ---------------------------------------------------------------------------

describe('stats authorization — owner-or-friend allowed (R9.1)', () => {
  it('allows the owner to read their own summary and returns a full response', async () => {
    const { repo, callsForUser } = makeFakeRepo(
      new Map([[VIEWER_ID, emptySnapshot()]]),
    );
    const pool = makeFakePool(false); // no friendship needed for self
    const { app } = await buildApp({ pool, repo });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${VIEWER_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as StatsResponse;
      expect(new Set(Object.keys(body.coverage.byAreaType))).toEqual(
        new Set(AREA_TYPES),
      );
      expect(body.ratings).toBeDefined();

      // Self-read: no friendship lookup, no existence check; the requester's
      // own snapshot is read.
      expect(pool.calls).toHaveLength(0);
      expect(callsForUser).toEqual([VIEWER_ID]);
    } finally {
      await app.close();
    }
  });

  it('allows an accepted Friend to read the target summary (R9.1)', async () => {
    const { repo, callsForUser } = makeFakeRepo(
      new Map([[TARGET_ID, emptySnapshot()]]),
    );
    const pool = makeFakePool(true); // canonical pair present
    const { app } = await buildApp({ pool, repo });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${TARGET_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as StatsResponse;
      expect(new Set(Object.keys(body.coverage.byAreaType))).toEqual(
        new Set(AREA_TYPES),
      );

      // The friendship lookup ran exactly once with the canonical (lo, hi)
      // pair; a Friend implies existence, so no existence check is issued.
      const friendCalls = pool.calls.filter((c) =>
        c.text.includes('FROM friendships'),
      );
      expect(friendCalls).toHaveLength(1);
      expect(friendCalls[0]!.params).toEqual([VIEWER_ID, TARGET_ID]);
      expect(
        pool.calls.find((c) => c.text.includes('FROM users')),
      ).toBeUndefined();

      // The target's snapshot (not the requester's) was read.
      expect(callsForUser).toEqual([TARGET_ID]);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// R9.2 / R9.3 — non-Friend denied, no stats read, no analytics event
// ---------------------------------------------------------------------------

describe('stats authorization — non-Friend denied (R9.2, R9.3)', () => {
  it('denies a non-Friend of an existing target with profile_forbidden, reads no stats, and records no analytics event', async () => {
    const { repo, callsForUser } = makeFakeRepo(new Map());
    const pool = makeFakePool(false, true); // not friends, target exists
    const { app, logs } = await buildApp({ pool, repo });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${TARGET_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      // R9.2: denied with an authorization error and no statistics.
      expect(res.statusCode).toBe(403);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('profile_forbidden');
      expect(body).not.toHaveProperty('coverage');
      expect(body).not.toHaveProperty('ratings');

      // R9.2: the target's statistics were never read.
      expect(callsForUser).toEqual([]);

      // The only DB traffic is the friendship lookup + the existence read used
      // to distinguish 403 from 404 — exactly two read-only SELECTs.
      const friendCalls = pool.calls.filter((c) =>
        c.text.includes('FROM friendships'),
      );
      const existenceCalls = pool.calls.filter((c) =>
        c.text.includes('FROM users'),
      );
      expect(friendCalls).toHaveLength(1);
      expect(friendCalls[0]!.params).toEqual([VIEWER_ID, TARGET_ID]);
      expect(existenceCalls).toHaveLength(1);
      expect(pool.calls).toHaveLength(2);

      // R9.3: no viewing-attempt write of any kind occurred.
      assertNoWriteOrAnalytics(pool.calls);
      assertNoAnalyticsEventLogged(logs);
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// R9.6 — non-existent target
// ---------------------------------------------------------------------------

describe('stats authorization — non-existent target (R9.6)', () => {
  it('denies a request for a non-existent target with stats_target_not_found and reads no stats', async () => {
    const { repo, callsForUser } = makeFakeRepo(new Map());
    const pool = makeFakePool(false, false); // not friends, target absent
    const { app, logs } = await buildApp({ pool, repo });

    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${TARGET_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      // R9.6: denied with a not-found error and no statistics.
      expect(res.statusCode).toBe(404);
      const body = res.json() as { error: { code: string } };
      expect(body.error.code).toBe('stats_target_not_found');
      expect(body).not.toHaveProperty('coverage');
      expect(body).not.toHaveProperty('ratings');

      // R9.6: no statistics were read.
      expect(callsForUser).toEqual([]);

      // The friendship lookup denied, then a single existence check resolved
      // the target as absent → not-found. No write/analytics statement ran.
      expect(
        pool.calls.filter((c) => c.text.includes('FROM friendships')),
      ).toHaveLength(1);
      expect(
        pool.calls.filter((c) => c.text.includes('FROM users')),
      ).toHaveLength(1);
      assertNoWriteOrAnalytics(pool.calls);
      assertNoAnalyticsEventLogged(logs);
    } finally {
      await app.close();
    }
  });
});
