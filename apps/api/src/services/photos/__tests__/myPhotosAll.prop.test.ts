import fc from 'fast-check';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MyPhotoDTO, PhotoPageDTO } from '@dwt/shared';
import { PHOTO_REJECT_MESSAGES } from '@dwt/shared';
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

const STATUSES = [
  'uploading',
  'pending',
  'approved',
  'rejected',
  'needs_review',
  'hidden',
  'deleted',
] as const;

type Status = (typeof STATUSES)[number];

const TIMESTAMP_POOL = [
  '2026-05-01T10:00:00.000Z',
  '2026-05-01T10:00:01.000Z',
  '2026-05-02T12:30:00.000Z',
  '2026-05-03T08:15:00.000Z',
  '2026-05-03T08:15:01.000Z',
];

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

describe('My Photos API Properties (Properties 46 to 49)', () => {
  let world: RecapAlbumWorld;
  let photosRepo: PhotosRepo;
  let store: FakeObjectStore;
  let clock: FakeClock;
  let photoService: PhotoService;
  let app: FastifyInstance;
  let currentUserId: string | null = null;
  let activeConfig = DEFAULT_CONFIG;

  beforeAll(async () => {
    world = createRecapAlbumWorld();
    photosRepo = createPhotosRepo(world.pool);
    store = new FakeObjectStore();
    clock = new FakeClock(new Date('2026-05-15T12:00:00Z'));
    const tripTarget = new TripTarget({ pool: world.pool });

    photoService = new PhotoService({
      pool: world.pool,
      repo: photosRepo,
      reportsRepo: createReportsRepo(world.pool),
      objectStore: store,
      targetAdapters: [tripTarget],
      clock,
      config: DEFAULT_CONFIG,
    });

    app = Fastify({ logger: false });
    registerErrorHandler(app);

    void app.register(photoRoutes, {
      photoService: {
        get listAllMine() {
          return (userId: string, params: any) => {
            const svc =
              activeConfig === DEFAULT_CONFIG
                ? photoService
                : new PhotoService({
                    pool: world.pool,
                    repo: photosRepo,
                    reportsRepo: createReportsRepo(world.pool),
                    objectStore: store,
                    targetAdapters: [tripTarget],
                    clock,
                    config: activeConfig,
                  });
            return svc.listAllMine(userId, params);
          };
        },
        listMine: (userId: string, params: any) => photoService.listMine(userId, params),
      } as any,
      requireSession: async (req) => {
        if (!currentUserId) {
          throw new AppError('unauthorized', 'Authentication required.');
        }
        req.userId = currentUserId;
      },
      enabled: true,
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Feature: photo-uploads, Property 46: My Photos shows only the caller's own photos
  it('Property 46: My Photos shows only the caller\'s own photos', async () => {
    const rowArb = fc.record({
      id: fc.uuid(),
      ownerChoice: fc.constantFrom<'alice' | 'bob' | 'carol' | 'null'>('alice', 'bob', 'carol', 'null'),
      status: fc.constantFrom<Status>(...STATUSES),
      targetKind: fc.constantFrom<'food_log' | 'trip'>('food_log', 'trip'),
      timeIdx: fc.integer({ min: 0, max: TIMESTAMP_POOL.length - 1 }),
    });

    const scenarioArb = fc.record({
      rows: fc.array(rowArb, { maxLength: 25 }),
      caller: fc.constantFrom<'alice' | 'bob'>('alice', 'bob'),
      limit: fc.integer({ min: 1, max: 20 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ rows, caller, limit }) => {
        world.db.public.none('DELETE FROM photos;');

        const seenIds = new Set<string>();
        const uniqueRows = rows.filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));

        const callerId = caller === 'alice' ? world.aliceId : world.bobId;
        currentUserId = callerId;
        activeConfig = DEFAULT_CONFIG;

        const seededRows: SeedMyPhotoRow[] = uniqueRows.map((r) => {
          let ownerId: string | null = null;
          if (r.ownerChoice === 'alice') ownerId = world.aliceId;
          else if (r.ownerChoice === 'bob') ownerId = world.bobId;
          else if (r.ownerChoice === 'carol') ownerId = world.carolId;

          return {
            id: r.id,
            ownerId,
            targetKind: r.targetKind,
            targetId: r.targetKind === 'trip' ? world.tripId : world.aliceId,
            scopeId: r.targetKind === 'trip' ? world.tripId : world.aliceId,
            status: r.status,
            createdAt: TIMESTAMP_POOL[r.timeIdx]!,
          };
        });

        seedMyPhotos(world.db, seededRows);

        // Page through the route until nextCursor is null
        let cursor: string | null = null;
        const allFetched: MyPhotoDTO[] = [];

        do {
          const qs = cursor ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}` : `?limit=${limit}`;
          const res = await app.inject({
            method: 'GET',
            url: `/me/photos/all${qs}`,
          });

          expect(res.statusCode).toBe(200);
          const page = res.json() as PhotoPageDTO<MyPhotoDTO>;
          allFetched.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor !== null);

        // All returned photos must belong to caller
        const otherUserIds = [world.aliceId, world.bobId, world.carolId].filter((id) => id !== callerId);
        const otherPhotoIds = new Set(
          seededRows
            .filter((r) => r.ownerId !== callerId)
            .map((r) => r.id)
        );

        for (const item of allFetched) {
          expect(otherPhotoIds.has(item.id)).toBe(false);
        }

        // Also verify on real repo query directly
        const repoRows = await photosRepo.listAllMine(callerId, undefined, 100);
        for (const r of repoRows) {
          expect(r.owner_id).toBe(callerId);
          expect(otherUserIds).not.toContain(r.owner_id);
        }

        // Unauthenticated request is 401
        currentUserId = null;
        const unauthRes = await app.inject({ method: 'GET', url: '/me/photos/all' });
        expect(unauthRes.statusCode).toBe(401);
        currentUserId = callerId;

        // Rejected parameters fail validation
        const badParamRes = await app.inject({ method: 'GET', url: `/me/photos/all?userId=${callerId}` });
        expect(badParamRes.statusCode).toBe(400);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 47: My Photos pagination is total and stable
  it('Property 47: My Photos pagination is total and stable', async () => {
    const rowArb = fc.record({
      id: fc.uuid(),
      status: fc.constantFrom<Status>(...STATUSES),
      timeIdx: fc.integer({ min: 0, max: TIMESTAMP_POOL.length - 1 }),
      targetKind: fc.constantFrom<'food_log' | 'trip'>('food_log', 'trip'),
    });

    const scenarioArb = fc.record({
      rows: fc.array(rowArb, { maxLength: 30 }),
      limit: fc.integer({ min: 1, max: 10 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ rows, limit }) => {
        world.db.public.none('DELETE FROM photos;');

        const seenIds = new Set<string>();
        const uniqueRows = rows.filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));

        const callerId = world.aliceId;
        currentUserId = callerId;
        activeConfig = DEFAULT_CONFIG;

        const seededRows: SeedMyPhotoRow[] = uniqueRows.map((r) => ({
          id: r.id,
          ownerId: callerId,
          targetKind: r.targetKind,
          targetId: r.targetKind === 'trip' ? world.tripId : world.aliceId,
          scopeId: r.targetKind === 'trip' ? world.tripId : world.aliceId,
          status: r.status,
          createdAt: TIMESTAMP_POOL[r.timeIdx]!,
        }));

        seedMyPhotos(world.db, seededRows);

        // In-memory oracle: non-deleted photos sorted by (created_at desc, id desc)
        const nonDeleted = seededRows.filter((r) => r.status !== 'deleted');
        const oracle = [...nonDeleted].sort((a, b) => {
          const tA = new Date(a.createdAt).getTime();
          const tB = new Date(b.createdAt).getTime();
          if (tA !== tB) return tB - tA;
          return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
        });

        let cursor: string | null = null;
        const allFetched: MyPhotoDTO[] = [];
        let pageCount = 0;

        do {
          const qs = cursor ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}` : `?limit=${limit}`;
          const res = await app.inject({
            method: 'GET',
            url: `/me/photos/all${qs}`,
          });

          expect(res.statusCode).toBe(200);
          const page = res.json() as PhotoPageDTO<MyPhotoDTO>;
          pageCount++;

          if (page.nextCursor !== null) {
            expect(page.items).toHaveLength(limit);
          } else {
            expect(page.items.length).toBeLessThanOrEqual(limit);
          }

          allFetched.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor !== null);

        // Must match oracle exactly
        expect(allFetched.map((p) => p.id)).toEqual(oracle.map((p) => p.id));
        expect(new Set(allFetched.map((p) => p.id)).size).toBe(allFetched.length);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 48: My Photos responses never contain object keys or other users' data, and URLs follow the owner key rule
  it('Property 48: My Photos responses never contain object keys or other users\' data, and URLs follow the owner key rule', async () => {
    const rowArb = fc.record({
      id: fc.uuid(),
      owner: fc.constantFrom<'alice' | 'bob'>('alice', 'bob'),
      status: fc.constantFrom<Status>(...STATUSES),
      timeIdx: fc.integer({ min: 0, max: TIMESTAMP_POOL.length - 1 }),
    });

    const scenarioArb = fc.record({
      rows: fc.array(rowArb, { maxLength: 20 }),
      limit: fc.integer({ min: 1, max: 50 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ rows, limit }) => {
        world.db.public.none('DELETE FROM photos;');
        store.objects.clear();
        store.presignedGets.length = 0;

        const seenIds = new Set<string>();
        const uniqueRows = rows.filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));

        const callerId = world.aliceId;
        currentUserId = callerId;
        activeConfig = DEFAULT_CONFIG;

        const seededRows: SeedMyPhotoRow[] = uniqueRows.map((r) => ({
          id: r.id,
          ownerId: r.owner === 'alice' ? world.aliceId : world.bobId,
          targetKind: 'trip',
          targetId: world.tripId,
          scopeId: world.tripId,
          status: r.status,
          createdAt: TIMESTAMP_POOL[r.timeIdx]!,
        }));

        seedMyPhotos(world.db, seededRows);

        // Seed store with ONLY expected owner keys for Alice's photos
        for (const r of seededRows) {
          if (r.ownerId !== callerId) continue;
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

        const res = await app.inject({
          method: 'GET',
          url: `/me/photos/all?limit=${limit}`,
        });

        expect(res.statusCode).toBe(200);
        const rawText = res.body;

        expect(rawText).not.toContain('object_key');
        expect(rawText).not.toContain('thumb_key');
        expect(rawText).not.toContain('objectKey');
        expect(rawText).not.toContain('thumbKey');
        expect(rawText).not.toContain('owner_id');
        expect(rawText).not.toContain('ownerId');

        const page = res.json() as PhotoPageDTO<MyPhotoDTO>;
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

        for (const item of page.items) {
          expect(Object.keys(item).sort()).toEqual(expectedKeys);

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
          }
        }

        expect(store.missingGetKeys()).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 49: My Photos visibility is exactly the owner's non-deleted set, regardless of blocks, membership, or kind switches
  it('Property 49: My Photos visibility is exactly the owner\'s non-deleted set, regardless of blocks, membership, or kind switches', async () => {
    const rowArb = fc.record({
      id: fc.uuid(),
      status: fc.constantFrom<Status>(...STATUSES),
      targetKind: fc.constantFrom<'food_log' | 'trip'>('food_log', 'trip'),
      timeIdx: fc.integer({ min: 0, max: TIMESTAMP_POOL.length - 1 }),
    });

    const scenarioArb = fc.record({
      rows: fc.array(rowArb, { maxLength: 20 }),
      callerBlocksBob: fc.boolean(),
      bobBlocksCaller: fc.boolean(),
      leftTrip: fc.boolean(),
      foodEnabled: fc.boolean(),
      tripEnabled: fc.boolean(),
    });

    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        async ({ rows, callerBlocksBob, bobBlocksCaller, leftTrip, foodEnabled, tripEnabled }) => {
          world.db.public.none('DELETE FROM photos;');
          world.db.public.none('DELETE FROM user_blocks;');

          const seenIds = new Set<string>();
          const uniqueRows = rows.filter((r) => (seenIds.has(r.id) ? false : (seenIds.add(r.id), true)));

          const callerId = world.aliceId;
          currentUserId = callerId;
          activeConfig = {
            ...DEFAULT_CONFIG,
            foodEnabled,
            tripEnabled,
          };

          const seededRows: SeedMyPhotoRow[] = uniqueRows.map((r) => ({
            id: r.id,
            ownerId: callerId,
            targetKind: r.targetKind,
            targetId: r.targetKind === 'trip' ? world.tripId : world.aliceId,
            scopeId: r.targetKind === 'trip' ? world.tripId : world.aliceId,
            status: r.status,
            createdAt: TIMESTAMP_POOL[r.timeIdx]!,
          }));

          seedMyPhotos(world.db, seededRows);

          if (callerBlocksBob) {
            world.db.public.none(`
              INSERT INTO user_blocks (blocker_id, blocked_id)
              VALUES ('${callerId}', '${world.bobId}')
              ON CONFLICT DO NOTHING;
            `);
          }
          if (bobBlocksCaller) {
            world.db.public.none(`
              INSERT INTO user_blocks (blocker_id, blocked_id)
              VALUES ('${world.bobId}', '${callerId}')
              ON CONFLICT DO NOTHING;
            `);
          }
          if (leftTrip) {
            world.db.public.none(`
              DELETE FROM trip_memberships WHERE user_id = '${callerId}';
            `);
          }

          let cursor: string | null = null;
          const allFetched: MyPhotoDTO[] = [];

          do {
            const qs = cursor ? `?limit=50&cursor=${encodeURIComponent(cursor)}` : '?limit=50';
            const res = await app.inject({
              method: 'GET',
              url: `/me/photos/all${qs}`,
            });

            expect(res.statusCode).toBe(200);
            const page = res.json() as PhotoPageDTO<MyPhotoDTO>;
            allFetched.push(...page.items);
            cursor = page.nextCursor;
          } while (cursor !== null);

          // The returned IDs must be exactly caller's non-deleted photos
          const expectedNonDeleted = seededRows.filter((r) => r.status !== 'deleted');
          expect(new Set(allFetched.map((p) => p.id))).toEqual(
            new Set(expectedNonDeleted.map((p) => p.id))
          );

          for (const item of allFetched) {
            const original = seededRows.find((r) => r.id === item.id)!;
            expect(item.status).toBe(original.status);
            if (item.status === 'rejected') {
              expect(item.rejectReason).toBe('harm');
              expect(item.rejectMessage).toBe(PHOTO_REJECT_MESSAGES.harm);
            }
          }

          // Test deleteAllForUser purge
          await photoService.deleteAllForUser(callerId);
          const purgedRes = await app.inject({
            method: 'GET',
            url: '/me/photos/all',
          });
          expect(purgedRes.statusCode).toBe(200);
          const purgedPage = purgedRes.json() as PhotoPageDTO<MyPhotoDTO>;
          expect(purgedPage.items).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
