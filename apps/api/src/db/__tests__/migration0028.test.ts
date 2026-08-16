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
  '0027_planned_items_soft_windows.sql',
  '0028_planned_items_meal_period_snack.sql',
];

describe('migration 0028_planned_items_meal_period_snack', () => {
  let db: IMemoryDb;
  let tripId: string;
  let userId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }

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

  it('accepts breakfast, lunch, dinner, and snack meal periods', () => {
    for (const period of ['breakfast', 'lunch', 'dinner', 'snack']) {
      const itemId = randomUUID();
      expect(() => {
        db.public.none(`
          INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, meal_period)
          VALUES ('${itemId}', '${tripId}', '${userId}', NULL, 'break', '${period}');
        `);
      }).not.toThrow();

      const row = db.public.one(
        `SELECT meal_period FROM planned_items WHERE id = '${itemId}'`
      ) as any;
      expect(row.meal_period).toBe(period);
    }
  });

  it('accepts NULL meal_period', () => {
    const itemId = randomUUID();
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, meal_period)
        VALUES ('${itemId}', '${tripId}', '${userId}', NULL, 'break', NULL);
      `);
    }).not.toThrow();

    const row = db.public.one(
      `SELECT meal_period FROM planned_items WHERE id = '${itemId}'`
    ) as any;
    expect(row.meal_period).toBeNull();
  });

  it('rejects invalid meal_period values via chk_planned_items_meal_period', () => {
    for (const invalid of ['brunch', 'midnight_snack', 'supper', 'SNACK']) {
      const itemId = randomUUID();
      expect(() => {
        db.public.none(`
          INSERT INTO planned_items (id, trip_id, added_by, experience_id, item_type, meal_period)
          VALUES ('${itemId}', '${tripId}', '${userId}', NULL, 'break', '${invalid}');
        `);
      }).toThrow();
    }
  });

  it('allows snack with null window columns (R2.8)', () => {
    const itemId = randomUUID();
    expect(() => {
      db.public.none(`
        INSERT INTO planned_items (
          id, trip_id, added_by, experience_id, item_type, meal_period,
          window_start_minutes, window_end_minutes
        )
        VALUES ('${itemId}', '${tripId}', '${userId}', NULL, 'break', 'snack', NULL, NULL);
      `);
    }).not.toThrow();

    const row = db.public.one(
      `SELECT meal_period, window_start_minutes, window_end_minutes FROM planned_items WHERE id = '${itemId}'`
    ) as any;
    expect(row.meal_period).toBe('snack');
    expect(row.window_start_minutes).toBeNull();
    expect(row.window_end_minutes).toBeNull();
  });
});
