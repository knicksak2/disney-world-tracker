/**
 * Aggregate_Ratings_Service HTTP routes.
 *
 * Task 8.4 of the disney-world-tracker plan. Wires the single read
 * endpoint from the design's Aggregate_Ratings_Service "Endpoints" table:
 *
 *   GET /experiences/:id/aggregate-rating
 *
 * The response is the canonical `AggregateRatingDTO`:
 *
 *   { value: number | null, count: number }
 *
 * - `value` is the published mean rendered to one decimal place (the
 *   integer `mean_x10` from `aggregate_ratings` divided by 10) when the
 *   Experience has at least 3 contributing Ratings (R10.3, R10.5).
 * - `value` is `null` when the threshold is not met (R10.4, R10.6) or
 *   when no aggregate row exists yet for the Experience (count = 0).
 * - `count` is `count_ratings` and is always present (R10.3, R10.4).
 *
 * Privacy boundary (R10.10): the response shape is exactly two fields,
 * `value` and `count`. There is no path through this module that
 * returns or accepts another User's individual Rating value. The DTO
 * type in `@dwt/shared` enforces this at compile time and the
 * `aggregateRatingSchema`'s `.strict()` enforces it at runtime; the
 * route layer simply projects the aggregate row state into that shape
 * and never reads from `ratings`.
 *
 * Architectural notes
 * -------------------
 *
 * The plugin depends on a structural `AggregateRepo` port with a single
 * method:
 *
 *   getAggregate(experienceId): Promise<{
 *     sum: number,
 *     count: number,
 *     meanX10: number | null,
 *   } | null>
 *
 * Returning `null` when no row exists (rather than throwing) lets the
 * route layer translate "no aggregate yet" into the documented
 * `{ value: null, count: 0 }` response without a domain-error round-trip.
 * The repo (task 8.3) is responsible for the SELECT and for upholding
 * the storage contract; this module owns the wire-shape projection and
 * input validation only.
 *
 * The endpoint is intentionally not gated by `requireSession`. R10's
 * acceptance criteria do not list aggregate-rating reads under R6.12's
 * authenticated-only feature set, and the design's "Privacy boundary"
 * note relies on the *response shape* (value+count only) rather than on
 * authentication for confidentiality. This matches the catalog routes
 * (task 9.6), which are also unauthenticated.
 *
 * Validates: Requirements R10.3, R10.4, R10.5, R10.6, R10.10
 */

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { ZodError, z } from 'zod';

import type { AggregateRatingDTO, ErrorCode } from '@dwt/shared';
import { uuidSchema } from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';

// ---------------------------------------------------------------------------
// Public dependency contract
// ---------------------------------------------------------------------------

/**
 * Aggregate row state the route module needs to render an
 * `AggregateRatingDTO`. Field names match the storage row (`sum_ratings`,
 * `count_ratings`, `mean_x10`) but in camelCase to keep the in-memory
 * surface idiomatic.
 *
 * - `sum`     — `sum_ratings`. Not exposed on the wire; carried so the
 *               periodic reconciler (task 8.3) can be tested through the
 *               same port without a parallel shape.
 * - `count`   — `count_ratings`. Always >= 0.
 * - `meanX10` — `mean_x10`. `null` when `count < 3`, otherwise an integer
 *               in `[10, 100]` (R10.1 / `updateMeanX10` invariant).
 *
 * The shape is deliberately identical to the `AggregateMeanX10State`
 * exported by `updateMeanX10.ts` so the worker and the repo can share
 * a single internal type once task 8.3 lands.
 */
export interface AggregateRowState {
  readonly sum: number;
  readonly count: number;
  readonly meanX10: number | null;
}

/**
 * Port owned by task 8.3 (`apps/api/src/services/aggregate/repo.ts`).
 *
 * Returns the current aggregate triple for an Experience, or `null`
 * when no row exists in `aggregate_ratings` for that Experience yet.
 * `null` is the natural "no aggregate" signal — it predates any
 * `RatingChanged` event so neither sum nor count is meaningful, and
 * the route translates it into the documented `{ value: null,
 * count: 0 }` response.
 */
export interface AggregateRepo {
  getAggregate(experienceId: string): Promise<AggregateRowState | null>;
}

/**
 * Options accepted by `aggregateRoutes`. Dependencies are passed in
 * explicitly so the plugin can be wired in `buildServer` (or in a test
 * harness) without reaching for module-level singletons.
 */
export interface AggregateRoutesOptions {
  readonly repo: AggregateRepo;
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Zod schema for the `GET /experiences/:id/aggregate-rating` path. The id
 * is the stable internal Experience id (UUIDv5 of the upstream entity id
 * per R1.7); accepting any UUID keeps the schema agnostic to the
 * internal-id derivation strategy.
 */
const aggregateParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Aggregate_Ratings_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(aggregateRoutes({ repo }));
 * ```
 *
 * The factory closes over the options so the returned plugin's signature
 * stays the standard `FastifyPluginAsync` and Fastify can register it
 * without bespoke typing.
 */
export function aggregateRoutes(
  options: AggregateRoutesOptions,
): FastifyPluginAsync {
  return async function aggregateRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    app.get('/experiences/:id/aggregate-rating', async (request) => {
      const { id: experienceId } = parseOrAppError(
        aggregateParamsSchema,
        request.params,
      );
      const row = await options.repo.getAggregate(experienceId);
      return projectAggregate(row);
    });
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Project an aggregate row state (or `null` when no row exists) into the
 * canonical `AggregateRatingDTO` wire shape.
 *
 * - No row at all → `{ value: null, count: 0 }`. This is observationally
 *   indistinguishable from "row exists, count = 0" and avoids leaking
 *   whether any rating activity has ever occurred.
 * - Below threshold (`count < 3` or `meanX10 === null`) →
 *   `{ value: null, count }` (R10.4, R10.6).
 * - At or above threshold → `{ value: meanX10 / 10, count }` (R10.3,
 *   R10.5). The division by 10 is the only place `mean_x10` gets
 *   rendered as a one-decimal value; doing it in one location ensures
 *   the same rounding/representation across every caller of this
 *   helper.
 *
 * Exported so unit tests can pin the projection rule without spinning
 * up a Fastify instance.
 */
export function projectAggregate(
  row: AggregateRowState | null,
): AggregateRatingDTO {
  if (row === null) {
    return { value: null, count: 0 };
  }
  const value = row.meanX10 === null ? null : row.meanX10 / 10;
  return { value, count: row.count };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a Zod schema and translate any `ZodError` into an `AppError`.
 * Mirrors the helper in `services/catalog/routes.ts` and
 * `services/tracking/rating/routes.ts` (intentionally duplicated to
 * keep the route modules independent and to dodge an import cycle).
 *
 * The first issue's path becomes the envelope's `field`. The aggregate
 * route's only validated input is the path UUID, so any failure here
 * collapses to the generic `validation_failed` code with `field: 'id'`.
 */
function parseOrAppError<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

/**
 * Map a single Zod issue to an `AppError`. The aggregate-rating endpoint
 * has no domain-specific validation codes, so every Zod failure surfaces
 * as `validation_failed` with the offending field name carried in the
 * envelope's `field` slot.
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
