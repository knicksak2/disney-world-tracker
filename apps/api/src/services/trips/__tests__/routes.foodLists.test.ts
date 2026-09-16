/**
 * Route tests for Trip Food_Lists endpoints:
 *   POST   /trips/:id/food-lists
 *   DELETE /trips/:id/food-lists/:foodListId
 *
 * Validates: Requirements 22.1, 22.5, 22.7
 */

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const FOOD_LIST_ID = '33333333-3333-3333-3333-333333333333';

function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  const explode =
    (name: string) =>
    (): never => {
      throw new Error(`repo.${name} must not be called in this test`);
    };
  return {
    attachFoodList: explode('attachFoodList'),
    detachFoodList: explode('detachFoodList'),
    ...overrides,
  } as unknown as TripRepo;
}

function makePool(role: 'organizer' | 'member' | null): DbPool {
  return {
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      return role === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ role }], rowCount: 1 };
    },
  } as unknown as DbPool;
}

async function buildApp(
  role: 'organizer' | 'member' | null,
  repo: TripRepo,
  authenticated = true,
): Promise<FastifyInstance> {
  const requireSession: preHandlerHookHandler = async (request) => {
    if (!authenticated) {
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = CALLER_ID;
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    tripRoutes({ repo, requireSession, pool: makePool(role) }),
  );
  await app.ready();
  return app;
}

describe('Trip Food Lists Routes', () => {
  describe('POST /trips/:id/food-lists', () => {
    it('returns 201 when a member attaches an eligible food list', async () => {
      const attachFoodList = vi.fn().mockResolvedValue(undefined);
      const app = await buildApp('member', makeRepo({ attachFoodList }));

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/food-lists`,
        payload: { foodListId: FOOD_LIST_ID },
      });

      expect(res.statusCode).toBe(201);
      expect(attachFoodList).toHaveBeenCalledWith(
        TRIP_ID,
        CALLER_ID,
        FOOD_LIST_ID,
      );
    });

    it('returns 403 trip_food_list_ineligible when list is ineligible', async () => {
      const attachFoodList = vi.fn().mockRejectedValue(
        new AppError(
          'trip_food_list_ineligible',
          'Only the food list owner or a public list can be attached to a trip.',
        ),
      );
      const app = await buildApp('member', makeRepo({ attachFoodList }));

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/food-lists`,
        payload: { foodListId: FOOD_LIST_ID },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('trip_food_list_ineligible');
    });

    it('returns 404 trip_food_list_not_found when list does not exist', async () => {
      const attachFoodList = vi.fn().mockRejectedValue(
        new AppError('trip_food_list_not_found', 'Food list not found.'),
      );
      const app = await buildApp('member', makeRepo({ attachFoodList }));

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/food-lists`,
        payload: { foodListId: FOOD_LIST_ID },
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('trip_food_list_not_found');
    });

    it('returns 403 trip_forbidden when caller is not a trip member', async () => {
      const attachFoodList = vi.fn();
      const app = await buildApp(null, makeRepo({ attachFoodList }));

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/food-lists`,
        payload: { foodListId: FOOD_LIST_ID },
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('trip_forbidden');
      expect(attachFoodList).not.toHaveBeenCalled();
    });

    it('returns 401 when caller is not authenticated', async () => {
      const attachFoodList = vi.fn();
      const app = await buildApp('member', makeRepo({ attachFoodList }), false);

      const res = await app.inject({
        method: 'POST',
        url: `/trips/${TRIP_ID}/food-lists`,
        payload: { foodListId: FOOD_LIST_ID },
      });

      expect(res.statusCode).toBe(401);
      expect(attachFoodList).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /trips/:id/food-lists/:foodListId', () => {
    it('returns 204 when adder detaches the list', async () => {
      const detachFoodList = vi.fn().mockResolvedValue(true);
      const app = await buildApp('member', makeRepo({ detachFoodList }));

      const res = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/food-lists/${FOOD_LIST_ID}`,
      });

      expect(res.statusCode).toBe(204);
      expect(detachFoodList).toHaveBeenCalledWith(
        TRIP_ID,
        CALLER_ID,
        'member',
        FOOD_LIST_ID,
      );
    });

    it('returns 204 when organizer detaches a list added by someone else', async () => {
      const detachFoodList = vi.fn().mockResolvedValue(true);
      const app = await buildApp('organizer', makeRepo({ detachFoodList }));

      const res = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/food-lists/${FOOD_LIST_ID}`,
      });

      expect(res.statusCode).toBe(204);
      expect(detachFoodList).toHaveBeenCalledWith(
        TRIP_ID,
        CALLER_ID,
        'organizer',
        FOOD_LIST_ID,
      );
    });

    it('returns 403 trip_forbidden when non-adder non-organizer member tries to detach', async () => {
      const detachFoodList = vi.fn().mockRejectedValue(
        new AppError(
          'trip_forbidden',
          'You can only detach food lists you attached.',
        ),
      );
      const app = await buildApp('member', makeRepo({ detachFoodList }));

      const res = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/food-lists/${FOOD_LIST_ID}`,
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('trip_forbidden');
    });

    it('returns 404 trip_food_list_not_found when list is not attached to trip', async () => {
      const detachFoodList = vi.fn().mockResolvedValue(false);
      const app = await buildApp('member', makeRepo({ detachFoodList }));

      const res = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/food-lists/${FOOD_LIST_ID}`,
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('trip_food_list_not_found');
    });

    it('returns 403 trip_forbidden when caller is not a trip member', async () => {
      const detachFoodList = vi.fn();
      const app = await buildApp(null, makeRepo({ detachFoodList }));

      const res = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/food-lists/${FOOD_LIST_ID}`,
      });

      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('trip_forbidden');
      expect(detachFoodList).not.toHaveBeenCalled();
    });

    it('returns 401 when caller is not authenticated', async () => {
      const detachFoodList = vi.fn();
      const app = await buildApp('member', makeRepo({ detachFoodList }), false);

      const res = await app.inject({
        method: 'DELETE',
        url: `/trips/${TRIP_ID}/food-lists/${FOOD_LIST_ID}`,
      });

      expect(res.statusCode).toBe(401);
      expect(detachFoodList).not.toHaveBeenCalled();
    });
  });
});
