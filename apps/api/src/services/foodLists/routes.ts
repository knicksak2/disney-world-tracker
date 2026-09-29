/**
 * Fastify routes for Food Lists (Feature: food-lists, Task 6.1).
 *
 * Validates: Requirements 1-11
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import {
  addFoodListItemInputSchema,
  createFoodListInputSchema,
  reorderFoodListItemsInputSchema,
  shareFoodListInputSchema,
  updateFoodListInputSchema,
  uuidSchema,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type {
  FoodListRoleChangedEvent,
  FoodListSharedEvent,
} from '../notifications/service.js';
import type {
  FoodListAffinityRepo,
  FoodListItemRepo,
  FoodListRepo,
  FoodListShareRepo,
} from './repo.js';

// ---------------------------------------------------------------------------
// Route Options
// ---------------------------------------------------------------------------

export interface FoodListRoutesOptions {
  readonly repo: FoodListRepo;
  readonly itemRepo: FoodListItemRepo;
  readonly shareRepo: FoodListShareRepo;
  readonly affinityRepo: FoodListAffinityRepo;
  readonly requireSession: preHandlerHookHandler;
  readonly emitFoodListShared?: (event: FoodListSharedEvent) => void;
  readonly emitFoodListRoleChanged?: (event: FoodListRoleChangedEvent) => void;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listIdParamsSchema = z.object({ id: uuidSchema }).strict();
const listItemParamsSchema = z
  .object({
    id: uuidSchema,
    foodItemId: uuidSchema,
  })
  .strict();
const listShareParamsSchema = z
  .object({
    id: uuidSchema,
    recipientId: uuidSchema,
  })
  .strict();

const discoveryQuerySchema = z
  .object({
    sort: z.enum(['popular', 'recent']).default('popular'),
    cursor: z.string().optional(),
  })
  .strict();

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

function parseOrAppError<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
      throw new AppError(
        'validation_failed',
        issue?.message ?? 'Validation failed',
        field !== undefined ? { field } : undefined,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Plugin Factory
// ---------------------------------------------------------------------------

export function foodListRoutes(options: FoodListRoutesOptions): FastifyPluginAsync {
  const {
    repo,
    itemRepo,
    shareRepo,
    affinityRepo,
    requireSession,
    emitFoodListShared,
    emitFoodListRoleChanged,
  } = options;

  return async function foodListRoutesPlugin(app: FastifyInstance): Promise<void> {
    // -----------------------------------------------------------------------
    // List CRUD (Requirement 1)
    // -----------------------------------------------------------------------

    // POST /me/food-lists
    app.post(
      '/me/food-lists',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const input = parseOrAppError(createFoodListInputSchema, request.body);
        const list = await repo.createList(userId, input);
        reply.code(201).send(list);
      },
    );

    // GET /me/food-lists
    app.get(
      '/me/food-lists',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return repo.listOwned(userId);
      },
    );

    // PATCH /me/food-lists/:id
    app.patch(
      '/me/food-lists/:id',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const input = parseOrAppError(updateFoodListInputSchema, request.body);

        let updated = null;
        if (input.name !== undefined) {
          updated = await repo.renameList(id, userId, input.name);
        }
        if (input.visibility !== undefined) {
          updated = await repo.setVisibility(id, userId, input.visibility);
        }
        if (input.isChecklist !== undefined) {
          updated = await repo.setChecklistMode(id, userId, input.isChecklist);
        }
        if (input.pinned !== undefined) {
          updated = await repo.setPinned(id, userId, input.pinned);
        }
        if (!updated) {
          const detail = await repo.getListDetail(id, userId);
          return detail;
        }
        return updated;
      },
    );

    // DELETE /me/food-lists/:id
    app.delete(
      '/me/food-lists/:id',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await repo.deleteList(id, userId);
        reply.code(204).send();
      },
    );

    // -----------------------------------------------------------------------
    // Items Membership (Requirement 2, Edit-Access Gated)
    // -----------------------------------------------------------------------

    // POST /me/food-lists/:id/items
    app.post(
      '/me/food-lists/:id/items',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const { foodItemId } = parseOrAppError(addFoodListItemInputSchema, request.body);
        const item = await itemRepo.addItem(id, userId, foodItemId);
        reply.code(201).send(item);
      },
    );

    // DELETE /me/food-lists/:id/items/:foodItemId
    app.delete(
      '/me/food-lists/:id/items/:foodItemId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, foodItemId } = parseOrAppError(listItemParamsSchema, request.params);
        await itemRepo.removeItem(id, userId, foodItemId);
        reply.code(204).send();
      },
    );

    // PUT /me/food-lists/:id/items/order
    app.put(
      '/me/food-lists/:id/items/order',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const { foodItemIds, expectedVersion } = parseOrAppError(
          reorderFoodListItemsInputSchema,
          request.body,
        );
        return itemRepo.reorderItems(id, userId, foodItemIds, expectedVersion);
      },
    );

    // -----------------------------------------------------------------------
    // Shares Management (Requirement 4, Owner-Only)
    // -----------------------------------------------------------------------

    // POST /me/food-lists/:id/shares
    app.post(
      '/me/food-lists/:id/shares',
      { preHandler: requireSession },
      async (request) => {
        const ownerId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const { recipientId, role } = parseOrAppError(
          shareFoodListInputSchema,
          request.body,
        );

        const res = await shareRepo.shareWithFriend(id, ownerId, recipientId, role);

        if (res.action === 'created') {
          emitFoodListShared?.({
            foodListId: id,
            senderId: ownerId,
            recipientId,
          });
        } else if (res.action === 'role_changed') {
          const listInfo = await repo.findListById(id);
          emitFoodListRoleChanged?.({
            foodListId: id,
            senderId: ownerId,
            recipientId,
            newRole: role,
            listName: listInfo?.name ?? 'a list',
          });
        }

        return res.share;
      },
    );

    // GET /me/food-lists/:id/shares
    app.get(
      '/me/food-lists/:id/shares',
      { preHandler: requireSession },
      async (request) => {
        const ownerId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        return shareRepo.listShares(id, ownerId);
      },
    );

    // DELETE /me/food-lists/:id/shares/:recipientId
    app.delete(
      '/me/food-lists/:id/shares/:recipientId',
      { preHandler: requireSession },
      async (request, reply) => {
        const ownerId = requireUser(request);
        const { id, recipientId } = parseOrAppError(
          listShareParamsSchema,
          request.params,
        );
        await shareRepo.revokeShare(id, ownerId, recipientId);
        reply.code(204).send();
      },
    );

    // -----------------------------------------------------------------------
    // Detail View (Requirement 7, View-Access Gated)
    // -----------------------------------------------------------------------

    // GET /food-lists/:id
    app.get(
      '/food-lists/:id',
      { preHandler: requireSession },
      async (request) => {
        const viewerId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        return repo.getListDetail(id, viewerId);
      },
    );

    // -----------------------------------------------------------------------
    // Affinity (Requirement 6, Likes & Saves)
    // -----------------------------------------------------------------------

    // POST /food-lists/:id/like
    app.post(
      '/food-lists/:id/like',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await affinityRepo.like(id, userId);
        reply.code(204).send();
      },
    );

    // DELETE /food-lists/:id/like
    app.delete(
      '/food-lists/:id/like',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await affinityRepo.unlike(id, userId);
        reply.code(204).send();
      },
    );

    // POST /food-lists/:id/save
    app.post(
      '/food-lists/:id/save',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await affinityRepo.save(id, userId);
        reply.code(204).send();
      },
    );

    // DELETE /food-lists/:id/save
    app.delete(
      '/food-lists/:id/save',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await affinityRepo.unsave(id, userId);
        reply.code(204).send();
      },
    );

    // -----------------------------------------------------------------------
    // Discovery (Requirement 5)
    // -----------------------------------------------------------------------

    // GET /food-lists/discover
    app.get(
      '/food-lists/discover',
      { preHandler: requireSession },
      async (request) => {
        const query = parseOrAppError(discoveryQuerySchema, request.query);
        return repo.discover(query.sort, query.cursor);
      },
    );

    // -----------------------------------------------------------------------
    // Collection (Requirement 6.7)
    // -----------------------------------------------------------------------

    // GET /me/food-lists/collection
    app.get(
      '/me/food-lists/collection',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return affinityRepo.getCollection(userId);
      },
    );
  };
}
