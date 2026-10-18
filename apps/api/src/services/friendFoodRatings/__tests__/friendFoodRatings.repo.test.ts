/**
 * Integration and property tests for FriendFoodRatingsRepo using pg-mem.
 *
 * Setup loads 0001_init.sql and 0040_food_item_logging.sql, then runs
 * ALTER TABLE experiences ALTER COLUMN park DROP NOT NULL (mirroring 0004).
 *
 * Validates: Requirements 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.2, 5.3, 6.1, 6.3, 6.4, 6.5, 6.6, 6.8, 11.1
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Park } from '@dwt/shared';
import { FRIEND_FOOD_SORTS } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import {
  aggregateByDish,
  compareDishes,
  groupSocialProof,
  toLikeContainsPattern,
  type DishLogInput,
} from '../dishAggregate.js';
import {
  createFriendFoodRatingsRepo,
  type FriendFoodRatingsRepo,
} from '../repo.js';

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
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  db.public.registerFunction({
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

describe('FriendFoodRatingsRepo integration tests (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: FriendFoodRatingsRepo;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    // Load only 0001 and 0040 per spec
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');

    // Recorded deviation: 0004 is not loaded; run the park DROP NOT NULL directly
    db.public.none('ALTER TABLE experiences ALTER COLUMN park DROP NOT NULL;');
    db.public.none('ALTER TABLE experiences DROP CONSTRAINT experiences_park_chk;');

    // Phase 2 setup deviation: 0013_avatar_presets.sql is not loaded; add avatar_preset to profiles directly
    db.public.none('ALTER TABLE profiles ADD COLUMN avatar_preset TEXT;');

    repo = createFriendFoodRatingsRepo(pool);
  });

  it('Property 1: rows carry no note, id, user_tz, or logged_at', async () => {
    const userId = randomUUID();
    const expId = randomUUID();
    const dishId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [userId, `u_${userId}@test.com`],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Be Our Guest', 'Magic Kingdom', 'Restaurant')`,
      [expId, `ent_${expId}`],
    );
    await pool.query(
      `INSERT INTO food_items (id, name, experience_id) VALUES ($1, 'Grey Stuff', $2)`,
      [dishId, expId],
    );
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, note, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 9, 'TOP SECRET NOTE', '2024-05-01', NOW(), 'America/New_York')`,
      [randomUUID(), userId, dishId],
    );

    const { rows } = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      minRatedLogs: 0,
    });

    expect(rows.length).toBe(1);
    const row = rows[0] as unknown as Record<string, unknown>;
    expect(row).not.toHaveProperty('note');
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('userTz');
    expect(row).not.toHaveProperty('user_tz');
    expect(row).not.toHaveProperty('loggedAt');
    expect(row).not.toHaveProperty('logged_at');
  });

  it('regression: park filter returns location-scoped dishes of that park', async () => {
    const userId = randomUUID();
    const locId = randomUUID();
    const dishId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [userId, `u_${userId}@test.com`],
    );
    await pool.query(
      `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
       VALUES ($1, 'Kiosk Cart', 'EPCOT', $2)`,
      [locId, userId],
    );
    await pool.query(
      `INSERT INTO food_items (id, name, location_id) VALUES ($1, 'Special Pretzel', $2)`,
      [dishId, locId],
    );
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 8, '2024-05-01', NOW(), 'America/New_York')`,
      [randomUUID(), userId, dishId],
    );

    // Filter by EPCOT: must match the location-scoped dish
    const { rows: epcotRows } = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      park: 'EPCOT',
      minRatedLogs: 0,
    });
    expect(epcotRows.length).toBe(1);
    expect(epcotRows[0]!.foodItemId).toBe(dishId);
    expect(epcotRows[0]!.scopeKind).toBe('location');
    expect(epcotRows[0]!.park).toBe('EPCOT');

    // Filter by Magic Kingdom: must return 0
    const { rows: mkRows } = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      park: 'Magic Kingdom',
      minRatedLogs: 0,
    });
    expect(mkRows.length).toBe(0);
  });

  it('listScopes returns location Scopes with non-null park and empty array for user with no logs', async () => {
    const userId = randomUUID();
    const emptyUserId = randomUUID();
    const locId = randomUUID();
    const dishId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash'), ($3, $4, 'hash')`,
      [userId, `u_${userId}@test.com`, emptyUserId, `u_${emptyUserId}@test.com`],
    );
    await pool.query(
      `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
       VALUES ($1, 'Festival Booth', 'EPCOT', $2)`,
      [locId, userId],
    );
    await pool.query(
      `INSERT INTO food_items (id, name, location_id) VALUES ($1, 'Tasting Dish', $2)`,
      [dishId, locId],
    );
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 7, '2024-05-01', NOW(), 'America/New_York')`,
      [randomUUID(), userId, dishId],
    );

    const scopes = await repo.listScopes(userId);
    expect(scopes.length).toBe(1);
    expect(scopes[0]!.kind).toBe('location');
    expect(scopes[0]!.id).toBe(locId);
    expect(scopes[0]!.name).toBe('Festival Booth');
    expect(scopes[0]!.park).toBe('EPCOT');
    expect(scopes[0]!.dishCount).toBe(1);

    const emptyScopes = await repo.listScopes(emptyUserId);
    expect(emptyScopes).toEqual([]);
  });

  it('recent sort orders dishes with equal latestVisitedOn by foodItemId ASC, not logged_at', async () => {
    const userId = randomUUID();
    const expId = randomUUID();
    // Dish B has an ID that is lexicographically GREATER than Dish A
    const dishIdA = '00000000-0000-4000-8000-000000000001';
    const dishIdB = '00000000-0000-4000-8000-000000000002';

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [userId, `u_${userId}@test.com`],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Test Restaurant', 'Magic Kingdom', 'Restaurant')`,
      [expId, `ent_${expId}`],
    );
    await pool.query(
      `INSERT INTO food_items (id, name, experience_id) VALUES ($1, 'Dish A', $3), ($2, 'Dish B', $3)`,
      [dishIdA, dishIdB, expId],
    );

    // Dish A was logged at a LATER timestamp than Dish B, but both visited on the SAME date
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $3, $4, 8, '2024-05-01', '2024-05-01 10:00:00Z', 'UTC'),
              ($2, $3, $5, 8, '2024-05-01', '2024-05-01 08:00:00Z', 'UTC')`,
      [randomUUID(), randomUUID(), userId, dishIdA, dishIdB],
    );

    const { rows } = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      minRatedLogs: 0,
    });

    expect(rows.length).toBe(2);
    // Since visitedOn is equal, foodItemId ASC dictates Dish A then Dish B
    expect(rows[0]!.foodItemId).toBe(dishIdA);
    expect(rows[1]!.foodItemId).toBe(dishIdB);

    // Keyset cursor for recent: cursor_b is null, cursor_a is latestVisitedOn
    expect(rows[0]!.cursorA).toBe('2024-05-01');
    expect(rows[0]!.cursorB).toBeNull();
  });

  it('unrated-only dishes have averageRating = null and are excluded by minRatedLogs=1', async () => {
    const userId = randomUUID();
    const expId = randomUUID();
    const dishUnrated = randomUUID();
    const dishRated = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [userId, `u_${userId}@test.com`],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Test Restaurant', 'Magic Kingdom', 'Restaurant')`,
      [expId, `ent_${expId}`],
    );
    await pool.query(
      `INSERT INTO food_items (id, name, experience_id) VALUES ($1, 'Unrated Dish', $3), ($2, 'Rated Dish', $3)`,
      [dishUnrated, dishRated, expId],
    );
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $3, $4, NULL, '2024-05-01', NOW(), 'UTC'),
              ($2, $3, $5, 9, '2024-05-01', NOW(), 'UTC')`,
      [randomUUID(), randomUUID(), userId, dishUnrated, dishRated],
    );

    // minRatedLogs = 0 -> both returned
    const { rows: allRows } = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      minRatedLogs: 0,
    });
    expect(allRows.length).toBe(2);
    const unrated = allRows.find((r) => r.foodItemId === dishUnrated)!;
    expect(unrated.averageRating).toBeNull();
    expect(unrated.ratedCount).toBe(0);

    // minRatedLogs = 1 -> only rated returned
    const { rows: ratedRows } = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      minRatedLogs: 1,
    });
    expect(ratedRows.length).toBe(1);
    expect(ratedRows[0]!.foodItemId).toBe(dishRated);
  });

  // Feature: friend-food-ratings, Property 12: Highlights are the top rated dishes under the lower threshold
  it('Property 12: Highlights parameters (highest_rated, limit 5, minRatedLogs 1) select top rated dishes', async () => {
    const userId = randomUUID();
    const expId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [userId, `u_${userId}@test.com`],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Test Restaurant', 'Magic Kingdom', 'Restaurant')`,
      [expId, `ent_${expId}`],
    );

    // Seed 7 dishes: 1 unrated, 6 rated with ratings 4, 5, 6, 7, 8, 9
    const dishIds: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dId = `00000000-0000-4000-8000-${(i + 1).toString(16).padStart(12, '0')}`;
      dishIds.push(dId);
      await pool.query(
        `INSERT INTO food_items (id, name, experience_id) VALUES ($1, $2, $3)`,
        [dId, `Dish ${i + 1}`, expId],
      );
    }

    // Dish 0: unrated
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, NULL, '2024-05-01', NOW(), 'UTC')`,
      [randomUUID(), userId, dishIds[0]],
    );
    // Dishes 1 to 6: ratings 4 to 9
    for (let i = 1; i < 7; i++) {
      await pool.query(
        `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
         VALUES ($1, $2, $3, $4, '2024-05-01', NOW(), 'UTC')`,
        [randomUUID(), userId, dishIds[i], i + 3],
      );
    }

    const { rows } = await repo.listDishes({
      targetUserId: userId,
      sort: 'highest_rated',
      limit: 5,
      minRatedLogs: 1,
    });

    expect(rows.length).toBe(5);
    // Should be top 5 ratings: 9, 8, 7, 6, 5 (dishes 6, 5, 4, 3, 2)
    expect(rows.map((r) => r.averageRating)).toEqual([9, 8, 7, 6, 5]);
    // Unrated dish 0 and dish 1 (rating 4) are excluded
    expect(rows.some((r) => r.foodItemId === dishIds[0])).toBe(false);
    expect(rows.some((r) => r.foodItemId === dishIds[1])).toBe(false);
  });

  // Model-based test: verifies listDishes agrees with aggregateByDish + compareDishes
  it('Property 3-7: model-based test comparing SQL output against pure reference model', async () => {
    // Generate a fixed suite of dishes across experiences (including null park) and user-submitted locations
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [userId, `u_${userId}@test.com`],
    );

    const expWithParkId = randomUUID();
    const expNullParkId = randomUUID();
    const locationId = randomUUID();

    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, $2, 'Be Our Guest', 'Magic Kingdom', 'Restaurant'),
              ($3, $4, 'Hotel Dining Room', NULL, 'Restaurant')`,
      [expWithParkId, `ent_${expWithParkId}`, expNullParkId, `ent_${expNullParkId}`],
    );

    await pool.query(
      `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
       VALUES ($1, 'Boardwalk Snack Cart', 'EPCOT', $2)`,
      [locationId, userId],
    );

    // Create 6 dishes: 2 in expWithPark, 2 in expNullPark, 2 in location
    const dishes = [
      { id: '10000000-0000-4000-8000-000000000001', name: 'Grey Stuff', expId: expWithParkId, locId: null, park: 'Magic Kingdom' as Park | null },
      { id: '10000000-0000-4000-8000-000000000002', name: 'French Onion Soup', expId: expWithParkId, locId: null, park: 'Magic Kingdom' as Park | null },
      { id: '10000000-0000-4000-8000-000000000003', name: 'Steak Tartare', expId: expNullParkId, locId: null, park: null },
      { id: '10000000-0000-4000-8000-000000000004', name: 'Bread Service', expId: expNullParkId, locId: null, park: null },
      { id: '10000000-0000-4000-8000-000000000005', name: 'Boardwalk Pretzel', expId: null, locId: locationId, park: 'EPCOT' as Park | null },
      { id: '10000000-0000-4000-8000-000000000006', name: 'Churro Delight', expId: null, locId: locationId, park: 'EPCOT' as Park | null },
    ];

    for (const d of dishes) {
      await pool.query(
        `INSERT INTO food_items (id, name, experience_id, location_id) VALUES ($1, $2, $3, $4)`,
        [d.id, d.name, d.expId, d.locId],
      );
    }

    // Seed multiple logs per dish with varying ratings and dates
    const rawLogs: DishLogInput[] = [
      { foodItemId: dishes[0]!.id, rating: 9, visitedOn: '2024-05-10' },
      { foodItemId: dishes[0]!.id, rating: 10, visitedOn: '2024-05-15' },
      { foodItemId: dishes[1]!.id, rating: 8, visitedOn: '2024-04-01' },
      { foodItemId: dishes[1]!.id, rating: null, visitedOn: '2024-05-01' },
      { foodItemId: dishes[2]!.id, rating: 7, visitedOn: '2024-06-20' },
      { foodItemId: dishes[3]!.id, rating: null, visitedOn: '2024-03-15' },
      { foodItemId: dishes[4]!.id, rating: 6, visitedOn: '2024-07-04' },
      { foodItemId: dishes[5]!.id, rating: 8, visitedOn: '2024-07-04' },
    ];

    for (const log of rawLogs) {
      await pool.query(
        `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, note, visited_on, logged_at, user_tz)
         VALUES ($1, $2, $3, $4, 'SENTINEL_NOTE', $5, NOW(), 'America/New_York')`,
        [randomUUID(), userId, log.foodItemId, log.rating, log.visitedOn],
      );
    }

    const modelAggregates = aggregateByDish(rawLogs);

    // Test each sort against the model
    for (const sort of FRIEND_FOOD_SORTS) {
      const cmp = compareDishes(sort);
      const expectedSorted = [...modelAggregates].sort(cmp);

      // Paged retrieval
      let cursor: { a: string; b: string | null; id: string } | undefined;
      const gatheredRows: typeof expectedSorted = [];

      do {
        const { rows, hasMore } = await repo.listDishes({
          targetUserId: userId,
          sort,
          limit: 2,
          cursor,
          minRatedLogs: 0,
        });

        for (const r of rows) {
          const matchingDish = dishes.find((d) => d.id === r.foodItemId)!;
          expect(r.park).toBe(matchingDish.park);
          gatheredRows.push({
            foodItemId: r.foodItemId,
            averageRating: r.averageRating,
            ratedLogCount: r.ratedCount,
            logCount: r.logCount,
            latestVisitedOn: r.latestVisitedOn,
          });
        }

        if (hasMore && rows.length > 0) {
          const last = rows[rows.length - 1]!;
          cursor = { a: last.cursorA, b: last.cursorB, id: last.foodItemId };
        } else {
          cursor = undefined;
        }
      } while (cursor !== undefined);

      expect(gatheredRows.length).toBe(expectedSorted.length);
      for (let i = 0; i < expectedSorted.length; i++) {
        const exp = expectedSorted[i]!;
        const act = gatheredRows[i]!;
        expect(act.foodItemId).toBe(exp.foodItemId);
        expect(act.logCount).toBe(exp.logCount);
        expect(act.ratedLogCount).toBe(exp.ratedLogCount);
        expect(act.latestVisitedOn).toBe(exp.latestVisitedOn);
        if (exp.averageRating === null) {
          expect(act.averageRating).toBeNull();
        } else {
          expect(act.averageRating).toBeCloseTo(exp.averageRating, 9);
        }
      }
    }
  });

  // Feature: friend-food-ratings, Property 7: Filters and search compose conjunctively and match literally
  it('R6.5: q filters dishes via listDishes and likePattern (pg-mem LIKE limitation documented in tasks.md)', async () => {
    const userId = randomUUID();
    const expId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
      [userId, `u_${userId}@test.com`],
    );
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Test Diner', 'EPCOT', 'Restaurant')`,
      [expId, `ent_${expId}`],
    );

    const dishJuice = randomUUID();
    const dishChurro = randomUUID();
    const dishWhip = randomUUID();

    await pool.query(
      `INSERT INTO food_items (id, name, experience_id) VALUES
       ($1, '100% Orange Juice', $4),
       ($2, 'Special_Churro_Treat', $4),
       ($3, 'Plain Dole Whip', $4)`,
      [dishJuice, dishChurro, dishWhip, expId],
    );

    for (const dId of [dishJuice, dishChurro, dishWhip]) {
      await pool.query(
        `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
         VALUES ($1, $2, $3, 8, '2024-05-01', NOW(), 'UTC')`,
        [randomUUID(), userId, dId],
      );
    }

    const dishBackslash = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, name, experience_id) VALUES ($1, 'Apple\\\\Pie', $2)`,
      [dishBackslash, expId],
    );
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 8, '2024-05-01', NOW(), 'UTC')`,
      [randomUUID(), userId, dishBackslash],
    );

    // Substring search via toLikeContainsPattern works through listDishes
    const resOrange = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      minRatedLogs: 0,
      likePattern: toLikeContainsPattern('Orange'),
    });
    expect(resOrange.rows.length).toBe(1);
    expect(resOrange.rows[0]!.foodItemId).toBe(dishJuice);
    expect(resOrange.rows[0]!.foodItemName).toBe('100% Orange Juice');

    const resChurro = await repo.listDishes({
      targetUserId: userId,
      sort: 'recent',
      limit: 10,
      minRatedLogs: 0,
      likePattern: toLikeContainsPattern('Churro'),
    });
    expect(resChurro.rows.length).toBe(1);
    expect(resChurro.rows[0]!.foodItemId).toBe(dishChurro);
    expect(resChurro.rows[0]!.foodItemName).toBe('Special_Churro_Treat');
  });

  // Feature: friend-food-ratings, Property 8: Batch social proof equals the single-friend aggregates
  // Feature: friend-food-ratings, Property 15: Reads are bounded, read-only and issue a fixed number of queries
  it('Property 8 & 15: listFriendSocialProof matches single-friend listDishes, excludes non-friends and self, and issues exactly one query', async () => {
    const vId = randomUUID();
    const f1Id = randomUUID();
    const f2Id = randomUUID();
    const nfId = randomUUID();

    // Users and profiles
    for (const [id, email, name, preset] of [
      [vId, 'v@t.com', 'Viewer', null],
      [f1Id, 'f1@t.com', 'Friend One', 'castle'],
      [f2Id, 'f2@t.com', 'Friend Two', null],
      [nfId, 'nf@t.com', 'Non Friend', null],
    ] as const) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
        [id, email],
      );
      await pool.query(
        `INSERT INTO profiles (user_id, display_name, avatar_preset) VALUES ($1, $2, $3)`,
        [id, name, preset],
      );
    }

    // Friendships (canonical pair)
    for (const friendId of [f1Id, f2Id]) {
      const lo = vId < friendId ? vId : friendId;
      const hi = vId < friendId ? friendId : vId;
      await pool.query(
        `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
        [lo, hi],
      );
    }

    // Experience scope and Location scope
    const expId = randomUUID();
    const locId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Chef Mickey', 'Contemporary Resort', 'Restaurant')`,
      [expId, `ent_${expId}`],
    );
    await pool.query(
      `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id) VALUES ($1, 'Snack Cart', 'EPCOT', $2)`,
      [locId, vId],
    );

    const dish1 = randomUUID();
    const dish2 = randomUUID();
    const dish3 = randomUUID();

    await pool.query(
      `INSERT INTO food_items (id, name, experience_id) VALUES ($1, 'Mickey Waffle', $3), ($2, 'Pancake Stack', $3)`,
      [dish1, dish2, expId],
    );
    await pool.query(
      `INSERT INTO food_items (id, name, location_id) VALUES ($1, 'Pretzel', $2)`,
      [dish3, locId],
    );

    // Logs:
    // F1 logs dish1 twice (9 on 2024-05-01, 7 on 2024-05-03)
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 9, '2024-05-01', NOW(), 'UTC'),
              ($4, $2, $3, 7, '2024-05-03', NOW(), 'UTC')`,
      [randomUUID(), f1Id, dish1, randomUUID()],
    );
    // F2 logs dish1 once (6 on 2024-05-02)
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 6, '2024-05-02', NOW(), 'UTC')`,
      [randomUUID(), f2Id, dish1],
    );
    // Viewer logs dish1 (must be excluded from viewer's batch proof)
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 10, '2024-05-04', NOW(), 'UTC')`,
      [randomUUID(), vId, dish1],
    );
    // Non-friend logs dish1 (must be excluded)
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 10, '2024-05-04', NOW(), 'UTC')`,
      [randomUUID(), nfId, dish1],
    );
    // F1 logs dish2 with rating NULL (unrated only -> excluded by HAVING COUNT(rating) >= 1)
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, NULL, '2024-05-01', NOW(), 'UTC')`,
      [randomUUID(), f1Id, dish2],
    );
    // F2 logs dish3 on location scope
    await pool.query(
      `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
       VALUES ($1, $2, $3, 8, '2024-05-01', NOW(), 'UTC')`,
      [randomUUID(), f2Id, dish3],
    );

    // Property 15 query counting: exactly 1 SQL query for batch social proof
    let queryCount = 0;
    const origQuery = pool.query.bind(pool);
    pool.query = (async (...args: unknown[]) => {
      queryCount++;
      return (origQuery as any)(...args);
    }) as typeof pool.query;

    const { rows, capped } = await repo.listFriendSocialProof(vId, {
      kind: 'experience',
      id: expId,
    });

    expect(queryCount).toBe(1);
    expect(capped).toBe(false);
    expect(rows.length).toBe(2);

    // F1 has avg 8.0, F2 has avg 6.0 -> ordered by food_item_id ASC, avg_rating DESC
    const rF1 = rows.find((r) => r.friendId === f1Id)!;
    const rF2 = rows.find((r) => r.friendId === f2Id)!;
    expect(rF1).toBeDefined();
    expect(rF2).toBeDefined();

    expect(rF1.displayName).toBe('Friend One');
    expect(rF1.avatarPreset).toBe('castle');
    expect(rF1.averageRating).toBe(8.0);
    expect(rF1.ratedLogCount).toBe(2);
    expect(rF1.logCount).toBe(2);
    expect(rF1.latestVisitedOn).toBe('2024-05-03');

    // Property 8: verify equality with single-friend listDishes row
    const singleFriendDishes = await repo.listDishes({
      targetUserId: f1Id,
      sort: 'recent',
      limit: 10,
      minRatedLogs: 0,
    });
    const singleF1 = singleFriendDishes.rows.find((r) => r.foodItemId === dish1)!;
    expect(rF1.averageRating).toBe(singleF1.averageRating);
    expect(rF1.ratedLogCount).toBe(singleF1.ratedCount);
    expect(rF1.logCount).toBe(singleF1.logCount);
    expect(rF1.latestVisitedOn).toBe(singleF1.latestVisitedOn);

    // Excluded rows: viewer, non-friend, unrated dish2
    expect(rows.some((r) => r.friendId === vId)).toBe(false);
    expect(rows.some((r) => r.friendId === nfId)).toBe(false);
    expect(rows.some((r) => r.foodItemId === dish2)).toBe(false);

    // Grouping check: 1 dish, 2 friends, friendsAverageRating = (8 + 6) / 2 = 7.0
    const grouped = groupSocialProof(rows, 3, capped);
    expect(grouped.length).toBe(1);
    expect(grouped[0]!.foodItemId).toBe(dish1);
    expect(grouped[0]!.friendCount).toBe(2);
    expect(grouped[0]!.friendsAverageRating).toBe(7.0);
    expect(grouped[0]!.friends.length).toBe(2);

    // Location scope check
    const locResult = await repo.listFriendSocialProof(vId, {
      kind: 'location',
      id: locId,
    });
    expect(locResult.rows.length).toBe(1);
    expect(locResult.rows[0]!.foodItemId).toBe(dish3);
    expect(locResult.rows[0]!.friendId).toBe(f2Id);
  });

  // Feature: friend-food-ratings, Property 15: batch LIMIT cap + 1 sets capped = true and groupSocialProof drops partial final dish
  it('Property 15: batch LIMIT cap + 1 sets capped = true and groupSocialProof drops partial final dish', async () => {
    const vId = randomUUID();
    const fId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'v2@t.com', 'h'), ($2, 'f2@t.com', 'h')`,
      [vId, fId],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name) VALUES ($1, 'V2'), ($2, 'F2')`,
      [vId, fId],
    );
    const lo = vId < fId ? vId : fId;
    const hi = vId < fId ? fId : vId;
    await pool.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
      [lo, hi],
    );

    const expId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, 'Cap Test Exp', 'EPCOT', 'Restaurant')`,
      [expId, `ent_${expId}`],
    );

    // 3 dishes ordered by UUID
    const d1 = '00000000-0000-4000-8000-000000000001';
    const d2 = '00000000-0000-4000-8000-000000000002';
    const d3 = '00000000-0000-4000-8000-000000000003';

    for (const d of [d1, d2, d3]) {
      await pool.query(
        `INSERT INTO food_items (id, name, experience_id) VALUES ($1, $2, $3)`,
        [d, `Dish ${d}`, expId],
      );
      await pool.query(
        `INSERT INTO food_item_logs (id, user_id, food_item_id, rating, visited_on, logged_at, user_tz)
         VALUES ($1, $2, $3, 8, '2024-05-01', NOW(), 'UTC')`,
        [randomUUID(), fId, d],
      );
    }

    // Configured with small cap = 2 (so 3 rows triggers cap + 1 fetch)
    const smallCapRepo = createFriendFoodRatingsRepo(pool, 2);
    const { rows, capped } = await smallCapRepo.listFriendSocialProof(vId, {
      kind: 'experience',
      id: expId,
    });

    expect(capped).toBe(true);
    expect(rows.length).toBe(2);
    // Rows contain d1 and d2 (d3 was the 3rd row, dropped by limit cap)
    expect(rows[0]!.foodItemId).toBe(d1);
    expect(rows[1]!.foodItemId).toBe(d2);

    // groupSocialProof with capped = true drops the final dish group (d2) to prevent partial dish counts
    const grouped = groupSocialProof(rows, 3, capped);
    expect(grouped.length).toBe(1);
    expect(grouped[0]!.foodItemId).toBe(d1);
    expect(grouped[0]!.friendCount).toBe(1);
  });
});
