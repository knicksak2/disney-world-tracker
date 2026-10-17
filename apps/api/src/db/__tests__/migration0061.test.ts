/**
 * Migration test for `0061_trip_booking_timeline.sql`.
 *
 * Validates: Requirements 9.10, 14.1, 14.4, 14.5, 14.6, 14.9, 14.10
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
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const RESORTS_STUB = `
  CREATE TABLE IF NOT EXISTS resorts (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

const EIGHT_OLD_KINDS = [
  'share_delivered',
  'friend_request_received',
  'trip_invite_created',
  'rode_with_tag_created',
  'food_list_shared',
  'food_list_role_changed',
  'experience_list_shared',
  'experience_list_role_changed',
] as const;

describe('migration 0061_trip_booking_timeline', () => {
  let db: IMemoryDb;
  let tripId: string;
  let userId1: string;
  let userId2: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    db.public.none(RESORTS_STUB);
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0056_admin_panel.sql');
    applyMigration(db, '0061_trip_booking_timeline.sql');

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
  });

  it('migration file wraps statements in BEGIN and COMMIT', () => {
    const rawSql = readFileSync(migrationPath('0061_trip_booking_timeline.sql'), 'utf8');
    expect(rawSql).toMatch(/^\s*BEGIN;/m);
    expect(rawSql).toMatch(/^\s*COMMIT;/m);
  });

  it('creates all five tables with expected columns', () => {
    const expectedTables: Record<string, string[]> = {
      trip_booking_settings: ['trip_id', 'stay_type', 'lightning_lane_timing', 'check_in_override', 'updated_at'],
      trip_booking_window_done: ['trip_id', 'window_kind', 'drop_on', 'marked_by', 'marked_at'],
      trip_booking_reminder_mutes: ['trip_id', 'user_id', 'created_at'],
      trip_booking_reminder_log: ['trip_id', 'window_kind', 'drop_at', 'reminder_lead', 'claimed_at'],
      trip_packing_items: [
        'id',
        'trip_id',
        'name',
        'category',
        'quantity',
        'assignee_id',
        'added_by',
        'packed',
        'packed_by',
        'packed_at',
        'created_at',
      ],
    };

    for (const [table, cols] of Object.entries(expectedTables)) {
      expect(db.getTable(table)).toBeDefined();
      const actualCols = db.public
        .many(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`)
        .map((r: Record<string, unknown>) => r.column_name);
      for (const col of cols) {
        expect(actualCols).toContain(col);
      }
    }
  });

  it('enforces check constraints on trip_booking_settings', () => {
    // Valid values (including NULLs)
    db.public.none(`
      INSERT INTO trip_booking_settings (trip_id, stay_type, lightning_lane_timing)
      VALUES ('${tripId}', 'resort', 'seven_day');
    `);

    // Invalid stay_type
    expect(() => {
      db.public.none(`
        UPDATE trip_booking_settings SET stay_type = 'invalid_stay' WHERE trip_id = '${tripId}';
      `);
    }).toThrow();

    // Invalid lightning_lane_timing
    expect(() => {
      db.public.none(`
        UPDATE trip_booking_settings SET lightning_lane_timing = 'invalid_timing' WHERE trip_id = '${tripId}';
      `);
    }).toThrow();
  });

  it('enforces check constraints on trip_booking_window_done', () => {
    // Valid dining
    db.public.none(`
      INSERT INTO trip_booking_window_done (trip_id, window_kind, drop_on, marked_by)
      VALUES ('${tripId}', 'dining', '2026-08-02', '${userId1}');
    `);

    // Invalid window_kind
    expect(() => {
      db.public.none(`
        INSERT INTO trip_booking_window_done (trip_id, window_kind, drop_on, marked_by)
        VALUES ('${tripId}', 'fastpass', '2026-08-02', '${userId1}');
      `);
    }).toThrow();

    // Duplicate PK rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_booking_window_done (trip_id, window_kind, drop_on, marked_by)
        VALUES ('${tripId}', 'dining', '2026-08-02', '${userId2}');
      `);
    }).toThrow();
  });

  it('enforces primary key duplicate rejection on trip_booking_settings and reminder_mutes', () => {
    db.public.none(`
      INSERT INTO trip_booking_settings (trip_id, stay_type)
      VALUES ('${tripId}', 'offsite');
    `);
    expect(() => {
      db.public.none(`
        INSERT INTO trip_booking_settings (trip_id, stay_type)
        VALUES ('${tripId}', 'resort');
      `);
    }).toThrow();

    db.public.none(`
      INSERT INTO trip_booking_reminder_mutes (trip_id, user_id)
      VALUES ('${tripId}', '${userId1}');
    `);
    expect(() => {
      db.public.none(`
        INSERT INTO trip_booking_reminder_mutes (trip_id, user_id)
        VALUES ('${tripId}', '${userId1}');
      `);
    }).toThrow();
  });

  it('enforces check constraints and PK on trip_booking_reminder_log', () => {
    // Valid row
    db.public.none(`
      INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
      VALUES ('${tripId}', 'dining', '2026-08-02T10:00:00Z', 'open');
    `);

    // Duplicate PK rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
        VALUES ('${tripId}', 'dining', '2026-08-02T10:00:00Z', 'open');
      `);
    }).toThrow();

    // Invalid window_kind
    expect(() => {
      db.public.none(`
        INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
        VALUES ('${tripId}', 'other', '2026-08-02T10:00:00Z', 'open');
      `);
    }).toThrow();

    // Invalid reminder_lead
    expect(() => {
      db.public.none(`
        INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
        VALUES ('${tripId}', 'dining', '2026-08-02T10:00:00Z', 'hour');
      `);
    }).toThrow();
  });

  it('enforces check constraints on trip_packing_items', () => {
    // Valid unpacked item
    const itemId1 = randomUUID();
    db.public.none(`
      INSERT INTO trip_packing_items (id, trip_id, name, category, quantity, added_by, packed)
      VALUES ('${itemId1}', '${tripId}', 'Sunscreen', 'toiletries', 2, '${userId1}', false);
    `);

    // Empty/whitespace name rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, added_by)
        VALUES ('${tripId}', '   ', 'toiletries', '${userId1}');
      `);
    }).toThrow();

    // Invalid category rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, added_by)
        VALUES ('${tripId}', 'Hat', 'headwear', '${userId1}');
      `);
    }).toThrow();

    // Quantity bounds: 0 rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, quantity, added_by)
        VALUES ('${tripId}', 'Hat', 'park_gear', 0, '${userId1}');
      `);
    }).toThrow();

    // Quantity bounds: 100 rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, quantity, added_by)
        VALUES ('${tripId}', 'Hat', 'park_gear', 100, '${userId1}');
      `);
    }).toThrow();

    // Packed state consistency: packed=true with packed_at NULL rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, added_by, packed, packed_at)
        VALUES ('${tripId}', 'Hat', 'park_gear', '${userId1}', true, NULL);
      `);
    }).toThrow();

    // Packed state consistency: packed=false with non-null packed_by or packed_at rejected
    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, added_by, packed, packed_by)
        VALUES ('${tripId}', 'Hat', 'park_gear', '${userId1}', false, '${userId1}');
      `);
    }).toThrow();

    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, added_by, packed, packed_at)
        VALUES ('${tripId}', 'Hat', 'park_gear', '${userId1}', false, now());
      `);
    }).toThrow();

    // Valid packed item
    expect(() => {
      db.public.none(`
        INSERT INTO trip_packing_items (trip_id, name, category, added_by, packed, packed_by, packed_at)
        VALUES ('${tripId}', 'Hat', 'park_gear', '${userId1}', true, '${userId1}', now());
      `);
    }).not.toThrow();
  });

  it('creates required indexes', () => {
    const reminderLogIndices = db.getTable('trip_booking_reminder_log').listIndices().map((i) => i.name);
    expect(reminderLogIndices).toContain('trip_booking_reminder_log_drop_at_idx');

    const packingIndices = db.getTable('trip_packing_items').listIndices().map((i) => i.name);
    expect(packingIndices).toContain('trip_packing_items_trip_idx');
  });

  it('cascades deletion on trip deletion for all five tables', () => {
    // Populate one row in each of the 5 tables
    db.public.none(`
      INSERT INTO trip_booking_settings (trip_id, stay_type)
      VALUES ('${tripId}', 'resort');

      INSERT INTO trip_booking_window_done (trip_id, window_kind, drop_on, marked_by)
      VALUES ('${tripId}', 'dining', '2026-08-02', '${userId1}');

      INSERT INTO trip_booking_reminder_mutes (trip_id, user_id)
      VALUES ('${tripId}', '${userId1}');

      INSERT INTO trip_booking_reminder_log (trip_id, window_kind, drop_at, reminder_lead)
      VALUES ('${tripId}', 'dining', '2026-08-02T10:00:00Z', 'open');

      INSERT INTO trip_packing_items (trip_id, name, category, added_by)
      VALUES ('${tripId}', 'Ponchos', 'park_gear', '${userId1}');
    `);

    expect(db.public.many(`SELECT * FROM trip_booking_settings WHERE trip_id = '${tripId}'`)).toHaveLength(1);
    expect(db.public.many(`SELECT * FROM trip_booking_window_done WHERE trip_id = '${tripId}'`)).toHaveLength(1);
    expect(db.public.many(`SELECT * FROM trip_booking_reminder_mutes WHERE trip_id = '${tripId}'`)).toHaveLength(1);
    expect(db.public.many(`SELECT * FROM trip_booking_reminder_log WHERE trip_id = '${tripId}'`)).toHaveLength(1);
    expect(db.public.many(`SELECT * FROM trip_packing_items WHERE trip_id = '${tripId}'`)).toHaveLength(1);

    // Delete trip
    db.public.none(`DELETE FROM trips WHERE id = '${tripId}';`);

    expect(db.public.many(`SELECT * FROM trip_booking_settings WHERE trip_id = '${tripId}'`)).toHaveLength(0);
    expect(db.public.many(`SELECT * FROM trip_booking_window_done WHERE trip_id = '${tripId}'`)).toHaveLength(0);
    expect(db.public.many(`SELECT * FROM trip_booking_reminder_mutes WHERE trip_id = '${tripId}'`)).toHaveLength(0);
    expect(db.public.many(`SELECT * FROM trip_booking_reminder_log WHERE trip_id = '${tripId}'`)).toHaveLength(0);
    expect(db.public.many(`SELECT * FROM trip_packing_items WHERE trip_id = '${tripId}'`)).toHaveLength(0);
  });

  it('updates push_delivery_log_kind_chk: accepts trip_booking_reminder, rejects unknown, retains all 8 old kinds', () => {
    // 1. Accepts trip_booking_reminder
    expect(() => {
      db.public.none(`
        INSERT INTO push_delivery_log (user_id, status, notification_kind)
        VALUES ('${userId1}', 'ok', 'trip_booking_reminder');
      `);
    }).not.toThrow();

    // 2. Rejects unknown kind
    expect(() => {
      db.public.none(`
        INSERT INTO push_delivery_log (user_id, status, notification_kind)
        VALUES ('${userId1}', 'ok', 'not_a_kind');
      `);
    }).toThrow();

    // 3. Every one of the eight old kinds is still accepted
    for (const oldKind of EIGHT_OLD_KINDS) {
      expect(() => {
        db.public.none(`
          INSERT INTO push_delivery_log (user_id, status, notification_kind)
          VALUES ('${userId1}', 'ok', '${oldKind}');
        `);
      }).not.toThrow();
    }
  });

  it('is idempotent on reapply (reapplying does not throw and leaves rows intact)', () => {
    db.public.none(`
      INSERT INTO trip_booking_settings (trip_id, stay_type)
      VALUES ('${tripId}', 'resort');
    `);

    expect(() => applyMigration(db, '0061_trip_booking_timeline.sql')).not.toThrow();

    const rows = db.public.many(`SELECT * FROM trip_booking_settings WHERE trip_id = '${tripId}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.stay_type).toBe('resort');
  });
});
