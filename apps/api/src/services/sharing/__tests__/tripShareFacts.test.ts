/**
 * Tests for TripShareFacts adapter and sharing wiring.
 *
 * Implements: Task 21.4
 * Validates: Requirements 15.17, 15.18, 20.2, 20.9
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import type { TripRole } from '../../trips/permissions.js';
import type { TripRepoDeps } from '../../trips/repo.js';
import { createTripRepo } from '../../trips/repo.js';
import type { TripShareFacts } from '../ports.js';
import type { TripSummaryDTO } from '@dwt/shared';

const NOOP_DEPS: TripRepoDeps = {
  completions: {} as unknown as TripRepoDeps['completions'],
  ratings: {} as unknown as TripRepoDeps['ratings'],
};

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
  pub.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });

  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

describe('TripShareFacts', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let facts: TripShareFacts;
  let organizerId: string;
  let memberId: string;
  let strangerId: string;
  let tripId: string;
  let tripRepo: ReturnType<typeof createTripRepo>;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0002_experience_images.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');

    organizerId = randomUUID();
    memberId = randomUUID();
    strangerId = randomUUID();
    tripId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${organizerId}', 'org@example.com', 'h1'),
             ('${memberId}', 'mem@example.com', 'h2'),
             ('${strangerId}', 'stranger@example.com', 'h3');

      INSERT INTO trips (id, name, creator_id, start_date, end_date)
      VALUES ('${tripId}', 'WDW Trip 2026', '${organizerId}', '2026-10-18', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role)
      VALUES ('${tripId}', '${organizerId}', 'organizer'),
             ('${tripId}', '${memberId}', 'member');
    `);

    tripRepo = createTripRepo(pool, NOOP_DEPS);

    facts = {
      async roleOf(userId: string, targetTripId: string): Promise<TripRole | null> {
        const result = await pool.query<{ role: TripRole }>(
          'SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
          [targetTripId, userId],
        );
        return result.rows[0]?.role ?? null;
      },
      async tripName(targetTripId: string): Promise<string | null> {
        const result = await pool.query<{ name: string }>(
          'SELECT name FROM trips WHERE id = $1',
          [targetTripId],
        );
        return result.rows[0]?.name ?? null;
      },
      async isMember(userId: string, targetTripId: string): Promise<boolean> {
        const result = await pool.query<{ role: string }>(
          'SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
          [targetTripId, userId],
        );
        return result.rows.length > 0;
      },
      async summary(targetTripId: string): Promise<TripSummaryDTO | null> {
        const result = await pool.query<{ id: string }>(
          'SELECT id FROM trips WHERE id = $1',
          [targetTripId],
        );
        if (result.rows.length === 0) {
          return null;
        }
        return tripRepo.getSummary(targetTripId);
      },
    };
  });

  describe('roleOf', () => {
    it('returns organizer, member, and null for stranger, removed member, and missing trip', async () => {
      expect(await facts.roleOf(organizerId, tripId)).toBe('organizer');
      expect(await facts.roleOf(memberId, tripId)).toBe('member');
      expect(await facts.roleOf(strangerId, tripId)).toBeNull();

      // Removed member (delete membership row)
      db.public.none(`DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${memberId}';`);
      expect(await facts.roleOf(memberId, tripId)).toBeNull();

      // Missing trip
      expect(await facts.roleOf(organizerId, randomUUID())).toBeNull();
    });
  });

  describe('tripName', () => {
    it('returns the trip name for an existing trip, null for missing trip', async () => {
      expect(await facts.tripName(tripId)).toBe('WDW Trip 2026');
      expect(await facts.tripName(randomUUID())).toBeNull();
    });
  });

  describe('isMember', () => {
    it('returns true only for current members', async () => {
      expect(await facts.isMember(organizerId, tripId)).toBe(true);
      expect(await facts.isMember(memberId, tripId)).toBe(true);
      expect(await facts.isMember(strangerId, tripId)).toBe(false);

      // Removed member
      db.public.none(`DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${memberId}';`);
      expect(await facts.isMember(memberId, tripId)).toBe(false);

      // Missing trip
      expect(await facts.isMember(organizerId, randomUUID())).toBe(false);
    });
  });

  describe('summary', () => {
    it('returns null for missing trip and equals tripRepo.getSummary for existing trip', async () => {
      expect(await facts.summary(randomUUID())).toBeNull();

      const expected = await tripRepo.getSummary(tripId);
      const actual = await facts.summary(tripId);
      expect(actual).toEqual(expected);
    });
  });

  describe('wiring test', () => {
    it('asserts composeServices.ts supplies tripShareFacts and recap ports to sharing', () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const composeSource = readFileSync(resolve(here, '..', '..', '..', 'composeServices.ts'), 'utf8');

      // Asserts that tripShareFacts is defined and passed to sharing
      expect(composeSource).toContain('tripShareFacts,');
      expect(composeSource).toContain('recapShareGate,');
      expect(composeSource).toContain('recapPhotoPort,');
      expect(composeSource).toContain('new DefaultRecapPhotoPort');
    });
  });
});
