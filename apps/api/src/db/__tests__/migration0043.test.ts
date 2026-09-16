/**
 * Migration test for `0043_food_item_log_history_index.sql`.
 *
 * Validates:
 *   - Creates index `food_item_logs_user_idx` on `food_item_logs(user_id, visited_on DESC, logged_at DESC)`
 *   - Leaves existing index `food_item_logs_user_item_idx` untouched
 *   - Inserts and reads back rows via user_id ordering
 *
 * Validates: Requirements 8.1, 9.1
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

describe('migration 0043_food_item_log_history_index (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;
  let expId: string;
  let foodItemId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0043_food_item_log_history_index.sql');

    userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'user@example.com', 'hash')`,
      [userId],
    );

    expId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Be Our Guest', 'Restaurant', 'Magic Kingdom', $2)`,
      [expId, `entity-${expId}`],
    );

    foodItemId = randomUUID();
    await pool.query(
      `INSERT INTO food_items (id, experience_id, name, source)
       VALUES ($1, $2, 'Grey Stuff', 'menu_sync')`,
      [foodItemId, expId],
    );
  });

  it('creates the new index food_item_logs_user_idx and preserves food_item_logs_user_item_idx', () => {
    const indices = db.getTable('food_item_logs').listIndices().map((idx) => idx.name);
    expect(indices).toContain('food_item_logs_user_idx');
    expect(indices).toContain('food_item_logs_user_item_idx');
  });

  it('supports querying logs by user_id ordered by visited_on and logged_at', async () => {
    await pool.query(
      `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating, note)
       VALUES ($1, $2, '2026-06-10', 'America/New_York', 9, 'Delicious'),
              ($1, $2, '2026-06-12', 'America/New_York', 10, 'Still great')`,
      [userId, foodItemId],
    );

    const res = await pool.query(
      `SELECT id, visited_on, rating
         FROM food_item_logs
        WHERE user_id = $1
        ORDER BY visited_on DESC, logged_at DESC`,
      [userId],
    );

    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]?.rating).toBe(10);
    expect(res.rows[1]?.rating).toBe(9);
  });
});
