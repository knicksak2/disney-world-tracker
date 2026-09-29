/**
 * Migration test for `0050_experience_lists.sql`.
 *
 * Applies 0001 and 0050 to a fresh pg-mem database and asserts the schema contract:
 *   - `experience_lists` table, name length CHECK, visibility CHECK, like_count nonneg CHECK,
 *     version nonneg CHECK;
 *   - `experience_lists_items` table, UNIQUE (experience_list_id, experience_id),
 *     UNIQUE (experience_list_id, position), added_by_user_id ON DELETE SET NULL;
 *   - `experience_list_shares` table, role CHECK ('viewer' | 'editor'),
 *     PK (experience_list_id, shared_with_user_id);
 *   - `experience_list_likes` table, PK (experience_list_id, user_id);
 *   - `experience_list_saves` table, PK (experience_list_id, saved_by_user_id);
 *   - Cascades on experience_lists, experiences, and users deletion.
 *
 * Validates: Requirements 1.4, 2.4
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

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
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

describe('migration 0050_experience_lists (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let ownerId: string;
  let contributorId: string;
  let friendId: string;
  let experienceId1: string;
  let experienceId2: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0050_experience_lists.sql');

    ownerId = randomUUID();
    contributorId = randomUUID();
    friendId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'owner@example.com', 'hash'),
              ($2, 'contrib@example.com', 'hash'),
              ($3, 'friend@example.com', 'hash')`,
      [ownerId, contributorId, friendId],
    );

    experienceId1 = randomUUID();
    experienceId2 = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, 'exp-1', 'Space Mountain', 'Magic Kingdom', 'Ride'),
              ($2, 'exp-2', 'Jungle Cruise', 'Magic Kingdom', 'Ride')`,
      [experienceId1, experienceId2],
    );
  });

  describe('experience_lists table', () => {
    it('creates table with expected columns', () => {
      const columns = [...db.getTable('experience_lists').getColumns()].map((c) => c.name);
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'owner_id',
          'name',
          'visibility',
          'like_count',
          'version',
          'created_at',
          'updated_at',
        ]),
      );
    });

    it('enforces name length constraint (1-100)', async () => {
      await expect(
        pool.query(`INSERT INTO experience_lists (owner_id, name) VALUES ($1, '')`, [ownerId]),
      ).rejects.toThrow();

      await expect(
        pool.query(`INSERT INTO experience_lists (owner_id, name) VALUES ($1, $2)`, [
          ownerId,
          'a'.repeat(101),
        ]),
      ).rejects.toThrow();

      await expect(
        pool.query(`INSERT INTO experience_lists (owner_id, name) VALUES ($1, $2)`, [
          ownerId,
          'a'.repeat(100),
        ]),
      ).resolves.toBeDefined();
    });

    it('enforces visibility constraint (private | public) via experience_lists_visibility_chk', async () => {
      await expect(
        pool.query(
          `INSERT INTO experience_lists (owner_id, name, visibility) VALUES ($1, 'List', 'unlisted')`,
          [ownerId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO experience_lists (owner_id, name, visibility) VALUES ($1, 'List', 'public')`,
          [ownerId],
        ),
      ).resolves.toBeDefined();
    });

    it('enforces like_count >= 0 constraint via experience_lists_like_count_nonneg_chk', async () => {
      await expect(
        pool.query(
          `INSERT INTO experience_lists (owner_id, name, like_count) VALUES ($1, 'List', -1)`,
          [ownerId],
        ),
      ).rejects.toThrow();
    });

    it('enforces version >= 0 constraint via experience_lists_version_nonneg_chk', async () => {
      await expect(
        pool.query(
          `INSERT INTO experience_lists (owner_id, name, version) VALUES ($1, 'List', -1)`,
          [ownerId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO experience_lists (owner_id, name, version) VALUES ($1, 'List', 0)`,
          [ownerId],
        ),
      ).resolves.toBeDefined();
    });

    it('cascades on owner deletion', async () => {
      const listId = randomUUID();
      await pool.query(
        `INSERT INTO experience_lists (id, owner_id, name) VALUES ($1, $2, 'My Favorites')`,
        [listId, ownerId],
      );

      await pool.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_lists WHERE id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });
  });

  describe('experience_lists_items table', () => {
    let listId: string;

    beforeEach(async () => {
      listId = randomUUID();
      await pool.query(
        `INSERT INTO experience_lists (id, owner_id, name) VALUES ($1, $2, 'Favorites')`,
        [listId, ownerId],
      );
    });

    it('creates table with expected columns', () => {
      const columns = [...db.getTable('experience_lists_items').getColumns()].map((c) => c.name);
      expect(columns).toEqual(
        expect.arrayContaining([
          'id',
          'experience_list_id',
          'experience_id',
          'position',
          'added_by_user_id',
          'added_at',
        ]),
      );
    });

    it('enforces UNIQUE (experience_list_id, experience_id) via experience_lists_items_unique', async () => {
      await pool.query(
        `INSERT INTO experience_lists_items (experience_list_id, experience_id, position, added_by_user_id)
         VALUES ($1, $2, 0, $3)`,
        [listId, experienceId1, contributorId],
      );

      await expect(
        pool.query(
          `INSERT INTO experience_lists_items (experience_list_id, experience_id, position, added_by_user_id)
           VALUES ($1, $2, 1, $3)`,
          [listId, experienceId1, contributorId],
        ),
      ).rejects.toThrow();
    });

    it('enforces UNIQUE (experience_list_id, position) via experience_lists_items_position_unique', async () => {
      await pool.query(
        `INSERT INTO experience_lists_items (experience_list_id, experience_id, position)
         VALUES ($1, $2, 0)`,
        [listId, experienceId1],
      );

      await expect(
        pool.query(
          `INSERT INTO experience_lists_items (experience_list_id, experience_id, position)
           VALUES ($1, $2, 0)`,
          [listId, experienceId2],
        ),
      ).rejects.toThrow();
    });

    it('sets added_by_user_id to NULL when contributor user is deleted (ON DELETE SET NULL)', async () => {
      const itemId = randomUUID();
      await pool.query(
        `INSERT INTO experience_lists_items (id, experience_list_id, experience_id, position, added_by_user_id)
         VALUES ($1, $2, $3, 0, $4)`,
        [itemId, listId, experienceId1, contributorId],
      );

      await pool.query(`DELETE FROM users WHERE id = $1`, [contributorId]);

      const res = await pool.query(
        `SELECT id, added_by_user_id FROM experience_lists_items WHERE id = $1`,
        [itemId],
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]?.['added_by_user_id']).toBeNull();
    });

    it('cascades on experience_list deletion', async () => {
      await pool.query(
        `INSERT INTO experience_lists_items (experience_list_id, experience_id, position)
         VALUES ($1, $2, 0)`,
        [listId, experienceId1],
      );

      await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [listId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_lists_items WHERE experience_list_id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });

    it('cascades on experience deletion', async () => {
      await pool.query(
        `INSERT INTO experience_lists_items (experience_list_id, experience_id, position)
         VALUES ($1, $2, 0)`,
        [listId, experienceId1],
      );

      await pool.query(`DELETE FROM experiences WHERE id = $1`, [experienceId1]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_lists_items WHERE experience_list_id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });
  });

  describe('experience_list_shares table', () => {
    let listId: string;

    beforeEach(async () => {
      listId = randomUUID();
      await pool.query(
        `INSERT INTO experience_lists (id, owner_id, name) VALUES ($1, $2, 'Shared List')`,
        [listId, ownerId],
      );
    });

    it('enforces role CHECK constraint (viewer | editor) via experience_list_shares_role_chk', async () => {
      await expect(
        pool.query(
          `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
           VALUES ($1, $2, $3, 'admin')`,
          [listId, friendId, ownerId],
        ),
      ).rejects.toThrow();

      await expect(
        pool.query(
          `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
           VALUES ($1, $2, $3, 'editor')`,
          [listId, friendId, ownerId],
        ),
      ).resolves.toBeDefined();
    });

    it('enforces PK (experience_list_id, shared_with_user_id)', async () => {
      await pool.query(
        `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
         VALUES ($1, $2, $3, 'viewer')`,
        [listId, friendId, ownerId],
      );

      await expect(
        pool.query(
          `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
           VALUES ($1, $2, $3, 'editor')`,
          [listId, friendId, ownerId],
        ),
      ).rejects.toThrow();
    });

    it('cascades on experience_list deletion', async () => {
      await pool.query(
        `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id)
         VALUES ($1, $2, $3)`,
        [listId, friendId, ownerId],
      );

      await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [listId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_list_shares WHERE experience_list_id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });

    it('cascades on shared_with_user_id (recipient) deletion', async () => {
      await pool.query(
        `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id)
         VALUES ($1, $2, $3)`,
        [listId, friendId, ownerId],
      );

      await pool.query(`DELETE FROM users WHERE id = $1`, [friendId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_list_shares WHERE experience_list_id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });

    it('cascades on shared_by_user_id (sharer) deletion', async () => {
      await pool.query(
        `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id)
         VALUES ($1, $2, $3)`,
        [listId, friendId, ownerId],
      );

      await pool.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_list_shares WHERE experience_list_id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });
  });

  describe('experience_list_likes table', () => {
    let listId: string;

    beforeEach(async () => {
      listId = randomUUID();
      await pool.query(
        `INSERT INTO experience_lists (id, owner_id, name) VALUES ($1, $2, 'Liked List')`,
        [listId, ownerId],
      );
    });

    it('enforces PK (experience_list_id, user_id)', async () => {
      await pool.query(
        `INSERT INTO experience_list_likes (experience_list_id, user_id) VALUES ($1, $2)`,
        [listId, friendId],
      );

      await expect(
        pool.query(
          `INSERT INTO experience_list_likes (experience_list_id, user_id) VALUES ($1, $2)`,
          [listId, friendId],
        ),
      ).rejects.toThrow();
    });

    it('cascades on experience_list deletion', async () => {
      await pool.query(
        `INSERT INTO experience_list_likes (experience_list_id, user_id) VALUES ($1, $2)`,
        [listId, friendId],
      );

      await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [listId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_list_likes WHERE user_id = $1`,
        [friendId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });

    it('cascades on user deletion', async () => {
      await pool.query(
        `INSERT INTO experience_list_likes (experience_list_id, user_id) VALUES ($1, $2)`,
        [listId, friendId],
      );

      await pool.query(`DELETE FROM users WHERE id = $1`, [friendId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_list_likes WHERE experience_list_id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });
  });

  describe('experience_list_saves table', () => {
    let listId: string;

    beforeEach(async () => {
      listId = randomUUID();
      await pool.query(
        `INSERT INTO experience_lists (id, owner_id, name) VALUES ($1, $2, 'Saved List')`,
        [listId, ownerId],
      );
    });

    it('enforces PK (experience_list_id, saved_by_user_id)', async () => {
      await pool.query(
        `INSERT INTO experience_list_saves (experience_list_id, saved_by_user_id) VALUES ($1, $2)`,
        [listId, friendId],
      );

      await expect(
        pool.query(
          `INSERT INTO experience_list_saves (experience_list_id, saved_by_user_id) VALUES ($1, $2)`,
          [listId, friendId],
        ),
      ).rejects.toThrow();
    });

    it('cascades on experience_list deletion', async () => {
      await pool.query(
        `INSERT INTO experience_list_saves (experience_list_id, saved_by_user_id) VALUES ($1, $2)`,
        [listId, friendId],
      );

      await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [listId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_list_saves WHERE saved_by_user_id = $1`,
        [friendId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });

    it('cascades on user deletion', async () => {
      await pool.query(
        `INSERT INTO experience_list_saves (experience_list_id, saved_by_user_id) VALUES ($1, $2)`,
        [listId, friendId],
      );

      await pool.query(`DELETE FROM users WHERE id = $1`, [friendId]);
      const res = await pool.query(
        `SELECT count(*)::int as count FROM experience_list_saves WHERE experience_list_id = $1`,
        [listId],
      );
      expect(res.rows[0]?.['count']).toBe(0);
    });
  });
});
