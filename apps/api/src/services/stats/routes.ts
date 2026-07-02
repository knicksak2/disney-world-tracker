/**
 * Stats_Service HTTP routes (task 11.1).
 *
 * Wires the two endpoints from the design's Stats_Service "Endpoints" table:
 *
 *   GET /me/stats                           own stats (R3.4)
 *   GET /me/stats/summary?for=<userId>      friend-or-self stats (R7.4)
 *
 * Both endpoints answer with the same response shape — the second is just
 * the first with a different target user, gated by the owner-or-friend
 * authorization rule defined for `GET /users/:userId/profile` (R7.4) and
 * shared by `assertOwnerOrFriend` here. R7.8's "no analytics on deny"
 * rule applies symmetrically: the deny path throws `profile_forbidden`
 * without recording the viewing attempt.
 *
 * The response shape is:
 *
 *   {
 *     overall:           { completed, total, percent },
 *     byPark:            { '<Park>':     { completed, total, percent }, ... },
 *     byCategory:        { '<Category>': { completed, total, percent }, ... },
 *     byParkAndCategory: {
 *       '<Park>': { '<Category>': { completed, total, percent }, ... },
 *       ...
 *     }
 *   }
 *
 * The four numerators and four denominators come from a single REPEATABLE
 * READ snapshot in the repo (`getStatsSnapshot`). Roll-ups are computed
 * here from the cell list so the SQL is one shape rather than four.
 *
 * Every reported `percent` field is produced by `computePercent` so the
 * `[0.0, 100.0]` clamp, the round-half-away-from-zero rounding, and the
 * `denominator === 0 ⇒ 0.0` rule (R3.6, R3.7) hold for every dimension
 * uniformly (R3.8).
 *
 * Validates: Requirements R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8, R7.4.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ExperienceCategory, Park } from '@dwt/shared';
import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  uuidSchema,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertOwnerOrFriend } from '../friends/ownerOrFriend.js';
import { computePercent } from './computePercent.js';
import type { StatsCell, StatsRepo, StatsSnapshot } from './repo.js';

// ---------------------------------------------------------------------------
// Public response shape
// ---------------------------------------------------------------------------

/**
 * One row of a stats roll-up: the numerator, the denominator, and the
 * percentage produced by `computePercent` from those two values.
 */
export interface StatsBreakdown {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
}

/**
 * The four-dimension stats response delivered by both endpoints.
 *
 * Every Park is present in `byPark`; every Category in `byCategory`;
 * every `(Park, Category)` cell in `byParkAndCategory`. Cells with no
 * active Experience report `{ completed: 0, total: 0, percent: 0 }` per
 * R3.6/R3.7 so the client can render a stable grid without conditional
 * lookups.
 */
