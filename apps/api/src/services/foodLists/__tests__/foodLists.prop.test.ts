/**
 * Property tests for Food Lists repository (Feature: food-lists).
 *
 * Each property is validated with `fast-check` (>=100 runs) against a real
 * pg-mem-backed repo running migration SQL (0001, 0040, 0041).
 *
 * Property 1 — Ownership-Scoped List-Level Mutation
 * Property 2 — Edit-Access-Scoped Item Mutation
 * Property 5 — Reorder Atomicity, Rejection, and Optimistic Concurrency
 * Property 14 — Create-Time Visibility Override
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import {
  createFoodListItemRepo,
  createFoodListRepo,
  type FoodListItemRepo,
  type FoodListRepo,
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

describe('foodLists repository properties (fast-check)', () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let foodListRepo: FoodListRepo;
  let foodListItemRepo: FoodListItemRepo;
  let ownerId: string;
  let collaboratorId: string;
  let strangerId: string;
  let experienceId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0041_food_lists.sql');

    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);

    foodListRepo = createFoodListRepo(pool);
    foodListItemRepo = createFoodListItemRepo(pool);

    ownerId = randomUUID();
    collaboratorId = randomUUID();
    strangerId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'owner@test.com', 'hash'),
              ($2, 'collab@test.com', 'hash'),
              ($3, 'stranger@test.com', 'hash')`,
      [ownerId, collaboratorId, strangerId],
    );

    experienceId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Be Our Guest', 'Restaurant', 'Magic Kingdom', 'bog-test')`,
      [experienceId],
    );
  });

  // Feature: food-lists, Property 1: Ownership-Scoped List-Level Mutation
  it('Property 1: Ownership-Scoped List-Level Mutation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'owner' | 'editor' | 'viewer' | 'none'>(
          'owner',
          'editor',
          'viewer',
          'none',
        ),
        fc.constantFrom<'private' | 'public'>('private', 'public'),
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => s.trim().length > 0 && !s.includes('\0') && !s.includes('\\')),
        async (role, visibility, newName) => {
          const list = await foodListRepo.createList(ownerId, { name: 'Initial Name' });
          if (visibility === 'public') {
            await pool.query(`UPDATE food_lists SET visibility = 'public' WHERE id = $1`, [
              list.id,
            ]);
          }

          let actorId = strangerId;
          if (role === 'owner') {
            actorId = ownerId;
          } else if (role === 'editor') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO food_list_shares (food_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'editor')`,
              [list.id, collaboratorId, ownerId],
            );
          } else if (role === 'viewer') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO food_list_shares (food_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'viewer')`,
              [list.id, collaboratorId, ownerId],
            );
          }

          // Test rename
          if (role === 'owner') {
            const renamed = await foodListRepo.renameList(list.id, actorId, newName);
            expect(renamed.name).toBe(newName.trim());
          } else {
            const canView = visibility === 'public' || role === 'editor' || role === 'viewer';
            const expectedCode = canView ? 'food_list_edit_forbidden' : 'food_list_not_found';
            await expect(foodListRepo.renameList(list.id, actorId, newName)).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === expectedCode,
            );
          }

          // Clean up list
          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-lists, Property 2: Edit-Access-Scoped Item Mutation
  it('Property 2: Edit-Access-Scoped Item Mutation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'owner' | 'editor' | 'viewer' | 'none'>(
          'owner',
          'editor',
          'viewer',
          'none',
        ),
        fc.constantFrom<'private' | 'public'>('private', 'public'),
        async (role, visibility) => {
          const list = await foodListRepo.createList(ownerId, { name: 'Item Test List' });
          if (visibility === 'public') {
            await pool.query(`UPDATE food_lists SET visibility = 'public' WHERE id = $1`, [
              list.id,
            ]);
          }

          const foodItemId = randomUUID();
          await pool.query(
            `INSERT INTO food_items (id, experience_id, name, source)
             VALUES ($1, $2, $3, 'menu_sync')`,
            [foodItemId, experienceId, `Dish-${foodItemId.slice(0, 8)}`],
          );

          let actorId = strangerId;
          if (role === 'owner') {
            actorId = ownerId;
          } else if (role === 'editor') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO food_list_shares (food_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'editor')`,
              [list.id, collaboratorId, ownerId],
            );
          } else if (role === 'viewer') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO food_list_shares (food_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'viewer')`,
              [list.id, collaboratorId, ownerId],
            );
          }

          const canEdit = role === 'owner' || role === 'editor';
          const canView = visibility === 'public' || role === 'editor' || role === 'viewer';

          if (canEdit) {
            const added = await foodListItemRepo.addItem(list.id, actorId, foodItemId);
            expect(added.foodItemId).toBe(foodItemId);
            expect(added.position).toBe(0);

            // Remove item
            await expect(
              foodListItemRepo.removeItem(list.id, actorId, foodItemId),
            ).resolves.toBeUndefined();
          } else {
            const expectedCode = canView ? 'food_list_edit_forbidden' : 'food_list_not_found';
            await expect(
              foodListItemRepo.addItem(list.id, actorId, foodItemId),
            ).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === expectedCode,
            );
          }

          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [list.id]);
          await pool.query(`DELETE FROM food_items WHERE id = $1`, [foodItemId]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-lists, Property 5: Reorder Atomicity, Rejection, and Optimistic Concurrency
  it('Property 5: Reorder Atomicity, Rejection, and Optimistic Concurrency', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
        fc.boolean(), // whether expectedVersion matches
        fc.boolean(), // whether submitted IDs match
        async (permutation, matchVersion, matchIds) => {
          const list = await foodListRepo.createList(ownerId, { name: 'Reorder Test' });
          const items: string[] = [];
          for (let i = 0; i < 4; i++) {
            const fId = randomUUID();
            await pool.query(
              `INSERT INTO food_items (id, experience_id, name, source)
               VALUES ($1, $2, $3, 'menu_sync')`,
              [fId, experienceId, `Item-${i}-${fId.slice(0, 6)}`],
            );
            await foodListItemRepo.addItem(list.id, ownerId, fId);
            items.push(fId);
          }

          // Initial state after 4 items added: version = 4
          const listDetail = await foodListRepo.getListDetail(list.id, ownerId);
          const currentVersion = listDetail.version;

          const reorderedIds = permutation.map((idx) => items[idx]!);
          const submittedIds = matchIds ? reorderedIds : [...reorderedIds.slice(1), randomUUID()];
          const submittedVersion = matchVersion ? currentVersion : currentVersion + 99;

          if (!matchIds) {
            await expect(
              foodListItemRepo.reorderItems(list.id, ownerId, submittedIds, submittedVersion),
            ).rejects.toSatisfy(
              (err: unknown) =>
                err instanceof AppError && err.code === 'food_list_reorder_mismatch',
            );
            const afterDetail = await foodListRepo.getListDetail(list.id, ownerId);
            expect(afterDetail.version).toBe(currentVersion);
          } else if (!matchVersion) {
            await expect(
              foodListItemRepo.reorderItems(list.id, ownerId, submittedIds, submittedVersion),
            ).rejects.toSatisfy(
              (err: unknown) =>
                err instanceof AppError && err.code === 'food_list_stale_write',
            );
            const afterDetail = await foodListRepo.getListDetail(list.id, ownerId);
            expect(afterDetail.version).toBe(currentVersion);
          } else {
            const updated = await foodListItemRepo.reorderItems(
              list.id,
              ownerId,
              submittedIds,
              submittedVersion,
            );
            expect(updated.map((u) => u.foodItemId)).toEqual(submittedIds);
            const afterDetail = await foodListRepo.getListDetail(list.id, ownerId);
            expect(afterDetail.version).toBe(currentVersion + 1);
          }

          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [list.id]);
          for (const fId of items) {
            await pool.query(`DELETE FROM food_items WHERE id = $1`, [fId]);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);

  // Feature: food-lists, Property 14: Create-Time Visibility Override
  it('Property 14: Create-Time Visibility Override', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => s.trim().length > 0 && !s.includes('\0') && !s.includes('\\')),
        fc.constantFrom<'private' | 'public' | 'omitted' | 'invalid'>(
          'private',
          'public',
          'omitted',
          'invalid',
        ),
        fc.constantFrom('unlisted', 'secret', 'hidden', 'draft', 'friends_only'),
        async (name, visibilityKind, invalidVal) => {
          const beforeCountRes = await pool.query<{ count: string }>(
            'SELECT COUNT(*)::text as count FROM food_lists',
          );
          const beforeCount = Number(beforeCountRes.rows[0]?.count ?? 0);

          if (visibilityKind === 'invalid') {
            await expect(
              foodListRepo.createList(ownerId, { name, visibility: invalidVal as any }),
            ).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === 'validation_failed',
            );
            const afterCountRes = await pool.query<{ count: string }>(
              'SELECT COUNT(*)::text as count FROM food_lists',
            );
            expect(Number(afterCountRes.rows[0]?.count ?? 0)).toBe(beforeCount);
          } else if (visibilityKind === 'omitted') {
            const created = await foodListRepo.createList(ownerId, { name });
            expect(created.visibility).toBe('private');

            const rowRes = await pool.query<{ visibility: string }>(
              'SELECT visibility FROM food_lists WHERE id = $1',
              [created.id],
            );
            expect(rowRes.rows[0]?.visibility).toBe('private');

            await pool.query('DELETE FROM food_lists WHERE id = $1', [created.id]);
          } else {
            const created = await foodListRepo.createList(ownerId, {
              name,
              visibility: visibilityKind,
            });
            expect(created.visibility).toBe(visibilityKind);

            const rowRes = await pool.query<{ visibility: string }>(
              'SELECT visibility FROM food_lists WHERE id = $1',
              [created.id],
            );
            expect(rowRes.rows[0]?.visibility).toBe(visibilityKind);

            await pool.query('DELETE FROM food_lists WHERE id = $1', [created.id]);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);
});
