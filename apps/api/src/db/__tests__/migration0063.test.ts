/**
 * Migration test for `0063_trip_photos.sql`.
 *
 * Implements: Task 18.2
 * Validates: Requirements 14.1, 15.2, 15.6
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

function buildPgMemDatabase(): IMemoryDb {
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
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  db.public.registerFunction({
    name: 'lower',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.toLowerCase() : ''),
  });
  db.public.registerFunction({
    name: 'trim',
    args: [DataType.text],
    returns: DataType.text,
    implementation: (s: unknown): string => (typeof s === 'string' ? s.trim() : ''),
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  return db;
}

function migrationPath(name: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'migrations', name);
}

function applyMigration(db: IMemoryDb, name: string): void {
  let sql = readFileSync(migrationPath(name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
}

describe('migration 0063_trip_photos (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;
  let tripId: string;
  let expId: string;

  beforeEach(async () => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as Pool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0018_drop_rode_with_confirmed_feed.sql');
    applyMigration(db, '0038_pin_showcase_share_kind.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');

    userId = randomUUID();
    tripId = randomUUID();
    expId = randomUUID();

    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'user@example.com', 'hash')`,
      [userId],
    );
    await pool.query(
      `INSERT INTO trips (id, name, start_date, end_date, creator_id) VALUES ($1, 'Disney Trip', '2026-10-20', '2026-10-25', $2)`,
      [tripId, userId],
    );
    await pool.query(
      `INSERT INTO experiences (id, name, category, park, upstream_entity_id)
       VALUES ($1, 'Space Mountain', 'Ride', 'Magic Kingdom', 'att-space-mtn')`,
      [expId],
    );
  });

  it('the SQL file text starts with BEGIN; and ends with COMMIT;', () => {
    const rawSql = readFileSync(migrationPath('0063_trip_photos.sql'), 'utf8');
    expect(rawSql).toMatch(/^\s*BEGIN;/m);
    expect(rawSql).toMatch(/^\s*COMMIT;/m);
  });

  it('reapply is a no-op (idempotent)', () => {
    expect(() => applyMigration(db, '0063_trip_photos.sql')).not.toThrow();
  });

  it('shares table has no photo_access_revoked_at column (decision D22)', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'shares' AND column_name = 'photo_access_revoked_at'`,
    );
    expect(res.rows).toHaveLength(0);
  });

  describe('trip_feed_items type constraint', () => {
    it('accepts member_post', async () => {
      const feedItemId = randomUUID();
      await expect(
        pool.query(
          `INSERT INTO trip_feed_items (id, trip_id, actor_id, type, metadata)
           VALUES ($1, $2, $3, 'member_post', '{}'::jsonb)`,
          [feedItemId, tripId, userId],
        ),
      ).resolves.toBeDefined();
    });

    it('accepts all prior feed types', async () => {
      const priorTypes = ['trip_created', 'member_joined', 'completion_logged', 'rating_recorded'];
      for (const t of priorTypes) {
        const id = randomUUID();
        await expect(
          pool.query(
            `INSERT INTO trip_feed_items (id, trip_id, actor_id, type, metadata)
             VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
            [id, tripId, userId, t],
          ),
        ).resolves.toBeDefined();
      }
    });

    it('rejects an unknown feed type', async () => {
      const id = randomUUID();
      await expect(
        pool.query(
          `INSERT INTO trip_feed_items (id, trip_id, actor_id, type, metadata)
           VALUES ($1, $2, $3, 'invalid_feed_type', '{}'::jsonb)`,
          [id, tripId, userId],
        ),
      ).rejects.toThrow();
    });
  });

  describe('shares payload_kind and experience checks', () => {
    it('accepts tripSummary with NULL experience_id', async () => {
      const shareId = randomUUID();
      const payload = JSON.stringify({
        kind: 'tripSummary',
        tripId,
        tripName: 'Disney Trip',
        sharerDisplayName: 'Alice',
        includePhotos: true,
      });

      await expect(
        pool.query(
          `INSERT INTO shares (id, sender_id, experience_id, payload_kind, payload_snapshot)
           VALUES ($1, $2, NULL, 'tripSummary', $3::jsonb)`,
          [shareId, userId, payload],
        ),
      ).resolves.toBeDefined();

      const r = await pool.query(`SELECT payload_kind FROM shares WHERE id = $1`, [shareId]);
      expect(r.rows[0]?.payload_kind).toBe('tripSummary');
    });

    it('rejects tripSummary with a non-null experience_id', async () => {
      const shareId = randomUUID();
      const payload = JSON.stringify({
        kind: 'tripSummary',
        tripId,
        tripName: 'Disney Trip',
        sharerDisplayName: 'Alice',
        includePhotos: true,
      });

      await expect(
        pool.query(
          `INSERT INTO shares (id, sender_id, experience_id, payload_kind, payload_snapshot)
           VALUES ($1, $2, $3, 'tripSummary', $4::jsonb)`,
          [shareId, userId, expId, payload],
        ),
      ).rejects.toThrow();
    });

    it('still accepts prior share kinds (experience, progress, pinShowcase)', async () => {
      // experience with experience_id
      await expect(
        pool.query(
          `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
           VALUES ($1, $2, 'experience', '{}'::jsonb)`,
          [userId, expId],
        ),
      ).resolves.toBeDefined();

      // progress with NULL experience_id
      await expect(
        pool.query(
          `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
           VALUES ($1, NULL, 'progress', '{}'::jsonb)`,
          [userId],
        ),
      ).resolves.toBeDefined();

      // pinShowcase with NULL experience_id
      await expect(
        pool.query(
          `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
           VALUES ($1, NULL, 'pinShowcase', '{}'::jsonb)`,
          [userId],
        ),
      ).resolves.toBeDefined();
    });

    it('rejects an unknown payload kind', async () => {
      await expect(
        pool.query(
          `INSERT INTO shares (sender_id, experience_id, payload_kind, payload_snapshot)
           VALUES ($1, NULL, 'unknownKind', '{}'::jsonb)`,
          [userId],
        ),
      ).rejects.toThrow();
    });
  });

  describe('foreign key fk_photos_feed_item', () => {
    it('deleting a feed item sets photos.feed_item_id to NULL (ON DELETE SET NULL)', async () => {
      const feedItemId = randomUUID();
      await pool.query(
        `INSERT INTO trip_feed_items (id, trip_id, actor_id, type, metadata)
         VALUES ($1, $2, $3, 'member_post', '{}'::jsonb)`,
        [feedItemId, tripId, userId],
      );

      const photoId = randomUUID();
      await pool.query(
        `INSERT INTO photos (
           id, owner_id, target_kind, target_id, scope_id, feed_item_id,
           status, harm_verdict, full_etag, thumb_etag,
           object_key, thumb_key, byte_size, thumb_byte_size, width, height
         ) VALUES (
           $1, $2, 'trip', $3, $3, $4,
           'approved', 'pass', '"etag1"', '"etag2"',
           'p/key.jpg', 'p/thumb.jpg', 1000, 200, 1280, 720
         )`,
        [photoId, userId, tripId, feedItemId],
      );

      // Verify photo has feed_item_id set
      const before = await pool.query(`SELECT feed_item_id FROM photos WHERE id = $1`, [photoId]);
      expect(before.rows[0]?.feed_item_id).toBe(feedItemId);

      // Delete the feed item
      await pool.query(`DELETE FROM trip_feed_items WHERE id = $1`, [feedItemId]);

      // Verify photo still exists but feed_item_id is now NULL
      const after = await pool.query(`SELECT feed_item_id, status FROM photos WHERE id = $1`, [photoId]);
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0]?.feed_item_id).toBeNull();
      expect(after.rows[0]?.status).toBe('approved');
    });
  });
});
