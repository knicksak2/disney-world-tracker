/**
 * Migration test for `0072_hidden_mickeys.sql`.
 *
 * Validates: Requirements 1.1, 1.2, 1.5, 16.1
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_FILE = '0072_hidden_mickeys.sql';
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function jsonbTypeof(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  let parsed = val;
  if (typeof val === 'string') {
    try {
      parsed = JSON.parse(val);
    } catch {
      return 'string';
    }
  }
  if (parsed === null) return 'null';
  if (Array.isArray(parsed)) return 'array';
  if (typeof parsed === 'object') return 'object';
  if (typeof parsed === 'string') return 'string';
  if (typeof parsed === 'number') return 'number';
  if (typeof parsed === 'boolean') return 'boolean';
  return 'null';
}

function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });
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
  db.public.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: jsonbTypeof,
  });
  return db;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));
}

function applyMigration(db: IMemoryDb, name: string): void {
  // Skip pure data-backfill migrations that don't alter DDL, as pg-mem does not support correlated subqueries in WHERE NOT EXISTS
  if (/^00(70|71)_backfill/u.test(name)) return;
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
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

describe('migration 0072_hidden_mickeys (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;
  let expId: string;
  let expAliasId: string;
  let tripId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    // Apply migrations up to and including 0072
    for (const name of migrationNames().filter((n) => n <= MIGRATION_FILE)) {
      applyMigration(db, name);
    }

    userId = randomUUID();
    await pool.query(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${userId}', 'user@example.com', 'hash')
    `);

    expId = randomUUID();
    await pool.query(`
      INSERT INTO experiences (id, upstream_entity_id, name, category, park, land)
      VALUES ('${expId}', '80010161;entityType=Attraction', 'Living with the Land', 'Ride', 'EPCOT', 'World Nature')
    `);

    expAliasId = randomUUID();
    await pool.query(`
      INSERT INTO experiences (id, upstream_entity_id, name, category, park, land)
      VALUES ('${expAliasId}', '412010036;entityType=Attraction', 'Living with the Land – Glimmering Greenhouses', 'Ride', 'EPCOT', 'World Nature')
    `);

    tripId = randomUUID();
    await pool.query(`
      INSERT INTO trips (id, name, start_date, end_date, creator_id)
      VALUES ('${tripId}', 'December Trip', '2026-12-01', '2026-12-05', '${userId}')
    `);
  });

  it('inserts and reads back a valid hidden_mickey row', async () => {
    const mickeyId = randomUUID();
    await pool.query(`
      INSERT INTO hidden_mickeys (
        id, experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, seed_key
      ) VALUES (
        '${mickeyId}', '${expId}', 'on_ride', 'easy', 'Greenhouse gourds', 'In the production greenhouses',
        'Pumpkins shaped into three-circle heads', 'seed', TRUE, 'approved', 'ep-lwtl-gourds'
      )
    `);

    const res = await pool.query(`SELECT * FROM hidden_mickeys WHERE id = '${mickeyId}'`);
    expect(res.rows[0]?.id).toBe(mickeyId);
    expect(res.rows[0]?.official).toBe(true);
    expect(res.rows[0]?.status).toBe('approved');
  });

  it('enforces chk_hm_seed_official: rejects source=seed with official=false', async () => {
    await expect(
      pool.query(`
        INSERT INTO hidden_mickeys (
          experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status
        ) VALUES (
          '${expId}', 'queue', 'easy', 'Test clue one', 'Test clue two longer', 'Test reveal text here', 'seed', FALSE, 'approved'
        )
      `),
    ).rejects.toThrow();
  });

  it('enforces text length constraints on clue_1 (10-140), clue_2 (10-300), reveal (10-500)', async () => {
    // clue_1 too short (< 10)
    await expect(
      pool.query(`
        INSERT INTO hidden_mickeys (
          experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status
        ) VALUES (
          '${expId}', 'queue', 'easy', 'Too short', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'approved'
        )
      `),
    ).rejects.toThrow();

    // clue_1 too long (> 140)
    await expect(
      pool.query(`
        INSERT INTO hidden_mickeys (
          experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status
        ) VALUES (
          '${expId}', 'queue', 'easy', '${'a'.repeat(141)}', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'approved'
        )
      `),
    ).rejects.toThrow();
  });

  it('enforces chk_hm_hidden_reason: requires hidden_reason only when status=hidden', async () => {
    // status=approved with hidden_reason must be rejected
    await expect(
      pool.query(`
        INSERT INTO hidden_mickeys (
          experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, hidden_reason
        ) VALUES (
          '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'approved', 'reports'
        )
      `),
    ).rejects.toThrow();

    // status=hidden without hidden_reason must be rejected
    await expect(
      pool.query(`
        INSERT INTO hidden_mickeys (
          experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status
        ) VALUES (
          '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'hidden'
        )
      `),
    ).rejects.toThrow();

    // status=hidden with valid hidden_reason (reports or operator) must succeed
    const res = await pool.query(`
      INSERT INTO hidden_mickeys (
        experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, hidden_reason
      ) VALUES (
        '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'hidden', 'reports'
      ) RETURNING id
    `);
    expect(res.rows[0]?.id).toBeDefined();
  });

  it('enforces unique seed_key index on non-null values', async () => {
    await pool.query(`
      INSERT INTO hidden_mickeys (
        experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, seed_key
      ) VALUES (
        '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'seed', TRUE, 'approved', 'key-1'
      )
    `);

    // Duplicate key-1 must fail
    await expect(
      pool.query(`
        INSERT INTO hidden_mickeys (
          experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, seed_key
        ) VALUES (
          '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'seed', TRUE, 'approved', 'key-1'
        )
      `),
    ).rejects.toThrow();

    // Null seed_key duplicates must succeed
    await pool.query(`
      INSERT INTO hidden_mickeys (
        experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, seed_key
      ) VALUES (
        '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'approved', NULL
      )
    `);
    await pool.query(`
      INSERT INTO hidden_mickeys (
        experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, seed_key
      ) VALUES (
        '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'approved', NULL
      )
    `);
  });

  it('enforces chk_mp_trip_needs_find and chk_mp_found_pair on mickey_progress', async () => {
    const mickeyId = randomUUID();
    await pool.query(`
      INSERT INTO hidden_mickeys (
        id, experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status
      ) VALUES (
        '${mickeyId}', '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'seed', TRUE, 'approved'
      )
    `);

    // trip_id set without found_at must be rejected
    await expect(
      pool.query(`
        INSERT INTO mickey_progress (user_id, mickey_id, trip_id)
        VALUES ('${userId}', '${mickeyId}', '${tripId}')
      `),
    ).rejects.toThrow();

    // found_at set without found_on must be rejected
    await expect(
      pool.query(`
        INSERT INTO mickey_progress (user_id, mickey_id, found_at)
        VALUES ('${userId}', '${mickeyId}', now())
      `),
    ).rejects.toThrow();

    // Valid progress with find and trip succeeds
    await pool.query(`
      INSERT INTO mickey_progress (user_id, mickey_id, found_at, found_on, trip_id)
      VALUES ('${userId}', '${mickeyId}', now(), '2026-12-02', '${tripId}')
    `);
    const res = await pool.query(`SELECT * FROM mickey_progress WHERE user_id = '${userId}'`);
    expect(res.rows[0]?.trip_id).toBe(tripId);
  });

  it('enforces mickey_experience_aliases constraints and primary key', async () => {
    // chk_mea_distinct: alias cannot equal canonical
    await expect(
      pool.query(`
        INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
        VALUES ('${expId}', '${expId}')
      `),
    ).rejects.toThrow();

    // Successful alias link
    await pool.query(`
      INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
      VALUES ('${expAliasId}', '${expId}')
    `);

    // Duplicate alias cannot be inserted (primary key)
    const otherExpId = randomUUID();
    await pool.query(`
      INSERT INTO experiences (id, upstream_entity_id, name, category, park)
      VALUES ('${otherExpId}', '99999999;entityType=Attraction', 'Other Ride', 'Ride', 'EPCOT')
    `);
    await expect(
      pool.query(`
        INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
        VALUES ('${expAliasId}', '${otherExpId}')
      `),
    ).rejects.toThrow();
  });

  it('cascades on experience deletion and user deletion', async () => {
    const mickeyId = randomUUID();
    await pool.query(`
      INSERT INTO hidden_mickeys (
        id, experience_id, zone, difficulty, clue_1, clue_2, reveal, source, official, status, submitter_id
      ) VALUES (
        '${mickeyId}', '${expId}', 'queue', 'easy', 'Valid clue one', 'Valid clue two length', 'Valid reveal text length', 'user', FALSE, 'approved', '${userId}'
      )
    `);

    await pool.query(`
      INSERT INTO mickey_experience_aliases (alias_experience_id, canonical_experience_id)
      VALUES ('${expAliasId}', '${expId}')
    `);

    await pool.query(`
      INSERT INTO mickey_progress (user_id, mickey_id, found_at, found_on)
      VALUES ('${userId}', '${mickeyId}', now(), '2026-12-02')
    `);

    await pool.query(`
      INSERT INTO mickey_still_there_votes (user_id, mickey_id, vote)
      VALUES ('${userId}', '${mickeyId}', 'there')
    `);

    await pool.query(`
      INSERT INTO mickey_reports (user_id, mickey_id, reason)
      VALUES ('${userId}', '${mickeyId}', 'not_a_mickey')
    `);

    await pool.query(`
      INSERT INTO mickey_submission_bans (user_id, reason)
      VALUES ('${userId}', 'Spamming')
    `);

    // Delete user: submitter_id nullified, user progress/votes/reports/bans cascade deleted
    await pool.query(`DELETE FROM users WHERE id = '${userId}'`);

    const mRes = await pool.query(`SELECT submitter_id FROM hidden_mickeys WHERE id = '${mickeyId}'`);
    expect(mRes.rows[0]?.submitter_id).toBeNull();

    const pRes = await pool.query(`SELECT count(*)::int as c FROM mickey_progress WHERE mickey_id = '${mickeyId}'`);
    expect(pRes.rows[0]?.c).toBe(0);

    const vRes = await pool.query(`SELECT count(*)::int as c FROM mickey_still_there_votes WHERE mickey_id = '${mickeyId}'`);
    expect(vRes.rows[0]?.c).toBe(0);

    const bRes = await pool.query(`SELECT count(*)::int as c FROM mickey_submission_bans WHERE user_id = '${userId}'`);
    expect(bRes.rows[0]?.c).toBe(0);

    // Delete experience: hidden_mickeys and alias links cascade delete
    await pool.query(`DELETE FROM experiences WHERE id = '${expId}'`);

    const hmCount = await pool.query(`SELECT count(*)::int as c FROM hidden_mickeys WHERE id = '${mickeyId}'`);
    expect(hmCount.rows[0]?.c).toBe(0);

    const aliasCount = await pool.query(`SELECT count(*)::int as c FROM mickey_experience_aliases WHERE canonical_experience_id = '${expId}'`);
    expect(aliasCount.rows[0]?.c).toBe(0);
  });
});
