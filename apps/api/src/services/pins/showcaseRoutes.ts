/**
 * Pin Showcase Fastify routes (Feature: pin-collection, Requirement 24).
 *
 * Endpoints:
 *   - `GET /me/pin-showcase`           — Owner's own showcase (placements + unplaced)
 *   - `GET /users/:userId/pin-showcase` — Friend's showcase (placements only, gated by assertOwnerOrFriend)
 *   - `PUT /me/pin-showcase/:pinId`    — Place or move a pin (validates bounds, capacity, clearance)
 *   - `DELETE /me/pin-showcase/:pinId` — Remove a pin placement (idempotent 200)
 *
 * Validates: Requirements 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.7, 24.8, 24.11;
 *            Properties 18, 19, 20, 21, 22
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import {
  placePinRequestSchema,
  type ErrorCode,
  type PinShowcaseDTO,
  type PinShowcasePlacementDTO,
  type PlacePinRequest,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertOwnerOrFriend } from '../friends/ownerOrFriend.js';
import type { PinShowcaseRepo } from './showcaseRepo.js';

export interface ShowcaseRoutesOptions {
  readonly repo: PinShowcaseRepo;
  readonly pool: DbPool;
  readonly requireSession: preHandlerHookHandler;
}

const pinIdParamSchema = z
  .object({
    pinId: z.string().min(1).max(100),
  })
  .strict();

const userIdParamSchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();

export function showcaseRoutes(options: ShowcaseRoutesOptions): FastifyPluginAsync {
  const { repo, pool, requireSession } = options;

  return async function showcaseRoutesPlugin(app: FastifyInstance): Promise<void> {
    // -----------------------------------------------------------------------
    // GET /me/pin-showcase — owner's own showcase with unplaced claimed pins
    // -----------------------------------------------------------------------
    app.get<{ Reply: PinShowcaseDTO }>(
      '/me/pin-showcase',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return repo.getShowcase(userId);
      },
    );

    // -----------------------------------------------------------------------
    // GET /users/:userId/pin-showcase — friend-gated showcase read
    // -----------------------------------------------------------------------
    app.get<{ Params: { userId: string }; Reply: PinShowcaseDTO }>(
      '/users/:userId/pin-showcase',
      { preHandler: requireSession },
      async (request) => {
        const requesterId = requireUser(request);
        const { userId: targetUserId } = parseOrAppError(
          userIdParamSchema,
          request.params,
        );

        // Authorization gate (Requirement 24.7, Property 21):
        // Reuses existing assertOwnerOrFriend; throws 403 profile_forbidden on deny.
        await assertOwnerOrFriend(pool, requesterId, targetUserId);

        if (requesterId === targetUserId) {
          return repo.getShowcase(targetUserId);
        }
        return repo.getFriendShowcase(targetUserId);
      },
    );

    // -----------------------------------------------------------------------
    // PUT /me/pin-showcase/:pinId — place or move a pin
    // -----------------------------------------------------------------------
    app.put<{
      Params: { pinId: string };
      Body: PlacePinRequest;
      Reply: PinShowcasePlacementDTO;
    }>(
      '/me/pin-showcase/:pinId',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { pinId } = parseOrAppError(pinIdParamSchema, request.params);
        const { posX, posY } = parseOrAppError(placePinRequestSchema, request.body);

        return repo.placePin(userId, pinId, posX, posY);
      },
    );

    // -----------------------------------------------------------------------
    // DELETE /me/pin-showcase/:pinId — remove a placement
    // -----------------------------------------------------------------------
    app.delete<{ Params: { pinId: string }; Reply: { ok: true } }>(
      '/me/pin-showcase/:pinId',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { pinId } = parseOrAppError(pinIdParamSchema, request.params);

        await repo.removePin(userId, pinId);
        return { ok: true };
      },
    );
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

function parseOrAppError<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
      const code: ErrorCode = 'validation_failed';
      throw field !== undefined
        ? new AppError(code, `Invalid value for "${field}".`, { field })
        : new AppError(code, 'Invalid request.');
    }
    throw err;
  }
}
