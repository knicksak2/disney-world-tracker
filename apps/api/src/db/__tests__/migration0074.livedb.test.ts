/**
 * Real-Postgres test for `0074_trip_stays_backfill.sql` (trip-lodging-stays Requirement 10, Property 13).
 *
 * Creates a throwaway database on the local Postgres (default `postgres://dwt:dwt@localhost:5432/dwt`, override with
 * DATABASE_URL), applies migrations 0001..0073, seeds one trip per scenario, runs the backfill, and asserts the rows it
 * produced. It then runs the backfill a second time and asserts nothing changed (idempotence), and asserts the backfill
 * never modified trips, trip_resorts or trip_booking_settings.
 *
 * Skips cleanly when no database is reachable. A skip does NOT satisfy the task: the executor must run it against a
 * real database and report the output.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { Pool } = pg;

const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';
const BACKFILL_FILE = '0074_trip_stays_backfill.sql';

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

function withDatabaseName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.+\.sql$/iu.test(n))
    .sort((a, b) => a.localeCompare(b));
}

interface StayRow {
  readonly id: string;
  readonly trip_id: string;
  readonly position: number;
  readonly lodging_kind: string;
  readonly resort_id: string | null;
  readonly place_name: string | null;
  readonly check_in: string | null;
  readonly check_out: string | null;
  readonly party_keys: unknown;
}

describe.skipIf(!DB_AVAILABLE)('0074_trip_stays_backfill (live Postgres)', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let dbName: string;
  let userId: string;

  const resortIds = new Map<string, string>(); // name -> id

  // Scenario trips, keyed by a short label.
  const trips = new Map<string, string>();

  async function addResort(name: string, id: string = randomUUID()): Promise<string> {
    await pool.query(
      `INSERT INTO resorts (id, upstream_entity_id, name) VALUES ($1, $2, $3)`,
      [id, `res-${id}`, name],
    );
    resortIds.set(name, id);
    return id;
  }

  async function addTrip(label: string, start: string, end: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES ($1, $2, $3, '', $4, $5)`,
      [id, userId, label, start, end],
    );
    trips.set(label, id);
    return id;
  }

  async function link(tripLabel: string, resortId: string): Promise<void> {
    await pool.query(`INSERT INTO trip_resorts (trip_id, resort_id) VALUES ($1, $2)`, [trips.get(tripLabel), resortId]);
  }

  async function settings(
    tripLabel: string,
    values: { stayType?: string | null; checkInOverride?: string | null },
  ): Promise<void> {
    await pool.query(
      `INSERT INTO trip_booking_settings (trip_id, stay_type, check_in_override) VALUES ($1, $2, $3)`,
      [trips.get(tripLabel), values.stayType ?? null, values.checkInOverride ?? null],
    );
  }

  async function staysOf(tripLabel: string): Promise<StayRow[]> {
    const res = await pool.query<StayRow>(
      `SELECT id, trip_id, position, lodging_kind, resort_id, place_name,
              to_char(check_in, 'YYYY-MM-DD') AS check_in, to_char(check_out, 'YYYY-MM-DD') AS check_out, party_keys
         FROM trip_stays WHERE trip_id = $1 ORDER BY position, id`,
      [trips.get(tripLabel)],
    );
    return res.rows;
  }

  async function snapshotUntouched(): Promise<string> {
    const [t, r, s] = await Promise.all([
      pool.query(`SELECT * FROM trips ORDER BY id`),
      pool.query(`SELECT * FROM trip_resorts ORDER BY trip_id, resort_id`),
      pool.query(`SELECT * FROM trip_booking_settings ORDER BY trip_id`),
    ]);
    return JSON.stringify({ trips: t.rows, trip_resorts: r.rows, trip_booking_settings: s.rows });
  }

  async function allStays(): Promise<string> {
    const res = await pool.query(`SELECT * FROM trip_stays ORDER BY trip_id, position, id`);
    return JSON.stringify(res.rows);
  }

  async function applyBackfill(): Promise<void> {
    await pool.query(readFileSync(join(MIGRATIONS_DIR, BACKFILL_FILE), 'utf8'));
  }

  let untouchedBefore = '';
  let afterFirstRun = '';
  let afterSecondRun = '';
  let untouchedAfter = '';
  let preExistingStayId = '';

  beforeAll(async () => {
    dbName = `dwt_stays_backfill_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${dbName}`);
    pool = new Pool({ connectionString: withDatabaseName(BASE_DATABASE_URL, dbName), max: 4 });

    // Everything before the backfill (0001..0073).
    for (const name of migrationFiles().filter((n) => n < BACKFILL_FILE)) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    }

    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'stays@example.com', 'hash')`, [userId]);

    const allStar = await addResort("Disney's All-Star Movies Resort");
    const akl = await addResort("Disney's Animal Kingdom Lodge");
    const beach = await addResort("Disney's Beach Club Resort");
    const pop = await addResort("Disney's Pop Century Resort");

    // (a) single resort scenarios
    await addTrip('single', '2027-03-10', '2027-03-17');
    await link('single', pop);

    await addTrip('override-valid', '2027-03-10', '2027-03-17');
    await link('override-valid', pop);
    await settings('override-valid', { checkInOverride: '2027-03-07' });

    await addTrip('override-too-early', '2027-03-10', '2027-03-17');
    await link('override-too-early', pop);
    await settings('override-too-early', { checkInOverride: '2027-02-03' }); // 35 days before: out of range

    await addTrip('override-after-start', '2027-03-10', '2027-03-17');
    await link('override-after-start', pop);
    await settings('override-after-start', { checkInOverride: '2027-03-12' });

    await addTrip('override-30-days', '2027-03-10', '2027-03-17');
    await link('override-30-days', pop);
    await settings('override-30-days', { checkInOverride: '2027-02-08' }); // exactly 30 days before: allowed

    await addTrip('partner', '2027-03-10', '2027-03-17');
    await link('partner', pop);
    await settings('partner', { stayType: 'partner_hotel' });

    await addTrip('offsite-override', '2027-03-10', '2027-03-17');
    await link('offsite-override', beach);
    await settings('offsite-override', { stayType: 'offsite', checkInOverride: '2027-03-08' });

    await addTrip('settings-without-type', '2027-03-10', '2027-03-17');
    await link('settings-without-type', pop);
    await settings('settings-without-type', { stayType: null, checkInOverride: null });

    await addTrip('one-day', '2027-03-10', '2027-03-10');
    await link('one-day', pop);

    // (b) several resorts: ranked by name then id, undated
    await addTrip('three', '2026-12-15', '2026-12-31');
    await link('three', beach);
    await link('three', allStar);
    await link('three', akl);

    // Two resorts with the SAME name: ordered by id.
    // Linked in the opposite order of their ids, with exactly equal names, so only the id tiebreak can order them.
    const twinLow = await addResort('Twin Resort', '00000000-0000-4000-8000-000000000001');
    const twinHigh = await addResort('Twin Resort', 'ffffffff-ffff-4fff-8fff-ffffffffffff');
    await addTrip('twins', '2027-04-01', '2027-04-08');
    await link('twins', twinHigh);
    await link('twins', twinLow);

    // More resorts than the 8-stay limit: position is capped at 7, every resort still gets a row.
    await addTrip('ten', '2027-05-01', '2027-05-20');
    for (let i = 0; i < 10; i++) {
      const rid = await addResort(`Overflow Resort ${String(i).padStart(2, '0')}`);
      await link('ten', rid);
    }

    // (c) no resort
    await addTrip('none', '2027-06-01', '2027-06-07');

    // A trip that already has stays is never touched, whatever its trip_resorts say.
    await addTrip('already', '2027-07-01', '2027-07-08');
    await link('already', pop);
    await link('already', beach);
    preExistingStayId = randomUUID();
    await pool.query(
      `INSERT INTO trip_stays (id, trip_id, position, lodging_kind, place_name, check_in, check_out)
       VALUES ($1, $2, 0, 'offsite', 'Hampton Inn', '2027-07-01', '2027-07-08')`,
      [preExistingStayId, trips.get('already')],
    );

    untouchedBefore = await snapshotUntouched();
    await applyBackfill();
    afterFirstRun = await allStays();
    untouchedAfter = await snapshotUntouched();
    await applyBackfill();
    afterSecondRun = await allStays();
  }, 240_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  });

  it('gives a single-resort trip one dated resort stay equal to the trip dates', async () => {
    const rows = await staysOf('single');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      position: 0,
      lodging_kind: 'resort',
      resort_id: resortIds.get("Disney's Pop Century Resort"),
      place_name: null,
      check_in: '2027-03-10',
      check_out: '2027-03-17',
      party_keys: null,
    });
  });

  it('starts the stay at a check-in override within 30 days before the trip start', async () => {
    expect((await staysOf('override-valid'))[0]).toMatchObject({ check_in: '2027-03-07', check_out: '2027-03-17' });
    expect((await staysOf('override-30-days'))[0]).toMatchObject({ check_in: '2027-02-08', check_out: '2027-03-17' });
  });

  it('ignores an override that is earlier than 30 days before the start or later than the start', async () => {
    expect((await staysOf('override-too-early'))[0]).toMatchObject({ check_in: '2027-03-10', check_out: '2027-03-17' });
    expect((await staysOf('override-after-start'))[0]).toMatchObject({ check_in: '2027-03-10', check_out: '2027-03-17' });
  });

  it('turns a partner_hotel stay_type override into a partner_hotel stay named after the resort, with no resort id', async () => {
    const rows = await staysOf('partner');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      lodging_kind: 'partner_hotel',
      resort_id: null,
      place_name: "Disney's Pop Century Resort",
      check_in: '2027-03-10',
      check_out: '2027-03-17',
    });
  });

  it('combines an offsite override with a valid check-in override', async () => {
    expect((await staysOf('offsite-override'))[0]).toMatchObject({
      lodging_kind: 'offsite',
      resort_id: null,
      place_name: "Disney's Beach Club Resort",
      check_in: '2027-03-08',
      check_out: '2027-03-17',
    });
  });

  it('treats a settings row with no overrides like no settings row', async () => {
    expect((await staysOf('settings-without-type'))[0]).toMatchObject({
      lodging_kind: 'resort',
      check_in: '2027-03-10',
      check_out: '2027-03-17',
    });
  });

  it('gives a one-day trip an unscheduled stay', async () => {
    const rows = await staysOf('one-day');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lodging_kind: 'resort', check_in: null, check_out: null });
  });

  it('gives a multi-resort trip one unscheduled resort stay per resort, ordered by name', async () => {
    const rows = await staysOf('three');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.resort_id)).toEqual([
      resortIds.get("Disney's All-Star Movies Resort"),
      resortIds.get("Disney's Animal Kingdom Lodge"),
      resortIds.get("Disney's Beach Club Resort"),
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({ lodging_kind: 'resort', place_name: null, check_in: null, check_out: null, party_keys: null });
    }
  });

  it('orders two resorts with the same name by id', async () => {
    const rows = await staysOf('twins');
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows.map((r) => r.resort_id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
    ]);
  });

  it('caps position at 7 for a trip with more than eight resorts and still creates every stay', async () => {
    const rows = await staysOf('ten');
    expect(rows).toHaveLength(10);
    expect(Math.max(...rows.map((r) => r.position))).toBe(7);
    // Ranks 0..6 are distinct and in name order; ranks 7, 8 and 9 all collapse to 7.
    const byPosition = rows.map((r) => r.position).sort((a, b) => a - b);
    expect(byPosition).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7, 7]);
  });

  it('gives a trip with no recorded resort no stay', async () => {
    expect(await staysOf('none')).toEqual([]);
  });

  it('never touches a trip that already has stays', async () => {
    const rows = await staysOf('already');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: preExistingStayId, lodging_kind: 'offsite', place_name: 'Hampton Inn' });
  });

  it('is idempotent: a second run leaves every stay row identical, ids included', () => {
    expect(afterFirstRun.length).toBeGreaterThan(2);
    expect(afterSecondRun).toBe(afterFirstRun);
  });

  it('only reads trips, trip_resorts and trip_booking_settings', () => {
    expect(untouchedAfter).toBe(untouchedBefore);
  });
});
