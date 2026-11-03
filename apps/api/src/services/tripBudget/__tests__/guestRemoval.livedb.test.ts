/**
 * Feature: trip-budget, Task 14.4 / round 4 M6 / trip-expenses Requirement 2.13
 *
 * Concurrent two-connection livedb test against local Postgres with migrations applied:
 * Connection A BEGINs and inserts a trip_budget_allocations row for the guest WITHOUT committing;
 * Connection B starts removeTripGuest (it blocks on the FOR UPDATE lock of the guest);
 * A commits;
 * Assert B rejects with trip_validation_failed and both the allocation row and the guest row still exist.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { createTripExpenseRepo } from '../../tripExpenses/repo.js';

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

describe.skipIf(!DB_AVAILABLE)('removeTripGuest concurrency (live Postgres)', () => {
  let adminPool: DbPool;
  let testPool: DbPool;
  let testDbName: string;

  beforeAll(async () => {
    testDbName = `dwt_guest_concurrency_${randomUUID().replace(/-/g, '')}`;
    adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
    await adminPool.query(`CREATE DATABASE ${testDbName}`);

    testPool = new Pool({
      connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
      max: 10,
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

  it('blocks on FOR UPDATE, sees committed allocation on unblock, and aborts removal', async () => {
    const organizerId = randomUUID();
    const memberId = randomUUID();
    const tripId = randomUUID();
    const guestId = randomUUID();
    const lineId = randomUUID();
    const allocId = randomUUID();

    // 1. Seed base data
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
       VALUES ($1, $2, 'Disney Vacation', 'Test Trip', '2026-10-01', '2026-10-10')`,
      [tripId, organizerId],
    );
    await testPool.query(
      `INSERT INTO trip_memberships (trip_id, user_id, role)
       VALUES ($1, $2, 'organizer'), ($1, $3, 'member')`,
      [tripId, organizerId, memberId],
    );
    await testPool.query(
      `INSERT INTO trip_guests (id, trip_id, sponsor_member_id, name)
       VALUES ($1, $2, $3, 'Timmy')`,
      [guestId, tripId, memberId],
    );
    await testPool.query(
      `INSERT INTO trip_budget_lines (id, trip_id, category, description, created_by, price_source)
       VALUES ($1, $2, 'dining', 'Lunch', $3, 'user_entered')`,
      [lineId, tripId, organizerId],
    );

    // 2. Connection A starts transaction and inserts allocation (holds KEY SHARE lock on guest)
    const clientA = await testPool.connect();
    await clientA.query('BEGIN');
    await clientA.query(
      `INSERT INTO trip_budget_allocations (id, line_id, guest_id, amount_cents)
       VALUES ($1, $2, $3, 2500)`,
      [allocId, lineId, guestId],
    );

    // 3. Connection B starts removeTripGuest (which attempts SELECT ... FOR UPDATE on guest)
    const expensesRepo = createTripExpenseRepo(testPool);
    let removalPromiseSettled = false;
    const removalPromise = expensesRepo
      .removeTripGuest(tripId, guestId, organizerId, 'organizer')
      .finally(() => {
        removalPromiseSettled = true;
      });

    // Verify B is indeed blocked (not yet settled after 100ms)
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(removalPromiseSettled).toBe(false);

    // 4. Connection A commits
    await clientA.query('COMMIT');
    clientA.release();

    // 5. Connection B unblocks, evaluates references, and must reject with trip_validation_failed
    await expect(removalPromise).rejects.toThrow(
      new AppError('trip_validation_failed', 'Cannot remove guest with recorded expense shares or assignments'),
    );

    // 6. Assert both allocation and guest still exist
    const guestRes = await testPool.query('SELECT id FROM trip_guests WHERE id = $1', [guestId]);
    expect(guestRes.rows.length).toBe(1);

    const allocRes = await testPool.query('SELECT id FROM trip_budget_allocations WHERE id = $1', [allocId]);
    expect(allocRes.rows.length).toBe(1);
  });
});

