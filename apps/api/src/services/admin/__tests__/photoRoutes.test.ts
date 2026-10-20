/**
 * Integration and wiring tests for Admin Photo Review Queue routes (Task 10.2).
 *
 * Validates: Requirements 8.12, 9.8, 9.9, 18.1, 18.2, 18.3, 18.4, 18.5,
 *            18.6, 18.7, 18.8, 18.9, 18.10, 18.11, 18.12
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/index.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo, type AdminRepo } from '../repo.js';
import { adminRoutes, type AdminPhotoPort } from '../routes.js';

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

function applySchema(db: IMemoryDb): void {
  applyMigration(db, '0001_init.sql');
  applyMigration(db, '0013_avatar_presets.sql');
  applyMigration(db, '0040_food_item_logging.sql');
  applyMigration(db, '0062_photo_uploads.sql');
}

class FakeAdminPhotoPort implements AdminPhotoPort {
  readonly presignLog: Array<{ key: string; ttlSeconds: number }> = [];
  readonly approvedPhotos: string[] = [];
  refuseApprove = false;

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    this.presignLog.push({ key, ttlSeconds });
    return `https://cdn.example.com/${key}?expires=${ttlSeconds}`;
  }

  async operatorApprove(photoId: string): Promise<{ success: boolean }> {
    if (this.refuseApprove) return { success: false };
    this.approvedPhotos.push(photoId);
    return { success: true };
  }
}

describe('Admin Photo Routes (Task 10.2)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let adminRepo: AdminRepo;
  let fakePhotoPort: FakeAdminPhotoPort;
  let app: FastifyInstance;

  const username = 'testadmin';
  const password = 'testpassword';
  const validAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const sameOriginHeaders = {
    authorization: validAuth,
    'sec-fetch-site': 'same-origin',
  };

  beforeEach(async () => {
    db = buildPgMemDatabase();
    applySchema(db);

    const adapter = db.adapters.createPg();
    pool = new adapter.Pool() as unknown as DbPool;
    const redis = new RedisMock() as unknown as Redis;
    adminRepo = createAdminRepo(pool, redis);
    fakePhotoPort = new FakeAdminPhotoPort();

    const basicAuth = createBasicAuthHook({ username, password });

    app = Fastify();
    registerErrorHandler(app as any);

    await app.register(
      adminRoutes({
        repo: adminRepo,
        basicAuth,
        photos: fakePhotoPort,
      }),
    );

    await app.ready();
  });

  async function seedUser(id: string, email: string, displayName: string): Promise<void> {
    await pool.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'test-hash');`,
      [id, email],
    );
    await pool.query(
      `INSERT INTO profiles (user_id, display_name, avatar_preset) VALUES ($1, $2, 'castle');`,
      [id, displayName],
    );
  }

  function seedPhoto(params: {
    id: string;
    ownerId: string;
    targetKind: 'food_log' | 'trip';
    status: 'pending' | 'needs_review' | 'approved' | 'rejected' | 'hidden' | 'deleted';
    createdAt?: Date;
    visionFields?: unknown;
  }): void {
    const { id, ownerId, targetKind, status, createdAt = new Date('2026-10-18T10:00:00Z'), visionFields = null } = params;
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
        '${id}', '${ownerId}', '${targetKind}', '${randomUUID()}', '${randomUUID()}', '${status}',
        'u/${id}/full.jpg', 'u/${id}/thumb.jpg', 50000, 5000, 800, 600,
        '${createdAt.toISOString()}', '${createdAt.toISOString()}', ${harmVerdict}, ${visionVerdict},
        ${fullEtag}, ${thumbEtag}, ${servedAt},
        ${rejectReason}, ${hiddenReason}, ${vf}
      );
    `);
  }

  function seedReport(photoId: string, reporterId: string, reason = 'inappropriate'): void {
    db.public.none(`
      INSERT INTO photo_reports (id, photo_id, reporter_id, reason, status)
      VALUES ('${randomUUID()}', '${photoId}', '${reporterId}', '${reason}', 'open');
    `);
  }

  it('401 without credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/photos',
    });
    expect(res.statusCode).toBe(401);
  });

  it('headers are present: X-Robots-Tag: noindex, nofollow and Cache-Control: private, no-store', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/photos',
      headers: { authorization: validAuth },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('lists queue with presigned URLs: p/ for hidden, u/ for needs_review, 300s TTL, escapes HTML', async () => {
    const user1 = randomUUID();
    const maliciousName = '<script>alert("pwned")</script>';
    await seedUser(user1, 'u1@example.com', maliciousName);

    const hiddenPhotoId = randomUUID();
    await seedPhoto({ id: hiddenPhotoId, ownerId: user1, targetKind: 'food_log', status: 'hidden' });
    const reporter = randomUUID();
    await seedUser(reporter, 'rep@example.com', 'Reporter');
    await seedReport(hiddenPhotoId, reporter, 'not_food');

    const needsReviewPhotoId = randomUUID();
    await seedPhoto({
      id: needsReviewPhotoId,
      ownerId: user1,
      targetKind: 'food_log',
      status: 'needs_review',
      visionFields: { minFoodConfidence: 0.5 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/photos',
      headers: { authorization: validAuth },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;');
    expect(res.body).not.toContain('<script>alert("pwned")</script>');

    // Check presign log
    // Hidden photo should use p/ serving thumb
    const hiddenPresign = fakePhotoPort.presignLog.find((p) => p.key === `p/${hiddenPhotoId}/thumb.jpg`);
    expect(hiddenPresign).toBeDefined();
    expect(hiddenPresign?.ttlSeconds).toBe(300);

    // Needs review photo should presign u/ upload keys
    const nrThumbPresign = fakePhotoPort.presignLog.find((p) => p.key === `u/${needsReviewPhotoId}/thumb.jpg`);
    const nrFullPresign = fakePhotoPort.presignLog.find((p) => p.key === `u/${needsReviewPhotoId}/full.jpg`);
    expect(nrThumbPresign).toBeDefined();
    expect(nrThumbPresign?.ttlSeconds).toBe(300);
    expect(nrFullPresign).toBeDefined();
    expect(nrFullPresign?.ttlSeconds).toBe(300);

    // No u/ presign for hidden photo
    const invalidUPresign = fakePhotoPort.presignLog.find((p) => p.key.startsWith(`u/${hiddenPhotoId}`));
    expect(invalidUPresign).toBeUndefined();
  });

  it('CSRF same-origin enforcement: 403 on cross-site and origin mismatch, 303 on same-origin', async () => {
    const user = randomUUID();
    await seedUser(user, 'u@example.com', 'User');
    const photoId = randomUUID();
    await seedPhoto({ id: photoId, ownerId: user, targetKind: 'food_log', status: 'hidden' });

    // 1. Cross-site via Sec-Fetch-Site -> 403
    const crossSiteRes = await app.inject({
      method: 'POST',
      url: `/admin/photos/${photoId}/remove`,
      headers: {
        authorization: validAuth,
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(crossSiteRes.statusCode).toBe(403);
    expect(crossSiteRes.headers['x-robots-tag']).toBe('noindex, nofollow');

    // Confirm photo is still hidden (no change)
    const check1 = await pool.query(`SELECT status FROM photos WHERE id = $1`, [photoId]);
    expect(check1.rows[0]?.status).toBe('hidden');

    // 2. Origin mismatch -> 403
    const originMismatchRes = await app.inject({
      method: 'POST',
      url: `/admin/photos/${photoId}/remove`,
      headers: {
        authorization: validAuth,
        host: 'localhost:3000',
        origin: 'https://evil.example',
      },
    });
    expect(originMismatchRes.statusCode).toBe(403);

    const check2 = await pool.query(`SELECT status FROM photos WHERE id = $1`, [photoId]);
    expect(check2.rows[0]?.status).toBe('hidden');

    // 3. Same-origin succeeds
    const sameOriginRes = await app.inject({
      method: 'POST',
      url: `/admin/photos/${photoId}/remove`,
      headers: sameOriginHeaders,
    });
    expect(sameOriginRes.statusCode).toBe(303);
    const check3 = await pool.query(`SELECT status FROM photos WHERE id = $1`, [photoId]);
    expect(check3.rows[0]?.status).toBe('deleted');
  });

  it('actions: approve calls operatorApprove; restore restores to approved; dismiss-reports clears reports', async () => {
    const user = randomUUID();
    await seedUser(user, 'u@example.com', 'User');

    // 1. Approve
    const nrPhotoId = randomUUID();
    await seedPhoto({ id: nrPhotoId, ownerId: user, targetKind: 'food_log', status: 'needs_review' });

    const approveRes = await app.inject({
      method: 'POST',
      url: `/admin/photos/${nrPhotoId}/approve`,
      headers: sameOriginHeaders,
    });
    expect(approveRes.statusCode).toBe(303);
    expect(fakePhotoPort.approvedPhotos).toContain(nrPhotoId);

    // 2. Restore
    const hiddenId = randomUUID();
    await seedPhoto({ id: hiddenId, ownerId: user, targetKind: 'food_log', status: 'hidden' });

    const restoreRes = await app.inject({
      method: 'POST',
      url: `/admin/photos/${hiddenId}/restore`,
      headers: sameOriginHeaders,
    });
    expect(restoreRes.statusCode).toBe(303);
    const restoredRow = await pool.query(`SELECT status FROM photos WHERE id = $1`, [hiddenId]);
    expect(restoredRow.rows[0]?.status).toBe('approved');

    // 3. Dismiss reports
    const repPhotoId = randomUUID();
    await seedPhoto({ id: repPhotoId, ownerId: user, targetKind: 'food_log', status: 'approved' });
    const repUser = randomUUID();
    await seedUser(repUser, 'rep@example.com', 'Reporter');
    await seedReport(repPhotoId, repUser, 'spam');

    const dismissRes = await app.inject({
      method: 'POST',
      url: `/admin/photos/${repPhotoId}/dismiss-reports`,
      headers: sameOriginHeaders,
    });
    expect(dismissRes.statusCode).toBe(303);
    const reports = await pool.query(`SELECT status FROM photo_reports WHERE photo_id = $1`, [repPhotoId]);
    expect(reports.rows[0]?.status).toBe('dismissed');
  });

  it('strike display and ban from removal confirmation', async () => {
    const user = randomUUID();
    await seedUser(user, 'striker@example.com', 'Striker');

    const photo1 = randomUUID();
    await seedPhoto({ id: photo1, ownerId: user, targetKind: 'food_log', status: 'approved' });
    const r1 = randomUUID();
    const r2 = randomUUID();
    const r3 = randomUUID();
    await seedUser(r1, 'r1@example.com', 'R1');
    await seedUser(r2, 'r2@example.com', 'R2');
    await seedUser(r3, 'r3@example.com', 'R3');
    await seedReport(photo1, r1, 'spam');
    await seedReport(photo1, r2, 'spam');
    await seedReport(photo1, r3, 'spam');

    // Remove photo 1
    const remove1Res = await app.inject({
      method: 'POST',
      url: `/admin/photos/${photo1}/remove`,
      headers: sameOriginHeaders,
    });
    expect(remove1Res.statusCode).toBe(303);
    expect(remove1Res.body).toContain('1'); // strike count 1, not 3
    expect(remove1Res.body).toContain('Ban uploader');

    // Check confirmation GET page as well
    const confRes = await app.inject({
      method: 'GET',
      url: `/admin/photos/${photo1}/removed`,
      headers: { authorization: validAuth },
    });
    expect(confRes.statusCode).toBe(200);
    expect(confRes.body).toContain('1');
    expect(confRes.body).toContain('Ban uploader');

    // Remove photo 2 for same uploader -> strike count 2
    const photo2 = randomUUID();
    await seedPhoto({ id: photo2, ownerId: user, targetKind: 'food_log', status: 'approved' });
    const remove2Res = await app.inject({
      method: 'POST',
      url: `/admin/photos/${photo2}/remove`,
      headers: sameOriginHeaders,
    });
    expect(remove2Res.body).toContain('2');

    // Ban uploader from the removed (still deleted) photo
    const banRes = await app.inject({
      method: 'POST',
      url: `/admin/photos/${photo1}/ban-uploader`,
      headers: sameOriginHeaders,
      payload: { reason: 'Repeated offensive photos' },
    });
    expect(banRes.statusCode).toBe(303);

    const banRow = await pool.query(`SELECT * FROM photo_upload_bans WHERE user_id = $1`, [user]);
    expect(banRow.rows.length).toBe(1);
  });

  it('with options.photos undefined: renders disabled notice, approve refused (400), other actions work', async () => {
    const disabledApp = Fastify();
    registerErrorHandler(disabledApp as any);
    const basicAuth = createBasicAuthHook({ username, password });

    await disabledApp.register(
      adminRoutes({
        repo: adminRepo,
        basicAuth,
        photos: undefined,
      }),
    );
    await disabledApp.ready();

    const user = randomUUID();
    await seedUser(user, 'u@example.com', 'User');
    const photoId = randomUUID();
    await seedPhoto({ id: photoId, ownerId: user, targetKind: 'food_log', status: 'needs_review' });

    // GET /admin/photos shows notice
    const getRes = await disabledApp.inject({
      method: 'GET',
      url: '/admin/photos',
      headers: { authorization: validAuth },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body).toContain('Photos are disabled; thumbnails unavailable');

    // Approve refused with 400
    const approveRes = await disabledApp.inject({
      method: 'POST',
      url: `/admin/photos/${photoId}/approve`,
      headers: sameOriginHeaders,
    });
    expect(approveRes.statusCode).toBe(400);
    expect(approveRes.body).toContain('Photos are disabled; thumbnails unavailable');

    // Remove still works
    const removeRes = await disabledApp.inject({
      method: 'POST',
      url: `/admin/photos/${photoId}/remove`,
      headers: sameOriginHeaders,
    });
    expect(removeRes.statusCode).toBe(303);
    const row = await pool.query(`SELECT status FROM photos WHERE id = $1`, [photoId]);
    expect(row.rows[0]?.status).toBe('deleted');

    await disabledApp.close();
  });

  it('photo usage section renders seeded rows and empty state (Task 10.3)', async () => {
    // 1. Empty state
    const emptyRes = await app.inject({
      method: 'GET',
      url: '/admin/photos',
      headers: { authorization: validAuth },
    });
    expect(emptyRes.statusCode).toBe(200);
    expect(emptyRes.body).toContain('No entries found');

    // 2. Seeded usage row
    await pool.query(
      `INSERT INTO photo_usage_daily (
        day, uploads, upload_bytes, harm_calls, vision_calls,
        vision_prompt_tokens, vision_output_tokens, rejections, needs_review, exif_present
      ) VALUES (
        '2026-10-18', 42, 1234567, 40, 35, 10500, 2100, 2, 1, 3
      );`,
    );

    const populatedRes = await app.inject({
      method: 'GET',
      url: '/admin/photos',
      headers: { authorization: validAuth },
    });
    expect(populatedRes.statusCode).toBe(200);
    expect(populatedRes.body).toContain('2026-10-18');
    expect(populatedRes.body).toContain('42');
    expect(populatedRes.body).toContain('1,234,567');
    expect(populatedRes.body).toContain('10500 / 2100');
  });

  // ---------------------------------------------------------------------------
  // Requirement 16: Viewer-local timestamps
  // ---------------------------------------------------------------------------
  it('queue "Created" renders as a viewer-local <time> element and the old bare-UTC text is gone', async () => {
    const user = randomUUID();
    await seedUser(user, 'created@example.com', 'Created User');
    await seedPhoto({
      id: randomUUID(),
      ownerId: user,
      targetKind: 'food_log',
      status: 'needs_review',
      createdAt: new Date('2026-10-18T10:00:00Z'),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/photos',
      headers: { authorization: validAuth },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(
      '<time class="mono" data-local-time datetime="2026-10-18T10:00:00.000Z" title="2026-10-18T10:00:00.000Z">2026-10-18 10:00:00 UTC</time>',
    );
    // Old rendering: a bare mono span holding the UTC text, no <time>.
    expect(res.body).not.toMatch(/<span class="mono"[^>]*>2026-10-18 10:00:00<\/span>/);
    // The shell's single localizer script and footnote are present.
    expect((res.body.match(/<script>/g) ?? []).length).toBe(1);
    expect(res.body).toContain('time[data-local-time]');
    expect(res.body).toContain("Timestamps are shown in your browser's time zone");
  });

  // Feature: admin-panel, Property 10: Calendar-date buckets are never converted
  it('usage "Day (UTC)" bucket keeps its header and renders the bare date, never a <time>', async () => {
    await pool.query(
      `INSERT INTO photo_usage_daily (
        day, uploads, upload_bytes, harm_calls, vision_calls,
        vision_prompt_tokens, vision_output_tokens, rejections, needs_review, exif_present
      ) VALUES (
        '2026-10-18', 1, 10, 1, 1, 1, 1, 0, 0, 0
      );`,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/admin/photos',
      headers: { authorization: validAuth },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<th>Day (UTC)</th>');
    expect(res.body).toContain('<td><span class="mono">2026-10-18</span></td>');
    expect(res.body).not.toContain('<time');
  });
});
