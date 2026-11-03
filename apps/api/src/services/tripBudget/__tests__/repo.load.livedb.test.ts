/**
 * Feature: trip-budget, Requirement 17.2, 20.6
 *
 * Real-SQL integration test against local Postgres for:
 * - loadBudget over real Postgres driver
 * - verifying string-typed numerics from SUM() and BIGINT columns are converted to numbers
 * - verifying actuals net of refunds is computed numerically
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { createTripBudgetRepo } from '../repo.js';

const { Pool } = pg;

const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';

async function probeDatabase(): Promise<boolean> {
  const probe = new Pool({
    connectionString: BASE_DATABASE_URL,
    connectionTimeoutMillis: 2_000,
    max: 1,
  });
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

function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations');
}

async function applyAllMigrations(pool: DbPool): Promise<void> {
  const dir = migrationsDir();
  const files = readdirSync(dir)
    .filter((name) => /^\d{4,}_.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const client = await pool.connect();
  try {
    for (const name of files) {
      await client.query(readFileSync(join(dir, name), 'utf8'));
    }
  } finally {
    client.release();
  }
}

describe.skipIf(!DB_AVAILABLE)('TripBudgetRepo.loadBudget (live Postgres)', () => {
  let adminPool: DbPool;
  let testPool: DbPool;
  let testDbName: string;

  beforeAll(async () => {
    testDbName = `dwt_budget_load_${randomUUID().replace(/-/g, '')}`;
    adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
    await adminPool.query(`CREATE DATABASE ${testDbName}`);

    testPool = new Pool({
      connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
      max: 5,
    });
    await applyAllMigrations(testPool);
  }, 120_000);

  afterAll(async () => {
    await testPool?.end().catch(() => {});
    if (adminPool) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`).catch(() => {});
      await adminPool.end().catch(() => {});
    }
  });

  it('parses node-pg string-typed numerics from SUM() to numbers and computes net refunds numerically', async () => {
    const organizerId = randomUUID();
    const memberId = randomUUID();
    const tripId = randomUUID();

    // 1. Seed users, trip, memberships
    await testPool.query(
      `INSERT INTO users (id, email, password_hash, deletion_state)
       VALUES ($1, 'org@example.com', 'h1', 'active'),
              ($2, 'mem@example.com', 'h2', 'active')`,
      [organizerId, memberId],
    );
    await testPool.query(
      `INSERT INTO profiles (user_id, display_name)
       VALUES ($1, 'Organizer'), ($2, 'Member')`,
      [organizerId, memberId],
    );
    await testPool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
       VALUES ($1, $2, 'Disney 2026', 'Vacation', '2026-10-01', '2026-10-10')`,
      [tripId, organizerId],
    );
    await testPool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'), ($1, $3, 'member')`,
      [tripId, organizerId, memberId],
    );

    // 2. Direct driver verification: SUM(amount_cents) returns string in node-pg
    const expenseId = randomUUID();
    await testPool.query(
      `INSERT INTO expenses (id, trip_id, payer_id, created_by, category, description, expense_date, amount_cents, split_mode)
       VALUES ($1, $2, $3, $3, 'dining', 'Be Our Guest', '2026-10-03', 12345, 'even')`,
      [expenseId, tripId, memberId],
    );
    await testPool.query(
      `INSERT INTO expense_refunds (id, expense_id, created_by, refund_date, amount_cents)
       VALUES ($1, $2, $3, '2026-10-04', 2345)`,
      [randomUUID(), expenseId, memberId],
    );

    // Verify raw query returns string
    const rawSum = await testPool.query(
      `SELECT SUM(amount_cents) AS total FROM expenses WHERE trip_id = $1`,
      [tripId],
    );
    expect(typeof rawSum.rows[0].total).toBe('string');
    expect(rawSum.rows[0].total).toBe('12345');

    // 3. Call repo.loadBudget
    const repo = createTripBudgetRepo(testPool);
    const bundle = await repo.loadBudget(tripId);

    // Verify vsActualByExpenseCategory has number types
    expect(typeof bundle.vsActualByExpenseCategory.dining).toBe('number');
    // Net is 12345 - 2345 = 10000
    expect(bundle.vsActualByExpenseCategory.dining).toBe(10000);
    expect(typeof bundle.vsActualByExpenseCategory.hotel).toBe('number');
    expect(bundle.vsActualByExpenseCategory.hotel).toBe(0);
  });
});

