/**
 * Trip photo routes — Album read and summary highlights.
 *
 * Implements: Task 19.2, Task 19.4
 * Validates: Requirements 9.8, 12.3, 12.5, 12.6, 12.7, 12.11, 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 15.7
 */

import { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest, type preHandlerHookHandler } from 'fastify';
import { z, ZodError } from 'zod';
import { uuidSchema, tripAlbumQuerySchema } from '@dwt/shared';
import { AppError } from '../../errors/AppError.js';
import type { DbPool } from '../../db/pool.js';
import { assertTripMember } from '../trips/authz.js';
import type { PhotoService } from './service.js';
import { setPrivateNoStore } from './routes.js';

export interface TripPhotoRoutesOptions {
  readonly photoService: PhotoService;
  readonly requireSession: preHandlerHookHandler;
  readonly pool: DbPool;
}

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field = issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return new AppError('validation_failed', message, { ...(field ? { field } : {}) });
}

function parseOrAppError<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

const tripIdParamsSchema = z.object({ id: uuidSchema }).strict();

export const tripPhotoRoutes: FastifyPluginAsync<TripPhotoRoutesOptions> = async (
  app: FastifyInstance,
  options: TripPhotoRoutesOptions
): Promise<void> => {
  const { photoService, requireSession, pool } = options;

  app.get(
    '/trips/:id/photos',
    { preHandler: requireSession as never },
    async (request, reply) => {
      const userId = requireUser(request);
      const { id: tripId } = parseOrAppError(tripIdParamsSchema, request.params);
      await assertTripMember(pool, userId, tripId);

      const query = parseOrAppError(tripAlbumQuerySchema, request.query);
      const result = await photoService.getTripAlbum(userId, tripId, query);
      setPrivateNoStore(reply);
      return result;
    }
  );
};
