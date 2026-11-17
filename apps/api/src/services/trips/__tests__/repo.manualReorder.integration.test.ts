/**
 * Integration tests for `reorderDayPlannedItems` on the real `createTripRepo`
 * against `pg-mem` (day-planning-optimization R12.1, R12.2, Property 26).
 *
 * Validates: Requirements 12.1, 12.2
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

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
    implementation: (s: unknown): string =>
      typeof s === 'string' ? s.toLowerCase() : '',
  });
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

function withForUpdateCompat(base: DbPool): DbPool {
  const wrapQuery =
    (q: DbPool['query']): DbPool['query'] =>
    (sql: any, params?: any) => {
      if (typeof sql === 'string') {
        return q(sql.replace(/\s+FOR\s+UPDATE\b/gi, ''), params);
      }
      if (sql && typeof sql.text === 'string') {
        return q(
          { ...sql, text: sql.text.replace(/\s+FOR\s+UPDATE\b/gi, '') },
          params,
        );
      }
      return q(sql, params);
    };

  return {
    query: wrapQuery(base.query.bind(base)),
    connect: async () => {
      const client = await base.connect();
      return {
        query: wrapQuery(client.query.bind(client)),
        release: client.release.bind(client),
      };
    },
  } as unknown as DbPool;
}

const MIGRATIONS = [
  '0001_init.sql',
  '0013_avatar_presets.sql',
  '0015_trips.sql',
  '0019_planned_item_scheduling.sql',
  '0022_planned_item_ride_options.sql',
  '0023_trip_touring_hours.sql',
  '0024_planned_item_optimization_result.sql',
  '0027_planned_items_soft_windows.sql',
  '0028_planned_items_meal_period_snack.sql',
  '0031_planned_item_reservations.sql',
  '0045_trip_walk_wait_weighting.sql',
  '0064_account_deletion.sql',
  '0077_planned_items_sort_order.sql',
];

const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

describe('repo.reorderDayPlannedItems (R12.1, R12.2, Property 26)', () => {
  let db: IMemoryDb;
  let repo: TripRepo;
  let userId: string;
  let tripId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    db.public.none("ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';");
    for (const m of MIGRATIONS.slice(1)) applyMigration(db, m);
    const { Pool } = db.adapters.createPg();
    const pool = withForUpdateCompat(new Pool() as unknown as DbPool);
    repo = createTripRepo(pool, NOOP_DEPS);

    userId = randomUUID();
    tripId = randomUUID();
    db.public.none(`
      INSERT INTO users (id, email, password_hash) VALUES ('${userId}', 'u@example.com', 'h');
      INSERT INTO profiles (user_id, display_name) VALUES ('${userId}', 'Alice');
      INSERT INTO trips (id, creator_id, name, start_date, end_date)
      VALUES ('${tripId}', '${userId}', 'WDW', '2026-12-15', '2026-12-17');
    `);
  });

  it('persists sort_order, returns items in requested order, clears optimization & flexible times, preserves fixed times', async () => {
    const a = await repo.addPlannedItem(tripId, userId, {
      itemType: 'break',
      customTitle: 'First Added',
      plannedDate: '2026-12-15',
      isFixed: false,
      durationMinutes: 30,
    });
    const b = await repo.addPlannedItem(tripId, userId, {
      itemType: 'break',
      customTitle: 'Second Added (Fixed)',
      plannedDate: '2026-12-15',
      plannedTime: '2026-12-15T17:00:00.000Z',
      isFixed: true,
      durationMinutes: 60,
    });
    const c = await repo.addPlannedItem(tripId, userId, {
      itemType: 'break',
      customTitle: 'Third Added',
      plannedDate: '2026-12-15',
      isFixed: false,
      durationMinutes: 30,
    });

    await repo.updatePlannedItemTimes(tripId, [
      {
        itemId: a.id,
        plannedTime: '2026-12-15T14:00:00.000Z',
        predictedWaitMinutes: 25,
        travelFromPrev: { kind: 'walk', minutes: 4 },
      },
      {
        itemId: b.id,
        plannedTime: '2026-12-15T17:00:00.000Z',
        predictedWaitMinutes: 0,
        travelFromPrev: { kind: 'walk', minutes: 5 },
      },
      {
        itemId: c.id,
        plannedTime: '2026-12-15T18:30:00.000Z',
        predictedWaitMinutes: 15,
        travelFromPrev: { kind: 'walk', minutes: 6 },
      },
    ]);

    const reordered = await repo.reorderDayPlannedItems(tripId, '2026-12-15', [
      c.id,
      a.id,
      b.id,
    ]);

    expect(reordered.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
    expect(reordered.map((i) => i.sortOrder)).toEqual([0, 1, 2]);
    // Optimization outputs cleared across all reordered items
    for (const item of reordered) {
      expect(item.optimizedAt).toBeNull();
      expect(item.predictedWaitMinutes).toBeNull();
      expect(item.travelFromPrev).toBeNull();
      expect(item.scheduledShowtime).toBeNull();
    }
    // Flexible items cleared plannedTime; fixed item preserved plannedTime
    expect(reordered.find((i) => i.id === c.id)?.plannedTime).toBeNull();
    expect(reordered.find((i) => i.id === a.id)?.plannedTime).toBeNull();
    expect(reordered.find((i) => i.id === b.id)?.plannedTime).toBe('2026-12-15T17:00:00.000Z');
  });

  it('rejects duplicate IDs or IDs from another date without mutating rows', async () => {
    const a = await repo.addPlannedItem(tripId, userId, {
      itemType: 'break',
      customTitle: 'Day 1 Item',
      plannedDate: '2026-12-15',
      durationMinutes: 30,
    });
    const otherDay = await repo.addPlannedItem(tripId, userId, {
      itemType: 'break',
      customTitle: 'Day 2 Item',
      plannedDate: '2026-12-16',
      durationMinutes: 30,
    });

    await expect(
      repo.reorderDayPlannedItems(tripId, '2026-12-15', [a.id, a.id]),
    ).rejects.toBeInstanceOf(AppError);

    await expect(
      repo.reorderDayPlannedItems(tripId, '2026-12-15', [a.id, otherDay.id]),
    ).rejects.toBeInstanceOf(AppError);

    const items = await repo.listPlannedItems(tripId);
    expect(items.find((i) => i.id === a.id)?.sortOrder).toBeNull();
  });
});
