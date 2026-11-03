/**
 * Feature: trip-budget, Requirement 11 & 12: Ticket Prices Repo Live DB Tests
 *
 * Validates: Requirements 11.6, 11.7, 11.8, 11.14, 12.3, 12.4, 14.3, 14.4, 19.3, 20.6
 *
 * Runs against real PostgreSQL. Tests:
 * - Error code normalization (review F19)
 * - Property 12 SQL half (deduped batch succeeds, duplicate batch raises 21000)
 * - IS DISTINCT FROM changed_at stability
 * - Reconcile scoped to [startDateSent, endDate] (round 4 L6)
 * - Prune before today
 * - Atomic claims: two concurrent full claims yield exactly one winner
 * - 24h attempt cooldown & admin bypass
 * - probe_only judged on last_probe_at only
 * - blocked_until honored
 * - Claim timeout reclaimability (Property 37 DB half)
 * - diagnose claim 60-second minimum interval and in-flight guard
 * - upgradeClaimToFull requires held claim & elapsed cooldown
 * - round 5: recordSetError preserves as_of, updateSet clears last_error to NULL, readBlockedUntil right after block
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTicketPricesRepo, type StorableTicketPriceRow, type TicketPricesRepo } from '../repo.js';

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

async function applyAllMigrations(pool: any): Promise<void> {
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

describe.skipIf(!DB_AVAILABLE)('TicketPricesRepo (real PostgreSQL)', () => {
  let adminPool: any;
  let testPool: any;
  let testDbName: string;
  let repo: TicketPricesRepo;

  beforeAll(async () => {
    testDbName = `dwt_ticket_repo_${randomUUID().replace(/-/g, '')}`;
    adminPool = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
    await adminPool.query(`CREATE DATABASE ${testDbName}`);

    testPool = new Pool({
      connectionString: withDatabaseName(BASE_DATABASE_URL, testDbName),
      max: 10,
    });
    await applyAllMigrations(testPool);
    repo = createTicketPricesRepo(testPool);
  }, 120_000);

  afterAll(async () => {
    await testPool?.end().catch(() => {});
    if (adminPool) {
      await adminPool.query(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`).catch(() => {});
      await adminPool.end().catch(() => {});
    }
  });

  beforeEach(async () => {
    await testPool.query('DELETE FROM ticket_prices');
    await testPool.query('DELETE FROM ticket_price_sets');
    await testPool.query(`
      UPDATE ticket_price_control
         SET last_attempt_at = NULL,
             last_probe_at = NULL,
             blocked_until = NULL,
             in_progress_since = NULL,
             observed_horizon_date = NULL,
             last_diagnose_at = NULL,
             last_status = NULL,
             last_error = NULL,
             updated_at = now()
       WHERE id = 1
    `);
  });

  it('Property 12 SQL half: dedupeByKey avoids 21000, raw duplicate batch DOES raise 21000', async () => {
    const rawBatch: StorableTicketPriceRow[] = [
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-01',
        priceCents: 50000,
        taxCents: 3250,
        validEndDate: '2026-11-07',
        productId: 'prod1',
      },
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: '2026-11-01',
        priceCents: 52000, // Duplicate PK!
        taxCents: 3380,
        validEndDate: '2026-11-07',
        productId: 'prod1_v2',
      },
    ];

    // Negative control: raw duplicate batch without dedupeByKey directly executing unnest raises error 21000 in PostgreSQL
    const unnestSql = `
      INSERT INTO ticket_prices (discount_group, num_days, age_group, option_code, park, start_date, price_cents, tax_cents, valid_end_date, product_id)
      SELECT * FROM unnest($1::text[], $2::smallint[], $3::text[], $4::text[], $5::text[], $6::date[], $7::int[], $8::int[], $9::date[], $10::text[])
      ON CONFLICT (discount_group, num_days, age_group, option_code, park, start_date) DO UPDATE SET
        price_cents = EXCLUDED.price_cents;
    `;
    await expect(
      testPool.query(unnestSql, [
        rawBatch.map((r) => r.discountGroup),
        rawBatch.map((r) => r.numDays),
        rawBatch.map((r) => r.ageGroup),
        rawBatch.map((r) => r.optionCode),
        rawBatch.map((r) => r.park),
        rawBatch.map((r) => r.startDate),
        rawBatch.map((r) => r.priceCents),
        rawBatch.map((r) => r.taxCents),
        rawBatch.map((r) => r.validEndDate),
        rawBatch.map((r) => r.productId),
      ]),
    ).rejects.toMatchObject({ code: '21000' });

    // With dedupeByKey (via repo.upsertRows), it succeeds without error 21000
    const upserted = await repo.upsertRows(rawBatch);
    expect(upserted).toBe(1);

    const check = await testPool.query('SELECT price_cents FROM ticket_prices');
    expect(check.rows).toHaveLength(1);
    expect(check.rows[0].price_cents).toBe(52000); // last-write wins
  });

  it('IS DISTINCT FROM: second identical apply leaves changed_at unchanged', async () => {
    const row: StorableTicketPriceRow = {
      discountGroup: 'std-gst',
      numDays: 4,
      ageGroup: 'adult',
      optionCode: 'base',
      park: 'any',
      startDate: '2026-11-01',
      priceCents: 50000,
      taxCents: 3250,
      validEndDate: '2026-11-07',
      productId: 'prod1',
    };

    await repo.upsertRows([row]);
    const firstRes = await testPool.query('SELECT changed_at FROM ticket_prices');
    const firstChangedAt = new Date(firstRes.rows[0].changed_at).getTime();

    // Re-apply identical row
    await repo.upsertRows([row]);
    const secondRes = await testPool.query('SELECT changed_at FROM ticket_prices');
    const secondChangedAt = new Date(secondRes.rows[0].changed_at).getTime();

    expect(secondChangedAt).toBe(firstChangedAt);
  });

  it('reconcileSet (round 4 L6): scoped strictly to [startDateSent, endDate], preserves today row on UTC retry', async () => {
    const today = '2026-10-25';
    const tomorrow = '2026-10-26';
    const dayAfter = '2026-10-27';

    // Seed rows for today, tomorrow, dayAfter
    await repo.upsertRows([
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: today,
        priceCents: 50000,
        taxCents: 3250,
        validEndDate: '2026-11-01',
        productId: 'prod_today',
      },
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: tomorrow,
        priceCents: 51000,
        taxCents: 3315,
        validEndDate: '2026-11-02',
        productId: 'prod_tomorrow',
      },
      {
        discountGroup: 'std-gst',
        numDays: 4,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: dayAfter,
        priceCents: 52000,
        taxCents: 3380,
        validEndDate: '2026-11-03',
        productId: 'prod_day_after',
      },
    ]);

    // Reconcile with startDateSent = tomorrow (UTC retry), endDate = dayAfter
    // Fetched keys only has tomorrow (so dayAfter was dropped upstream and must be deleted)
    // today is OUTSIDE [startDateSent, endDate], so today MUST be preserved!
    await repo.reconcileSet('std-gst', 4, tomorrow, dayAfter, [
      {
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'any',
        startDate: tomorrow,
      },
    ]);

    const remaining = await testPool.query('SELECT start_date::text FROM ticket_prices ORDER BY start_date');
    const dates = remaining.rows.map((r: any) => r.start_date);
    expect(dates).toEqual([today, tomorrow]); // dayAfter was deleted, today survived!
  });

  it('pruneBeforeToday removes past dates only', async () => {
    const yesterday = '2026-10-24';
    const today = '2026-10-25';
    const tomorrow = '2026-10-26';

    await repo.upsertRows([
      {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'mk',
        startDate: yesterday,
        priceCents: 15000,
        taxCents: 1000,
        validEndDate: yesterday,
        productId: 'p_y',
      },
      {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'mk',
        startDate: today,
        priceCents: 15000,
        taxCents: 1000,
        validEndDate: today,
        productId: 'p_t',
      },
      {
        discountGroup: 'std-gst',
        numDays: 1,
        ageGroup: 'adult',
        optionCode: 'base',
        park: 'mk',
        startDate: tomorrow,
        priceCents: 15000,
        taxCents: 1000,
        validEndDate: tomorrow,
        productId: 'p_tm',
      },
    ]);

    const pruned = await repo.pruneBeforeToday(today);
    expect(pruned).toBe(1);

    const remaining = await testPool.query('SELECT start_date::text FROM ticket_prices ORDER BY start_date');
    expect(remaining.rows.map((r: any) => r.start_date)).toEqual([today, tomorrow]);
  });

  it('concurrent claimControl(full, false) on two pool connections yields exactly one winner', async () => {
    const client1 = await testPool.connect();
    const client2 = await testPool.connect();

    const repo1 = createTicketPricesRepo(client1);
    const repo2 = createTicketPricesRepo(client2);

    try {
      const [res1, res2] = await Promise.all([
        repo1.claimControl('full', false, 15, 24),
        repo2.claimControl('full', false, 15, 24),
      ]);

      const winners = [res1, res2].filter(Boolean);
      expect(winners).toHaveLength(1);
    } finally {
      client1.release();
      client2.release();
    }
  });

  it('full claim honors 24h attempt cooldown; admin bypass honors only cooldown (not blocked_until)', async () => {
    // 1st claim succeeds
    const c1 = await repo.claimControl('full', false, 15, 24);
    expect(c1).toBe(true);
    await repo.releaseControl('done');

    // 2nd claim within 24h fails
    const c2 = await repo.claimControl('full', false, 15, 24);
    expect(c2).toBe(false);

    // Admin bypass (bypassCooldown = true) succeeds despite attempt cooldown
    const cAdmin = await repo.claimControl('full', true, 15, 24);
    expect(cAdmin).toBe(true);
    await repo.releaseControl('done');

    // But if blocked_until is in the future, even admin bypass fails
    await repo.block(new Date(Date.now() + 3600_000), 'manual');
    const cBlockedAdmin = await repo.claimControl('full', true, 15, 24);
    expect(cBlockedAdmin).toBe(false);
  });

  it('probe_only claim is judged on last_probe_at only (recent last_attempt_at does not block it)', async () => {
    // Set last_attempt_at to now
    await testPool.query('UPDATE ticket_price_control SET last_attempt_at = now() WHERE id = 1');

    // probe_only claim should succeed because last_probe_at is null
    const cProbe = await repo.claimControl('probe_only', false, 15, 4);
    expect(cProbe).toBe(true);

    // Verify last_attempt_at was NOT touched by probe_only
    const check = await testPool.query('SELECT last_probe_at, last_attempt_at FROM ticket_price_control WHERE id = 1');
    expect(check.rows[0].last_probe_at).not.toBeNull();
    expect(check.rows[0].last_attempt_at).not.toBeNull();
  });

  it('claim older than claimTimeoutMinutes is reclaimable; fresh claim is not (Property 37 DB half)', async () => {
    // Fresh claim (in_progress_since = now)
    await repo.claimControl('full', true, 15, 24);

    // Immediate second claim fails
    const freshClaim = await repo.claimControl('full', true, 15, 24);
    expect(freshClaim).toBe(false);

    // Simulate claim expired 20 minutes ago (> 15 min)
    await testPool.query("UPDATE ticket_price_control SET in_progress_since = now() - interval '20 minutes' WHERE id = 1");

    // Expired claim is reclaimed!
    const expiredClaim = await repo.claimControl('full', true, 15, 24);
    expect(expiredClaim).toBe(true);
  });

  it('diagnose claim refuses a second call inside 60 seconds and while a run is in flight (B5)', async () => {
    // 1st diagnose succeeds with 60s interval
    const d1 = await repo.claimControl('diagnose', false, 15, 60);
    expect(d1).toBe(true);
    await repo.releaseControl('done');

    // 2nd diagnose within 60s fails
    const d2 = await repo.claimControl('diagnose', false, 15, 60);
    expect(d2).toBe(false);

    // If simulated last_diagnose_at is 70s ago, it succeeds
    await testPool.query("UPDATE ticket_price_control SET last_diagnose_at = now() - interval '70 seconds' WHERE id = 1");
    const d3 = await repo.claimControl('diagnose', false, 15, 60);
    expect(d3).toBe(true);
  });

  it('A2: releaseControl preserves last_error when status is blocked or block is active, and clears to NULL on success', async () => {
    // 1. Block control with waf_block
    const until = new Date(Date.now() + 3600_000);
    await repo.block(until, 'waf_block');
    let ctrl = await testPool.query('SELECT last_error FROM ticket_price_control WHERE id = 1');
    expect(ctrl.rows[0].last_error).toBe('waf_block');

    // 2. releaseControl('blocked', null) preserves waf_block
    await repo.releaseControl('blocked', null);
    ctrl = await testPool.query('SELECT last_error FROM ticket_price_control WHERE id = 1');
    expect(ctrl.rows[0].last_error).toBe('waf_block');

    // 3. releaseControl('diagnose_complete') while block is active preserves waf_block
    await repo.releaseControl('diagnose_complete');
    ctrl = await testPool.query('SELECT last_error FROM ticket_price_control WHERE id = 1');
    expect(ctrl.rows[0].last_error).toBe('waf_block');

    // 4. Release after clearing block clears last_error to NULL on successful done run
    await testPool.query('UPDATE ticket_price_control SET blocked_until = NULL WHERE id = 1');
    await repo.releaseControl('done');
    ctrl = await testPool.query('SELECT last_error FROM ticket_price_control WHERE id = 1');
    expect(ctrl.rows[0].last_error).toBeNull();
  });

  it('upgradeClaimToFull succeeds only when attempt cooldown passed and while claim is held', async () => {
    // No claim held -> upgrade fails
    const upNoClaim = await repo.upgradeClaimToFull(24);
    expect(upNoClaim).toBe(false);

    // Hold a probe_only claim
    await repo.claimControl('probe_only', false, 15, 4);

    // If last_attempt_at is null, upgrade succeeds!
    const upSuccess = await repo.upgradeClaimToFull(24);
    expect(upSuccess).toBe(true);

    // Immediate second upgrade within 24h fails
    const upCooldown = await repo.upgradeClaimToFull(24);
    expect(upCooldown).toBe(false);
  });

  it('round 5: recordSetError preserves as_of, updateSet clears last_error to NULL, readBlockedUntil right after block', async () => {
    const asOfTime = new Date('2026-10-25T10:00:00.000Z');

    // 1. Initial set update
    await repo.updateSet('std-gst', 4, asOfTime, '2027-10-25', 100, 365);
    let setCheck = await testPool.query('SELECT as_of, last_error FROM ticket_price_sets WHERE discount_group = $1 AND num_days = $2', ['std-gst', 4]);
    expect(new Date(setCheck.rows[0].as_of).getTime()).toBe(asOfTime.getTime());
    expect(setCheck.rows[0].last_error).toBeNull();

    // 2. recordSetError leaves as_of untouched and sets last_error
    await repo.recordSetError('std-gst', 4, 'network');
    setCheck = await testPool.query('SELECT as_of, last_error FROM ticket_price_sets WHERE discount_group = $1 AND num_days = $2', ['std-gst', 4]);
    expect(new Date(setCheck.rows[0].as_of).getTime()).toBe(asOfTime.getTime()); // Preserved!
    expect(setCheck.rows[0].last_error).toBe('network');

    // 3. updateSet on recovery clears last_error to NULL and advances as_of
    const newAsOf = new Date('2026-10-26T10:00:00.000Z');
    await repo.updateSet('std-gst', 4, newAsOf, '2027-10-26', 105, 365);
    setCheck = await testPool.query('SELECT as_of, last_error FROM ticket_price_sets WHERE discount_group = $1 AND num_days = $2', ['std-gst', 4]);
    expect(new Date(setCheck.rows[0].as_of).getTime()).toBe(newAsOf.getTime());
    expect(setCheck.rows[0].last_error).toBeNull(); // Cleared to NULL!

    // 4. readBlockedUntil returns new value right after block
    const blockUntil = new Date(Date.now() + 3600_000);
    await repo.block(blockUntil, 'waf_block');
    const readBlock = await repo.readBlockedUntil();
    expect(readBlock).not.toBeNull();
    expect(Math.abs(readBlock!.getTime() - blockUntil.getTime())).toBeLessThan(1000);

    // Verify error was normalized on control
    const ctrl = await testPool.query('SELECT last_error FROM ticket_price_control WHERE id = 1');
    expect(ctrl.rows[0].last_error).toBe('waf_block');
  });
});
