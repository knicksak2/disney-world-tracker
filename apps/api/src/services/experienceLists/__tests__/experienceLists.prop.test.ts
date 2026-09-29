/**
 * Property tests for Experience Lists repository (Feature: experience-lists).
 *
 * Each property is validated with `fast-check` (>=100 runs) against a real
 * pg-mem-backed repo running migration SQL (0001, 0050).
 *
 * Property 1 — Ownership-Scoped List-Level Mutation
 * Property 2 — Edit-Access-Scoped Item Mutation
 * Property 3 — Dining Ineligibility Is Enforced at the Write Path
 * Property 6 — Reorder Atomicity, Rejection, and Optimistic Concurrency
 * Property 24 — Pinning Reorders Without Touching Content or updatedAt
 * Property 25 — Pinned-First Ordering Is Total and Stable
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
  createExperienceListItemRepo,
  createExperienceListRepo,
  type ExperienceListItemRepo,
  type ExperienceListRepo,
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

describe('experienceLists repository properties (fast-check)', () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let experienceListRepo: ExperienceListRepo;
  let experienceListItemRepo: ExperienceListItemRepo;
  let ownerId: string;
  let collaboratorId: string;
  let strangerId: string;
  let rideExperienceId: string;
  let restaurantExperienceId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0050_experience_lists.sql');
    applyMigration(db, '0053_experience_list_pinning.sql');

    const { Pool: PgMemPool } = db.adapters.createPg();
    rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);

    experienceListRepo = createExperienceListRepo(pool);
    experienceListItemRepo = createExperienceListItemRepo(pool);

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

    rideExperienceId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Space Mountain', 'Ride', 'Magic Kingdom', 'space-mountain-test')`,
      [rideExperienceId],
    );

    restaurantExperienceId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Be Our Guest', 'Restaurant', 'Magic Kingdom', 'bog-test')`,
      [restaurantExperienceId],
    );
  });

  // Feature: experience-lists, Property 1: Ownership-Scoped List-Level Mutation
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
          const list = await experienceListRepo.createList(ownerId, { name: 'Initial Name' });
          if (visibility === 'public') {
            await pool.query(`UPDATE experience_lists SET visibility = 'public' WHERE id = $1`, [
              list.id,
            ]);
          }

          let actorId = strangerId;
          if (role === 'owner') {
            actorId = ownerId;
          } else if (role === 'editor') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'editor')`,
              [list.id, collaboratorId, ownerId],
            );
          } else if (role === 'viewer') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'viewer')`,
              [list.id, collaboratorId, ownerId],
            );
          }

          // Test rename
          if (role === 'owner') {
            const renamed = await experienceListRepo.renameList(list.id, actorId, newName);
            expect(renamed.name).toBe(newName.trim());
          } else {
            const canView = visibility === 'public' || role === 'editor' || role === 'viewer';
            const expectedCode = canView
              ? 'experience_list_edit_forbidden'
              : 'experience_list_not_found';
            await expect(
              experienceListRepo.renameList(list.id, actorId, newName),
            ).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === expectedCode,
            );
          }

          // Clean up list
          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-lists, Property 2: Edit-Access-Scoped Item Mutation
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
          const list = await experienceListRepo.createList(ownerId, { name: 'Item Test List' });
          if (visibility === 'public') {
            await pool.query(`UPDATE experience_lists SET visibility = 'public' WHERE id = $1`, [
              list.id,
            ]);
          }

          let actorId = strangerId;
          if (role === 'owner') {
            actorId = ownerId;
          } else if (role === 'editor') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'editor')`,
              [list.id, collaboratorId, ownerId],
            );
          } else if (role === 'viewer') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'viewer')`,
              [list.id, collaboratorId, ownerId],
            );
          }

          const canEdit = role === 'owner' || role === 'editor';
          const canView = visibility === 'public' || role === 'editor' || role === 'viewer';

          if (canEdit) {
            const added = await experienceListItemRepo.addItem(
              list.id,
              actorId,
              rideExperienceId,
            );
            expect(added.experienceId).toBe(rideExperienceId);
            expect(added.position).toBe(0);

            // Remove item
            await expect(
              experienceListItemRepo.removeItem(list.id, actorId, rideExperienceId),
            ).resolves.toBeUndefined();
          } else {
            const expectedCode = canView
              ? 'experience_list_edit_forbidden'
              : 'experience_list_not_found';
            await expect(
              experienceListItemRepo.addItem(list.id, actorId, rideExperienceId),
            ).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === expectedCode,
            );
          }

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-lists, Property 3: Dining Ineligibility Is Enforced at the Write Path
  it('Property 3: Dining Ineligibility Is Enforced at the Write Path', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => s.trim().length > 0 && !s.includes('\0') && !s.includes('\\')),
        fc.boolean(),
        async (listName, alsoTestDuplicateOrdering) => {
          // Drive only an owner-role actor (full edit access) so the
          // dining check is isolated from Property 2's access-control cases.
          const list = await experienceListRepo.createList(ownerId, { name: listName });

          // Core assertion: adding a Restaurant-category experience is
          // rejected with `experience_list_dining_ineligible`, regardless
          // of duplicate state — confirmed here with no pre-existing row.
          await expect(
            experienceListItemRepo.addItem(list.id, ownerId, restaurantExperienceId),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'experience_list_dining_ineligible',
          );

          const countRes = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM experience_lists_items WHERE experience_list_id = $1`,
            [list.id],
          );
          expect(Number(countRes.rows[0]?.count ?? 0)).toBe(0);

          // Repeat attempt still rejected the same way — the dining check
          // fires again rather than being masked by a duplicate error,
          // since no row was ever created.
          await expect(
            experienceListItemRepo.addItem(list.id, ownerId, restaurantExperienceId),
          ).rejects.toSatisfy(
            (err: unknown) =>
              err instanceof AppError && err.code === 'experience_list_dining_ineligible',
          );

          if (alsoTestDuplicateOrdering) {
            // Explicit dining-check-then-duplicate-check ordering check
            // (Requirement 2.3): a non-Restaurant experience added twice
            // yields `experience_list_item_duplicate` on the second call,
            // confirming the duplicate check is reached (and only reached)
            // once the dining check has passed.
            await experienceListItemRepo.addItem(list.id, ownerId, rideExperienceId);
            await expect(
              experienceListItemRepo.addItem(list.id, ownerId, rideExperienceId),
            ).rejects.toSatisfy(
              (err: unknown) =>
                err instanceof AppError && err.code === 'experience_list_item_duplicate',
            );
            await pool.query(
              `DELETE FROM experience_lists_items WHERE experience_list_id = $1 AND experience_id = $2`,
              [list.id, rideExperienceId],
            );
          }

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-lists, Property 6: Reorder Atomicity, Rejection, and Optimistic Concurrency
  it('Property 6: Reorder Atomicity, Rejection, and Optimistic Concurrency', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
        fc.boolean(), // whether expectedVersion matches
        fc.boolean(), // whether submitted IDs match
        async (permutation, matchVersion, matchIds) => {
          const list = await experienceListRepo.createList(ownerId, { name: 'Reorder Test' });
          const items: string[] = [];
          for (let i = 0; i < 4; i++) {
            const eId = randomUUID();
            await pool.query(
              `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
               VALUES ($1, $2, 'Ride', 'Magic Kingdom', $3)`,
              [eId, `Item-${i}-${eId.slice(0, 6)}`, `reorder-test-${eId}`],
            );
            await experienceListItemRepo.addItem(list.id, ownerId, eId);
            items.push(eId);
          }

          // Initial state after 4 items added: version = 4
          const listDetail = await experienceListRepo.getListDetail(list.id, ownerId);
          const currentVersion = listDetail.version;

          const reorderedIds = permutation.map((idx) => items[idx]!);
          const submittedIds = matchIds ? reorderedIds : [...reorderedIds.slice(1), randomUUID()];
          const submittedVersion = matchVersion ? currentVersion : currentVersion + 99;

          if (!matchIds) {
            await expect(
              experienceListItemRepo.reorderItems(
                list.id,
                ownerId,
                submittedIds,
                submittedVersion,
              ),
            ).rejects.toSatisfy(
              (err: unknown) =>
                err instanceof AppError && err.code === 'experience_list_reorder_mismatch',
            );
            const afterDetail = await experienceListRepo.getListDetail(list.id, ownerId);
            expect(afterDetail.version).toBe(currentVersion);
          } else if (!matchVersion) {
            await expect(
              experienceListItemRepo.reorderItems(
                list.id,
                ownerId,
                submittedIds,
                submittedVersion,
              ),
            ).rejects.toSatisfy(
              (err: unknown) =>
                err instanceof AppError && err.code === 'experience_list_stale_write',
            );
            const afterDetail = await experienceListRepo.getListDetail(list.id, ownerId);
            expect(afterDetail.version).toBe(currentVersion);
          } else {
            const updated = await experienceListItemRepo.reorderItems(
              list.id,
              ownerId,
              submittedIds,
              submittedVersion,
            );
            expect(updated.map((u) => u.experienceId)).toEqual(submittedIds);
            const afterDetail = await experienceListRepo.getListDetail(list.id, ownerId);
            expect(afterDetail.version).toBe(currentVersion + 1);
          }

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
          for (const eId of items) {
            await pool.query(`DELETE FROM experiences WHERE id = $1`, [eId]);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 120000);

  // Feature: list-pinning, Property 24: Pinning Reorders Without Touching Content or updatedAt
  it('Property 24: Pinning Reorders Without Touching Content or updatedAt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'owner' | 'editor' | 'viewer' | 'none'>(
          'owner',
          'editor',
          'viewer',
          'none',
        ),
        fc.boolean(), // pinned value being set
        async (role, pinned) => {
          const list = await experienceListRepo.createList(ownerId, { name: 'Pin Test List' });

          let actorId = strangerId;
          if (role === 'owner') {
            actorId = ownerId;
          } else if (role === 'editor') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'editor')`,
              [list.id, collaboratorId, ownerId],
            );
          } else if (role === 'viewer') {
            actorId = collaboratorId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'viewer')`,
              [list.id, collaboratorId, ownerId],
            );
          }

          const beforeRow = await pool.query<{ updated_at: string; pinned_at: string | null }>(
            `SELECT updated_at, pinned_at FROM experience_lists WHERE id = $1`,
            [list.id],
          );
          const updatedAtBefore = beforeRow.rows[0]!.updated_at;

          if (role === 'owner') {
            const updated = await experienceListRepo.setPinned(list.id, actorId, pinned);
            expect(updated.pinnedAt === null).toBe(!pinned);

            const afterRow = await pool.query<{
              updated_at: string;
              pinned_at: string | null;
              name: string;
              visibility: string;
              like_count: number;
            }>(
              `SELECT updated_at, pinned_at, name, visibility, like_count
                 FROM experience_lists WHERE id = $1`,
              [list.id],
            );
            expect(afterRow.rows[0]!.updated_at).toEqual(updatedAtBefore);
            expect(afterRow.rows[0]!.name).toBe('Pin Test List');
            expect(afterRow.rows[0]!.visibility).toBe('private');
            expect(afterRow.rows[0]!.like_count).toBe(0);
            expect(afterRow.rows[0]!.pinned_at === null).toBe(!pinned);
          } else {
            const canView = role === 'viewer' || role === 'editor';
            const expectedCode = canView
              ? 'experience_list_edit_forbidden'
              : 'experience_list_not_found';
            await expect(
              experienceListRepo.setPinned(list.id, actorId, pinned),
            ).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === expectedCode,
            );

            const afterRow = await pool.query<{ pinned_at: string | null }>(
              `SELECT pinned_at FROM experience_lists WHERE id = $1`,
              [list.id],
            );
            expect(afterRow.rows[0]!.pinned_at).toBeNull();
          }

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: list-pinning, Property 25: Pinned-First Ordering Is Total and Stable
  it('Property 25: Pinned-First Ordering Is Total and Stable', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.boolean(), { minLength: 2, maxLength: 6 }),
        async (pinFlags) => {
          const createdIds: string[] = [];
          for (let i = 0; i < pinFlags.length; i++) {
            const list = await experienceListRepo.createList(ownerId, {
              name: `Order Test ${i}-${randomUUID().slice(0, 6)}`,
            });
            createdIds.push(list.id);
            const staggeredUpdatedAt = new Date(Date.now() - (pinFlags.length - i) * 1000);
            await pool.query(`UPDATE experience_lists SET updated_at = $2 WHERE id = $1`, [
              list.id,
              staggeredUpdatedAt,
            ]);
            if (pinFlags[i]) {
              await experienceListRepo.setPinned(list.id, ownerId, true);
            }
          }

          const owned = await experienceListRepo.listOwned(ownerId);
          const ordered = owned.filter((l) => createdIds.includes(l.id));

          let seenUnpinned = false;
          for (const l of ordered) {
            if (l.pinnedAt === null) {
              seenUnpinned = true;
            } else {
              expect(seenUnpinned).toBe(false);
            }
          }

          const pinnedSubset = ordered.filter((l) => l.pinnedAt !== null);
          for (let i = 1; i < pinnedSubset.length; i++) {
            expect(new Date(pinnedSubset[i - 1]!.pinnedAt!).getTime()).toBeGreaterThanOrEqual(
              new Date(pinnedSubset[i]!.pinnedAt!).getTime(),
            );
          }

          const unpinnedSubset = ordered.filter((l) => l.pinnedAt === null);
          for (let i = 1; i < unpinnedSubset.length; i++) {
            expect(new Date(unpinnedSubset[i - 1]!.updatedAt).getTime()).toBeGreaterThanOrEqual(
              new Date(unpinnedSubset[i]!.updatedAt).getTime(),
            );
          }

          for (const id of createdIds) {
            await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [id]);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 30000);
});
