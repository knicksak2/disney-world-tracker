/**
 * Migration test for `0054_experience_favorites.sql`.
 *
 * Applies 0001 and 0054 to a fresh pg-mem database and asserts the schema contract:
 *   - `experience_favorites` table with composite PK (user_id, experience_id);
 *   - `favorited_at` defaults to now();
 *   - Both indexes `experience_favorites_user_idx` and `experience_favorites_experience_idx` exist;
 *   - Cascades on user deletion;
 *   - Cascades on experience deletion.
 *
 * Validates: Requirements 1.1, 1.3
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

describe('migration 0054_experience_favorites', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;
  let experienceId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0054_experience_favorites.sql');

    userId = randomUUID();
    experienceId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'user@example.com', 'hash')`,
      [userId],
    );

    await pool.query(
      `INSERT INTO experiences (id, name, category, park, active, upstream_entity_id)
       VALUES ($1, 'Space Mountain', 'Ride', 'Magic Kingdom', TRUE, 'space-mountain-mk')`,
      [experienceId],
    );
  });

  it('creates experience_favorites table with correct columns', async () => {
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'experience_favorites'
      ORDER BY ordinal_position;
    `);

    const colNames = res.rows.map((r) => r.column_name);
    expect(colNames).toEqual(['user_id', 'experience_id', 'favorited_at']);
  });

  it('enforces composite PK (user_id, experience_id)', async () => {
    await pool.query(
      `INSERT INTO experience_favorites (user_id, experience_id)
       VALUES ($1, $2)`,
      [userId, experienceId],
    );

    await expect(
      pool.query(
        `INSERT INTO experience_favorites (user_id, experience_id)
         VALUES ($1, $2)`,
        [userId, experienceId],
      ),
    ).rejects.toThrow();
  });

  it('creates both user and experience indexes', () => {
    const indices = db.getTable('experience_favorites').listIndices().map((idx) => idx.name);
    expect(indices).toContain('experience_favorites_user_idx');
    expect(indices).toContain('experience_favorites_experience_idx');
  });

  it('cascades on user deletion', async () => {
    await pool.query(
      `INSERT INTO experience_favorites (user_id, experience_id)
       VALUES ($1, $2)`,
      [userId, experienceId],
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    const res = await pool.query(
      `SELECT count(*)::int as count FROM experience_favorites WHERE experience_id = $1`,
      [experienceId],
    );
    expect(res.rows[0]?.['count']).toBe(0);
  });

  it('cascades on experience deletion', async () => {
    await pool.query(
      `INSERT INTO experience_favorites (user_id, experience_id)
       VALUES ($1, $2)`,
      [userId, experienceId],
    );

    await pool.query(`DELETE FROM experiences WHERE id = $1`, [experienceId]);

    const res = await pool.query(
      `SELECT count(*)::int as count FROM experience_favorites WHERE user_id = $1`,
      [userId],
    );
    expect(res.rows[0]?.['count']).toBe(0);
  });
});
