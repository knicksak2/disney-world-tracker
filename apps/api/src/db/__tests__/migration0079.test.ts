/**
 * Migration test for `0079_settlement_notes.sql` (trip-expenses Req 7.8).
 *
 * Applies 0001, 0015, 0060, inserts a pre-migration settlement row, then applies
 * 0079 and asserts:
 *   - `note` column exists on `settlements`;
 *   - pre-existing rows default to `null`;
 *   - non-empty notes up to 300 chars and `NULL` are accepted;
 *   - empty, whitespace-only, and >300-char notes are rejected by `chk_settlements_note`;
 *   - re-applying 0079 is idempotent.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

const RESORTS_STUB = `
  CREATE TABLE IF NOT EXISTS resorts (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

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

function applyMigration(db: IMemoryDb, name: string): void {
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

describe('migration 0079_settlement_notes (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let tripId: string;
  let user1Id: string;
  let user2Id: string;
  let preMigrationSettlementId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    db.public.none(RESORTS_STUB);
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0060_trip_expenses.sql');

    user1Id = randomUUID();
    user2Id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, 'alice@example.com', 'hash1'),
              ($2, 'bob@example.com', 'hash2')`,
      [user1Id, user2Id],
    );

    tripId = randomUUID();
    await pool.query(
      `INSERT INTO trips (id, name, start_date, end_date, creator_id)
       VALUES ($1, 'Disney Trip', '2026-10-01', '2026-10-05', $2)`,
      [tripId, user1Id],
    );

    preMigrationSettlementId = randomUUID();
    await pool.query(
      `INSERT INTO settlements (id, trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date)
       VALUES ($1, $2, $3, $4, $3, 2500, '2026-10-02')`,
      [preMigrationSettlementId, tripId, user2Id, user1Id],
    );
  });

  it('adds nullable note column and preserves pre-existing rows as NULL', async () => {
    applyMigration(db, '0079_settlement_notes.sql');

    const colRes = await pool.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'settlements' AND column_name = 'note'`,
    );
    expect(colRes.rows).toHaveLength(1);
    expect(colRes.rows[0]?.column_name).toBe('note');

    const existing = await pool.query(
      `SELECT note FROM settlements WHERE id = $1`,
      [preMigrationSettlementId],
    );
    expect(existing.rows[0]?.note).toBeNull();
  });

  it('accepts valid notes up to 300 chars and NULL, and rejects empty/whitespace/over-length notes', async () => {
    applyMigration(db, '0079_settlement_notes.sql');

    const validRes = await pool.query(
      `INSERT INTO settlements (trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date, note)
       VALUES ($1, $2, $3, $2, 3000, '2026-10-03', 'Venmo @alice')
       RETURNING note`,
      [tripId, user2Id, user1Id],
    );
    expect(validRes.rows[0]?.note).toBe('Venmo @alice');

    const maxNote = 'x'.repeat(300);
    const maxRes = await pool.query(
      `INSERT INTO settlements (trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date, note)
       VALUES ($1, $2, $3, $2, 1000, '2026-10-03', $4)
       RETURNING note`,
      [tripId, user2Id, user1Id, maxNote],
    );
    expect(maxRes.rows[0]?.note).toBe(maxNote);

    const nullRes = await pool.query(
      `INSERT INTO settlements (trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date, note)
       VALUES ($1, $2, $3, $2, 1000, '2026-10-03', NULL)
       RETURNING note`,
      [tripId, user2Id, user1Id],
    );
    expect(nullRes.rows[0]?.note).toBeNull();

    for (const badNote of ['', '   ', 'a'.repeat(301)]) {
      await expect(
        pool.query(
          `INSERT INTO settlements (trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date, note)
           VALUES ($1, $2, $3, $2, 1000, '2026-10-03', $4)`,
          [tripId, user2Id, user1Id, badNote],
        ),
      ).rejects.toThrow();
    }
  });

  it('is idempotent when applied twice', () => {
    applyMigration(db, '0079_settlement_notes.sql');
    expect(() => applyMigration(db, '0079_settlement_notes.sql')).not.toThrow();
  });
});
