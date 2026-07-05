/**
 * Integration tests for Stats_Service timeout and transaction-failure error
 * mapping (expanded-stats task 8.5).
 *
 * These tests exercise the route's `loadSnapshot` error mapping end-to-end
 * through an in-process Fastify instance registered with the real
 * `statsRoutes` plugin, a fake `StatsRepo` that injects the failure, a fake DB
 * pool, and a stub session pre-handler. No Postgres or Redis traffic is
 * involved — the failures are injected at the repo boundary exactly as the
 * live repo would surface them.
 *
 * Assertions (design "Snapshot loading + error mapping", routes.ts):
 *
 *   1. A forced statement-timeout — the `pg` driver rejecting with SQLSTATE
 *      `57014` (a statement cancelled by the per-request `statement_timeout`)
 *      — maps to the `stats_timeout` error code (HTTP 504) and returns NO
 *      partial per-user statistics. The overrun aborts within the request
 *      rather than streaming partial data (R7.8, R11.3).
 *   2. A transaction failure — a failed `BEGIN`/`COMMIT` or a rejected query,
 *      i.e. any non-timeout error propagating from the snapshot read — maps to
 *      the `stats_unavailable` error code (HTTP 503) and returns NO partial or
 *      precomputed per-user statistics (R8.6).
 *
 * In both cases the response body is the uniform error envelope only; it
 * carries none of the `coverage` / `ratings` / `percentileRank` fields a
 * successful `StatsResponse` would.
 *
 * Validates: Requirements 7.8, 8.6, 11.3.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../../errors/handler.js';
import { statsRoutes, type StatsRoutesOptions } from '../routes.js';
import type { StatsRepo, StatsSnapshotInput } from '../repo.js';

// ---------------------------------------------------------------------------
// Postgres SQLSTATE for a statement cancelled by `statement_timeout`.
// Matches the constant the route uses to detect a timeout.
// ---------------------------------------------------------------------------

const PG_QUERY_CANCELED = '57014';

/** A `pg`-shaped error carrying a SQLSTATE `code`, as the driver surfaces it. */
class PgError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'PgError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Fake StatsRepo that injects a failure
// ---------------------------------------------------------------------------

/**
 * Build a repo whose `getStatsSnapshot` always rejects with `failure`, and
 * records every input it was called with so tests can assert the read was
 * attempted (i.e. the error mapping is exercised, not short-circuited before
 * the snapshot read).
 */
