/**
 * Fastify routes for Food_Item, Food_Item_Log, and User_Submitted_Location (Feature: food-item-logging).
 *
 * Validates: Requirements 1.5, 1.6, 2.1-2.4, 3.1-3.4, 4.1-4.4, 6.1-6.7
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode } from '@dwt/shared';
import {
  createFoodItemLogInputSchema,
  createUserSubmittedLocationInputSchema,
  parkSchema,
  submitFoodItemInputSchema,
  uuidSchema,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { FoodItemLogRepo, FoodItemRepo } from './repo.js';
import type { UserSubmittedLocationRepo } from './locations.js';

// ---------------------------------------------------------------------------
// Route Options
// ---------------------------------------------------------------------------

export interface FoodItemRoutesOptions {
  readonly repo: FoodItemRepo;
  readonly requireSession: preHandlerHookHandler;
  readonly menuRetrieval?: {
    getMenuForRestaurant(experienceId: string): Promise<readonly unknown[]>;
  };
}

export interface FoodItemLogRoutesOptions {
  readonly repo: FoodItemLogRepo;
  readonly requireSession: preHandlerHookHandler;
  readonly clock?: () => Date;
}

export interface UserSubmittedLocationRoutesOptions {
  readonly repo: UserSubmittedLocationRepo;
  readonly requireSession: preHandlerHookHandler;
}

export interface FoodLogRoutesOptions {
  readonly items?: FoodItemRoutesOptions;
  readonly logs?: FoodItemLogRoutesOptions;
  readonly locations?: UserSubmittedLocationRoutesOptions;
}

// ---------------------------------------------------------------------------
// Local Schemas
// ---------------------------------------------------------------------------

const experienceParamsSchema = z.object({ id: uuidSchema }).strict();
const locationParamsSchema = z.object({ id: uuidSchema }).strict();
const foodItemParamsSchema = z.object({ foodItemId: uuidSchema }).strict();
const deleteLogParamsSchema = z
  .object({
    foodItemId: uuidSchema,
    logId: uuidSchema,
  })
  .strict();

const suggestQuerySchema = z
  .object({
    park: parkSchema,
    name: z.string().trim().min(1).max(200).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .refine((data) => Boolean(data.name || data.q), {
    message: 'validation_failed',
    path: ['name'],
  });

// ---------------------------------------------------------------------------
// FoodItem Routes Plugin
// ---------------------------------------------------------------------------

export function foodItemRoutes(
  options: FoodItemRoutesOptions,
): FastifyPluginAsync {
  return async function foodItemRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // GET /experiences/:id/food-items (Requirement 1.5, 1.6)
    app.get('/experiences/:id/food-items', async (request) => {
      const { id: experienceId } = parseOrAppError(
        experienceParamsSchema,
        request.params,
      );

      if (options.menuRetrieval) {
        await options.menuRetrieval.getMenuForRestaurant(experienceId);
      }

      const items = await options.repo.listFoodItems(experienceId);
      return { items };
    });

    // POST /experiences/:id/food-items (Requirement 2.1, 2.2)
    app.post(
      '/experiences/:id/food-items',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(
          experienceParamsSchema,
          request.params,
        );
        const body = parseOrAppError(
          submitFoodItemInputSchema,
          request.body,
        );

        const item = await options.repo.submitFoodItem(
          experienceId,
          userId,
          body.name,
        );
        reply.code(201);
        return item;
      },
    );

    // GET /locations/:id/food-items (Requirement 6.7)
    app.get('/locations/:id/food-items', async (request) => {
      const { id: locationId } = parseOrAppError(
        locationParamsSchema,
        request.params,
      );

      const items = await options.repo.listLocationFoodItems(locationId);
      return { items };
    });

    // POST /locations/:id/food-items (Requirement 6.5)
    app.post(
      '/locations/:id/food-items',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id: locationId } = parseOrAppError(
          locationParamsSchema,
          request.params,
        );
        const body = parseOrAppError(
          submitFoodItemInputSchema,
          request.body,
        );

        const item = await options.repo.submitLocationFoodItem(
          locationId,
          userId,
          body.name,
        );
        reply.code(201);
        return item;
      },
    );
  };
}

// ---------------------------------------------------------------------------
// FoodItemLog Routes Plugin
// ---------------------------------------------------------------------------

export function foodItemLogRoutes(
  options: FoodItemLogRoutesOptions,
): FastifyPluginAsync {
  const clock = options.clock ?? (() => new Date());

  return async function foodItemLogRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // POST /me/food-items/:foodItemId/logs (Requirement 3.1-3.5)
    app.post(
      '/me/food-items/:foodItemId/logs',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { foodItemId } = parseOrAppError(
          foodItemParamsSchema,
          request.params,
        );
        const body = parseOrAppError(
          createFoodItemLogInputSchema,
          request.body,
        );

        validateNotFutureVisitDate(body.visitedOn, body.userTz, clock());

        const log = await options.repo.addLog({
          userId,
          foodItemId,
          visitedOn: body.visitedOn,
          userTz: body.userTz,
          rating: body.rating ?? null,
          note: body.note ?? null,
        });

        reply.code(201);
        return log;
      },
    );

    // GET /me/food-items/:foodItemId/logs (Requirement 4.1, 4.2)
    app.get(
      '/me/food-items/:foodItemId/logs',
      { preHandler: options.requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { foodItemId } = parseOrAppError(
          foodItemParamsSchema,
          request.params,
        );

        return options.repo.getLogHistory(userId, foodItemId);
      },
    );

    // DELETE /me/food-items/:foodItemId/logs/:logId (Requirement 4.3, 4.4)
    app.delete(
      '/me/food-items/:foodItemId/logs/:logId',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { foodItemId, logId } = parseOrAppError(
          deleteLogParamsSchema,
          request.params,
        );

        await options.repo.deleteLog(userId, foodItemId, logId);
        reply.code(204);
        reply.send();
      },
    );

    // GET /me/food-item-logs (Requirement 8.1, 8.2)
    app.get(
      '/me/food-item-logs',
      { preHandler: options.requireSession },
      async (request) => {
        const userId = requireUser(request);
        return options.repo.getAllLogsForUser(userId);
      },
    );

    // GET /experiences/:id/food-item-logs/mine (Requirement 9.1, 9.3)
    app.get(
      '/experiences/:id/food-item-logs/mine',
      { preHandler: options.requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id: experienceId } = parseOrAppError(
          experienceParamsSchema,
          request.params,
        );
        return options.repo.getLogsForUserAtScope(userId, { experienceId });
      },
    );

    // GET /locations/:id/food-item-logs/mine (Requirement 9.2, 9.3)
    app.get(
      '/locations/:id/food-item-logs/mine',
      { preHandler: options.requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id: locationId } = parseOrAppError(
          locationParamsSchema,
          request.params,
        );
        return options.repo.getLogsForUserAtScope(userId, { locationId });
      },
    );
  };
}

// ---------------------------------------------------------------------------
// UserSubmittedLocation Routes Plugin
// ---------------------------------------------------------------------------

export function userSubmittedLocationRoutes(
  options: UserSubmittedLocationRoutesOptions,
): FastifyPluginAsync {
  return async function userSubmittedLocationRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // POST /locations (Requirement 6.1, 6.4)
    app.post(
      '/locations',
      { preHandler: options.requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const body = parseOrAppError(
          createUserSubmittedLocationInputSchema,
          request.body,
        );

        const location = await options.repo.createLocation(
          userId,
          body.name,
          body.park,
        );

        reply.code(201);
        return location;
      },
    );

    // GET /locations/suggest (Requirement 6.2, 6.3)
    app.get('/locations/suggest', async (request) => {
      const parsed = parseOrAppError(suggestQuerySchema, request.query);
      const name = (parsed.name ?? parsed.q)!.trim();

      const suggestions = await options.repo.suggestLocations(
        parsed.park,
        name,
        parsed.limit,
      );

      return { suggestions };
    });
  };
}

// ---------------------------------------------------------------------------
// Combined FoodLog Routes Plugin
// ---------------------------------------------------------------------------

export function foodLogRoutes(
  options: FoodLogRoutesOptions,
): FastifyPluginAsync {
  return async function foodLogRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    if (options.items !== undefined) {
      void app.register(foodItemRoutes(options.items));
    }
    if (options.logs !== undefined) {
      void app.register(foodItemLogRoutes(options.logs));
    }
    if (options.locations !== undefined) {
      void app.register(userSubmittedLocationRoutes(options.locations));
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
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

function validateNotFutureVisitDate(
  visitedOn: string,
  userTz: string,
  now: Date,
): void {
  const todayInUserTz = formatYmdInTimeZone(now, userTz);
  if (visitedOn > todayInUserTz) {
    throw new AppError(
      'food_log_future_date',
      'Visit date cannot be in the future',
      { field: 'visitedOn' },
    );
  }
}

function formatYmdInTimeZone(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new AppError(
        'validation_failed',
        'Unknown IANA time zone identifier.',
        { field: 'userTz' },
      );
    }
    throw err;
  }

  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }

  if (yyyy.length === 0 || mm.length === 0 || dd.length === 0) {
    throw new AppError(
      'validation_failed',
      'Could not resolve current date in the user time zone.',
      { field: 'userTz' },
    );
  }

  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const rawMessage = issue?.message ?? 'Invalid request.';
  const code: ErrorCode =
    rawMessage === 'rating_out_of_range' || rawMessage === 'note_length_invalid'
      ? (rawMessage as ErrorCode)
      : 'validation_failed';
  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, message, { field })
    : new AppError(code, message);
}
