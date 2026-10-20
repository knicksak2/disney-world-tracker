/**
 * Core photo routes:
 * - GET /photos/config
 * - POST /photos/uploads
 * - POST /photos/confirm
 * - GET /photos/:id
 * - GET /me/photos/status?ids=
 * - GET /me/photos
 * - DELETE /photos/:id
 * - POST /photos/:id/report
 * - POST /me/blocks
 * - DELETE /me/blocks/:blockId
 * - GET /me/blocks
 *
 * Implements: Task 9.1
 * Validates: Requirements 3.1, 3.6, 4.1, 4.3, 4.7, 4.10, 4.11, 5.8, 5.10, 5.11,
 *            9.3, 9.5, 9.8, 10.4, 10.9, 12.7, 16.1, 16.7, 17.1, 20.2
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from 'fastify';
import { z, ZodError } from 'zod';
import {
  photoUploadsRequestSchema,
  photoConfirmRequestSchema,
  photoStatusQuerySchema,
  photoReportCreateSchema,
  blockCreateSchema,
  myPhotosQuerySchema,
  uuidSchema,
  type PhotoClientConfigDTO,
  type PhotoInitiateResponseDTO,
  type PhotoConfirmResponseDTO,
  type MyPhotoDTO,
  type MyPhotoStatusResponseDTO,
  type BlockedUserDTO,
  type PhotoPageDTO,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { PhotoService } from './service.js';

export interface PhotoRoutesOptions {
  readonly photoService?: PhotoService | undefined;
  readonly requireSession: preHandlerHookHandler;
  readonly enabled?: boolean | undefined;
  readonly recapShareGate?: import('../sharing/ports.js').RecapShareGate | undefined;
  readonly recapPhotoPort?: import('../sharing/ports.js').RecapPhotoPort | undefined;
}

/**
 * Shared helper to enforce private, non-cacheable responses for presigned URLs (Requirement 9.8).
 */
export function setPrivateNoStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'private, no-store');
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

const photoIdParamsSchema = z.object({ id: uuidSchema }).strict();
const blockIdParamsSchema = z.object({ blockId: uuidSchema }).strict();

export const photoRoutes: FastifyPluginAsync<PhotoRoutesOptions> = async (
  app: FastifyInstance,
  options: PhotoRoutesOptions
): Promise<void> => {
  const { photoService, requireSession } = options;
  const isEnabled = options.enabled ?? (photoService ? photoService.enabled : false);

  // 1. GET /photos/config (always registered, even when disabled; Requirement 20.2)
  app.get<{ Reply: PhotoClientConfigDTO }>(
    '/photos/config',
    { preHandler: requireSession },
    async (request, reply) => {
      setPrivateNoStore(reply);
      if (!isEnabled || !photoService) {
        return {
          enabled: false,
          foodEnabled: false,
          tripEnabled: false,
          maxPerFoodLog: 0,
          maxPerTrip: 0,
          maxFeedPostPhotos: 0,
          maxBatch: 0,
          maxBytes: 0,
          maxThumbBytes: 0,
          dailyCap: 0,
          remainingToday: 0,
          experienceStripMax: 0,
        };
      }
      const userId = requireUser(request);
      return photoService.getClientConfig(userId);
    }
  );

  // When PHOTOS_ENABLED is false, register ONLY GET /photos/config (Requirement 20.2)
  if (!isEnabled || !photoService) {
    return;
  }

  // 2. POST /photos/uploads
  app.post<{ Body: unknown; Reply: PhotoInitiateResponseDTO }>(
    '/photos/uploads',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const input = parseOrAppError(photoUploadsRequestSchema, request.body);
      const result = await photoService.initiate(userId, input);
      setPrivateNoStore(reply);
      return result;
    }
  );

  // 3. POST /photos/confirm
  app.post<{ Body: unknown; Reply: PhotoConfirmResponseDTO }>(
    '/photos/confirm',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const input = parseOrAppError(photoConfirmRequestSchema, request.body);
      const result = await photoService.confirm(userId, input);
      setPrivateNoStore(reply);
      reply.code(202);
      return result;
    }
  );

  // 4. GET /me/photos/status?ids= (registered before /me/photos to prevent route collision)
  app.get<{ Querystring: unknown; Reply: MyPhotoStatusResponseDTO }>(
    '/me/photos/status',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const query = parseOrAppError(photoStatusQuerySchema, request.query);
      const result = await photoService.statusBatch(userId, query.ids);
      setPrivateNoStore(reply);
      return result;
    }
  );

  // 5. GET /me/photos
  app.get<{ Querystring: unknown; Reply: PhotoPageDTO<MyPhotoDTO> }>(
    '/me/photos',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const query = parseOrAppError(myPhotosQuerySchema, request.query);
      const result = await photoService.listMine(userId, query);
      setPrivateNoStore(reply);
      return result;
    }
  );

  // 6. GET /photos/:id
  app.get<{ Params: unknown; Reply: MyPhotoDTO }>(
    '/photos/:id',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { id } = parseOrAppError(photoIdParamsSchema, request.params);
      const result = await photoService.status(userId, id);
      setPrivateNoStore(reply);
      return result;
    }
  );

  // 7. DELETE /photos/:id
  app.delete<{ Params: unknown }>(
    '/photos/:id',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { id } = parseOrAppError(photoIdParamsSchema, request.params);
      await photoService.delete(userId, id);
      reply.code(204).send();
    }
  );

  // 8. POST /photos/:id/report
  app.post<{ Params: unknown; Body: unknown }>(
    '/photos/:id/report',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { id } = parseOrAppError(photoIdParamsSchema, request.params);
      const input = parseOrAppError(photoReportCreateSchema, request.body);
      await photoService.report(userId, id, input);
      reply.code(204).send();
    }
  );

  // 9. POST /me/blocks
  app.post<{ Body: unknown; Reply: BlockedUserDTO }>(
    '/me/blocks',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const input = parseOrAppError(blockCreateSchema, request.body);
      const result = await photoService.addBlock(userId, input);
      reply.code(201);
      return result;
    }
  );

  // 10. DELETE /me/blocks/:blockId
  app.delete<{ Params: unknown }>(
    '/me/blocks/:blockId',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { blockId } = parseOrAppError(blockIdParamsSchema, request.params);
      await photoService.removeBlock(userId, blockId);
      reply.code(204).send();
    }
  );

  // 11. GET /me/blocks
  app.get<{ Reply: readonly BlockedUserDTO[] }>(
    '/me/blocks',
    { preHandler: requireSession },
    async (request) => {
      const userId = requireUser(request);
      return photoService.listBlocks(userId);
    }
  );
};
