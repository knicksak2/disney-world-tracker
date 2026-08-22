import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
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
  const raw = base as unknown as {
    query: (text: string, params?: unknown[]) => Promise<unknown>;
    connect: () => Promise<{
      query: (text: string, params?: unknown[]) => Promise<unknown>;
      release: () => void;
    }>;
  };
  const strip = (text: string): string =>
    text.replace(/\bFOR UPDATE(?:\s+OF\s+\w+)?/gi, '');
  return {
    query: (text: string, params?: unknown[]) => raw.query(strip(text), params),
    async connect() {
      const client = await raw.connect();
      return {
        query: (text: string, params?: unknown[]) =>
          client.query(strip(text), params),
        release: () => client.release(),
      };
    },
  } as unknown as DbPool;
}

const NOOP_DEPS = {
  completions: {},
  ratings: {},
} as unknown as TripRepoDeps;

async function seedUser(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'hash')`,
    [id, `${name.toLowerCase()}@example.com`],
  );
  await pool.query(
    `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
    [id, name],
  );
  return id;
}

async function seedExperience(pool: DbPool, name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ($1, $2, $3, 'Magic Kingdom', 'Ride')`,
    [id, `up-${id}`, name],
  );
  return id;
}

const VALID_TRIP = {
  name: 'Timing Rules Trip',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
};

describe('Planned_Item Timing Modes & Mutual Exclusion (integration, pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: TripRepo;
  let user: string;
  let expId: string;
  let tripId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applyMigration(db, '0001_init.sql');
    db.public.none("ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';");
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0019_planned_item_scheduling.sql');
    applyMigration(db, '0022_planned_item_ride_options.sql');
    applyMigration(db, '0023_trip_touring_hours.sql');
    applyMigration(db, '0024_planned_item_optimization_result.sql');
    applyMigration(db, '0027_planned_items_soft_windows.sql');
    applyMigration(db, '0028_planned_items_meal_period_snack.sql');
  applyMigration(db, '0031_planned_item_reservations.sql');

    const { Pool: PgMemPool } = db.adapters.createPg();
    const rawPool = new PgMemPool() as unknown as DbPool;
    pool = withForUpdateCompat(rawPool);
    repo = createTripRepo(pool, NOOP_DEPS);
    user = await seedUser(pool, 'Organizer');
    expId = await seedExperience(pool, 'Space Mountain');
    const trip = await repo.createTrip(user, { ...VALID_TRIP });
    tripId = trip.id;
  });

  it('Shape 1: leaves timing fields intact on a metadata-only edit (e.g. priority change)', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: '2026-10-01T14:00:00.000Z',
      isFixed: true,
      priority: 2,
    });

    expect(item.plannedTime).toBe('2026-10-01T14:00:00.000Z');
    expect(item.isFixed).toBe(true);

    const edited = await repo.editPlannedItem(tripId, item.id, {
      priority: 1,
      customTitle: 'Updated Ride Title',
    });

    // Priority and custom title updated
    expect(edited.priority).toBe(1);
    expect(edited.customTitle).toBe('Updated Ride Title');
    // Stored timing fields are preserved
    expect(edited.plannedTime).toBe('2026-10-01T14:00:00.000Z');
    expect(edited.isFixed).toBe(true);
    expect(edited.windowStartMinutes).toBeNull();
    expect(edited.windowEndMinutes).toBeNull();
    expect(edited.mealPeriod).toBeNull();

    // Verify DB persistence
    const [persisted] = await repo.listPlannedItems(tripId);
    expect(persisted!.plannedTime).toBe('2026-10-01T14:00:00.000Z');
    expect(persisted!.isFixed).toBe(true);
  });

  it('Shape 2: switches from Soft Window to Exact Time Mode and clears window fields', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      windowStartMinutes: 690,
      windowEndMinutes: 870,
      mealPeriod: 'lunch',
    });

    expect(item.windowStartMinutes).toBe(690);
    expect(item.mealPeriod).toBe('lunch');

    const edited = await repo.editPlannedItem(tripId, item.id, {
      plannedTime: '2026-10-01T12:30:00.000Z',
      isFixed: true,
    });

    expect(edited.plannedTime).toBe('2026-10-01T12:30:00.000Z');
    expect(edited.isFixed).toBe(true);
    expect(edited.windowStartMinutes).toBeNull();
    expect(edited.windowEndMinutes).toBeNull();
    expect(edited.mealPeriod).toBeNull();
  });

  it('Shape 3: switches to Lightning Lane Mode (is_fixed = false) and clears window fields', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      windowStartMinutes: 600,
      windowEndMinutes: 720,
    });

    const edited = await repo.editPlannedItem(tripId, item.id, {
      isLightningLane: true,
      plannedTime: '2026-10-01T10:00:00.000Z',
    });

    expect(edited.plannedTime).toBe('2026-10-01T10:00:00.000Z');
    expect(edited.isLightningLane).toBe(true);
    expect(edited.isFixed).toBe(false);
    expect(edited.windowStartMinutes).toBeNull();
    expect(edited.windowEndMinutes).toBeNull();
    expect(edited.mealPeriod).toBeNull();
  });

  it('Shape 4: switches from Exact Time to Soft Window Mode and clears exact time', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: '2026-10-01T18:00:00.000Z',
      isFixed: true,
    });

    const edited = await repo.editPlannedItem(tripId, item.id, {
      windowStartMinutes: 1020,
      windowEndMinutes: 1260,
      mealPeriod: 'dinner',
    });

    expect(edited.windowStartMinutes).toBe(1020);
    expect(edited.windowEndMinutes).toBe(1260);
    expect(edited.mealPeriod).toBe('dinner');
    expect(edited.plannedTime).toBeNull();
    expect(edited.isFixed).toBe(false);
  });

  it('Shape 5: Selective Window Clear leaves exact time untouched', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      plannedTime: '2026-10-01T14:00:00.000Z',
      isFixed: true,
    });

    const edited = await repo.editPlannedItem(tripId, item.id, {
      windowStartMinutes: null,
      windowEndMinutes: null,
    });

    expect(edited.windowStartMinutes).toBeNull();
    expect(edited.windowEndMinutes).toBeNull();
    expect(edited.mealPeriod).toBeNull();
    expect(edited.plannedTime).toBe('2026-10-01T14:00:00.000Z');
    expect(edited.isFixed).toBe(true);
  });

  it('Shape 6: Selective Exact Time Clear leaves window fields untouched', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      windowStartMinutes: 480,
      windowEndMinutes: 660,
      mealPeriod: 'breakfast',
    });

    const edited = await repo.editPlannedItem(tripId, item.id, {
      plannedTime: null,
    });

    expect(edited.plannedTime).toBeNull();
    expect(edited.isFixed).toBe(false);
    expect(edited.windowStartMinutes).toBe(480);
    expect(edited.windowEndMinutes).toBe(660);
    expect(edited.mealPeriod).toBe('breakfast');
  });

  it('Shape 7: Explicit Any Time Clear resets all timing fields', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      windowStartMinutes: 480,
      windowEndMinutes: 660,
      mealPeriod: 'breakfast',
    });

    const edited = await repo.editPlannedItem(tripId, item.id, {
      plannedTime: null,
      isFixed: false,
      windowStartMinutes: null,
      windowEndMinutes: null,
    });

    expect(edited.plannedTime).toBeNull();
    expect(edited.isFixed).toBe(false);
    expect(edited.windowStartMinutes).toBeNull();
    expect(edited.windowEndMinutes).toBeNull();
    expect(edited.mealPeriod).toBeNull();
  });

  it('Unlocated Break Integrity: rejects changing itemType away from break on unlocated items', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: null,
      itemType: 'break',
      customTitle: 'Midday Resort Rest',
    });

    expect(item.experienceId).toBeNull();
    expect(item.itemType).toBe('break');
    expect(item.customTitle).toBe('Midday Resort Rest');

    await expect(
      repo.editPlannedItem(tripId, item.id, { itemType: 'experience' }),
    ).rejects.toThrow();
  });

  it('Snack meal period: adds item with meal_period snack and null window columns (R2.8)', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      mealPeriod: 'snack',
    });

    expect(item.mealPeriod).toBe('snack');
    expect(item.windowStartMinutes).toBeNull();
    expect(item.windowEndMinutes).toBeNull();
  });

  it('Snack with custom window: retains custom window bounds (R2.8)', async () => {
    const item = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      mealPeriod: 'snack',
      windowStartMinutes: 900,
      windowEndMinutes: 960,
    });

    expect(item.mealPeriod).toBe('snack');
    expect(item.windowStartMinutes).toBe(900);
    expect(item.windowEndMinutes).toBe(960);
  });

  it('Meal Period Preference Presets: derives updated preference bounds (R2.8)', async () => {
    const breakfast = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      mealPeriod: 'breakfast',
    });
    expect(breakfast.windowStartMinutes).toBe(480);
    expect(breakfast.windowEndMinutes).toBe(630);

    const lunch = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      mealPeriod: 'lunch',
    });
    expect(lunch.windowStartMinutes).toBe(690);
    expect(lunch.windowEndMinutes).toBe(840);

    const dinner = await repo.addPlannedItem(tripId, user, {
      experienceId: expId,
      plannedDate: '2026-10-01',
      mealPeriod: 'dinner',
    });
    expect(dinner.windowStartMinutes).toBe(1020);
    expect(dinner.windowEndMinutes).toBe(1200);
  });
});
