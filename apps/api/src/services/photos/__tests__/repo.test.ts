/**
 * Tests for PhotosRepo using pg-mem.
 *
 * NOTE: As noted in the test plan, true lock serialization via pg_advisory_xact_lock
 * is not provable in pg-mem, so no-op stubs for hashtext and pg_advisory_xact_lock are registered.
 *
 * Implements: Task 7.1
 * Validates: Requirements 4.9, 4.10, 4.11, 5.1, 5.2, 5.3, 5.10, 5.12, 8.3, 8.4,
 *            8.5, 8.6, 8.16, 8.20, 9.4, 10.3, 10.5, 11.1, 11.2, 11.4, 19.3,
 *            19.4, 19.11, 19.12
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';

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
    name: 'hashtext',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: () => 1,
  });
  pub.registerFunction({
    name: 'pg_advisory_xact_lock',
    args: [DataType.integer],
    returns: DataType.bool,
    implementation: () => true,
    impure: true,
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

/**
 * pg-mem compatibility shim:
 * 1. Rewrites `= ANY($n)` to `IN ($a, $b, ...)`
 * 2. Rewrites correlated `NOT EXISTS (SELECT 1 FROM user_blocks ...)` to `NOT IN`
 */
function adaptPgMemSql(
  text: string,
  params?: ReadonlyArray<unknown>
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined) return [text, params];

  let adaptedText = text;
  const newParams = [...params];

  // 1. Rewrite `= ANY($n)`
  if (/=\s*ANY\(\$\d+\)/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(/=\s*ANY\(\$(\d+)\)/gi, (match, num: string) => {
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
  }

  // 2. Rewrite correlated NOT EXISTS user_blocks to NOT IN
  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE\s*\(\s*b\.blocker_id\s*=\s*\$(\d+)\s+AND\s+b\.blocked_id\s*=\s*p\.owner_id\s*\)\s*OR\s*\(\s*b\.blocker_id\s*=\s*p\.owner_id\s+AND\s+b\.blocked_id\s*=\s*\$\1\s*\)\s*\)/gi,
      (_match, viewerParam: string) => {
        return `AND (p.owner_id IS NULL OR (p.owner_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = $${viewerParam}) AND p.owner_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = $${viewerParam})))`;
      }
    );
  }

  // 3. Rewrite correlated NOT EXISTS for food_item_logs orphan query
  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+food_item_logs\s+l\s+WHERE\s+l\.id\s*=\s*p\.target_id\s*\)/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+food_item_logs\s+l\s+WHERE\s+l\.id\s*=\s*p\.target_id\s*\)/gi,
      'AND p.target_id NOT IN (SELECT l.id FROM food_item_logs l)'
    );
  }

  // 4. Rewrite correlated NOT EXISTS for trips orphan query
  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+trips\s+t\s+WHERE\s+t\.id\s*=\s*p\.target_id\s*\)/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+trips\s+t\s+WHERE\s+t\.id\s*=\s*p\.target_id\s*\)/gi,
      'AND p.target_id NOT IN (SELECT t.id FROM trips t)'
    );
  }

  return [adaptedText, newParams];
}

function withPgMemCompat(base: DbPool): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      const [t, p] = adaptPgMemSql(text, params);
      return raw.query(t, p);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          const [t, p] = adaptPgMemSql(text, params);
          return client.query(t, p);
        },
        release() {
          client.release();
        },
      } as any;
    },
  } as unknown as DbPool;
}