function makeFailingRepo(failure: unknown): {
  repo: StatsRepo;
  inputs: StatsSnapshotInput[];
} {
  const inputs: StatsSnapshotInput[] = [];
  return {
    inputs,
    repo: {
      async getStatsSnapshot(input: StatsSnapshotInput) {
        inputs.push(input);
        throw failure;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fake DB pool (only used by the friend-view authorization path)
// ---------------------------------------------------------------------------

interface FakePoolCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

function makeFakePool(
  responder: (call: FakePoolCall) => { rows: unknown[] },
): {
  query: (
    text: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: unknown[] }>;
  calls: FakePoolCall[];
} {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      const call: FakePoolCall = { text, params };
      calls.push(call);
      return responder(call);
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
  repo: StatsRepo;
  pool?: ReturnType<typeof makeFakePool>;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const pool = opts.pool ?? makeFakePool(() => ({ rows: [] }));
  await app.register(
    statsRoutes({
      pool: pool as unknown as StatsRoutesOptions['pool'],
      repo: opts.repo,
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

/**
 * Assert that a response body is the uniform error envelope carrying only the
 * expected code and no leaked per-user statistics (R7.8/R8.6/R11.3: no partial
 * data). A successful `StatsResponse` would carry `coverage`/`ratings`; an
 * error envelope must not.
 */
function expectErrorEnvelopeOnly(body: unknown, code: string): void {
  expect(body).toHaveProperty('error');
  const envelope = body as { error: { code: string }; [k: string]: unknown };
  expect(envelope.error.code).toBe(code);
  expect(envelope).not.toHaveProperty('coverage');
  expect(envelope).not.toHaveProperty('ratings');
  expect(envelope).not.toHaveProperty('percentileRank');
  expect(envelope).not.toHaveProperty('percentileUnavailable');
}

const VIEWER_ID = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// Timeout mapping (R7.8, R11.3)
// ---------------------------------------------------------------------------

describe('Stats routes — statement-timeout mapping (R7.8, R11.3)', () => {
  it('maps a SQLSTATE 57014 statement-timeout on GET /me/stats to stats_timeout (504) with no partial data', async () => {
    const timeout = new PgError(
      PG_QUERY_CANCELED,
      'canceling statement due to statement timeout',
    );
    const { repo, inputs } = makeFailingRepo(timeout);

    const app = await buildApp({ repo });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/me/stats',
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      // R11.3: the overrun aborts the request (504) rather than emitting
      // partial statistics.
      expect(res.statusCode).toBe(504);
      expectErrorEnvelopeOnly(res.json(), 'stats_timeout');

      // The snapshot read was attempted (the timeout came from the read path),
      // so the timeout mapping — not an earlier short-circuit — was exercised.
      expect(inputs).toHaveLength(1);
      expect(inputs[0]!.targetUserId).toBe(VIEWER_ID);
    } finally {
      await app.close();
    }
  });

  it('maps a SQLSTATE 57014 timeout on the percentile path to stats_timeout with no partial data', async () => {
    const timeout = new PgError(
      PG_QUERY_CANCELED,
      'canceling statement due to statement timeout',
    );
    const { repo, inputs } = makeFailingRepo(timeout);

    const app = await buildApp({ repo });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/me/stats?percentile=true',
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(504);
      expectErrorEnvelopeOnly(res.json(), 'stats_timeout');
      // A timeout while computing the percentile is a whole-request abort, NOT
      // the isolated percentileUnavailable path (which only applies when the
      // rest of the snapshot succeeded).
      expect(res.json()).not.toHaveProperty('percentileUnavailable');
      expect(inputs[0]!.includePercentile).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('maps a statement timeout on the friend-view summary endpoint to stats_timeout', async () => {
    const timeout = new PgError(
      PG_QUERY_CANCELED,
      'canceling statement due to statement timeout',
    );
    const { repo } = makeFailingRepo(timeout);
    // Self-view (for === requester) so authorization passes without a DB hop
    // and the request reaches the failing snapshot read.
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ repo, pool });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${VIEWER_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(504);
      expectErrorEnvelopeOnly(res.json(), 'stats_timeout');
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Transaction-failure mapping (R8.6)
// ---------------------------------------------------------------------------

describe('Stats routes — transaction-failure mapping (R8.6)', () => {
  it('maps a rejected snapshot query on GET /me/stats to stats_unavailable (503) with no partial data', async () => {
    // A generic query/transaction failure (e.g. a failed BEGIN/COMMIT or a
    // rejected read) carries no `57014` code and must map to stats_unavailable.
    const failure = new Error('connection terminated unexpectedly');
    const { repo, inputs } = makeFailingRepo(failure);

    const app = await buildApp({ repo });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/me/stats',
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      // R8.6: transaction failure returns an error envelope and NO partial or
      // precomputed per-user statistics.
      expect(res.statusCode).toBe(503);
      expectErrorEnvelopeOnly(res.json(), 'stats_unavailable');
      expect(inputs).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('maps a failed BEGIN (non-timeout SQLSTATE) to stats_unavailable', async () => {
    // A serialization/transaction error that is NOT a statement timeout still
    // maps to stats_unavailable, not stats_timeout.
    const beginFailure = new PgError(
      '40001',
      'could not serialize access due to concurrent update',
    );
    const { repo } = makeFailingRepo(beginFailure);

    const app = await buildApp({ repo });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/me/stats',
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(503);
      expectErrorEnvelopeOnly(res.json(), 'stats_unavailable');
    } finally {
      await app.close();
    }
  });

  it('maps a transaction failure on the percentile path to stats_unavailable with no partial data', async () => {
    const failure = new Error('COMMIT failed: transaction aborted');
    const { repo, inputs } = makeFailingRepo(failure);

    const app = await buildApp({ repo });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/me/stats?percentile=true',
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(503);
      expectErrorEnvelopeOnly(res.json(), 'stats_unavailable');
      // Whole-request failure, not the isolated percentileUnavailable path.
      expect(res.json()).not.toHaveProperty('percentileUnavailable');
      expect(inputs[0]!.includePercentile).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('maps a transaction failure on the friend-view summary endpoint to stats_unavailable', async () => {
    const failure = new Error('transaction aborted');
    const { repo } = makeFailingRepo(failure);
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ repo, pool });
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/me/stats/summary?for=${VIEWER_ID}`,
        headers: { 'x-test-user-id': VIEWER_ID },
      });

      expect(res.statusCode).toBe(503);
      expectErrorEnvelopeOnly(res.json(), 'stats_unavailable');
    } finally {
      await app.close();
    }
  });
});
