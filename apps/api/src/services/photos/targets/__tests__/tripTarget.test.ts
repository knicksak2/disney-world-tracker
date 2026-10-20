/**
 * Tests for TripTarget adapter using pg-mem.
 *
 * Implements: Task 19.1
 * Validates: Requirements 12.1, 12.2, 12.4, 12.5, 12.6, 12.8, 12.9
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../../../errors/AppError.js';
import type { DbPool } from '../../../../db/pool.js';
import { createPhotosRepo } from '../../repo.js';
import { TripTarget } from '../tripTarget.js';

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
  return resolve(here, '..', '..', '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

describe('TripTarget', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let target: TripTarget;
  let organizerId: string;
  let memberId: string;
  let nonMemberId: string;
  let tripId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');

    organizerId = randomUUID();
    memberId = randomUUID();
    nonMemberId = randomUUID();
    tripId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${organizerId}', 'org@example.com', 'h1'),
             ('${memberId}', 'mem@example.com', 'h2'),
             ('${nonMemberId}', 'stranger@example.com', 'h3');

      INSERT INTO trips (id, name, creator_id, start_date, end_date)
      VALUES ('${tripId}', 'WDW Trip 2026', '${organizerId}', '2026-10-18', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role)
      VALUES ('${tripId}', '${organizerId}', 'organizer'),
             ('${tripId}', '${memberId}', 'member');
    `);

    target = new TripTarget({
      pool,
      maxPerTrip: 300,
      tripEnabled: true,
    });
  });

  it('exposes expected target metadata and configuration', () => {
    expect(target.kind).toBe('trip');
    expect(target.screen).toBe('harm_only');
    expect(target.maxPerTarget).toBe(300);
    expect(target.enabled).toBe(true);
  });

  describe('authorizeUpload', () => {
    it('authorizes organizer and member to upload, returning tripId as scopeId', async () => {
      const orgAuth = await target.authorizeUpload(organizerId, tripId);
      expect(orgAuth).toEqual({ scopeId: tripId });

      const memAuth = await target.authorizeUpload(memberId, tripId);
      expect(memAuth).toEqual({ scopeId: tripId });
    });

    it('rejects a non-member with trip_forbidden', async () => {
      await expect(target.authorizeUpload(nonMemberId, tripId)).rejects.toThrow(AppError);
      await expect(target.authorizeUpload(nonMemberId, tripId)).rejects.toMatchObject({
        code: 'trip_forbidden',
      });
    });

    it('rejects an upload for a non-existent trip with trip_forbidden', async () => {
      const unknownTripId = randomUUID();
      await expect(target.authorizeUpload(organizerId, unknownTripId)).rejects.toMatchObject({
        code: 'trip_forbidden',
      });
    });
  });

  describe('canViewScope', () => {
    it('returns true for member and organizer, false for non-member', async () => {
      expect(await target.canViewScope(organizerId, tripId)).toBe(true);
      expect(await target.canViewScope(memberId, tripId)).toBe(true);
      expect(await target.canViewScope(nonMemberId, tripId)).toBe(false);
    });
  });

  describe('canDeleteOthers', () => {
    it('returns true only for organizer, false for member and non-member (never throwing)', async () => {
      expect(await target.canDeleteOthers(organizerId, tripId)).toBe(true);
      expect(await target.canDeleteOthers(memberId, tripId)).toBe(false);
      expect(await target.canDeleteOthers(nonMemberId, tripId)).toBe(false);
    });
  });

  describe('findOrphanPhotoIds', () => {
    it('finds photo of a deleted trip', async () => {
      const liveTripPhotoId = randomUUID();
      const orphanTripPhotoId = randomUUID();
      const deletedTripId = randomUUID();

      // Insert photo for live trip and orphan trip
      db.public.none(`
        INSERT INTO photos (
          id, owner_id, target_kind, target_id, scope_id, status,
          object_key, thumb_key, byte_size, thumb_byte_size, width, height,
          harm_verdict, full_etag, thumb_etag
        )
        VALUES (
          '${liveTripPhotoId}', '${organizerId}', 'trip', '${tripId}', '${tripId}', 'approved',
          'p/${liveTripPhotoId}/full.jpg', 'p/${liveTripPhotoId}/thumb.jpg', 1000, 100, 800, 600,
          'pass', 'etag1', 'etag2'
        ),
        (
          '${orphanTripPhotoId}', '${organizerId}', 'trip', '${deletedTripId}', '${deletedTripId}', 'approved',
          'p/${orphanTripPhotoId}/full.jpg', 'p/${orphanTripPhotoId}/thumb.jpg', 1000, 100, 800, 600,
          'pass', 'etag3', 'etag4'
        );
      `);

      const orphans = await target.findOrphanPhotoIds(10);
      expect(orphans).toEqual([orphanTripPhotoId]);
    });

    it('the wired PhotosRepo path (the production one) returns the same orphans, and ignores deleted photos and food-log photos', async () => {
      const liveTripPhotoId = randomUUID();
      const orphanTripPhotoId = randomUUID();
      const deletedOrphanPhotoId = randomUUID();
      const foodPhotoId = randomUUID();
      const goneId = randomUUID();

      // The raw SQL is exercised by the real repo method against the real tables.
      db.public.none(`
        INSERT INTO photos (
          id, owner_id, target_kind, target_id, scope_id, status,
          object_key, thumb_key, byte_size, thumb_byte_size, width, height,
          harm_verdict, vision_verdict, full_etag, thumb_etag
        )
        VALUES
        ('${liveTripPhotoId}', '${organizerId}', 'trip', '${tripId}', '${tripId}', 'approved',
         'p/${liveTripPhotoId}/full.jpg', 'p/${liveTripPhotoId}/thumb.jpg', 1000, 100, 800, 600,
         'pass', NULL, 'e1', 'e2'),
        ('${orphanTripPhotoId}', '${organizerId}', 'trip', '${goneId}', '${goneId}', 'approved',
         'p/${orphanTripPhotoId}/full.jpg', 'p/${orphanTripPhotoId}/thumb.jpg', 1000, 100, 800, 600,
         'pass', NULL, 'e3', 'e4'),
        ('${deletedOrphanPhotoId}', '${organizerId}', 'trip', '${goneId}', '${goneId}', 'deleted',
         'p/${deletedOrphanPhotoId}/full.jpg', 'p/${deletedOrphanPhotoId}/thumb.jpg', 1000, 100, 800, 600,
         NULL, NULL, NULL, NULL),
        ('${foodPhotoId}', '${organizerId}', 'food_log', '${goneId}', '${goneId}', 'approved',
         'p/${foodPhotoId}/full.jpg', 'p/${foodPhotoId}/thumb.jpg', 1000, 100, 800, 600,
         'pass', 'pass', 'e5', 'e6');
      `);

      const wired = new TripTarget({
        pool,
        photosRepo: createPhotosRepo(pool),
        maxPerTrip: 300,
        tripEnabled: true,
      });
      expect(await wired.findOrphanPhotoIds(10)).toEqual([orphanTripPhotoId]);
      // Both paths agree.
      expect(await target.findOrphanPhotoIds(10)).toEqual([orphanTripPhotoId]);
    });
  });
});
