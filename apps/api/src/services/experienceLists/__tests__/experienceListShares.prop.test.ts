/**
 * Property tests for Experience List Shares repository (Feature: experience-lists).
 *
 * Validates:
 *   - Property 4 — View-Access Predicate Consistency (share dimension only —
 *     NOT the trip-attachment OR-branch, which doesn't exist until task 18.5)
 *   - Property 7 — Unfriend Revokes Bidirectional Share Access Regardless of Role
 *   - Property 10 — Role Upsert and Change Notification (repo-level contract only;
 *     the notification-dispatch half is covered at the notification-service layer
 *     in task 6.5)
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
  createExperienceListRepo,
  createExperienceListShareRepo,
  type ExperienceListRepo,
  type ExperienceListShareRepo,
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

describe('experienceListShares repository properties (fast-check)', { timeout: 120_000 }, () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let experienceListRepo: ExperienceListRepo;
  let experienceListShareRepo: ExperienceListShareRepo;
  let userA: string;
  let userB: string;
  let userC: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0050_experience_lists.sql');
    applyMigration(db, '0053_experience_list_pinning.sql');

    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);

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

    // Make userA and userB friends
    const { lo, hi } = pair(userA, userB);
    await pool.query(
      `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ($1, $2)`,
      [lo, hi],
    );
  });

  // Feature: experience-lists, Property 4: View-Access Predicate Consistency (share dimension)
  it('Property 4: View-Access Predicate Consistency (share dimension)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        async (role) => {
          const list = await experienceListRepo.createList(userA, { name: 'Private List' });

          // Before sharing: userB cannot view
          await expect(experienceListRepo.getListDetail(list.id, userB)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
          );

          // Share with userB
          await experienceListShareRepo.shareWithFriend(list.id, userA, userB, role);

          // After sharing: userB can view
          const detail = await experienceListRepo.getListDetail(list.id, userB);
          expect(detail.id).toBe(list.id);
          expect(detail.myRole).toBe(role);

          // Revoke share: userB can no longer view
          await experienceListShareRepo.revokeShare(list.id, userA, userB);
          await expect(experienceListRepo.getListDetail(list.id, userB)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
          );

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-lists, Property 7: Unfriend Revokes Bidirectional Share Access Regardless of Role
  it('Property 7: Unfriend Revokes Bidirectional Share Access Regardless of Role', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        async (roleAtoB, roleBtoA) => {
          const listA = await experienceListRepo.createList(userA, { name: 'List A' });
          const listB = await experienceListRepo.createList(userB, { name: 'List B' });

          // Share A -> B and B -> A
          await experienceListShareRepo.shareWithFriend(listA.id, userA, userB, roleAtoB);
          await experienceListShareRepo.shareWithFriend(listB.id, userB, userA, roleBtoA);

          // Both can view before unfriend
          await expect(experienceListRepo.getListDetail(listA.id, userB)).resolves.toBeDefined();
          await expect(experienceListRepo.getListDetail(listB.id, userA)).resolves.toBeDefined();

          // Revoke shares on unfriend
          await experienceListShareRepo.revokeSharesBetween(userA, userB);

          // Both shares are deleted and neither can view
          await expect(experienceListRepo.getListDetail(listA.id, userB)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
          );
          await expect(experienceListRepo.getListDetail(listB.id, userA)).rejects.toSatisfy(
            (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
          );

          await pool.query(`DELETE FROM experience_lists WHERE id IN ($1, $2)`, [
            listA.id,
            listB.id,
          ]);
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);

  // Feature: experience-lists, Property 10: Role Upsert and Change Notification
  it('Property 10: Role Upsert and Change Notification', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'viewer' | 'editor'>('viewer', 'editor'),
        async (initialRole) => {
          const list = await experienceListRepo.createList(userA, { name: 'Upsert Test' });

          // 1. First grant
          const res1 = await experienceListShareRepo.shareWithFriend(
            list.id,
            userA,
            userB,
            initialRole,
          );
          expect(res1.action).toBe('created');
          expect(res1.share.role).toBe(initialRole);

          // 2. Repeat grant with same role
          const res2 = await experienceListShareRepo.shareWithFriend(
            list.id,
            userA,
            userB,
            initialRole,
          );
          expect(res2.action).toBe('unchanged');
          expect(res2.share.role).toBe(initialRole);

          // 3. Update grant with opposite role
          const oppositeRole = initialRole === 'viewer' ? 'editor' : 'viewer';
          const res3 = await experienceListShareRepo.shareWithFriend(
            list.id,
            userA,
            userB,
            oppositeRole,
          );
          expect(res3.action).toBe('role_changed');
          expect(res3.previousRole).toBe(initialRole);
          expect(res3.share.role).toBe(oppositeRole);

          // Total rows in experience_list_shares must be 1 (upserted in place, no duplicate)
          const countRes = await pool.query<{ count: number }>(
            `SELECT count(*)::int as count FROM experience_list_shares WHERE experience_list_id = $1`,
            [list.id],
          );
          expect(countRes.rows[0]!.count).toBe(1);

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
