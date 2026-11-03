/**
 * Migration test for `0068_trip_budget.sql`.
 *
 * Validates: Requirements 1.6, 2.4, 3.1, 3.5, 4.1, 4.3, 7.8, 16.7, 17.4
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_FILE = '0068_trip_budget.sql';
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

describe('migration 0068_trip_budget (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let tripId: string;
  let userId: string;
  let guestId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    // Apply migrations up to 0067
    for (const name of migrationNames().filter((n) => n < MIGRATION_FILE)) {
      applyMigration(db, name);
    }

    userId = randomUUID();
    await pool.query(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${userId}', 'test@example.com', 'hash')
    `);

    tripId = randomUUID();
    await pool.query(`
      INSERT INTO trips (id, name, start_date, end_date, creator_id)
      VALUES ('${tripId}', 'Disney Vacation', '2026-10-25', '2026-10-30', '${userId}')
    `);

    guestId = randomUUID();
    await pool.query(`
      INSERT INTO trip_guests (id, trip_id, name, sponsor_member_id)
      VALUES ('${guestId}', '${tripId}', 'Guest Goofy', '${userId}')
    `);

    // Record user columns before 0068
    const colsBefore = await pool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY column_name
    `);

    // Apply 0068
    applyMigration(db, MIGRATION_FILE);

    // Record user columns after 0068
    const colsAfter = await pool.query(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY column_name
    `);
    expect(colsAfter.rows).toEqual(colsBefore.rows);
  });

  it('is wrapped in BEGIN/COMMIT and idempotent', () => {
    const raw = readFileSync(resolve(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
    expect(raw).toMatch(/^\s*BEGIN;/m);
    expect(raw).toMatch(/^\s*COMMIT;/m);
    expect(() => applyMigration(db, MIGRATION_FILE)).not.toThrow();
  });

  it('trip_budget_settings tax_bps jsonb_typeof check constraint is exercised', async () => {
    // Valid object succeeds
    await pool.query(`
      INSERT INTO trip_budget_settings (trip_id, tax_bps)
      VALUES ('${tripId}', '{"dining": 650}'::jsonb)
    `);

    // Non-object (array) fails check constraint
    const otherTripId = randomUUID();
    await pool.query(`
      INSERT INTO trips (id, name, start_date, end_date, creator_id)
      VALUES ('${otherTripId}', 'Second Trip', '2026-11-01', '2026-11-05', '${userId}')
    `);

    await expect(
      pool.query(`
        INSERT INTO trip_budget_settings (trip_id, tax_bps)
        VALUES ('${otherTripId}', '[650, 750]'::jsonb)
      `)
    ).rejects.toThrow();
  });

  it('description validation on trip_budget_lines enforces btrim and length', async () => {
    // Valid description
    const lineId = randomUUID();
    await pool.query(`
      INSERT INTO trip_budget_lines (
        id, trip_id, created_by, category, description, price_source
      ) VALUES (
        '${lineId}', '${tripId}', '${userId}', 'dining', 'Chef Mickey Dinner', 'user_entered'
      )
    `);

    // Whitespace only fails
    await expect(
      pool.query(`
        INSERT INTO trip_budget_lines (
          trip_id, created_by, category, description, price_source
        ) VALUES (
          '${tripId}', '${userId}', 'dining', '   ', 'user_entered'
        )
      `)
    ).rejects.toThrow();

    // Over 200 characters fails
    await expect(
      pool.query(`
        INSERT INTO trip_budget_lines (
          trip_id, created_by, category, description, price_source
        ) VALUES (
          '${tripId}', '${userId}', 'dining', '${'A'.repeat(201)}', 'user_entered'
        )
      `)
    ).rejects.toThrow();
  });

  it('enforces XOR person constraints on profiles and allocations', async () => {
    // Traveler profile: both fails
    await expect(
      pool.query(`
        INSERT INTO trip_traveler_profiles (
          trip_id, member_id, guest_id, age_bracket
        ) VALUES (
          '${tripId}', '${userId}', '${guestId}', 'adult'
        )
      `)
    ).rejects.toThrow();

    // Traveler profile: neither fails
    await expect(
      pool.query(`
        INSERT INTO trip_traveler_profiles (
          trip_id, member_id, guest_id, age_bracket
        ) VALUES (
          '${tripId}', NULL, NULL, 'adult'
        )
      `)
    ).rejects.toThrow();

    // Traveler profile: member only succeeds
    const profId = randomUUID();
    await pool.query(`
      INSERT INTO trip_traveler_profiles (
        id, trip_id, member_id, guest_id, age_bracket
      ) VALUES (
        '${profId}', '${tripId}', '${userId}', NULL, 'adult'
      )
    `);

    // Duplicate traveler profile for same member on trip fails
    await expect(
      pool.query(`
        INSERT INTO trip_traveler_profiles (
          trip_id, member_id, guest_id, age_bracket
        ) VALUES (
          '${tripId}', '${userId}', NULL, 'child'
        )
      `)
    ).rejects.toThrow();

    // Budget allocation XOR
    const lineId = randomUUID();
    await pool.query(`
      INSERT INTO trip_budget_lines (
        id, trip_id, created_by, category, description, price_source
      ) VALUES (
        '${lineId}', '${tripId}', '${userId}', 'tickets', 'Park Tickets', 'user_entered'
      )
    `);

    // Allocation: both fails
    await expect(
      pool.query(`
        INSERT INTO trip_budget_allocations (
          line_id, member_id, guest_id, amount_cents
        ) VALUES (
          '${lineId}', '${userId}', '${guestId}', 10000
        )
      `)
    ).rejects.toThrow();

    // Allocation: neither fails
    await expect(
      pool.query(`
        INSERT INTO trip_budget_allocations (
          line_id, member_id, guest_id, amount_cents
        ) VALUES (
          '${lineId}', NULL, NULL, 10000
        )
      `)
    ).rejects.toThrow();

    // Allocation: guest succeeds
    const allocId = randomUUID();
    await pool.query(`
      INSERT INTO trip_budget_allocations (
        id, line_id, member_id, guest_id, amount_cents
      ) VALUES (
        '${allocId}', '${lineId}', NULL, '${guestId}', 10000
      )
    `);

    // Duplicate allocation for same guest on same line fails
    await expect(
      pool.query(`
        INSERT INTO trip_budget_allocations (
          line_id, member_id, guest_id, amount_cents
        ) VALUES (
          '${lineId}', NULL, '${guestId}', 5000
        )
      `)
    ).rejects.toThrow();
  });

  it('unique index on suggestion_key allows NULL duplicates but rejects non-NULL duplicate per trip', async () => {
    // Two lines with NULL suggestion_key on same trip succeed
    await pool.query(`
      INSERT INTO trip_budget_lines (
        trip_id, created_by, category, description, price_source, suggestion_key
      ) VALUES (
        '${tripId}', '${userId}', 'dining', 'Lunch 1', 'user_entered', NULL
      )
    `);
    await pool.query(`
      INSERT INTO trip_budget_lines (
        trip_id, created_by, category, description, price_source, suggestion_key
      ) VALUES (
        '${tripId}', '${userId}', 'dining', 'Lunch 2', 'user_entered', NULL
      )
    `);

    // Non-null suggestion_key
    await pool.query(`
      INSERT INTO trip_budget_lines (
        trip_id, created_by, category, description, price_source, suggestion_key
      ) VALUES (
        '${tripId}', '${userId}', 'dining', 'Keyed Lunch', 'user_entered', 'sug-lunch'
      )
    `);

    // Duplicate suggestion_key fails
    await expect(
      pool.query(`
        INSERT INTO trip_budget_lines (
          trip_id, created_by, category, description, price_source, suggestion_key
        ) VALUES (
          '${tripId}', '${userId}', 'dining', 'Duplicate Key', 'user_entered', 'sug-lunch'
        )
      `)
    ).rejects.toThrow();
  });

  it('cascades from trips cleanly through guests, lines, allocations, and profiles', async () => {
    const lineId = randomUUID();
    await pool.query(`
      INSERT INTO trip_budget_lines (
        id, trip_id, created_by, category, description, price_source
      ) VALUES (
        '${lineId}', '${tripId}', '${userId}', 'dining', 'Dinner', 'user_entered'
      )
    `);
    await pool.query(`
      INSERT INTO trip_budget_allocations (
        line_id, member_id, guest_id, amount_cents
      ) VALUES (
        '${lineId}', NULL, '${guestId}', 4000
      )
    `);
    await pool.query(`
      INSERT INTO trip_traveler_profiles (
        trip_id, member_id, guest_id, age_bracket
      ) VALUES (
        '${tripId}', NULL, '${guestId}', 'child'
      )
    `);
    await pool.query(`
      INSERT INTO trip_budget_dismissed_suggestions (
        trip_id, suggestion_key
      ) VALUES (
        '${tripId}', 'sug-dismissed'
      )
    `);

    // Deleting the trip cascades through everything without FK error
    await pool.query(`DELETE FROM trips WHERE id = '${tripId}'`);

    const lines = await pool.query('SELECT * FROM trip_budget_lines');
    const allocs = await pool.query('SELECT * FROM trip_budget_allocations');
    const profs = await pool.query('SELECT * FROM trip_traveler_profiles');
    const dismissed = await pool.query('SELECT * FROM trip_budget_dismissed_suggestions');

    expect(lines.rows).toHaveLength(0);
    expect(allocs.rows).toHaveLength(0);
    expect(profs.rows).toHaveLength(0);
    expect(dismissed.rows).toHaveLength(0);
  });

  it('linked_expense_id becomes NULL on DELETE SET NULL', async () => {
    // Create expense
    const expId = randomUUID();
    await pool.query(`
      INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode, category)
      VALUES ('${expId}', '${tripId}', '${userId}', '${userId}', 5000, 'Hotel deposit', '2026-10-25', 'even', 'hotel')
    `);

    const lineId = randomUUID();
    await pool.query(`
      INSERT INTO trip_budget_lines (
        id, trip_id, created_by, category, description, price_source, linked_expense_id
      ) VALUES (
        '${lineId}', '${tripId}', '${userId}', 'lodging', 'Hotel line', 'user_entered', '${expId}'
      )
    `);

    // Delete expense
    await pool.query(`DELETE FROM expenses WHERE id = '${expId}'`);

    const res = await pool.query(`
      SELECT linked_expense_id FROM trip_budget_lines WHERE id = '${lineId}'
    `);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.linked_expense_id).toBeNull();
  });

  it('no Budget table has a total, subtotal, or balance column (Property 43b)', async () => {
    const budgetTables = [
      'trip_budget_lines',
      'trip_budget_allocations',
      'trip_budget_settings',
      'trip_traveler_profiles',
      'trip_budget_dismissed_suggestions',
    ];
    for (const table of budgetTables) {
      const res = await pool.query(`
        SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'
      `);
      for (const row of res.rows) {
        const colName = String(row.column_name);
        expect(colName).not.toMatch(/total|subtotal|balance/i);
      }
    }
  });
});
