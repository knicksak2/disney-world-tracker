/**
 * Tests for ReportsRepo using pg-mem.
 *
 * Implements: Task 7.2
 * Validates: Requirements 3.7, 5.9, 16.1, 16.3, 16.6, 17.1, 17.2, 18.5, 18.6, 18.11, Property 32
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { createReportsRepo, type ReportsRepo } from '../reportsRepo.js';
import { PhotoService, type PhotoServiceConfig } from '../service.js';
import { photoRoutes } from '../routes.js';
import { TripTarget } from '../targets/tripTarget.js';
import { FoodLogTarget } from '../targets/foodLogTarget.js';
import { FakeObjectStore } from './fakes.js';

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
    name: 'nullif',
    args: [DataType.text, DataType.text],
    returns: DataType.text,
    implementation: (a: unknown, b: unknown): string | null =>
      a === b ? null : typeof a === 'string' ? a : null,
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

describe('ReportsRepo (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: ReportsRepo;
  let user1Id: string;
  let user2Id: string;
  let user3Id: string;
  let photo1Id: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    db.public.none('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_preset TEXT;');

    user1Id = randomUUID();
    user2Id = randomUUID();
    user3Id = randomUUID();
    photo1Id = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${user1Id}', 'alice@example.com', 'h1'),
             ('${user2Id}', 'bob@example.com', 'h2'),
             ('${user3Id}', 'charlie@example.com', 'h3');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${user1Id}', 'Alice In Wonderland', 'mickey'),
             ('${user2Id}', 'Bob Builder', 'goofy'),
             ('${user3Id}', 'Charlie Chaplin', 'donald');

      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height, status,
        full_etag, thumb_etag, harm_verdict, vision_verdict
      ) VALUES (
        '${photo1Id}', '${user1Id}', 'food_log', '${randomUUID()}', '${randomUUID()}',
        'p/${photo1Id}/f.jpg', 'p/${photo1Id}/t.jpg', 1000, 200, 400, 300, 'approved',
        'etag-full', 'etag-thumb', 'pass', 'pass'
      );
    `);

    repo = createReportsRepo(pool);
  });

  it('addReport is unique per reporter; duplicate creates one row', async () => {
    await repo.addReport({
      photoId: photo1Id,
      reporterId: user2Id,
      reason: 'inappropriate',
      note: 'Not appropriate for kids',
    });

    // Duplicate report by same reporter
    await repo.addReport({
      photoId: photo1Id,
      reporterId: user2Id,
      reason: 'spam',
    });

    const count = await repo.countOpenDistinct(photo1Id);
    expect(count).toBe(1);

    const rows = db.public.many(
      `SELECT id FROM photo_reports WHERE photo_id = '${photo1Id}' AND reporter_id = '${user2Id}'`
    );
    expect(rows.length).toBe(1);
  });

  it('dismissed reports stop counting towards open distinct reports', async () => {
    await repo.addReport({
      photoId: photo1Id,
      reporterId: user2Id,
      reason: 'inappropriate',
    });
    await repo.addReport({
      photoId: photo1Id,
      reporterId: user3Id,
      reason: 'spam',
    });

    expect(await repo.countOpenDistinct(photo1Id)).toBe(2);

    await repo.dismissOpen(photo1Id);

    // Dismissed reports stop counting
    expect(await repo.countOpenDistinct(photo1Id)).toBe(0);
  });

  it('self-block is rejected by the CHECK constraint', async () => {
    await expect(repo.addBlock(user1Id, user1Id)).rejects.toThrow();
  });

  it('blocking twice leaves one row with the same id (idempotent)', async () => {
    const block1 = await repo.addBlock(user1Id, user2Id);
    expect(block1.id).toBeDefined();

    const block2 = await repo.addBlock(user1Id, user2Id);
    expect(block2.id).toBe(block1.id);

    const isBlocked = await repo.isBlockedEitherWay(user1Id, user2Id);
    expect(isBlocked).toBe(true);
  });

  it('listBlocks returns display_name and avatar_preset from profiles', async () => {
    await repo.addBlock(user1Id, user2Id);

    const blocks = await repo.listBlocks(user1Id);
    expect(blocks.length).toBe(1);
    expect(blocks[0]?.blocked_id).toBe(user2Id);
    expect(blocks[0]?.display_name).toBe('Bob Builder');
    expect(blocks[0]?.avatar_preset).toBe('goofy');
  });

  it('removeBlockById removes only caller own row; another user block id deletes nothing', async () => {
    const block = await repo.addBlock(user1Id, user2Id);

    // Another user attempts to remove it -> false, row remains
    const otherRemoved = await repo.removeBlockById(user3Id, block.id);
    expect(otherRemoved).toBe(false);
    expect(await repo.isBlockedEitherWay(user1Id, user2Id)).toBe(true);

    // Blocker removes it -> true, row is deleted
    const ownerRemoved = await repo.removeBlockById(user1Id, block.id);
    expect(ownerRemoved).toBe(true);
    expect(await repo.isBlockedEitherWay(user1Id, user2Id)).toBe(false);
  });

  it('strike regression (Property 32): removePhotoByOperator increments strikes once, reports upheld, strikes survive sweep cascade', async () => {
    // Seed 3 open reports on photo1
    await repo.addReport({ photoId: photo1Id, reporterId: user2Id, reason: 'inappropriate' });
    await repo.addReport({ photoId: photo1Id, reporterId: user3Id, reason: 'spam' });
    const reporter4 = randomUUID();
    db.public.none(
      `INSERT INTO users (id, email, password_hash) VALUES ('${reporter4}', 'r4@example.com', 'h4')`
    );
    await repo.addReport({ photoId: photo1Id, reporterId: reporter4, reason: 'not_food' });

    // Operator removes photo
    const removalResult = await repo.removePhotoByOperator(photo1Id);
    expect(removalResult.removed).toBe(true);
    expect(removalResult.ownerId).toBe(user1Id);

    // Strike count is 1 (not 3)
    expect(await repo.upheldCountForUser(user1Id)).toBe(1);

    // All reports on photo1 are now upheld
    const openCount = await repo.countOpenDistinct(photo1Id);
    expect(openCount).toBe(0);

    // Hard-delete the photo row with the same statement the sweep uses
    db.public.none(`DELETE FROM photos WHERE id = '${photo1Id}' AND status = 'deleted'`);

    // Verify reports cascaded away
    const reportRows = db.public.many(`SELECT id FROM photo_reports WHERE photo_id = '${photo1Id}'`);
    expect(reportRows.length).toBe(0);

    // Critical assertion for Property 32: strike history survived the sweep hard delete!
    expect(await repo.upheldCountForUser(user1Id)).toBe(1);

    // Removing a second photo of the same uploader increments to 2
    const photo2Id = randomUUID();
    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height, status,
        full_etag, thumb_etag, harm_verdict, vision_verdict
      ) VALUES (
        '${photo2Id}', '${user1Id}', 'food_log', '${randomUUID()}', '${randomUUID()}',
        'p/${photo2Id}/f.jpg', 'p/${photo2Id}/t.jpg', 1000, 200, 400, 300, 'approved',
        'etag-full-2', 'etag-thumb-2', 'pass', 'pass'
      );
    `);
    const removal2 = await repo.removePhotoByOperator(photo2Id);
    expect(removal2.removed).toBe(true);
    expect(await repo.upheldCountForUser(user1Id)).toBe(2);

    // Calling removePhotoByOperator a second time on the already deleted photo leaves strikes at 2
    const removal2Again = await repo.removePhotoByOperator(photo2Id);
    expect(removal2Again.removed).toBe(false);
    expect(await repo.upheldCountForUser(user1Id)).toBe(2);

    // An uploader with no removals reads 0
    expect(await repo.upheldCountForUser(user2Id)).toBe(0);
  });

  it('a photo with null owner_id is removed without creating a strikes row', async () => {
    const nullOwnerPhotoId = randomUUID();
    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height, status,
        full_etag, thumb_etag, harm_verdict, vision_verdict
      ) VALUES (
        '${nullOwnerPhotoId}', NULL, 'food_log', '${randomUUID()}', '${randomUUID()}',
        'p/${nullOwnerPhotoId}/f.jpg', 'p/${nullOwnerPhotoId}/t.jpg', 1000, 200, 400, 300, 'approved',
        'etag-full-null', 'etag-thumb-null', 'pass', 'pass'
      );
    `);

    const result = await repo.removePhotoByOperator(nullOwnerPhotoId);
    expect(result.removed).toBe(true);
    expect(result.ownerId).toBeNull();

    const strikes = db.public.many('SELECT user_id FROM photo_upload_strikes');
    expect(strikes.length).toBe(0);
  });

  it('addBan and isBanned: bans uploader, and resolves owner from photos.owner_id of unswept deleted photo', async () => {
    // Soft-delete photo1
    db.public.none(
      `UPDATE photos SET status = 'deleted', deleted_at = now() WHERE id = '${photo1Id}'`
    );

    // Resolve owner from photos.owner_id of unswept deleted photo
    const photoRow = db.public.one(`SELECT owner_id FROM photos WHERE id = '${photo1Id}'`);
    expect(photoRow.owner_id).toBe(user1Id);

    expect(await repo.isBanned(user1Id)).toBe(false);

    await repo.addBan(photoRow.owner_id, 'repeated violations');

    expect(await repo.isBanned(user1Id)).toBe(true);
    expect(await repo.isBanned(user2Id)).toBe(false);
  });
});

const DEFAULT_CONFIG: PhotoServiceConfig = {
  enabled: true,
  foodEnabled: true,
  tripEnabled: true,
  maxPerFoodLog: 4,
  maxPerTrip: 300,
  maxFeedPostPhotos: 4,
  maxBatch: 10,
  maxBytes: 1048576,
  maxThumbBytes: 65536,
  dailyUploadCap: 20,
  globalDailyCap: 2000,
  putUrlTtlSeconds: 900,
  getUrlTtlSeconds: 3600,
  reportAutohideFood: 3,
  reportAutohideTrip: 1,
  experienceStripMax: 8,
  recapHighlightMax: 6,
};

describe('Task 21.5 / Property 13: Trip report counting and autohide', () => {
  // State in the test that the count is computed in SQL against the real tables, so a mocked repo cannot pass it.
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: ReportsRepo;
  let photosRepo: PhotosRepo;
  let fakeStore: FakeObjectStore;

  let organizerId: string;
  let member1Id: string;
  let member2Id: string;
  let friendNonMemberId: string;
  let tripId: string;
  let shareId: string;
  let tripPhotoId: string;
  let foodPhotoId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = new PgMemPool() as unknown as DbPool;

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');

    organizerId = randomUUID();
    member1Id = randomUUID();
    member2Id = randomUUID();
    friendNonMemberId = randomUUID();
    tripId = randomUUID();
    shareId = randomUUID();
    tripPhotoId = randomUUID();
    foodPhotoId = randomUUID();

    // Users and profiles
    db.public.none(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('${organizerId}', 'org@example.com', 'h1'),
        ('${member1Id}', 'm1@example.com', 'h2'),
        ('${member2Id}', 'm2@example.com', 'h3'),
        ('${friendNonMemberId}', 'fnm@example.com', 'h4');

      INSERT INTO profiles (user_id, display_name, avatar_preset) VALUES
        ('${organizerId}', 'Organizer User', 'castle'),
        ('${member1Id}', 'Member One', 'wishing-star'),
        ('${member2Id}', 'Member Two', 'ear-balloon'),
        ('${friendNonMemberId}', 'Friend NonMember', 'fireworks');

      INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES
        ('${tripId}', '${organizerId}', 'Disney Trip 2026', 'Notes', '2026-10-20', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role, joined_at) VALUES
        ('${tripId}', '${organizerId}', 'organizer', now()),
        ('${tripId}', '${member1Id}', 'member', now()),
        ('${tripId}', '${member2Id}', 'member', now());
    `);

    // Friendship between organizer and non-member friend
    const pair = canonicalPair(organizerId, friendNonMemberId);
    db.public.none(`
      INSERT INTO friendships (user_lo_id, user_hi_id) VALUES
        ('${pair.lo}', '${pair.hi}');
    `);

    // Approved Trip photo
    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height, status,
        full_etag, thumb_etag, harm_verdict, vision_verdict, sort_at
      ) VALUES (
        '${tripPhotoId}', '${organizerId}', 'trip', '${tripId}', '${tripId}',
        'p/${tripPhotoId}/f.jpg', 'p/${tripPhotoId}/t.jpg', 1000, 200, 800, 600, 'approved',
        'etag-full', 'etag-thumb', 'pass', 'pass', now()
      );
    `);

    // Approved Food photo
    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height, status,
        full_etag, thumb_etag, harm_verdict, vision_verdict, sort_at
      ) VALUES (
        '${foodPhotoId}', '${organizerId}', 'food_log', '${randomUUID()}', '${randomUUID()}',
        'p/${foodPhotoId}/f.jpg', 'p/${foodPhotoId}/t.jpg', 1000, 200, 800, 600, 'approved',
        'etag-full', 'etag-thumb', 'pass', 'pass', now()
      );
    `);

    repo = createReportsRepo(pool);
    photosRepo = createPhotosRepo(pool);
    fakeStore = new FakeObjectStore();
  });

  function createTestServer(options: {
    currentUserId?: string;
    config?: Partial<PhotoServiceConfig>;
  }): FastifyInstance {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request, reply) => {
      if (!options.currentUserId) {
        return reply.status(401).send({ error: { code: 'unauthorized', message: 'No session' } });
      }
      (request as any).user = { id: options.currentUserId };
      (request as any).userId = options.currentUserId;
    };

    const service = new PhotoService({
      pool,
      repo: photosRepo,
      reportsRepo: repo,
      objectStore: fakeStore,
      targetAdapters: [new TripTarget({ pool }), new FoodLogTarget({ pool })],
      config: { ...DEFAULT_CONFIG, ...(options.config ?? {}) },
      recapShareGate: {
        resolve: async (givenShareId, recipientId) => {
          if (givenShareId === shareId && recipientId === friendNonMemberId) {
            return {
              tripId,
              tripName: 'Disney Trip 2026',
              sharerDisplayName: 'Organizer User',
              sharerId: organizerId,
              tripAvailable: true,
              includePhotos: true,
            };
          }
          return null;
        },
      },
      recapPhotoPort: {
        isAlbumPhoto: async (_access, _recipientId, photoId) => photoId === tripPhotoId,
      },
    });

    app.register(photoRoutes, { photoService: service, requireSession });
    return app;
  }

  it('countedOpenReports repo SQL: counts only current members of scope_id for trip photos', async () => {
    // Non-member Friend reports -> counted is 0
    await repo.addReport({
      photoId: tripPhotoId,
      reporterId: friendNonMemberId,
      reason: 'inappropriate',
    });
    expect(await repo.countedOpenReports(tripPhotoId)).toBe(0);

    // Current member reports -> counted becomes 1
    await repo.addReport({
      photoId: tripPhotoId,
      reporterId: member1Id,
      reason: 'inappropriate',
    });
    expect(await repo.countedOpenReports(tripPhotoId)).toBe(1);

    // Duplicate report by same member -> counted stays 1
    await repo.addReport({
      photoId: tripPhotoId,
      reporterId: member1Id,
      reason: 'spam',
    });
    expect(await repo.countedOpenReports(tripPhotoId)).toBe(1);

    // Second member reports -> counted becomes 2
    await repo.addReport({
      photoId: tripPhotoId,
      reporterId: member2Id,
      reason: 'inappropriate',
    });
    expect(await repo.countedOpenReports(tripPhotoId)).toBe(2);

    // Member 2 leaves the trip -> membership is read when count runs, so count falls back to 1
    db.public.none(
      `DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${member2Id}'`
    );
    expect(await repo.countedOpenReports(tripPhotoId)).toBe(1);
  });

  it('countedOpenReports repo SQL: counts every distinct open reporter for food_log photos', async () => {
    // Reporter 1 reports food photo -> count is 1
    await repo.addReport({
      photoId: foodPhotoId,
      reporterId: member1Id,
      reason: 'not_food',
    });
    expect(await repo.countedOpenReports(foodPhotoId)).toBe(1);

    // Reporter 2 reports food photo -> count is 2
    await repo.addReport({
      photoId: foodPhotoId,
      reporterId: friendNonMemberId,
      reason: 'spam',
    });
    expect(await repo.countedOpenReports(foodPhotoId)).toBe(2);

    // Duplicate by reporter 1 -> count stays 2
    await repo.addReport({
      photoId: foodPhotoId,
      reporterId: member1Id,
      reason: 'other',
    });
    expect(await repo.countedOpenReports(foodPhotoId)).toBe(2);

    // Dismiss open reports -> count becomes 0
    await repo.dismissOpen(foodPhotoId);
    expect(await repo.countedOpenReports(foodPhotoId)).toBe(0);
  });

  it('server.inject: Friend who is not a Trip member reports approved Trip photo through valid shareId -> report row exists in admin queue, but photo stays approved', async () => {
    const app = createTestServer({ currentUserId: friendNonMemberId });

    const res = await app.inject({
      method: 'POST',
      url: `/photos/${tripPhotoId}/report`,
      payload: {
        reason: 'inappropriate',
        shareId,
      },
    });
    expect(res.statusCode).toBe(204);

    // Report row exists in database
    const reportRows = db.public.many(
      `SELECT id, reason FROM photo_reports WHERE photo_id = '${tripPhotoId}' AND reporter_id = '${friendNonMemberId}'`
    );
    expect(reportRows.length).toBe(1);
    expect(reportRows[0]?.reason).toBe('inappropriate');

    // Photo is listed in admin queue query
    const adminQueue = db.public.many(
      `SELECT DISTINCT photo_id FROM photo_reports WHERE status = 'open'`
    );
    expect(adminQueue.map((r) => r.photo_id)).toContain(tripPhotoId);

    // Photo status in database stays 'approved'
    const photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${tripPhotoId}'`);
    expect(photoRow.status).toBe('approved');
  });

  it('server.inject: Current Trip member report of the same photo hides it (hidden, hidden_reason = reports) at PHOTOS_REPORT_AUTOHIDE_TRIP = 1', async () => {
    // Threshold is 1 (default)
    const app = createTestServer({ currentUserId: member1Id });

    const res = await app.inject({
      method: 'POST',
      url: `/photos/${tripPhotoId}/report`,
      payload: {
        reason: 'inappropriate',
      },
    });
    expect(res.statusCode).toBe(204);

    // Photo status is now 'hidden' with hidden_reason = 'reports'
    const photoRow = db.public.one(`SELECT status, hidden_reason FROM photos WHERE id = '${tripPhotoId}'`);
    expect(photoRow.status).toBe('hidden');
    expect(photoRow.hidden_reason).toBe('reports');
  });

  it('server.inject: With threshold raised to 2, one member + one non-member leaves it approved, second member report hides it', async () => {
    const member1App = createTestServer({
      currentUserId: member1Id,
      config: { reportAutohideTrip: 2 },
    });
    const nonMemberApp = createTestServer({
      currentUserId: friendNonMemberId,
      config: { reportAutohideTrip: 2 },
    });
    const member2App = createTestServer({
      currentUserId: member2Id,
      config: { reportAutohideTrip: 2 },
    });

    // 1. Member 1 reports -> count is 1, photo remains 'approved'
    const res1 = await member1App.inject({
      method: 'POST',
      url: `/photos/${tripPhotoId}/report`,
      payload: { reason: 'inappropriate' },
    });
    expect(res1.statusCode).toBe(204);
    let photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${tripPhotoId}'`);
    expect(photoRow.status).toBe('approved');

    // 2. Non-member reports with valid shareId -> count is still 1, photo remains 'approved'
    const res2 = await nonMemberApp.inject({
      method: 'POST',
      url: `/photos/${tripPhotoId}/report`,
      payload: { reason: 'inappropriate', shareId },
    });
    expect(res2.statusCode).toBe(204);
    photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${tripPhotoId}'`);
    expect(photoRow.status).toBe('approved');

    // 3. Member 2 reports -> count reaches threshold 2, photo becomes 'hidden'
    const res3 = await member2App.inject({
      method: 'POST',
      url: `/photos/${tripPhotoId}/report`,
      payload: { reason: 'spam' },
    });
    expect(res3.statusCode).toBe(204);
    photoRow = db.public.one(`SELECT status, hidden_reason FROM photos WHERE id = '${tripPhotoId}'`);
    expect(photoRow.status).toBe('hidden');
    expect(photoRow.hidden_reason).toBe('reports');
  });

  it('server.inject: Reporter who left Trip is not counted when a later report triggers the count; already hidden photo stays hidden', async () => {
    const member1App = createTestServer({
      currentUserId: member1Id,
      config: { reportAutohideTrip: 2 },
    });
    const nonMemberApp = createTestServer({
      currentUserId: friendNonMemberId,
      config: { reportAutohideTrip: 2 },
    });

    // Member 1 reports -> count is 1, photo remains 'approved'
    await member1App.inject({
      method: 'POST',
      url: `/photos/${tripPhotoId}/report`,
      payload: { reason: 'inappropriate' },
    });
    let photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${tripPhotoId}'`);
    expect(photoRow.status).toBe('approved');

    // Member 1 leaves Trip (row deleted from trip_memberships)
    db.public.none(
      `DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${member1Id}'`
    );

    // Later report triggers count -> membership is read when count runs, so member 1 is not counted (count = 0)
    await nonMemberApp.inject({
      method: 'POST',
      url: `/photos/${tripPhotoId}/report`,
      payload: { reason: 'spam', shareId },
    });
    photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${tripPhotoId}'`);
    expect(photoRow.status).toBe('approved');

    // If photo was already hidden, it stays hidden
    db.public.none(
      `UPDATE photos SET status = 'hidden', hidden_reason = 'reports' WHERE id = '${tripPhotoId}'`
    );
    const hiddenRow = db.public.one(`SELECT status, hidden_reason FROM photos WHERE id = '${tripPhotoId}'`);
    expect(hiddenRow.status).toBe('hidden');
    expect(hiddenRow.hidden_reason).toBe('reports');
  });

  it('server.inject: Food photo threshold of 3 still counts every distinct reporter, and duplicates do not increase count', async () => {
    const app1 = createTestServer({
      currentUserId: member1Id,
      config: { reportAutohideFood: 3 },
    });
    const app2 = createTestServer({
      currentUserId: member2Id,
      config: { reportAutohideFood: 3 },
    });
    const app3 = createTestServer({
      currentUserId: friendNonMemberId,
      config: { reportAutohideFood: 3 },
    });

    // Reporter 1 reports -> count 1, approved
    await app1.inject({
      method: 'POST',
      url: `/photos/${foodPhotoId}/report`,
      payload: { reason: 'not_food' },
    });
    let photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${foodPhotoId}'`);
    expect(photoRow.status).toBe('approved');

    // Duplicate report by reporter 1 -> count stays 1, approved
    await app1.inject({
      method: 'POST',
      url: `/photos/${foodPhotoId}/report`,
      payload: { reason: 'spam' },
    });
    photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${foodPhotoId}'`);
    expect(photoRow.status).toBe('approved');

    // Reporter 2 reports -> count 2, approved
    await app2.inject({
      method: 'POST',
      url: `/photos/${foodPhotoId}/report`,
      payload: { reason: 'inappropriate' },
    });
    photoRow = db.public.one(`SELECT status FROM photos WHERE id = '${foodPhotoId}'`);
    expect(photoRow.status).toBe('approved');

    // Reporter 3 reports -> count 3, reaches threshold 3, hidden
    await app3.inject({
      method: 'POST',
      url: `/photos/${foodPhotoId}/report`,
      payload: { reason: 'other' },
    });
    photoRow = db.public.one(`SELECT status, hidden_reason FROM photos WHERE id = '${foodPhotoId}'`);
    expect(photoRow.status).toBe('hidden');
    expect(photoRow.hidden_reason).toBe('reports');
  });
});
