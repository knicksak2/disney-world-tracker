/**
 * Real-Postgres concurrency test for Dining_Entry writes (dining-plan-calculator Requirements 4.1, 16.7). pg-mem has one
 * connection and no row locks, so this needs a real database.
 *
 * Creates a throwaway database on the local Postgres (default `postgres://dwt:dwt@localhost:5432/dwt`, override with
 * DATABASE_URL), applies every migration, and races writes through the real repo. Without the Trip row lock two
 * upserts of one empty slot both see it empty and both INSERT, so one fails on `uq_dpe_slot`; and two inserts at 119
 * entries both pass the cap check and leave 121. With the lock the second waits and sees the first's row.
 *
 * Skips cleanly when no database is reachable.
 */

import { randomUUID } from 'node:crypto';

import { DINING_PLAN_ENTRIES_MAX } from '@dwt/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createLiveTestDb, probeDatabase, type LiveTestDb } from '../../../test/liveDbTemplate.js';
import { createDiningPlanRepo } from '../repo.js';
import type { DiningPlanRepo } from '../types.js';

const ROUNDS = 8;
const DB_AVAILABLE = await probeDatabase();

describe.skipIf(!DB_AVAILABLE)('dining entry writes under concurrency (live Postgres)', () => {
  let liveDb: LiveTestDb;
  let pool: pg.Pool;
  let repo: DiningPlanRepo;
  let userId: string;

  beforeAll(async () => {
    liveDb = await createLiveTestDb('dwt_dining_concurrency', { maxConnections: 6 });
    pool = liveDb.pool;
    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'dining-cc@example.com', 'hash')`, [userId]);
    repo = createDiningPlanRepo({ pool: pool as unknown as DbPool });
  }, 180_000);

  afterAll(async () => {
    await liveDb?.cleanup();
  });

  async function newTrip(): Promise<string> {
    const id = randomUUID();
    await pool.query(`INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES ($1, $2, 'CC', '', '2027-03-01', '2027-03-06')`, [id, userId]);
    return id;
  }

  it('two upserts of one empty slot both succeed and leave one row', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const tripId = await newTrip();
      const results = await Promise.allSettled([
        repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'placeholder', experienceId: null, placeholderKind: 'table_service', excludedKeys: [] }),
        repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'placeholder', experienceId: null, placeholderKind: 'quick_service', excludedKeys: [] }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      const rows = await pool.query(`SELECT placeholder_kind FROM trip_dining_plan_entries WHERE trip_id = $1`, [tripId]);
      expect(rows.rowCount).toBe(1);
    }
  }, 120_000);

  it('two inserts at 119 entries leave exactly 120: one succeeds, one gets trip_validation_failed', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const tripId = await newTrip();
      await pool.query(
        `INSERT INTO trip_dining_plan_entries (trip_id, entry_date, meal_period, kind)
         SELECT $1, DATE '2026-01-01' + (g / 3), (ARRAY['breakfast','lunch','dinner'])[(g % 3) + 1], 'skip'
           FROM generate_series(0, $2::int - 2) AS g`,
        [tripId, DINING_PLAN_ENTRIES_MAX],
      );
      const results = await Promise.allSettled([
        repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] }),
        repo.upsertEntry(tripId, { date: '2027-03-03', mealPeriod: 'dinner', kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(rejected.reason).toMatchObject({ code: 'trip_validation_failed' });
      const count = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM trip_dining_plan_entries WHERE trip_id = $1`, [tripId]);
      expect(count.rows[0]!.n).toBe(DINING_PLAN_ENTRIES_MAX);
    }
  }, 120_000);
});
