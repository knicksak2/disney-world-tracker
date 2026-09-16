/**
 * Property tests for Food_Item_Log history and scoped retrieval (Feature: food-item-logging R8, R9).
 *
 * Validates:
 *   - Property 10: My Food History Completeness and Ordering (R8.1, R8.2, R8.4)
 *   - Property 11: Restaurant/Location-Scoped Logged Items Isolation (R9.1, R9.2, R9.3)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import {
  createFoodItemLogRepo,
  type FoodItemLogRepo,
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

const fixedClock = () => new Date('2026-06-20T12:00:00Z');

describe('FoodItemLogHistory Property Tests (Property 10, 11)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let logRepo: FoodItemLogRepo;

  let userA: string;
  let userB: string;

  let restA: string;
  let restB: string;
  let locA: string;
  let locB: string;

  let itemRA1: string;
  let itemRA2: string;
  let itemRB1: string;
  let itemLA1: string;
  let itemLB1: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0043_food_item_log_history_index.sql');

    // Add experience_menus table for currentlyOnMenu join
    db.public.none(`
      CREATE TABLE IF NOT EXISTS experience_menus (
        experience_id UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
        menus JSONB NOT NULL DEFAULT '[]'::jsonb,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    userA = randomUUID();
    userB = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'userA@example.com', 'hash'),
              ($2, 'userB@example.com', 'hash')`,
      [userA, userB],
    );

    restA = randomUUID();
    restB = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Be Our Guest', 'Restaurant', 'Magic Kingdom', 'ent-bog'),
              ($2, 'Le Cellier', 'Restaurant', 'EPCOT', 'ent-lc')`,
      [restA, restB],
    );

    // experience_menus for restA fetched_at = 2026-06-15
    await pool.query(
      `INSERT INTO experience_menus (experience_id, menus, fetched_at)
       VALUES ($1, '[]'::jsonb, '2026-06-15T00:00:00Z')`,
      [restA],
    );

    locA = randomUUID();
    locB = randomUUID();
    await pool.query(
      `INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
       VALUES ($1, 'Spring Roll Cart', 'Magic Kingdom', $2),
              ($3, 'Fife and Drum Tavern', 'EPCOT', $2)`,
      [locA, userA, locB],
    );

    logRepo = createFoodItemLogRepo({ pool, clock: fixedClock });

    // itemRA1: menu_sync, last_seen_at = 2026-06-16 (currentlyOnMenu = true)
    itemRA1 = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, source, last_seen_at)
       VALUES ($1, $2, 'Grey Stuff', 'menu_sync', '2026-06-16T00:00:00Z')`,
      [itemRA1, restA],
    );

    // itemRA2: menu_sync, last_seen_at = 2026-06-01 (currentlyOnMenu = false)
    itemRA2 = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, source, last_seen_at)
       VALUES ($1, $2, 'French Onion Soup', 'menu_sync', '2026-06-01T00:00:00Z')`,
      [itemRA2, restA],
    );

    // itemRB1: menu_sync at restB
    itemRB1 = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, source)
       VALUES ($1, $2, 'Cheddar Cheese Soup', 'menu_sync')`,
      [itemRB1, restB],
    );

    // itemLA1: user_submitted at locA (currentlyOnMenu = true)
    itemLA1 = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, location_id, name, source)
       VALUES ($1, $2, 'Cheeseburger Spring Roll', 'user_submitted')`,
      [itemLA1, locA],
    );

    // itemLB1: user_submitted at locB
    itemLB1 = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, location_id, name, source)
       VALUES ($1, $2, 'Turkey Leg', 'user_submitted')`,
      [itemLB1, locB],
    );
  });

  // Feature: food-item-logging, Property 10: My Food History Completeness and Ordering
  it('Property 10: My Food History returns all user logs with correct context, ordering, and reflects deletion', async () => {
    const allItems = [
      { id: itemRA1, name: 'Grey Stuff', restName: 'Be Our Guest', locName: null, onMenu: true },
      { id: itemRA2, name: 'French Onion Soup', restName: 'Be Our Guest', locName: null, onMenu: false },
      { id: itemRB1, name: 'Cheddar Cheese Soup', restName: 'Le Cellier', locName: null, onMenu: false },
      { id: itemLA1, name: 'Cheeseburger Spring Roll', restName: null, locName: 'Spring Roll Cart', onMenu: true },
      { id: itemLB1, name: 'Turkey Leg', restName: null, locName: 'Fife and Drum Tavern', onMenu: true },
    ];

    const logSpecArbitrary = fc.record({
      user: fc.constantFrom('userA', 'userB'),
      itemIndex: fc.integer({ min: 0, max: allItems.length - 1 }),
      day: fc.integer({ min: 1, max: 18 }),
      rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
      note: fc.option(fc.stringMatching(/^[a-zA-Z0-9 .,!?-]{1,40}$/), { nil: null }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(logSpecArbitrary, { minLength: 1, maxLength: 10 }), async (specs) => {
        // Clear logs before each property run
        await pool.query('DELETE FROM food_item_logs');

        const insertedUserALogIds: string[] = [];

        for (const spec of specs) {
          const targetUserId = spec.user === 'userA' ? userA : userB;
          const targetItem = allItems[spec.itemIndex]!;
          const visitedOn = `2026-06-${String(spec.day).padStart(2, '0')}`;

          const created = await logRepo.addLog({
            userId: targetUserId,
            foodItemId: targetItem.id,
            visitedOn,
            userTz: 'America/New_York',
            rating: spec.rating,
            note: spec.note,
          });

          if (spec.user === 'userA') {
            insertedUserALogIds.push(created.id);
          }
        }

        const userALogs = await logRepo.getAllLogsForUser(userA);

        // 1. Completeness: exactly userA's logs
        expect(userALogs).toHaveLength(insertedUserALogIds.length);
        for (const log of userALogs) {
          expect(log.userId).toBe(userA);
          expect(insertedUserALogIds).toContain(log.id);

          const expectedItem = allItems.find((i) => i.id === log.foodItemId)!;
          expect(log.foodItemName).toBe(expectedItem.name);
          expect(log.currentlyOnMenu).toBe(expectedItem.onMenu);
          expect(log.restaurantName).toBe(expectedItem.restName);
          expect(log.locationName).toBe(expectedItem.locName);
          // Exactly one scope name is non-null
          const hasRest = log.restaurantName !== null;
          const hasLoc = log.locationName !== null;
          expect(hasRest !== hasLoc).toBe(true);
        }

        // 2. Ordering: visited_on DESC, logged_at DESC
        for (let i = 0; i < userALogs.length - 1; i++) {
          const a = userALogs[i]!;
          const b = userALogs[i + 1]!;
          if (a.visitedOn === b.visitedOn) {
            expect(a.loggedAt >= b.loggedAt).toBe(true);
          } else {
            expect(a.visitedOn > b.visitedOn).toBe(true);
          }
        }

        // 3. Reflects deletion: delete one log if any exist
        if (userALogs.length > 0) {
          const targetToDelete = userALogs[0]!;
          await logRepo.deleteLog(userA, targetToDelete.foodItemId, targetToDelete.id);

          const remainingLogs = await logRepo.getAllLogsForUser(userA);
          expect(remainingLogs).toHaveLength(userALogs.length - 1);
          expect(remainingLogs.find((l) => l.id === targetToDelete.id)).toBeUndefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: food-item-logging, Property 11: Restaurant/Location-Scoped Logged Items Isolation
  it('Property 11: Scoped queries isolate logs by experience, location, and user', async () => {
    const logSpecArbitrary = fc.record({
      user: fc.constantFrom('userA', 'userB'),
      dishCategory: fc.constantFrom('restA', 'restB', 'locA', 'locB'),
      day: fc.integer({ min: 1, max: 18 }),
      rating: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(logSpecArbitrary, { minLength: 1, maxLength: 12 }), async (specs) => {
        await pool.query('DELETE FROM food_item_logs');

        let userARestACount = 0;
        let userALocACount = 0;

        for (const spec of specs) {
          const targetUserId = spec.user === 'userA' ? userA : userB;
          let foodItemId: string;
          if (spec.dishCategory === 'restA') foodItemId = itemRA1;
          else if (spec.dishCategory === 'restB') foodItemId = itemRB1;
          else if (spec.dishCategory === 'locA') foodItemId = itemLA1;
          else foodItemId = itemLB1;

          await logRepo.addLog({
            userId: targetUserId,
            foodItemId,
            visitedOn: `2026-06-${String(spec.day).padStart(2, '0')}`,
            userTz: 'America/New_York',
            rating: spec.rating,
          });

          if (spec.user === 'userA' && spec.dishCategory === 'restA') {
            userARestACount++;
          }
          if (spec.user === 'userA' && spec.dishCategory === 'locA') {
            userALocACount++;
          }
        }

        // Query scoped to restA for userA
        const restALogs = await logRepo.getLogsForUserAtScope(userA, { experienceId: restA });
        expect(restALogs).toHaveLength(userARestACount);
        for (const log of restALogs) {
          expect(log.userId).toBe(userA);
          expect(log.restaurantName).toBe('Be Our Guest');
          expect(log.locationName).toBeNull();
          expect(log.foodItemId).toBe(itemRA1);
        }

        // Query scoped to locA for userA
        const locALogs = await logRepo.getLogsForUserAtScope(userA, { locationId: locA });
        expect(locALogs).toHaveLength(userALocACount);
        for (const log of locALogs) {
          expect(log.userId).toBe(userA);
          expect(log.locationName).toBe('Spring Roll Cart');
          expect(log.restaurantName).toBeNull();
          expect(log.foodItemId).toBe(itemLA1);
        }

        // Unused scope returns empty array with no error
        const unusedExpId = randomUUID();
        const emptyExpLogs = await logRepo.getLogsForUserAtScope(userA, { experienceId: unusedExpId });
        expect(emptyExpLogs).toEqual([]);

        const unusedLocId = randomUUID();
        const emptyLocLogs = await logRepo.getLogsForUserAtScope(userA, { locationId: unusedLocId });
        expect(emptyLocLogs).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
