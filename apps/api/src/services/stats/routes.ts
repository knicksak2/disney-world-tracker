/**
 * Stats_Service HTTP routes (expanded-stats task 8.1).
 *
 * Wires the two endpoints from the design's Stats_Service section:
 *
 *   GET /me/stats[?percentile=true]                       own stats (R8, R11)
 *   GET /me/stats/summary?for=<userId>[&percentile=true]  friend-or-self (R9)
 *
 * Both endpoints assemble the same superset `StatsResponse` from the extended
 * snapshot repository and the pure roll-up layer:
 *
 *   - coverage dimensions  → `coverage.ts::rollUpCoverage`   (Requirements 1, 2)
 *   - per-Facet_Value_Key  → `facets.ts::rollUpFacets`       (Requirement 3)
 *   - rating statistics    → `ratingStats.ts::rollUpRatings` (Requirements 4, 5, 6)
 *   - percentile rank      → `percentile.ts::computePercentileRank` (Requirement 7)
 *
 * Authorization, gating, opt-in percentile, timeout, and error mapping live
 * here; every reported statistic is a pure fold over the single-snapshot raw
 * material the repo reads inside one `REPEATABLE READ READ ONLY` transaction.
 *
 * Cross-cutting rules enforced at this layer:
 *
 *   - **Authorization** (R9.2, R9.3, R9.6): `assertOwnerOrFriend` runs before
 *     any snapshot read. A requester who is neither the owner nor a Friend of
 *     an existing target gets `profile_forbidden` (no target data read, no
 *     analytics event — the gate emits none). A request for a target user id
 *     that does not exist gets `stats_target_not_found`.
 *   - **Friend gating of rating stats** (R9.1, R9.4, R9.5): a friend's response
 *     has the identical structure and Rating_Statistic types; because the
 *     rating roll-up is computed from the *target's* own active ratings, the
 *     friend's stats are gated by the friend's own active-rating count against
 *     the threshold exactly as for self, including the zero-ratings case.
 *   - **Percentile opt-in** (R7.2): `?percentile=true` toggles the percentile
 *     read; absent ⇒ the field is omitted and no percentile is computed.
 *   - **Percentile failure isolation** (R7.9): if the percentile cannot be
 *     computed while the rest of the snapshot succeeded, `percentileRank` is
 *     omitted, `percentileUnavailable: true` is set, and every other requested
 *     statistic is returned unchanged.
 *   - **Timeout / transaction failure** (R7.8, R8.6, R11.3): a per-request
 *     statement timeout sized to the SLA bounds the snapshot transaction; a
 *     timeout maps to `stats_timeout` and any other transaction begin/commit/
 *     abort failure maps to `stats_unavailable`, both with NO partial or
 *     precomputed per-user statistics.
 *
 * Validates: Requirements 7.2, 7.8, 7.9, 8.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6,
 * 11.1, 11.2, 11.3.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';
import { uuidSchema } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertOwnerOrFriend } from '../friends/ownerOrFriend.js';
import type { CompletionCell, LabeledCell } from './coverage.js';
import { rollUpCoverage } from './coverage.js';
import type { FacetCoverage } from './facets.js';
import { rollUpFacets } from './facets.js';
import type { RatingStatistics } from './ratingStats.js';
import { rollUpRatings } from './ratingStats.js';
import type { ResortCoverage } from './resorts.js';
import { rollUpResortCoverage } from './resorts.js';
import { computePercentileRank } from './percentile.js';
import type { StatsRepo, StatsSnapshot, StatsSnapshotInput } from './repo.js';

// ---------------------------------------------------------------------------
// Public response shape
// ---------------------------------------------------------------------------

/**
 * The coverage half of the response: every Coverage_Statistic dimension the
 * pure `rollUpCoverage` / `rollUpFacets` layer produces. Each fixed-enum
 * dimension carries a `CompletionCell` for every enum member (present even
 * when its `total` is 0); the open-ended per-Land / per-Resort_Area / per-
 * Facet_Value_Key dimensions are data-driven lists.
 */
