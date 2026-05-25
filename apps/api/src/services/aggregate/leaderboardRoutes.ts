/**
 * Highest-Rated Experiences leaderboard route.
 *
 * Task 8.5 of the disney-world-tracker plan. Wires the single endpoint
 * defined in design.md "Aggregate_Ratings_Service → Endpoints":
 *
 *   GET /home/highest-rated   Top 10 active Experiences by aggregate rating
 *
 * Authentication
 * --------------
 *
 * The leaderboard is the Home_Screen's lead surface (R11.1) and the
 * brief explicitly says "no session required (it's the home
 * leaderboard)". The plugin therefore registers the route without a
 * `requireSession` pre-handler. Per-IP rate limits configured higher up
 * in the stack still apply; this is a public read endpoint by design.
 *
 * Wire shape
 * ----------
 *
 * Response body:
 *
 *   { entries: LeaderboardEntryDTO[] }
 *
 * The entries match the shape exported by `@dwt/shared`'s
 * `leaderboardEntrySchema` (R11.5 + R11.2/R11.3/R11.4). Wrapping in an
 * envelope object (vs. a bare array) leaves room to add cache-meta or
 * pagination metadata later without breaking the wire contract.
 *
 * Error semantics
 * ---------------
 *
 * Errors thrown by the underlying service propagate to the global
 * Fastify error hook. A Redis or Postgres outage surfaces as
 * `internal_error` 500 by default; the route layer does not translate
 * domain errors here because the leaderboard's only failure modes are
 * infrastructure failures.
 *
 * Validates: Requirements R11.2, R11.3, R11.4, R11.5, R11.7, R11.8, R11.9, R11.10, R11.11
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

import type { LeaderboardEntryDTO } from '@dwt/shared';

import type { LeaderboardService } from './leaderboard.js';

// ---------------------------------------------------------------------------
// Public response shape
// ---------------------------------------------------------------------------

/**
 * Wire body for `GET /home/highest-rated`. Wraps the entry list in a
 * single-key object so future fields (e.g. `cachedAt`) can be added
 * without breaking client deserializers.
 */
export interface LeaderboardResponse {
  readonly entries: readonly LeaderboardEntryDTO[];
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by the `leaderboardRoutes` plugin.
 *
 *   - `service` — the leaderboard service produced by
 *                 `createLeaderboard({ pool, redis })`. Tests can pass an
 *                 in-memory implementation that satisfies the same
 *                 `LeaderboardService` interface.
 */
export interface LeaderboardRoutesOptions {
  readonly service: LeaderboardService;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Build the leaderboard Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(leaderboardRoutes({ service }));
 * ```
 *
 * The factory closes over the options so the returned plugin's
 * signature stays the standard `FastifyPluginAsync` and Fastify can
 * register it without bespoke typing.
 */
export function leaderboardRoutes(
  options: LeaderboardRoutesOptions,
): FastifyPluginAsync {
  const { service } = options;

  return async function leaderboardRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    app.get('/home/highest-rated', async (): Promise<LeaderboardResponse> => {
      const entries = await service.getLeaderboard();
      return { entries };
    });
  };
}
