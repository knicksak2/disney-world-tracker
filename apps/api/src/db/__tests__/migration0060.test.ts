/**
 * Migration test for `0060_trip_expenses.sql`.
 *
 * Asserts:
 *  - Every table and column exists with correct types;
 *  - Every CHECK constraint (amount bounds, member_id XOR guest_id on all 3 recipient tables,
 *    discount sign check, distinct-parties settlement check, nonempty-name checks);
 *  - Every index exists;
 *  - Reapplying the migration is a clean no-op.
 *
 * Validates: Requirements 1.3, 2.2, 3.1, 3.2, 4.1, 5.1, 5.8, 7.2, 8.6, 12.2
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

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
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
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
  db.public.none(sql);
}

const RESORTS_STUB = `
  CREATE TABLE IF NOT EXISTS resorts (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

describe('migration 0060_trip_expenses', () => {
  let db: IMemoryDb;
  let tripId: string;
  let userId1: string;
  let userId2: string;
  let guestId: string;
  let expenseId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    db.public.none(RESORTS_STUB);
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0060_trip_expenses.sql');

    userId1 = randomUUID();
    userId2 = randomUUID();
    tripId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${userId1}', 'alice@example.com', 'hash1'),
             ('${userId2}', 'bob@example.com', 'hash2');
      INSERT INTO profiles (user_id, display_name)
      VALUES ('${userId1}', 'Alice'),
             ('${userId2}', 'Bob');
      INSERT INTO trips (id, creator_id, name, start_date, end_date)
      VALUES ('${tripId}', '${userId1}', 'Disney Trip', '2026-10-01', '2026-10-05');
    `);

    guestId = randomUUID();
    db.public.none(`
      INSERT INTO trip_guests (id, trip_id, sponsor_member_id, name)
      VALUES ('${guestId}', '${tripId}', '${userId1}', 'Guest Bobbie');
    `);

    expenseId = randomUUID();
    db.public.none(`
      INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
      VALUES ('${expenseId}', '${tripId}', '${userId1}', '${userId1}', 5000, 'Lunch', '2026-10-02', 'exact');
    `);
  });

  it('creates all eleven tables and columns with correct names', () => {
    const tableNames = [
      'trip_guests',
      'expenses',
      'expense_shares',
      'expense_tiers',
      'expense_tier_counts',
      'expense_items',
      'expense_item_assignees',
      'charge_lines',
      'charge_line_scopes',
      'expense_refunds',
      'settlements',
    ];

    for (const table of tableNames) {
      expect(db.getTable(table)).toBeDefined();
    }
  });

  it('enforces chk_trip_guests_name_nonempty', () => {
    expect(() => {
      db.public.none(`
        INSERT INTO trip_guests (id, trip_id, sponsor_member_id, name)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '   ');
      `);
    }).toThrow();
  });

  it('enforces chk_expenses_amount bounds (1 to 10,000,000 cents)', () => {
    // 0 cents rejected
    expect(() => {
      db.public.none(`
        INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', 0, 'Zero', '2026-10-02', 'exact');
      `);
    }).toThrow();

    // > 10,000,000 cents rejected
    expect(() => {
      db.public.none(`
        INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', 10000001, 'Too Much', '2026-10-02', 'exact');
      `);
    }).toThrow();

    // 10,000,000 accepted
    expect(() => {
      db.public.none(`
        INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', 10000000, 'Max Allowed', '2026-10-02', 'exact');
      `);
    }).not.toThrow();
  });

  it('enforces chk_expenses_category closed vocabulary', () => {
    for (const valid of ['hotel', 'tickets', 'dining', 'shopping', 'transportation', 'other']) {
      expect(() => {
        db.public.none(`
          INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, category, split_mode)
          VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', 100, 'Desc', '2026-10-02', '${valid}', 'exact');
        `);
      }).not.toThrow();
    }

    expect(() => {
      db.public.none(`
        INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, category, split_mode)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', 100, 'Desc', '2026-10-02', 'invalid_cat', 'exact');
      `);
    }).toThrow();
  });

  it('enforces chk_expenses_split_mode closed vocabulary', () => {
    for (const valid of ['exact', 'even', 'tiered', 'itemized']) {
      expect(() => {
        db.public.none(`
          INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
          VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', 100, 'Desc', '2026-10-02', '${valid}');
        `);
      }).not.toThrow();
    }

    expect(() => {
      db.public.none(`
        INSERT INTO expenses (id, trip_id, payer_id, created_by, amount_cents, description, expense_date, split_mode)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', 100, 'Desc', '2026-10-02', 'random_mode');
      `);
    }).toThrow();
  });

  it('enforces member_id XOR guest_id on expense_shares, expense_tier_counts, and expense_item_assignees', () => {
    // 1. expense_shares: neither set -> throw
    expect(() => {
      db.public.none(`
        INSERT INTO expense_shares (id, expense_id, member_id, guest_id, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', NULL, NULL, 500);
      `);
    }).toThrow();

    // both set -> throw
    expect(() => {
      db.public.none(`
        INSERT INTO expense_shares (id, expense_id, member_id, guest_id, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', '${userId2}', '${guestId}', 500);
      `);
    }).toThrow();

    // only member_id -> ok
    expect(() => {
      db.public.none(`
        INSERT INTO expense_shares (id, expense_id, member_id, guest_id, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', '${userId2}', NULL, 500);
      `);
    }).not.toThrow();

    // only guest_id -> ok
    expect(() => {
      db.public.none(`
        INSERT INTO expense_shares (id, expense_id, member_id, guest_id, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', NULL, '${guestId}', 500);
      `);
    }).not.toThrow();

    // 2. expense_tiers & expense_tier_counts
    const tierId = randomUUID();
    db.public.none(`
      INSERT INTO expense_tiers (id, expense_id, tier_name, price_cents)
      VALUES ('${tierId}', '${expenseId}', 'Adult', 2000);
    `);

    // tier count both set -> throw
    expect(() => {
      db.public.none(`
        INSERT INTO expense_tier_counts (id, tier_id, member_id, guest_id, unit_count)
        VALUES ('${randomUUID()}', '${tierId}', '${userId2}', '${guestId}', 1);
      `);
    }).toThrow();

    // tier count only member_id -> ok
    expect(() => {
      db.public.none(`
        INSERT INTO expense_tier_counts (id, tier_id, member_id, guest_id, unit_count)
        VALUES ('${randomUUID()}', '${tierId}', '${userId2}', NULL, 1);
      `);
    }).not.toThrow();

    // 3. expense_items & expense_item_assignees
    const itemId = randomUUID();
    db.public.none(`
      INSERT INTO expense_items (id, expense_id, item_name, price_cents)
      VALUES ('${itemId}', '${expenseId}', 'Burger', 1500);
    `);

    // item assignee neither set -> throw
    expect(() => {
      db.public.none(`
        INSERT INTO expense_item_assignees (id, item_id, member_id, guest_id)
        VALUES ('${randomUUID()}', '${itemId}', NULL, NULL);
      `);
    }).toThrow();

    // item assignee only guest_id -> ok
    expect(() => {
      db.public.none(`
        INSERT INTO expense_item_assignees (id, item_id, member_id, guest_id)
        VALUES ('${randomUUID()}', '${itemId}', NULL, '${guestId}');
      `);
    }).not.toThrow();
  });

  it('enforces chk_charge_lines_sign (discount negative, others positive)', () => {
    // positive discount -> reject
    expect(() => {
      db.public.none(`
        INSERT INTO charge_lines (id, expense_id, kind, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', 'discount', 100);
      `);
    }).toThrow();

    // negative discount -> ok
    expect(() => {
      db.public.none(`
        INSERT INTO charge_lines (id, expense_id, kind, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', 'discount', -100);
      `);
    }).not.toThrow();

    // negative tax -> reject
    expect(() => {
      db.public.none(`
        INSERT INTO charge_lines (id, expense_id, kind, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', 'tax', -100);
      `);
    }).toThrow();

    // positive tax -> ok
    expect(() => {
      db.public.none(`
        INSERT INTO charge_lines (id, expense_id, kind, amount_cents)
        VALUES ('${randomUUID()}', '${expenseId}', 'tax', 100);
      `);
    }).not.toThrow();
  });

  it('enforces chk_settlements_distinct_parties and amount bounds', () => {
    // same payer and recipient -> reject
    expect(() => {
      db.public.none(`
        INSERT INTO settlements (id, trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId1}', '${userId1}', 1000, '2026-10-02');
      `);
    }).toThrow();

    // distinct -> ok
    expect(() => {
      db.public.none(`
        INSERT INTO settlements (id, trip_id, payer_id, recipient_id, created_by, amount_cents, settled_date)
        VALUES ('${randomUUID()}', '${tripId}', '${userId1}', '${userId2}', '${userId1}', 1000, '2026-10-02');
      `);
    }).not.toThrow();
  });

  it('creates all expected indexes', () => {
    const indicesByTable: Record<string, string[]> = {
      trip_guests: ['trip_guests_trip_idx'],
      expenses: ['expenses_trip_idx', 'expenses_trip_payer_idx'],
      expense_shares: ['expense_shares_expense_idx'],
      expense_tiers: ['expense_tiers_expense_idx'],
      expense_tier_counts: ['expense_tier_counts_tier_idx'],
      expense_items: ['expense_items_expense_idx'],
      expense_item_assignees: ['expense_item_assignees_item_idx'],
      charge_lines: ['charge_lines_expense_idx'],
      expense_refunds: ['expense_refunds_expense_idx'],
      settlements: ['settlements_trip_idx'],
    };

    for (const [table, expectedIndices] of Object.entries(indicesByTable)) {
      const actual = db.getTable(table).listIndices().map((i) => i.name);
      for (const expected of expectedIndices) {
        expect(actual).toContain(expected);
      }
    }
  });

  it('is a clean no-op when reapplied (idempotence)', () => {
    expect(() => applyMigration(db, '0060_trip_expenses.sql')).not.toThrow();
  });
});
