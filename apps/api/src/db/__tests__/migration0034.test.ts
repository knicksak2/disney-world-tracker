import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// pg-mem harness (mirrors the other migrationNNNN.test.ts files)
// ---------------------------------------------------------------------------

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

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  // pg-mem lacks gin_trgm_ops; strip GIN indexes like the other harnesses.
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  // pg-mem does not implement the `AT TIME ZONE` operator (it throws
  // "operator does not exist: timestamp with time zone AT TIME ZONE text").
  // Production Postgres runs the real operator to derive the WDW calendar
  // date; here we strip the `AT TIME ZONE <zone>` clause so the surrounding
  // `::date` / `::timestamp` casts still execute. This is the same class of
  // engine-gap shim as the GIN-index strip above and the `FOR UPDATE` strip in
  // the repo integration harness. Seed data in the backfill tests uses a
  // mid-day-UTC timestamp so the derived calendar date is identical with or
  // without the timezone shift, keeping the assertions faithful.
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

const BASE_MIGRATIONS = ['0001_init.sql', '0015_trips.sql'];

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedUser(db: IMemoryDb, email: string): string {
  const id = randomUUID();
  db.public.none(
    `INSERT INTO users (id, email, password_hash) VALUES ('${id}', '${email}', 'hash')`,
  );
  return id;
}

function seedExperience(db: IMemoryDb, name: string): string {
  const id = randomUUID();
  db.public.none(
    `INSERT INTO experiences (id, upstream_entity_id, name, park, category)
     VALUES ('${id}', 'upstream-${id}', '${name}', 'Magic Kingdom', 'Ride')`,
  );
  return id;
}

function seedTrip(db: IMemoryDb, creatorId: string): string {
  const id = randomUUID();
  db.public.none(
    `INSERT INTO trips (id, creator_id, name, start_date, end_date)
     VALUES ('${id}', '${creatorId}', 'Disney 2026', '2026-01-01', '2026-01-05')`,
  );
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migration 0034_experience_logs', () => {
  let db: IMemoryDb;

  beforeEach(() => {
    db = buildPgMemDatabase();
    for (const name of BASE_MIGRATIONS) {
      applyMigration(db, name);
    }
  });

  it('creates experience_logs and links trip_log_entries.log_id on empty tables', () => {
    applyMigration(db, '0034_experience_logs.sql');

    // Table exists and accepts a well-formed row.
    const userId = seedUser(db, 'a@example.com');
    const experienceId = seedExperience(db, 'Space Mountain');
    const logId = randomUUID();
    db.public.none(
      `INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, rating, note)
       VALUES ('${logId}', '${userId}', '${experienceId}', '2026-01-02', 'America/New_York', 8, 'Great ride')`,
    );
    const rows = db.public.many(
      `SELECT rating, note, user_tz FROM experience_logs WHERE id = '${logId}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rating).toBe(8);
    expect(rows[0].note).toBe('Great ride');
  });

  it('enforces the rating 1..10 CHECK constraint', () => {
    applyMigration(db, '0034_experience_logs.sql');
    const userId = seedUser(db, 'b@example.com');
    const experienceId = seedExperience(db, 'Haunted Mansion');
    expect(() =>
      db.public.none(
        `INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, rating)
         VALUES ('${randomUUID()}', '${userId}', '${experienceId}', '2026-01-02', 'America/New_York', 11)`,
      ),
    ).toThrow(/check/i);
  });

  it('enforces the note 1..2000 length CHECK constraint', () => {
    applyMigration(db, '0034_experience_logs.sql');
    const userId = seedUser(db, 'c@example.com');
    const experienceId = seedExperience(db, 'Pirates');
    expect(() =>
      db.public.none(
        `INSERT INTO experience_logs (id, user_id, experience_id, visited_on, user_tz, note)
         VALUES ('${randomUUID()}', '${userId}', '${experienceId}', '2026-01-02', 'America/New_York', '')`,
      ),
    ).toThrow(/check/i);
  });

  it('backfills an experience_logs row for each pre-existing trip_log_entry', () => {
    // Seed a trip log entry BEFORE the migration so the backfill sees it.
    const userId = seedUser(db, 'd@example.com');
    const experienceId = seedExperience(db, 'Splash Mountain');
    const tripId = seedTrip(db, userId);
    const entryId = randomUUID();
    db.public.none(
      `INSERT INTO trip_log_entries (id, trip_id, member_id, experience_id, created_at)
       VALUES ('${entryId}', '${tripId}', '${userId}', '${experienceId}', '2026-01-03T15:00:00Z')`,
    );

    applyMigration(db, '0034_experience_logs.sql');

    // The backfill materialized exactly one log for this member/experience,
    // and stamped trip_log_entries.log_id to point at it.
    const logs = db.public.many(
      `SELECT id, user_id, experience_id, visited_on, user_tz FROM experience_logs
       WHERE user_id = '${userId}' AND experience_id = '${experienceId}'`,
    );
    expect(logs).toHaveLength(1);
    // created_at is 2026-01-03T15:00:00Z; the WDW calendar date is 2026-01-03.
    const visited = logs[0].visited_on;
    const visitedYmd =
      visited instanceof Date ? visited.toISOString().slice(0, 10) : String(visited).slice(0, 10);
    expect(visitedYmd).toBe('2026-01-03');
    expect(logs[0].user_tz).toBe('America/New_York');

    const entry = db.public.many(
      `SELECT log_id FROM trip_log_entries WHERE id = '${entryId}'`,
    );
    expect(entry[0].log_id).toBe(logs[0].id);
  });

  it('backfills a log for a completion not represented by any trip log', () => {
    const userId = seedUser(db, 'e@example.com');
    const experienceId = seedExperience(db, 'Peter Pan Flight');
    db.public.none(
      `INSERT INTO completions (user_id, experience_id, completed_on, user_tz)
       VALUES ('${userId}', '${experienceId}', '2025-12-25', 'America/New_York')`,
    );

    applyMigration(db, '0034_experience_logs.sql');

    const logs = db.public.many(
      `SELECT visited_on, user_tz FROM experience_logs
       WHERE user_id = '${userId}' AND experience_id = '${experienceId}'`,
    );
    expect(logs).toHaveLength(1);
  });

  it('makes trip_log_entries.log_id NOT NULL after backfill', () => {
    applyMigration(db, '0034_experience_logs.sql');
    const userId = seedUser(db, 'f@example.com');
    const experienceId = seedExperience(db, 'Jungle Cruise');
    const tripId = seedTrip(db, userId);
    // Inserting a trip_log_entries row without log_id must now fail.
    expect(() =>
      db.public.none(
        `INSERT INTO trip_log_entries (id, trip_id, member_id, experience_id)
         VALUES ('${randomUUID()}', '${tripId}', '${userId}', '${experienceId}')`,
      ),
    ).toThrow(/null/i);
  });
});
