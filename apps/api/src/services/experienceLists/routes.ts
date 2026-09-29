/**
 * Fastify routes for Experience Lists (Feature: experience-lists, Task 6.1).
 *
 * Structural port of `apps/api/src/services/foodLists/routes.ts` — same
 * `parseOrAppError`/`requireUser` helpers, same Zod param schema pattern,
 * same status codes. Differs from that precedent in: (1) no checklist mode
 * (Experience_List has no `is_checklist`/`setChecklistMode` concept), (2)
 * route paths and the item param use `experience-lists`/`experienceId`, and
 * (3) no `DELETE /experience-lists/:id/save` route — this task's route list
 * intentionally has no unsave endpoint (the repo's `unsave` method exists
 * for future use but isn't wired here).
 *
 * The `ExperienceListSharedEvent`/`ExperienceListRoleChangedEvent` types are
 * imported from `notifications/service.ts` (task 6.2), which mirrors
 * `FoodListSharedEvent`/`FoodListRoleChangedEvent`'s shape exactly.
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 1.6, 2.1, 2.4, 2.5, 3.1, 4.1, 4.4,
 * 5.1, 6.1, 6.3, 6.4, 6.7, 7.1, 9.8.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import {
  addExperienceListItemInputSchema,
  createExperienceListInputSchema,
  reorderExperienceListItemsInputSchema,
  shareExperienceListInputSchema,
  updateExperienceListInputSchema,
  uuidSchema,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type {
  ExperienceListAffinityRepo,
  ExperienceListItemRepo,
  ExperienceListRepo,
  ExperienceListShareRepo,
} from './repo.js';
import type {
  ExperienceListSharedEvent,
  ExperienceListRoleChangedEvent,
} from '../notifications/service.js';

// ---------------------------------------------------------------------------
// Route Options
// ---------------------------------------------------------------------------

export interface ExperienceListRoutesOptions {
  readonly repo: ExperienceListRepo;
  readonly itemRepo: ExperienceListItemRepo;
  readonly shareRepo: ExperienceListShareRepo;
  readonly affinityRepo: ExperienceListAffinityRepo;
  readonly requireSession: preHandlerHookHandler;
  readonly emitExperienceListShared?: (event: ExperienceListSharedEvent) => void;
  readonly emitExperienceListRoleChanged?: (event: ExperienceListRoleChangedEvent) => void;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listIdParamsSchema = z.object({ id: uuidSchema }).strict();
const listItemParamsSchema = z
  .object({
    id: uuidSchema,
    experienceId: uuidSchema,
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

export function experienceListRoutes(options: ExperienceListRoutesOptions): FastifyPluginAsync {
  const {
    repo,
    itemRepo,
    shareRepo,
    affinityRepo,
    requireSession,
    emitExperienceListShared,
    emitExperienceListRoleChanged,
  } = options;

  return async function experienceListRoutesPlugin(app: FastifyInstance): Promise<void> {
    // -----------------------------------------------------------------------
    // List CRUD (Requirement 1)
    // -----------------------------------------------------------------------

    // POST /me/experience-lists
    app.post(
      '/me/experience-lists',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const input = parseOrAppError(createExperienceListInputSchema, request.body);
        const list = await repo.createList(userId, input);
        reply.code(201).send(list);
      },
    );

    // GET /me/experience-lists
    app.get(
      '/me/experience-lists',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return repo.listOwned(userId);
      },
    );

    // PATCH /me/experience-lists/:id
    app.patch(
      '/me/experience-lists/:id',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const input = parseOrAppError(updateExperienceListInputSchema, request.body);

        let updated = null;
        if (input.name !== undefined) {
          updated = await repo.renameList(id, userId, input.name);
        }
        if (input.visibility !== undefined) {
          updated = await repo.setVisibility(id, userId, input.visibility);
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

    // DELETE /me/experience-lists/:id
    app.delete(
      '/me/experience-lists/:id',
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

    // POST /me/experience-lists/:id/items
    app.post(
      '/me/experience-lists/:id/items',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const { experienceId } = parseOrAppError(addExperienceListItemInputSchema, request.body);
        const item = await itemRepo.addItem(id, userId, experienceId);
        reply.code(201).send(item);
      },
    );

    // DELETE /me/experience-lists/:id/items/:experienceId
    app.delete(
      '/me/experience-lists/:id/items/:experienceId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id, experienceId } = parseOrAppError(listItemParamsSchema, request.params);
        await itemRepo.removeItem(id, userId, experienceId);
        reply.code(204).send();
      },
    );

    // PUT /me/experience-lists/:id/items/order
    app.put(
      '/me/experience-lists/:id/items/order',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const { experienceIds, expectedVersion } = parseOrAppError(
          reorderExperienceListItemsInputSchema,
          request.body,
        );
        return itemRepo.reorderItems(id, userId, experienceIds, expectedVersion);
      },
    );

    // -----------------------------------------------------------------------
    // Shares Management (Requirement 4, Owner-Only)
    // -----------------------------------------------------------------------

    // POST /me/experience-lists/:id/shares
    app.post(
      '/me/experience-lists/:id/shares',
      { preHandler: requireSession },
      async (request) => {
        const ownerId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        const { recipientId, role } = parseOrAppError(
          shareExperienceListInputSchema,
          request.body,
        );

        const res = await shareRepo.shareWithFriend(id, ownerId, recipientId, role);

        if (res.action === 'created') {
          emitExperienceListShared?.({
            experienceListId: id,
            senderId: ownerId,
            recipientId,
          });
        } else if (res.action === 'role_changed') {
          const listInfo = await repo.getListDetail(id, ownerId);
          emitExperienceListRoleChanged?.({
            experienceListId: id,
            senderId: ownerId,
            recipientId,
            newRole: role,
            listName: listInfo?.name ?? 'a list',
          });
        }

        return res.share;
      },
    );

    // GET /me/experience-lists/:id/shares
    app.get(
      '/me/experience-lists/:id/shares',
      { preHandler: requireSession },
      async (request) => {
        const ownerId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        return shareRepo.listShares(id, ownerId);
      },
    );

    // DELETE /me/experience-lists/:id/shares/:recipientId
    app.delete(
      '/me/experience-lists/:id/shares/:recipientId',
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

    // GET /experience-lists/:id
    app.get(
      '/experience-lists/:id',
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

    // POST /experience-lists/:id/like
    app.post(
      '/experience-lists/:id/like',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await affinityRepo.like(id, userId);
        reply.code(204).send();
      },
    );

    // DELETE /experience-lists/:id/like
    app.delete(
      '/experience-lists/:id/like',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await affinityRepo.unlike(id, userId);
        reply.code(204).send();
      },
    );

    // POST /experience-lists/:id/save
    app.post(
      '/experience-lists/:id/save',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(listIdParamsSchema, request.params);
        await affinityRepo.save(id, userId);
        reply.code(204).send();
      },
    );

    // -----------------------------------------------------------------------
    // Discovery (Requirement 5)
    // -----------------------------------------------------------------------

    // GET /experience-lists/discover
    app.get(
      '/experience-lists/discover',
      { preHandler: requireSession },
      async (request) => {
        const query = parseOrAppError(discoveryQuerySchema, request.query);
        return repo.discover(query.sort, query.cursor);
      },
    );

    // -----------------------------------------------------------------------
    // Collection (Requirement 6.7)
    // -----------------------------------------------------------------------

    // GET /me/experience-lists/collection
    app.get(
      '/me/experience-lists/collection',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return affinityRepo.getCollection(userId);
      },
    );
  };
}
