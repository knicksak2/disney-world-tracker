/**
 * Route tests for GET /users/:userId/food-ratings (Phase 1).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.8, 6.7, 6.8, 13.1
 */

import Fastify, { type FastifyInstance } from 'fastify';
import fc from 'fast-check';
import { newDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  FriendFoodRatingsPageDTO,
  FriendFoodScopeDTO,
} from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { encodeCursor, type SocialProofRow } from '../dishAggregate.js';
import type {
  DishRow,
  FriendFoodRatingsRepo,
  ListDishesInput,
} from '../repo.js';
import {
  friendFoodRatingRoutes,
  type FriendFoodRatingRoutesOptions,
} from '../routes.js';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const FRIEND_ID = '22222222-2222-4222-8222-222222222222';
const NON_FRIEND_ID = '33333333-3333-4333-8333-333333333333';
const UNKNOWN_TARGET_ID = '44444444-4444-4444-8444-444444444444';
const EXP_ID = '55555555-5555-4555-8555-555555555555';
const LOC_ID = '66666666-6666-4666-8666-666666666666';
const FOOD_ITEM_1 = '77777777-7777-4777-8777-777777777777';

// ---------------------------------------------------------------------------
// Fake Repo
// ---------------------------------------------------------------------------

function makeFakeRepo() {
  const listDishesCalls: ListDishesInput[] = [];
  const listScopesCalls: string[] = [];

  const sampleRows: DishRow[] = [
    {
      foodItemId: FOOD_ITEM_1,
      foodItemName: 'Dole Whip',
      scopeKind: 'experience',
      scopeId: EXP_ID,
      scopeName: 'Aloha Isle',
      park: 'Magic Kingdom',
      logCount: 3,
      ratedCount: 2,
      averageRating: 9.5,
      latestVisitedOn: '2026-06-15',
      cursorA: '2026-06-15',
      cursorB: null,
    },
  ];

  const sampleScopes: FriendFoodScopeDTO[] = [
    {
      kind: 'experience',
      id: EXP_ID,
      name: 'Aloha Isle',
      park: 'Magic Kingdom',
      dishCount: 1,
    },
  ];

  let dishesResult: { rows: readonly DishRow[]; hasMore: boolean } = {
    rows: sampleRows,
    hasMore: false,
  };
  let scopesResult: readonly FriendFoodScopeDTO[] = sampleScopes;
  let socialProofResult: { rows: readonly SocialProofRow[]; capped: boolean } = {
    rows: [],
    capped: false,
  };
  const listFriendSocialProofCalls: {
    viewerId: string;
    scope: { kind: 'experience' | 'location'; id: string };
  }[] = [];

  const repo: FriendFoodRatingsRepo = {
    async listDishes(input: ListDishesInput) {
      listDishesCalls.push(input);
      return dishesResult;
    },
    async listScopes(targetUserId: string) {
      listScopesCalls.push(targetUserId);
      return scopesResult;
    },
    async listFriendSocialProof(
      viewerId: string,
      scope: { kind: 'experience' | 'location'; id: string },
    ) {
      listFriendSocialProofCalls.push({ viewerId, scope });
      return socialProofResult;
    },
  };

  return {
    repo,
    listDishesCalls,
    listScopesCalls,
    listFriendSocialProofCalls,
    setDishesResult(res: { rows: readonly DishRow[]; hasMore: boolean }) {
      dishesResult = res;
    },
    setScopesResult(res: readonly FriendFoodScopeDTO[]) {
      scopesResult = res;
    },
    setSocialProofResult(res: { rows: readonly SocialProofRow[]; capped: boolean }) {
      socialProofResult = res;
    },
  };
}

// ---------------------------------------------------------------------------
// Test App Builder
// ---------------------------------------------------------------------------

const stubRequireSession: FriendFoodRatingRoutesOptions['requireSession'] = (
  request,
  _reply,
  done,
) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
  }
  done();
};

