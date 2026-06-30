/**
 * Live_Service HTTP route.
 *
 * Task 8.1 of the experience-live-details plan. Wires the single live read
 * endpoint from the design's "Route (routes.ts)" section:
 *
 *   GET /catalog/:experienceId/live    live operational detail for one Experience
 *
 * The plugin is a thin HTTP boundary on top of the injected
 * {@link LiveService} orchestrator (task 7.1 `createLiveService`), mirroring
 * the shape of `services/catalog/routes.ts`:
 *
 *   - `:experienceId` is validated with the shared `uuidSchema`, consistent
 *     with the catalog detail route, so the validation rule cannot drift from
 *     the rest of the codebase. An invalid id surfaces as `validation_failed`
 *     (HTTP 400) via the global error hook.
 *
 *   - On success the route returns HTTP 200 with the orchestrator's
 *     `LiveDetailResult` body — `{ liveDetail, retrievedAt, stale, upstreamLastUpdated? }`.
 *     A `stale: true` fallback serve is still a 200 with the flag in the body
 *     (the same pattern the catalog read uses for `staleCache`), not an HTTP
 *     error (R2.5, R2.6, R3.1).
 *
 *   - When a fresh retrieval fails and no cached value exists, the orchestrator
 *     throws `AppError('live_unavailable')`; that flows through the existing
 *     global error hook into the uniform envelope, where `live_unavailable`
 *     maps to HTTP 503 (R2.8, R3.2). The route does not catch it.
 *
 * Validates: Requirements 2.5, 2.6, 2.8, 3.1, 3.2
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode } from '@dwt/shared';
import { uuidSchema } from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { LiveDetailResult, LiveService } from './service.js';

// ---------------------------------------------------------------------------
// Public dependency contract
// ---------------------------------------------------------------------------

/**
 * Options accepted by `liveRoutes`. The {@link LiveService} orchestrator is
 * passed in explicitly so the plugin can be wired in `buildServer` (or in a
 * test harness) without reaching for module-level singletons — mirroring how
 * `catalogRoutes` receives its repo/decision ports.
 */
export interface LiveRoutesOptions {
  readonly live: LiveService;
}

/**
 * Shape of the `GET /catalog/:experienceId/live` success response body. This
 * is structurally the orchestrator's {@link LiveDetailResult}: the projected
 * `liveDetail`, the `retrievedAt` time (R2.5), the `stale` indicator
 * (R2.6, R3.1), and the optional `upstreamLastUpdated` (R1.22).
 */
export type LiveDetailResponse = LiveDetailResult;

// ---------------------------------------------------------------------------
// Path validation schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for the `GET /catalog/:experienceId/live` path. The id is a UUID,
 * validated with the shared `uuidSchema` exactly as the catalog detail route
 * does, keeping the two routes' id validation aligned.
 */
const liveDetailParamsSchema = z
  .object({
    experienceId: uuidSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Live_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(liveRoutes({ live }));
 * ```
 *
 * The factory closes over the options so the returned plugin's signature stays
 * the standard `FastifyPluginAsync` and Fastify can register it without bespoke
 * typing.
 */
export function liveRoutes(options: LiveRoutesOptions): FastifyPluginAsync {
  return async function liveRoutesPlugin(app: FastifyInstance): Promise<void> {
    app.get('/catalog/:experienceId/live', async (request) => {
      const { experienceId } = parseDetailParams(request.params);
      // The orchestrator owns the resolve → cache → fetch → stale-fallback
      // decision. A successful or stale serve returns a LiveDetailResult here;
      // a failed retrieval with no cache throws `AppError('live_unavailable')`,
      // which the global error hook turns into the 503 envelope (R2.8, R3.2).
      const result = await options.live.getLiveDetail(experienceId);
      return result satisfies LiveDetailResponse;
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the `GET /catalog/:experienceId/live` path params, translating a
 * `ZodError` into an `AppError('validation_failed')` so an invalid id yields a
 * uniform 400 envelope with a `field` hint.
 */
function parseDetailParams(raw: unknown): { experienceId: string } {
  try {
    return liveDetailParamsSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

/**
 * Map a Zod issue to an `AppError`. The id path param has no domain-specific
 * code, so everything collapses to the generic `validation_failed` with the
 * offending field as a hint — mirroring `services/catalog/routes.ts`.
 */
function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const code: ErrorCode = 'validation_failed';
  const humanMessage = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, humanMessage, { field })
    : new AppError(code, humanMessage);
}
