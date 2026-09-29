/**
 * Integration test for unfriend food list share revocation (Feature: food-lists, Task 3.4).
 *
 * Exercises the real `removeFriend` -> `onFriendshipRemoved` -> `revokeSharesBetween`
 * wiring end-to-end with real database state and real Fastify DELETE /me/friends/:userId route.
 *
 * Validates: Requirement 4.5, Property 6
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

describe('unfriendFoodListRevocation integration (real wiring)', () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let friendsRepo: FriendsRepo;
  let foodListRepo: FoodListRepo;
  let foodListShareRepo: FoodListShareRepo;
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

    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);

    friendsRepo = createFriendsRepo(pool);
    foodListRepo = createFoodListRepo(pool);
    foodListShareRepo = createFoodListShareRepo(pool);

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

    // Fastify app with real friendsRoutes wiring
    app = Fastify();
    registerErrorHandler(app);

    const requireSession = async (request: { userId?: string }) => {
      request.userId = currentUserId;
    };

    const revokeFoodListSharesOnUnfriend = (userId1: string, userId2: string): Promise<void> =>
      foodListShareRepo.revokeSharesBetween(userId1, userId2);

    await app.register(
      friendsRoutes({
        repo: friendsRepo,
        requireSession,
        onFriendshipRemoved: revokeFoodListSharesOnUnfriend,
      }),
    );
    await app.ready();
  });

  it('revokes bidirectional Food List shares when friends are removed via DELETE /me/friends/:userId', async () => {
    // 1. User A creates private list A and shares with User B as editor
    const listA = await foodListRepo.createList(userA, { name: 'Favorites A' });
    await foodListShareRepo.shareWithFriend(listA.id, userA, userB, 'editor');

    // 2. User B creates private list B and shares with User A as viewer
    const listB = await foodListRepo.createList(userB, { name: 'Favorites B' });
    await foodListShareRepo.shareWithFriend(listB.id, userB, userA, 'viewer');

    // Verify initial shares exist
    const sharesA = await foodListShareRepo.listShares(listA.id, userA);
    expect(sharesA).toHaveLength(1);
    expect(sharesA[0]!.recipientId).toBe(userB);

    const sharesB = await foodListShareRepo.listShares(listB.id, userB);
    expect(sharesB).toHaveLength(1);
    expect(sharesB[0]!.recipientId).toBe(userA);

    // Both can view each other's lists
    await expect(foodListRepo.getListDetail(listA.id, userB)).resolves.toBeDefined();
    await expect(foodListRepo.getListDetail(listB.id, userA)).resolves.toBeDefined();

    // 3. User A unfriends User B via DELETE /me/friends/:userId
    currentUserId = userA;
    const response = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${userB}`,
    });

    expect(response.statusCode).toBe(204);

    // 4. Assert friendship is removed from friendships
    const { lo, hi } = pair(userA, userB);
    const friendCheck = await pool.query(
      `SELECT 1 FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2`,
      [lo, hi],
    );
    expect(friendCheck.rows).toHaveLength(0);

    // 5. Assert all shares between A and B are removed in both directions
    const sharesAfterA = await foodListShareRepo.listShares(listA.id, userA);
    expect(sharesAfterA).toHaveLength(0);

    const sharesAfterB = await foodListShareRepo.listShares(listB.id, userB);
    expect(sharesAfterB).toHaveLength(0);

    // 6. Neither can view the other's private list anymore
    await expect(foodListRepo.getListDetail(listA.id, userB)).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
    );
    await expect(foodListRepo.getListDetail(listB.id, userA)).rejects.toSatisfy(
      (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
    );
  });

  it('returns 404 when unfriending non-friend, leaving shares intact', async () => {
    currentUserId = userA;
    const response = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${userC}`,
    });

    expect(response.statusCode).toBe(404);
  });
});
