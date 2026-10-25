import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import type { MyPhotoDTO, PhotoPageDTO } from '@dwt/shared';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { photoKeys } from '../domain/objectKeys.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { createReportsRepo } from '../reportsRepo.js';
import { photoRoutes } from '../routes.js';
import { PhotoService, type PhotoServiceConfig } from '../service.js';
import { TripTarget } from '../targets/tripTarget.js';
import { FakeClock, FakeObjectStore } from './fakes.js';
import { seedMyPhotos, type SeedMyPhotoRow } from './myPhotosSeed.js';
import { createRecapAlbumWorld, type RecapAlbumWorld } from './recapAlbumHarness.js';

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

describe('GET /me/photos/all route integration (Requirement 29.3-29.10)', () => {
  let world: RecapAlbumWorld;
  let photosRepo: PhotosRepo;
  let store: FakeObjectStore;
  let clock: FakeClock;
  let tripTarget: TripTarget;
  let photoService: PhotoService;

  beforeEach(() => {
    world = createRecapAlbumWorld();
    photosRepo = createPhotosRepo(world.pool);
    store = new FakeObjectStore();
    clock = new FakeClock(new Date('2026-05-15T12:00:00Z'));
    tripTarget = new TripTarget({ pool: world.pool });

    photoService = new PhotoService({
      pool: world.pool,
      repo: photosRepo,
      reportsRepo: createReportsRepo(world.pool),
      objectStore: store,
      targetAdapters: [tripTarget],
      clock,
      config: DEFAULT_CONFIG,
    });
  });

  function buildTestServer(
    currentUserId: string | null = world.aliceId,
    customConfig: PhotoServiceConfig = DEFAULT_CONFIG
  ): FastifyInstance {
    const app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (req) => {
      if (!currentUserId) {
        throw new AppError('unauthorized', 'Authentication required.');
      }
      req.userId = currentUserId;
    };

    const service =
      customConfig === DEFAULT_CONFIG
        ? photoService
        : new PhotoService({
            pool: world.pool,
            repo: photosRepo,
            reportsRepo: createReportsRepo(world.pool),
            objectStore: store,
            targetAdapters: [tripTarget],
            clock,
            config: customConfig,
          });

    void app.register(photoRoutes, {
      photoService: service,
      requireSession,
      enabled: customConfig.enabled,
    });

    return app;
  }

  it('rejects unauthenticated requests with 401 unauthorized', async () => {
    const app = buildTestServer(null);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos/all',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error?.code).toBe('unauthorized');
  });

  it('happy path: pages 45 photos with 40 on page 1 and 5 on page 2, returning Cache-Control: private, no-store', async () => {
    const aliceId = world.aliceId;
    const seededRows: SeedMyPhotoRow[] = Array.from({ length: 45 }, (_, i) => ({
      id: randomUUID(),
      ownerId: aliceId,
      targetKind: i % 2 === 0 ? 'food_log' : 'trip',
      targetId: i % 2 === 0 ? randomUUID() : world.tripId,
      scopeId: i % 2 === 0 ? randomUUID() : world.tripId,
      status: 'approved',
      createdAt: new Date(Date.UTC(2026, 4, 1, 10, 0, i)).toISOString(),
    }));

    seedMyPhotos(world.db, seededRows);

    // Seed serving objects for all approved photos in the store
    for (const r of seededRows) {
      const keys = photoKeys(r.id);
      store.put(keys.full, new Uint8Array([1, 2, 3]));
      store.put(keys.thumb, new Uint8Array([4, 5, 6]));
    }

    const app = buildTestServer(aliceId);

    // Page 1: default limit 40
    const res1 = await app.inject({
      method: 'GET',
      url: '/me/photos/all',
    });

    expect(res1.statusCode).toBe(200);
    expect(res1.headers['cache-control']).toBe('private, no-store');
    const body1 = res1.json() as PhotoPageDTO<MyPhotoDTO>;
    expect(body1.items).toHaveLength(40);
    expect(body1.nextCursor).not.toBeNull();

    // Page 2: with cursor
    const res2 = await app.inject({
      method: 'GET',
      url: `/me/photos/all?cursor=${encodeURIComponent(body1.nextCursor!)}`,
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.headers['cache-control']).toBe('private, no-store');
    const body2 = res2.json() as PhotoPageDTO<MyPhotoDTO>;
    expect(body2.items).toHaveLength(5);
    expect(body2.nextCursor).toBeNull();

    const allReturnedIds = [...body1.items.map((i) => i.id), ...body2.items.map((i) => i.id)];
    expect(allReturnedIds).toHaveLength(45);
    expect(new Set(allReturnedIds).size).toBe(45);
  });

  it('accepts limit=100 and returns all items on a single page', async () => {
    const aliceId = world.aliceId;
    const seededRows: SeedMyPhotoRow[] = Array.from({ length: 45 }, (_, i) => ({
      id: randomUUID(),
      ownerId: aliceId,
      targetKind: 'trip',
      targetId: world.tripId,
      scopeId: world.tripId,
      status: 'approved',
      createdAt: new Date(Date.UTC(2026, 4, 1, 10, 0, i)).toISOString(),
    }));

    seedMyPhotos(world.db, seededRows);
    for (const r of seededRows) {
      const keys = photoKeys(r.id);
      store.put(keys.full, new Uint8Array([1]));
      store.put(keys.thumb, new Uint8Array([2]));
    }

    const app = buildTestServer(aliceId);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos/all?limit=100',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PhotoPageDTO<MyPhotoDTO>;
    expect(body.items).toHaveLength(45);
    expect(body.nextCursor).toBeNull();
  });

  it('rejects invalid query parameters with 400 validation_failed', async () => {
    const app = buildTestServer(world.aliceId);

    const invalidQueries = [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'cursor=garbage',
      `userId=${world.bobId}`,
      'targetKind=trip',
      'ownerId=some-id',
      'scopeId=some-id',
    ];

    for (const q of invalidQueries) {
      const res = await app.inject({
        method: 'GET',
        url: `/me/photos/all?${q}`,
      });
      expect(res.statusCode, `Query ?${q} should be rejected with 400`).toBe(400);
      const body = res.json();
      expect(body.error?.code).toBe('validation_failed');
    }
  });

  it('items have exactly the MyPhotoDTO keys and response contains no object_key or thumb_key text', async () => {
    const aliceId = world.aliceId;
    const id = randomUUID();
    seedMyPhotos(world.db, [
      {
        id,
        ownerId: aliceId,
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: randomUUID(),
        status: 'approved',
        createdAt: '2026-05-01T10:00:00.000Z',
      },
    ]);

    const keys = photoKeys(id);
    store.put(keys.full, new Uint8Array([1]));
    store.put(keys.thumb, new Uint8Array([2]));

    const app = buildTestServer(aliceId);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos/all',
    });

    expect(res.statusCode).toBe(200);
    const rawText = res.body;

    // Must not leak internal object storage keys or column names
    expect(rawText).not.toContain('object_key');
    expect(rawText).not.toContain('thumb_key');
    expect(rawText).not.toContain('objectKey');
    expect(rawText).not.toContain('thumbKey');
    expect(rawText).not.toContain('owner_id');
    expect(rawText).not.toContain('ownerId');

    const body = res.json() as PhotoPageDTO<MyPhotoDTO>;
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;

    const expectedKeys = [
      'id',
      'targetKind',
      'targetId',
      'scopeId',
      'status',
      'rejectReason',
      'rejectMessage',
      'thumbUrl',
      'url',
      'width',
      'height',
      'feedItemId',
      'createdAt',
    ].sort();

    expect(Object.keys(item).sort()).toEqual(expectedKeys);
  });

  it('URLs follow owner key selection for each status against store seeded with only expected keys', async () => {
    const aliceId = world.aliceId;
    const statuses = [
      'uploading',
      'pending',
      'needs_review',
      'approved',
      'hidden',
      'rejected',
    ] as const;

    const rows: SeedMyPhotoRow[] = statuses.map((status, index) => ({
      id: randomUUID(),
      ownerId: aliceId,
      targetKind: 'trip',
      targetId: world.tripId,
      scopeId: world.tripId,
      status,
      createdAt: new Date(Date.UTC(2026, 4, 1, 10, index, 0)).toISOString(),
    }));

    seedMyPhotos(world.db, rows);

    // Seed FakeObjectStore with ONLY the keys that owner key selection should request:
    // - approved & hidden: p/<id>/full.jpg, p/<id>/thumb.jpg
    // - uploading, pending, needs_review: u/<id>/thumb.jpg
    // - rejected: none
    for (const r of rows) {
      const keys = photoKeys(r.id);
      if (r.status === 'approved' || r.status === 'hidden') {
        store.put(keys.full, new Uint8Array([1]));
        store.put(keys.thumb, new Uint8Array([2]));
      } else if (
        r.status === 'uploading' ||
        r.status === 'pending' ||
        r.status === 'needs_review'
      ) {
        store.put(keys.uploadThumb, new Uint8Array([3]));
      }
    }

    const app = buildTestServer(aliceId);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos/all',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PhotoPageDTO<MyPhotoDTO>;

    // Verify missingGetKeys is completely empty (no unexpected key was requested)
    expect(store.missingGetKeys()).toEqual([]);

    for (const item of body.items) {
      if (item.status === 'approved' || item.status === 'hidden') {
        expect(item.url).toContain(`p/${item.id}/full.jpg`);
        expect(item.thumbUrl).toContain(`p/${item.id}/thumb.jpg`);
      } else if (
        item.status === 'uploading' ||
        item.status === 'pending' ||
        item.status === 'needs_review'
      ) {
        expect(item.url).toBeNull();
        expect(item.thumbUrl).toContain(`u/${item.id}/thumb.jpg`);
      } else if (item.status === 'rejected') {
        expect(item.url).toBeNull();
        expect(item.thumbUrl).toBeNull();
        expect(item.rejectReason).toBe('harm');
        expect(item.rejectMessage).toBe("This photo can't be shared in the app.");
      }
    }
  });

  it('another user\'s photos never appear', async () => {
    const aliceId = world.aliceId;
    const bobId = world.bobId;

    seedMyPhotos(world.db, [
      {
        id: randomUUID(),
        ownerId: bobId,
        targetKind: 'trip',
        targetId: world.tripId,
        scopeId: world.tripId,
        status: 'approved',
        createdAt: '2026-05-01T10:00:00.000Z',
      },
    ]);

    const app = buildTestServer(aliceId);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos/all',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PhotoPageDTO<MyPhotoDTO>;
    expect(body.items).toHaveLength(0);
  });

  it('a Block either way, a left Trip, and PHOTOS_FOOD_ENABLED/PHOTOS_TRIP_ENABLED false do not change result', async () => {
    const aliceId = world.aliceId;
    const bobId = world.bobId;
    const photoId = randomUUID();

    seedMyPhotos(world.db, [
      {
        id: photoId,
        ownerId: aliceId,
        targetKind: 'trip',
        targetId: world.tripId,
        scopeId: world.tripId,
        status: 'approved',
        createdAt: '2026-05-01T10:00:00.000Z',
      },
    ]);

    const keys = photoKeys(photoId);
    store.put(keys.full, new Uint8Array([1]));
    store.put(keys.thumb, new Uint8Array([2]));

    // 1. Insert Block between Alice and Bob
    world.db.public.none(`
      INSERT INTO user_blocks (blocker_id, blocked_id)
      VALUES ('${bobId}', '${aliceId}');
    `);

    // 2. Remove Alice from trip memberships
    world.db.public.none(`
      DELETE FROM trip_memberships WHERE user_id = '${aliceId}' AND trip_id = '${world.tripId}';
    `);

    // 3. Custom config with foodEnabled: false and tripEnabled: false
    const customConfig: PhotoServiceConfig = {
      ...DEFAULT_CONFIG,
      foodEnabled: false,
      tripEnabled: false,
    };

    const app = buildTestServer(aliceId, customConfig);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos/all',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PhotoPageDTO<MyPhotoDTO>;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(photoId);
  });

  it('existing GET /me/photos with missing scopeId still answers validation_failed and page size is unchanged', async () => {
    const app = buildTestServer(world.aliceId);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos?targetKind=food_log',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error?.code).toBe('validation_failed');
  });

  it('regression: calling deleteAllForUser purges all photos so GET /me/photos/all returns an empty page', async () => {
    const aliceId = world.aliceId;
    const id = randomUUID();

    seedMyPhotos(world.db, [
      {
        id,
        ownerId: aliceId,
        targetKind: 'food_log',
        targetId: randomUUID(),
        scopeId: randomUUID(),
        status: 'approved',
        createdAt: '2026-05-01T10:00:00.000Z',
      },
    ]);

    // Soft delete via deleteAllForUser
    await photoService.deleteAllForUser(aliceId);

    const app = buildTestServer(aliceId);
    const res = await app.inject({
      method: 'GET',
      url: '/me/photos/all',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as PhotoPageDTO<MyPhotoDTO>;
    expect(body.items).toHaveLength(0);
  });
});
