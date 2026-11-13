/**
 * pg-mem fixture for the Trip lodging Stays tests (trip-lodging-stays tasks 4 and 5).
 *
 * Applies the production DDL for users, trips and trip_resorts, a minimal `resorts` stub (the only FK target 0016 and
 * 0073 need), and optionally `0073_trip_lodging_stays.sql`. With `withStays: false` it reproduces the fixed migration
 * list the older Trip suites load, which is how the absent-table path is exercised.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TripStayInput } from '@dwt/shared';
import type { PoolClient } from 'pg';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import type { DbPool } from '../../../db/pool.js';
import { createTripRepo, type TripRepo, type TripRepoDeps } from '../repo.js';

function jsonbTypeof(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  let parsed = val;
  if (typeof val === 'string') {
    try {
      parsed = JSON.parse(val);
    } catch {
      return 'string';
    }
  }
  if (Array.isArray(parsed)) return 'array';
  if (parsed === null) return 'null';
  return typeof parsed === 'object' ? 'object' : typeof parsed;
}

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
  const text1 = (name: string, fn: (s: string) => string | number, returns: DataType): void => {
    pub.registerFunction({
      name,
      args: [DataType.text],
      returns,
      implementation: (s: unknown) => fn(typeof s === 'string' ? s : ''),
    });
  };
  text1('char_length', (s) => s.length, DataType.integer);
  text1('length', (s) => s.length, DataType.integer);
  text1('lower', (s) => s.toLowerCase(), DataType.text);
  text1('trim', (s) => s.trim(), DataType.text);
  text1('btrim', (s) => s.trim(), DataType.text);
  pub.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: jsonbTypeof,
  });
  return db;
}

function applyMigration(db: IMemoryDb, name: string): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let sql = readFileSync(resolve(here, '..', '..', '..', '..', 'migrations', name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  db.public.none(sql);
}

/** pg-mem has no row-level `FOR UPDATE`; strip it so the repo's locking statements run. */
function withForUpdateCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query: (text: string, params?: unknown[]) => Promise<unknown>;
    connect: () => Promise<{ query: (text: string, params?: unknown[]) => Promise<unknown>; release: () => void }>;
  };
  const strip = (text: string): string => text.replace(/\bFOR UPDATE(?:\s+OF\s+\w+)?/giu, '');
  return {
    query: (text: string, params?: unknown[]) => raw.query(strip(text), params),
    async connect() {
      const client = await raw.connect();
      return {
        query: (text: string, params?: unknown[]) => client.query(strip(text), params),
        release: () => client.release(),
      };
    },
  } as unknown as DbPool;
}

const NOOP_DEPS = { completions: {}, ratings: {} } as unknown as TripRepoDeps;

export interface StaysFixture {
  readonly pool: DbPool;
  readonly repo: TripRepo;
  /** Statements run through the pool or any client it hands out, in order. */
  readonly statements: string[];
  seedUser(name?: string): Promise<string>;
  seedResort(name: string, active?: boolean): Promise<string>;
  /** Insert a bare Trip row (no membership or feed item) and return its id. */
  seedTrip(creatorId: string, startDate: string, endDate: string): Promise<string>;
  /** Read all `trip_stays` rows of a Trip, id-ordered, as plain objects. */
  stayRows(tripId: string): Promise<Record<string, unknown>[]>;
  /** Read the resort ids recorded in `trip_resorts` for a Trip, sorted. */
  tripResortIds(tripId: string): Promise<string[]>;
  /** Run `fn` with a client inside BEGIN/COMMIT, rolling back and rethrowing on error. */
  inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export function makeStaysFixture(options: { withStays?: boolean } = {}): StaysFixture {
  const withStays = options.withStays ?? true;
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const rawPool = new PgMemPool() as unknown as DbPool;

  applyMigration(db, '0001_init.sql');
  db.public.none(`
    CREATE TABLE resorts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    ALTER TABLE experiences ADD COLUMN IF NOT EXISTS meal_periods JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_state TEXT NOT NULL DEFAULT 'active';
  `);
  for (const m of [
    '0015_trips.sql',
    '0016_trip_resorts.sql',
    '0019_planned_item_scheduling.sql',
    '0022_planned_item_ride_options.sql',
    '0023_trip_touring_hours.sql',
    '0045_trip_walk_wait_weighting.sql',
  ]) {
    applyMigration(db, m);
  }
  if (withStays) applyMigration(db, '0073_trip_lodging_stays.sql');

  const statements: string[] = [];
  const compat = withForUpdateCompat(rawPool) as unknown as {
    query: (text: string, params?: unknown[]) => Promise<any>;
    connect: () => Promise<{ query: (text: string, params?: unknown[]) => Promise<any>; release: () => void }>;
  };
  const pool = {
    query: (text: string, params?: unknown[]) => {
      statements.push(text);
      return compat.query(text, params);
    },
    async connect() {
      const client = await compat.connect();
      return {
        query: (text: string, params?: unknown[]) => {
          statements.push(text);
          return client.query(text, params);
        },
        release: () => client.release(),
      };
    },
  } as unknown as DbPool;

  const repo = createTripRepo(pool, NOOP_DEPS);

  return {
    pool,
    repo,
    statements,
    async seedUser(name = 'Organizer') {
      const id = randomUUID();
      await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, [
        id,
        `${id}@example.com`,
        'argon2id$seeded',
      ]);
      await pool.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [id, name]);
      return id;
    },
    async seedResort(name, active = true) {
      const id = randomUUID();
      await pool.query(`INSERT INTO resorts (id, name, active) VALUES ($1, $2, $3)`, [id, name, active]);
      return id;
    },
    async seedTrip(creatorId, startDate, endDate) {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES ($1, $2, 'Trip', '', $3, $4)`,
        [id, creatorId, startDate, endDate],
      );
      return id;
    },
    async stayRows(tripId) {
      const res = await pool.query(
        `SELECT id, trip_id, position, lodging_kind, resort_id, place_name, check_in, check_out, party_keys
           FROM trip_stays WHERE trip_id = $1 ORDER BY id`,
        [tripId],
      );
      return res.rows as Record<string, unknown>[];
    },
    async tripResortIds(tripId) {
      const res = await pool.query(`SELECT resort_id FROM trip_resorts WHERE trip_id = $1`, [tripId]);
      return (res.rows as { resort_id: string }[]).map((r) => r.resort_id).sort();
    },
    async inTransaction(fn) {
      const client = (await pool.connect()) as unknown as PoolClient;
      try {
        await client.query('BEGIN');
        const out = await fn(client);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Stay input builders
// ---------------------------------------------------------------------------

export function resortStay(resortId: string, checkIn?: string, checkOut?: string, id?: string): TripStayInput {
  return {
    lodgingKind: 'resort',
    resortId,
    ...(checkIn !== undefined && checkOut !== undefined ? { checkIn, checkOut } : {}),
    ...(id !== undefined ? { id } : {}),
  };
}

export function offsiteStay(placeName: string, checkIn?: string, checkOut?: string, id?: string): TripStayInput {
  return {
    lodgingKind: 'offsite',
    placeName,
    ...(checkIn !== undefined && checkOut !== undefined ? { checkIn, checkOut } : {}),
    ...(id !== undefined ? { id } : {}),
  };
}
