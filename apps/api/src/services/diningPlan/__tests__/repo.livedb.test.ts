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
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DINING_PLAN_ENTRIES_MAX } from '@dwt/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createDiningPlanRepo } from '../repo.js';
import type { DiningPlanRepo } from '../types.js';

const { Pool } = pg;
const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';
const ROUNDS = 8;

async function probeDatabase(): Promise<boolean> {
  const probe = new Pool({ connectionString: BASE_DATABASE_URL, connectionTimeoutMillis: 2_000, max: 1 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const DB_AVAILABLE = await probeDatabase();
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'migrations');

function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

describe.skipIf(!DB_AVAILABLE)('dining entry writes under concurrency (live Postgres)', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let dbName: string;
  let repo: DiningPlanRepo;
  let userId: string;

  beforeAll(async () => {
    dbName = `dwt_dining_concurrency_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${dbName}`);
    pool = new Pool({ connectionString: withDatabaseName(BASE_DATABASE_URL, dbName), max: 6 });
    const files = readdirSync(MIGRATIONS_DIR).filter((n) => /^\d{4}_.+\.sql$/iu.test(n)).sort((a, b) => a.localeCompare(b));
    for (const name of files) await pool.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'dining-cc@example.com', 'hash')`, [userId]);
    repo = createDiningPlanRepo({ pool: pool as unknown as DbPool });
  }, 180_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    if (admin && dbName) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
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