function createPgMemPool() {
  const mem = newDb();
  // The gate reads `active_friendships` (migration 0064): a friendship whose two people are both active.
  // This route test only needs that view, so it carries the minimal tables and the view body of 0064.
  mem.public.none(`
    CREATE TABLE users (
      id UUID PRIMARY KEY,
      deletion_state TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE friendships (
      user_lo_id UUID NOT NULL,
      user_hi_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_lo_id, user_hi_id)
    );
    CREATE VIEW active_friendships AS
    SELECT f.user_lo_id, f.user_hi_id
      FROM friendships f
      JOIN users ul ON ul.id = f.user_lo_id AND ul.deletion_state = 'active'
      JOIN users uh ON uh.id = f.user_hi_id AND uh.deletion_state = 'active';
  `);
  const { Pool: PgMemPool } = mem.adapters.createPg();
  const pool = new PgMemPool() as unknown as DbPool;
  return { mem, pool };
}

/** Inserts the two (active) people and their friendship. */
function befriend(mem: ReturnType<typeof createPgMemPool>['mem'], lo: string, hi: string): void {
  for (const id of [lo, hi]) {
    mem.public.none(`INSERT INTO users (id) VALUES ('${id}') ON CONFLICT DO NOTHING`);
  }
  mem.public.none(
    `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ('${lo}', '${hi}') ON CONFLICT DO NOTHING`,
  );
}

