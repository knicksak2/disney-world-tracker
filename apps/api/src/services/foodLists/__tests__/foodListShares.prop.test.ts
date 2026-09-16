/**
 * Property tests for Food List Shares repository (Feature: food-lists).
 *
 * Validates:
 *   - Property 3 — View-Access Predicate Consistency (share dimension)
 *   - Property 6 — Unfriend Revokes Bidirectional Share Access Regardless of Role
 *   - Property 9 — Manage-Sharing Read Is Owner-Scoped
 *   - Property 11 — Role Upsert and Change Notification
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
import { pair } from '../../friends/canonicalPair.js';
import {
  createFoodListRepo,
  createFoodListShareRepo,
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

describe('foodListShares repository properties (fast-check)', { timeout: 120_000 }, () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let foodListRepo: FoodListRepo;
  let foodListShareRepo: FoodListShareRepo;
  let userA: string;
  let userB: string;
  let userC: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0041_food_lists.sql');

    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);

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

    // Make userA and userB friends
    const { lo, hi } = pair(userA, userB);
    await pool.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
      [lo, hi],
    );
  });

  // Feature: food-lists, Property 3: View-Access Predicate Consistency
  it('Property 3: View-Access Predicate Consistency (share dimension)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        async (role) => {
          const list = await foodListRepo.createList(userA, { name: 'Private List' });

          // Before sharing: userB cannot view
          await expect(foodListRepo.getListDetail(list.id, userB)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
          );

          // Share with userB
          await foodListShareRepo.shareWithFriend(list.id, userA, userB, role);

          // After sharing: userB can view
          const detail = await foodListRepo.getListDetail(list.id, userB);
          expect(detail.id).toBe(list.id);
          expect(detail.myRole).toBe(role);

          // Revoke share: userB can no longer view
          await foodListShareRepo.revokeShare(list.id, userA, userB);
          await expect(foodListRepo.getListDetail(list.id, userB)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
          );

          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-lists, Property 6: Unfriend Revokes Bidirectional Share Access Regardless of Role
  it('Property 6: Unfriend Revokes Bidirectional Share Access Regardless of Role', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        async (roleAtoB, roleBtoA) => {
          const listA = await foodListRepo.createList(userA, { name: 'List A' });
          const listB = await foodListRepo.createList(userB, { name: 'List B' });

          // Share A -> B and B -> A
          await foodListShareRepo.shareWithFriend(listA.id, userA, userB, roleAtoB);
          await foodListShareRepo.shareWithFriend(listB.id, userB, userA, roleBtoA);

          // Both can view before unfriend
          await expect(foodListRepo.getListDetail(listA.id, userB)).resolves.toBeDefined();
          await expect(foodListRepo.getListDetail(listB.id, userA)).resolves.toBeDefined();

          // Revoke shares on unfriend
          await foodListShareRepo.revokeSharesBetween(userA, userB);

          // Both shares are deleted and neither can view
          await expect(foodListRepo.getListDetail(listA.id, userB)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
          );
          await expect(foodListRepo.getListDetail(listB.id, userA)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'food_list_not_found',
          );

          await pool.query(`DELETE FROM food_lists WHERE id IN ($1, $2)`, [listA.id, listB.id]);
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);

  // Feature: food-lists, Property 9: Manage-Sharing Read Is Owner-Scoped
  it('Property 9: Manage-Sharing Read Is Owner-Scoped', async () => {
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
          const list = await foodListRepo.createList(userA, { name: 'Share Manage Test' });
          if (visibility === 'public') {
            await pool.query(`UPDATE food_lists SET visibility = 'public' WHERE id = $1`, [
              list.id,
            ]);
          }

          // Share with userB
          await foodListShareRepo.shareWithFriend(list.id, userA, userB, 'viewer');

          let actorId = userC;
          if (role === 'owner') {
            actorId = userA;
          } else if (role === 'editor') {
            actorId = userB;
            await pool.query(
              `UPDATE food_list_shares SET role = 'editor' WHERE food_list_id = $1 AND shared_with_user_id = $2`,
              [list.id, userB],
            );
          } else if (role === 'viewer') {
            actorId = userB;
          }

          if (role === 'owner') {
            const shares = await foodListShareRepo.listShares(list.id, actorId);
            expect(shares).toHaveLength(1);
            expect(shares[0]!.recipientId).toBe(userB);
          } else {
            const canView = visibility === 'public' || role === 'editor' || role === 'viewer';
            const expectedCode = canView ? 'food_list_edit_forbidden' : 'food_list_not_found';
            await expect(foodListShareRepo.listShares(list.id, actorId)).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === expectedCode,
            );
          }

          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: food-lists, Property 11: Role Upsert and Change Notification
  it('Property 11: Role Upsert and Change Notification', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        async (initialRole) => {
          const list = await foodListRepo.createList(userA, { name: 'Upsert Test' });

          // 1. First grant
          const res1 = await foodListShareRepo.shareWithFriend(
            list.id,
            userA,
            userB,
            initialRole,
          );
          expect(res1.action).toBe('created');
          expect(res1.share.role).toBe(initialRole);

          // 2. Repeat grant with same role
          const res2 = await foodListShareRepo.shareWithFriend(
            list.id,
            userA,
            userB,
            initialRole,
          );
          expect(res2.action).toBe('unchanged');
          expect(res2.share.role).toBe(initialRole);

          // 3. Update grant with opposite role
          const oppositeRole = initialRole === 'viewer' ? 'editor' : 'viewer';
          const res3 = await foodListShareRepo.shareWithFriend(
            list.id,
            userA,
            userB,
            oppositeRole,
          );
          expect(res3.action).toBe('role_changed');
          expect(res3.previousRole).toBe(initialRole);
          expect(res3.share.role).toBe(oppositeRole);

          // Total rows in food_list_shares must be 1 (upserted in place, no duplicate)
          const countRes = await pool.query<{ count: number }>(
            `SELECT count(*)::int as count FROM food_list_shares WHERE food_list_id = $1`,
            [list.id],
          );
          expect(countRes.rows[0]!.count).toBe(1);

          await pool.query(`DELETE FROM food_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
