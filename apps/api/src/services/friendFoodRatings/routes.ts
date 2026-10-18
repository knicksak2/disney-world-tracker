/**
 * Fastify routes for Friend Food Ratings (Phase 1).
 *
 * Implements:
 *   GET /users/:userId/food-ratings
 *
 * Gating sequence:
 *   1. requireSession (preHandler)
 *   2. uuidSchema path id validation (400 validation_failed on invalid UUID)
 *   3. friendFoodRatingsQuerySchema query validation (400 validation_failed on invalid params)
 *   4. assertOwnerOrFriend(pool, requesterId, targetId) (403 profile_forbidden if not owner or friend)
 *   5. decodeCursor (400 validation_failed if cursor is malformed, wrong-sort, or tampered)
 *   6. repo.listDishes + repo.listScopes (scopes on first page only, null on continuation pages)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8, 4.5, 6.1, 6.2, 6.7, 6.8, 13.1
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError } from 'zod';

import type {
  FriendDishRatingDTO,
  FriendFoodRatingsPageDTO,
  FriendFoodSocialProofResponseDTO,
} from '@dwt/shared';
import {
  FRIEND_FOOD_INLINE_MAX_FRIENDS,
  friendFoodRatingsQuerySchema,
  uuidSchema,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertOwnerOrFriend } from '../friends/ownerOrFriend.js';
import {
  decodeCursor,
  encodeCursor,
  groupSocialProof,
  toLikeContainsPattern,
} from './dishAggregate.js';
import type { DishRow, FriendFoodRatingsRepo } from './repo.js';

export interface FriendFoodRatingRoutesOptions {
  readonly repo: FriendFoodRatingsRepo;
  readonly pool: DbPool;
  readonly requireSession: preHandlerHookHandler;
}

export function friendFoodRatingRoutes(
  options: FriendFoodRatingRoutesOptions,
): FastifyPluginAsync {
  const { repo, pool, requireSession } = options;

  return async function friendFoodRatingRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -----------------------------------------------------------------
    // GET /users/:userId/food-ratings
    // -----------------------------------------------------------------
    app.get<{
      Params: { userId: string };
      Querystring: Record<string, unknown>;
    }>(
      '/users/:userId/food-ratings',
      { preHandler: requireSession },
      async (request): Promise<FriendFoodRatingsPageDTO> => {
        const requesterId = getRequesterId(request.userId);
        const targetId = parseUserId(request.params.userId);
        const query = parseQuery(request.query);

        // Security gate: must be target owner or accepted friend before any log read or cursor decoding
        await assertOwnerOrFriend(pool, requesterId, targetId);

        // Keyset cursor decode: decoded after security gate so non-friends receive 403, not 400
        const decodedCursor = query.cursor
          ? decodeCursor(query.cursor, query.sort)
          : undefined;

        const { rows, hasMore } = await repo.listDishes({
          targetUserId: targetId,
          sort: query.sort,
          limit: query.limit,
          cursor: decodedCursor,
          experienceId: query.experienceId,
          locationId: query.locationId,
          park: query.park,
          likePattern: query.q ? toLikeContainsPattern(query.q) : undefined,
          minRatedLogs: query.minRatedLogs,
        });

        // Scopes for filter chips: first page only (when query.cursor is not provided)
        const scopes = query.cursor ? null : await repo.listScopes(targetId);

        const nextCursor =
          hasMore && rows.length > 0
            ? encodeCursor(
                query.sort,
                rows[rows.length - 1]!.cursorA,
                rows[rows.length - 1]!.cursorB,
                rows[rows.length - 1]!.foodItemId,
              )
            : null;

        return {
          items: rows.map(toFriendDishRatingDTO),
          nextCursor,
          scopes,
        };
      },
    );

    // -----------------------------------------------------------------
    // GET /experiences/:id/food-item-logs/friends
    // -----------------------------------------------------------------
    app.get<{
      Params: { id: string };
    }>(
      '/experiences/:id/food-item-logs/friends',
      { preHandler: requireSession },
      async (request): Promise<FriendFoodSocialProofResponseDTO> => {
        const viewerId = getRequesterId(request.userId);
        const experienceId = parseId(request.params.id);

        const { rows, capped } = await repo.listFriendSocialProof(viewerId, {
          kind: 'experience',
          id: experienceId,
        });

        const items = groupSocialProof(
          rows,
          FRIEND_FOOD_INLINE_MAX_FRIENDS,
          capped,
        );

        return { items };
      },
    );

    // -----------------------------------------------------------------
    // GET /locations/:id/food-item-logs/friends
    // -----------------------------------------------------------------
    app.get<{
      Params: { id: string };
    }>(
      '/locations/:id/food-item-logs/friends',
      { preHandler: requireSession },
      async (request): Promise<FriendFoodSocialProofResponseDTO> => {
        const viewerId = getRequesterId(request.userId);
        const locationId = parseId(request.params.id);

        const { rows, capped } = await repo.listFriendSocialProof(viewerId, {
          kind: 'location',
          id: locationId,
        });

        const items = groupSocialProof(
          rows,
          FRIEND_FOOD_INLINE_MAX_FRIENDS,
          capped,
        );

        return { items };
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRequesterId(userId: string | undefined): string {
  if (!userId) {
    throw new AppError('unauthorized', 'Request is not authenticated.');
  }
  return userId;
}

function parseUserId(raw: unknown): string {
  try {
    return uuidSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError(
        'validation_failed',
        'Invalid value for "userId".',
        { field: 'userId' },
      );
    }
    throw err;
  }
}

function parseId(raw: unknown): string {
  try {
    return uuidSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError(
        'validation_failed',
        'Invalid value for "id".',
        { field: 'id' },
      );
    }
    throw err;
  }
}

function parseQuery(raw: unknown) {
  try {
    return friendFoodRatingsQuerySchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0
          ? issue.path.map(String).join('.')
          : 'query';
      throw new AppError(
        'validation_failed',
        issue?.message ?? `Invalid value for "${field}".`,
        { field },
      );
    }
    throw err;
  }
}

function toFriendDishRatingDTO(row: DishRow): FriendDishRatingDTO {
  return {
    foodItemId: row.foodItemId,
    foodItemName: row.foodItemName,
    scopeKind: row.scopeKind,
    scopeId: row.scopeId,
    scopeName: row.scopeName,
    park: row.park,
    averageRating: row.averageRating,
    ratedLogCount: row.ratedCount,
    logCount: row.logCount,
    latestVisitedOn: row.latestVisitedOn,
  };
}
