import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import type { DbPool } from '../../../db/pool.js';

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
  if (parsed === null) return 'null';
  if (Array.isArray(parsed)) return 'array';
  if (typeof parsed === 'object') return 'object';
  if (typeof parsed === 'string') return 'string';
  if (typeof parsed === 'number') return 'number';
  if (typeof parsed === 'boolean') return 'boolean';
  return 'null';
}

export function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });

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
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'btrim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'jsonb_typeof',
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: jsonbTypeof,
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

export function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/CREATE INDEX[^;]+ON lightning_lane_single_prices[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const RESORTS_STUB = `
  CREATE TABLE IF NOT EXISTS resorts (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name   TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
`;

const EXPERIENCE_MENUS_STUB = `
  CREATE TABLE IF NOT EXISTS experience_menus (
    experience_id UUID PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
    menus         JSONB NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    shape_version SMALLINT NOT NULL DEFAULT 1,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

function stripForUpdate(text: string): string {
  return text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
}

function adaptAnyArrayParams(
  text: string,
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined || !/=\s*ANY\(\$\d+(?:::[\w[\]]+)?\)/i.test(text)) {
    return [text, params];
  }
  const newParams = [...params];
  const newText = text.replace(/=\s*ANY\(\$(\d+)(?:::[\w[\]]+)?\)/gi, (match, num: string) => {
    const arr = params[Number(num) - 1];
    if (!Array.isArray(arr)) {
      return match;
    }
    if (arr.length === 0) {
      return '= NULL';
    }
    const placeholders = arr.map((value) => {
      newParams.push(value);
      return `$${newParams.length}`;
    });
    return `IN (${placeholders.join(', ')})`;
  });
  return [newText, newParams];
}

function adaptRodeWithTags(text: string): string {
  if (text.includes('UPDATE rode_with_tags rwt')) {
    return `UPDATE rode_with_tags SET state = 'cancelled', updated_at = now() WHERE state = 'pending' AND (tagged_member_id = $2 OR log_entry_id IN (SELECT id FROM trip_log_entries WHERE trip_id = $1 AND member_id = $2))`;
  }
  return text;
}

export function adaptSql(
  text: string,
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  return adaptAnyArrayParams(adaptRodeWithTags(stripForUpdate(text)), params);
}

export function setupTestDb(): { db: IMemoryDb; pool: DbPool } {
  const db = buildPgMemDatabase();
  applyMigration(db, '0001_init.sql');
  db.public.none(RESORTS_STUB);
  db.public.none(EXPERIENCE_MENUS_STUB);
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0020_wait_time_intelligence.sql');
  applyMigration(db, '0023_trip_touring_hours.sql');
  applyMigration(db, '0060_trip_expenses.sql');
  applyMigration(db, '0013_avatar_presets.sql');
  applyMigration(db, '0064_account_deletion.sql');
  applyMigration(db, '0065_ticket_prices.sql');
  applyMigration(db, '0066_lightning_lane_prices.sql');
  applyMigration(db, '0068_trip_budget.sql');

  const rawPool = db.adapters.createPg().Pool;
  const poolInstance = new rawPool();

  const wrappedPool = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      const [t, p] = adaptSql(text, params);
      return poolInstance.query(t, p as unknown[]);
    },
    async connect() {
      const client = await poolInstance.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const [t, p] = adaptSql(text, params);
          return client.query(t, p as unknown[]);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as DbPool;

  return { db, pool: wrappedPool };
}

export interface SeedTestData {
  organizerId: string;
  memberId: string;
  otherMemberId: string;
  outsideUserId: string;
  tripId: string;
  otherTripId: string;
  guestId: string;
  otherTripGuestId: string;
}

export async function seedTestData(pool: DbPool): Promise<SeedTestData> {
  const organizerId = randomUUID();
  const memberId = randomUUID();
  const otherMemberId = randomUUID();
  const outsideUserId = randomUUID();
  const tripId = randomUUID();
  const otherTripId = randomUUID();
  const guestId = randomUUID();
  const otherTripGuestId = randomUUID();

  // Users & Profiles
  await pool.query(
    `INSERT INTO users (id, email, password_hash, deletion_state)
     VALUES ($1, 'alice@example.com', 'hash1', 'active'),
            ($2, 'bob@example.com', 'hash2', 'active'),
            ($3, 'carol@example.com', 'hash3', 'active'),
            ($4, 'david@example.com', 'hash4', 'active')`,
    [organizerId, memberId, otherMemberId, outsideUserId],
  );
  await pool.query(
    `INSERT INTO profiles (user_id, display_name)
     VALUES ($1, 'Alice Organizer'),
            ($2, 'Bob Member'),
            ($3, 'Carol Member'),
            ($4, 'David Outside')`,
    [organizerId, memberId, otherMemberId, outsideUserId],
  );

  // Trips
  await pool.query(
    `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
     VALUES ($1, $2, 'Disney Vacation', 'Trip 1', '2026-10-01', '2026-10-10'),
            ($3, $2, 'Other Trip', 'Trip 2', '2026-11-01', '2026-11-10')`,
    [tripId, organizerId, otherTripId],
  );

  // Memberships
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role)
     VALUES ($1, $2, 'organizer'),
            ($1, $3, 'member'),
            ($1, $4, 'member'),
            ($5, $2, 'organizer')`,
    [tripId, organizerId, memberId, otherMemberId, otherTripId],
  );

  // Guests
  await pool.query(
    `INSERT INTO trip_guests (id, trip_id, sponsor_member_id, name)
     VALUES ($1, $2, $3, 'Timmy (Bob Guest)'),
            ($4, $5, $6, 'Pluto (Other Trip Guest)')`,
    [guestId, tripId, memberId, otherTripGuestId, otherTripId, organizerId],
  );

  return {
    organizerId,
    memberId,
    otherMemberId,
    outsideUserId,
    tripId,
    otherTripId,
    guestId,
    otherTripGuestId,
  };
}
