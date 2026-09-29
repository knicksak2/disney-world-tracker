/**
 * Property tests for Checklist Food Lists (Feature: food-lists, Requirement 13).
 *
 * Each property is validated with `fast-check` (>=100 runs) against a real
 * pg-mem-backed repo running migration SQL (0001, 0040, 0041, 0047).
 *
 * Property 16 — Checklist Gotten State Is Derived, Per-Viewer, and Time-Scoped to the List
 * Property 17 — Checklist Mode Is Independently Toggleable Without Side Effects
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
  createFoodListAffinityRepo,
  createFoodListItemRepo,
  createFoodListRepo,
  createFoodListShareRepo,
  type FoodListAffinityRepo,
  type FoodListItemRepo,
  type FoodListRepo,
  type FoodListShareRepo,
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

describe('foodLists checklist properties (fast-check)', () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let foodListRepo: FoodListRepo;
  let foodListItemRepo: FoodListItemRepo;
  let foodListShareRepo: FoodListShareRepo;
  let foodListAffinityRepo: FoodListAffinityRepo;
  let ownerId: string;
  let collaboratorId: string;
  let experienceId: string;

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

    foodListRepo = createFoodListRepo(pool);
    foodListItemRepo = createFoodListItemRepo(pool);
    foodListShareRepo = createFoodListShareRepo(pool);
    foodListAffinityRepo = createFoodListAffinityRepo(pool, foodListRepo);

    ownerId = randomUUID();
    collaboratorId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'owner@test.com', 'hash'),
              ($2, 'collab@test.com', 'hash')`,
      [ownerId, collaboratorId],
    );

    const [lo, hi] = ownerId < collaboratorId ? [ownerId, collaboratorId] : [collaboratorId, ownerId];
    await pool.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id)
       VALUES ($1, $2)`,
      [lo, hi],
    );

    experienceId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Chefs de France', 'Restaurant', 'EPCOT', 'chefs-de-france')`,
      [experienceId],
    );
  });

  async function createFoodItem(name: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, price)
       VALUES ($1, $2, $3, $4)`,
      [id, experienceId, name, '$12.00'],
    );
    return id;
  }

  async function logFoodItem(
    userId: string,
    foodItemId: string,
    visitedOn: string,
    rating: number | null = null,
  ): Promise<string> {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating)
       VALUES ($1, $2, $3, 'America/New_York', $4)
       RETURNING id`,
      [userId, foodItemId, visitedOn, rating],
    );
    return res.rows[0]!.id;
  }

  // Feature: food-lists, Property 16: Checklist Gotten State Is Derived, Per-Viewer, and Time-Scoped to the List
  it('Property 16: Checklist Gotten State Is Derived, Per-Viewer, and Time-Scoped to the List', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }).map(() => `Item-${randomUUID()}`),
            ownerLog: fc.constantFrom('none', 'before', 'after', 'both'),
            collabLog: fc.constantFrom('none', 'before', 'after', 'both'),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        async (isChecklist, itemConfigs) => {
          const list = await foodListRepo.createList(ownerId, {
            name: `List-${randomUUID().slice(0, 8)}`,
            visibility: 'private',
            isChecklist,
          });

          // Set list created_at to 2026-06-01T12:00:00Z
          await pool.query(
            `UPDATE food_lists SET created_at = '2026-06-01T12:00:00Z' WHERE id = $1`,
            [list.id],
          );

          // Share with collaborator as viewer
          await foodListShareRepo.shareWithFriend(list.id, ownerId, collaboratorId, 'viewer');

          // Add items and insert logs
          for (const cfg of itemConfigs) {
            const foodItemId = await createFoodItem(cfg.name);
            await foodListItemRepo.addItem(list.id, ownerId, foodItemId);

            if (cfg.ownerLog === 'before' || cfg.ownerLog === 'both') {
              await logFoodItem(ownerId, foodItemId, '2025-08-15');
            }
            if (cfg.ownerLog === 'after' || cfg.ownerLog === 'both') {
              await logFoodItem(ownerId, foodItemId, '2026-06-15');
            }

            if (cfg.collabLog === 'before' || cfg.collabLog === 'both') {
              await logFoodItem(collaboratorId, foodItemId, '2026-01-10');
            }
            if (cfg.collabLog === 'after' || cfg.collabLog === 'both') {
              await logFoodItem(collaboratorId, foodItemId, '2026-06-01');
            }
          }

          const ownerDetail = await foodListRepo.getListDetail(list.id, ownerId);
          const collabDetail = await foodListRepo.getListDetail(list.id, collaboratorId);

          if (!isChecklist) {
            expect(ownerDetail.isChecklist).toBe(false);
            expect(collabDetail.isChecklist).toBe(false);
            expect(ownerDetail.gottenCount).toBeUndefined();
            expect(collabDetail.gottenCount).toBeUndefined();
            for (const item of ownerDetail.items) {
              expect(item.gotten).toBeUndefined();
            }
            for (const item of collabDetail.items) {
              expect(item.gotten).toBeUndefined();
            }
          } else {
            expect(ownerDetail.isChecklist).toBe(true);
            expect(collabDetail.isChecklist).toBe(true);

            // Verify owner perspective
            let expectedOwnerGottenCount = 0;
            for (let i = 0; i < itemConfigs.length; i++) {
              const cfg = itemConfigs[i]!;
              const item = ownerDetail.items[i]!;
              const expectedGotten = cfg.ownerLog === 'after' || cfg.ownerLog === 'both';
              expect(item.gotten).toBe(expectedGotten);
              if (expectedGotten) expectedOwnerGottenCount++;
            }
            expect(ownerDetail.gottenCount).toBe(expectedOwnerGottenCount);

            // Verify collaborator perspective (independent per viewer)
            let expectedCollabGottenCount = 0;
            for (let i = 0; i < itemConfigs.length; i++) {
              const cfg = itemConfigs[i]!;
              const item = collabDetail.items[i]!;
              const expectedGotten = cfg.collabLog === 'after' || cfg.collabLog === 'both';
              expect(item.gotten).toBe(expectedGotten);
              if (expectedGotten) expectedCollabGottenCount++;
            }
            expect(collabDetail.gottenCount).toBe(expectedCollabGottenCount);
          }

          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  }, 90000);

  it('Property 16 (named scenario): prior-year log against reused food_items row does not count as gotten', async () => {
    // A Food & Wine festival list created on 2026-08-20
    const list = await foodListRepo.createList(ownerId, {
      name: 'Food & Wine 2026 Must-Tries',
      isChecklist: true,
    });
    await pool.query(
      `UPDATE food_lists SET created_at = '2026-08-20T10:00:00Z' WHERE id = $1`,
      [list.id],
    );

    // Item 1: Canadian Cheddar Cheese Soup, logged in prior festival year 2025
    const item1Id = await createFoodItem('Canadian Cheddar Cheese Soup');
    await foodListItemRepo.addItem(list.id, ownerId, item1Id);
    await logFoodItem(ownerId, item1Id, '2025-09-15');

    // Item 2: Warm Chocolate Pudding Cake, logged on opening day of 2026 festival
    const item2Id = await createFoodItem('Warm Chocolate Pudding Cake');
    await foodListItemRepo.addItem(list.id, ownerId, item2Id);
    await logFoodItem(ownerId, item2Id, '2026-08-20');

    // Item 3: Apple Cider Braised Pork Belly, logged later in 2026 festival
    const item3Id = await createFoodItem('Apple Cider Braised Pork Belly');
    await foodListItemRepo.addItem(list.id, ownerId, item3Id);
    await logFoodItem(ownerId, item3Id, '2026-09-02');

    // Item 4: Liquid Nitro Chocolate Cake, not logged at all
    const item4Id = await createFoodItem('Liquid Nitro Chocolate Cake');
    await foodListItemRepo.addItem(list.id, ownerId, item4Id);

    const detail = await foodListRepo.getListDetail(list.id, ownerId);

    expect(detail.isChecklist).toBe(true);
    expect(detail.itemCount).toBe(4);
    expect(detail.gottenCount).toBe(2);

    expect(detail.items[0]!.foodItemId).toBe(item1Id);
    expect(detail.items[0]!.gotten).toBe(false); // 2025 log does NOT count!

    expect(detail.items[1]!.foodItemId).toBe(item2Id);
    expect(detail.items[1]!.gotten).toBe(true); // 2026-08-20 log counts

    expect(detail.items[2]!.foodItemId).toBe(item3Id);
    expect(detail.items[2]!.gotten).toBe(true); // 2026-09-02 log counts

    expect(detail.items[3]!.foodItemId).toBe(item4Id);
    expect(detail.items[3]!.gotten).toBe(false); // no log
  });

  // Amendment (Requirement 13.19, Property 20): a gotten item's `rating`
  // reflects the most recent qualifying log — this is the regression guard
  // for the repo query that previously never selected/returned `rating` at
  // all (FoodListItemDTO had no such field, so the mobile row could never
  // show it even after a rating was captured at check-off).
  it('a gotten item carries the rating from its most recent qualifying log', async () => {
    const list = await foodListRepo.createList(ownerId, {
      name: 'Rating Regression List',
      isChecklist: true,
    });
    await pool.query(
      `UPDATE food_lists SET created_at = '2026-06-01T00:00:00Z' WHERE id = $1`,
      [list.id],
    );

    // Rated dish, single log.
    const ratedItemId = await createFoodItem('Rated Dish');
    await foodListItemRepo.addItem(list.id, ownerId, ratedItemId);
    const ratedLogId = await logFoodItem(ownerId, ratedItemId, '2026-06-10', 9);

    // Unrated dish — gotten, but the log carried no rating.
    const unratedItemId = await createFoodItem('Unrated Dish');
    await foodListItemRepo.addItem(list.id, ownerId, unratedItemId);
    const unratedLogId = await logFoodItem(ownerId, unratedItemId, '2026-06-11', null);

    // Repeat-logged dish: an earlier lower rating, then a later higher one.
    // "Most recent wins" means the row should show 8, not 4.
    const repeatItemId = await createFoodItem('Repeat-Logged Dish');
    await foodListItemRepo.addItem(list.id, ownerId, repeatItemId);
    await logFoodItem(ownerId, repeatItemId, '2026-06-12', 4);
    const repeatLog2Id = await logFoodItem(ownerId, repeatItemId, '2026-06-20', 8);

    // Never logged — not gotten, must carry no rating.
    const notGottenItemId = await createFoodItem('Never Logged Dish');
    await foodListItemRepo.addItem(list.id, ownerId, notGottenItemId);

    const detail = await foodListRepo.getListDetail(list.id, ownerId);

    const rated = detail.items.find((i) => i.foodItemId === ratedItemId)!;
    expect(rated.gotten).toBe(true);
    expect(rated.rating).toBe(9);
    expect(rated.logId).toBe(ratedLogId);

    const unrated = detail.items.find((i) => i.foodItemId === unratedItemId)!;
    expect(unrated.gotten).toBe(true);
    expect(unrated.rating).toBeNull();
    expect(unrated.logId).toBe(unratedLogId);

    const repeat = detail.items.find((i) => i.foodItemId === repeatItemId)!;
    expect(repeat.gotten).toBe(true);
    expect(repeat.rating).toBe(8); // most recent log (2026-06-20), not the earlier 4
    expect(repeat.logId).toBe(repeatLog2Id);

    const notGotten = detail.items.find((i) => i.foodItemId === notGottenItemId)!;
    expect(notGotten.gotten).toBe(false);
    // Requirement 13.19: `rating` is entirely absent (not `null`) when the
    // item isn't gotten — mirroring how `gotten` itself is entirely absent
    // for a non-checklist list.
    expect(notGotten.rating).toBeUndefined();
    expect('rating' in notGotten).toBe(false);
    expect(notGotten.logId).toBeUndefined();
    expect('logId' in notGotten).toBe(false);
  });

  // Feature: food-lists, Property 17: Checklist Mode Is Independently Toggleable Without Side Effects
  it('Property 17: Checklist Mode Is Independently Toggleable Without Side Effects', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(fc.boolean()),
        fc.boolean(),
        async (initialIsChecklist, toggledIsChecklist) => {
          const createInput = initialIsChecklist === null
            ? { name: `List-${randomUUID().slice(0, 8)}` }
            : { name: `List-${randomUUID().slice(0, 8)}`, isChecklist: initialIsChecklist };

          const created = await foodListRepo.createList(ownerId, createInput);

          if (initialIsChecklist === null) {
            expect(created.isChecklist).toBe(false);
          } else {
            expect(created.isChecklist).toBe(initialIsChecklist);
          }

          // Add an item, share, and like
          const foodItemId = await createFoodItem(`Dish-${randomUUID().slice(0, 6)}`);
          await foodListItemRepo.addItem(created.id, ownerId, foodItemId);
          await foodListShareRepo.shareWithFriend(created.id, ownerId, collaboratorId, 'viewer');
          await foodListAffinityRepo.like(created.id, collaboratorId);

          const beforeItems = await pool.query(`SELECT * FROM food_lists_items WHERE food_list_id = $1`, [created.id]);
          const beforeShares = await pool.query(`SELECT * FROM food_list_shares WHERE food_list_id = $1`, [created.id]);
          const beforeLikes = await pool.query(`SELECT * FROM food_list_likes WHERE food_list_id = $1`, [created.id]);

          // Toggle checklist mode
          const updated = await foodListRepo.setChecklistMode(created.id, ownerId, toggledIsChecklist);
          expect(updated.isChecklist).toBe(toggledIsChecklist);

          // Verify items, shares, likes are completely untouched
          const afterItems = await pool.query(`SELECT * FROM food_lists_items WHERE food_list_id = $1`, [created.id]);
          const afterShares = await pool.query(`SELECT * FROM food_list_shares WHERE food_list_id = $1`, [created.id]);
          const afterLikes = await pool.query(`SELECT * FROM food_list_likes WHERE food_list_id = $1`, [created.id]);

          expect(afterItems.rows).toEqual(beforeItems.rows);
          expect(afterShares.rows).toEqual(beforeShares.rows);
          expect(afterLikes.rows).toEqual(beforeLikes.rows);

          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [created.id]);
        },
      ),
      { numRuns: 100 },
    );
  }, 90000);
});
