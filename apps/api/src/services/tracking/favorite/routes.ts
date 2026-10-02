/**
 * Tracking_Service — Favorite HTTP routes.
 *
 * Implements:
 *   PUT    /me/experiences/:id/favorite   mark as favorite (204)
 *   DELETE /me/experiences/:id/favorite   unmark as favorite (204)
 *   GET    /me/favorites                  list favorited experience ids (200)
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode, FavoritesResponseDTO } from '@dwt/shared';
import { uuidSchema } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import type { FavoriteRepo } from './repo.js';

export interface FavoriteRoutesOptions {
  readonly repo: FavoriteRepo;
  readonly requireSession: preHandlerHookHandler;
}

const paramsSchema = z
  .object({ id: uuidSchema })
  .strict();

const emptyBodySchema = z.union([
  z.undefined(),
  z.null(),
  z.object({}).strict(),
]);

export function favoriteRoutes(
  options: FavoriteRoutesOptions,
): FastifyPluginAsync {
  return async function favoriteRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // --- PUT /me/experiences/:id/favorite (mark) -------------------------
    app.put<{ Params: { id: string } }>(
      '/me/experiences/:id/favorite',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(
          paramsSchema,
          request.params,
        );
        parseOrAppError(emptyBodySchema, request.body);

        await options.repo.favorite(userId, experienceId);

        reply.code(204);
        reply.send();
      },
    );

    // --- DELETE /me/experiences/:id/favorite (unmark) -------------------
    app.delete<{ Params: { id: string } }>(
      '/me/experiences/:id/favorite',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(
          paramsSchema,
          request.params,
        );
        parseOrAppError(emptyBodySchema, request.body);

        await options.repo.unfavorite(userId, experienceId);

        reply.code(204);
        reply.send();
      },
    );

    // --- GET /me/favorites (read favorited set) -------------------------
    app.get(
      '/me/favorites',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const experienceIds = await options.repo.listFavoriteIds(userId);

        const response: FavoritesResponseDTO = {
          experienceIds,
        };

        reply.code(200);
        reply.send(response);
      },
    );
  };
}

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (!userId) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

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

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const code: ErrorCode = 'validation_failed';
  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, message, { field })
    : new AppError(code, message);
}
