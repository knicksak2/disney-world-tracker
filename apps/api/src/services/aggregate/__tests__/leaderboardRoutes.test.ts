/**
 * Unit tests for the highest-rated leaderboard route plugin (task 8.5).
 *
 * The plugin is registered against an in-process Fastify instance with
 * a fake `LeaderboardService` so the assertions cover:
 *
 *   - GET /home/highest-rated returns the service result wrapped in
 *     `{ entries }`,
 *   - the route is unauthenticated (no session pre-handler is
 *     installed) — the brief explicitly says "no session required",
 *   - service errors propagate to the global error hook as 500
 *     `internal_error` envelopes.
 *
 * No Postgres, Redis, or sub-services are involved.
 *
 * Validates: Requirements 11.5
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { LeaderboardEntryDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  leaderboardRoutes,
  type LeaderboardRoutesOptions,
} from '../leaderboardRoutes.js';
import type { LeaderboardService } from '../leaderboard.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENTRIES: readonly LeaderboardEntryDTO[] = [
  {
    experienceId: '11111111-1111-4111-8111-111111111111',
    name: 'Astro Orbiter',
    park: 'Magic Kingdom',
    category: 'Ride',
    value: 9.5,
    count: 8,
  },
  {
    experienceId: '22222222-2222-4222-8222-222222222222',
    name: 'Buzz Lightyear',
    park: 'Magic Kingdom',
    category: 'Ride',
    value: 9.3,
    count: 12,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Fastify instance with the leaderboard route plugin
 * registered against a stub service. The error handler is wired in so
 * a service throw surfaces as the uniform envelope.
 */
async function buildApp(
  service: LeaderboardService,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const options: LeaderboardRoutesOptions = { service };
  await app.register(leaderboardRoutes(options));
  return app;
}

/**
 * Trivial in-memory `LeaderboardService` whose `getLeaderboard` either
 * returns a fixed list or throws.
 */
function makeService(
  result: readonly LeaderboardEntryDTO[] | Error,
): { service: LeaderboardService; calls: number } {
  let calls = 0;
  const service: LeaderboardService = {
    async getLeaderboard() {
      calls += 1;
      if (result instanceof Error) {
        throw result;
      }
      return result;
    },
  };
  return {
    service,
    get calls() {
      return calls;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /home/highest-rated', () => {
  it('returns the service result wrapped in { entries }', async () => {
    const handle = makeService(ENTRIES);
    const app = await buildApp(handle.service);

    const res = await app.inject({
      method: 'GET',
      url: '/home/highest-rated',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entries: ENTRIES });
    expect(handle.calls).toBe(1);
    await app.close();
  });

  it('returns an empty entries array when the service yields no rows (R11.11)', async () => {
    const handle = makeService([]);
    const app = await buildApp(handle.service);

    const res = await app.inject({
      method: 'GET',
      url: '/home/highest-rated',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ entries: [] });
    await app.close();
  });

  it('does not require a session — the route is publicly accessible', async () => {
    // No `Authorization` header is sent. The plugin must respond 200,
    // not 401. A regression that mistakenly added `requireSession`
    // would land here as a 401.
    const handle = makeService(ENTRIES);
    const app = await buildApp(handle.service);

    const res = await app.inject({
      method: 'GET',
      url: '/home/highest-rated',
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('propagates service errors via the global error hook as 500 internal_error', async () => {
    const handle = makeService(new Error('redis down'));
    const app = await buildApp(handle.service);

    const res = await app.inject({
      method: 'GET',
      url: '/home/highest-rated',
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'internal_error', message: 'An internal error occurred.' },
    });
    await app.close();
  });
});
