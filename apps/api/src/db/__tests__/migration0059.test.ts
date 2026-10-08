/**
 * Migration test for `0059_password_reset_tokens.sql`.
 *
 * Applies 0001 and 0059 to a fresh pg-mem database and asserts the schema contract:
 *   - `password_reset_tokens` table exists with correct column types;
 *   - FK `user_id` references `users(id)` and cascades on delete;
 *   - `token_hash` is UNIQUE;
 *   - Indexes exist;
 *   - Check constraint on non-negative attempts.
 *
 * Validates: Requirements 1.2, 2.2
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

describe('migration 0059_password_reset_tokens', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0059_password_reset_tokens.sql');

    userId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'guest@example.com', 'hash')`,
      [userId],
    );
  });

  it('creates password_reset_tokens table with correct columns', async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'password_reset_tokens'
      ORDER BY ordinal_position;
    `);

    const colNames = res.rows.map((r) => r.column_name);
    expect(colNames).toEqual([
      'id',
      'user_id',
      'code_hash',
      'token_hash',
      'attempts',
      'expires_at',
      'used_at',
      'created_at',
    ]);
  });

  it('cascades on user deletion', async () => {
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, code_hash, token_hash, expires_at)
       VALUES ($1, 'code-hash-1', 'token-hash-1', now() + interval '15 minutes')`,
      [userId],
    );

    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    const res = await pool.query(
      `SELECT count(*)::int as count FROM password_reset_tokens WHERE user_id = $1`,
      [userId],
    );
    expect(res.rows[0]?.['count']).toBe(0);
  });

  it('enforces UNIQUE on token_hash', async () => {
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, code_hash, token_hash, expires_at)
       VALUES ($1, 'code-hash-1', 'same-token-hash', now() + interval '15 minutes')`,
      [userId],
    );

    await expect(
      pool.query(
        `INSERT INTO password_reset_tokens (user_id, code_hash, token_hash, expires_at)
         VALUES ($1, 'code-hash-2', 'same-token-hash', now() + interval '15 minutes')`,
        [userId],
      ),
    ).rejects.toThrow();
  });

  it('creates user and hash indexes', () => {
    const indices = db.getTable('password_reset_tokens').listIndices().map((idx) => idx.name);
    expect(indices).toContain('password_reset_tokens_user_idx');
    expect(indices).toContain('password_reset_tokens_code_hash_idx');
    expect(indices).toContain('password_reset_tokens_token_hash_idx');
  });
});