describe('PhotosRepo (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PhotosRepo;
  let user1Id: string;
  let user2Id: string;
  let foodItem1Id: string;
  let exp1Id: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');

    // Add avatar_preset to profiles if not present
    db.public.none('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_preset TEXT;');

    user1Id = randomUUID();
    user2Id = randomUUID();
    foodItem1Id = randomUUID();
    exp1Id = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${user1Id}', 'alice@example.com', 'h1'),
             ('${user2Id}', 'bob@example.com', 'h2');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${user1Id}', 'Alice In Wonderland', 'mickey'),
             ('${user2Id}', 'Bob Builder', 'goofy');

      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${exp1Id}', 'upstream-exp-1', 'Be Our Guest', 'Magic Kingdom', 'Restaurant');

      INSERT INTO food_items (id, name, experience_id)
      VALUES ('${foodItem1Id}', 'Grey Stuff', '${exp1Id}');
    `);

    repo = createPhotosRepo(pool);
  });

  it('inserts uploading photo and retrieves it by id with explicit columns', async () => {
    const photoId = randomUUID();
    const inserted = await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photoId}/full.jpg`,
      thumbKey: `p/${photoId}/thumb.jpg`,
      byteSize: 10240,
      thumbByteSize: 2048,
      width: 800,
      height: 600,
    });

    expect(inserted.id).toBe(photoId);
    expect(inserted.status).toBe('uploading');
    expect(inserted.owner_id).toBe(user1Id);

    const fetched = await repo.getById(photoId);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(photoId);
    expect(fetched?.byte_size).toBe(10240);
  });

  it('recordConfirm persists both ETags and updates status to pending idempotently', async () => {
    const photoId = randomUUID();
    await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photoId}/full.jpg`,
      thumbKey: `p/${photoId}/thumb.jpg`,
      byteSize: 1000,
      thumbByteSize: 200,
      width: 400,
      height: 300,
    });

    const confirmed = await repo.recordConfirm(photoId, {
      fullEtag: '"full-etag-123"',
      thumbEtag: '"thumb-etag-123"',
    });

    expect(confirmed?.status).toBe('pending');
    expect(confirmed?.full_etag).toBe('"full-etag-123"');
    expect(confirmed?.thumb_etag).toBe('"thumb-etag-123"');
    expect(confirmed?.confirmed_at).not.toBeNull();

    // Idempotent: confirm again returns row
    const reconfirmed = await repo.recordConfirm(photoId, {
      fullEtag: '"full-etag-123"',
      thumbEtag: '"thumb-etag-123"',
    });
    expect(reconfirmed?.status).toBe('pending');
  });

  it('claim is exclusive: second claim returns null while lease is live, succeeds after expiry', async () => {
    const photoId = randomUUID();
    await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photoId}/full.jpg`,
      thumbKey: `p/${photoId}/thumb.jpg`,
      byteSize: 1000,
      thumbByteSize: 200,
      width: 400,
      height: 300,
    });
    await repo.recordConfirm(photoId, { fullEtag: 'f', thumbEtag: 't' });
    db.public.none(`UPDATE photos SET next_attempt_at = '2026-10-18T09:59:00Z' WHERE id = '${photoId}'`);

    const t0 = new Date('2026-10-18T10:00:00Z');
    const claim1 = await repo.claim(photoId, 180, 5, t0);
    expect(claim1).not.toBeNull();
    expect(claim1?.attempts).toBe(1);

    // Second claim at t0 + 10s: lease is live until t0 + 180s -> returns null
    const t1 = new Date('2026-10-18T10:00:10Z');
    const claim2 = await repo.claim(photoId, 180, 5, t1);
    expect(claim2).toBeNull();

    // Third claim at t0 + 190s: lease expired -> succeeds
    const t2 = new Date('2026-10-18T10:03:10Z');
    const claim3 = await repo.claim(photoId, 180, 5, t2);
    expect(claim3).not.toBeNull();
    expect(claim3?.attempts).toBe(2);
  });

  it('renewLease extends lease_until for pending row with claimed attempts, affects zero rows on stale attempts or deleted', async () => {
    const photoId = randomUUID();
    await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photoId}/full.jpg`,
      thumbKey: `p/${photoId}/thumb.jpg`,
      byteSize: 1000,
      thumbByteSize: 200,
      width: 400,
      height: 300,
    });
    await repo.recordConfirm(photoId, { fullEtag: 'f', thumbEtag: 't' });
    db.public.none(`UPDATE photos SET next_attempt_at = '2026-10-18T09:59:00Z' WHERE id = '${photoId}'`);

    const t0 = new Date('2026-10-18T10:00:00Z');
    await repo.claim(photoId, 180, 5, t0); // attempts = 1

    // Valid renewal with claimed attempts = 1
    const renewed = await repo.renewLease(photoId, 1, 180, new Date('2026-10-18T10:01:00Z'));
    expect(renewed).toBe(true);

    // Stale renewal with attempts = 0 -> returns false
    const staleRenewal = await repo.renewLease(photoId, 0, 180, new Date('2026-10-18T10:01:00Z'));
    expect(staleRenewal).toBe(false);

    // Mark deleted -> renewLease returns false
    await repo.softDeleteByIds([photoId]);
    const afterDelete = await repo.renewLease(photoId, 1, 180, new Date('2026-10-18T10:02:00Z'));
    expect(afterDelete).toBe(false);
  });

  it('conditional update does not overwrite a deleted row', async () => {
    const photoId = randomUUID();
    await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photoId}/full.jpg`,
      thumbKey: `p/${photoId}/thumb.jpg`,
      byteSize: 1000,
      thumbByteSize: 200,
      width: 400,
      height: 300,
    });
    await repo.recordConfirm(photoId, { fullEtag: 'f', thumbEtag: 't' });
    await repo.softDeleteByIds([photoId]);

    // Attempt conditional update from pending to approved
    const updated = await repo.updateStatus(photoId, 'pending', 'approved');
    expect(updated).toBeNull();

    const row = await repo.getById(photoId);
    expect(row?.status).toBe('deleted');
  });

  it('recordRetryable clears lease_until and sets next_attempt_at', async () => {
    const photoId = randomUUID();
    await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photoId}/full.jpg`,
      thumbKey: `p/${photoId}/thumb.jpg`,
      byteSize: 1000,
      thumbByteSize: 200,
      width: 400,
      height: 300,
    });
    await repo.recordConfirm(photoId, { fullEtag: 'f', thumbEtag: 't' });
    await repo.claim(photoId, 180, 5, new Date('2026-10-18T10:00:00Z'));

    const retryAt = new Date('2026-10-18T10:01:00Z');
    const retryRow = await repo.recordRetryable(photoId, 'harm_timeout', retryAt);

    expect(retryRow?.lease_until).toBeNull();
    expect(retryRow?.last_error_code).toBe('harm_timeout');

    // Claim before next_attempt_at returns null
    const claimBefore = await repo.claim(photoId, 180, 5, new Date('2026-10-18T10:00:30Z'));
    expect(claimBefore).toBeNull();

    // Claim at/after next_attempt_at succeeds without waiting for the old 180s lease
    const claimAfter = await repo.claim(photoId, 180, 5, new Date('2026-10-18T10:01:01Z'));
    expect(claimAfter).not.toBeNull();
  });

  it('escalateToNeedsReview affects zero rows while lease is live, one row once lease expired or null', async () => {
    const photoId = randomUUID();
    await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photoId}/full.jpg`,
      thumbKey: `p/${photoId}/thumb.jpg`,
      byteSize: 1000,
      thumbByteSize: 200,
      width: 400,
      height: 300,
    });
    await repo.recordConfirm(photoId, { fullEtag: 'f', thumbEtag: 't' });
    // Claim reaches max attempts = 5
    for (let i = 0; i < 5; i++) {
      await db.public.none(
        `UPDATE photos SET attempts = ${i + 1}, lease_until = '2026-10-18T10:05:00Z' WHERE id = '${photoId}'`
      );
    }

    // While lease is live (at 10:02): 0 rows affected
    const earlyEscalate = await repo.escalateToNeedsReview(photoId, 5, new Date('2026-10-18T10:02:00Z'));
    expect(earlyEscalate).toBeNull();

    // Once lease expired (at 10:06): 1 row affected
    const lateEscalate = await repo.escalateToNeedsReview(photoId, 5, new Date('2026-10-18T10:06:00Z'));
    expect(lateEscalate?.status).toBe('needs_review');
    expect(lateEscalate?.last_error_code).toBe('max_attempts');
  });

  it('quota reserve: refuses request that exceeds cap, consumes N items', async () => {
    const day = '2026-10-18';
    // Cap is 5. Request 3 -> succeeds (consumed 3)
    const res1 = await repo.reserveQuota(user1Id, day, 3, 5);
    expect(res1.ok).toBe(true);
    expect(res1.uploadCount).toBe(3);

    // Request 3 more -> would reach 6 > 5 -> refused, count remains 3
    const res2 = await repo.reserveQuota(user1Id, day, 3, 5);
    expect(res2.ok).toBe(false);

    // Request 2 -> reaches 5 <= 5 -> succeeds
    const res3 = await repo.reserveQuota(user1Id, day, 2, 5);
    expect(res3.ok).toBe(true);
    expect(res3.uploadCount).toBe(5);
  });

  it('global reserve: refuses request that exceeds ceiling, increments uploads and bytes on success', async () => {
    const day = '2026-10-18';
    const cap = 10;

    // Reserve 6 uploads with 1200 bytes
    const res1 = await repo.reserveGlobalUploads(day, 6, 1200, cap);
    expect(res1.ok).toBe(true);
    expect(res1.uploads).toBe(6);
    expect(res1.uploadBytes).toBe(1200);

    // Request 5 more -> would reach 11 > 10 -> refused, uploads unchanged
    const res2 = await repo.reserveGlobalUploads(day, 5, 1000, cap);
    expect(res2.ok).toBe(false);

    // Request 4 more -> reaches 10 -> succeeds
    const res3 = await repo.reserveGlobalUploads(day, 4, 800, cap);
    expect(res3.ok).toBe(true);
    expect(res3.uploads).toBe(10);
    expect(res3.uploadBytes).toBe(2000);
  });

  it('countLiveForTarget: Property 37 live photo counting with uploading TTL cutoff', async () => {
    const targetId = randomUUID();
    const now = new Date('2026-10-18T12:00:00Z');
    const ttlSeconds = 600; // 10 minutes

    // 1. Pending photo -> counted
    const p1 = randomUUID();
    await repo.insertUploading({
      id: p1,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId,
      scopeId: foodItem1Id,
      objectKey: `p/${p1}/f.jpg`,
      thumbKey: `p/${p1}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });
    await repo.recordConfirm(p1, { fullEtag: 'f', thumbEtag: 't' });

    // 2. Approved photo -> counted
    const p2 = randomUUID();
    await repo.insertUploading({
      id: p2,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId,
      scopeId: foodItem1Id,
      objectKey: `p/${p2}/f.jpg`,
      thumbKey: `p/${p2}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });
    await repo.recordConfirm(p2, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: p2, harmVerdict: 'pass', visionVerdict: 'pass' });

    // 3. Rejected photo -> counted until deleted
    const p3 = randomUUID();
    await repo.insertUploading({
      id: p3,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId,
      scopeId: foodItem1Id,
      objectKey: `p/${p3}/f.jpg`,
      thumbKey: `p/${p3}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });
    await repo.updateStatus(p3, 'uploading', 'rejected', { rejectReason: 'not_food' });

    // 4. Needs_review photo -> counted
    const p4 = randomUUID();
    await repo.insertUploading({
      id: p4,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId,
      scopeId: foodItem1Id,
      objectKey: `p/${p4}/f.jpg`,
      thumbKey: `p/${p4}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });
    await repo.recordConfirm(p4, { fullEtag: 'f', thumbEtag: 't' });
    await repo.updateStatus(p4, 'pending', 'needs_review');

    // 5. Fresh uploading photo (5 minutes old, within 10-minute TTL) -> counted
    const p5 = randomUUID();
    await repo.insertUploading({
      id: p5,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId,
      scopeId: foodItem1Id,
      objectKey: `p/${p5}/f.jpg`,
      thumbKey: `p/${p5}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
      createdAt: new Date(now.getTime() - 5 * 60 * 1000),
    });

    // 6. Stale uploading photo (16 minutes old, beyond 10-minute TTL) -> not counted
    const p6 = randomUUID();
    await repo.insertUploading({
      id: p6,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId,
      scopeId: foodItem1Id,
      objectKey: `p/${p6}/f.jpg`,
      thumbKey: `p/${p6}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
      createdAt: new Date(now.getTime() - 16 * 60 * 1000),
    });

    // 7. Deleted photo -> not counted
    const p7 = randomUUID();
    await repo.insertUploading({
      id: p7,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId,
      scopeId: foodItem1Id,
      objectKey: `p/${p7}/f.jpg`,
      thumbKey: `p/${p7}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });
    await repo.softDeleteByIds([p7]);

    // Live count should be 5 (p1, p2, p3, p4, p5)
    const count = await repo.countLiveForTarget('food_log', targetId, now, ttlSeconds);
    expect(count).toBe(5);
  });

  it('gallery query returns uploader display_name and avatar_preset from profiles and filters blocks both ways', async () => {
    const photo1 = randomUUID();
    await repo.insertUploading({
      id: photo1,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${photo1}/f.jpg`,
      thumbKey: `p/${photo1}/t.jpg`,
      byteSize: 1000,
      thumbByteSize: 200,
      width: 400,
      height: 300,
    });
    await repo.recordConfirm(photo1, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: photo1, harmVerdict: 'pass', visionVerdict: 'pass' });

    // Read by stranger (viewer = randomUUID)
    const strangerId = randomUUID();
    const viewer3Id = randomUUID();
    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${strangerId}', 'stranger@example.com', 'h3'),
             ('${viewer3Id}', 'viewer3@example.com', 'h4');
    `);

    const rows = await repo.listFoodByScope({
      scopeId: foodItem1Id,
      viewerId: strangerId,
      limit: 10,
    });

    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(photo1);
    expect(rows[0]?.display_name).toBe('Alice In Wonderland');
    expect(rows[0]?.avatar_preset).toBe('mickey');

    // Experience gallery query also returns foodItemName
    const expRows = await repo.listFoodByExperience({
      experienceId: exp1Id,
      viewerId: strangerId,
      limit: 10,
    });
    expect(expRows.length).toBe(1);
    expect(expRows[0]?.food_item_name).toBe('Grey Stuff');

    // Public read rows must not expose the stored object_key / thumb_key columns: they keep
    // the deleted u/ upload keys, so a service that used them would mint dead URLs.
    for (const row of [...rows, ...expRows]) {
      expect(Object.keys(row)).not.toContain('object_key');
      expect(Object.keys(row)).not.toContain('thumb_key');
    }

    // Add block from stranger to user1 -> photo disappears from stranger's view
    db.public.none(
      `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${strangerId}', '${user1Id}')`
    );
    const blockedRows = await repo.listFoodByScope({
      scopeId: foodItem1Id,
      viewerId: strangerId,
      limit: 10,
    });
    expect(blockedRows.length).toBe(0);

    // Block in reverse direction (user1 blocks viewer3) -> photo disappears from viewer3's view
    db.public.none(
      `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${user1Id}', '${viewer3Id}')`
    );
    const blockedRevRows = await repo.listFoodByScope({
      scopeId: foodItem1Id,
      viewerId: viewer3Id,
      limit: 10,
    });
    expect(blockedRevRows.length).toBe(0);
  });

  it('keyset pagination returns each row once across pages with tied created_at', async () => {
    const tiedTime = new Date('2026-10-18T10:00:00Z');
    const ids: string[] = [];

    for (let i = 0; i < 5; i++) {
      const pid = randomUUID();
      ids.push(pid);
      await repo.insertUploading({
        id: pid,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: foodItem1Id,
        objectKey: `p/${pid}/f.jpg`,
        thumbKey: `p/${pid}/t.jpg`,
        byteSize: 100,
        thumbByteSize: 20,
        width: 100,
        height: 100,
        createdAt: tiedTime,
      });
      await repo.recordConfirm(pid, { fullEtag: 'f', thumbEtag: 't' });
      await repo.markApproved({ id: pid, harmVerdict: 'pass', visionVerdict: 'pass' });
    }

    const viewerId = randomUUID();
    // Page 1: limit 3
    const page1 = await repo.listFoodByScope({
      scopeId: foodItem1Id,
      viewerId,
      limit: 3,
    });
    expect(page1.length).toBe(3);

    // Page 2: with cursor from last item of page 1
    const lastItem = page1[2]!;
    const page2 = await repo.listFoodByScope({
      scopeId: foodItem1Id,
      viewerId,
      limit: 3,
      cursor: { createdAt: new Date(lastItem.created_at), id: lastItem.id },
    });
    expect(page2.length).toBe(2);

    const allReturnedIds = [...page1.map((p) => p.id), ...page2.map((p) => p.id)];
    expect(new Set(allReturnedIds).size).toBe(5);
  });

  it('listMine returns caller non-deleted photos for targetKind and scope, newest first, never others', async () => {
    const otherUser = user2Id;
    const pAlice1 = randomUUID();
    const pAlice2 = randomUUID();
    const pBob = randomUUID();

    await repo.insertUploading({
      id: pAlice1,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${pAlice1}/f.jpg`,
      thumbKey: `p/${pAlice1}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
      createdAt: new Date('2026-10-18T10:00:00Z'),
    });
    await repo.insertUploading({
      id: pAlice2,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${pAlice2}/f.jpg`,
      thumbKey: `p/${pAlice2}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
      createdAt: new Date('2026-10-18T10:05:00Z'),
    });
    await repo.insertUploading({
      id: pBob,
      ownerId: otherUser,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${pBob}/f.jpg`,
      thumbKey: `p/${pBob}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });

    const alicePhotos = await repo.listMine(user1Id, 'food_log', foodItem1Id);
    expect(alicePhotos.length).toBe(2);
    expect(alicePhotos[0]?.id).toBe(pAlice2); // Newest first
    expect(alicePhotos[1]?.id).toBe(pAlice1);

    // List own by ids omits Bob's id when Alice queries
    const ownByIds = await repo.listOwnByIds(user1Id, [pAlice1, pBob]);
    expect(ownByIds.length).toBe(1);
    expect(ownByIds[0]?.id).toBe(pAlice1);
  });

  it('friendIdsAmong returns friend ids in both canonical orientations and none for strangers', async () => {
    const friendA = user1Id;
    const friendB = user2Id;
    const stranger = randomUUID();

    // Insert canonical friendship between friendA and friendB
    const [lo, hi] = friendA < friendB ? [friendA, friendB] : [friendB, friendA];
    db.public.none(
      `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ('${lo}', '${hi}')`
    );

    // viewer is friendA, owners are [friendB, stranger]
    const friendsOfA = await repo.friendIdsAmong(friendA, [friendB, stranger]);
    expect(friendsOfA.has(friendB)).toBe(true);
    expect(friendsOfA.has(stranger)).toBe(false);

    // viewer is friendB (reverse orientation)
    const friendsOfB = await repo.friendIdsAmong(friendB, [friendA, stranger]);
    expect(friendsOfB.has(friendA)).toBe(true);
    expect(friendsOfB.has(stranger)).toBe(false);
  });

  it('expireNeedsReview deletes only needs_review rows older than limit and is idempotent', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const oldNeedsReview = randomUUID();
    const youngNeedsReview = randomUUID();
    const oldPending = randomUUID();

    // 130 hours old needs_review (limit = 120h)
    await repo.insertUploading({
      id: oldNeedsReview,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${oldNeedsReview}/f.jpg`,
      thumbKey: `p/${oldNeedsReview}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
      createdAt: new Date(now.getTime() - 130 * 3600 * 1000),
    });
    await repo.updateStatus(oldNeedsReview, 'uploading', 'needs_review');

    // 100 hours old needs_review (< 120h)
    await repo.insertUploading({
      id: youngNeedsReview,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${youngNeedsReview}/f.jpg`,
      thumbKey: `p/${youngNeedsReview}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
      createdAt: new Date(now.getTime() - 100 * 3600 * 1000),
    });
    await repo.updateStatus(youngNeedsReview, 'uploading', 'needs_review');

    // 130 hours old pending photo (must NOT be touched)
    await repo.insertUploading({
      id: oldPending,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${oldPending}/f.jpg`,
      thumbKey: `p/${oldPending}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
      createdAt: new Date(now.getTime() - 130 * 3600 * 1000),
    });
    await repo.recordConfirm(oldPending, { fullEtag: 'f', thumbEtag: 't' });

    const expired = await repo.expireNeedsReview(120, now);
    expect(expired).toEqual([oldNeedsReview]);

    expect((await repo.getById(oldNeedsReview))?.status).toBe('deleted');
    expect((await repo.getById(youngNeedsReview))?.status).toBe('needs_review');
    expect((await repo.getById(oldPending))?.status).toBe('pending');

    // Idempotent: running again deletes 0 rows
    const reExpired = await repo.expireNeedsReview(120, now);
    expect(reExpired.length).toBe(0);
  });

  it('listApprovedNeedingUploadCleanup finds served_at > 1h ago with null upload_cleaned_at', async () => {
    const now = new Date('2026-10-18T12:00:00Z');
    const p61MinOld = randomUUID();
    const p59MinOld = randomUUID();

    // 61 minutes old served_at
    await repo.insertUploading({
      id: p61MinOld,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${p61MinOld}/f.jpg`,
      thumbKey: `p/${p61MinOld}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });
    await repo.recordConfirm(p61MinOld, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({
      id: p61MinOld,
      harmVerdict: 'pass',
      visionVerdict: 'pass',
      servedAt: new Date(now.getTime() - 61 * 60 * 1000),
    });

    // 59 minutes old served_at (< 60 minutes)
    await repo.insertUploading({
      id: p59MinOld,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: foodItem1Id,
      objectKey: `p/${p59MinOld}/f.jpg`,
      thumbKey: `p/${p59MinOld}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });
    await repo.recordConfirm(p59MinOld, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({
      id: p59MinOld,
      harmVerdict: 'pass',
      visionVerdict: 'pass',
      servedAt: new Date(now.getTime() - 59 * 60 * 1000),
    });

    const needingCleanup = await repo.listApprovedNeedingUploadCleanup(10, 60, now);
    expect(needingCleanup.length).toBe(1);
    expect(needingCleanup[0]?.id).toBe(p61MinOld);

    // After markUploadCleaned, row is no longer returned
    await repo.markUploadCleaned(p61MinOld, now);
    const afterClean = await repo.listApprovedNeedingUploadCleanup(10, 60, now);
    expect(afterClean.length).toBe(0);
  });

  it('orphan query finds photo whose food log row is missing', async () => {
    const missingLogId = randomUUID();
    const existingLogId = randomUUID();

    // Insert real food_item_log for existingLogId
    db.public.none(`
      INSERT INTO food_item_logs (id, user_id, food_item_id, visited_on, user_tz)
      VALUES ('${existingLogId}', '${user1Id}', '${foodItem1Id}', '2026-10-18', 'America/New_York');
    `);

    // Orphan photo (target_id is missingLogId)
    const orphanPhotoId = randomUUID();
    await repo.insertUploading({
      id: orphanPhotoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: missingLogId,
      scopeId: foodItem1Id,
      objectKey: `p/${orphanPhotoId}/f.jpg`,
      thumbKey: `p/${orphanPhotoId}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });

    // Valid photo (target_id is existingLogId)
    const validPhotoId = randomUUID();
    await repo.insertUploading({
      id: validPhotoId,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: existingLogId,
      scopeId: foodItem1Id,
      objectKey: `p/${validPhotoId}/f.jpg`,
      thumbKey: `p/${validPhotoId}/t.jpg`,
      byteSize: 10,
      thumbByteSize: 10,
      width: 10,
      height: 10,
    });

    const orphans = await repo.findFoodLogOrphanIds(10);
    expect(orphans).toContain(orphanPhotoId);
    expect(orphans).not.toContain(validPhotoId);
  });

  it('listFoodByExperience and listFoodByLocation return food_item_name on first and cursor pages', async () => {
    // 1. Experience with two different dishes
    const dish1Id = foodItem1Id; // 'Grey Stuff' under exp1Id
    const dish2Id = randomUUID();
    db.public.none(`
      INSERT INTO food_items (id, name, experience_id)
      VALUES ('${dish2Id}', 'French Onion Soup', '${exp1Id}');
    `);

    // 2. Location with one dish
    const locId = randomUUID();
    db.public.none(`
      INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
      VALUES ('${locId}', 'Gaston Tavern', 'Magic Kingdom', '${user1Id}');
    `);
    const dishLocId = randomUUID();
    db.public.none(`
      INSERT INTO food_items (id, name, location_id)
      VALUES ('${dishLocId}', 'Warm Cinnamon Roll', '${locId}');
    `);

    // Seed 3 approved photos for exp1Id (2 for dish1, 1 for dish2)
    const pExp1 = randomUUID();
    const pExp2 = randomUUID();
    const pExp3 = randomUUID();

    await repo.insertUploading({
      id: pExp1,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: dish1Id,
      objectKey: `p/${pExp1}/f.jpg`,
      thumbKey: `p/${pExp1}/t.jpg`,
      byteSize: 100,
      thumbByteSize: 20,
      width: 100,
      height: 100,
      createdAt: new Date('2026-10-18T10:00:00Z'),
    });
    await repo.recordConfirm(pExp1, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: pExp1, harmVerdict: 'pass', visionVerdict: 'pass' });

    await repo.insertUploading({
      id: pExp2,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: dish2Id,
      objectKey: `p/${pExp2}/f.jpg`,
      thumbKey: `p/${pExp2}/t.jpg`,
      byteSize: 100,
      thumbByteSize: 20,
      width: 100,
      height: 100,
      createdAt: new Date('2026-10-18T10:05:00Z'),
    });
    await repo.recordConfirm(pExp2, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: pExp2, harmVerdict: 'pass', visionVerdict: 'pass' });

    await repo.insertUploading({
      id: pExp3,
      ownerId: user2Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: dish1Id,
      objectKey: `p/${pExp3}/f.jpg`,
      thumbKey: `p/${pExp3}/t.jpg`,
      byteSize: 100,
      thumbByteSize: 20,
      width: 100,
      height: 100,
      createdAt: new Date('2026-10-18T10:10:00Z'),
    });
    await repo.recordConfirm(pExp3, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: pExp3, harmVerdict: 'pass', visionVerdict: 'pass' });

    // Seed 2 approved photos for locId
    const pLoc1 = randomUUID();
    const pLoc2 = randomUUID();

    await repo.insertUploading({
      id: pLoc1,
      ownerId: user1Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: dishLocId,
      objectKey: `p/${pLoc1}/f.jpg`,
      thumbKey: `p/${pLoc1}/t.jpg`,
      byteSize: 100,
      thumbByteSize: 20,
      width: 100,
      height: 100,
      createdAt: new Date('2026-10-18T10:00:00Z'),
    });
    await repo.recordConfirm(pLoc1, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: pLoc1, harmVerdict: 'pass', visionVerdict: 'pass' });

    await repo.insertUploading({
      id: pLoc2,
      ownerId: user2Id,
      targetKind: 'food_log',
      targetId: randomUUID(),
      scopeId: dishLocId,
      objectKey: `p/${pLoc2}/f.jpg`,
      thumbKey: `p/${pLoc2}/t.jpg`,
      byteSize: 100,
      thumbByteSize: 20,
      width: 100,
      height: 100,
      createdAt: new Date('2026-10-18T10:05:00Z'),
    });
    await repo.recordConfirm(pLoc2, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: pLoc2, harmVerdict: 'pass', visionVerdict: 'pass' });

    const viewerId = randomUUID();

    // 1. listFoodByExperience: first page (limit 2)
    const expPage1 = await repo.listFoodByExperience({
      experienceId: exp1Id,
      viewerId,
      limit: 2,
    });
    expect(expPage1.length).toBe(2);
    expect(expPage1[0]?.id).toBe(pExp3);
    expect(expPage1[0]?.food_item_name).toBe('Grey Stuff');
    expect(expPage1[1]?.id).toBe(pExp2);
    expect(expPage1[1]?.food_item_name).toBe('French Onion Soup');

    // listFoodByExperience: cursor page
    const expPage2 = await repo.listFoodByExperience({
      experienceId: exp1Id,
      viewerId,
      limit: 2,
      cursor: { createdAt: new Date(expPage1[1]!.created_at), id: expPage1[1]!.id },
    });
    expect(expPage2.length).toBe(1);
    expect(expPage2[0]?.id).toBe(pExp1);
    expect(expPage2[0]?.food_item_name).toBe('Grey Stuff');

    // 2. listFoodByLocation: first page (limit 1)
    const locPage1 = await repo.listFoodByLocation({
      locationId: locId,
      viewerId,
      limit: 1,
    });
    expect(locPage1.length).toBe(1);
    expect(locPage1[0]?.id).toBe(pLoc2);
    expect(locPage1[0]?.food_item_name).toBe('Warm Cinnamon Roll');

    // listFoodByLocation: cursor page
    const locPage2 = await repo.listFoodByLocation({
      locationId: locId,
      viewerId,
      limit: 1,
      cursor: { createdAt: new Date(locPage1[0]!.created_at), id: locPage1[0]!.id },
    });
    expect(locPage2.length).toBe(1);
    expect(locPage2[0]?.id).toBe(pLoc1);
    expect(locPage2[0]?.food_item_name).toBe('Warm Cinnamon Roll');
  });
});
