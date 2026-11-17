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
  '0077_planned_items_sort_order.sql',
];

describe('migration 0077_planned_items_sort_order', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const m of BASE_MIGRATIONS) {
      applyMigration(db, m);
    }
  });

  it('adds nullable sort_order to planned_items and is idempotent on reapply', () => {
    applyMigration(db, '0077_planned_items_sort_order.sql');

    const userId = randomUUID();
    const tripId = randomUUID();
    const itemA = randomUUID();
    const itemB = randomUUID();

    db.public.none(
      `INSERT INTO users (id, email, password_hash) VALUES ('${userId}', 'a@b.com', 'hash')`,
    );
    db.public.none(
      `INSERT INTO trips (id, creator_id, name, start_date, end_date) VALUES ('${tripId}', '${userId}', 'Test Trip', '2026-12-15', '2026-12-17')`,
    );
    db.public.none(
      `INSERT INTO planned_items (id, trip_id, added_by, item_type, custom_title, planned_date, sort_order)
       VALUES ('${itemA}', '${tripId}', '${userId}', 'break', 'Coffee', '2026-12-15', NULL)`,
    );
    db.public.none(
      `INSERT INTO planned_items (id, trip_id, added_by, item_type, custom_title, planned_date, sort_order)
       VALUES ('${itemB}', '${tripId}', '${userId}', 'break', 'Lunch', '2026-12-15', 0)`,
    );

    const rows = db.public.many(
      `SELECT id, sort_order FROM planned_items WHERE trip_id = '${tripId}' ORDER BY COALESCE(sort_order, 2147483647) ASC, created_at ASC, id ASC`,
    ) as Array<{ id: string; sort_order: number | null }>;
    expect(rows).toEqual([
      { id: itemB, sort_order: 0 },
      { id: itemA, sort_order: null },
    ]);
  });
});
