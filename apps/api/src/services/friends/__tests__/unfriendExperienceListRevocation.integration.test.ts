/**
 * Integration test for unfriend Experience List share revocation, proving the
 * COMPOSED `onFriendshipRemoved` wiring (Feature: experience-lists, Task 3.4).
 *
 * Exercises the real `removeFriend` -> composed `onFriendshipRemoved` ->
 * `revokeSharesBetween` wiring end-to-end with real database state and the
 * real Fastify DELETE /me/friends/:userId route, for BOTH list kinds in the
 * same test — proving the `Promise.all([...])` composition in
 * `composeServices.ts` (task 3.2), not just each repo's own
 * `revokeSharesBetween` (already covered by each spec's own repo-level
 * property tests).
 *
 * Mirrors `unfriendFoodListRevocation.integration.test.ts` (food-lists Task
 * 3.4)'s harness exactly, widened to wire both `foodListShareRepo` and
 * `experienceListShareRepo` into a single composed callback.
 *
 * Validates: Requirement 4.5
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { pair } from '../canonicalPair.js';
import { createFriendsRepo, type FriendsRepo } from '../repo.js';
import { friendsRoutes } from '../routes.js';
import {
  createFoodListRepo,
  createFoodListShareRepo,
  type FoodListRepo,
  type FoodListShareRepo,
} from '../../foodLists/repo.js';
import {
  createExperienceListRepo,
  createExperienceListShareRepo,
  type ExperienceListRepo,
  type ExperienceListShareRepo,
} from '../../experienceLists/repo.js';

// ---------------------------------------------------------------------------
// pg-mem harness
// ---------------------------------------------------------------------------

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb();
  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      implementation: () => randomUUID(),
      impure: true,
    });
  });
  const pub = db.public;
  pub.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  const strip = (t: string): string => t.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return raw.query(strip(text), params);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(strip(text), params);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

describe('unfriendExperienceListRevocation integration (composed onFriendshipRemoved wiring)', () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let friendsRepo: FriendsRepo;
  let foodListRepo: FoodListRepo;
  let foodListShareRepo: FoodListShareRepo;
  let experienceListRepo: ExperienceListRepo;
  let experienceListShareRepo: ExperienceListShareRepo;
  let app: FastifyInstance;
  let currentUserId: string;

  let userA: string;
  let userB: string;
  let userC: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0041_food_lists.sql');
    applyMigration(db, '0047_food_list_checklist.sql');
    applyMigration(db, '0052_food_list_pinning.sql');
    applyMigration(db, '0050_experience_lists.sql');
    applyMigration(db, '0053_experience_list_pinning.sql');

    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);

    friendsRepo = createFriendsRepo(pool);
    foodListRepo = createFoodListRepo(pool);
    foodListShareRepo = createFoodListShareRepo(pool);
    experienceListRepo = createExperienceListRepo(pool);
    experienceListShareRepo = createExperienceListShareRepo(pool);

    userA = randomUUID();
    userB = randomUUID();
    userC = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'userA@test.com', 'hash'),
              ($2, 'userB@test.com', 'hash'),
              ($3, 'userC@test.com', 'hash')`,
      [userA, userB, userC],
    );

    // Make userA and userB friends in friendships table
    const { lo, hi } = pair(userA, userB);
    await pool.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
      [lo, hi],
    );

    // Fastify app with real friendsRoutes wiring, using the SAME composed
    // `onFriendshipRemoved` shape as `composeServices.ts` (task 3.2): both
    // list kinds' `revokeSharesBetween` run concurrently via `Promise.all`.
    app = Fastify();
    registerErrorHandler(app);

    const requireSession = async (request: { userId?: string }) => {
      request.userId = currentUserId;
    };

    const onFriendshipRemoved = async (userId1: string, userId2: string): Promise<void> => {
      await Promise.all([
        foodListShareRepo.revokeSharesBetween(userId1, userId2),
        experienceListShareRepo.revokeSharesBetween(userId1, userId2),
      ]);
    };

    await app.register(
      friendsRoutes({
        repo: friendsRepo,
        requireSession,
        onFriendshipRemoved,
      }),
    );
    await app.ready();
  });

  it('revokes bidirectional Food_List AND Experience_List shares (both kinds) when friends are removed via DELETE /me/friends/:userId', async () => {
    // 1. User A creates a private Food_List and shares it with User B (editor).
    const foodListA = await foodListRepo.createList(userA, { name: 'Favorites A' });
    await foodListShareRepo.shareWithFriend(foodListA.id, userA, userB, 'editor');

    // 2. User A ALSO creates a private Experience_List and shares it with User B (viewer).
    const experienceListA = await experienceListRepo.createList(userA, { name: 'Must Ride A' });
    await experienceListShareRepo.shareWithFriend(experienceListA.id, userA, userB, 'viewer');

    // 3. User B creates a private Food_List and shares it with User A (editor,
    //    reusing the food-lists precedent's role for symmetry with step 1).
    const foodListB = await foodListRepo.createList(userB, { name: 'Favorites B' });
    await foodListShareRepo.shareWithFriend(foodListB.id, userB, userA, 'editor');

    // 4. User B ALSO creates a private Experience_List and shares it with User A (viewer).
    const experienceListB = await experienceListRepo.createList(userB, { name: 'Must Ride B' });
    await experienceListShareRepo.shareWithFriend(experienceListB.id, userB, userA, 'viewer');

    // Verify all four shares exist.
    const foodSharesA = await foodListShareRepo.listShares(foodListA.id, userA);
    expect(foodSharesA).toHaveLength(1);
    expect(foodSharesA[0]!.recipientId).toBe(userB);

    const foodSharesB = await foodListShareRepo.listShares(foodListB.id, userB);
    expect(foodSharesB).toHaveLength(1);
    expect(foodSharesB[0]!.recipientId).toBe(userA);

    const experienceSharesA = await experienceListShareRepo.listShares(experienceListA.id, userA);
    expect(experienceSharesA).toHaveLength(1);
    expect(experienceSharesA[0]!.recipientId).toBe(userB);

    const experienceSharesB = await experienceListShareRepo.listShares(experienceListB.id, userB);
    expect(experienceSharesB).toHaveLength(1);
    expect(experienceSharesB[0]!.recipientId).toBe(userA);

    // Verify all four cross-views resolve before revocation.
    await expect(foodListRepo.getListDetail(foodListA.id, userB)).resolves.toBeDefined();
    await expect(foodListRepo.getListDetail(foodListB.id, userA)).resolves.toBeDefined();
    await expect(experienceListRepo.getListDetail(experienceListA.id, userB)).resolves.toBeDefined();
    await expect(experienceListRepo.getListDetail(experienceListB.id, userA)).resolves.toBeDefined();

    // 5. User A unfriends User B via the real DELETE /me/friends/:userId route.
    currentUserId = userA;
    const response = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${userB}`,
    });

    expect(response.statusCode).toBe(204);

    // 6. Assert the friendship row is gone.
    const { lo, hi } = pair(userA, userB);
    const friendCheck = await pool.query(
      `SELECT 1 FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2`,
      [lo, hi],
    );
    expect(friendCheck.rows).toHaveLength(0);

    // 7. Assert ALL FOUR shares are gone — both Food_List directions AND
    //    both Experience_List directions — proving the `Promise.all`
    //    composition revoked both kinds, not just one.
    await expect(foodListShareRepo.listShares(foodListA.id, userA)).resolves.toHaveLength(0);
    await expect(foodListShareRepo.listShares(foodListB.id, userB)).resolves.toHaveLength(0);
    await expect(
      experienceListShareRepo.listShares(experienceListA.id, userA),
    ).resolves.toHaveLength(0);
    await expect(
      experienceListShareRepo.listShares(experienceListB.id, userB),
    ).resolves.toHaveLength(0);

    // 8. None of the four lists resolve for the other party anymore.
    await expect(foodListRepo.getListDetail(foodListA.id, userB)).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
    );
    await expect(foodListRepo.getListDetail(foodListB.id, userA)).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
    );
    await expect(experienceListRepo.getListDetail(experienceListA.id, userB)).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
    );
    await expect(experienceListRepo.getListDetail(experienceListB.id, userA)).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
    );
  });

  it('returns 404 when unfriending non-friend, leaving both Food_List and Experience_List shares intact', async () => {
    // Establish one share of each kind between the actual friends (A, B) so
    // a no-op unfriend attempt against a non-friend (C) can be proven to
    // leave them untouched.
    const foodListA = await foodListRepo.createList(userA, { name: 'Favorites A' });
    await foodListShareRepo.shareWithFriend(foodListA.id, userA, userB, 'editor');

    const experienceListA = await experienceListRepo.createList(userA, { name: 'Must Ride A' });
    await experienceListShareRepo.shareWithFriend(experienceListA.id, userA, userB, 'viewer');

    currentUserId = userA;
    const response = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${userC}`,
    });

    expect(response.statusCode).toBe(404);

    // Both existing shares (A/B friendship) remain untouched.
    await expect(foodListShareRepo.listShares(foodListA.id, userA)).resolves.toHaveLength(1);
    await expect(
      experienceListShareRepo.listShares(experienceListA.id, userA),
    ).resolves.toHaveLength(1);
  });
});
