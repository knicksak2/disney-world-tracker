import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import type { Pool } from 'pg';

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
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
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

function stripForUpdate(text: string): string {
  return text.replace(/\s+FOR\s+UPDATE(\s+OF\s+\w+)?/giu, '');
}

function adaptAnyArrayParams(
  text: string,
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined || !/=\s*ANY\(\$\d+(?:::[\w\[\]]+)?\)/i.test(text)) {
    return [text, params];
  }
  const newParams = [...params];
  const newText = text.replace(/=\s*ANY\(\$(\d+)(?:::[\w\[\]]+)?\)/gi, (match, num: string) => {
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

function adaptSql(text: string, params?: ReadonlyArray<unknown>): [string, ReadonlyArray<unknown> | undefined] {
  return adaptAnyArrayParams(stripForUpdate(text), params);
}

export function setupTestDb(): { db: IMemoryDb; pool: Pool } {
  const db = buildPgMemDatabase();
  applyMigration(db, '0001_init.sql');
  db.public.none(RESORTS_STUB);
  applyMigration(db, '0015_trips.sql');
  applyMigration(db, '0060_trip_expenses.sql');
  // The money reads go through the 0064 visibility views (profile_identity needs profiles.avatar_preset from 0013).
  applyMigration(db, '0013_avatar_presets.sql');
  applyMigration(db, '0064_account_deletion.sql');

  const rawPool = db.adapters.createPg().Pool;
  const poolInstance = new rawPool();

  const wrappedPool = {
    query(text: string, params?: ReadonlyArray<unknown>) {
      const [t, p] = adaptSql(text, params);
      return poolInstance.query(t, p);
    },
    async connect() {
      const client = await poolInstance.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const [t, p] = adaptSql(text, params);
          return client.query(t, p);
        },
        release() {
          client.release();
        },
      };
    },
  } as unknown as Pool;

  return { db, pool: wrappedPool };
}

export interface SeedTestData {
  user1Id: string;
  user2Id: string;
  user3Id: string;
  tripId: string;
  guestId: string;
  restaurantExperienceId: string;
  rideExperienceId: string;
  resortId: string;
}

export async function seedTestData(pool: Pool): Promise<SeedTestData> {
  const user1Id = randomUUID();
  const user2Id = randomUUID();
  const user3Id = randomUUID();
  const tripId = randomUUID();
  const guestId = randomUUID();
  const restaurantExperienceId = randomUUID();
  const rideExperienceId = randomUUID();
  const resortId = randomUUID();

  // Users & Profiles
  await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, 'alice@example.com', 'hash1'),
            ($2, 'bob@example.com', 'hash2'),
            ($3, 'carol@example.com', 'hash3')`,
    [user1Id, user2Id, user3Id],
  );
  await pool.query(
    `INSERT INTO profiles (user_id, display_name)
     VALUES ($1, 'Alice'),
            ($2, 'Bob'),
            ($3, 'Carol')`,
    [user1Id, user2Id, user3Id],
  );

  // Trip
  await pool.query(
    `INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
     VALUES ($1, $2, 'Disney Vacation', 'Family fun', '2026-10-01', '2026-10-10')`,
    [tripId, user1Id],
  );

  // Trip Memberships (Alice is organizer, Bob and Carol are members)
  await pool.query(
    `INSERT INTO trip_memberships (trip_id, user_id, role)
     VALUES ($1, $2, 'organizer'),
            ($1, $3, 'member'),
            ($1, $4, 'member')`,
    [tripId, user1Id, user2Id, user3Id],
  );

  // Guest (sponsored by Alice)
  await pool.query(
    `INSERT INTO trip_guests (id, trip_id, sponsor_member_id, name)
     VALUES ($1, $2, $3, 'Little Timmy')`,
    [guestId, tripId, user1Id],
  );

  // Experiences
  await pool.query(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category, description)
     VALUES ($1, 'be-our-guest', 'Be Our Guest', 'Magic Kingdom', 'Restaurant', 'Fine dining'),
            ($2, 'space-mountain', 'Space Mountain', 'Magic Kingdom', 'Ride', 'Roller coaster')`,
    [restaurantExperienceId, rideExperienceId],
  );

  // Resort
  await pool.query(
    `INSERT INTO resorts (id, name, active)
     VALUES ($1, 'Contemporary Resort', true)`,
    [resortId],
  );

  return {
    user1Id,
    user2Id,
    user3Id,
    tripId,
    guestId,
    restaurantExperienceId,
    rideExperienceId,
    resortId,
  };
}
