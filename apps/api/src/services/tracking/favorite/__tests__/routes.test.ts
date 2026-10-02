/**
 * Route integration tests for tracking/favorite/routes.ts.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../../../errors/AppError.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import type { FavoriteRepo } from '../repo.js';
import { favoriteRoutes } from '../routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const INVALID_UUID = 'not-a-uuid';

interface FakeFavoriteRepo extends FavoriteRepo {
  readonly favoriteCalls: Array<{ userId: string; experienceId: string }>;
  readonly unfavoriteCalls: Array<{ userId: string; experienceId: string }>;
  readonly listCalls: Array<{ userId: string }>;
  favoriteError?: Error;
  unfavoriteError?: Error;
  listResult: string[];
}

function makeFakeRepo(): FakeFavoriteRepo {
  const favoriteCalls: Array<{ userId: string; experienceId: string }> = [];
  const unfavoriteCalls: Array<{ userId: string; experienceId: string }> = [];
  const listCalls: Array<{ userId: string }> = [];

  const fake: FakeFavoriteRepo = {
    favoriteCalls,
    unfavoriteCalls,
    listCalls,
    listResult: [],
    async favorite(userId, experienceId) {
      favoriteCalls.push({ userId, experienceId });
      if (fake.favoriteError) throw fake.favoriteError;
    },
    async unfavorite(userId, experienceId) {
      unfavoriteCalls.push({ userId, experienceId });
      if (fake.unfavoriteError) throw fake.unfavoriteError;
    },
    async listFavoriteIds(userId) {
      listCalls.push({ userId });
      return fake.listResult;
    },
  };

  return fake;
}

function buildTestApp(
  repo: FakeFavoriteRepo,
  options: { authenticated?: boolean } = {},
): FastifyInstance {
  const app = Fastify();
  registerErrorHandler(app);

  const requireSession = async (request: any) => {
    if (options.authenticated !== false) {
      request.userId = USER_ID;
    }
  };

  void app.register(
    favoriteRoutes({
      repo,
      requireSession,
    }),
  );

  return app;
}

describe('Favorite HTTP routes', () => {
  let fakeRepo: FakeFavoriteRepo;
  let app: FastifyInstance;

  beforeEach(async () => {
    fakeRepo = makeFakeRepo();
    app = buildTestApp(fakeRepo, { authenticated: true });
    await app.ready();
  });

  describe('Authentication gate (401)', () => {
    it.each([
      ['PUT', `/me/experiences/${EXPERIENCE_ID}/favorite`],
      ['DELETE', `/me/experiences/${EXPERIENCE_ID}/favorite`],
      ['GET', '/me/favorites'],
    ])('rejects anonymous %s %s with 401 unauthorized', async (method, url) => {
      const unauthApp = buildTestApp(fakeRepo, { authenticated: false });
      await unauthApp.ready();

      const response = await unauthApp.inject({
        method: method as any,
        url,
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error?.code).toBe('unauthorized');
    });
  });

  describe('PUT /me/experiences/:id/favorite', () => {
    it('returns 204 on successful favorite and records repo call', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/me/experiences/${EXPERIENCE_ID}/favorite`,
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(fakeRepo.favoriteCalls).toEqual([
        { userId: USER_ID, experienceId: EXPERIENCE_ID },
      ]);
    });

    it('returns 404 experience_not_found when experience is missing or inactive', async () => {
      fakeRepo.favoriteError = new AppError('experience_not_found', 'Experience not found');

      const response = await app.inject({
        method: 'PUT',
        url: `/me/experiences/${EXPERIENCE_ID}/favorite`,
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error?.code).toBe('experience_not_found');
    });

    it('returns 400 validation_failed on invalid UUID', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/me/experiences/${INVALID_UUID}/favorite`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error?.code).toBe('validation_failed');
      expect(fakeRepo.favoriteCalls).toHaveLength(0);
    });

    it('rejects request body with 400 validation_failed', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/me/experiences/${EXPERIENCE_ID}/favorite`,
        payload: { extraField: true },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error?.code).toBe('validation_failed');
      expect(fakeRepo.favoriteCalls).toHaveLength(0);
    });
  });

  describe('DELETE /me/experiences/:id/favorite', () => {
    it('returns 204 on successful unfavorite and records repo call', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/me/experiences/${EXPERIENCE_ID}/favorite`,
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(fakeRepo.unfavoriteCalls).toEqual([
        { userId: USER_ID, experienceId: EXPERIENCE_ID },
      ]);
    });

    it('never invokes any existence check method on repo during unfavorite', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/me/experiences/${EXPERIENCE_ID}/favorite`,
      });

      expect(response.statusCode).toBe(204);
      // Only unfavorite was called; no favorite or list calls were made
      expect(fakeRepo.unfavoriteCalls).toHaveLength(1);
      expect(fakeRepo.favoriteCalls).toHaveLength(0);
      expect(fakeRepo.listCalls).toHaveLength(0);
    });

    it('returns 400 validation_failed on invalid UUID', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/me/experiences/${INVALID_UUID}/favorite`,
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error?.code).toBe('validation_failed');
      expect(fakeRepo.unfavoriteCalls).toHaveLength(0);
    });
  });

  describe('GET /me/favorites', () => {
    it('returns 200 with experienceIds list', async () => {
      fakeRepo.listResult = [EXPERIENCE_ID, '33333333-3333-4333-8333-333333333333'];

      const response = await app.inject({
        method: 'GET',
        url: '/me/favorites',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toEqual({
        experienceIds: [EXPERIENCE_ID, '33333333-3333-4333-8333-333333333333'],
      });
      expect(fakeRepo.listCalls).toEqual([{ userId: USER_ID }]);
    });
  });
});
