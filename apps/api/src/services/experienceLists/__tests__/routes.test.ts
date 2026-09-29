/**
 * Fastify route integration tests for Experience Lists (Feature:
 * experience-lists, Task 6.4).
 *
 * Structural port of `apps/api/src/services/foodLists/__tests__/routes.test.ts`
 * — same fake-repo/call-recording harness, same `stubRequireSession` reading
 * `x-test-user-id`. Differs from that precedent in: (1) no checklist
 * concept (skip entirely), (2) no `DELETE /experience-lists/:id/save` route
 * (task 6.1 deliberately didn't wire it), (3) route paths/params use
 * `experience-lists`/`experienceId`, (4) two additional error codes this
 * spec has that `food-lists` doesn't: `experience_not_found` and
 * `experience_list_dining_ineligible`.
 *
 * Covers:
 * - Auth gates (401) on all wired routes
 * - Validation gates (400): empty/oversized name, invalid visibility,
 *   invalid UUID param
 * - Error codes:
 *   - experience_list_not_found (404)
 *   - experience_list_edit_forbidden (403)
 *   - experience_list_item_duplicate (409)
 *   - experience_not_found (404)
 *   - experience_list_dining_ineligible (400)
 *   - experience_list_reorder_mismatch (400)
 *   - experience_list_stale_write (409)
 *   - experience_list_share_not_friend (403)
 *   - experience_list_save_self (400)
 * - Happy paths: create/patch/delete
 * - Share notification dispatch: created / role_changed / unchanged
 * - Discovery cursor round-trip
 * - Collection endpoint degradation path
 *
 * Validates: Requirements 1.5, 2.2, 2.3, 2.6, 2.7, 2.9, 4.2, 5.1, 6.6, 6.7.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  CreateExperienceListInputDTO,
  ExperienceListCollectionDTO,
  ExperienceListDetailDTO,
  ExperienceListDiscoveryPageDTO,
  ExperienceListDTO,
  ExperienceListItemDTO,
  ExperienceListShareDTO,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type {
  ExperienceListAffinityRepo,
  ExperienceListItemRepo,
  ExperienceListRepo,
  ExperienceListShareRepo,
  ExperienceListShareResult,
} from '../repo.js';
import { experienceListRoutes } from '../routes.js';
import type {
  ExperienceListRoleChangedEvent,
  ExperienceListSharedEvent,
} from '../../notifications/service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const LIST_ID = '33333333-3333-4333-8333-333333333333';
const EXPERIENCE_ID_1 = '44444444-4444-4444-8444-444444444444';
const EXPERIENCE_ID_2 = '55555555-5555-4555-8555-555555555555';

// ---------------------------------------------------------------------------
// Fake Repositories
// ---------------------------------------------------------------------------

function makeFakeExperienceListRepo() {
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
    discoverCalls: [] as { sort: string; cursor?: string }[],
    setPinnedCalls: [] as {
      listId: string;
      userId: string;
      pinned: boolean;
    }[],

    createListError: null as Error | null,
    renameListError: null as Error | null,
    updateVisibilityError: null as Error | null,
    deleteListError: null as Error | null,
    getListDetailError: null as Error | null,
    discoverError: null as Error | null,
    setPinnedError: null as Error | null,

    sampleList: {
      id: LIST_ID,
      ownerId: USER_ID,
      ownerDisplayName: 'Test User',
      name: 'Thrill Rides',
      visibility: 'private' as const,
      likeCount: 0,
      itemCount: 0,
      createdAt: '2026-06-15T12:00:00.000Z',
      updatedAt: '2026-06-15T12:00:00.000Z',
      pinnedAt: null,
    } satisfies ExperienceListDTO,

    async createList(
      userId: string,
      input: CreateExperienceListInputDTO,
    ): Promise<ExperienceListDTO> {
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

    async renameList(listId: string, userId: string, name: string): Promise<ExperienceListDTO> {
      this.renameListCalls.push({ listId, userId, name });
      if (this.renameListError) throw this.renameListError;
      return { ...this.sampleList, id: listId, name };
    },

    async setVisibility(
      listId: string,
      userId: string,
      visibility: 'private' | 'public',
    ): Promise<ExperienceListDTO> {
      this.updateVisibilityCalls.push({ listId, userId, visibility });
      if (this.updateVisibilityError) throw this.updateVisibilityError;
      return { ...this.sampleList, id: listId, visibility };
    },

    async setPinned(
      listId: string,
      userId: string,
      pinned: boolean,
    ): Promise<ExperienceListDTO> {
      this.setPinnedCalls.push({ listId, userId, pinned });
      if (this.setPinnedError) throw this.setPinnedError;
      return {
        ...this.sampleList,
        id: listId,
        pinnedAt: pinned ? '2026-09-20T08:00:00.000Z' : null,
      };
    },

    async deleteList(listId: string, userId: string): Promise<void> {
      this.deleteListCalls.push({ listId, userId });
      if (this.deleteListError) throw this.deleteListError;
    },

    async listOwned(ownerId: string): Promise<readonly ExperienceListDTO[]> {
      this.listOwnedCalls.push(ownerId);
      return [this.sampleList];
    },

    async getListDetail(listId: string, userId: string): Promise<ExperienceListDetailDTO> {
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

    async resolveForAttachEligibility(): Promise<{
      ownerId: string;
      visibility: 'private' | 'public';
    } | null> {
      return { ownerId: USER_ID, visibility: 'private' };
    },

    async discover(
      sort: 'popular' | 'recent' = 'popular',
      cursor?: string | null,
    ): Promise<ExperienceListDiscoveryPageDTO> {
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

function makeFakeExperienceListItemRepo() {
  return {
    addItemCalls: [] as { listId: string; userId: string; experienceId: string }[],
    removeItemCalls: [] as { listId: string; userId: string; experienceId: string }[],
    reorderItemsCalls: [] as {
      listId: string;
      userId: string;
      experienceIds: readonly string[];
      expectedVersion: number;
    }[],

    addItemError: null as Error | null,
    removeItemError: null as Error | null,
    reorderItemsError: null as Error | null,

    async addItem(
      listId: string,
      userId: string,
      experienceId: string,
    ): Promise<ExperienceListItemDTO> {
      this.addItemCalls.push({ listId, userId, experienceId });
      if (this.addItemError) throw this.addItemError;
      return {
        experienceId,
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        position: 0,
        addedByUserId: userId,
        addedByDisplayName: 'Test User',
      } as ExperienceListItemDTO;
    },

    async removeItem(listId: string, userId: string, experienceId: string): Promise<void> {
      this.removeItemCalls.push({ listId, userId, experienceId });
      if (this.removeItemError) throw this.removeItemError;
    },

    async reorderItems(
      listId: string,
      userId: string,
      experienceIds: readonly string[],
      expectedVersion: number,
    ): Promise<readonly ExperienceListItemDTO[]> {
      this.reorderItemsCalls.push({ listId, userId, experienceIds, expectedVersion });
      if (this.reorderItemsError) throw this.reorderItemsError;
      return [];
    },
  };
}

function makeFakeExperienceListShareRepo() {
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
    } as ExperienceListShareResult,
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

    async revokeShare(listId: string, ownerId: string, recipientId: string): Promise<void> {
      this.revokeShareCalls.push({ listId, ownerId, recipientId });
      if (this.revokeShareError) throw this.revokeShareError;
    },

    async listShares(
      listId: string,
      ownerId: string,
    ): Promise<readonly ExperienceListShareDTO[]> {
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

function makeFakeExperienceListAffinityRepo() {
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
          experienceListId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        },
      ],
    } satisfies ExperienceListCollectionDTO,

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

    async getCollection(userId: string): Promise<ExperienceListCollectionDTO> {
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
  repo: ReturnType<typeof makeFakeExperienceListRepo>;
  itemRepo: ReturnType<typeof makeFakeExperienceListItemRepo>;
  shareRepo: ReturnType<typeof makeFakeExperienceListShareRepo>;
  affinityRepo: ReturnType<typeof makeFakeExperienceListAffinityRepo>;
  emitExperienceListShared?: (evt: ExperienceListSharedEvent) => void;
  emitExperienceListRoleChanged?: (evt: ExperienceListRoleChangedEvent) => void;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  const opts: Parameters<typeof experienceListRoutes>[0] = {
    repo: deps.repo as unknown as ExperienceListRepo,
    itemRepo: deps.itemRepo as unknown as ExperienceListItemRepo,
    shareRepo: deps.shareRepo as unknown as ExperienceListShareRepo,
    affinityRepo: deps.affinityRepo as unknown as ExperienceListAffinityRepo,
    requireSession: stubRequireSession,
    ...(deps.emitExperienceListShared
      ? { emitExperienceListShared: deps.emitExperienceListShared }
      : {}),
    ...(deps.emitExperienceListRoleChanged
      ? { emitExperienceListRoleChanged: deps.emitExperienceListRoleChanged }
      : {}),
  };

  await app.register(experienceListRoutes(opts));

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Experience Lists routes integration', () => {
  let fakeRepo: ReturnType<typeof makeFakeExperienceListRepo>;
  let fakeItemRepo: ReturnType<typeof makeFakeExperienceListItemRepo>;
  let fakeShareRepo: ReturnType<typeof makeFakeExperienceListShareRepo>;
  let fakeAffinityRepo: ReturnType<typeof makeFakeExperienceListAffinityRepo>;
  let emittedShared: ExperienceListSharedEvent[];
  let emittedRoleChanged: ExperienceListRoleChangedEvent[];
  let app: FastifyInstance;

  beforeEach(async () => {
    fakeRepo = makeFakeExperienceListRepo();
    fakeItemRepo = makeFakeExperienceListItemRepo();
    fakeShareRepo = makeFakeExperienceListShareRepo();
    fakeAffinityRepo = makeFakeExperienceListAffinityRepo();
    emittedShared = [];
    emittedRoleChanged = [];

    app = await buildTestApp({
      repo: fakeRepo,
      itemRepo: fakeItemRepo,
      shareRepo: fakeShareRepo,
      affinityRepo: fakeAffinityRepo,
      emitExperienceListShared: (e) => emittedShared.push(e),
      emitExperienceListRoleChanged: (e) => emittedRoleChanged.push(e),
    });
  });

  // -------------------------------------------------------------------------
  // Auth Gates (401)
  // -------------------------------------------------------------------------

  it('rejects unauthenticated requests with 401 on every experience-list endpoint', async () => {
    const requests = [
      { method: 'POST', url: '/me/experience-lists', payload: { name: 'My List' } },
      { method: 'GET', url: '/me/experience-lists' },
      { method: 'PATCH', url: `/me/experience-lists/${LIST_ID}`, payload: { name: 'New' } },
      { method: 'DELETE', url: `/me/experience-lists/${LIST_ID}` },
      {
        method: 'POST',
        url: `/me/experience-lists/${LIST_ID}/items`,
        payload: { experienceId: EXPERIENCE_ID_1 },
      },
      { method: 'DELETE', url: `/me/experience-lists/${LIST_ID}/items/${EXPERIENCE_ID_1}` },
      {
        method: 'PUT',
        url: `/me/experience-lists/${LIST_ID}/items/order`,
        payload: { experienceIds: [EXPERIENCE_ID_1], expectedVersion: 1 },
      },
      {
        method: 'POST',
        url: `/me/experience-lists/${LIST_ID}/shares`,
        payload: { recipientId: FRIEND_ID, role: 'editor' },
      },
      { method: 'GET', url: `/me/experience-lists/${LIST_ID}/shares` },
      { method: 'DELETE', url: `/me/experience-lists/${LIST_ID}/shares/${FRIEND_ID}` },
      { method: 'GET', url: `/experience-lists/${LIST_ID}` },
      { method: 'POST', url: `/experience-lists/${LIST_ID}/like` },
      { method: 'DELETE', url: `/experience-lists/${LIST_ID}/like` },
      { method: 'POST', url: `/experience-lists/${LIST_ID}/save` },
      { method: 'GET', url: '/experience-lists/discover' },
      { method: 'GET', url: '/me/experience-lists/collection' },
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

  it('validates experience list creation: empty or oversized name returns 400 validation_failed', async () => {
    const emptyRes = await app.inject({
      method: 'POST',
      url: '/me/experience-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: '   ' },
    });
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.json().error.code).toBe('validation_failed');

    const longRes = await app.inject({
      method: 'POST',
      url: '/me/experience-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'A'.repeat(101) },
    });
    expect(longRes.statusCode).toBe(400);
    expect(longRes.json().error.code).toBe('validation_failed');
  });

  it('validates experience list creation: invalid visibility returns 400 validation_failed (Requirement 1.2)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/experience-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'Thrill Tour', visibility: 'invalid-vis' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
    expect(fakeRepo.createListCalls).toHaveLength(0);
  });

  it('validates UUIDs on path parameters and returns 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/experience-lists/not-a-uuid',
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  // -------------------------------------------------------------------------
  // Error Codes Handling
  // -------------------------------------------------------------------------

  it('maps experience_list_not_found to 404 (Requirement 1.5)', async () => {
    fakeRepo.getListDetailError = new AppError('experience_list_not_found', 'List not found');
    const res = await app.inject({
      method: 'GET',
      url: `/experience-lists/${LIST_ID}`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('experience_list_not_found');
  });

  it('maps experience_list_edit_forbidden to 403 (Requirement 2.9)', async () => {
    fakeItemRepo.addItemError = new AppError(
      'experience_list_edit_forbidden',
      'You do not have edit access to this list',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/experience-lists/${LIST_ID}/items`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { experienceId: EXPERIENCE_ID_1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('experience_list_edit_forbidden');
  });

  it('maps experience_list_item_duplicate to 409 (Requirement 2.2)', async () => {
    fakeItemRepo.addItemError = new AppError(
      'experience_list_item_duplicate',
      'Experience already in list',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/experience-lists/${LIST_ID}/items`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { experienceId: EXPERIENCE_ID_1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('experience_list_item_duplicate');
  });

  it('maps experience_not_found to 404 (Requirement 2.3)', async () => {
    fakeItemRepo.addItemError = new AppError(
      'experience_not_found',
      'Experience not found',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/experience-lists/${LIST_ID}/items`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { experienceId: EXPERIENCE_ID_1 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('experience_not_found');
  });

  it('maps experience_list_dining_ineligible to 400 (Requirement 2.3)', async () => {
    fakeItemRepo.addItemError = new AppError(
      'experience_list_dining_ineligible',
      'Restaurant experiences cannot be added to an Experience List',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/experience-lists/${LIST_ID}/items`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { experienceId: EXPERIENCE_ID_1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('experience_list_dining_ineligible');
  });

  it('maps experience_list_reorder_mismatch to 400 (Requirement 2.6)', async () => {
    fakeItemRepo.reorderItemsError = new AppError(
      'experience_list_reorder_mismatch',
      'Items do not match current list',
    );
    const res = await app.inject({
      method: 'PUT',
      url: `/me/experience-lists/${LIST_ID}/items/order`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { experienceIds: [EXPERIENCE_ID_1], expectedVersion: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('experience_list_reorder_mismatch');
  });

  it('maps experience_list_stale_write to 409 (Requirement 2.7)', async () => {
    fakeItemRepo.reorderItemsError = new AppError(
      'experience_list_stale_write',
      'List version mismatch',
    );
    const res = await app.inject({
      method: 'PUT',
      url: `/me/experience-lists/${LIST_ID}/items/order`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { experienceIds: [EXPERIENCE_ID_1, EXPERIENCE_ID_2], expectedVersion: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('experience_list_stale_write');
  });

  it('maps experience_list_share_not_friend to 403 (Requirement 4.2)', async () => {
    fakeShareRepo.shareError = new AppError(
      'experience_list_share_not_friend',
      'Can only share with confirmed friends',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/me/experience-lists/${LIST_ID}/shares`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { recipientId: FRIEND_ID, role: 'viewer' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('experience_list_share_not_friend');
  });

  it('maps experience_list_save_self to 400 (Requirement 6.6)', async () => {
    fakeAffinityRepo.saveError = new AppError(
      'experience_list_save_self',
      'Cannot save your own experience list',
    );
    const res = await app.inject({
      method: 'POST',
      url: `/experience-lists/${LIST_ID}/save`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('experience_list_save_self');
  });

  // -------------------------------------------------------------------------
  // Happy Paths & Notifications
  // -------------------------------------------------------------------------

  it('POST /me/experience-lists with visibility omitted creates private list with 201 and returns DTO', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/experience-lists',
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'Thrill Tour' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Thrill Tour');
    expect(body.visibility).toBe('private');
    expect(fakeRepo.createListCalls).toEqual([
      { ownerId: USER_ID, name: 'Thrill Tour', visibility: undefined },
    ]);
  });

  it('POST /me/experience-lists with visibility: "public" creates public list with 201 and returns DTO (Requirement 1.2)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/me/experience-lists',
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

  it('PATCH /me/experience-lists/:id updates name and visibility', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/me/experience-lists/${LIST_ID}`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { name: 'Renamed List', visibility: 'public' },
    });
    expect(res.statusCode).toBe(200);
    expect(fakeRepo.renameListCalls).toHaveLength(1);
    expect(fakeRepo.updateVisibilityCalls).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // List Pinning (Feature: list-pinning)
  // -------------------------------------------------------------------------

  describe('List Pinning', () => {
    it('PATCH /me/experience-lists/:id with pinned: true calls setPinned and returns pinnedAt set', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/me/experience-lists/${LIST_ID}`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { pinned: true },
      });
      expect(res.statusCode).toBe(200);
      expect(fakeRepo.setPinnedCalls).toEqual([
        { listId: LIST_ID, userId: USER_ID, pinned: true },
      ]);
      const list = res.json() as ExperienceListDTO;
      expect(list.pinnedAt).not.toBeNull();
    });

    it('PATCH /me/experience-lists/:id with pinned: false calls setPinned and returns pinnedAt null', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/me/experience-lists/${LIST_ID}`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { pinned: false },
      });
      expect(res.statusCode).toBe(200);
      expect(fakeRepo.setPinnedCalls).toEqual([
        { listId: LIST_ID, userId: USER_ID, pinned: false },
      ]);
      const list = res.json() as ExperienceListDTO;
      expect(list.pinnedAt).toBeNull();
    });

    it('rejects non-boolean pinned with 400 validation_failed', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/me/experience-lists/${LIST_ID}`,
        headers: { 'x-test-user-id': USER_ID },
        payload: { pinned: 'yes' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('validation_failed');
      expect(fakeRepo.setPinnedCalls).toHaveLength(0);
    });

    it('propagates experience_list_not_found when setPinned rejects a non-owner', async () => {
      fakeRepo.setPinnedError = new AppError(
        'experience_list_not_found',
        'Experience list not found',
      );
      const res = await app.inject({
        method: 'PATCH',
        url: `/me/experience-lists/${LIST_ID}`,
        headers: { 'x-test-user-id': FRIEND_ID },
        payload: { pinned: true },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('experience_list_not_found');
    });
  });

  it('DELETE /me/experience-lists/:id deletes list with 204', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experience-lists/${LIST_ID}`,
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(204);
    expect(fakeRepo.deleteListCalls).toEqual([{ listId: LIST_ID, userId: USER_ID }]);
  });

  it('POST /me/experience-lists/:id/shares dispatches ExperienceListShared on newlyInserted', async () => {
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
      url: `/me/experience-lists/${LIST_ID}/shares`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { recipientId: FRIEND_ID, role: 'editor' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recipientId).toBe(FRIEND_ID);

    expect(emittedShared).toEqual([
      { experienceListId: LIST_ID, senderId: USER_ID, recipientId: FRIEND_ID },
    ]);
    expect(emittedRoleChanged).toHaveLength(0);
  });

  it('POST /me/experience-lists/:id/shares dispatches ExperienceListRoleChanged on roleChanged', async () => {
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
      url: `/me/experience-lists/${LIST_ID}/shares`,
      headers: { 'x-test-user-id': USER_ID },
      payload: { recipientId: FRIEND_ID, role: 'viewer' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('viewer');

    expect(emittedShared).toHaveLength(0);
    expect(emittedRoleChanged).toEqual([
      {
        experienceListId: LIST_ID,
        senderId: USER_ID,
        recipientId: FRIEND_ID,
        newRole: 'viewer',
        listName: 'Thrill Rides',
      },
    ]);
  });

  it('POST /me/experience-lists/:id/shares dispatches no notification on idempotent repeat', async () => {
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
      url: `/me/experience-lists/${LIST_ID}/shares`,
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

  it('GET /experience-lists/discover performs cursor round-trip pagination (Requirement 5.1)', async () => {
    // First page
    const page1Res = await app.inject({
      method: 'GET',
      url: '/experience-lists/discover?sort=popular',
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
      url: `/experience-lists/discover?sort=popular&cursor=${page1.nextCursor}`,
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

  it('GET /me/experience-lists/collection returns owned and degraded saved lists (Requirement 6.7)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/me/experience-lists/collection',
      headers: { 'x-test-user-id': USER_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ExperienceListCollectionDTO;
    expect(body.saved).toHaveLength(1);
    expect(body.saved[0]).toEqual({
      available: false,
      experienceListId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
  });
});
