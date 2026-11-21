/**
 * Migration test for `0078_user_onboarding.sql` (first-run-onboarding).
 *
 * Applies 0001 and 0078 to a fresh pg-mem database and asserts:
 *   - `user_onboarding` has the expected columns and defaults;
 *   - `chk_user_onboarding_intent` accepts all 4 intents + NULL and rejects unknown intents;
 *   - `chk_user_onboarding_park` accepts all 4 theme parks + NULL and rejects unknown parks;
 *   - `user_id` cascades when the owning user row is deleted.
 *
 * Validates: Requirements 1.1, 1.2
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

describe('migration 0078_user_onboarding', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;
    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0078_user_onboarding.sql');
    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'ob@example.com', 'hash')`, [userId]);
  });

  it('creates user_onboarding with the expected columns in order', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_onboarding' ORDER BY ordinal_position`,
    );
    expect(res.rows.map((r) => r['column_name'])).toEqual([
      'user_id',
      'completed_at',
      'skipped_at',
      'grandfathered_at',
      'initial_intent',
      'selected_park',
      'starter_checklist_dismissed_at',
      'updated_at',
    ]);
  });

  it('defaults nullable columns to null and sets updated_at', async () => {
    await pool.query(`INSERT INTO user_onboarding (user_id) VALUES ($1)`, [userId]);
    const res = await pool.query(`SELECT * FROM user_onboarding WHERE user_id = $1`, [userId]);
    expect(res.rows[0]).toMatchObject({
      user_id: userId,
      completed_at: null,
      skipped_at: null,
      grandfathered_at: null,
      initial_intent: null,
      selected_park: null,
      starter_checklist_dismissed_at: null,
    });
    expect(res.rows[0]?.['updated_at']).toBeTruthy();
  });

  it('accepts each valid initial_intent and rejects invalid values', async () => {
    for (const intent of ['plan', 'in_park', 'track_history', 'explore']) {
      const uid = randomUUID();
      await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`, [
        uid,
        `${intent}@example.com`,
      ]);
      await pool.query(`INSERT INTO user_onboarding (user_id, initial_intent) VALUES ($1, $2)`, [uid, intent]);
    }
    await expect(
      pool.query(`INSERT INTO user_onboarding (user_id, initial_intent) VALUES ($1, 'invalid_intent')`, [userId]),
    ).rejects.toThrow();
  });

  it('accepts each valid selected_park and rejects invalid values', async () => {
    for (const [idx, park] of ['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'].entries()) {
      const uid = randomUUID();
      await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`, [
        uid,
        `park${idx}@example.com`,
      ]);
      await pool.query(`INSERT INTO user_onboarding (user_id, selected_park) VALUES ($1, $2)`, [uid, park]);
    }
    await expect(
      pool.query(`INSERT INTO user_onboarding (user_id, selected_park) VALUES ($1, 'Disney Springs')`, [userId]),
    ).rejects.toThrow();
  });

  it('cascades on user deletion', async () => {
    await pool.query(`INSERT INTO user_onboarding (user_id, initial_intent) VALUES ($1, 'plan')`, [userId]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    const res = await pool.query(`SELECT count(*)::int AS n FROM user_onboarding WHERE user_id = $1`, [userId]);
    expect(res.rows[0]?.['n']).toBe(0);
  });
});
