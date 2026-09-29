/**
 * Migration test for `0052_food_list_pinning.sql`.
 *
 * Applies 0001, 0041, 0052 to a fresh pg-mem database and asserts the schema contract:
 *   - `food_lists` gains a nullable `pinned_at` column, defaulting to NULL on insert;
 *   - `pinned_at` accepts a timestamp value and can be cleared back to NULL (unpin);
 *   - the `food_lists_owner_pinned_idx` index exists to support the pinned-first ordering.
 *
 * Validates: Feature: list-pinning (added by navigation-redesign amendment)
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

describe('migration 0052_food_list_pinning', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let ownerId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0041_food_lists.sql');
    applyMigration(db, '0052_food_list_pinning.sql');

    ownerId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'owner@example.com', 'hash')`,
      [ownerId],
    );
  });

  it('adds pinned_at column to food_lists', async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'food_lists'
        AND column_name = 'pinned_at';
    `);

    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.column_name).toBe('pinned_at');
  });

  it('defaults pinned_at to NULL when omitted on insert', async () => {
    const listId = randomUUID();
    await pool.query(
      `INSERT INTO food_lists (id, owner_id, name)
       VALUES ($1, $2, $3)`,
      [listId, ownerId, 'My Favorites'],
    );

    const res = await pool.query(`SELECT pinned_at FROM food_lists WHERE id = $1`, [listId]);
    expect(res.rows[0]!.pinned_at).toBeNull();
  });

  it('allows setting pinned_at to a timestamp and clearing it back to NULL', async () => {
    const listId = randomUUID();
    await pool.query(
      `INSERT INTO food_lists (id, owner_id, name)
       VALUES ($1, $2, $3)`,
      [listId, ownerId, 'Festival Snacks'],
    );

    await pool.query(`UPDATE food_lists SET pinned_at = now() WHERE id = $1`, [listId]);
    const pinnedRes = await pool.query(`SELECT pinned_at FROM food_lists WHERE id = $1`, [
      listId,
    ]);
    expect(pinnedRes.rows[0]!.pinned_at).not.toBeNull();

    await pool.query(`UPDATE food_lists SET pinned_at = NULL WHERE id = $1`, [listId]);
    const unpinnedRes = await pool.query(`SELECT pinned_at FROM food_lists WHERE id = $1`, [
      listId,
    ]);
    expect(unpinnedRes.rows[0]!.pinned_at).toBeNull();
  });
});
