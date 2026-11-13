/**
 * Real-Postgres concurrency test for replacing a Trip's Stays (trip-lodging-stays Requirement 5.5, Property 7's
 * "two concurrent PUTs" half). pg-mem has one connection and no row locks, so this half needs a real database.
 *
 * Creates a throwaway database on the local Postgres (default `postgres://dwt:dwt@localhost:5432/dwt`, override with
 * DATABASE_URL), applies every migration, and fires two replaces of the same Trip at once through the real Trip repo.
 * Without the Trip row lock both transactions read the same (empty) stays and both insert, leaving a mix of the two
 * lists; with it the second waits, sees the first's stays, deletes them as absent, and leaves exactly its own list.
 *
 * Skips cleanly when no database is reachable. A skip does NOT satisfy task 5: run it and report the output.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TripStayInput } from '@dwt/shared';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

const { Pool } = pg;

const BASE_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dwt:dwt@localhost:5432/dwt';
const ROUNDS = 12;

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

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'migrations');

describe.skipIf(!DB_AVAILABLE)('replaceStays under concurrency (live Postgres)', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;
  let dbName: string;
  let repo: TripRepo;
  let userId: string;
  const resorts: string[] = [];

  beforeAll(async () => {
    dbName = `dwt_stays_concurrency_${randomUUID().replace(/-/g, '')}`;
    admin = new Pool({ connectionString: BASE_DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${dbName}`);
    pool = new Pool({ connectionString: withDatabaseName(BASE_DATABASE_URL, dbName), max: 6 });
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((n) => /^\d{4}_.+\.sql$/iu.test(n))
      .sort((a, b) => a.localeCompare(b));
    for (const name of files) {
      await pool.query(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
    }
    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'stays-cc@example.com', 'hash')`, [userId]);
    for (const name of ['Alpha Resort', 'Bravo Resort', 'Charlie Resort', 'Delta Resort']) {
      const id = randomUUID();
      await pool.query(`INSERT INTO resorts (id, upstream_entity_id, name) VALUES ($1, $2, $3)`, [id, `res-${id}`, name]);
      resorts.push(id);
    }
    repo = createTripRepo(pool as unknown as DbPool, { completions: {}, ratings: {} } as unknown as TripRepoDeps);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    if (admin && dbName) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  });

  it('two concurrent replaces leave exactly one of the two lists (never a mix), with trip_resorts in step', async () => {
    const listA: TripStayInput[] = [
      { lodgingKind: 'resort', resortId: resorts[0]!, checkIn: '2027-12-15', checkOut: '2027-12-20' },
      { lodgingKind: 'resort', resortId: resorts[1]!, checkIn: '2027-12-20', checkOut: '2027-12-31' },
    ];
    const listB: TripStayInput[] = [
      { lodgingKind: 'resort', resortId: resorts[2]!, checkIn: '2027-12-15', checkOut: '2027-12-22' },
      { lodgingKind: 'resort', resortId: resorts[3]!, checkIn: '2027-12-22', checkOut: '2027-12-31' },
      { lodgingKind: 'offsite', placeName: 'Aunt May' },
    ];
    const signature = (rows: { resort_id: string | null; place_name: string | null }[]) =>
      rows.map((r) => r.resort_id ?? `name:${r.place_name}`).sort();
    const wantA = signature(listA.map((s) => ({ resort_id: s.resortId ?? null, place_name: s.placeName ?? null })));
    const wantB = signature(listB.map((s) => ({ resort_id: s.resortId ?? null, place_name: s.placeName ?? null })));

    const outcomes = new Set<string>();
    for (let round = 0; round < ROUNDS; round += 1) {
      const trip = await repo.createTrip(userId, { name: `CC ${round}`, description: '', startDate: '2027-12-15', endDate: '2027-12-31' });
      const [ra, rb] = await Promise.allSettled([repo.replaceStays(trip.id, listA), repo.replaceStays(trip.id, listB)]);
      expect(ra.status).toBe('fulfilled');
      expect(rb.status).toBe('fulfilled');

      const stays = await pool.query<{ resort_id: string | null; place_name: string | null }>(
        `SELECT resort_id, place_name FROM trip_stays WHERE trip_id = $1`,
        [trip.id],
      );
      const got = signature(stays.rows);
      expect([JSON.stringify(wantA), JSON.stringify(wantB)]).toContain(JSON.stringify(got));
      outcomes.add(JSON.stringify(got) === JSON.stringify(wantA) ? 'A' : 'B');

      const tr = await pool.query<{ resort_id: string }>(`SELECT resort_id FROM trip_resorts WHERE trip_id = $1`, [trip.id]);
      expect(tr.rows.map((r) => r.resort_id).sort()).toEqual(got.filter((k) => !k.startsWith('name:')));
    }
    // Not asserted (scheduling decides the winner); recorded so a run shows both orders were exercised.
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
