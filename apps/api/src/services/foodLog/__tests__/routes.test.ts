/**
 * Integration tests for Food_Item, Food_Item_Log, and User_Submitted_Location routes.
 *
 * Validates: Requirements 1.5, 1.6, 2.1-2.4, 3.1-3.4, 4.1-4.4, 6.1-6.7
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  FoodItemDTO,
  FoodItemLogDTO,
  FoodItemLogHistoryDTO,
  FoodItemLogWithContextDTO,
  LocationSuggestionDTO,
  Park,
  UserSubmittedLocationDTO,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { UserSubmittedLocationRepo } from '../locations.js';
import type {
  CreateFoodItemLogRepoInput,
  UpdateFoodItemLogRepoInput,
  FoodItemLogRepo,
  FoodItemRepo,
} from '../repo.js';
import {
  foodItemLogRoutes,
  foodItemRoutes,
  userSubmittedLocationRoutes,
} from '../routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const FOOD_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const LOG_ID = '55555555-5555-4555-8555-555555555555';

const FIXED_NOW = new Date('2026-06-15T12:00:00Z'); // 2026-06-15 in America/New_York

// ---------------------------------------------------------------------------
// Fake Repos
// ---------------------------------------------------------------------------

function makeFakeFoodItemRepo() {
  return {
    listCalls: [] as string[],
    submitCalls: [] as { experienceId: string; userId: string; name: string }[],
    listLocationCalls: [] as string[],
    submitLocationCalls: [] as { locationId: string; userId: string; name: string }[],
    items: [] as FoodItemDTO[],
    submitError: null as AppError | null,

    async upsertFoodItemsFromMenus() {},
    async listFoodItems(experienceId: string): Promise<readonly FoodItemDTO[]> {
      this.listCalls.push(experienceId);
      return this.items;
    },
    async submitFoodItem(
      experienceId: string,
      userId: string,
      name: string,
    ): Promise<FoodItemDTO> {
      this.submitCalls.push({ experienceId, userId, name });
      if (this.submitError) throw this.submitError;
      return {
        id: FOOD_ITEM_ID,
        experienceId,
        locationId: null,
        name,
        price: null,
        source: 'user_submitted',
        currentlyOnMenu: true,
      };
    },
    async listLocationFoodItems(locationId: string): Promise<readonly FoodItemDTO[]> {
      this.listLocationCalls.push(locationId);
      return this.items;
    },
    async submitLocationFoodItem(
      locationId: string,
      userId: string,
      name: string,
    ): Promise<FoodItemDTO> {
      this.submitLocationCalls.push({ locationId, userId, name });
      if (this.submitError) throw this.submitError;
      return {
        id: FOOD_ITEM_ID,
        experienceId: null,
        locationId,
        name,
        price: null,
        source: 'user_submitted',
        currentlyOnMenu: true,
      };
    },
    async submitScopedFoodItem(): Promise<FoodItemDTO> {
      throw new Error('Not used directly in fake');
    },
    async findFoodItem(id: string): Promise<FoodItemDTO | null> {
      return this.items.find((i) => i.id === id) ?? null;
    },
  };
}

function makeFakeFoodItemLogRepo() {
  return {
    addCalls: [] as CreateFoodItemLogRepoInput[],
    historyCalls: [] as { userId: string; foodItemId: string }[],
    deleteCalls: [] as { userId: string; foodItemId: string; logId: string }[],
    updateCalls: [] as UpdateFoodItemLogRepoInput[],
    allLogsCalls: [] as string[],
    scopedLogsCalls: [] as { userId: string; scope: { experienceId?: string; locationId?: string } }[],
    addError: null as AppError | null,
    historyError: null as AppError | null,
    deleteError: null as AppError | null,
    updateError: null as AppError | null,
    historyResult: {
      foodItemId: FOOD_ITEM_ID,
      repeatCount: 0,
      logs: [],
    } as FoodItemLogHistoryDTO,
    allLogsResult: [] as FoodItemLogWithContextDTO[],
    scopedLogsResult: [] as FoodItemLogWithContextDTO[],
    updateResult: {
      id: LOG_ID,
      userId: USER_ID,
      foodItemId: FOOD_ITEM_ID,
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      loggedAt: '2026-06-15T12:00:00.000Z',
      rating: 8,
      note: 'Updated note',
    } as FoodItemLogDTO,

    async addLog(input: CreateFoodItemLogRepoInput): Promise<FoodItemLogDTO> {
      this.addCalls.push(input);
      if (this.addError) throw this.addError;
      return {
        id: LOG_ID,
        userId: input.userId,
        foodItemId: input.foodItemId,
        visitedOn: input.visitedOn,
        userTz: input.userTz,
        loggedAt: '2026-06-15T12:00:00.000Z',
        rating: input.rating ?? null,
        note: input.note ?? null,
      };
    },
    async getLogHistory(
      userId: string,
      foodItemId: string,
    ): Promise<FoodItemLogHistoryDTO> {
      this.historyCalls.push({ userId, foodItemId });
      if (this.historyError) throw this.historyError;
      return this.historyResult;
    },
    async deleteLog(
      userId: string,
      foodItemId: string,
      logId: string,
    ): Promise<void> {
      this.deleteCalls.push({ userId, foodItemId, logId });
      if (this.deleteError) throw this.deleteError;
    },
    async updateLog(
      input: UpdateFoodItemLogRepoInput,
    ): Promise<FoodItemLogDTO> {
      this.updateCalls.push(input);
      if (this.updateError) throw this.updateError;
      return this.updateResult;
    },
    async getAllLogsForUser(userId: string): Promise<readonly FoodItemLogWithContextDTO[]> {
      this.allLogsCalls.push(userId);
      return this.allLogsResult;
    },
    async getLogsForUserAtScope(
      userId: string,
      scope: { experienceId?: string; locationId?: string },
    ): Promise<readonly FoodItemLogWithContextDTO[]> {
      this.scopedLogsCalls.push({ userId, scope });
      return this.scopedLogsResult;
    },
  };
}

function makeFakeLocationRepo() {
  return {
    createCalls: [] as { userId: string; name: string; park: Park }[],
    suggestCalls: [] as { park: Park; name: string; limit?: number }[],
    createError: null as AppError | null,
    suggestions: [] as LocationSuggestionDTO[],

    async createLocation(
      userId: string,
      name: string,
      park: Park,
    ): Promise<UserSubmittedLocationDTO> {
      this.createCalls.push({ userId, name, park });
      if (this.createError) throw this.createError;
      return {
        id: LOCATION_ID,
        name,
        park,
      };
    },
    async suggestLocations(
      park: Park,
      name: string,
      limit?: number,
    ): Promise<readonly LocationSuggestionDTO[]> {
      const call: { park: Park; name: string; limit?: number } = { park, name };
      if (limit !== undefined) {
        call.limit = limit;
      }
      this.suggestCalls.push(call);
      return this.suggestions;
    },
    async findLocation(id: string): Promise<UserSubmittedLocationDTO | null> {
      return { id, name: 'Spring Roll Cart', park: 'Magic Kingdom' };
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const stubRequireSession = async (request: any) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
    return;
  }
  throw new AppError('unauthorized', 'Authentication required.');
};

async function buildTestApp(deps: {
  foodItemRepo: ReturnType<typeof makeFakeFoodItemRepo>;
  foodItemLogRepo: ReturnType<typeof makeFakeFoodItemLogRepo>;
  locationRepo: ReturnType<typeof makeFakeLocationRepo>;
  menuRetrieval?: { getMenuForRestaurant(id: string): Promise<readonly unknown[]> };
  clock?: () => Date;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  const itemOpts: Parameters<typeof foodItemRoutes>[0] =
    deps.menuRetrieval !== undefined
      ? {
          repo: deps.foodItemRepo as unknown as FoodItemRepo,
          requireSession: stubRequireSession,
          menuRetrieval: deps.menuRetrieval,
        }
      : {
          repo: deps.foodItemRepo as unknown as FoodItemRepo,
          requireSession: stubRequireSession,
        };

  await app.register(foodItemRoutes(itemOpts));

  await app.register(
    foodItemLogRoutes({
      repo: deps.foodItemLogRepo as unknown as FoodItemLogRepo,
      requireSession: stubRequireSession,
      clock: deps.clock ?? (() => FIXED_NOW),
    }),
  );

  await app.register(
    userSubmittedLocationRoutes({
      repo: deps.locationRepo as unknown as UserSubmittedLocationRepo,
      requireSession: stubRequireSession,
    }),
  );

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('foodLog routes', () => {
  let itemRepo: ReturnType<typeof makeFakeFoodItemRepo>;
  let logRepo: ReturnType<typeof makeFakeFoodItemLogRepo>;
  let locRepo: ReturnType<typeof makeFakeLocationRepo>;
  let menuRetrievalCalls: string[];
  let app: FastifyInstance;

  beforeEach(async () => {
    itemRepo = makeFakeFoodItemRepo();
    logRepo = makeFakeFoodItemLogRepo();
    locRepo = makeFakeLocationRepo();
    menuRetrievalCalls = [];

    app = await buildTestApp({
      foodItemRepo: itemRepo,
      foodItemLogRepo: logRepo,
      locationRepo: locRepo,
      menuRetrieval: {
        async getMenuForRestaurant(id) {
          menuRetrievalCalls.push(id);
          return [];
        },
      },
    });
  });

  describe('Food Items (Experience Scope)', () => {
    it('GET /experiences/:id/food-items triggers on-demand menu fetch and returns items', async () => {
      itemRepo.items = [
        {
          id: FOOD_ITEM_ID,
          experienceId: EXPERIENCE_ID,
          locationId: null,
          name: 'Dole Whip',
          price: '$5.99',
          source: 'menu_sync',
          currentlyOnMenu: true,
        },
      ];

      const res = await app.inject({
        method: 'GET',
        url: `/experiences/${EXPERIENCE_ID}/food-items`,
      });

      expect(res.statusCode).toBe(200);
      expect(menuRetrievalCalls).toEqual([EXPERIENCE_ID]);
      expect(itemRepo.listCalls).toEqual([EXPERIENCE_ID]);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.items[0].name).toBe('Dole Whip');
    });

    it('GET /experiences/:id/food-items returns 400 for invalid UUID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/experiences/invalid-uuid/food-items',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    });

    it('POST /experiences/:id/food-items creates user_submitted food item (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/experiences/${EXPERIENCE_ID}/food-items`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { name: 'Secret Citrus Swirl' },
      });

      expect(res.statusCode).toBe(201);
      expect(itemRepo.submitCalls).toEqual([
        { experienceId: EXPERIENCE_ID, userId: USER_ID, name: 'Secret Citrus Swirl' },
      ]);
      const body = res.json();
      expect(body.name).toBe('Secret Citrus Swirl');
      expect(body.source).toBe('user_submitted');
    });

    it('POST /experiences/:id/food-items requires authentication (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/experiences/${EXPERIENCE_ID}/food-items`,
        payload: { name: 'Secret Citrus Swirl' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /experiences/:id/food-items rejects empty or invalid name (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/experiences/${EXPERIENCE_ID}/food-items`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { name: '   ' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    });

    it('POST /experiences/:id/food-items maps food_item_duplicate to 409 with details.existingId', async () => {
      itemRepo.submitError = new AppError(
        'food_item_duplicate',
        'Duplicate dish',
        { details: { existingId: FOOD_ITEM_ID } },
      );

      const res = await app.inject({
        method: 'POST',
        url: `/experiences/${EXPERIENCE_ID}/food-items`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { name: 'Dole Whip' },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe('food_item_duplicate');
      expect(body.error.details.existingId).toBe(FOOD_ITEM_ID);
    });
  });

  describe('Food Items (Location Scope)', () => {
    it('GET /locations/:id/food-items returns location food items (200)', async () => {
      itemRepo.items = [
        {
          id: FOOD_ITEM_ID,
          experienceId: null,
          locationId: LOCATION_ID,
          name: 'Cheeseburger Spring Roll',
          price: null,
          source: 'user_submitted',
          currentlyOnMenu: true,
        },
      ];

      const res = await app.inject({
        method: 'GET',
        url: `/locations/${LOCATION_ID}/food-items`,
      });

      expect(res.statusCode).toBe(200);
      expect(itemRepo.listLocationCalls).toEqual([LOCATION_ID]);
      expect(res.json().items[0].name).toBe('Cheeseburger Spring Roll');
    });

    it('POST /locations/:id/food-items creates location-scoped dish (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/locations/${LOCATION_ID}/food-items`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { name: 'Pastrami Spring Roll' },
      });

      expect(res.statusCode).toBe(201);
      expect(itemRepo.submitLocationCalls).toEqual([
        { locationId: LOCATION_ID, userId: USER_ID, name: 'Pastrami Spring Roll' },
      ]);
      expect(res.json().name).toBe('Pastrami Spring Roll');
    });

    it('POST /locations/:id/food-items requires authentication (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/locations/${LOCATION_ID}/food-items`,
        payload: { name: 'Pastrami Spring Roll' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /locations/:id/food-items returns 409 on duplicate', async () => {
      itemRepo.submitError = new AppError(
        'food_item_duplicate',
        'Duplicate dish',
        { details: { existingId: FOOD_ITEM_ID } },
      );

      const res = await app.inject({
        method: 'POST',
        url: `/locations/${LOCATION_ID}/food-items`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { name: 'Cheeseburger Spring Roll' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('food_item_duplicate');
      expect(res.json().error.details.existingId).toBe(FOOD_ITEM_ID);
    });
  });

  describe('Food Item Logs', () => {
    it('POST /me/food-items/:foodItemId/logs creates dish log (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
          rating: 9,
          note: 'Extra delicious',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(logRepo.addCalls).toEqual([
        {
          userId: USER_ID,
          foodItemId: FOOD_ITEM_ID,
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
          rating: 9,
          note: 'Extra delicious',
        },
      ]);
      const body = res.json();
      expect(body.id).toBe(LOG_ID);
      expect(body.rating).toBe(9);
    });

    it('POST /me/food-items/:foodItemId/logs requires authentication (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /me/food-items/:foodItemId/logs rejects future visitedOn with 400 food_log_future_date', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          visitedOn: '2026-06-16', // Future date relative to 2026-06-15
          userTz: 'America/New_York',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('food_log_future_date');
      expect(body.error.field).toBe('visitedOn');
      expect(logRepo.addCalls).toHaveLength(0);
    });

    it('POST /me/food-items/:foodItemId/logs rejects invalid timezone with 400 validation_failed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'Not/A_Real_Timezone',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
      expect(logRepo.addCalls).toHaveLength(0);
    });

    it('POST /me/food-items/:foodItemId/logs rejects rating outside 1..10 with 400 rating_out_of_range', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
          rating: 11,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('rating_out_of_range');
    });

    it('POST /me/food-items/:foodItemId/logs returns 404 when food item is not found', async () => {
      logRepo.addError = new AppError('food_item_not_found', 'Food item not found');

      const res = await app.inject({
        method: 'POST',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('food_item_not_found');
    });

    it('POST /me/food-items/:foodItemId/logs handles scope exclusivity failure (400 validation_failed)', async () => {
      logRepo.addError = new AppError(
        'validation_failed',
        'Food item must be scoped to exactly one of experience or location',
      );

      const res = await app.inject({
        method: 'POST',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    });

    it('GET /me/food-items/:foodItemId/logs returns log history and repeat count (200)', async () => {
      logRepo.historyResult = {
        foodItemId: FOOD_ITEM_ID,
        repeatCount: 2,
        logs: [
          {
            id: LOG_ID,
            userId: USER_ID,
            foodItemId: FOOD_ITEM_ID,
            visitedOn: '2026-06-15',
            userTz: 'America/New_York',
            loggedAt: '2026-06-15T12:00:00.000Z',
            rating: 10,
            note: 'Second time',
          },
          {
            id: '66666666-6666-4666-8666-666666666666',
            userId: USER_ID,
            foodItemId: FOOD_ITEM_ID,
            visitedOn: '2026-06-10',
            userTz: 'America/New_York',
            loggedAt: '2026-06-10T14:00:00.000Z',
            rating: 9,
            note: 'First time',
          },
        ],
      };

      const res = await app.inject({
        method: 'GET',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(logRepo.historyCalls).toEqual([
        { userId: USER_ID, foodItemId: FOOD_ITEM_ID },
      ]);
      const body = res.json();
      expect(body.repeatCount).toBe(2);
      expect(body.logs).toHaveLength(2);
    });

    it('GET /me/food-items/:foodItemId/logs returns 404 when food item is not found', async () => {
      logRepo.historyError = new AppError('food_item_not_found', 'Food item not found');

      const res = await app.inject({
        method: 'GET',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('food_item_not_found');
    });

    it('DELETE /me/food-items/:foodItemId/logs/:logId deletes log (204)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs/${LOG_ID}`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(204);
      expect(logRepo.deleteCalls).toEqual([
        { userId: USER_ID, foodItemId: FOOD_ITEM_ID, logId: LOG_ID },
      ]);
    });

    it('DELETE /me/food-items/:foodItemId/logs/:logId returns 404 when log not found', async () => {
      logRepo.deleteError = new AppError('food_log_not_found', 'Food item log not found');

      const res = await app.inject({
        method: 'DELETE',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs/${LOG_ID}`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('food_log_not_found');
    });

    it('PATCH /me/food-items/:foodItemId/logs/:logId updates rating and note (200)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs/${LOG_ID}`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          rating: 9,
          note: 'Delicious update',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(logRepo.updateCalls).toEqual([
        {
          userId: USER_ID,
          foodItemId: FOOD_ITEM_ID,
          logId: LOG_ID,
          rating: 9,
          note: 'Delicious update',
        },
      ]);
      const body = res.json();
      expect(body.id).toBe(LOG_ID);
      expect(body.rating).toBe(8); // from fake's updateResult
    });

    it('PATCH /me/food-items/:foodItemId/logs/:logId rejects invalid rating with 400 rating_out_of_range', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs/${LOG_ID}`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          rating: 12,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('rating_out_of_range');
      expect(logRepo.updateCalls).toHaveLength(0);
    });

    it('PATCH /me/food-items/:foodItemId/logs/:logId returns 404 when log not found', async () => {
      logRepo.updateError = new AppError('food_log_not_found', 'Food item log not found');

      const res = await app.inject({
        method: 'PATCH',
        url: `/me/food-items/${FOOD_ITEM_ID}/logs/${LOG_ID}`,
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          rating: 7,
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('food_log_not_found');
    });
  });

  describe('User-Submitted Locations', () => {
    it('POST /locations creates location (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/locations',
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          name: 'Spring Roll Cart',
          park: 'Magic Kingdom',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(locRepo.createCalls).toEqual([
        {
          userId: USER_ID,
          name: 'Spring Roll Cart',
          park: 'Magic Kingdom',
        },
      ]);
      const body = res.json();
      expect(body.id).toBe(LOCATION_ID);
      expect(body.name).toBe('Spring Roll Cart');
    });

    it('POST /locations requires authentication (401)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/locations',
        payload: {
          name: 'Spring Roll Cart',
          park: 'Magic Kingdom',
        },
      });
      expect(res.statusCode).toBe(401);
    });

    it('POST /locations returns 409 on location_duplicate with details.existingId', async () => {
      locRepo.createError = new AppError(
        'location_duplicate',
        'Location duplicate',
        { details: { existingId: LOCATION_ID } },
      );

      const res = await app.inject({
        method: 'POST',
        url: '/locations',
        headers: { 'x-test-user-id': USER_ID },
        payload: {
          name: 'Spring Roll Cart',
          park: 'Magic Kingdom',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe('location_duplicate');
      expect(body.error.details.existingId).toBe(LOCATION_ID);
    });

    it('GET /locations/suggest returns ranked suggestions (200)', async () => {
      locRepo.suggestions = [
        { id: LOCATION_ID, name: 'Spring Roll Cart', similarity: 0.95 },
        { id: '77777777-7777-4777-8777-777777777777', name: 'Spring Roll Wagon', similarity: 0.75 },
      ];

      const res = await app.inject({
        method: 'GET',
        url: '/locations/suggest?park=Magic%20Kingdom&name=Spring%20Roll',
      });

      expect(res.statusCode).toBe(200);
      expect(locRepo.suggestCalls).toEqual([
        { park: 'Magic Kingdom', name: 'Spring Roll', limit: undefined },
      ]);
      const body = res.json();
      expect(body.suggestions).toHaveLength(2);
      expect(body.suggestions[0].similarity).toBe(0.95);
    });

    it('GET /locations/suggest supports q parameter as fallback', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/locations/suggest?park=Magic%20Kingdom&q=Spring',
      });

      expect(res.statusCode).toBe(200);
      expect(locRepo.suggestCalls).toEqual([
        { park: 'Magic Kingdom', name: 'Spring', limit: undefined },
      ]);
    });

    it('GET /locations/suggest rejects missing search name/q with 400 validation_failed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/locations/suggest?park=Magic%20Kingdom',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    });

    it('GET /locations/suggest rejects invalid park with 400 validation_failed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/locations/suggest?park=NotAPark&name=Test',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    });
  });

  describe('GET /me/food-item-logs and scoped food log endpoints (R8, R9)', () => {
    const mockContextLog: FoodItemLogWithContextDTO = {
      id: LOG_ID,
      userId: USER_ID,
      foodItemId: FOOD_ITEM_ID,
      visitedOn: '2026-06-15',
      userTz: 'America/New_York',
      loggedAt: '2026-06-15T12:00:00.000Z',
      rating: 9,
      note: 'Superb dish',
      foodItemName: 'Grey Stuff',
      currentlyOnMenu: true,
      restaurantName: 'Be Our Guest',
      locationName: null,
    };

    it('GET /me/food-item-logs rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/me/food-item-logs',
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    });

    it('GET /me/food-item-logs returns full history for authenticated user', async () => {
      logRepo.allLogsResult = [mockContextLog];

      const res = await app.inject({
        method: 'GET',
        url: '/me/food-item-logs',
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(logRepo.allLogsCalls).toEqual([USER_ID]);
      expect(res.json()).toEqual([mockContextLog]);
    });

    it('GET /me/food-item-logs returns empty list with 200 when user has no logs', async () => {
      logRepo.allLogsResult = [];

      const res = await app.inject({
        method: 'GET',
        url: '/me/food-item-logs',
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('GET /experiences/:id/food-item-logs/mine rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/experiences/${EXPERIENCE_ID}/food-item-logs/mine`,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    });

    it('GET /experiences/:id/food-item-logs/mine rejects malformed UUID with 400 validation_failed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/experiences/not-a-uuid/food-item-logs/mine',
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    });

    it('GET /experiences/:id/food-item-logs/mine returns scoped logs for authenticated user', async () => {
      logRepo.scopedLogsResult = [mockContextLog];

      const res = await app.inject({
        method: 'GET',
        url: `/experiences/${EXPERIENCE_ID}/food-item-logs/mine`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(logRepo.scopedLogsCalls).toEqual([
        { userId: USER_ID, scope: { experienceId: EXPERIENCE_ID } },
      ]);
      expect(res.json()).toEqual([mockContextLog]);
    });

    it('GET /experiences/:id/food-item-logs/mine returns empty list with 200 for logless restaurant', async () => {
      logRepo.scopedLogsResult = [];

      const res = await app.inject({
        method: 'GET',
        url: `/experiences/${EXPERIENCE_ID}/food-item-logs/mine`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });

    it('GET /locations/:id/food-item-logs/mine rejects unauthenticated requests with 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/locations/${LOCATION_ID}/food-item-logs/mine`,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    });

    it('GET /locations/:id/food-item-logs/mine rejects malformed UUID with 400 validation_failed', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/locations/invalid-uuid/food-item-logs/mine',
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
    });

    it('GET /locations/:id/food-item-logs/mine returns scoped logs for authenticated user', async () => {
      const locationLog: FoodItemLogWithContextDTO = {
        ...mockContextLog,
        restaurantName: null,
        locationName: 'Spring Roll Cart',
      };
      logRepo.scopedLogsResult = [locationLog];

      const res = await app.inject({
        method: 'GET',
        url: `/locations/${LOCATION_ID}/food-item-logs/mine`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(logRepo.scopedLogsCalls).toEqual([
        { userId: USER_ID, scope: { locationId: LOCATION_ID } },
      ]);
      expect(res.json()).toEqual([locationLog]);
    });

    it('GET /locations/:id/food-item-logs/mine returns empty list with 200 for logless location', async () => {
      logRepo.scopedLogsResult = [];

      const res = await app.inject({
        method: 'GET',
        url: `/locations/${LOCATION_ID}/food-item-logs/mine`,
        headers: { 'x-test-user-id': USER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });
});