export interface CoverageResponse {
  readonly overall: CompletionCell;
  readonly byPark: Record<Park, CompletionCell>;
  readonly byCategory: Record<ExperienceCategory, CompletionCell>;
  readonly byAreaType: Record<AreaType, CompletionCell>;
  readonly byLand: readonly LabeledCell[];
  readonly byResortArea: readonly LabeledCell[];
  readonly byFacetValue: readonly FacetCoverage[];
  readonly resort: CompletionCell;
  readonly byResort: readonly ResortCoverage[];
}

/**
 * The superset Stats_Service response delivered by both endpoints (design
 * "routes.ts" section). It is structurally identical for self and friend reads
 * (R9.1); only the underlying target's data differs.
 *
 * `percentileRank` is present only when the request opted in AND the value was
 * computed (R7.2). `percentileUnavailable` is present only on an isolated
 * percentile failure (R7.9); the two are mutually exclusive.
 */
export interface StatsResponse {
  readonly coverage: CoverageResponse;
  readonly ratings: RatingStatistics;
  readonly percentileRank?: number;
  readonly percentileUnavailable?: boolean;
}

// ---------------------------------------------------------------------------
// Timeout budgets (R7.8, R11.1, R11.2, R11.3)
// ---------------------------------------------------------------------------

/**
 * Per-request statement timeout for the snapshot transaction, sized to the SLA.
 * A request that does not compute the Percentile_Rank must return within 2s
 * (R11.1); one that does must return within 3s (R11.2). The statement timeout
 * bounds the transaction so an overrun aborts well within the 5s hard limit
 * (R11.3) and surfaces as `stats_timeout`.
 */
const STATEMENT_TIMEOUT_MS = 2000;
const STATEMENT_TIMEOUT_WITH_PERCENTILE_MS = 3000;

/** Postgres SQLSTATE for a statement cancelled by `statement_timeout`. */
const PG_QUERY_CANCELED = '57014';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by the `statsRoutes` plugin.
 *
 * Every dependency is injected so the plugin is hermetic in tests:
 *
 *   - `repo`           — persistence surface from `./repo.ts`.
 *   - `pool`           — used only by `assertOwnerOrFriend` (the single
 *                        friendship lookup) and the target-existence check on
 *                        the friend-view deny path; passing it in here keeps
 *                        the single SQL hop visible at this layer.
 *   - `requireSession` — pre-handler that authenticates the request and
 *                        assigns `request.userId`. Reused on both routes.
 */
