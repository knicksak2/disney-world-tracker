/**
 * Tests for AdminRepo photo queue and moderation operations using pg-mem.
 *
 * Implements: Task 10.1
 * Validates: Requirements 8.12, 16.6, 18.1, 18.4, 18.5, 18.6, 18.8, 18.11, Property 32
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createAdminRepo, type AdminRepo } from '../repo.js';

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
  pub.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s: unknown): number => (typeof s === 'string' ? s.length : 0),
  });
  pub.registerFunction({
    name: 'to_char',
    args: [DataType.timestamp, DataType.text],
    returns: DataType.text,
    implementation: (d: Date, fmt: string) => {
      if (fmt === 'YYYY-MM-DD') return d.toISOString().slice(0, 10);
      return d.toISOString();
    },
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

describe('AdminRepo Photo Queue & Moderation (Task 10.1)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let redis: Redis;
  let repo: AdminRepo;

  let uploader1Id: string;
  let uploader2Id: string;
  let reporterId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;
    redis = new RedisMock() as unknown as Redis;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');

    uploader1Id = randomUUID();
    uploader2Id = randomUUID();
    reporterId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${uploader1Id}', 'uploader1@example.com', 'h1'),
             ('${uploader2Id}', 'uploader2@example.com', 'h2'),
             ('${reporterId}', 'reporter@example.com', 'h3');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${uploader1Id}', 'Alice Wonderland', 'castle'),
             ('${uploader2Id}', 'Bob Builder', 'wishing-star'),
             ('${reporterId}', 'Carol Critic', 'ear-balloon');
    `);

    repo = createAdminRepo(pool, redis);
  });

  function insertPhoto(
    id: string,
    ownerId: string,
    status: 'uploading' | 'pending' | 'approved' | 'rejected' | 'needs_review' | 'hidden' | 'deleted',
    createdAt = new Date('2026-10-18T10:00:00Z'),
    visionFields: unknown = null
  ) {
    const isServed = status === 'approved' || status === 'hidden';
    const harmVerdict = isServed ? "'pass'" : 'NULL';
    const visionVerdict = isServed ? "'pass'" : 'NULL';
    const fullEtag = isServed ? "'full-etag'" : 'NULL';
    const thumbEtag = isServed ? "'thumb-etag'" : 'NULL';
    const servedAt = isServed ? `'${createdAt.toISOString()}'` : 'NULL';
    const rejectReason = status === 'rejected' ? "'not_food'" : 'NULL';
    const hiddenReason = status === 'hidden' ? "'reports'" : 'NULL';
    const vf = visionFields ? `'${JSON.stringify(visionFields)}'` : 'NULL';

    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id, status,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height,
        created_at, sort_at, harm_verdict, vision_verdict, full_etag, thumb_etag, served_at,
        reject_reason, hidden_reason, vision_fields
      ) VALUES (
        '${id}', '${ownerId}', 'food_log', '${randomUUID()}', '${randomUUID()}', '${status}',
        'u/${id}/full.jpg', 'u/${id}/thumb.jpg', 50000, 5000, 800, 600,
        '${createdAt.toISOString()}', '${createdAt.toISOString()}', ${harmVerdict}, ${visionVerdict},
        ${fullEtag}, ${thumbEtag}, ${servedAt},
        ${rejectReason}, ${hiddenReason}, ${vf}
      );
    `);
  }

  function insertReport(photoId: string, repId: string, reason = 'inappropriate', status = 'open') {
    db.public.none(`
      INSERT INTO photo_reports (id, photo_id, reporter_id, reason, status)
      VALUES ('${randomUUID()}', '${photoId}', '${repId}', '${reason}', '${status}');
    `);
  }

  it('listPhotoQueue contains exactly the intended rows (hidden, needs_review, open reports) oldest first, with profile display name, counts, reasons, and vision fields', async () => {
    const p1Hidden = randomUUID();
    const p2NeedsReview = randomUUID();
    const p3ReportedApproved = randomUUID();
    const p4CleanApproved = randomUUID(); // Not in queue
    const p5DismissedApproved = randomUUID(); // Not in queue

    // Oldest to newest created_at:
    // 1. p2NeedsReview (08:00)
    // 2. p1Hidden (09:00)
    // 3. p3ReportedApproved (10:00)
    insertPhoto(p2NeedsReview, uploader2Id, 'needs_review', new Date('2026-10-18T08:00:00Z'), { score: 0.95 });
    insertPhoto(p1Hidden, uploader1Id, 'hidden', new Date('2026-10-18T09:00:00Z'));
    insertPhoto(p3ReportedApproved, uploader1Id, 'approved', new Date('2026-10-18T10:00:00Z'));
    insertPhoto(p4CleanApproved, uploader2Id, 'approved', new Date('2026-10-18T11:00:00Z'));
    insertPhoto(p5DismissedApproved, uploader1Id, 'approved', new Date('2026-10-18T12:00:00Z'));

    // Reports on p1Hidden (1 open report)
    insertReport(p1Hidden, reporterId, 'not_food', 'open');

    // Reports on p3ReportedApproved (2 open reports with different reasons)
    const reporter2 = randomUUID();
    db.public.none(`INSERT INTO users (id, email, password_hash) VALUES ('${reporter2}', 'rep2@example.com', 'h');`);
    insertReport(p3ReportedApproved, reporterId, 'inappropriate', 'open');
    insertReport(p3ReportedApproved, reporter2, 'spam', 'open');

    // Dismissed report on p5DismissedApproved (should not qualify)
    insertReport(p5DismissedApproved, reporterId, 'other', 'dismissed');

    const queue = await repo.listPhotoQueue();

    expect(queue).toHaveLength(3);

    // Oldest first
    expect(queue[0]!.id).toBe(p2NeedsReview);
    expect(queue[0]!.status).toBe('needs_review');
    expect(queue[0]!.uploaderName).toBe('Bob Builder');
    expect(queue[0]!.avatarPreset).toBe('wishing-star');
    expect(queue[0]!.visionFields).toEqual({ score: 0.95 });
    expect(queue[0]!.reportCount).toBe(0);
    expect(queue[0]!.reportReasons).toEqual([]);

    expect(queue[1]!.id).toBe(p1Hidden);
    expect(queue[1]!.status).toBe('hidden');
    expect(queue[1]!.uploaderName).toBe('Alice Wonderland');
    expect(queue[1]!.reportCount).toBe(1);
    expect(queue[1]!.reportReasons).toEqual(['not_food']);

    expect(queue[2]!.id).toBe(p3ReportedApproved);
    expect(queue[2]!.status).toBe('approved');
    expect(queue[2]!.uploaderName).toBe('Alice Wonderland');
    expect(queue[2]!.reportCount).toBe(2);
    expect(queue[2]!.reportReasons).toContain('inappropriate');
    expect(queue[2]!.reportReasons).toContain('spam');
  });

  it('removePhoto marks open reports upheld, increments photo_upload_strikes, and strikes survive sweep hard-delete (Property 32 via AdminRepo)', async () => {
    const photoId = randomUUID();
    insertPhoto(photoId, uploader1Id, 'hidden');

    const r2 = randomUUID();
    const r3 = randomUUID();
    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${r2}', 'r2@example.com', 'h'), ('${r3}', 'r3@example.com', 'h');
    `);

    insertReport(photoId, reporterId, 'inappropriate', 'open');
    insertReport(photoId, r2, 'spam', 'open');
    insertReport(photoId, r3, 'not_food', 'open');

    // Initial strikes count is 0
    const initialStrikes = await repo.getUploaderStrikes(photoId);
    expect(initialStrikes).toBe(0);

    // Operator removes the photo
    const removeRes = await repo.removePhoto(photoId);
    expect(removeRes.removed).toBe(true);
    expect(removeRes.ownerId).toBe(uploader1Id);

    // Check photo is marked deleted
    const photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${photoId}';`);
    expect(photoRow.status).toBe('deleted');

    // All 3 reports are now upheld
    const openReports = db.public.many(`SELECT status FROM photo_reports WHERE photo_id = '${photoId}' AND status = 'open';`);
    expect(openReports).toHaveLength(0);
    const upheldReports = db.public.many(`SELECT status FROM photo_reports WHERE photo_id = '${photoId}' AND status = 'upheld';`);
    expect(upheldReports).toHaveLength(3);

    // Strikes incremented by exactly 1 (not 3)
    const strikesAfter = await repo.getUploaderStrikes(photoId);
    expect(strikesAfter).toBe(1);

    // Second removal of the already deleted photo is a no-op and does not increment strikes
    const removeRes2 = await repo.removePhoto(photoId);
    expect(removeRes2.removed).toBe(false);
    expect(await repo.getUploaderStrikes(photoId)).toBe(1);

    // Sweep simulation: hard-delete the deleted photo and cascade reports
    db.public.none(`DELETE FROM photos WHERE id = '${photoId}' AND status = 'deleted';`);

    // Reports are gone
    const remainingReports = db.public.many(`SELECT id FROM photo_reports WHERE photo_id = '${photoId}';`);
    expect(remainingReports).toHaveLength(0);

    // Strike row survives in photo_upload_strikes table!
    const strikeRow = db.public.one(`SELECT upheld_count FROM photo_upload_strikes WHERE user_id = '${uploader1Id}';`);
    expect(strikeRow.upheld_count).toBe(1);
  });

  it('banUploader resolves owner from photo in any status including deleted unswept photo (Requirement 18.11)', async () => {
    const photoId = randomUUID();
    insertPhoto(photoId, uploader1Id, 'deleted');

    // Photo is deleted but not yet hard-deleted by sweep
    const res = await repo.banUploader(photoId, 'Content violation');
    expect(res.banned).toBe(true);
    expect(res.userId).toBe(uploader1Id);

    // Verify row in photo_upload_bans
    const banRow = db.public.one(`SELECT user_id, reason FROM photo_upload_bans WHERE user_id = '${uploader1Id}';`);
    expect(banRow.user_id).toBe(uploader1Id);
    expect(banRow.reason).toBe('Content violation');
  });

  it('restorePhoto moves hidden photo to approved, hidden_reason cleared, and preserves verdicts (served CHECKs still hold)', async () => {
    const photoId = randomUUID();
    insertPhoto(photoId, uploader1Id, 'hidden');

    const ok = await repo.restorePhoto(photoId);
    expect(ok).toBe(true);

    const row = db.public.one(`SELECT status, hidden_reason, harm_verdict, vision_verdict FROM photos WHERE id = '${photoId}';`);
    expect(row.status).toBe('approved');
    expect(row.hidden_reason).toBeNull();
    expect(row.harm_verdict).toBe('pass');
    expect(row.vision_verdict).toBe('pass');
  });

  it('restorePhoto plus dismissPhotoReports clears reports so a new report does not re-hide at the threshold', async () => {
    const photoId = randomUUID();
    insertPhoto(photoId, uploader1Id, 'hidden');
    insertReport(photoId, reporterId, 'inappropriate', 'open');

    // 1. Restore photo
    await repo.restorePhoto(photoId);

    // 2. Dismiss open reports
    const dismissedCount = await repo.dismissPhotoReports(photoId);
    expect(dismissedCount).toBe(1);

    // Open reports are now 0
    const openReports = db.public.many(`SELECT id FROM photo_reports WHERE photo_id = '${photoId}' AND status = 'open';`);
    expect(openReports).toHaveLength(0);

    // The photo is approved and no longer in the queue
    const queue = await repo.listPhotoQueue();
    expect(queue.find((q) => q.id === photoId)).toBeUndefined();
  });

  it('getPhotoUsage returns daily usage metrics sorted by day descending', async () => {
    db.public.none(`
      INSERT INTO photo_usage_daily (
        day, uploads, upload_bytes, harm_calls, vision_calls, vision_prompt_tokens,
        vision_output_tokens, rejections, needs_review, exif_present
      ) VALUES
        ('2026-10-17', 10, 100000, 10, 8, 1000, 200, 1, 0, 0),
        ('2026-10-18', 25, 250000, 25, 20, 2500, 500, 2, 1, 1);
    `);

    const usage = await repo.getPhotoUsage(14);
    expect(usage).toHaveLength(2);

    expect(usage[0]!.uploads).toBe(25);
    expect(usage[0]!.uploadBytes).toBe(250000);
    expect(usage[0]!.exifPresent).toBe(1);

    expect(usage[1]!.uploads).toBe(10);
    expect(usage[1]!.uploadBytes).toBe(100000);
    expect(usage[1]!.exifPresent).toBe(0);
  });
});
