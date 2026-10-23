/**
 * Integration test for unfriending immediate access revocation.
 *
 * Validates: Requirement 3.5, Property 10
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { pair } from '../../friends/canonicalPair.js';
import { createFriendsRepo, type FriendsRepo } from '../../friends/repo.js';
import { friendsRoutes } from '../../friends/routes.js';
import {
  createFriendFoodRatingsRepo,
  type FriendFoodRatingsRepo,
} from '../repo.js';
import { friendFoodRatingRoutes } from '../routes.js';

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
  pub.registerFunction({
    name: 'to_char',
    args: [DataType.date, DataType.text],
    returns: DataType.text,
    implementation: (d: unknown, _format: unknown): string => {
      if (d instanceof Date) return d.toISOString().split('T')[0]!;
      return String(d).split('T')[0]!;
    },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('friendFoodRatings.unfriend.integration — Property 10', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let friendsRepo: FriendsRepo;
  let ratingsRepo: FriendFoodRatingsRepo;
  let app: FastifyInstance;
  let currentUserId: string;

  let userA: string;
  let userB: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    // The visibility views (0064) read profiles.avatar_preset, friendships and trip_memberships.
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0064_account_deletion.sql');

    // Make experiences.park nullable per spec convention
    db.public.none('ALTER TABLE experiences ALTER COLUMN park DROP NOT NULL');


    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    friendsRepo = createFriendsRepo(pool);
    ratingsRepo = createFriendFoodRatingsRepo(pool);

    userA = randomUUID();
    userB = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'userA@test.com', 'hash'),
              ($2, 'userB@test.com', 'hash')`,
      [userA, userB],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, 'User A'), ($2, 'User B')`,
      [userA, userB],
    );

    // Make userA and userB friends in friendships table
    const { lo, hi } = pair(userA, userB);
    await pool.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
      [lo, hi],
    );

    app = Fastify({ logger: false });
    registerErrorHandler(app);

    const requireSession = async (request: { userId?: string }) => {
      request.userId = currentUserId;
    };

    await app.register(
      friendsRoutes({
        repo: friendsRepo,
        requireSession,
      }),
    );

    await app.register(
      friendFoodRatingRoutes({
        repo: ratingsRepo,
        pool,
        requireSession,
      }),
    );

    await app.ready();
  });

  // Feature: friend-food-ratings, Property 10: Unfriending takes effect on the very next read
  it('a viewer who can read a friend ratings gets profile_forbidden on the very next read after unfriend', async () => {
    // 1. User A can read User B's food ratings before unfriending
    currentUserId = userA;
    const initialRes = await app.inject({
      method: 'GET',
      url: `/users/${userB}/food-ratings`,
    });
    expect(initialRes.statusCode).toBe(200);

    // 2. User A unfriends User B via DELETE /me/friends/:userId (real removeFriend route)
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${userB}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // 3. User A immediately gets 403 profile_forbidden on the very next read with no revocation hook involved
    const nextResA = await app.inject({
      method: 'GET',
      url: `/users/${userB}/food-ratings`,
    });
    expect(nextResA.statusCode).toBe(403);
    expect(nextResA.json()).toEqual({
      error: {
        code: 'profile_forbidden',
        message: 'You may not view this profile.',
      },
    });

    // 4. Bidirectional revocation: User B also immediately gets 403 profile_forbidden reading User A
    currentUserId = userB;
    const nextResB = await app.inject({
      method: 'GET',
      url: `/users/${userA}/food-ratings`,
    });
    expect(nextResB.statusCode).toBe(403);
    expect(nextResB.json()).toEqual({
      error: {
        code: 'profile_forbidden',
        message: 'You may not view this profile.',
      },
    });
  });

  // Feature: friend-food-ratings, Property 10: Unfriending takes effect on the very next read
  it('Property 10: batch social proof immediately excludes former friend on the very next read after unfriend', async () => {
    const expId = randomUUID();
    const dishId = randomUUID();

    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, 'exp_1', 'Be Our Guest', 'Magic Kingdom', 'Restaurant')`,
      [expId],
    );
    await pool.query(
      `INSERT INTO food_items (id, name, experience_id)
       VALUES ($1, 'Grey Stuff', $2)`,
      [dishId, expId],
    );

    // User A and User B both log dishId
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 8, '2024-05-01', NOW(), 'UTC'),
              ($4, $5, $3, 9, '2024-05-02', NOW(), 'UTC')`,
      [randomUUID(), userA, dishId, randomUUID(), userB],
    );

    // 1. Before removal: User A sees User B in batch response
    currentUserId = userA;
    const batchBeforeA = await app.inject({
      method: 'GET',
      url: `/experiences/${expId}/food-item-logs/friends`,
    });
    expect(batchBeforeA.statusCode).toBe(200);
    const bodyA = batchBeforeA.json();
    expect(bodyA.items).toHaveLength(1);
    expect(bodyA.items[0].friends[0].friendId).toBe(userB);

    // User B sees User A in batch response
    currentUserId = userB;
    const batchBeforeB = await app.inject({
      method: 'GET',
      url: `/experiences/${expId}/food-item-logs/friends`,
    });
    expect(batchBeforeB.statusCode).toBe(200);
    const bodyB = batchBeforeB.json();
    expect(bodyB.items).toHaveLength(1);
    expect(bodyB.items[0].friends[0].friendId).toBe(userA);

    // 2. Real removeFriend via DELETE /me/friends/:userId
    currentUserId = userA;
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${userB}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // 3. Very next read: User A's batch response no longer has entries from User B
    const batchAfterA = await app.inject({
      method: 'GET',
      url: `/experiences/${expId}/food-item-logs/friends`,
    });
    expect(batchAfterA.statusCode).toBe(200);
    expect(batchAfterA.json()).toEqual({ items: [] });

    // 4. Very next read: User B's batch response no longer contains User A
    currentUserId = userB;
    const batchAfterB = await app.inject({
      method: 'GET',
      url: `/experiences/${expId}/food-item-logs/friends`,
    });
    expect(batchAfterB.statusCode).toBe(200);
    expect(batchAfterB.json()).toEqual({ items: [] });
  });
});