export interface StatsRoutesOptions {
  readonly repo: StatsRepo;
  readonly pool: DbPool;
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/**
 * Opt-in percentile flag shared by both endpoints. Only the literal string
 * `'true'` requests the Percentile_Rank; any other value (including absence)
 * omits it and skips the computation entirely (R7.2).
 */
const percentileFlagSchema = z.enum(['true', 'false']).optional();

/** Query schema for `GET /me/stats`. */
const meStatsQuerySchema = z
  .object({ percentile: percentileFlagSchema })
  .strict();

/**
 * Query schema for `GET /me/stats/summary?for=<userId>`. The `for` field is
 * required and must be a UUID. `.strict()` rejects accidental fields.
 */
const summaryQuerySchema = z
  .object({ for: uuidSchema, percentile: percentileFlagSchema })
  .strict();

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Build the Stats_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(
 *   statsRoutes({ repo, pool, requireSession }),
 * );
 * ```
 *
 * The factory closes over the options so the returned plugin's signature stays
 * the standard `FastifyPluginAsync` and Fastify can register it without
 * bespoke typing.
 */
export function statsRoutes(
  options: StatsRoutesOptions,
): FastifyPluginAsync {
  const { repo, pool, requireSession } = options;

  return async function statsRoutesPlugin(app: FastifyInstance): Promise<void> {
    // -----------------------------------------------------------------
    // GET /me/stats — own stats
    // -----------------------------------------------------------------
    app.get('/me/stats', { preHandler: requireSession }, async (request) => {
      const userId = getRequesterId(request.userId);
      const { includePercentile } = parseMeStatsQuery(request.query);
      const snapshot = await loadSnapshot(repo, {
        targetUserId: userId,
        includePercentile,
        statementTimeoutMs: timeoutFor(includePercentile),
      });
      return assembleResponse(snapshot, includePercentile);
    });

    // -----------------------------------------------------------------
    // GET /me/stats/summary?for=<userId> — friend-or-self stats
    // -----------------------------------------------------------------
    app.get(
      '/me/stats/summary',
      { preHandler: requireSession },
      async (request) => {
        const requesterId = getRequesterId(request.userId);
        const { for: targetId, includePercentile } = parseSummaryQuery(
          request.query,
        );
        // R9.2, R9.3, R9.6: resolve authorization and target existence BEFORE
        // any snapshot read. A forbidden requester short-circuits without
        // reading the target's data and without any analytics write; a
        // non-existent target yields `stats_target_not_found`.
        await authorizeTarget(pool, requesterId, targetId);
        const snapshot = await loadSnapshot(repo, {
          targetUserId: targetId,
          includePercentile,
          statementTimeoutMs: timeoutFor(includePercentile),
        });
        return assembleResponse(snapshot, includePercentile);
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Response assembly
// ---------------------------------------------------------------------------

/**
 * Fold the raw snapshot into the superset `StatsResponse`. Exported so unit
 * tests can assert the assembly against synthetic snapshots without running
 * the route or repo layers.
 *
 * The rating statistics are computed from the target's own active ratings, so
 * the threshold gating (R9.4, R9.5) is applied identically for self and friend
 * reads — this function does not know or care which it is (R9.1).
 *
 * Percentile isolation (R7.9): when the request opted in, the percentile is
 * computed inside a `try` so a failure (or missing percentile material) omits
 * `percentileRank`, sets `percentileUnavailable: true`, and leaves every other
 * statistic untouched.
 */
export function assembleResponse(
  snapshot: StatsSnapshot,
  includePercentile: boolean,
): StatsResponse {
  const coverage = rollUpCoverage(snapshot.coverage);

  const response: {
    coverage: CoverageResponse;
    ratings: RatingStatistics;
    percentileRank?: number;
    percentileUnavailable?: boolean;
  } = {
    coverage: {
      overall: coverage.overall,
      byPark: coverage.byPark,
      byCategory: coverage.byCategory,
      byAreaType: coverage.byAreaType,
      byLand: coverage.byLand,
      byResortArea: coverage.byResortArea,
      byFacetValue: rollUpFacets(snapshot.facetExperiences),
      resort: coverage.resort,
      byResort: rollUpResortCoverage(snapshot.resortCoverage),
    },
    ratings: rollUpRatings(snapshot.userRatings),
  };

  if (includePercentile) {
    try {
      if (snapshot.percentile === null) {
        // Requested but the repo returned no percentile material: treat as an
        // isolated percentile failure rather than corrupting the rest (R7.9).
        throw new AppError(
          'stats_unavailable',
          'Percentile material was not read for this request.',
        );
      }
      response.percentileRank = computePercentileRank(snapshot.percentile);
    } catch {
      // R7.9: omit the rank, flag it unavailable, return the rest unchanged.
      response.percentileUnavailable = true;
    }
  }

  return response;
}

// ---------------------------------------------------------------------------
// Snapshot loading + error mapping
// ---------------------------------------------------------------------------

/**
 * Read the snapshot, mapping transaction failures to the Stats error catalog
 * (R7.8, R8.6, R11.3):
 *   - a statement cancelled by the per-request `statement_timeout` → `stats_timeout`
 *   - any other begin/commit/abort failure → `stats_unavailable`
 *
 * In both cases NO partial or precomputed per-user statistics are returned:
 * the repo either resolves with the complete snapshot or the error propagates
 * here and is turned into an error envelope.
 */
async function loadSnapshot(
  repo: StatsRepo,
  input: StatsSnapshotInput,
): Promise<StatsSnapshot> {
  try {
    return await repo.getStatsSnapshot(input);
  } catch (err) {
    if (isStatementTimeout(err)) {
      throw new AppError(
        'stats_timeout',
        'The statistics computation timed out.',
        { cause: err },
      );
    }
    throw new AppError(
      'stats_unavailable',
      'The statistics could not be computed.',
      { cause: err },
    );
  }
}

/**
 * Detect a Postgres statement-timeout cancellation (SQLSTATE `57014`). The
 * `pg` driver attaches the SQLSTATE as `error.code`; a timeout aborts the
 * in-flight statement and rolls the transaction back, so no partial data can
 * escape (R11.3).
 */
function isStatementTimeout(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_QUERY_CANCELED
  );
}

/** Pick the statement-timeout budget for the request (R11.1, R11.2). */
function timeoutFor(includePercentile: boolean): number {
  return includePercentile
    ? STATEMENT_TIMEOUT_WITH_PERCENTILE_MS
    : STATEMENT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Authorization + target resolution
// ---------------------------------------------------------------------------

/**
 * Resolve authorization and target existence for a friend-view request, before
 * any snapshot read.
 *
 * The owner (requester === target) is always authorized and always exists, so
 * neither DB hop runs for a self-read. For any other target, the owner-or-
 * friend gate runs first (its single friendship lookup); if it denies the
 * request with `profile_forbidden`, we then distinguish a genuine non-Friend
 * (R9.2 → keep `profile_forbidden`) from a non-existent target (R9.6 →
 * `stats_target_not_found`) with one existence check. A Friend relationship
 * implies the target exists, so the authorized path never issues the existence
 * query.
 *
 * Neither hop records an analytics/viewing-attempt event (R9.3); the existence
 * check is a plain read, not an analytics write.
 */
async function authorizeTarget(
  pool: DbPool,
  requesterId: string,
  targetId: string,
): Promise<void> {
  if (requesterId === targetId) {
    return;
  }
  try {
    await assertOwnerOrFriend(pool, requesterId, targetId);
  } catch (err) {
    if (err instanceof AppError && err.code === 'profile_forbidden') {
      const exists = await targetExists(pool, targetId);
      if (!exists) {
        throw new AppError(
          'stats_target_not_found',
          'The requested user was not found.',
        );
      }
    }
    throw err;
  }
}

/**
 * Check whether a target user id exists. Used only to choose between
 * `stats_target_not_found` (R9.6) and `profile_forbidden` (R9.2) on the
 * friend-view deny path; it reads no statistics.
 */
async function targetExists(pool: DbPool, targetId: string): Promise<boolean> {
  const result = await pool.query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM users WHERE id = $1) AS exists',
    [targetId],
  );
  return result.rows[0]?.exists === true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the requesting user's id from the request, throwing `unauthorized` if
 * the session pre-handler did not supply one.
 */
function getRequesterId(userId: string | undefined): string {
  if (!userId) {
    throw new AppError('unauthorized', 'Request is not authenticated.');
  }
  return userId;
}

/** Parse the `GET /me/stats` query string into the percentile opt-in flag. */
function parseMeStatsQuery(raw: unknown): { includePercentile: boolean } {
  const parsed = parseQuery(meStatsQuerySchema, raw, 'percentile');
  return { includePercentile: parsed.percentile === 'true' };
}

/** Parse the `GET /me/stats/summary` query string. */
function parseSummaryQuery(raw: unknown): {
  for: string;
  includePercentile: boolean;
} {
  const parsed = parseQuery(summaryQuerySchema, raw, 'for');
  return {
    for: parsed.for,
    includePercentile: parsed.percentile === 'true',
  };
}

/**
 * Parse a query object with a Zod schema, translating validation errors into
 * `AppError('validation_failed', ...)` envelopes with a `field` pointer for
 * client-side error display.
 */
function parseQuery<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  fallbackField: string,
): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0
          ? issue.path.map(String).join('.')
          : fallbackField;
      throw new AppError(
        'validation_failed',
        `Invalid value for "${field}".`,
        { field },
      );
    }
    throw err;
  }
}