export interface StatsResponse {
  readonly overall: StatsBreakdown;
  readonly byPark: { readonly [park in Park]: StatsBreakdown };
  readonly byCategory: { readonly [category in ExperienceCategory]: StatsBreakdown };
  readonly byParkAndCategory: {
    readonly [park in Park]: {
      readonly [category in ExperienceCategory]: StatsBreakdown;
    };
  };
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by the `statsRoutes` plugin.
 *
 * Every dependency is injected so the plugin is hermetic in tests:
 *
 *   - `repo`           — persistence surface from `./repo.ts`.
 *   - `pool`           — used only by `assertOwnerOrFriend` to look up the
 *                        canonical friendship row; passing it in here (vs.
 *                        baking a `friendsRepo` dependency) keeps the
 *                        single SQL hop visible at this layer.
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
 * Query schema for `GET /me/stats/summary?for=<userId>`. The `for` field
 * is required and must be a UUID. Any other query parameter is rejected
 * via `.strict()` so the wire shape cannot accumulate accidental fields.
 */
const summaryQuerySchema = z
  .object({ for: uuidSchema })
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
 * The factory closes over the options so the returned plugin's signature
 * stays the standard `FastifyPluginAsync` and Fastify can register it
 * without bespoke typing.
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
      const snapshot = await repo.getStatsSnapshot(userId);
      return buildResponse(snapshot);
    });

    // -----------------------------------------------------------------
    // GET /me/stats/summary?for=<userId> — friend-or-self stats
    // -----------------------------------------------------------------
    app.get(
      '/me/stats/summary',
      { preHandler: requireSession },
      async (request) => {
        const requesterId = getRequesterId(request.userId);
        const { for: targetId } = parseSummaryQuery(request.query);
        // R7.4 + R7.8: the friendship lookup runs before the snapshot
        // query so a forbidden read short-circuits without reading the
        // target's data and without writing any analytics record.
        await assertOwnerOrFriend(pool, requesterId, targetId);
        const snapshot = await repo.getStatsSnapshot(targetId);
        return buildResponse(snapshot);
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------

/**
 * Roll the snapshot's flat cell list into the four-dimension response.
 *
 * Exported so unit tests can assert the roll-up against synthetic
 * snapshots without running the route layer.
 */
export function buildResponse(snapshot: StatsSnapshot): StatsResponse {
  // Initialize every Park/Category bucket to zero so missing snapshot
  // cells render as `{ completed: 0, total: 0, percent: 0.0 }` per R3.6,
  // R3.7. We accumulate raw counts first, then apply `computePercent`
  // exactly once per bucket, so the rounding/cap rules apply uniformly
  // (R3.1, R3.2, R3.3, R3.8).

  type RawBreakdown = { completed: number; total: number };

  const byPark = new Map<Park, RawBreakdown>(
    PARKS.map((p) => [p, { completed: 0, total: 0 }]),
  );
  const byCategory = new Map<ExperienceCategory, RawBreakdown>(
    EXPERIENCE_CATEGORIES.map((c) => [c, { completed: 0, total: 0 }]),
  );
  // Park × Category map keyed by "park|category".
  const byParkAndCategory = new Map<string, RawBreakdown>();
  for (const park of PARKS) {
    for (const category of EXPERIENCE_CATEGORIES) {
      byParkAndCategory.set(parkCategoryKey(park, category), {
        completed: 0,
        total: 0,
      });
    }
  }

  let overallCompleted = 0;
  let overallTotal = 0;

  for (const cell of snapshot.cells) {
    accumulateCell(cell, byPark, byCategory, byParkAndCategory);
    overallCompleted += cell.completed;
    overallTotal += cell.total;
  }

  return {
    overall: toBreakdown({ completed: overallCompleted, total: overallTotal }),
    byPark: rawMapToBreakdownRecord(byPark, PARKS),
    byCategory: rawMapToBreakdownRecord(byCategory, EXPERIENCE_CATEGORIES),
    byParkAndCategory: buildParkCategoryRecord(byParkAndCategory),
  };
}

/**
 * Add one cell's counts into the per-Park, per-Category, and per-Park-by-
 * Category accumulators. `byPark` and `byCategory` always have an entry
 * because we seeded the maps with every enum value; `byParkAndCategory`
 * is also fully seeded so `existing` is always defined.
 */
function accumulateCell(
  cell: StatsCell,
  byPark: Map<Park, { completed: number; total: number }>,
  byCategory: Map<ExperienceCategory, { completed: number; total: number }>,
  byParkAndCategory: Map<string, { completed: number; total: number }>,
): void {
  const parkBucket = byPark.get(cell.park);
  if (parkBucket) {
    parkBucket.completed += cell.completed;
    parkBucket.total += cell.total;
  }
  const categoryBucket = byCategory.get(cell.category);
  if (categoryBucket) {
    categoryBucket.completed += cell.completed;
    categoryBucket.total += cell.total;
  }
  const cellBucket = byParkAndCategory.get(parkCategoryKey(cell.park, cell.category));
  if (cellBucket) {
    cellBucket.completed += cell.completed;
    cellBucket.total += cell.total;
  }
}

/**
 * Project a `RawBreakdown` (counts only) into a `StatsBreakdown` with the
 * `percent` field computed by `computePercent`. This is the single point
 * where percentages are produced; using it everywhere keeps the rounding
 * and cap behavior identical across overall/by-Park/by-Category/by-
 * Park-and-Category dimensions (R3.8).
 */
function toBreakdown(raw: { completed: number; total: number }): StatsBreakdown {
  return {
    completed: raw.completed,
    total: raw.total,
    percent: computePercent(raw.completed, raw.total),
  };
}

/**
 * Build a record keyed by every member of `keys` (an enum tuple) by
 * looking up the matching entry in `map` and applying `toBreakdown`.
 *
 * Returning a plain object (rather than an `as` cast on the map) keeps
 * the response JSON-serializable without an intermediate `Object.fromEntries`
 * step and ensures every key is present even when the map has no entry
 * for it (which cannot actually happen because we seed the maps; this is
 * defense in depth).
 */
function rawMapToBreakdownRecord<K extends string>(
  map: Map<K, { completed: number; total: number }>,
  keys: ReadonlyArray<K>,
): { readonly [key in K]: StatsBreakdown } {
  const out = {} as { [key in K]: StatsBreakdown };
  for (const key of keys) {
    out[key] = toBreakdown(map.get(key) ?? { completed: 0, total: 0 });
  }
  return out;
}

/**
 * Build the `byParkAndCategory` record from the flat `park|category` map.
 * Every Park gets a sub-record with every Category populated so the
 * client can render a fixed-shape grid (R3.6, R3.7).
 */
function buildParkCategoryRecord(
  map: Map<string, { completed: number; total: number }>,
): {
  readonly [park in Park]: {
    readonly [category in ExperienceCategory]: StatsBreakdown;
  };
} {
  const out = {} as {
    [park in Park]: { [category in ExperienceCategory]: StatsBreakdown };
  };
  for (const park of PARKS) {
    const sub = {} as { [category in ExperienceCategory]: StatsBreakdown };
    for (const category of EXPERIENCE_CATEGORIES) {
      sub[category] = toBreakdown(
        map.get(parkCategoryKey(park, category)) ?? { completed: 0, total: 0 },
      );
    }
    out[park] = sub;
  }
  return out;
}

/** Stable key for the `byParkAndCategory` map. */
function parkCategoryKey(park: Park, category: ExperienceCategory): string {
  return `${park}|${category}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the requesting user's id from the request, throwing
 * `unauthorized` if the session pre-handler did not supply one. Mirrors
 * the helper in `auth/profileRoutes.ts`.
 */
function getRequesterId(userId: string | undefined): string {
  if (!userId) {
    throw new AppError('unauthorized', 'Request is not authenticated.');
  }
  return userId;
}

/**
 * Parse the `GET /me/stats/summary` query string. Translates Zod errors
 * into `AppError('validation_failed', ...)` envelopes with a `field`
 * pointer for client-side error display.
 */
function parseSummaryQuery(raw: unknown): { for: string } {
  try {
    return summaryQuerySchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0
          ? issue.path.map(String).join('.')
          : 'for';
      throw new AppError(
        'validation_failed',
        `Invalid value for "${field}".`,
        { field },
      );
    }
    throw err;
  }
}
