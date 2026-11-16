/**
 * Migration test for `0076_user_feedback.sql` (in-app-feedback).
 *
 * Applies 0001 and 0076 to a fresh pg-mem database and asserts the schema contract:
 *   - `user_feedback` has the expected columns and defaults;
 *   - each CHECK (kind, status, message length, platform, version lengths, and
 *     "no contact email without consent") rejects a violating row;
 *   - both indexes exist;
 *   - `user_id` cascades when the user row is deleted.
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 7.1
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

function applyMigration(db: IMemoryDb, name: string): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let sql = readFileSync(resolve(here, '..', '..', '..', 'migrations', name), 'utf8');
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

describe('migration 0076_user_feedback', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;

  /** Insert with sensible defaults, overridable per column. */
  async function insertRow(over: Record<string, unknown> = {}): Promise<void> {
    const row: Record<string, unknown> = {
      user_id: userId,
      kind: 'bug',
      message: 'It crashed',
      ...over,
    };
    const cols = Object.keys(row);
    await pool.query(
      `INSERT INTO user_feedback (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => row[c]),
    );
  }

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0076_user_feedback.sql');
    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'fb@example.com', 'hash')`, [userId]);
  });

  it('creates user_feedback with the expected columns in order', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_feedback' ORDER BY ordinal_position`,
    );
    expect(res.rows.map((r) => r['column_name'])).toEqual([
      'id',
      'user_id',
      'kind',
      'message',
      'status',
      'contact_ok',
      'contact_email',
      'app_version',
      'platform',
      'os_version',
      'created_at',
      'status_changed_at',
    ]);
  });

  it('defaults status to new, contact_ok to false and leaves device and email null', async () => {
    await insertRow();
    const res = await pool.query(
      `SELECT status, contact_ok, contact_email, app_version, platform, os_version FROM user_feedback`,
    );
    expect(res.rows[0]).toEqual({
      status: 'new',
      contact_ok: false,
      contact_email: null,
      app_version: null,
      platform: null,
      os_version: null,
    });
  });

  it('accepts a full row with consent, email and device info', async () => {
    await insertRow({
      kind: 'idea',
      contact_ok: true,
      contact_email: 'fb@example.com',
      app_version: '1.4.0',
      platform: 'android',
      os_version: '14',
    });
    const res = await pool.query(`SELECT count(*)::int AS n FROM user_feedback`);
    expect(res.rows[0]?.['n']).toBe(1);
  });

  it('rejects an unknown kind', async () => {
    await expect(insertRow({ kind: 'complaint' })).rejects.toThrow();
  });

  it('rejects an unknown status', async () => {
    await expect(insertRow({ status: 'closed' })).rejects.toThrow();
  });

  it('rejects an empty message and a message over 2000 characters, accepts exactly 2000', async () => {
    await expect(insertRow({ message: '' })).rejects.toThrow();
    await expect(insertRow({ message: 'a'.repeat(2001) })).rejects.toThrow();
    await insertRow({ message: 'a'.repeat(2000) });
    const res = await pool.query(`SELECT count(*)::int AS n FROM user_feedback`);
    expect(res.rows[0]?.['n']).toBe(1);
  });

  it('rejects a contact email stored without consent', async () => {
    await expect(insertRow({ contact_ok: false, contact_email: 'fb@example.com' })).rejects.toThrow();
  });

  it('rejects an unknown platform and over-long version strings', async () => {
    await expect(insertRow({ platform: 'windows' })).rejects.toThrow();
    await expect(insertRow({ app_version: 'v'.repeat(33) })).rejects.toThrow();
    await expect(insertRow({ os_version: 'v'.repeat(33) })).rejects.toThrow();
  });

  it('requires an existing user', async () => {
    await expect(insertRow({ user_id: randomUUID() })).rejects.toThrow();
  });

  it('cascades on user deletion', async () => {
    await insertRow();
    await insertRow({ kind: 'other', message: 'second' });
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    const res = await pool.query(`SELECT count(*)::int AS n FROM user_feedback WHERE user_id = $1`, [userId]);
    expect(res.rows[0]?.['n']).toBe(0);
  });

  it('creates both indexes', () => {
    const sql = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations', '0076_user_feedback.sql'),
      'utf8',
    );
    expect(sql).toContain('user_feedback_user_created_idx ON user_feedback (user_id, created_at)');
    expect(sql).toContain('user_feedback_status_created_idx ON user_feedback (status, created_at)');
    // pg-mem has no pg_indexes catalog; the beforeEach apply succeeding proves the statements parse and run.
    expect(db.public.many(`SELECT count(*)::int AS n FROM user_feedback`)[0]?.['n']).toBe(0);
  });
});
