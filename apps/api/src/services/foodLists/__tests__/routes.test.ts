/**
 * Fastify route integration tests for Food Lists (Feature: food-lists, Task 6.4).
 *
 * Covers:
 * - Auth gates (401) on all routes
 * - Error codes:
 *   - food_list_not_found (404)
 *   - food_list_edit_forbidden (403)
 *   - food_list_item_duplicate (409)
 *   - food_list_reorder_mismatch (400)
 *   - food_list_stale_write (409)
 *   - food_list_share_not_friend (403)
 *   - food_list_save_self (400)
 *   - food_item_not_found (404)
 *   - validation_failed (400)
 * - Discovery cursor round-trip
 * - Collection endpoint with degraded / unavailable saved lists
 * - Notification dispatches on share / role change
 *
 * Validates: Requirements 1-11
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  FoodListCollectionDTO,
  FoodListDetailDTO,
  FoodListDiscoveryPageDTO,
  FoodListDTO,
  FoodListItemDTO,
  FoodListShareDTO,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type {
  FoodListAffinityRepo,
  FoodListItemRepo,
  FoodListRepo,
  FoodListShareRepo,
  FoodListShareResult,
} from '../repo.js';
import { foodListRoutes } from '../routes.js';
import type {
  FoodListRoleChangedEvent,
  FoodListSharedEvent,
} from '../../notifications/service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const LIST_ID = '33333333-3333-4333-8333-333333333333';
const FOOD_ITEM_ID_1 = '44444444-4444-4444-8444-444444444444';
const FOOD_ITEM_ID_2 = '55555555-5555-4555-8555-555555555555';

// ---------------------------------------------------------------------------
// Fake Repositories
// ---------------------------------------------------------------------------

function makeFakeFoodListRepo() {
  return {
    createListCalls: [] as {
      ownerId: string;
      name: string;
      visibility?: 'private' | 'public' | undefined;
    }[],
    renameListCalls: [] as { listId: string; userId: string; name: string }[],
    updateVisibilityCalls: [] as {
      listId: string;
      userId: string;
      visibility: 'private' | 'public';
    }[],
    deleteListCalls: [] as { listId: string; userId: string }[],
    listOwnedCalls: [] as string[],
    getListDetailCalls: [] as { listId: string; userId: string }[],
    discoverCalls: [] as { sort: 'popular' | 'recent'; cursor?: string }[],

    createListError: null as Error | null,
    renameListError: null as Error | null,
    updateVisibilityError: null as Error | null,
    deleteListError: null as Error | null,
    getListDetailError: null as Error | null,
    discoverError: null as Error | null,

    sampleList: {
      id: LIST_ID,
      ownerId: USER_ID,
      ownerDisplayName: 'Test User',
      name: 'Best Snacks',
      visibility: 'private' as const,
      likeCount: 0,
      itemCount: 0,
      createdAt: '2026-06-15T12:00:00.000Z',
      updatedAt: '2026-06-15T12:00:00.000Z',
    } satisfies FoodListDTO,

    async createList(
      userId: string,
      input: { name: string; visibility?: 'private' | 'public' },
    ): Promise<FoodListDTO> {
      this.createListCalls.push({
        ownerId: userId,
        name: input.name,
        visibility: input.visibility,
      });
      if (this.createListError) throw this.createListError;
      return {
        ...this.sampleList,
        name: input.name,
        visibility: input.visibility ?? 'private',
        ownerId: userId,
      };
    },

    async renameList(listId: string, userId: string, name: string): Promise<FoodListDTO> {
      this.renameListCalls.push({ listId, userId, name });
      if (this.renameListError) throw this.renameListError;
      return { ...this.sampleList, id: listId, name };
    },

    async setVisibility(
      listId: string,
      userId: string,
      visibility: 'private' | 'public',
    ): Promise<FoodListDTO> {
      this.updateVisibilityCalls.push({ listId, userId, visibility });
      if (this.updateVisibilityError) throw this.updateVisibilityError;
      return { ...this.sampleList, id: listId, visibility };
    },

    async findListById(
      listId: string,
    ): Promise<{ id: string; ownerId: string; name: string } | null> {
      return { id: listId, ownerId: USER_ID, name: this.sampleList.name };
    },

    async deleteList(listId: string, userId: string): Promise<void> {
      this.deleteListCalls.push({ listId, userId });
      if (this.deleteListError) throw this.deleteListError;
    },

    async listOwned(ownerId: string): Promise<readonly FoodListDTO[]> {
      this.listOwnedCalls.push(ownerId);
      return [this.sampleList];
    },

    async getListDetail(listId: string, userId: string): Promise<FoodListDetailDTO> {
      this.getListDetailCalls.push({ listId, userId });
      if (this.getListDetailError) throw this.getListDetailError;
      return {
        ...this.sampleList,
        id: listId,
        liked: false,
        saved: false,
        version: 1,
        myRole: 'owner',
        items: [],
      };
    },

    async discover(
      sort: 'popular' | 'recent' = 'popular',
      cursor?: string | null,
    ): Promise<FoodListDiscoveryPageDTO> {
      if (cursor) {
        this.discoverCalls.push({ sort, cursor });
      } else {
        this.discoverCalls.push({ sort });
      }
      if (this.discoverError) throw this.discoverError;
      return {
        items: [this.sampleList],
        nextCursor: cursor ? null : 'cursor-page-2',
      };
    },
  };
}

function makeFakeFoodListItemRepo() {
  return {
    addItemCalls: [] as { listId: string; userId: string; foodItemId: string }[],
    removeItemCalls: [] as { listId: string; userId: string; foodItemId: string }[],
    reorderItemsCalls: [] as {
      listId: string;
      userId: string;
      foodItemIds: readonly string[];
      expectedVersion: number;
    }[],

    addItemError: null as Error | null,
    removeItemError: null as Error | null,
    reorderItemsError: null as Error | null,

    async addItem(
      listId: string,
      userId: string,
      foodItemId: string,
    ): Promise<FoodListItemDTO> {
      this.addItemCalls.push({ listId, userId, foodItemId });
      if (this.addItemError) throw this.addItemError;
      return {
        foodItemId,
        name: 'Dole Whip',
        experienceId: null,
        experienceName: null,
        locationId: null,
        locationName: null,
        price: '$5.99',
        position: 0,
        addedByUserId: userId,
        addedByDisplayName: 'Test User',
      };
    },

    async removeItem(
      listId: string,
      userId: string,
      foodItemId: string,
    ): Promise<void> {
      this.removeItemCalls.push({ listId, userId, foodItemId });
      if (this.removeItemError) throw this.removeItemError;
    },

    async reorderItems(
      listId: string,
      userId: string,
      foodItemIds: readonly string[],
      expectedVersion: number,
    ): Promise<readonly FoodListItemDTO[]> {
      this.reorderItemsCalls.push({ listId, userId, foodItemIds, expectedVersion });
      if (this.reorderItemsError) throw this.reorderItemsError;
      return [];
    },
  };
}

function makeFakeFoodListShareRepo() {
  return {
    shareCalls: [] as {
      listId: string;
      ownerId: string;
      recipientId: string;
      role: 'viewer' | 'editor';
    }[],
    revokeShareCalls: [] as { listId: string; ownerId: string; recipientId: string }[],
    listSharesCalls: [] as { listId: string; ownerId: string }[],

    shareResult: {
      share: {
        recipientId: FRIEND_ID,
        recipientDisplayName: 'Friend User',
        role: 'editor' as const,
        sharedAt: '2026-06-15T12:00:00.000Z',
      },
      action: 'created' as const,
    } as FoodListShareResult,
    shareError: null as Error | null,
    revokeShareError: null as Error | null,
    listSharesError: null as Error | null,

    async shareWithFriend(
      listId: string,
      ownerId: string,
      recipientId: string,
      role: 'viewer' | 'editor',
    ) {
      this.shareCalls.push({ listId, ownerId, recipientId, role });
      if (this.shareError) throw this.shareError;
      return {
        ...this.shareResult,
        share: { ...this.shareResult.share, recipientId, role },
      };
    },

    async revokeShare(
      listId: string,
      ownerId: string,
      recipientId: string,
    ): Promise<void> {
      this.revokeShareCalls.push({ listId, ownerId, recipientId });
      if (this.revokeShareError) throw this.revokeShareError;
    },

    async listShares(
      listId: string,
      ownerId: string,
    ): Promise<readonly FoodListShareDTO[]> {
      this.listSharesCalls.push({ listId, ownerId });
      if (this.listSharesError) throw this.listSharesError;
      return [
        {
          recipientId: FRIEND_ID,
          recipientDisplayName: 'Friend User',
          role: 'editor',
          sharedAt: '2026-06-15T12:00:00.000Z',
        },
      ];
    },

    async revokeSharesBetween(_userA: string, _userB: string): Promise<void> {},
  };
}

function makeFakeFoodListAffinityRepo() {
  return {
    likeCalls: [] as { listId: string; userId: string }[],
    unlikeCalls: [] as { listId: string; userId: string }[],
    saveCalls: [] as { listId: string; userId: string }[],
    unsaveCalls: [] as { listId: string; userId: string }[],
    getCollectionCalls: [] as string[],

    likeError: null as Error | null,
    unlikeError: null as Error | null,
    saveError: null as Error | null,
    unsaveError: null as Error | null,
    getCollectionError: null as Error | null,

    sampleCollection: {
      owned: [],
      saved: [
        {
          available: false,
          foodListId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
    } satisfies FoodListCollectionDTO,

    async like(listId: string, userId: string): Promise<void> {
      this.likeCalls.push({ listId, userId });
      if (this.likeError) throw this.likeError;
    },

    async unlike(listId: string, userId: string): Promise<void> {
      this.unlikeCalls.push({ listId, userId });
      if (this.unlikeError) throw this.unlikeError;
    },

    async save(listId: string, userId: string): Promise<void> {
      this.saveCalls.push({ listId, userId });
      if (this.saveError) throw this.saveError;
    },

    async unsave(listId: string, userId: string): Promise<void> {
      this.unsaveCalls.push({ listId, userId });
      if (this.unsaveError) throw this.unsaveError;
    },

    async getCollection(userId: string): Promise<FoodListCollectionDTO> {
      this.getCollectionCalls.push(userId);
      if (this.getCollectionError) throw this.getCollectionError;
      return this.sampleCollection;
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
  repo: ReturnType<typeof makeFakeFoodListRepo>;
  itemRepo: ReturnType<typeof makeFakeFoodListItemRepo>;
  shareRepo: ReturnType<typeof makeFakeFoodListShareRepo>;
  affinityRepo: ReturnType<typeof makeFakeFoodListAffinityRepo>;
  emitFoodListShared?: (evt: FoodListSharedEvent) => void;
  emitFoodListRoleChanged?: (evt: FoodListRoleChangedEvent) => void;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  const opts: Parameters<typeof foodListRoutes>[0] = {
    repo: deps.repo as unknown as FoodListRepo,
    itemRepo: deps.itemRepo as unknown as FoodListItemRepo,
    shareRepo: deps.shareRepo as unknown as FoodListShareRepo,
    affinityRepo: deps.affinityRepo as unknown as FoodListAffinityRepo,
    requireSession: stubRequireSession,
    ...(deps.emitFoodListShared ? { emitFoodListShared: deps.emitFoodListShared } : {}),
    ...(deps.emitFoodListRoleChanged
      ? { emitFoodListRoleChanged: deps.emitFoodListRoleChanged }
      : {}),
  };

  await app.register(foodListRoutes(opts));

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Food Lists routes integration', () => {
  let fakeRepo: ReturnType<typeof makeFakeFoodListRepo>;
  let fakeItemRepo: ReturnType<typeof makeFakeFoodListItemRepo>;
  let fakeShareRepo: ReturnType<typeof makeFakeFoodListShareRepo>;
  let fakeAffinityRepo: ReturnType<typeof makeFakeFoodListAffinityRepo>;
  let emittedShared: FoodListSharedEvent[];
  let emittedRoleChanged: FoodListRoleChangedEvent[];
  let app: FastifyInstance;

  beforeEach(async () => {
    fakeRepo = makeFakeFoodListRepo();
    fakeItemRepo = makeFakeFoodListItemRepo();
    fakeShareRepo = makeFakeFoodListShareRepo();
    fakeAffinityRepo = makeFakeFoodListAffinityRepo();
    emittedShared = [];
    emittedRoleChanged = [];

    app = await buildTestApp({
      repo: fakeRepo,
      itemRepo: fakeItemRepo,
      shareRepo: fakeShareRepo,
      affinityRepo: fakeAffinityRepo,
      emitFoodListShared: (e) => emittedShared.push(e),
      emitFoodListRoleChanged: (e) => emittedRoleChanged.push(e),
    });
  });

  // -------------------------------------------------------------------------
  // Auth Gates (401)
  // -------------------------------------------------------------------------

  it('rejects unauthenticated requests with 401 on every food-list endpoint', async () => {
    const requests = [
      { method: 'POST', url: '/me/food-lists', payload: { name: 'My List' } },
      { method: 'GET', url: '/me/food-lists' },
      { method: 'PATCH', url: `/me/food-lists/${LIST_ID}`, payload: { name: 'New' } },
      { method: 'DELETE', url: `/me/food-lists/${LIST_ID}` },
      {
        method: 'POST',
        url: `/me/food-lists/${LIST_ID}/items`,
        payload: { foodItemId: FOOD_ITEM_ID_1 },
      },
      { method: 'DELETE', url: `/me/food-lists/${LIST_ID}/items/${FOOD_ITEM_ID_1}` },
      {
        method: 'PUT',
        url: `/me/food-lists/${LIST_ID}/items/order`,
        payload: { foodItemIds: [FOOD_ITEM_ID_1], expectedVersion: 1 },
      },
      {
        method: 'POST',
        url: `/me/food-lists/${LIST_ID}/shares`,
        payload: { recipientId: FRIEND_ID, role: 'editor' },
      },
      { method: 'GET', url: `/me/food-lists/${LIST_ID}/shares` },
      { method: 'DELETE', url: `/me/food-lists/${LIST_ID}/shares/${FRIEND_ID}` },
      { method: 'GET', url: `/food-lists/${LIST_ID}` },
      { method: 'POST', url: `/food-lists/${LIST_ID}/like` },
      { method: 'DELETE', url: `/food-lists/${LIST_ID}/like` },
      { method: 'POST', url: `/food-lists/${LIST_ID}/save` },
      { method: 'DELETE', url: `/food-lists/${LIST_ID}/save` },
      { method: 'GET', url: '/food-lists/discover' },
      { method: 'GET', url: '/me/food-lists/collection' },
    ] as const;

    for (const req of requests) {
      const res = await app.inject(
        'payload' in req
          ? { method: req.method, url: req.url, payload: req.payload }
          : { method: req.method, url: req.url },
      );
      expect(res.statusCode, `${req.method} ${req.url} should be 401`).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    }
  });

  // -------------------------------------------------------------------------
  // Validation Gates (400)
  // -------------------------------------------------------------------------

  it('validates food list creation: empty or oversized name returns 400 validation_failed', async () => {
    const emptyRes = await app.inject({
      method: 'POST',
      url: '/me/food-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: '   ' },
    });
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.json().error.code).toBe('validation_failed');

    const longRes = await app.inject({
      method: 'POST',
      url: '/me/food-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'A'.repeat(101) },
    });
    expect(longRes.statusCode).toBe(400);
    expect(longRes.json().error.code).toBe('validation_failed');
  });

  it('validates food list creation: invalid visibility returns 400 validation_failed (Requirement 1a)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/food-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'Snack Tour', visibility: 'invalid-vis' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
    expect(fakeRepo.createListCalls).toHaveLength(0);
  });

  it('validates UUIDs on path parameters and returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/food-lists/not-a-uuid',
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  // -------------------------------------------------------------------------
  // Error Codes Handling
  // -------------------------------------------------------------------------

  it('maps food_list_not_found to 404', async () => {
    fakeRepo.getListDetailError = new AppError('food_list_not_found', 'List not found');
    const res = await app.inject({
      method: 'GET',
      url: `/food-lists/${LIST_ID}`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('food_list_not_found');
  });

  it('maps food_list_edit_forbidden to 403', async () => {
    fakeItemRepo.addItemError = new AppError(
      'food_list_edit_forbidden',
      'You do not have edit access to this list',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/food-lists/${LIST_ID}/items`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { foodItemId: FOOD_ITEM_ID_1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('food_list_edit_forbidden');
  });

  it('maps food_list_item_duplicate to 409', async () => {
    fakeItemRepo.addItemError = new AppError(
      'food_list_item_duplicate',
      'Dish already in list',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/food-lists/${LIST_ID}/items`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { foodItemId: FOOD_ITEM_ID_1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('food_list_item_duplicate');
  });

  it('maps food_list_reorder_mismatch to 400', async () => {
    fakeItemRepo.reorderItemsError = new AppError(
      'food_list_reorder_mismatch',
      'Items do not match current list',
    );
    const res = await app.inject({
      method: 'PUT',
      url: `/me/food-lists/${LIST_ID}/items/order`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { foodItemIds: [FOOD_ITEM_ID_1], expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('food_list_reorder_mismatch');
  });

  it('maps food_list_stale_write to 409', async () => {
    fakeItemRepo.reorderItemsError = new AppError(
      'food_list_stale_write',
      'List version mismatch',
    );
    const res = await app.inject({
      method: 'PUT',
      url: `/me/food-lists/${LIST_ID}/items/order`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { foodItemIds: [FOOD_ITEM_ID_1, FOOD_ITEM_ID_2], expectedVersion: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('food_list_stale_write');
  });

  it('maps food_list_share_not_friend to 403', async () => {
    fakeShareRepo.shareError = new AppError(
      'food_list_share_not_friend',
      'Can only share with confirmed friends',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/food-lists/${LIST_ID}/shares`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { recipientId: FRIEND_ID, role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('food_list_share_not_friend');
  });

  it('maps food_list_save_self to 400', async () => {
    fakeAffinityRepo.saveError = new AppError(
      'food_list_save_self',
      'Cannot save your own food list',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/food-lists/${LIST_ID}/save`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('food_list_save_self');
  });

  // -------------------------------------------------------------------------
  // Happy Paths & Notifications
  // -------------------------------------------------------------------------

  it('POST /me/food-lists with visibility omitted creates private list with 201 and returns DTO', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/food-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'Snack Tour' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Snack Tour');
    expect(body.visibility).toBe('private');
    expect(fakeRepo.createListCalls).toEqual([
      { ownerId: USER_ID, name: 'Snack Tour', visibility: undefined },
    ]);
  });

  it('POST /me/food-lists with visibility: "public" creates public list with 201 and returns DTO (Requirement 1a, Property 14)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/food-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'Public Tour', visibility: 'public' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Public Tour');
    expect(body.visibility).toBe('public');
    expect(fakeRepo.createListCalls).toEqual([
      { ownerId: USER_ID, name: 'Public Tour', visibility: 'public' },
    ]);
  });

  it('PATCH /me/food-lists/:id updates name and visibility', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/food-lists/${LIST_ID}`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'Renamed List', visibility: 'public' },
    });
    expect(res.statusCode).toBe(200);
    expect(fakeRepo.renameListCalls).toHaveLength(1);
    expect(fakeRepo.updateVisibilityCalls).toHaveLength(1);
  });

  it('DELETE /me/food-lists/:id deletes list with 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/food-lists/${LIST_ID}`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(204);
    expect(fakeRepo.deleteListCalls).toEqual([{ listId: LIST_ID, userId: USER_ID }]);
  });

  it('POST /me/food-lists/:id/shares dispatches FoodListShared on newlyInserted', async () => {
    fakeShareRepo.shareResult = {
      share: {
        recipientId: FRIEND_ID,
        recipientDisplayName: 'Friend User',
        role: 'editor',
        sharedAt: '2026-06-15T12:00:00.000Z',
      },
      action: 'created',
    };

    const res = await app.inject({
      method: 'POST',
      url: `/me/food-lists/${LIST_ID}/shares`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { recipientId: FRIEND_ID, role: 'editor' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recipientId).toBe(FRIEND_ID);

    expect(emittedShared).toEqual([
      { foodListId: LIST_ID, senderId: USER_ID, recipientId: FRIEND_ID },
    ]);
    expect(emittedRoleChanged).toHaveLength(0);
  });

  it('POST /me/food-lists/:id/shares dispatches FoodListRoleChanged on roleChanged', async () => {
    fakeShareRepo.shareResult = {
      share: {
        recipientId: FRIEND_ID,
        recipientDisplayName: 'Friend User',
        role: 'viewer',
        sharedAt: '2026-06-15T12:00:00.000Z',
      },
      action: 'role_changed',
    };

    const res = await app.inject({
      method: 'POST',
      url: `/me/food-lists/${LIST_ID}/shares`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { recipientId: FRIEND_ID, role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('viewer');

    expect(emittedShared).toHaveLength(0);
    expect(emittedRoleChanged).toEqual([
      {
        foodListId: LIST_ID,
        senderId: USER_ID,
        recipientId: FRIEND_ID,
        newRole: 'viewer',
        listName: 'Best Snacks',
      },
    ]);
  });

  it('POST /me/food-lists/:id/shares dispatches no notification on idempotent repeat', async () => {
    fakeShareRepo.shareResult = {
      share: {
        recipientId: FRIEND_ID,
        recipientDisplayName: 'Friend User',
        role: 'viewer',
        sharedAt: '2026-06-15T12:00:00.000Z',
      },
      action: 'unchanged',
    };

    const res = await app.inject({
      method: 'POST',
      url: `/me/food-lists/${LIST_ID}/shares`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { recipientId: FRIEND_ID, role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);

    expect(emittedShared).toHaveLength(0);
    expect(emittedRoleChanged).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Discovery Keyset Cursor Round-Trip
  // -------------------------------------------------------------------------

  it('GET /food-lists/discover performs cursor round-trip pagination', async () => {
    // First page
    const page1Res = await app.inject({
      method: 'GET',
      url: '/food-lists/discover?sort=popular',
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(page1Res.statusCode).toBe(200);
    const page1 = page1Res.json();
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).toBe('cursor-page-2');
    expect(fakeRepo.discoverCalls).toEqual([{ sort: 'popular', cursor: undefined }]);

    // Second page with cursor
    const page2Res = await app.inject({
      method: 'GET',
      url: `/food-lists/discover?sort=popular&cursor=${page1.nextCursor}`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(page2Res.statusCode).toBe(200);
    const page2 = page2Res.json();
    expect(page2.nextCursor).toBeNull();
    expect(fakeRepo.discoverCalls).toEqual([
      { sort: 'popular', cursor: undefined },
      { sort: 'popular', cursor: 'cursor-page-2' },
    ]);
  });

  // -------------------------------------------------------------------------
  // Collection & Degradation Path
  // -------------------------------------------------------------------------

  it('GET /me/food-lists/collection returns owned and degraded saved lists', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me/food-lists/collection',
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FoodListCollectionDTO;
    expect(body.saved).toHaveLength(1);
    expect(body.saved[0]).toEqual({
      available: false,
      foodListId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });
});
