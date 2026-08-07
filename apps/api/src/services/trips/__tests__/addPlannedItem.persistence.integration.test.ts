// Feature: day-planning-optimization — addPlannedItem SQL Persistence Regression Test
/**
 * Integration test verifying that `addPlannedItem` persists all scheduling,
 * queue, priority, category, and duration fields into the database via SQL `INSERT`.
 *
 * Validates: Requirements 4.2, 4.4, 9.1
 *
 * Strategy:
 *  Applies production DDL migrations (0001, 0015, 0019, 0022) to an in-memory
 *  Postgres instance (`pg-mem`), creates a real `TripRepo` instance, seeds a User,
 *  an Experience, and a Trip, and invokes `addPlannedItem` with all fields set:
 *  - plannedDate
 *  - plannedTime
 *  - isFixed
 *  - isLightningLane
 *  - useSingleRider
 *  - priority
 *  - itemType
 *  - durationMinutes
 *
 *  Then reads the item back directly from the database and via the repository DTO
 *  projection to ensure no columns are dropped from the SQL INSERT statement.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createCompletionRepo } from '../../tracking/completion/repo.js';
import { createRatingRepo } from '../../tracking/rating/repo.js';
import { createTripRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// pg-mem setup
// ---------------------------------------------------------------------------

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
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyInitMigration(db: IMemoryDb): void {
  let sql = readFileSync(migrationPath('0001_init.sql'), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

function applyMigration(db: IMemoryDb, name: string): void {
  const sql = readFileSync(migrationPath(name), 'utf8');
  db.public.none(sql);
}

function stripForUpdate(text: string): string {
  return text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
}

function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      return raw.query(stripForUpdate(text), params);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(stripForUpdate(text), params);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('addPlannedItem — SQL INSERT persistence regression test', () => {
  it('persists all scheduling, queue, and category fields on INSERT without dropping columns', async () => {
    const memDb = buildPgMemDatabase();
    applyInitMigration(memDb);
    applyMigration(memDb, '0015_trips.sql');
    applyMigration(memDb, '0019_planned_item_scheduling.sql');
    applyMigration(memDb, '0022_planned_item_ride_options.sql');
    applyMigration(memDb, '0023_trip_touring_hours.sql');
    applyMigration(memDb, '0024_planned_item_optimization_result.sql');

    const { Pool } = memDb.adapters.createPg();
    const rawPool = new Pool() as unknown as DbPool;
    const pool = withForUpdateCompat(rawPool);
    const completions = createCompletionRepo(pool);
    const ratings = createRatingRepo({ pool, emitRatingChanged: async () => {} });
    const repo = createTripRepo(pool, { completions, ratings });

    // 1. Seed User & Profile
    const userId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`,
      [userId, 'test@example.com', 'hash'],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`,
      [userId, 'Test Explorer'],
    );

    // 2. Seed Experience in Catalog
    const experienceId = randomUUID();
    await pool.query(
      `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
       VALUES ($1, $2, $3, $4, $5)`,
      [experienceId, `upstream-${experienceId}`, 'Space Mountain', 'Magic Kingdom', 'Ride'],
    );

    // 3. Seed Trip
    const trip = await repo.createTrip(userId, {
      name: 'Disney 2026',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
    });

    // 4. Call addPlannedItem with all scheduling & queue fields set
    const input = {
      experienceId,
      plannedDate: '2026-10-01',
      plannedTime: '2026-10-01T10:30:00.000Z',
      isFixed: true,
      isLightningLane: true,
      useSingleRider: true,
      priority: 1 as const,
      itemType: 'break' as const,
      durationMinutes: 45,
    };

    const createdDto = await repo.addPlannedItem(trip.id, userId, input);

    // 5. Assert returned DTO has all fields preserved
    expect(createdDto.experienceId).toBe(experienceId);
    expect(createdDto.isFixed).toBe(true);
    expect(createdDto.isLightningLane).toBe(true);
    expect(createdDto.useSingleRider).toBe(true);
    expect(createdDto.priority).toBe(1);
    expect(createdDto.itemType).toBe('break');
    expect(createdDto.durationMinutes).toBe(45);
    expect(new Date(createdDto.plannedDate!).toISOString()).toContain('2026-10-01');
    expect(new Date(createdDto.plannedTime!).toISOString()).toBe('2026-10-01T10:30:00.000Z');

    // 6. Direct SQL query against database table to prove actual columns were persisted
    const dbRowRes = await pool.query<{
      planned_date: string | Date;
      planned_time: string | Date;
      is_fixed: boolean;
      is_lightning_lane: boolean;
      use_single_rider: boolean;
      priority: number;
      item_type: string;
      duration_minutes: number;
    }>(
      `SELECT planned_date, planned_time, is_fixed, is_lightning_lane, use_single_rider, priority, item_type, duration_minutes
         FROM planned_items
        WHERE id = $1`,
      [createdDto.id],
    );

    expect(dbRowRes.rows[0]).toBeDefined();
    const row = dbRowRes.rows[0]!;
    expect(new Date(row.planned_date).toISOString()).toContain('2026-10-01');
    expect(new Date(row.planned_time).toISOString()).toBe('2026-10-01T10:30:00.000Z');
    expect(row.is_fixed).toBe(true);
    expect(row.is_lightning_lane).toBe(true);
    expect(row.use_single_rider).toBe(true);
    expect(row.priority).toBe(1);
    expect(row.item_type).toBe('break');
    expect(row.duration_minutes).toBe(45);
  });
});
