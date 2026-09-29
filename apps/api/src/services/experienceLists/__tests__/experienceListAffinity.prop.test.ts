/**
 * Property tests for Experience List Affinity repository (likes, saves, collection).
 *
 * Validates:
 *   - Property 4 — View-Access Predicate Consistency (like/save dimension)
 *   - Property 5 — Like Count Denormalization Consistency
 *   - Property 8 — Save Is a Live Reference, Never a Copy
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
  createExperienceListAffinityRepo,
  createExperienceListItemRepo,
  createExperienceListRepo,
  type ExperienceListAffinityRepo,
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

describe('experienceListAffinity repository properties (fast-check)', () => {
  let db: IMemoryDb;
  let rawPool: DbPool;
  let pool: DbPool;
  let experienceListRepo: ExperienceListRepo;
  let experienceListItemRepo: ExperienceListItemRepo;
  let affinityRepo: ExperienceListAffinityRepo;
  let ownerId: string;
  let friendId: string;
  let strangerId: string;
  let expId: string;

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
    affinityRepo = createExperienceListAffinityRepo(pool, experienceListRepo);

    ownerId = randomUUID();
    friendId = randomUUID();
    strangerId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'owner@test.com', 'hash'),
              ($2, 'friend@test.com', 'hash'),
              ($3, 'stranger@test.com', 'hash')`,
      [ownerId, friendId, strangerId],
    );

    expId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Space Mountain', 'Ride', 'Magic Kingdom', 'exp-affinity')`,
      [expId],
    );
  });

  // Feature: experience-lists, Property 4: View-Access Predicate Consistency (like/save dimension)
  it('Property 4: View-Access Predicate Consistency (like/save dimension)', async () => {
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
          const list = await experienceListRepo.createList(ownerId, { name: 'Affinity Test' });
          if (visibility === 'public') {
            await pool.query(`UPDATE experience_lists SET visibility = 'public' WHERE id = $1`, [
              list.id,
            ]);
          }

          let actorId = strangerId;
          if (role === 'owner') {
            actorId = ownerId;
          } else if (role === 'editor') {
            actorId = friendId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'editor')`,
              [list.id, friendId, ownerId],
            );
          } else if (role === 'viewer') {
            actorId = friendId;
            await pool.query(
              `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
               VALUES ($1, $2, $3, 'viewer')`,
              [list.id, friendId, ownerId],
            );
          }

          const canView =
            visibility === 'public' || role === 'owner' || role === 'editor' || role === 'viewer';

          // Test like
          if (canView) {
            await expect(affinityRepo.like(list.id, actorId)).resolves.toBeUndefined();
          } else {
            await expect(affinityRepo.like(list.id, actorId)).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
            );
          }

          // Test save
          if (role === 'owner') {
            // Self save is forbidden (Requirement 6.6)
            await expect(affinityRepo.save(list.id, actorId)).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === 'experience_list_save_self',
            );
          } else if (canView) {
            await expect(affinityRepo.save(list.id, actorId)).resolves.toBeUndefined();
          } else {
            await expect(affinityRepo.save(list.id, actorId)).rejects.toSatisfy(
              (err: unknown) => err instanceof AppError && err.code === 'experience_list_not_found',
            );
          }

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-lists, Property 5: Like Count Denormalization Consistency
  it('Property 5: Like Count Denormalization Consistency', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            userId: fc.constantFrom(ownerId, friendId, strangerId),
            action: fc.constantFrom<'like' | 'unlike'>('like', 'unlike'),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        async (operations) => {
          const list = await experienceListRepo.createList(ownerId, { name: 'Like Count Test' });
          // Make list public so all users have view access to like/unlike
          await pool.query(`UPDATE experience_lists SET visibility = 'public' WHERE id = $1`, [
            list.id,
          ]);

          for (const op of operations) {
            if (op.action === 'like') {
              await affinityRepo.like(list.id, op.userId);
            } else {
              await affinityRepo.unlike(list.id, op.userId);
            }

            // Assert denormalized like_count matches actual count in experience_list_likes
            const countRes = await pool.query<{ count: number }>(
              `SELECT count(*)::int as count FROM experience_list_likes WHERE experience_list_id = $1`,
              [list.id],
            );
            const expectedCount = Number(countRes.rows[0]!.count);

            const listRes = await pool.query<{ like_count: number }>(
              `SELECT like_count FROM experience_lists WHERE id = $1`,
              [list.id],
            );
            const actualLikeCount = Number(listRes.rows[0]!.like_count);

            expect(actualLikeCount).toBe(expectedCount);
          }

          await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: experience-lists, Property 8: Save Is a Live Reference, Never a Copy
  it('Property 8: Save Is a Live Reference, Never a Copy', async () => {
    const validNameArb = fc
      .stringMatching(/^[A-Za-z0-9 _-]{1,50}$/)
      .filter((s) => s.trim().length > 0);

    await fc.assert(
      fc.asyncProperty(validNameArb, validNameArb, async (initialName, updatedName) => {
        const list = await experienceListRepo.createList(ownerId, { name: initialName });
        await pool.query(`UPDATE experience_lists SET visibility = 'public' WHERE id = $1`, [
          list.id,
        ]);

        // Friend saves the list
        await affinityRepo.save(list.id, friendId);

        // Assert table schema: experience_list_saves has NO name or item data
        const columns = [...db.getTable('experience_list_saves').getColumns()].map((c) => c.name);
        expect(columns).not.toContain('name');
        expect(columns).not.toContain('items');

        // Initial collection check
        const col1 = await affinityRepo.getCollection(friendId);
        const saved1 = col1.saved.find((s) => s.available && s.id === list.id);
        expect(saved1).toBeDefined();
        if (saved1 && saved1.available) {
          expect(saved1.name).toBe(initialName.trim());
          expect(saved1.itemCount).toBe(0);
        }

        // Owner mutates the list: renames and adds an item (non-Restaurant, per Requirement 2.3)
        await experienceListRepo.renameList(list.id, ownerId, updatedName);
        await experienceListItemRepo.addItem(list.id, ownerId, expId);

        // Friend's next read dynamically reflects the owner's mutations!
        const col2 = await affinityRepo.getCollection(friendId);
        const saved2 = col2.saved.find((s) => s.available && s.id === list.id);
        expect(saved2).toBeDefined();
        if (saved2 && saved2.available) {
          expect(saved2.name).toBe(updatedName.trim());
          expect(saved2.itemCount).toBe(1);
        }

        const detail = await experienceListRepo.getListDetail(list.id, friendId);
        expect(detail.name).toBe(updatedName.trim());
        expect(detail.items).toHaveLength(1);
        expect(detail.items[0]!.experienceId).toBe(expId);

        await pool.query(`DELETE FROM experience_lists_items WHERE experience_list_id = $1`, [
          list.id,
        ]);
        await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [list.id]);
      }),
      { numRuns: 100 },
    );
  }, 120000);
});
