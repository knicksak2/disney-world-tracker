/**
 * Route integration tests for Food Read Routes (Task 9.2).
 *
 * Exercises:
 * - GET /food-items/:foodItemId/photos
 * - GET /experiences/:id/food-photos
 * - GET /locations/:id/food-photos
 * - Auth gate (401 without session)
 * - Approved-only filtering (pending, rejected, hidden, deleted omitted)
 * - Serving URLs (p/ keys)
 * - Block filtering (both directions)
 * - Keyset pagination (limit, nextCursor)
 * - Byline rules: Friend sees uploader profile, stranger gets uploader: null and zero identity leakage
 * - Date format: createdDay (YYYY-MM-DD), no createdAt
 * - Property 14 sentinel test: food_item_logs note, rating, visited_on never leaked
 * - Uploader soft-deletion immediately hides photo from gallery
 * - Cache-Control: private, no-store
 * - PHOTOS_FOOD_ENABLED=false continues serving existing approved photos
 * - Public GET /experiences/:id/food-items route remains public
 *
 * Implements: Task 9.2
 * Validates: Requirements 1.6, 9.4, 9.8, 10.3, 10.5, 10.9, 11.1, 11.2, 11.3, 11.4, 17.1
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastify, { type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { AppError } from '../../../errors/AppError.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { createReportsRepo, type ReportsRepo } from '../reportsRepo.js';
import { PhotoService, type PhotoServiceConfig } from '../service.js';
import { foodReadRoutes } from '../foodReadRoutes.js';
import { foodItemRoutes } from '../../foodLog/routes.js';
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
      if (!Array.isArray(arr)) return match;
      if (arr.length === 0) return '= NULL';
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

  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+food_item_logs\s+l\s+WHERE\s+l\.id\s*=\s*p\.target_id\s*\)/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+food_item_logs\s+l\s+WHERE\s+l\.id\s*=\s*p\.target_id\s*\)/gi,
      'AND p.target_id NOT IN (SELECT l.id FROM food_item_logs l)'
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

describe('Food Photo Read Routes (Task 9.2)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PhotosRepo;
  let reportsRepo: ReportsRepo;
  let store: FakeObjectStore;
  let clock: FakeClock;
  let foodAdapter: FakeTargetAdapter;

  let viewerId: string;
  let friendId: string;
  let strangerId: string;
  let blockedUploaderId: string;
  let blockingUploaderId: string;

  let experienceId: string;
  let locationId: string;
  let foodItemId: string;
  let logId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    // 0064's visibility views read friendships and trip_memberships (0015).
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0064_account_deletion.sql');

    viewerId = randomUUID();
    friendId = randomUUID();
    strangerId = randomUUID();
    blockedUploaderId = randomUUID();
    blockingUploaderId = randomUUID();

    experienceId = randomUUID();
    locationId = randomUUID();
    foodItemId = randomUUID();
    const locFoodItemId = randomUUID();
    logId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${viewerId}', 'viewer@example.com', 'hash'),
             ('${friendId}', 'friend@example.com', 'hash'),
             ('${strangerId}', 'stranger@example.com', 'hash'),
             ('${blockedUploaderId}', 'blocked@example.com', 'hash'),
             ('${blockingUploaderId}', 'blocking@example.com', 'hash');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${viewerId}', 'Viewer User', 'castle'),
             ('${friendId}', 'BestFriendBob', 'wishing-star'),
             ('${strangerId}', 'StrangerSamSentinel', 'ear-balloon'),
             ('${blockedUploaderId}', 'BlockedUser', 'fireworks'),
             ('${blockingUploaderId}', 'BlockingUser', 'magic-wand');

      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${experienceId}', 'exp-1', 'Be Our Guest Restaurant', 'Magic Kingdom', 'Restaurant');

      INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
      VALUES ('${locationId}', 'Fantasyland Popcorn Cart', 'Magic Kingdom', '${viewerId}');

      INSERT INTO food_items (id, name, experience_id, location_id)
      VALUES ('${foodItemId}', 'Grey Stuff Gateau', '${experienceId}', NULL),
             ('${locFoodItemId}', 'Popcorn Bucket', NULL, '${locationId}');

      INSERT INTO food_item_logs (id, user_id, food_item_id, user_tz, visited_on, note, rating)
      VALUES ('${logId}', '${friendId}', '${foodItemId}', 'America/New_York', '2026-10-14', 'SUPER_SECRET_FOOD_NOTE_ABC', 5);
    `);

    // Insert friendship between viewer and friend
    const [lo, hi] = [viewerId, friendId].sort();
    db.public.none(`
      INSERT INTO friendships (user_lo_id, user_hi_id)
      VALUES ('${lo}', '${hi}');
    `);

    // Viewer blocks blockedUploader
    db.public.none(`
      INSERT INTO user_blocks (blocker_id, blocked_id)
      VALUES ('${viewerId}', '${blockedUploaderId}');
    `);

    // blockingUploader blocks viewer
    db.public.none(`
      INSERT INTO user_blocks (blocker_id, blocked_id)
      VALUES ('${blockingUploaderId}', '${viewerId}');
    `);

    repo = createPhotosRepo(pool);
    reportsRepo = createReportsRepo(pool);
    store = new FakeObjectStore();
    clock = new FakeClock(new Date('2026-10-18T15:00:00Z'));
    foodAdapter = new FakeTargetAdapter('food_log', 'harm_and_vision', 4);
  });

  // Regression guard for the "empty tile" bug: every GET URL any route in this file mints
  // must point at an object that exists in the store (only `p/` objects are seeded) and
  // never at a `u/` upload key (deleted on approval).
  afterEach(() => {
    expect(store.missingGetKeys()).toEqual([]);
    for (const key of store.mintedGetKeys()) {
      expect(key.startsWith('u/')).toBe(false);
    }
  });

  function createTestServer(cfgOverrides?: Partial<PhotoServiceConfig>, activeUserId = viewerId) {
    const config: PhotoServiceConfig = { ...DEFAULT_CONFIG, ...cfgOverrides };
    const service = new PhotoService({
      pool,
      repo,
      reportsRepo,
      objectStore: store,
      targetAdapters: [foodAdapter],
      config,
      clock,
    });

    const app = fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new AppError('unauthorized', 'Authentication is required.');
      }
      request.userId = activeUserId;
    };

    app.register(foodReadRoutes, {
      photoService: service,
      requireSession,
    });

    // Also register foodItemRoutes to test that existing public GET /experiences/:id/food-items is public
    const fakeFoodItemRepo = {
      listFoodItems: async (expId: string) => [{ id: foodItemId, name: 'Grey Stuff Gateau', experienceId: expId }],
    } as any;

    app.register(foodItemRoutes({
      repo: fakeFoodItemRepo,
      requireSession,
    }));

    return { app, service };
  }

  async function insertPhoto(
    id: string,
    ownerId: string,
    status: 'uploading' | 'pending' | 'approved' | 'rejected' | 'hidden' | 'deleted',
    createdAt = new Date('2026-10-18T12:00:00Z'),
    targetScopeId = foodItemId
  ): Promise<void> {
    const keys = photoKeys(id);
    const isServed = status === 'approved' || status === 'hidden';
    const harmVerdict = isServed ? "'pass'" : 'NULL';
    const visionVerdict = isServed ? "'pass'" : 'NULL';
    const servedAt = isServed ? `'${createdAt.toISOString()}'` : 'NULL';
    const fullEtag = isServed ? "'etag-full'" : 'NULL';
    const thumbEtag = isServed ? "'etag-thumb'" : 'NULL';
    const rejectReason = status === 'rejected' ? "'not_food'" : 'NULL';
    const hiddenReason = status === 'hidden' ? "'reports'" : 'NULL';

    // Production shape: the row keeps the `u/` upload keys forever; once approved, the
    // pipeline copies the objects to `p/` and DELETES the `u/` objects. So the store holds
    // ONLY the `p/` objects for served photos.
    if (isServed) {
      store.put(keys.full, new Uint8Array([1, 2, 3]));
      store.put(keys.thumb, new Uint8Array([4, 5, 6]));
    }

    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height,
        status, created_at, sort_at, harm_verdict, vision_verdict, served_at,
        full_etag, thumb_etag, reject_reason, hidden_reason
      ) VALUES (
        '${id}', '${ownerId}', 'food_log', '${logId}', '${targetScopeId}',
        '${keys.uploadFull}', '${keys.uploadThumb}', 1000, 100, 800, 600,
        '${status}', '${createdAt.toISOString()}', '${createdAt.toISOString()}',
        ${harmVerdict}, ${visionVerdict}, ${servedAt},
        ${fullEtag}, ${thumbEtag}, ${rejectReason}, ${hiddenReason}
      );
    `);
  }

  it('unauthenticated requests return 401 on all food read routes', async () => {
    const { app } = createTestServer();
    await app.ready();

    const routes = [
      `/food-items/${foodItemId}/photos`,
      `/experiences/${experienceId}/food-photos`,
      `/locations/${locationId}/food-photos`,
    ];

    for (const url of routes) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    }
  });

  it('only approved photos are returned; pending, rejected, hidden, and deleted are omitted', async () => {
    const approvedId = randomUUID();
    const pendingId = randomUUID();
    const rejectedId = randomUUID();
    const hiddenId = randomUUID();
    const deletedId = randomUUID();

    await insertPhoto(approvedId, friendId, 'approved');
    await insertPhoto(pendingId, friendId, 'pending');
    await insertPhoto(rejectedId, friendId, 'rejected');
    await insertPhoto(hiddenId, friendId, 'hidden');
    await insertPhoto(deletedId, friendId, 'deleted');

    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(approvedId);
  });

  it('returned URLs point at p/ serving keys, not u/ upload keys', async () => {
    const photoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved');

    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    const item = body.items[0];

    // The fixture mirrors production: the row still holds the (deleted) u/ upload keys...
    const row = db.public.one(`SELECT object_key, thumb_key FROM photos WHERE id = '${photoId}'`);
    expect(row.object_key).toBe(`u/${photoId}/full.jpg`);
    expect(row.thumb_key).toBe(`u/${photoId}/thumb.jpg`);
    expect([...store.objects.keys()].sort()).toEqual(
      [`p/${photoId}/full.jpg`, `p/${photoId}/thumb.jpg`].sort()
    );

    // ...but the minted URLs must be the p/ serving keys, which exist in the store.
    expect(FakeObjectStore.keyFromUrl(item.url)).toBe(`p/${photoId}/full.jpg`);
    expect(FakeObjectStore.keyFromUrl(item.thumbUrl)).toBe(`p/${photoId}/thumb.jpg`);
    expect(store.objects.has(FakeObjectStore.keyFromUrl(item.url))).toBe(true);
    expect(store.objects.has(FakeObjectStore.keyFromUrl(item.thumbUrl))).toBe(true);
    expect(item.url).not.toContain('u/');
    expect(item.thumbUrl).not.toContain('u/');
  });

  it('restaurant (experience) and location galleries mint p/ serving URLs that exist in the store, not the row u/ keys', async () => {
    const expPhotoId = randomUUID();
    const locPhotoId = randomUUID();
    await insertPhoto(expPhotoId, friendId, 'approved');
    const locItemId = db.public.many('SELECT id FROM food_items WHERE location_id IS NOT NULL;')[0].id;
    await insertPhoto(locPhotoId, friendId, 'approved', new Date('2026-10-18T12:00:00Z'), locItemId);

    const { app } = createTestServer();
    await app.ready();

    const expRes = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(expRes.statusCode).toBe(200);
    const expItem = expRes.json().items[0];
    expect(expItem.id).toBe(expPhotoId);
    expect(FakeObjectStore.keyFromUrl(expItem.url)).toBe(`p/${expPhotoId}/full.jpg`);
    expect(FakeObjectStore.keyFromUrl(expItem.thumbUrl)).toBe(`p/${expPhotoId}/thumb.jpg`);
    expect(store.objects.has(FakeObjectStore.keyFromUrl(expItem.thumbUrl))).toBe(true);

    const locRes = await app.inject({
      method: 'GET',
      url: `/locations/${locationId}/food-photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(locRes.statusCode).toBe(200);
    const locItem = locRes.json().items[0];
    expect(locItem.id).toBe(locPhotoId);
    expect(FakeObjectStore.keyFromUrl(locItem.url)).toBe(`p/${locPhotoId}/full.jpg`);
    expect(FakeObjectStore.keyFromUrl(locItem.thumbUrl)).toBe(`p/${locPhotoId}/thumb.jpg`);
    expect(store.objects.has(FakeObjectStore.keyFromUrl(locItem.thumbUrl))).toBe(true);
  });

  it('omits photos from blocked uploaders in both directions', async () => {
    const friendPhotoId = randomUUID();
    const blockedPhotoId = randomUUID();
    const blockingPhotoId = randomUUID();

    await insertPhoto(friendPhotoId, friendId, 'approved');
    await insertPhoto(blockedPhotoId, blockedUploaderId, 'approved');
    await insertPhoto(blockingPhotoId, blockingUploaderId, 'approved');

    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.items.map((i: any) => i.id);
    expect(ids).toContain(friendPhotoId);
    expect(ids).not.toContain(blockedPhotoId);
    expect(ids).not.toContain(blockingPhotoId);
  });

  it('paginates correctly with limit and nextCursor', async () => {
    const p1 = randomUUID();
    const p2 = randomUUID();
    const p3 = randomUUID();

    await insertPhoto(p1, friendId, 'approved', new Date('2026-10-18T10:00:00Z'));
    await insertPhoto(p2, friendId, 'approved', new Date('2026-10-18T11:00:00Z'));
    await insertPhoto(p3, friendId, 'approved', new Date('2026-10-18T12:00:00Z'));

    const { app } = createTestServer();
    await app.ready();

    // Page 1: limit 2
    const res1 = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos?limit=2`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.items).toHaveLength(2);
    expect(body1.items[0].id).toBe(p3); // newest first
    expect(body1.items[1].id).toBe(p2);
    expect(body1.nextCursor).toBeTruthy();

    // Page 2: with cursor
    const res2 = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0].id).toBe(p1);
    expect(body2.nextCursor).toBeNull();
  });

  it('byline rule: Friend viewer sees displayName and avatarPreset; stranger viewer gets uploader: null and zero identity leakage', async () => {
    const friendPhotoId = randomUUID();
    const strangerPhotoId = randomUUID();

    await insertPhoto(friendPhotoId, friendId, 'approved');
    await insertPhoto(strangerPhotoId, strangerId, 'approved');

    // 1. Friend viewer requests gallery
    const { app: appFriendViewer } = createTestServer(undefined, viewerId);
    await appFriendViewer.ready();

    const resFriend = await appFriendViewer.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(resFriend.statusCode).toBe(200);
    const friendBody = resFriend.json();

    const friendItem = friendBody.items.find((i: any) => i.id === friendPhotoId);
    expect(friendItem).toBeDefined();
    expect(friendItem.uploader).not.toBeNull();
    expect(friendItem.uploader.displayName).toBe('BestFriendBob');
    expect(friendItem.uploader.avatarPreset).toBe('wishing-star');
    expect(friendItem.mine).toBe(false);

    // Stranger's photo seen by friend viewer: viewer is not friends with stranger
    const strangerItemAsSeenByFriend = friendBody.items.find((i: any) => i.id === strangerPhotoId);
    expect(strangerItemAsSeenByFriend).toBeDefined();
    expect(strangerItemAsSeenByFriend.uploader).toBeNull();

    // 2. Stranger viewer requests gallery
    const { app: appStrangerViewer } = createTestServer(undefined, strangerId);
    await appStrangerViewer.ready();

    const resStranger = await appStrangerViewer.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(resStranger.statusCode).toBe(200);
    const strangerBody = resStranger.json();

    // The stranger is the uploader of strangerPhotoId -> mine: true
    const ownItem = strangerBody.items.find((i: any) => i.id === strangerPhotoId);
    expect(ownItem).toBeDefined();
    expect(ownItem.mine).toBe(true);
    expect(ownItem.uploader).not.toBeNull();
    expect(ownItem.uploader.displayName).toBe('StrangerSamSentinel');

    // The stranger viewer is not a friend of friendId -> uploader: null
    const nonFriendItem = strangerBody.items.find((i: any) => i.id === friendPhotoId);
    expect(nonFriendItem).toBeDefined();
    expect(nonFriendItem.uploader).toBeNull();

    // Verify raw body string for a third unrelated viewer
    const thirdPartyViewerId = randomUUID();
    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${thirdPartyViewerId}', 'third@example.com', 'hash');
      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${thirdPartyViewerId}', 'ThirdGuest', 'castle');
    `);

    const { app: appThird } = createTestServer(undefined, thirdPartyViewerId);
    await appThird.ready();

    const resThird = await appThird.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(resThird.statusCode).toBe(200);
    const rawThirdText = resThird.body;

    // Must not contain stranger's sentinel profile name or user id
    expect(rawThirdText).not.toContain('StrangerSamSentinel');
    expect(rawThirdText).not.toContain(strangerId);
    expect(rawThirdText).not.toContain('BestFriendBob');
    expect(rawThirdText).not.toContain(friendId);
  });

  it('createdDay is YYYY-MM-DD string and createdAt key is absent from DTO', async () => {
    const photoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved', new Date('2026-10-18T14:30:00Z'));

    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    const item = res.json().items[0];
    expect(item.createdDay).toBe('2026-10-18');
    expect('createdAt' in item).toBe(false);
  });

  it('Property 14 sentinel test: food_item_logs note, rating, and visited_on never appear in response', async () => {
    const photoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved');

    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    const rawBody = res.body;

    // Log values: note 'SUPER_SECRET_FOOD_NOTE_ABC', visited_on '2026-10-14', logId
    expect(rawBody).not.toContain('SUPER_SECRET_FOOD_NOTE_ABC');
    expect(rawBody).not.toContain('2026-10-14');
    expect(rawBody).not.toContain(logId);
  });

  it('a photo deleted by its uploader disappears from the next gallery read (Requirement 1.6)', async () => {
    const photoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved');

    const { app } = createTestServer();
    await app.ready();

    // 1. Initial read: present
    const res1 = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res1.json().items).toHaveLength(1);

    // 2. Soft-delete photo
    await repo.softDeleteByIds([photoId], new Date());

    // 3. Second read: disappeared
    const res2 = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res2.json().items).toHaveLength(0);
  });

  it('responses carry Cache-Control: private, no-store', async () => {
    const photoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved');

    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('with PHOTOS_FOOD_ENABLED=false galleries still serve existing approved photos (Requirement 10.9)', async () => {
    const photoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved');

    const { app } = createTestServer({ foodEnabled: false });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().items[0].id).toBe(photoId);
  });

  it('GET /experiences/:id/food-photos and GET /locations/:id/food-photos return RestaurantFoodPhotoDTO with foodItemName', async () => {
    const photoId = randomUUID();
    const locPhotoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved');

    // Find the location food item
    const locItems = db.public.many("SELECT id FROM food_items WHERE location_id IS NOT NULL;");
    const locItemId = locItems[0].id;
    await insertPhoto(locPhotoId, friendId, 'approved', new Date('2026-10-18T12:00:00Z'), locItemId);

    const { app } = createTestServer();
    await app.ready();

    // 1. Experience gallery
    const expRes = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(expRes.statusCode).toBe(200);
    const expBody = expRes.json();
    expect(expBody.items).toHaveLength(1);
    expect(expBody.items[0].id).toBe(photoId);
    expect(expBody.items[0].foodItemName).toBe('Grey Stuff Gateau');
    expect(expRes.headers['cache-control']).toBe('private, no-store');

    // 2. Location gallery
    const locRes = await app.inject({
      method: 'GET',
      url: `/locations/${locationId}/food-photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(locRes.statusCode).toBe(200);
    const locBody = locRes.json();
    expect(locBody.items).toHaveLength(1);
    expect(locBody.items[0].id).toBe(locPhotoId);
    expect(locBody.items[0].foodItemName).toBe('Popcorn Bucket');
    expect(locRes.headers['cache-control']).toBe('private, no-store');

    // 3. Dish gallery does not have foodItemName key
    const dishRes = await app.inject({
      method: 'GET',
      url: `/food-items/${foodItemId}/photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(dishRes.statusCode).toBe(200);
    expect('foodItemName' in dishRes.json().items[0]).toBe(false);
  });

  it('existing public GET /experiences/:id/food-items route remains public', async () => {
    const { app } = createTestServer();
    await app.ready();

    // Notice: NO authorization header
    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-items`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe('Grey Stuff Gateau');
  });

  it('Task 9.6: limit=0, limit=101, limit=x, and unknown query key answer validation_failed', async () => {
    const { app } = createTestServer();
    await app.ready();

    // 1. limit=0 -> 400 validation_failed
    const res0 = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos?limit=0`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res0.statusCode).toBe(400);
    expect(res0.json().error.code).toBe('validation_failed');

    // 2. limit=101 -> 400 validation_failed
    const res101 = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos?limit=101`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res101.statusCode).toBe(400);
    expect(res101.json().error.code).toBe('validation_failed');

    // 3. limit=x -> 400 validation_failed
    const resX = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos?limit=x`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resX.statusCode).toBe(400);
    expect(resX.json().error.code).toBe('validation_failed');

    // 4. unknown query key -> 400 validation_failed
    const resUnknown = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos?unknownKey=foo`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resUnknown.statusCode).toBe(400);
    expect(resUnknown.json().error.code).toBe('validation_failed');
  });

  it('Task 9.6: restaurant gallery limit=2 returns 2 items and nextCursor; cursor continues without repeats', async () => {
    // Insert 3 approved photos for this experience
    const p1 = randomUUID();
    const p2 = randomUUID();
    const p3 = randomUUID();

    await insertPhoto(p1, friendId, 'approved', new Date('2026-10-18T10:00:00Z'));
    await insertPhoto(p2, friendId, 'approved', new Date('2026-10-18T10:05:00Z'));
    await insertPhoto(p3, strangerId, 'approved', new Date('2026-10-18T10:10:00Z'));

    const { app } = createTestServer();
    await app.ready();

    // Page 1 with limit=2
    const page1Res = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos?limit=2`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(page1Res.statusCode).toBe(200);
    const page1Body = page1Res.json();
    expect(page1Body.items).toHaveLength(2);
    expect(page1Body.nextCursor).toBeTruthy();
    expect(page1Body.items[0].id).toBe(p3);
    expect(page1Body.items[1].id).toBe(p2);

    // Page 2 with cursor
    const page2Res = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos?limit=2&cursor=${encodeURIComponent(page1Body.nextCursor)}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(page2Res.statusCode).toBe(200);
    const page2Body = page2Res.json();
    expect(page2Body.items).toHaveLength(1);
    expect(page2Body.items[0].id).toBe(p1);
    expect(page2Body.nextCursor).toBeNull();
  });

  it('Task 9.6: Property 14 sentinel no-leak test repeated against restaurant gallery response', async () => {
    const photoId = randomUUID();
    await insertPhoto(photoId, friendId, 'approved');

    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos`,
      headers: { authorization: 'Bearer session-token' },
    });

    expect(res.statusCode).toBe(200);
    const rawBody = res.body;

    // Log values: note 'SUPER_SECRET_FOOD_NOTE_ABC', visited_on '2026-10-14', logId
    expect(rawBody).not.toContain('SUPER_SECRET_FOOD_NOTE_ABC');
    expect(rawBody).not.toContain('2026-10-14');
    expect(rawBody).not.toContain(logId);
  });

  it('Task 9.6: blocked uploader photo is absent from restaurant gallery and with PHOTOS_FOOD_ENABLED=false existing photos still serve', async () => {
    const blockedPhotoId = randomUUID();
    await insertPhoto(blockedPhotoId, blockedUploaderId, 'approved');

    // 1. Blocked uploader is absent
    const { app } = createTestServer();
    await app.ready();

    const resBlocked = await app.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resBlocked.statusCode).toBe(200);
    const items = resBlocked.json().items;
    expect(items.find((it: { id: string }) => it.id === blockedPhotoId)).toBeUndefined();

    // 2. With PHOTOS_FOOD_ENABLED=false, restaurant gallery still serves existing approved photos
    const goodPhotoId = randomUUID();
    await insertPhoto(goodPhotoId, friendId, 'approved');

    const { app: appDisabled } = createTestServer({ foodEnabled: false });
    await appDisabled.ready();

    const resDisabled = await appDisabled.inject({
      method: 'GET',
      url: `/experiences/${experienceId}/food-photos`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resDisabled.statusCode).toBe(200);
    expect(resDisabled.json().items.find((it: { id: string }) => it.id === goodPhotoId)).toBeDefined();
  });
});
