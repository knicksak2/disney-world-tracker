/**
 * Unit and integration tests for PhotoService using pg-mem and fake adapters.
 *
 * Implements: Task 8.2
 * Validates: Requirements 1.6, 3.1, 3.4, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5,
 *            4.6, 4.7, 4.8, 4.9, 4.10, 5.1, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9,
 *            5.10, 5.12, 10.5, 10.8, 16.1, 16.2, 16.4, 17.1, 17.2, 17.4, 19.9
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/AppError.js';
import type { DbPool } from '../../../db/pool.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { createReportsRepo, type ReportsRepo } from '../reportsRepo.js';
import { PhotoService, type PhotoServiceConfig, type PhotoUploadItemInput } from '../service.js';
import { FakeObjectStore, FakeClock, FakeTargetAdapter } from './fakes.js';
import { photoKeys } from '../domain/objectKeys.js';

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

function adaptPgMemSql(
  text: string,
  params?: ReadonlyArray<unknown>
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined) return [text, params];

  let adaptedText = text;
  const newParams = [...params];

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

  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE\s*\(\s*b\.blocker_id\s*=\s*\$(\d+)\s+AND\s+b\.blocked_id\s*=\s*p\.owner_id\s*\)\s*OR\s*\(\s*b\.blocker_id\s*=\s*p\.owner_id\s+AND\s+b\.blocked_id\s*=\s*\$\1\s*\)\s*\)/gi,
      (_match, viewerParam: string) => {
        return `AND (p.owner_id IS NULL OR (p.owner_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = $${viewerParam}) AND p.owner_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = $${viewerParam})))`;
      }
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

const DEFAULT_TEST_CONFIG: PhotoServiceConfig = {
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

describe('PhotoService (Task 8.2)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PhotosRepo;
  let reportsRepo: ReportsRepo;
  let objectStore: FakeObjectStore;
  let clock: FakeClock;
  let targetAdapter: FakeTargetAdapter;
  let service: PhotoService;
  let enqueuedIds: string[];

  let user1Id: string;
  let user2Id: string;
  let user3Id: string;
  let log1Id: string;
  let foodItem1Id: string;
  let exp1Id: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');

    // Free-text avatar_preset (this suite stores arbitrary preset ids, so no 0013 CHECK). 0064's visibility
    // views read it, friendships and trip_memberships (0015).
    db.public.none('ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_preset TEXT;');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0064_account_deletion.sql');

    user1Id = randomUUID();
    user2Id = randomUUID();
    user3Id = randomUUID();
    foodItem1Id = randomUUID();
    exp1Id = randomUUID();
    log1Id = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${user1Id}', 'u1@example.com', 'h1'),
             ('${user2Id}', 'u2@example.com', 'h2'),
             ('${user3Id}', 'u3@example.com', 'h3');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${user1Id}', 'Alice Wonderland', 'mickey'),
             ('${user2Id}', 'Bob Friend', 'goofy'),
             ('${user3Id}', 'Charlie Stranger', null);

      -- user1 and user2 are Friends
      INSERT INTO friendships (user_lo_id, user_hi_id)
      VALUES ('${user1Id < user2Id ? user1Id : user2Id}', '${user1Id < user2Id ? user2Id : user1Id}');

      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${exp1Id}', 'exp-upstream-1', 'Cinderella Castle Cafe', 'Magic Kingdom', 'Restaurant');

      INSERT INTO food_items (id, name, experience_id)
      VALUES ('${foodItem1Id}', 'Magic Cupcake', '${exp1Id}');

      INSERT INTO food_item_logs (id, user_id, food_item_id, user_tz, visited_on)
      VALUES ('${log1Id}', '${user1Id}', '${foodItem1Id}', 'America/New_York', '2025-06-01');
    `);

    repo = createPhotosRepo(pool);
    reportsRepo = createReportsRepo(pool);
    objectStore = new FakeObjectStore();
    clock = new FakeClock(new Date());
    targetAdapter = new FakeTargetAdapter('food_log', 'harm_and_vision', 4);
    targetAdapter.authorizeFn = async (uid, tid) => {
      if (tid === log1Id && uid === user1Id) {
        return { scopeId: foodItem1Id };
      }
      throw new AppError('food_log_not_found', 'Food log not found');
    };

    enqueuedIds = [];
    service = new PhotoService({
      pool,
      repo,
      reportsRepo,
      objectStore,
      targetAdapters: [targetAdapter],
      config: DEFAULT_TEST_CONFIG,
      clock,
      moderationEnqueuer: {
        enqueue: (id) => enqueuedIds.push(id),
      },
    });
  });

  const validUploadItem: PhotoUploadItemInput = {
    contentType: 'image/jpeg',
    byteSize: 100000,
    thumbByteSize: 15000,
    width: 800,
    height: 600,
  };

  describe('initiate', () => {
    it('returns presigned PUT URLs for upload keys (u/) only (Requirement 3.8)', async () => {
      const res = await service.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem],
      });

      expect(res.slots).toHaveLength(1);
      const slot = res.slots[0]!;
      expect(slot.photoId).toBeDefined();
      expect(slot.putUrl).toContain(`u/${slot.photoId}/full.jpg`);
      expect(slot.thumbPutUrl).toContain(`u/${slot.photoId}/thumb.jpg`);

      // Verify ObjectStore recorded presigned PUTs only for u/ keys
      expect(objectStore.presignedPuts.length).toBe(2);
      for (const p of objectStore.presignedPuts) {
        expect(p.key.startsWith('u/')).toBe(true);
        expect(p.key.startsWith('p/')).toBe(false);
      }
    });

    it('enforces kill switches with details.reason === "kill_switch"', async () => {
      const disabledService = new PhotoService({
        pool,
        repo,
        reportsRepo,
        objectStore,
        targetAdapters: [targetAdapter],
        config: { ...DEFAULT_TEST_CONFIG, enabled: false },
        clock,
      });

      await expect(
        disabledService.initiate(user1Id, {
          target: { kind: 'food_log', id: log1Id },
          items: [validUploadItem],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'photo_uploads_disabled',
          details: { reason: 'kill_switch' },
        })
      );
    });

    it('enforces food kill switch PHOTOS_FOOD_ENABLED=false', async () => {
      const foodDisabledService = new PhotoService({
        pool,
        repo,
        reportsRepo,
        objectStore,
        targetAdapters: [targetAdapter],
        config: { ...DEFAULT_TEST_CONFIG, foodEnabled: false },
        clock,
      });

      await expect(
        foodDisabledService.initiate(user1Id, {
          target: { kind: 'food_log', id: log1Id },
          items: [validUploadItem],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'photo_uploads_disabled',
          details: { reason: 'kill_switch' },
        })
      );
    });

    it('refuses banned user with photo_uploads_banned (403)', async () => {
      await reportsRepo.addBan(user1Id, 'Spamming');

      await expect(
        service.initiate(user1Id, {
          target: { kind: 'food_log', id: log1Id },
          items: [validUploadItem],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'photo_uploads_banned',
        })
      );
    });

    it('refuses unauthorized target with food_log_not_found', async () => {
      await expect(
        service.initiate(user2Id, {
          target: { kind: 'food_log', id: log1Id }, // user2 is not owner of log1
          items: [validUploadItem],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'food_log_not_found',
        })
      );
    });

    it('consumes per-user quota and refuses when quota exceeded (429)', async () => {
      const highTargetCapAdapter = new FakeTargetAdapter('food_log', 'harm_and_vision', 20);
      highTargetCapAdapter.authorizeFn = async (uid, tid) => {
        if (tid === log1Id && uid === user1Id) {
          return { scopeId: foodItem1Id };
        }
        throw new AppError('food_log_not_found', 'Food log not found');
      };

      const tightCapService = new PhotoService({
        pool,
        repo,
        reportsRepo,
        objectStore,
        targetAdapters: [highTargetCapAdapter],
        config: { ...DEFAULT_TEST_CONFIG, dailyUploadCap: 5 },
        clock,
      });

      // 3 items consumes 3
      await tightCapService.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem, validUploadItem, validUploadItem],
      });

      // Another 3 would total 6 > 5 -> photo_quota_exceeded, no rows created
      await expect(
        tightCapService.initiate(user1Id, {
          target: { kind: 'food_log', id: log1Id },
          items: [validUploadItem, validUploadItem, validUploadItem],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'photo_quota_exceeded',
        })
      );
    });

    it('enforces PHOTOS_GLOBAL_DAILY_CAP and reflects in remainingToday (Requirement 5.10, 5.11)', async () => {
      const tightGlobalService = new PhotoService({
        pool,
        repo,
        reportsRepo,
        objectStore,
        targetAdapters: [targetAdapter],
        config: { ...DEFAULT_TEST_CONFIG, globalDailyCap: 3 },
        clock,
      });

      // Request of 4 items is refused with photo_uploads_disabled (details: { reason: 'global_cap' })
      await expect(
        tightGlobalService.initiate(user1Id, {
          target: { kind: 'food_log', id: log1Id },
          items: [validUploadItem, validUploadItem, validUploadItem, validUploadItem],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'photo_uploads_disabled',
          details: { reason: 'global_cap' },
        })
      );

      // User's own daily count was not incremented
      const cfgBefore = await tightGlobalService.getClientConfig(user1Id);
      expect(cfgBefore.remainingToday).toBe(3);

      // Request of 3 items succeeds
      await tightGlobalService.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem, validUploadItem, validUploadItem],
      });

      // GET /photos/config then reports remainingToday: 0
      const cfgAfter = await tightGlobalService.getClientConfig(user1Id);
      expect(cfgAfter.remainingToday).toBe(0);
    });

    it('enforces per-target cap using countLiveForTarget (Property 37, Requirement 5.12)', async () => {
      // 1. Seed 4 uploading rows older than putUrlTtlSeconds (900 s = 15 min): set created_at 16 min ago
      const oldTime = new Date(clock.now().getTime() - 16 * 60 * 1000);
      for (let i = 0; i < 4; i++) {
        await repo.insertUploading({
          id: randomUUID(),
          ownerId: user1Id,
          targetKind: 'food_log',
          targetId: log1Id,
          scopeId: foodItem1Id,
          objectKey: `u/${randomUUID()}/full.jpg`,
          thumbKey: `u/${randomUUID()}/thumb.jpg`,
          byteSize: 1000,
          thumbByteSize: 100,
          width: 100,
          height: 100,
          createdAt: oldTime,
        });
      }

      // Old uploading rows do not count towards target cap -> new initiate succeeds
      const initRes = await service.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem],
      });
      expect(initRes.slots).toHaveLength(1);

      // 2. Add 2 more live rows plus 1 rejected row -> total live = 1 (current) + 2 + 1 = 4
      for (let i = 0; i < 2; i++) {
        await repo.insertUploading({
          id: randomUUID(),
          ownerId: user1Id,
          targetKind: 'food_log',
          targetId: log1Id,
          scopeId: foodItem1Id,
          objectKey: `u/${randomUUID()}/full.jpg`,
          thumbKey: `u/${randomUUID()}/thumb.jpg`,
          byteSize: 1000,
          thumbByteSize: 100,
          width: 100,
          height: 100,
          createdAt: clock.now(),
        });
      }

      const rejectedPhotoId = randomUUID();
      await repo.insertUploading({
        id: rejectedPhotoId,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: `u/${rejectedPhotoId}/full.jpg`,
        thumbKey: `u/${rejectedPhotoId}/thumb.jpg`,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.updateStatus(rejectedPhotoId, 'uploading', 'rejected', { rejectReason: 'not_food' });

      // Cap is 4. Currently 1 + 2 + 1 = 4 live rows.
      // Trying to initiate another item fails with photo_target_full
      await expect(
        service.initiate(user1Id, {
          target: { kind: 'food_log', id: log1Id },
          items: [validUploadItem],
        })
      ).rejects.toThrowError(
        expect.objectContaining({
          code: 'photo_target_full',
        })
      );

      // Deleting the rejected row frees up a slot
      await service.delete(user1Id, rejectedPhotoId);

      // Now initiate succeeds again
      const retryRes = await service.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem],
      });
      expect(retryRes.slots).toHaveLength(1);
    });
  });

  describe('confirm', () => {
    it('confirms uploaded objects, records ETags, sets pending, and enqueues moderation', async () => {
      const initRes = await service.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem],
      });
      const photoId = initRes.slots[0]!.photoId;
      const keys = photoKeys(photoId);

      // Place objects in fake ObjectStore
      const fullObj = objectStore.put(keys.uploadFull, new Uint8Array([1, 2, 3, 4]));
      const thumbObj = objectStore.put(keys.uploadThumb, new Uint8Array([5, 6]));

      const confirmRes = await service.confirm(user1Id, { photoIds: [photoId] });
      expect(confirmRes.results).toEqual([{ photoId, result: 'accepted' }]);

      // Verify row is pending with ETags recorded
      const photoRow = await repo.getById(photoId);
      expect(photoRow?.status).toBe('pending');
      expect(photoRow?.full_etag).toBe(fullObj.etag);
      expect(photoRow?.thumb_etag).toBe(thumbObj.etag);

      // Enqueued in runner
      expect(enqueuedIds).toEqual([photoId]);

      // Confirm twice enqueues only once and returns already
      const secondConfirm = await service.confirm(user1Id, { photoIds: [photoId] });
      expect(secondConfirm.results).toEqual([{ photoId, result: 'already' }]);
      expect(enqueuedIds).toEqual([photoId]);
    });

    it('returns incomplete when upload object is missing', async () => {
      const initRes = await service.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem],
      });
      const photoId = initRes.slots[0]!.photoId;

      // Do NOT put objects in store
      const confirmRes = await service.confirm(user1Id, { photoIds: [photoId] });
      expect(confirmRes.results).toEqual([{ photoId, result: 'incomplete' }]);

      const photoRow = await repo.getById(photoId);
      expect(photoRow?.status).toBe('uploading');
      expect(enqueuedIds).toHaveLength(0);
    });

    it('moves photo to deleted with result invalid when HEAD object is oversize', async () => {
      const initRes = await service.initiate(user1Id, {
        target: { kind: 'food_log', id: log1Id },
        items: [validUploadItem],
      });
      const photoId = initRes.slots[0]!.photoId;
      const keys = photoKeys(photoId);

      // Put oversize full object (> maxBytes: 1048576)
      const oversizeBytes = new Uint8Array(2000000);
      objectStore.put(keys.uploadFull, oversizeBytes);
      objectStore.put(keys.uploadThumb, new Uint8Array([1, 2]));

      const confirmRes = await service.confirm(user1Id, { photoIds: [photoId] });
      expect(confirmRes.results).toEqual([{ photoId, result: 'invalid' }]);

      const photoRow = await repo.getById(photoId);
      expect(photoRow?.status).toBe('deleted');
      expect(enqueuedIds).toHaveLength(0);
    });

    it('throws photo_not_found when confirming unknown or non-owned photo', async () => {
      await expect(
        service.confirm(user1Id, { photoIds: [randomUUID()] })
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'photo_not_found' })
      );
    });
  });

  describe('status and statusBatch', () => {
    it('opportunistically resumes a due pending photo on poll and not a live-lease one', async () => {
      const photoId1 = randomUUID();
      const keys1 = photoKeys(photoId1);
      await repo.insertUploading({
        id: photoId1,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: keys1.uploadFull,
        thumbKey: keys1.uploadThumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(photoId1, { fullEtag: 'e1', thumbEtag: 'e2' }, clock.now());
      clock.advance(1000);

      // 1. Photo is pending, lease_until is null, next_attempt_at is now -> due!
      const status1 = await service.status(user1Id, photoId1);
      expect(status1.id).toBe(photoId1);
      expect(status1.status).toBe('pending');
      expect(enqueuedIds).toContain(photoId1);

      // 2. Claim photo so lease_until is in future
      enqueuedIds.length = 0;
      await repo.claim(photoId1, 180, 6, clock.now());

      // Poll again while lease is live -> does not enqueue!
      await service.status(user1Id, photoId1);
      expect(enqueuedIds).toHaveLength(0);
    });

    it('statusBatch returns owned photos and omits foreign ones', async () => {
      const id1 = randomUUID();
      const id2 = randomUUID();
      const id3 = randomUUID();
      const foreignId = randomUUID();

      for (const id of [id1, id2, id3]) {
        const keys = photoKeys(id);
        await repo.insertUploading({
          id,
          ownerId: user1Id,
          targetKind: 'food_log',
          targetId: log1Id,
          scopeId: foodItem1Id,
          objectKey: keys.uploadFull,
          thumbKey: keys.uploadThumb,
          byteSize: 1000,
          thumbByteSize: 100,
          width: 100,
          height: 100,
          createdAt: clock.now(),
        });
      }

      // Foreign photo owned by user2
      const fKeys = photoKeys(foreignId);
      await repo.insertUploading({
        id: foreignId,
        ownerId: user2Id,
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: foodItem1Id,
        objectKey: fKeys.uploadFull,
        thumbKey: fKeys.uploadThumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });

      const batchRes = await service.statusBatch(user1Id, [id1, id2, id3, foreignId]);
      expect(batchRes.photos).toHaveLength(3);
      const returnedIds = batchRes.photos.map((p) => p.id);
      expect(returnedIds).toContain(id1);
      expect(returnedIds).toContain(id2);
      expect(returnedIds).toContain(id3);
      expect(returnedIds).not.toContain(foreignId);
    });
  });

  describe('delete', () => {
    it('allows owner to delete photo and removes from gallery immediately (Requirement 1.6)', async () => {
      const photoId = randomUUID();
      const keys = photoKeys(photoId);

      await repo.insertUploading({
        id: photoId,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: keys.full,
        thumbKey: keys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(photoId, { fullEtag: 'e1', thumbEtag: 'e2' }, clock.now());
      await repo.markApproved({
        id: photoId,
        harmVerdict: 'pass',
        visionVerdict: 'pass',
        servedAt: clock.now(),
      });

      // Photo is present in gallery
      const galleryBefore = await service.listFoodGallery(user2Id, { scopeId: foodItem1Id });
      expect(galleryBefore.items.some((p) => p.id === photoId)).toBe(true);

      // Delete by owner
      await service.delete(user1Id, photoId);

      // Photo is absent from gallery immediately
      const galleryAfter = await service.listFoodGallery(user2Id, { scopeId: foodItem1Id });
      expect(galleryAfter.items.some((p) => p.id === photoId)).toBe(false);

      // Absent from owner's status
      await expect(service.status(user1Id, photoId)).rejects.toThrowError(
        expect.objectContaining({ code: 'photo_not_found' })
      );
    });

    it('rejects delete by non-owner with photo_not_found', async () => {
      const photoId = randomUUID();
      const keys = photoKeys(photoId);
      await repo.insertUploading({
        id: photoId,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: keys.full,
        thumbKey: keys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });

      await expect(service.delete(user2Id, photoId)).rejects.toThrowError(
        expect.objectContaining({ code: 'photo_not_found' })
      );
    });
  });

  describe('report and auto-hide', () => {
    it('refuses reporting own photo with photo_not_found', async () => {
      const photoId = randomUUID();
      const keys = photoKeys(photoId);
      await repo.insertUploading({
        id: photoId,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: keys.full,
        thumbKey: keys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(photoId, { fullEtag: 'e1', thumbEtag: 'e2' }, clock.now());
      await repo.markApproved({
        id: photoId,
        harmVerdict: 'pass',
        visionVerdict: 'pass',
        servedAt: clock.now(),
      });

      await expect(
        service.report(user1Id, photoId, { reason: 'not_food' })
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'photo_not_found' })
      );
    });

    it('hides food photo on 3rd distinct report', async () => {
      const photoId = randomUUID();
      const keys = photoKeys(photoId);
      await repo.insertUploading({
        id: photoId,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: keys.full,
        thumbKey: keys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(photoId, { fullEtag: 'e1', thumbEtag: 'e2' }, clock.now());
      await repo.markApproved({
        id: photoId,
        harmVerdict: 'pass',
        visionVerdict: 'pass',
        servedAt: clock.now(),
      });

      // User 4 and 5 for additional reporters
      const u4 = randomUUID();
      const u5 = randomUUID();
      db.public.none(`
        INSERT INTO users (id, email, password_hash)
        VALUES ('${u4}', 'u4@example.com', 'h4'),
               ('${u5}', 'u5@example.com', 'h5');
      `);

      // Report 1: user2
      await service.report(user2Id, photoId, { reason: 'not_food' });
      let row = await repo.getById(photoId);
      expect(row?.status).toBe('approved');

      // Duplicate report from user2 does not count twice
      await service.report(user2Id, photoId, { reason: 'spam' });
      row = await repo.getById(photoId);
      expect(row?.status).toBe('approved');

      // Report 2: user3
      await service.report(user3Id, photoId, { reason: 'inappropriate' });
      row = await repo.getById(photoId);
      expect(row?.status).toBe('approved');

      // Report 3: u4 -> reaches threshold (3) -> auto-hides!
      await service.report(u4, photoId, { reason: 'shows_person' });
      row = await repo.getById(photoId);
      expect(row?.status).toBe('hidden');
      expect(row?.hidden_reason).toBe('reports');
    });
  });

  describe('blocking (Requirement 17.1, 17.2, 17.4)', () => {
    it('blocks by photoId, omits userId, reveals name only for Friend, and leaves friendships/memberships unchanged', async () => {
      const friendPhotoId = randomUUID();
      const fKeys = photoKeys(friendPhotoId);
      await repo.insertUploading({
        id: friendPhotoId,
        ownerId: user2Id, // Friend of user1
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: foodItem1Id,
        objectKey: fKeys.full,
        thumbKey: fKeys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(friendPhotoId, { fullEtag: 'e1', thumbEtag: 'e2' }, clock.now());
      await repo.markApproved({
        id: friendPhotoId,
        harmVerdict: 'pass',
        visionVerdict: 'pass',
        servedAt: clock.now(),
      });

      const strangerPhotoId = randomUUID();
      const sKeys = photoKeys(strangerPhotoId);
      await repo.insertUploading({
        id: strangerPhotoId,
        ownerId: user3Id, // Stranger to user1
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: foodItem1Id,
        objectKey: sKeys.full,
        thumbKey: sKeys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(strangerPhotoId, { fullEtag: 'e3', thumbEtag: 'e4' }, clock.now());
      await repo.markApproved({
        id: strangerPhotoId,
        harmVerdict: 'pass',
        visionVerdict: 'pass',
        servedAt: clock.now(),
      });

      // Record friendship row count
      const friendsCountBefore = db.public.many('SELECT COUNT(*)::int AS count FROM friendships')[0].count;

      // 1. Block by friend's photoId
      const friendBlockDto = await service.addBlock(user1Id, { photoId: friendPhotoId });
      expect((friendBlockDto as any).userId).toBeUndefined();
      expect(friendBlockDto.displayName).toBe('Bob Friend');
      expect(friendBlockDto.avatarPreset).toBe('goofy');

      // 2. Block by stranger's photoId
      const strangerBlockDto = await service.addBlock(user1Id, { photoId: strangerPhotoId });
      expect((strangerBlockDto as any).userId).toBeUndefined();
      expect(strangerBlockDto.displayName).toBeNull();
      expect(strangerBlockDto.avatarPreset).toBeNull();

      // Row count in friendships remains identical (Requirement 17.4)
      const friendsCountAfter = db.public.many('SELECT COUNT(*)::int AS count FROM friendships')[0].count;
      expect(friendsCountAfter).toBe(friendsCountBefore);

      // Blocked photos disappear from blocker's gallery read
      const gallery = await service.listFoodGallery(user1Id, { scopeId: foodItem1Id });
      expect(gallery.items.some((p) => p.id === friendPhotoId)).toBe(false);
      expect(gallery.items.some((p) => p.id === strangerPhotoId)).toBe(false);

      // Blocking own photo throws validation_failed
      const ownPhotoId = randomUUID();
      const oKeys = photoKeys(ownPhotoId);
      await repo.insertUploading({
        id: ownPhotoId,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: oKeys.full,
        thumbKey: oKeys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(ownPhotoId, { fullEtag: 'e5', thumbEtag: 'e6' }, clock.now());
      await repo.markApproved({
        id: ownPhotoId,
        harmVerdict: 'pass',
        visionVerdict: 'pass',
        servedAt: clock.now(),
      });

      await expect(
        service.addBlock(user1Id, { photoId: ownPhotoId })
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'validation_failed' })
      );

      // Blocking invisible photo (pending, another user's) throws photo_not_found
      const invisiblePhotoId = randomUUID();
      const invKeys = photoKeys(invisiblePhotoId);
      await repo.insertUploading({
        id: invisiblePhotoId,
        ownerId: user3Id,
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: foodItem1Id,
        objectKey: invKeys.full,
        thumbKey: invKeys.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      }); // Still uploading / pending, not approved

      await expect(
        service.addBlock(user1Id, { photoId: invisiblePhotoId })
      ).rejects.toThrowError(
        expect.objectContaining({ code: 'photo_not_found' })
      );
    });
  });

  describe('food gallery privacy (Property 14, Decision D8)', () => {
    it('provides uploader only to Friends and self, anonymous for strangers', async () => {
      // Photo 1: owned by user1
      const photo1Id = randomUUID();
      const keys1 = photoKeys(photo1Id);
      await repo.insertUploading({
        id: photo1Id,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: keys1.full,
        thumbKey: keys1.thumb,
        byteSize: 1000,
        thumbByteSize: 100,
        width: 100,
        height: 100,
        createdAt: clock.now(),
      });
      await repo.recordConfirm(photo1Id, { fullEtag: 'e1', thumbEtag: 'e2' }, clock.now());
      await repo.markApproved({
        id: photo1Id,
        harmVerdict: 'pass',
        visionVerdict: 'pass',
        servedAt: clock.now(),
      });

      // 1. Viewer is uploader (user1): mine is true, uploader has name
      const selfGallery = await service.listFoodGallery(user1Id, { scopeId: foodItem1Id });
      const selfItem = selfGallery.items.find((p) => p.id === photo1Id);
      expect(selfItem?.mine).toBe(true);
      expect(selfItem?.uploader).toEqual({
        userId: user1Id,
        displayName: 'Alice Wonderland',
        avatarPreset: 'mickey',
      });

      // 2. Viewer is Friend (user2): mine is false, uploader has name
      const friendGallery = await service.listFoodGallery(user2Id, { scopeId: foodItem1Id });
      const friendItem = friendGallery.items.find((p) => p.id === photo1Id);
      expect(friendItem?.mine).toBe(false);
      expect(friendItem?.uploader).toEqual({
        userId: user1Id,
        displayName: 'Alice Wonderland',
        avatarPreset: 'mickey',
      });

      // 3. Viewer is Stranger (user3): mine is false, uploader is NULL
      const strangerGallery = await service.listFoodGallery(user3Id, { scopeId: foodItem1Id });
      const strangerItem = strangerGallery.items.find((p) => p.id === photo1Id);
      expect(strangerItem?.mine).toBe(false);
      expect(strangerItem?.uploader).toBeNull();

      // Serialized response contains no uploader id or profile info
      const json = JSON.stringify(strangerItem);
      expect(json).not.toContain(user1Id);
      expect(json).not.toContain('Alice Wonderland');
      expect(json).not.toContain('mickey');
    });
  });

  describe('cleanup operations', () => {
    it('deleteAllForUser soft-deletes only that user photos', async () => {
      const p1 = randomUUID();
      const p2 = randomUUID();
      await repo.insertUploading({
        id: p1,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: `u/${p1}/full.jpg`,
        thumbKey: `u/${p1}/thumb.jpg`,
        byteSize: 100,
        thumbByteSize: 10,
        width: 10,
        height: 10,
        createdAt: clock.now(),
      });
      await repo.insertUploading({
        id: p2,
        ownerId: user2Id,
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: foodItem1Id,
        objectKey: `u/${p2}/full.jpg`,
        thumbKey: `u/${p2}/thumb.jpg`,
        byteSize: 100,
        thumbByteSize: 10,
        width: 10,
        height: 10,
        createdAt: clock.now(),
      });

      await service.deleteAllForUser(user1Id);

      const r1 = await repo.getById(p1);
      const r2 = await repo.getById(p2);
      expect(r1?.status).toBe('deleted');
      expect(r2?.status).toBe('uploading');
    });

    it('deleteAllForUser with { limit } marks at most that many photos per call', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of ids) {
        await repo.insertUploading({
          id,
          ownerId: user1Id,
          targetKind: 'food_log',
          targetId: randomUUID(),
          scopeId: foodItem1Id,
          objectKey: `u/${id}/full.jpg`,
          thumbKey: `u/${id}/thumb.jpg`,
          byteSize: 100,
          thumbByteSize: 10,
          width: 10,
          height: 10,
          createdAt: clock.now(),
        });
      }

      const first = await service.deleteAllForUser(user1Id, { limit: 2 });
      expect(first).toHaveLength(2);
      const second = await service.deleteAllForUser(user1Id, { limit: 2 });
      expect(second).toHaveLength(1);
      expect([...first, ...second].sort()).toEqual([...ids].sort());
      expect(await service.deleteAllForUser(user1Id, { limit: 2 })).toEqual([]);
    });

    it('softDeleteForTarget soft-deletes photos matching kind and targetId', async () => {
      const p1 = randomUUID();
      await repo.insertUploading({
        id: p1,
        ownerId: user1Id,
        targetKind: 'food_log',
        targetId: log1Id,
        scopeId: foodItem1Id,
        objectKey: `u/${p1}/full.jpg`,
        thumbKey: `u/${p1}/thumb.jpg`,
        byteSize: 100,
        thumbByteSize: 10,
        width: 10,
        height: 10,
        createdAt: clock.now(),
      });

      await service.softDeleteForTarget('food_log', log1Id);

      const r1 = await repo.getById(p1);
      expect(r1?.status).toBe('deleted');
    });
  });
});
