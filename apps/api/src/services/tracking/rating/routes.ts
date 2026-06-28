/**
 * Tracking_Service — Rating HTTP routes.
 *
 * Task 10.2 of the disney-world-tracker plan. Wires the two rating
 * endpoints from the design's Tracking_Service "Endpoints" table:
 *
 *   PUT    /me/experiences/:id/rating   set/replace rating (1..10 int)
 *   DELETE /me/experiences/:id/rating   remove rating (404 if missing)
 *
 * Both routes require an authenticated session — the `requireSession`
 * pre-handler from task 6.2 is mounted route-locally so other modules
 * can be added to the same Fastify app without reaching for a global
 * auth scope. On success, `request.userId` carries the authenticated
 * user id; we read it directly without a fallback because the
 * pre-handler is responsible for refusing the request when no session
 * is present.
 *
 * Inputs are validated via Zod against `ratingInputSchema` (body) and
 * `uuidSchema` (path param). The shared schemas use the message
 * `rating_out_of_range` for any 1..10 integer violation, which we map
 * to the dedicated `rating_out_of_range` error code (R4.7). Anything
 * else (e.g. a non-numeric body field) collapses to the generic
 * `validation_failed` code.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7, 4.8
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode } from '@dwt/shared';
import { ratingInputSchema, uuidSchema } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import type { RatingRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `ratingRoutes`.
 *
 * Dependencies are passed in explicitly so the plugin can be wired in
 * `buildServer` (or in a test harness) without reaching for module-
 * level singletons. The shapes mirror the public surfaces of the peer
 * Tracking tasks:
 *
 *   - `repo`           — task 10.2 `createRatingRepo({...})` result.
 *   - `requireSession` — task 6.2 `createSessionMiddleware({...})`
 *                        result.
 */
export interface RatingRoutesOptions {
  readonly repo: RatingRepo;
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/**
 * Path params schema for both routes. The `id` is the stable internal
 * Experience id (UUIDv5 of the upstream entity id per R1.7).
 */
const ratingParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the rating routes Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(ratingRoutes({ repo, requireSession }));
 * ```
 *
 * The factory closes over the options so the returned plugin's
 * signature stays the standard `FastifyPluginAsync` and Fastify can
 * register it without bespoke typing.
 */
export function ratingRoutes(
  options: RatingRoutesOptions,
): FastifyPluginAsync {
  return async function ratingRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    app.get(
      '/me/experiences/:id/rating',
      { preHandler: options.requireSession },
      async (request) => {
        const { id: experienceId } = parseOrAppError(
          ratingParamsSchema,
          request.params,
        );
        const userId = requireUserId(request.userId);

        const result = await options.repo.getRating(userId, experienceId);
        if (result === null) {
          // No Rating for the pair. The App's `fetchOrNullOnCode`
          // swallows this exact code into the empty state (R4.6).
          throw new AppError(
            'rating_not_found',
            'No rating exists for this user and experience.',
          );
        }

        return {
          experienceId: result.experienceId,
          value: result.value,
          updatedAt: result.updatedAt.toISOString(),
        };
      },
    );

    app.put(
      '/me/experiences/:id/rating',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const { id: experienceId } = parseOrAppError(
          ratingParamsSchema,
          request.params,
        );
        const { value } = parseOrAppError(ratingInputSchema, request.body);
        const userId = requireUserId(request.userId);

        const result = await options.repo.setRating(
          userId,
          experienceId,
          value,
        );

        // 200 on replacement, 201 on first creation. Mirrors the
        // common REST convention so a client can distinguish the two
        // outcomes if it cares; the response body is the same shape
        // either way (R4.1, R4.3 both return an "observable
        // confirmation").
        const status = result.previousValue === null ? 201 : 200;
        reply.code(status);
        return {
          experienceId: result.experienceId,
          value: result.value,
          updatedAt: result.updatedAt.toISOString(),
        };
      },
    );

    app.delete(
      '/me/experiences/:id/rating',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const { id: experienceId } = parseOrAppError(
          ratingParamsSchema,
          request.params,
        );
        const userId = requireUserId(request.userId);

        // The repo throws `AppError('rating_not_found', ...)` when no
        // row exists; the global error hook turns that into a 404
        // (R4.8). We do not need to do anything special here.
        await options.repo.removeRating(userId, experienceId);

        // 204 No Content is the natural REST response for a successful
        // resource deletion. The client uses the request to invalidate
        // its local cache; no body is required.
        reply.code(204);
        return null;
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read `request.userId` set by the session middleware. The middleware
 * is responsible for refusing unauthorized requests; reaching this
 * function with `userId === undefined` would indicate a wiring bug
 * (e.g. forgetting to pass `requireSession`) so we surface it as a
 * 500 rather than letting it propagate as `undefined` into the repo
 * layer.
 */
function requireUserId(userId: string | undefined): string {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError(
      'internal_error',
      'Authenticated user id missing on request.',
    );
  }
  return userId;
}

/**
 * Run a Zod schema and translate any `ZodError` into an `AppError`.
 * Mirrors the helper in `services/catalog/routes.ts` and
 * `services/auth/routes.ts` (intentionally duplicated to keep the
 * route modules independent and to dodge an import cycle).
 *
 * The first issue's path becomes the envelope's `field`. Issues whose
 * `message` matches a recognized error-catalog code (here
 * `rating_out_of_range` from `ratingValueSchema`) surface that
 * specific code; everything else collapses to the generic
 * `validation_failed`.
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
 * Map a single Zod issue to an `AppError`. The function is
 * intentionally conservative: only the explicit codes embedded in the
 * shared schemas are re-emitted; anything else falls through to
 * `validation_failed` so the catch-all stays predictable.
 */
function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const rawMessage = issue?.message ?? 'Invalid request.';
  const code: ErrorCode =
    rawMessage === 'rating_out_of_range'
      ? 'rating_out_of_range'
      : 'validation_failed';
  const humanMessage =
    code === 'rating_out_of_range'
      ? 'Rating must be an integer between 1 and 10 inclusive.'
      : `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, humanMessage, { field })
    : new AppError(code, humanMessage);
}
