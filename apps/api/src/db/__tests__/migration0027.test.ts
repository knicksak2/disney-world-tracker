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
  db.public.none(sql);
}

const BASE_MIGRATIONS = [
  '0001_init.sql',
  '0015_trips.sql',
  '0019_planned_item_scheduling.sql',
  '0024_planned_item_optimization_result.sql',
];

describe('migration 0027_planned_items_soft_windows', () => {
  let db: IMemoryDb;
  let tripId: string;
  let userId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
    applyMigration(db, '0027_planned_items_soft_windows.sql');

    userId = randomUUID();
    tripId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${userId}', 'alice@example.com', 'hash123');
      INSERT INTO profiles (user_id, display_name)
      VALUES ('${userId}', 'Alice');
    `);

    db.public.none(`
      INSERT INTO trips (id, creator_id, name, start_date, end_date)
      VALUES ('${tripId}', '${userId}', 'Family Trip', '2026-10-01', '2026-10-05');
    `);
  });

  it('adds the soft-window, meal-period, custom-title, and scheduled-showtime columns', () => {
    const res = db.public.many(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'planned_items'
        AND column_name IN (
          'custom_title',
          'window_start_minutes',
          'window_end_minutes',
          'meal_period',
          'scheduled_showtime'
        );
    `);
    const cols = new Set(res.map((r: any) => r.column_name));
    expect(cols.has('custom_title')).toBe(true);
    expect(cols.has('window_start_minutes')).toBe(true);
    expect(cols.has('window_end_minutes')).toBe(true);
    expect(cols.has('meal_period')).toBe(true);
    expect(cols.has('scheduled_showtime')).toBe(true);
  });

  it('allows inserting an unlocated break with experience_id = NULL and custom_title', () => {
    const itemId = randomUUID();
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, custom_title)
        VALUES ('${itemId}', '${tripId}', '${userId}', NULL, 'break', 'Afternoon Pool Break');
      `);
    }).not.toThrow();

    const row = db.public.one(`SELECT experience_id, item_type, custom_title FROM planned_items WHERE id = '${itemId}'`) as any;
    expect(row.experience_id).toBeNull();
    expect(row.item_type).toBe('break');
    expect(row.custom_title).toBe('Afternoon Pool Break');
  });

  it('enforces window_both_or_neither CHECK constraint', () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    // Start with null end fails
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, window_start_minutes, window_end_minutes)
        VALUES ('${id1}', '${tripId}', '${userId}', NULL, 'break', 600, NULL);
      `);
    }).toThrow();

    // End with null start fails
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, window_start_minutes, window_end_minutes)
        VALUES ('${id2}', '${tripId}', '${userId}', NULL, 'break', NULL, 720);
      `);
    }).toThrow();
  });

  it('enforces window_range CHECK constraint (0..1440 and end >= start)', () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    // end < start fails
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, window_start_minutes, window_end_minutes)
        VALUES ('${id1}', '${tripId}', '${userId}', NULL, 'break', 700, 600);
      `);
    }).toThrow();

    // start < 0 fails
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, window_start_minutes, window_end_minutes)
        VALUES ('${id2}', '${tripId}', '${userId}', NULL, 'break', -10, 600);
      `);
    }).toThrow();
  });

  it('enforces meal_period CHECK constraint', () => {
    const validId = randomUUID();
    const invalidId = randomUUID();

    // Valid meal_period succeeds
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, meal_period)
        VALUES ('${validId}', '${tripId}', '${userId}', NULL, 'break', 'lunch');
      `);
    }).not.toThrow();

    // Invalid meal_period fails
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, meal_period)
        VALUES ('${invalidId}', '${tripId}', '${userId}', NULL, 'break', 'brunch');
      `);
    }).toThrow();
  });
});
