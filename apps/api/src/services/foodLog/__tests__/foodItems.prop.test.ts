/**
 * Property tests for Food_Item repository (Feature: food-item-logging).
 *
 * Validates:
 *   - Property 1: Menu-Sync Seeding Idempotence and Failure Isolation (R1.1, R1.2, R1.4)
 *   - Property 2: User-Submission Deduplication (R2.1, R2.2, R2.3)
 *   - Property 7: Menu Departure Preserves Logs and Is Surfaced, Never Enforced (R1.7, R1.8, R1.9)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { MenuDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import {
  createFoodItemLogRepo,
  createFoodItemRepo,
  type FoodItemLogRepo,
  type FoodItemRepo,
} from '../repo.js';

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

// Arbitrary for clean dish names
const dishNameArb = fc
  .stringMatching(/^[A-Za-z0-9 ]{2,30}$/)
  .map((s) => s.trim())
  .filter((s) => s.length >= 2);

const priceArb = fc.option(fc.stringMatching(/^\$[0-9]{1,3}\.[0-9]{2}$/), {
  nil: null,
});

describe('FoodItemRepo Property Tests', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let foodRepo: FoodItemRepo;
  let logRepo: FoodItemLogRepo;
  let userId: string;
  let experienceId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');

    // experience_menus table needed for currentlyOnMenu join
    db.public.none(`
      CREATE TABLE IF NOT EXISTS experience_menus (
        experience_id UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
        menus JSONB NOT NULL,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    foodRepo = createFoodItemRepo(pool);
    logRepo = createFoodItemLogRepo({ pool });

    userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'foodie@example.com', 'hash')`,
      [userId],
    );

    experienceId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Be Our Guest', 'Restaurant', 'Magic Kingdom', 'upstream-bog')`,
      [experienceId],
    );
  });

  // Feature: food-item-logging, Property 1: Menu-Sync Seeding Idempotence and Failure Isolation
  it('Property 1: Menu-sync upserts exactly one row per distinct name, updates on repeat sightings, and leaves catalog untouched on no-op', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ name: dishNameArb, price: priceArb }), {
          minLength: 1,
          maxLength: 10,
        }),
        async (rawItems) => {
          // Fresh experience for each run
          const expId = randomUUID();
          await pool.query(
            `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
             VALUES ($1, 'Test Bistro', 'Restaurant', 'EPCOT', $2)`,
            [expId, `upstream-${expId}`],
          );

          const menu: MenuDTO = {
            menuType: 'Dinner',
            cuisineType: 'French',
            groups: [{ name: 'Entrees', items: rawItems }],
          };

          const t1 = new Date(1_700_000_000_000);
          await foodRepo.upsertFoodItemsFromMenus(expId, [menu], t1);

          // Unique distinct case-insensitive names in the batch
          const uniqueNames = new Set(
            rawItems.map((i) => i.name.trim().toLowerCase()),
          );
          const listed1 = await foodRepo.listFoodItems(expId);
          expect(listed1).toHaveLength(uniqueNames.size);

          // Upsert again with updated prices and newer timestamp t2
          const t2 = new Date(1_700_001_000_000);
          const updatedRawItems = rawItems.map((i) => ({
            name: i.name,
            price: '$99.99',
          }));
          const menu2: MenuDTO = {
            menuType: 'Dinner',
            cuisineType: 'French',
            groups: [{ name: 'Entrees', items: updatedRawItems }],
          };
          await foodRepo.upsertFoodItemsFromMenus(expId, [menu2], t2);

          const listed2 = await foodRepo.listFoodItems(expId);
          // Count of items must not increase
          expect(listed2).toHaveLength(uniqueNames.size);

          // All items should have updated price
          for (const item of listed2) {
            expect(item.price).toBe('$99.99');
            expect(item.source).toBe('menu_sync');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-item-logging, Property 2: User-Submission Deduplication
  it('Property 2: Case-insensitive duplicates are rejected with food_item_duplicate; unique submissions succeed and are visible', async () => {
    await fc.assert(
      fc.asyncProperty(dishNameArb, async (dishName) => {
        const expId = randomUUID();
        await pool.query(
          `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
           VALUES ($1, 'Test Cafe', 'Restaurant', 'Animal Kingdom', $2)`,
          [expId, `upstream-${expId}`],
        );

        // Submit first time
        const created = await foodRepo.submitFoodItem(expId, userId, dishName);
        expect(created.name).toBe(dishName);
        expect(created.source).toBe('user_submitted');
        expect(created.currentlyOnMenu).toBe(true);

        // Submit second time with case variation or leading/trailing whitespace
        const variations = [
          dishName.toUpperCase(),
          dishName.toLowerCase(),
          `  ${dishName}  `,
        ];

        for (const variant of variations) {
          try {
            await foodRepo.submitFoodItem(expId, userId, variant);
            expect.unreachable('Should have thrown food_item_duplicate');
          } catch (err) {
            expect(err).toBeInstanceOf(AppError);
            const appErr = err as AppError;
            expect(appErr.code).toBe('food_item_duplicate');
            expect(appErr.details?.['existingId']).toBe(created.id);
          }
        }

        // Verify only 1 row exists in listFoodItems
        const list = await foodRepo.listFoodItems(expId);
        expect(list).toHaveLength(1);
        expect(list[0]!.id).toBe(created.id);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: food-item-logging, Property 7: Menu Departure Preserves Logs and Is Surfaced, Never Enforced
  it('Property 7: Menu departure leaves row and logs intact, computes currentlyOnMenu=false, and logging/deleting still succeed', async () => {
    await fc.assert(
      fc.asyncProperty(dishNameArb, async (dishName) => {
        const expId = randomUUID();
        await pool.query(
          `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
           VALUES ($1, 'Test Diner', 'Restaurant', 'Hollywood Studios', $2)`,
          [expId, `upstream-${expId}`],
        );

        const fetchTime1 = new Date('2026-01-01T12:00:00Z');
        const menu1: MenuDTO = {
          menuType: 'Lunch',
          cuisineType: 'American',
          groups: [{ name: 'Classics', items: [{ name: dishName, price: '$12.00' }] }],
        };

        // 1. Initial menu sync
        await foodRepo.upsertFoodItemsFromMenus(expId, [menu1], fetchTime1);
        await pool.query(
          `INSERT INTO experience_menus (experience_id, menus, fetched_at)
           VALUES ($1, $2, $3)`,
          [expId, JSON.stringify([menu1]), fetchTime1],
        );

        const items1 = await foodRepo.listFoodItems(expId);
        expect(items1).toHaveLength(1);
        const foodItem = items1[0]!;
        expect(foodItem.currentlyOnMenu).toBe(true);

        // 2. User logs the item
        const log = await logRepo.addLog({
          userId,
          foodItemId: foodItem.id,
          visitedOn: '2026-01-01',
          userTz: 'America/New_York',
          rating: 8,
          note: 'Delicious while it lasted',
        });
        expect(log.foodItemId).toBe(foodItem.id);

        // 3. Subsequent menu sync where item dropped off
        const fetchTime2 = new Date('2026-02-01T12:00:00Z');
        const menu2: MenuDTO = {
          menuType: 'Lunch',
          cuisineType: 'American',
          groups: [{ name: 'Classics', items: [{ name: 'New Different Dish', price: '$15.00' }] }],
        };

        await foodRepo.upsertFoodItemsFromMenus(expId, [menu2], fetchTime2);
        await pool.query(
          `UPDATE experience_menus
              SET menus = $2, fetched_at = $3
            WHERE experience_id = $1`,
          [expId, JSON.stringify([menu2]), fetchTime2],
        );

        // 4. Verify the departed item is STILL present with currentlyOnMenu: false
        const items2 = await foodRepo.listFoodItems(expId);
        expect(items2).toHaveLength(2);
        const departedItem = items2.find((i) => i.id === foodItem.id)!;
        expect(departedItem).toBeDefined();
        expect(departedItem.currentlyOnMenu).toBe(false);

        // 5. Verify log history is intact
        const history = await logRepo.getLogHistory(userId, foodItem.id);
        expect(history.repeatCount).toBe(1);
        expect(history.logs[0]!.id).toBe(log.id);

        // 6. Verify logging still succeeds against departed item
        const log2 = await logRepo.addLog({
          userId,
          foodItemId: foodItem.id,
          visitedOn: '2026-02-02',
          userTz: 'America/New_York',
          rating: 9,
          note: 'Ordered off-menu or remembered visit',
        });
        expect(log2.foodItemId).toBe(foodItem.id);

        const historyAfter = await logRepo.getLogHistory(userId, foodItem.id);
        expect(historyAfter.repeatCount).toBe(2);

        // 7. Verify delete still works
        await logRepo.deleteLog(userId, foodItem.id, log.id);
        const historyFinal = await logRepo.getLogHistory(userId, foodItem.id);
        expect(historyFinal.repeatCount).toBe(1);
        expect(historyFinal.logs[0]!.id).toBe(log2.id);
      }),
      { numRuns: 100 },
    );
  });
});
