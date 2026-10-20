/**
 * Food photo read routes:
 * - GET /food-items/:foodItemId/photos
 * - GET /experiences/:id/food-photos
 * - GET /locations/:id/food-photos
 *
 * Implements: Task 9.2
 * Validates: Requirements 1.6, 9.4, 9.8, 10.3, 10.5, 10.9, 11.1, 11.2, 11.3, 11.4, 17.1
 */

import type {
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { z, ZodError } from 'zod';
import {
  foodGalleryQuerySchema,
  uuidSchema,
  type FoodPhotoDTO,
  type RestaurantFoodPhotoDTO,
  type PhotoPageDTO,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { PhotoService } from './service.js';
import { setPrivateNoStore } from './routes.js';

export interface FoodReadRoutesOptions {
  readonly photoService: PhotoService;
  readonly requireSession: preHandlerHookHandler;
}

const foodItemIdParamsSchema = z.object({ foodItemId: uuidSchema }).strict();
const entityIdParamsSchema = z.object({ id: uuidSchema }).strict();

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

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

export const foodReadRoutes: FastifyPluginAsync<FoodReadRoutesOptions> = async (
  app,
  options
) => {
  const { photoService, requireSession } = options;

  // 1. GET /food-items/:foodItemId/photos
  app.get<{ Params: unknown; Querystring: unknown; Reply: PhotoPageDTO<FoodPhotoDTO> }>(
    '/food-items/:foodItemId/photos',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { foodItemId } = parseOrAppError(foodItemIdParamsSchema, request.params);
      const query = parseOrAppError(foodGalleryQuerySchema, request.query);
      const result = await photoService.listFoodGallery(userId, {
        scopeId: foodItemId,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      setPrivateNoStore(reply);
      return result;
    }
  );

  // 2. GET /experiences/:id/food-photos
  app.get<{ Params: unknown; Querystring: unknown; Reply: PhotoPageDTO<RestaurantFoodPhotoDTO> }>(
    '/experiences/:id/food-photos',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { id } = parseOrAppError(entityIdParamsSchema, request.params);
      const query = parseOrAppError(foodGalleryQuerySchema, request.query);
      const result = await photoService.listRestaurantFoodGallery(userId, {
        experienceId: id,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      setPrivateNoStore(reply);
      return result;
    }
  );

  // 3. GET /locations/:id/food-photos
  app.get<{ Params: unknown; Querystring: unknown; Reply: PhotoPageDTO<RestaurantFoodPhotoDTO> }>(
    '/locations/:id/food-photos',
    { preHandler: requireSession },
    async (request, reply) => {
      const userId = requireUser(request);
      const { id } = parseOrAppError(entityIdParamsSchema, request.params);
      const query = parseOrAppError(foodGalleryQuerySchema, request.query);
      const result = await photoService.listRestaurantFoodGallery(userId, {
        locationId: id,
        ...(query.cursor ? { cursor: query.cursor } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      });
      setPrivateNoStore(reply);
      return result;
    }
  );
};