async function buildApp(opts: {
  pool?: DbPool;
  repo: FriendFoodRatingsRepo;
}): Promise<FastifyInstance> {
  const p = opts.pool ?? createPgMemPool().pool;
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    friendFoodRatingRoutes({
      repo: opts.repo,
      pool: p,
      requireSession: stubRequireSession,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('friendFoodRatingRoutes — GET /users/:userId/food-ratings', () => {
  let memDb: ReturnType<typeof createPgMemPool>['mem'];
  let pool: DbPool;
  let fakeRepo: ReturnType<typeof makeFakeRepo>;
  let app: FastifyInstance;

  beforeEach(async () => {
    const pg = createPgMemPool();
    memDb = pg.mem;
    pool = pg.pool;
    fakeRepo = makeFakeRepo();

    // Establish friendship between OWNER_ID and FRIEND_ID
    const { lo, hi } = canonicalPair(OWNER_ID, FRIEND_ID);
    befriend(memDb, lo, hi);

    app = await buildApp({ pool, repo: fakeRepo.repo });
  });

  it('returns 401 unauthorized without a session even for an unknown target', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/users/${UNKNOWN_TARGET_ID}/food-ratings`,
    });

    expect(res.statusCode).toBe(401);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
    expect(fakeRepo.listDishesCalls).toHaveLength(0);
    expect(fakeRepo.listScopesCalls).toHaveLength(0);
  });

  it('returns 403 profile_forbidden with identical bodies for non-friend, pending, former friend and unknown target', async () => {
    const pendingViewerId = '55555555-1111-4111-8111-111111111111';
    const formerFriendId = '66666666-1111-4111-8111-111111111111';

    // Seed then delete former friendship
    const { lo: fLo, hi: fHi } = canonicalPair(OWNER_ID, formerFriendId);
    befriend(memDb, fLo, fHi);
    memDb.public.none(
      `DELETE FROM friendships WHERE user_lo_id = '${fLo}' AND user_hi_id = '${fHi}'`,
    );

    // 1. Non-friend
    const resNonFriend = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings`,
      headers: { 'x-test-user-id': NON_FRIEND_ID },
    });

    // 2. Pending request viewer (no row in friendships)
    const resPending = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings`,
      headers: { 'x-test-user-id': pendingViewerId },
    });

    // 3. Former friend
    const resFormer = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings`,
      headers: { 'x-test-user-id': formerFriendId },
    });

    // 4. Unknown target
    const resUnknown = await app.inject({
      method: 'GET',
      url: `/users/${UNKNOWN_TARGET_ID}/food-ratings`,
      headers: { 'x-test-user-id': NON_FRIEND_ID },
    });

    expect(resNonFriend.statusCode).toBe(403);
    expect(resPending.statusCode).toBe(403);
    expect(resFormer.statusCode).toBe(403);
    expect(resUnknown.statusCode).toBe(403);

    const bodyNonFriend = resNonFriend.json();
    expect(bodyNonFriend).toEqual({
      error: {
        code: 'profile_forbidden',
        message: 'You may not view this profile.',
      },
    });
    expect(resPending.json()).toEqual(bodyNonFriend);
    expect(resFormer.json()).toEqual(bodyNonFriend);
    expect(resUnknown.json()).toEqual(bodyNonFriend);

    expect(fakeRepo.listDishesCalls).toHaveLength(0);
    expect(fakeRepo.listScopesCalls).toHaveLength(0);
  });

  it('owner reading themself and friend of target both get the page', async () => {
    // Owner reading themself
    const resOwner = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings`,
      headers: { 'x-test-user-id': OWNER_ID },
    });

    expect(resOwner.statusCode).toBe(200);
    const ownerData = resOwner.json() as FriendFoodRatingsPageDTO;
    expect(ownerData.items).toHaveLength(1);
    expect(ownerData.scopes).toHaveLength(1);

    // Friend reading owner
    const resFriend = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings`,
      headers: { 'x-test-user-id': FRIEND_ID },
    });

    expect(resFriend.statusCode).toBe(200);
    const friendData = resFriend.json() as FriendFoodRatingsPageDTO;
    expect(friendData.items).toHaveLength(1);
    expect(friendData.scopes).toHaveLength(1);
  });

  it('target with no logs yields 200 with items: [], nextCursor: null, scopes: [] (Property 11, server half)', async () => {
    fakeRepo.setDishesResult({ rows: [], hasMore: false });
    fakeRepo.setScopesResult([]);

    const res = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings`,
      headers: { 'x-test-user-id': FRIEND_ID },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [],
      nextCursor: null,
      scopes: [],
    });
  });

  describe('validation errors => 400 validation_failed before friendship gate and repo call', () => {
    const invalidCases = [
      { name: 'malformed :userId', url: '/users/not-a-uuid/food-ratings' },
      { name: 'bad sort', url: `/users/${OWNER_ID}/food-ratings?sort=invalid_sort` },
      {
        name: 'both id filters',
        url: `/users/${OWNER_ID}/food-ratings?experienceId=${EXP_ID}&locationId=${LOC_ID}`,
      },
      { name: 'unknown query key', url: `/users/${OWNER_ID}/food-ratings?unknownParam=123` },
      { name: 'empty q', url: `/users/${OWNER_ID}/food-ratings?q=` },
      { name: 'limit 0', url: `/users/${OWNER_ID}/food-ratings?limit=0` },
      { name: 'limit 51', url: `/users/${OWNER_ID}/food-ratings?limit=51` },
      { name: 'minRatedLogs 11', url: `/users/${OWNER_ID}/food-ratings?minRatedLogs=11` },
    ];

    for (const c of invalidCases) {
      it(`rejects ${c.name} with 400 validation_failed for non-friend with no repo call`, async () => {
        const res = await app.inject({
          method: 'GET',
          url: c.url,
          headers: { 'x-test-user-id': NON_FRIEND_ID },
        });

        expect(res.statusCode).toBe(400);
        const body = res.json() as { error: { code: string } };
        expect(body.error.code).toBe('validation_failed');
        expect(fakeRepo.listDishesCalls).toHaveLength(0);
        expect(fakeRepo.listScopesCalls).toHaveLength(0);
      });
    }
  });

  describe('cursor decoding order and validation (R6.7)', () => {
    it('returns 400 validation_failed for wrong-sort and tampered cursor when viewer is Owner or Friend', async () => {
      // Valid cursor for 'highest_rated'
      const highestRatedCursor = encodeCursor('highest_rated', '8.5', '2', FOOD_ITEM_1);

      // Wrong sort: sending highest_rated cursor with sort=recent
      const resWrongSortOwner = await app.inject({
        method: 'GET',
        url: `/users/${OWNER_ID}/food-ratings?sort=recent&cursor=${encodeURIComponent(highestRatedCursor)}`,
        headers: { 'x-test-user-id': OWNER_ID },
      });
      expect(resWrongSortOwner.statusCode).toBe(400);
      expect((resWrongSortOwner.json() as { error: { code: string } }).error.code).toBe('validation_failed');

      // Tampered cursor: invalid base64 or JSON
      const resTamperedFriend = await app.inject({
        method: 'GET',
        url: `/users/${OWNER_ID}/food-ratings?sort=recent&cursor=not_a_valid_cursor_string`,
        headers: { 'x-test-user-id': FRIEND_ID },
      });
      expect(resTamperedFriend.statusCode).toBe(400);
      expect((resTamperedFriend.json() as { error: { code: string } }).error.code).toBe('validation_failed');

      expect(fakeRepo.listDishesCalls).toHaveLength(0);
    });

    it('pins order: the same bad cursor from a non-friend yields 403 profile_forbidden', async () => {
      const highestRatedCursor = encodeCursor('highest_rated', '8.5', '2', FOOD_ITEM_1);

      const res = await app.inject({
        method: 'GET',
        url: `/users/${OWNER_ID}/food-ratings?sort=recent&cursor=${encodeURIComponent(highestRatedCursor)}`,
        headers: { 'x-test-user-id': NON_FRIEND_ID },
      });

      // The gate runs before cursor decoding, so 403 takes precedence over 400
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('profile_forbidden');
      expect(fakeRepo.listDishesCalls).toHaveLength(0);
    });
  });

  it('first page includes scopes, a cursor page returns scopes: null', async () => {
    // 1. First page (no cursor)
    const resPage1 = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings`,
      headers: { 'x-test-user-id': FRIEND_ID },
    });
    expect(resPage1.statusCode).toBe(200);
    const bodyPage1 = resPage1.json() as FriendFoodRatingsPageDTO;
    expect(bodyPage1.scopes).not.toBeNull();
    expect(fakeRepo.listScopesCalls).toHaveLength(1);

    // 2. Cursor page (with valid cursor)
    const validRecentCursor = encodeCursor('recent', '2026-06-15', null, FOOD_ITEM_1);
    const resPage2 = await app.inject({
      method: 'GET',
      url: `/users/${OWNER_ID}/food-ratings?sort=recent&cursor=${encodeURIComponent(validRecentCursor)}`,
      headers: { 'x-test-user-id': FRIEND_ID },
    });
    expect(resPage2.statusCode).toBe(200);
    const bodyPage2 = resPage2.json() as FriendFoodRatingsPageDTO;
    expect(bodyPage2.scopes).toBeNull();
    // listScopes was not called again
    expect(fakeRepo.listScopesCalls).toHaveLength(1);
  });

  // Feature: friend-food-ratings, Property 2: Only the Owner or an accepted Friend can read a Dish_Rating_Row
  it('Property 2: generates random friendship graphs and viewer/target pairs, asserting data iff owner or friend', async () => {
    const userPool = [
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000002',
      'cccccccc-0000-4000-8000-000000000003',
      'dddddddd-0000-4000-8000-000000000004',
      'eeeeeeee-0000-4000-8000-000000000005',
    ];

    const propFakeRepo = makeFakeRepo();

    await fc.assert(
      fc.asyncProperty(
        fc.subarray(
          [
            [userPool[0]!, userPool[1]!],
            [userPool[0]!, userPool[2]!],
            [userPool[1]!, userPool[2]!],
            [userPool[2]!, userPool[3]!],
            [userPool[3]!, userPool[4]!],
          ],
          { minLength: 0 },
        ),
        fc.constantFrom(...userPool),
        fc.constantFrom(...userPool),
        async (edges, viewerId, targetId) => {
          // Recreate clean db
          const { mem, pool: p } = createPgMemPool();
          for (const edge of edges) {
            const u1 = edge[0]!;
            const u2 = edge[1]!;
            const { lo, hi } = canonicalPair(u1, u2);
            befriend(mem, lo, hi);
          }

          propFakeRepo.listDishesCalls.length = 0;
          propFakeRepo.listScopesCalls.length = 0;

          const testApp = await buildApp({ pool: p, repo: propFakeRepo.repo });

          const res = await testApp.inject({
            method: 'GET',
            url: `/users/${targetId}/food-ratings`,
            headers: { 'x-test-user-id': viewerId },
          });

          const isOwner = viewerId === targetId;
          let hasFriendship = false;
          if (!isOwner) {
            const { lo, hi } = canonicalPair(viewerId, targetId);
            hasFriendship = edges.some((edge) => {
              const pair = canonicalPair(edge[0]!, edge[1]!);
              return pair.lo === lo && pair.hi === hi;
            });
          }

          if (isOwner || hasFriendship) {
            expect(res.statusCode).toBe(200);
            expect(propFakeRepo.listDishesCalls).toHaveLength(1);
          } else {
            expect(res.statusCode).toBe(403);
            expect(res.json()).toEqual({
              error: {
                code: 'profile_forbidden',
                message: 'You may not view this profile.',
              },
            });
            expect(propFakeRepo.listDishesCalls).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('Phase 2: GET /experiences/:id/food-item-logs/friends & /locations/:id/food-item-logs/friends', () => {
    it('returns 401 unauthorized when unauthenticated', async () => {
      const resExp = await app.inject({
        method: 'GET',
        url: `/experiences/${EXP_ID}/food-item-logs/friends`,
      });
      expect(resExp.statusCode).toBe(401);

      const resLoc = await app.inject({
        method: 'GET',
        url: `/locations/${LOC_ID}/food-item-logs/friends`,
      });
      expect(resLoc.statusCode).toBe(401);
    });

    it('returns 400 validation_failed on malformed :id', async () => {
      const resExp = await app.inject({
        method: 'GET',
        url: '/experiences/not-a-uuid/food-item-logs/friends',
        headers: { 'x-test-user-id': OWNER_ID },
      });
      expect(resExp.statusCode).toBe(400);
      expect(resExp.json().error.code).toBe('validation_failed');

      const resLoc = await app.inject({
        method: 'GET',
        url: '/locations/not-a-uuid/food-item-logs/friends',
        headers: { 'x-test-user-id': OWNER_ID },
      });
      expect(resLoc.statusCode).toBe(400);
      expect(resLoc.json().error.code).toBe('validation_failed');
    });

    it('returns 200 with grouped friend social proof on experience happy path', async () => {
      const fake = makeFakeRepo();
      fake.setSocialProofResult({
        rows: [
          {
            foodItemId: FOOD_ITEM_1,
            friendId: FRIEND_ID,
            displayName: 'Friend One',
            avatarPreset: 'castle',
            averageRating: 9.0,
            ratedLogCount: 2,
            logCount: 2,
            latestVisitedOn: '2026-06-15',
          },
        ],
        capped: false,
      });

      const testApp = await buildApp({ repo: fake.repo });
      const res = await testApp.inject({
        method: 'GET',
        url: `/experiences/${EXP_ID}/food-item-logs/friends`,
        headers: { 'x-test-user-id': OWNER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(fake.listFriendSocialProofCalls).toEqual([
        {
          viewerId: OWNER_ID,
          scope: { kind: 'experience', id: EXP_ID },
        },
      ]);
      const body = res.json();
      expect(body).toEqual({
        items: [
          {
            foodItemId: FOOD_ITEM_1,
            friendCount: 1,
            friendsAverageRating: 9.0,
            friends: [
              {
                friendId: FRIEND_ID,
                displayName: 'Friend One',
                avatarPreset: 'castle',
                averageRating: 9.0,
                ratedLogCount: 2,
                logCount: 2,
                latestVisitedOn: '2026-06-15',
              },
            ],
          },
        ],
      });
    });

    it('returns 200 with grouped friend social proof on location happy path', async () => {
      const fake = makeFakeRepo();
      fake.setSocialProofResult({
        rows: [
          {
            foodItemId: FOOD_ITEM_1,
            friendId: FRIEND_ID,
            displayName: 'Friend One',
            avatarPreset: null,
            averageRating: 8.5,
            ratedLogCount: 1,
            logCount: 1,
            latestVisitedOn: '2026-06-15',
          },
        ],
        capped: false,
      });

      const testApp = await buildApp({ repo: fake.repo });
      const res = await testApp.inject({
        method: 'GET',
        url: `/locations/${LOC_ID}/food-item-logs/friends`,
        headers: { 'x-test-user-id': OWNER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(fake.listFriendSocialProofCalls).toEqual([
        {
          viewerId: OWNER_ID,
          scope: { kind: 'location', id: LOC_ID },
        },
      ]);
      expect(res.json().items).toHaveLength(1);
    });

    it('returns { items: [] } when viewer has no friends with ratings', async () => {
      const fake = makeFakeRepo();
      fake.setSocialProofResult({ rows: [], capped: false });

      const testApp = await buildApp({ repo: fake.repo });
      const res = await testApp.inject({
        method: 'GET',
        url: `/experiences/${EXP_ID}/food-item-logs/friends`,
        headers: { 'x-test-user-id': OWNER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [] });
    });

    it('returns { items: [] } when scope does not exist', async () => {
      const fake = makeFakeRepo();
      fake.setSocialProofResult({ rows: [], capped: false });

      const testApp = await buildApp({ repo: fake.repo });
      const nonExistentExpId = '99999999-9999-4999-8999-999999999999';
      const res = await testApp.inject({
        method: 'GET',
        url: `/experiences/${nonExistentExpId}/food-item-logs/friends`,
        headers: { 'x-test-user-id': OWNER_ID },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ items: [] });
    });
  });
});
