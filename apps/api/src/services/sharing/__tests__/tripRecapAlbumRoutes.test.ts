/**
 * Route integration tests (server.inject + pg-mem) for the recipient photo album
 * GET /me/inbox/:shareId/trip-recap/photos and the widened report/block through a shareId.
 *
 * Implements: Task 21.6
 * Validates: Requirements 15.25, 15.26, 15.27, 15.28, 15.29, 15.30, 16.8, 16.9, 16.10, 17.1,
 *            Property 44, decisions D31, D32, D35
 */

import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../../config.js';
import { registerErrorHandler } from '../../../errors/index.js';
import { createLogger, loggerOptions } from '../../../logger.js';
import { buildServer } from '../../../server.js';
import type { TripRecapDTO, TripRecapPhotosDTO } from '@dwt/shared';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { FakeObjectStore } from '../../photos/__tests__/fakes.js';
import {
  SENTINEL_CAPTION,
  SENTINEL_UPLOADER_ALICE,
  SENTINEL_UPLOADER_BOB,
  createCountingTripShareFacts,
  createRecapAlbumWorld,
  insertFeedPost,
  insertPhotos,
  storeWithServingObjects,
  type RecapAlbumWorld,
  type SeedPhoto,
} from '../../photos/__tests__/recapAlbumHarness.js';
import { photoKeys } from '../../photos/domain/objectKeys.js';
import { photoRoutes } from '../../photos/routes.js';
import { createPhotosRepo } from '../../photos/repo.js';
import { DefaultRecapPhotoPort } from '../../photos/recapPhotoPort.js';
import { createReportsRepo } from '../../photos/reportsRepo.js';
import { PhotoService } from '../../photos/service.js';
import { TripTarget } from '../../photos/targets/tripTarget.js';
import type { RecapPhotoPort, TripShareFacts } from '../ports.js';
import { DefaultRecapShareGate } from '../tripRecapGate.js';
import { registerTripRecapRoutes } from '../tripRecapRoutes.js';

const ALBUM_KEYS = ['access', 'nextCursor', 'photos'];
const ITEM_KEYS = ['height', 'id', 'sortAt', 'thumbUrl', 'url', 'width'];

// Fixed ids so ordering assertions are deterministic. Versions/variants satisfy the cursor UUID check.
const ID_1 = '00000000-0000-4000-8000-000000000001';
const ID_2 = '00000000-0000-4000-8000-000000000002';
const ID_3 = '00000000-0000-4000-8000-000000000003';

interface Harness {
  readonly app: FastifyInstance;
  readonly store: FakeObjectStore;
  readonly counters: ReturnType<typeof createCountingTripShareFacts>['counters'];
  readonly albumPageCalls: { count: number };
  setUser(userId: string | undefined): void;
}

/** Builds a Fastify app with the recap routes; `port` selects real, absent or caller-supplied. */
async function buildRecapApp(
  world: RecapAlbumWorld,
  options: {
    store?: FakeObjectStore;
    port?: 'real' | 'none';
    facts?: TripShareFacts;
    logger?: unknown;
    userId?: string | undefined;
  } = {},
): Promise<Harness> {
  const app = Fastify({ logger: (options.logger ?? false) as any }) as unknown as FastifyInstance;
  registerErrorHandler(app);

  const store = options.store ?? new FakeObjectStore();
  const { facts: countingFacts, counters } = createCountingTripShareFacts(world.pool);
  const facts = options.facts ?? countingFacts;
  const gate = new DefaultRecapShareGate({ pool: world.pool, tripShareFacts: facts });

  const albumPageCalls = { count: 0 };
  let port: RecapPhotoPort | undefined;
  if ((options.port ?? 'real') === 'real') {
    const real = new DefaultRecapPhotoPort({ pool: world.pool, store, urlTtlSeconds: 3600 });
    port = {
      highlights: (a, r) => real.highlights(a, r),
      isHighlight: (a, r, p) => real.isHighlight(a, r, p),
      albumPage: (a, r, params) => {
        albumPageCalls.count++;
        return real.albumPage(a, r, params);
      },
      isAlbumPhoto: (a, r, p) => real.isAlbumPhoto(a, r, p),
    };
  }

  let currentUser: string | undefined = 'userId' in options ? options.userId : world.recipientId;
  registerTripRecapRoutes(app, {
    requireSession: async (req) => {
      (req as any).user = currentUser ? { id: currentUser } : undefined;
    },
    recapShareGate: gate,
    tripShareFacts: facts,
    recapPhotoPort: port,
  });
  await app.ready();

  return {
    app,
    store,
    counters,
    albumPageCalls,
    setUser(userId) {
      currentUser = userId;
    },
  };
}

async function getAlbum(
  app: FastifyInstance,
  shareId: string,
  query = '',
): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
  const res = await app.inject({ method: 'GET', url: `/me/inbox/${shareId}/trip-recap/photos${query}` });
  return { status: res.statusCode, body: res.json(), headers: res.headers };
}

function approved(
  world: RecapAlbumWorld,
  id: string,
  sortAt: string,
  extra: Partial<SeedPhoto> = {},
): SeedPhoto {
  return { id, ownerId: world.senderId, tripId: world.tripId, status: 'approved', sortAt, ...extra };
}

function reportCount(world: RecapAlbumWorld): number {
  return Number((world.db.public.one('SELECT count(*) AS n FROM photo_reports') as { n: number }).n);
}

function blockCount(world: RecapAlbumWorld): number {
  return Number((world.db.public.one('SELECT count(*) AS n FROM user_blocks') as { n: number }).n);
}

describe('GET /me/inbox/:shareId/trip-recap/photos (recipient album, D35)', () => {
  let world: RecapAlbumWorld;

  beforeEach(() => {
    world = createRecapAlbumWorld();
  });

  // -----------------------------------------------------------------------
  // Row 1: route exists and needs a session (R15.25)
  // -----------------------------------------------------------------------
  it('answers 401 without a session (and the route exists)', async () => {
    const h = await buildRecapApp(world, { userId: undefined });
    const res = await getAlbum(h.app, world.shareId);
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe('unauthorized');
  });

  // -----------------------------------------------------------------------
  // Row 2: collapsed gate, read order (R15.26)
  // -----------------------------------------------------------------------
  describe('gate: collapsed validation_failed with no Trip or photo read after a failed check', () => {
    function expectNoReads(h: Harness): void {
      expect(h.counters.isMember).toBe(0);
      expect(h.counters.tripName).toBe(0);
      expect(h.counters.summary).toBe(0);
      expect(h.counters.roleOf).toBe(0);
      expect(h.albumPageCalls.count).toBe(0);
      expect(h.store.presignedGets).toEqual([]);
    }

    it('a non-recipient gets 400 validation_failed', async () => {
      const h = await buildRecapApp(world, { userId: world.strangerId });
      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
      expectNoReads(h);
    });

    it('an unknown share id gets 400 validation_failed', async () => {
      const h = await buildRecapApp(world);
      const res = await getAlbum(h.app, randomUUID());
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
      expectNoReads(h);
    });

    it('a recipient who deleted the share gets 400 validation_failed', async () => {
      world.db.public.none(
        `UPDATE share_recipients SET recipient_deleted_at = now() WHERE share_id = '${world.shareId}'`,
      );
      const h = await buildRecapApp(world);
      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
      expectNoReads(h);
    });

    it('after the Friendship ends the same recipient gets 400 and nothing is read', async () => {
      insertPhotos(world.db, [approved(world, ID_1, '2026-10-20T10:00:00.000Z')]);
      const h = await buildRecapApp(world, { store: storeWithServingObjects([ID_1]) });

      const ok = await getAlbum(h.app, world.shareId);
      expect(ok.status).toBe(200);
      expect(ok.body.photos).toHaveLength(1);

      world.db.public.none('DELETE FROM friendships');
      const mintedBefore = h.store.presignedGets.length;
      h.counters.isMember = 0;
      h.counters.tripName = 0;
      h.counters.summary = 0;
      h.counters.roleOf = 0;
      h.albumPageCalls.count = 0;

      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
      expect(h.counters).toEqual({ isMember: 0, tripName: 0, summary: 0, roleOf: 0 });
      expect(h.albumPageCalls.count).toBe(0);
      expect(h.store.presignedGets.length).toBe(mintedBefore);
    });

    it('a recipient who is a Friend of a DIFFERENT user than shares.sender_id gets 400', async () => {
      world.db.public.none('DELETE FROM friendships');
      const other = canonicalPair(world.recipientId, world.strangerId);
      world.db.public.none(
        `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ('${other.lo}', '${other.hi}')`,
      );
      const h = await buildRecapApp(world);
      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
      expectNoReads(h);
    });
  });

  // -----------------------------------------------------------------------
  // Rows 3 and 4: unavailable / not_included (R15.26)
  // -----------------------------------------------------------------------
  describe('availability', () => {
    it('the sharer left the Trip -> 200 unavailable, empty, nextCursor null, no URL, port not called', async () => {
      insertPhotos(world.db, [approved(world, ID_1, '2026-10-20T10:00:00.000Z')]);
      world.db.public.none(
        `DELETE FROM trip_memberships WHERE trip_id = '${world.tripId}' AND user_id = '${world.senderId}'`,
      );
      const h = await buildRecapApp(world, { store: storeWithServingObjects([ID_1]) });
      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ access: 'unavailable', photos: [], nextCursor: null });
      expect(h.store.presignedGets).toEqual([]);
      expect(h.albumPageCalls.count).toBe(0);
    });

    it('the Trip no longer exists -> 200 unavailable, empty, no URL, port not called', async () => {
      insertPhotos(world.db, [approved(world, ID_1, '2026-10-20T10:00:00.000Z')]);
      world.db.public.none(`DELETE FROM trips WHERE id = '${world.tripId}'`);
      const h = await buildRecapApp(world, { store: storeWithServingObjects([ID_1]) });
      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ access: 'unavailable', photos: [], nextCursor: null });
      expect(h.store.presignedGets).toEqual([]);
      expect(h.albumPageCalls.count).toBe(0);
    });

    it('includePhotos=false -> 200 not_included, empty; with the sharer also gone unavailable wins', async () => {
      const noPhotos = createRecapAlbumWorld({ includePhotos: false });
      insertPhotos(noPhotos.db, [approved(noPhotos, ID_1, '2026-10-20T10:00:00.000Z')]);
      const h = await buildRecapApp(noPhotos, { store: storeWithServingObjects([ID_1]) });
      const res = await getAlbum(h.app, noPhotos.shareId);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ access: 'not_included', photos: [], nextCursor: null });
      expect(h.store.presignedGets).toEqual([]);
      expect(h.albumPageCalls.count).toBe(0);

      noPhotos.db.public.none(
        `DELETE FROM trip_memberships WHERE trip_id = '${noPhotos.tripId}' AND user_id = '${noPhotos.senderId}'`,
      );
      const res2 = await getAlbum(h.app, noPhotos.shareId);
      expect(res2.status).toBe(200);
      expect(res2.body.access).toBe('unavailable');
    });
  });

  // -----------------------------------------------------------------------
  // Row 5: kill switch (R15.30)
  // -----------------------------------------------------------------------
  it('with no RecapPhotoPort (PHOTOS_ENABLED=false) the route stays registered: 200 unavailable, no URL, never 404; the recap still returns figures', async () => {
    insertPhotos(world.db, [approved(world, ID_1, '2026-10-20T10:00:00.000Z')]);
    const store = storeWithServingObjects([ID_1]);
    const h = await buildRecapApp(world, { port: 'none', store });

    const album = await getAlbum(h.app, world.shareId);
    expect(album.status).toBe(200);
    expect(album.body).toEqual({ access: 'unavailable', photos: [], nextCursor: null });
    expect(store.presignedGets).toEqual([]);

    const recap = await h.app.inject({ method: 'GET', url: `/me/inbox/${world.shareId}/trip-recap` });
    expect(recap.statusCode).toBe(200);
    const recapBody = recap.json() as TripRecapDTO;
    expect(recapBody.recap).not.toBeNull();
    expect(recapBody.recap?.distinctExperienceCount).toBe(15);
    expect(recapBody.photos.access).toBe('unavailable');
  });

  describe('production registration (buildServer): photos enabled and disabled', () => {
    function makeConfig(enabled: boolean): AppConfig {
      return {
        env: 'test',
        server: { host: '127.0.0.1', port: 0, logLevel: 'silent' },
        database: { url: 'postgres://test/dwt' },
        redis: { url: 'redis://test:6379' },
        session: { secret: 'test-session-secret-must-be-at-least-32-chars' },
        intelligence: { samplingCronSecret: 'test-sampling-secret', crowdSeedDir: 'seed-data/crowd/' },
        pins: { reconcileCronSecret: 'test-pin-reconcile-secret' },
        themeparks: { baseUrl: 'https://themeparks.invalid/v1' },
        disney: {
          syncGateway: { baseUrl: 'https://disney.invalid' },
          diningMenuBaseUrl: 'https://disney.invalid/menu',
          menuFreshnessMs: 86400000,
          syncIntervalMs: 86400000,
          credentials: { username: 'u', password: 'p' },
          requestBudget: { maxRequestsPerSecond: 5, maxConcurrency: 4 },
          backoff: { baseDelayMs: 500, factor: 2, maxRetries: 5, maxDelayMs: 5000, maxTotalDelayMs: 30000 },
        },
        tripBooking: {
          cronSecret: 'test-trip-booking-cron-secret-12345',
          reminder: {
            leads: ['eve', 'open'],
            catchupMinutes: 180,
            minPassIntervalSeconds: 300,
            sendStartMinutes: 360,
            sendEndMinutes: 1380,
            retentionDays: 30,
          },
        },
        admin: { username: 'admin', password: 'password' },
        photos: {
          enabled,
          foodEnabled: true,
          tripEnabled: true,
          cronSecret: 'test-photos-cron-secret',
          recapHighlightMax: 6,
          experienceStripMax: 8,
          store: {
            endpoint: 'https://test.r2.cloudflarestorage.com',
            bucket: 'test-bucket',
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key',
            region: 'auto',
          },
          harm: {
            apiKey: 'test-harm-key',
            baseUrl: 'https://api.openai.com',
            model: 'omni-moderation-latest',
            timeoutMs: 15000,
            invalidImageCodes: [],
            badRequestAlertCount: 5,
            scoreThreshold: 0.5,
            checkThumb: true,
          },
          vision: {
            apiKey: 'test-vision-key',
            baseUrl: 'https://generativelanguage.googleapis.com',
            model: 'gemini-3.5-flash-lite',
            fallbackModel: 'gemini-3.1-flash-lite',
            timeoutMs: 20000,
            minFoodConfidence: 0.6,
            maxProminentFaces: 0,
            maxTextFraction: 0.25,
          },
          limits: {
            dailyUploadCap: 20,
            globalDailyCap: 2000,
            maxPerFoodLog: 4,
            maxPerTrip: 300,
            maxFeedPostPhotos: 4,
            maxBatch: 10,
            maxBytes: 1048576,
            maxThumbBytes: 65536,
          },
          urls: { putTtlSeconds: 900, getTtlSeconds: 3600, adminTtlSeconds: 300 },
          moderation: {
            uploadExpiryMinutes: 120,
            maxAttempts: 6,
            leaseSeconds: 180,
            needsReviewMaxAgeHours: 120,
            uploadPrefixExpiryDays: 7,
            concurrency: 3,
            rejectedRetentionHours: 24,
          },
          reports: { autohideFood: 3, autohideTrip: 1 },
          sweep: { batch: 200, timeBudgetMs: 25000, visionFieldsRetentionDays: 30 },
          exif: { policy: 'log', scanBytes: 65536 },
        },
      };
    }

    const dummySharingRepo = {
      async createShareAtomic() { throw new Error('noop'); },
      async listInbox() { return { items: [], nextCursor: null, unread: 0 }; },
      async countUnreadInbox() { return 0; },
      async markAllInboxRead() { return 0; },
      async openShare() { return null; },
      async softDeleteForRecipient() { return false; },
      async listSentShares() { return []; },
    };

    it('PHOTOS_ENABLED=true answers 200 granted with the photo; PHOTOS_ENABLED=false answers 200 unavailable', async () => {
      insertPhotos(world.db, [approved(world, ID_1, '2026-10-20T10:00:00.000Z')]);
      const store = storeWithServingObjects([ID_1]);
      const { facts } = createCountingTripShareFacts(world.pool);
      const gate = new DefaultRecapShareGate({ pool: world.pool, tripShareFacts: facts });
      const port = new DefaultRecapPhotoPort({ pool: world.pool, store });

      const enabled = buildServer(makeConfig(true), {
        sharing: {
          repo: dummySharingRepo,
          requireSession: async (req: any) => { req.user = { id: world.recipientId }; },
          tripShareFacts: facts,
          recapShareGate: gate,
          recapPhotoPort: port,
        },
      });
      await enabled.ready();
      const res1 = await enabled.inject({ method: 'GET', url: `/me/inbox/${world.shareId}/trip-recap/photos` });
      expect(res1.statusCode).toBe(200);
      const body1 = res1.json() as TripRecapPhotosDTO;
      expect(body1.access).toBe('granted');
      expect(body1.photos.map((p) => p.id)).toEqual([ID_1]);

      const disabled = buildServer(makeConfig(false), {
        sharing: {
          repo: dummySharingRepo,
          requireSession: async (req: any) => { req.user = { id: world.recipientId }; },
          tripShareFacts: facts,
          recapShareGate: gate,
        },
        photos: { requireSession: async () => {}, enabled: false },
      });
      await disabled.ready();
      const res2 = await disabled.inject({ method: 'GET', url: `/me/inbox/${world.shareId}/trip-recap/photos` });
      expect(res2.statusCode).toBe(200);
      expect(res2.json()).toEqual({ access: 'unavailable', photos: [], nextCursor: null });
    });
  });

  // -----------------------------------------------------------------------
  // Row 6: contents, statuses and blocks (R15.27)
  // -----------------------------------------------------------------------
  it('lists exactly the approved, not-blocked photos of the share Trip, sort_at desc then id desc (ties by id desc)', async () => {
    const statusSeeds: SeedPhoto[] = (
      ['uploading', 'pending', 'rejected', 'needs_review', 'hidden', 'deleted'] as const
    ).map((status, i) => ({
      id: randomUUID(),
      ownerId: world.senderId,
      tripId: world.tripId,
      status,
      sortAt: `2026-10-21T0${i}:00:00.000Z`,
    }));
    const bobPhoto = randomUUID();
    const alicePhoto = randomUUID();
    const otherTripPhoto = randomUUID();
    insertPhotos(world.db, [
      // A and B tie on sort_at: id desc puts B first
      approved(world, ID_1, '2026-10-20T12:00:00.000Z'),
      approved(world, ID_2, '2026-10-20T12:00:00.000Z'),
      approved(world, ID_3, '2026-10-20T11:00:00.000Z'),
      ...statusSeeds,
      { id: bobPhoto, ownerId: world.bobId, tripId: world.tripId, status: 'approved', sortAt: '2026-10-22T10:00:00.000Z' },
      { id: alicePhoto, ownerId: world.aliceId, tripId: world.tripId, status: 'approved', sortAt: '2026-10-23T10:00:00.000Z' },
      { id: otherTripPhoto, ownerId: world.carolId, tripId: world.otherTripId, status: 'approved', sortAt: '2026-10-24T10:00:00.000Z' },
    ]);
    // the recipient blocked Bob; Alice blocked the recipient
    world.db.public.none(`
      INSERT INTO user_blocks (blocker_id, blocked_id)
      VALUES ('${world.recipientId}', '${world.bobId}'),
             ('${world.aliceId}', '${world.recipientId}');
    `);

    const h = await buildRecapApp(world, {
      store: storeWithServingObjects([ID_1, ID_2, ID_3, bobPhoto, alicePhoto, otherTripPhoto]),
    });
    const res = await getAlbum(h.app, world.shareId);
    expect(res.status).toBe(200);
    expect(res.body.access).toBe('granted');
    expect(res.body.photos.map((p: { id: string }) => p.id)).toEqual([ID_2, ID_1, ID_3]);
    expect(res.body.nextCursor).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Row 7: the "only three" complaint
  // -----------------------------------------------------------------------
  it('9 approved photos over 3 New York days: the recap shows 3 highlights while the album returns all 9', async () => {
    const ids = Array.from({ length: 9 }, () => randomUUID());
    const days = ['2026-10-20', '2026-10-21', '2026-10-22'];
    insertPhotos(
      world.db,
      ids.map((id, i) =>
        approved(world, id, `${days[Math.floor(i / 3)]}T1${i % 3}:00:00.000Z`),
      ),
    );
    const h = await buildRecapApp(world, { store: storeWithServingObjects(ids) });

    const recap = await h.app.inject({ method: 'GET', url: `/me/inbox/${world.shareId}/trip-recap` });
    expect(recap.statusCode).toBe(200);
    expect((recap.json() as TripRecapDTO).photos.photos).toHaveLength(3);

    const album = await getAlbum(h.app, world.shareId);
    expect(album.status).toBe(200);
    expect(album.body.photos).toHaveLength(9);
    expect(new Set(album.body.photos.map((p: { id: string }) => p.id))).toEqual(new Set(ids));
  });

  // -----------------------------------------------------------------------
  // Row 8: pagination and bounds (R15.25, R15.27)
  // -----------------------------------------------------------------------
  describe('pagination and bounds', () => {
    it('limit=2 over 5 photos pages 2, 2, 1 with chained cursors and a null last cursor', async () => {
      const ids = Array.from({ length: 5 }, () => randomUUID());
      insertPhotos(
        world.db,
        ids.map((id, i) => approved(world, id, `2026-10-20T1${i}:00:00.000Z`)),
      );
      const h = await buildRecapApp(world, { store: storeWithServingObjects(ids) });

      const p1 = await getAlbum(h.app, world.shareId, '?limit=2');
      expect(p1.body.photos).toHaveLength(2);
      expect(typeof p1.body.nextCursor).toBe('string');
      const p2 = await getAlbum(h.app, world.shareId, `?limit=2&cursor=${p1.body.nextCursor}`);
      expect(p2.body.photos).toHaveLength(2);
      expect(typeof p2.body.nextCursor).toBe('string');
      const p3 = await getAlbum(h.app, world.shareId, `?limit=2&cursor=${p2.body.nextCursor}`);
      expect(p3.body.photos).toHaveLength(1);
      expect(p3.body.nextCursor).toBeNull();

      const all = [...p1.body.photos, ...p2.body.photos, ...p3.body.photos].map((p: { id: string }) => p.id);
      // newest first: sort_at 14:00 .. 10:00
      expect(all).toEqual([...ids].reverse());
    });

    it('the default limit is 40 (45 photos -> 40 + a cursor) and limit=100 is accepted', async () => {
      const ids = Array.from({ length: 45 }, () => randomUUID());
      insertPhotos(
        world.db,
        ids.map((id, i) =>
          approved(world, id, new Date(Date.UTC(2026, 9, 20, 0, i)).toISOString()),
        ),
      );
      const h = await buildRecapApp(world, { store: storeWithServingObjects(ids) });

      const first = await getAlbum(h.app, world.shareId);
      expect(first.status).toBe(200);
      expect(first.body.photos).toHaveLength(40);
      expect(typeof first.body.nextCursor).toBe('string');

      const big = await getAlbum(h.app, world.shareId, '?limit=100');
      expect(big.status).toBe(200);
      expect(big.body.photos).toHaveLength(45);
      expect(big.body.nextCursor).toBeNull();
    });

    it.each([
      ['limit=0', '?limit=0'],
      ['limit=101', '?limit=101'],
      ['limit=1.5', '?limit=1.5'],
      ['limit=abc', '?limit=abc'],
      ['unknown key', '?foo=1'],
      ['garbage cursor', '?cursor=!!!'],
      ['well-formed json with bad fields', `?cursor=${Buffer.from('{"s":"x","i":"y"}').toString('base64url')}`],
    ])('%s -> 400 validation_failed', async (_label, query) => {
      const h = await buildRecapApp(world);
      const res = await getAlbum(h.app, world.shareId, query);
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('validation_failed');
    });
  });

  // -----------------------------------------------------------------------
  // Rows 9, 10, 11: exact key sets, no identity, serving keys, cache header
  // -----------------------------------------------------------------------
  describe('payload shape', () => {
    it('exact key sets and no uploader identity, caption, feed item id, object key or bucket name anywhere in the body', async () => {
      const feedId = randomUUID();
      insertFeedPost(world.db, {
        id: feedId,
        tripId: world.tripId,
        actorId: world.aliceId,
        caption: SENTINEL_CAPTION,
      });
      const ids = [randomUUID(), randomUUID()];
      insertPhotos(world.db, [
        approved(world, ids[0]!, '2026-10-20T10:00:00.000Z', { ownerId: world.aliceId, feedItemId: feedId }),
        approved(world, ids[1]!, '2026-10-20T11:00:00.000Z', { ownerId: world.senderId }),
      ]);
      const h = await buildRecapApp(world, { store: storeWithServingObjects(ids) });
      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(200);

      expect(Object.keys(res.body).sort()).toEqual(ALBUM_KEYS);
      expect(res.body.photos).toHaveLength(2);
      for (const item of res.body.photos) {
        expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      }

      const serialized = JSON.stringify(res.body);
      for (const forbidden of [
        world.senderId,
        world.recipientId,
        world.aliceId,
        world.bobId,
        world.tripId,
        feedId,
        SENTINEL_UPLOADER_ALICE,
        SENTINEL_UPLOADER_BOB,
        SENTINEL_CAPTION,
        'Sender Sam',
        'object_key',
        'thumb_key',
        'ownerId',
        'owner_id',
        'bucket',
        'u/',
      ]) {
        expect(serialized, `body must not contain ${forbidden}`).not.toContain(forbidden);
      }
    });

    it('mints URLs only from p/<id>/full.jpg and p/<id>/thumb.jpg, all present in a store seeded with only p/ objects', async () => {
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      insertPhotos(
        world.db,
        ids.map((id, i) => approved(world, id, `2026-10-20T1${i}:00:00.000Z`)),
      );
      // the rows keep u/ upload keys (production state after approval)
      const stored = world.db.public.many('SELECT object_key, thumb_key FROM photos') as Array<{
        object_key: string;
        thumb_key: string;
      }>;
      expect(stored.every((r) => r.object_key.startsWith('u/') && r.thumb_key.startsWith('u/'))).toBe(true);

      const store = storeWithServingObjects(ids);
      expect([...store.objects.keys()].every((k) => k.startsWith('p/'))).toBe(true);
      const h = await buildRecapApp(world, { store });
      const res = await getAlbum(h.app, world.shareId);
      expect(res.status).toBe(200);

      expect(store.missingGetKeys()).toEqual([]);
      const minted = store.mintedGetKeys();
      expect(minted).toHaveLength(6);
      for (const key of minted) {
        expect(key).toMatch(/^p\/[0-9a-f-]{36}\/(full|thumb)\.jpg$/);
      }
      for (const item of res.body.photos as Array<{ id: string; url: string; thumbUrl: string }>) {
        expect(FakeObjectStore.keyFromUrl(item.url)).toBe(photoKeys(item.id).full);
        expect(FakeObjectStore.keyFromUrl(item.thumbUrl)).toBe(photoKeys(item.id).thumb);
      }
    });

    it('answers Cache-Control: private, no-store on granted, unavailable and not_included', async () => {
      insertPhotos(world.db, [approved(world, ID_1, '2026-10-20T10:00:00.000Z')]);
      const granted = await buildRecapApp(world, { store: storeWithServingObjects([ID_1]) });
      expect((await getAlbum(granted.app, world.shareId)).headers['cache-control']).toBe('private, no-store');

      const unavailable = await buildRecapApp(world, { port: 'none' });
      const un = await getAlbum(unavailable.app, world.shareId);
      expect(un.body.access).toBe('unavailable');
      expect(un.headers['cache-control']).toBe('private, no-store');

      const noPhotos = createRecapAlbumWorld({ includePhotos: false });
      const notIncluded = await buildRecapApp(noPhotos);
      const ni = await getAlbum(notIncluded.app, noPhotos.shareId);
      expect(ni.body.access).toBe('not_included');
      expect(ni.headers['cache-control']).toBe('private, no-store');
    });
  });

  // -----------------------------------------------------------------------
  // Row 12: nothing URL-like is logged (R15.29, R9.7)
  // -----------------------------------------------------------------------
  it('writes no minted URL, signature or serving key to the application log', async () => {
    const ids = [randomUUID(), randomUUID()];
    insertPhotos(
      world.db,
      ids.map((id, i) => approved(world, id, `2026-10-20T1${i}:00:00.000Z`)),
    );
    const chunks: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger({ ...loggerOptions, level: 'trace' }, sink);
    const store = storeWithServingObjects(ids);
    const h = await buildRecapApp(world, { store, logger });

    const res = await getAlbum(h.app, world.shareId, '?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.nextCursor).not.toBeNull();

    const logs = chunks.join('\n');
    // non-vacuous: the request itself was logged (the serializer redacts the URL)
    expect(logs).toContain('incoming request');
    expect(logs).toContain('request completed');
    expect(logs).not.toContain('fake-r2.invalid');
    expect(logs).not.toContain('X-Amz');
    expect(logs).not.toContain('get=true');
    expect(logs).not.toMatch(/p\/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(logs).not.toContain('full.jpg');
    expect(logs).not.toContain('thumb.jpg');
  });

  // -----------------------------------------------------------------------
  // Property 44: gate matrix, exhaustive loop (3x2x2x2x2x2 = 96 combinations)
  // -----------------------------------------------------------------------
  // Feature: photo-uploads, Property 44: Recap album gate matrix
  it('Property 44: every combination of recipient row, Friendship, includePhotos, membership, Trip existence and photo wiring answers per the independent table (exhaustive, not random)', async () => {
    const ids = [randomUUID(), randomUUID()];
    insertPhotos(
      world.db,
      ids.map((id, i) => approved(world, id, `2026-10-20T1${i}:00:00.000Z`)),
    );
    const store = storeWithServingObjects(ids);
    const withPort = await buildRecapApp(world, { store, port: 'real' });
    const withoutPort = await buildRecapApp(world, { store, port: 'none' });

    const goneTripId = randomUUID();
    const friendPair = canonicalPair(world.senderId, world.recipientId);

    type RecipientState = 'present' | 'deleted' | 'absent';
    const recipientStates: RecipientState[] = ['present', 'deleted', 'absent'];
    let combos = 0;

    for (const recipient of recipientStates) {
      for (const friend of [true, false]) {
        for (const includePhotos of [true, false]) {
          for (const sharerMember of [true, false]) {
            for (const tripExists of [true, false]) {
              for (const portPresent of [true, false]) {
                combos++;
                const label = JSON.stringify({ recipient, friend, includePhotos, sharerMember, tripExists, portPresent });

                // --- arrange the world for this combination
                world.db.public.none(`DELETE FROM share_recipients WHERE share_id = '${world.shareId}'`);
                if (recipient === 'present') {
                  world.db.public.none(
                    `INSERT INTO share_recipients (share_id, recipient_id) VALUES ('${world.shareId}', '${world.recipientId}')`,
                  );
                } else if (recipient === 'deleted') {
                  world.db.public.none(
                    `INSERT INTO share_recipients (share_id, recipient_id, recipient_deleted_at) VALUES ('${world.shareId}', '${world.recipientId}', now())`,
                  );
                }
                world.db.public.none('DELETE FROM friendships');
                if (friend) {
                  world.db.public.none(
                    `INSERT INTO friendships (user_lo_id, user_hi_id) VALUES ('${friendPair.lo}', '${friendPair.hi}')`,
                  );
                }
                const shareTripId = tripExists ? world.tripId : goneTripId;
                const payload = {
                  kind: 'tripSummary',
                  tripId: shareTripId,
                  tripName: 'Magic Kingdom 2026',
                  sharerDisplayName: 'Sender Sam',
                  includePhotos,
                };
                world.db.public.none(
                  `UPDATE shares SET payload_snapshot = '${JSON.stringify(payload)}' WHERE id = '${world.shareId}'`,
                );
                world.db.public.none(
                  `DELETE FROM trip_memberships WHERE trip_id = '${world.tripId}' AND user_id = '${world.senderId}'`,
                );
                if (sharerMember) {
                  world.db.public.none(
                    `INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ('${world.tripId}', '${world.senderId}', 'organizer')`,
                  );
                }

                // --- independently written expectation
                let expectedStatus = 200;
                let expectedAccess: 'granted' | 'not_included' | 'unavailable' | null = null;
                const gatePasses = recipient === 'present' && friend;
                if (!gatePasses) {
                  expectedStatus = 400;
                } else if (!(sharerMember && tripExists)) {
                  expectedAccess = 'unavailable';
                } else if (!includePhotos) {
                  expectedAccess = 'not_included';
                } else if (!portPresent) {
                  expectedAccess = 'unavailable';
                } else {
                  expectedAccess = 'granted';
                }

                const h = portPresent ? withPort : withoutPort;
                h.counters.isMember = 0;
                h.counters.tripName = 0;
                h.counters.summary = 0;
                h.counters.roleOf = 0;
                h.albumPageCalls.count = 0;
                const mintedBefore = store.presignedGets.length;

                // --- act: album
                const res = await getAlbum(h.app, world.shareId);

                // --- assert: album
                expect(res.status, label).toBe(expectedStatus);
                expect(res.headers['cache-control'] ?? 'private, no-store', label).toBe('private, no-store');
                if (expectedStatus === 400) {
                  expect(res.body.error?.code, label).toBe('validation_failed');
                  // read-order rule: nothing about the Trip or photos was read
                  expect(h.counters, label).toEqual({ isMember: 0, tripName: 0, summary: 0, roleOf: 0 });
                  expect(h.albumPageCalls.count, label).toBe(0);
                  expect(store.presignedGets.length, label).toBe(mintedBefore);
                } else if (expectedAccess === 'granted') {
                  expect(Object.keys(res.body).sort(), label).toEqual(ALBUM_KEYS);
                  expect(res.body.access, label).toBe('granted');
                  expect(res.body.photos.map((p: { id: string }) => p.id), label).toEqual([ids[1], ids[0]]);
                  expect(res.body.nextCursor, label).toBeNull();
                  expect(store.presignedGets.length, label).toBe(mintedBefore + 4);
                } else {
                  expect(res.body, label).toEqual({ access: expectedAccess, photos: [], nextCursor: null });
                  expect(h.albumPageCalls.count, label).toBe(0);
                  expect(store.presignedGets.length, label).toBe(mintedBefore);
                }
                // the album never loads the recap figures
                expect(h.counters.summary, label).toBe(0);

                // --- row 22: same access outcome as the recap route when the gate passes
                if (gatePasses) {
                  const recap = await h.app.inject({
                    method: 'GET',
                    url: `/me/inbox/${world.shareId}/trip-recap`,
                  });
                  expect(recap.statusCode, label).toBe(200);
                  expect((recap.json() as TripRecapDTO).photos.access, label).toBe(expectedAccess);
                }
              }
            }
          }
        }
      }
    }
    expect(combos).toBe(96);
  });
});

// ===========================================================================
// Widened report / block through a shareId (R16.8, R16.10, decisions D31, D32, D35)
// ===========================================================================

describe('report and block through a shareId accept any approved Trip photo of the share Trip (R16.10)', () => {
  let world: RecapAlbumWorld;

  beforeEach(() => {
    world = createRecapAlbumWorld();
  });

  async function buildPhotoApp(
    w: RecapAlbumWorld,
    options: { autohideTrip?: number } = {},
  ): Promise<{ app: FastifyInstance; setUser(id: string): void }> {
    const store = new FakeObjectStore();
    const { facts } = createCountingTripShareFacts(w.pool);
    const gate = new DefaultRecapShareGate({ pool: w.pool, tripShareFacts: facts });
    const port = new DefaultRecapPhotoPort({ pool: w.pool, store });
    const service = new PhotoService({
      pool: w.pool,
      repo: createPhotosRepo(w.pool),
      reportsRepo: createReportsRepo(w.pool),
      objectStore: store,
      clock: { now: () => new Date() },
      targetAdapters: [new TripTarget({ pool: w.pool, maxPerTrip: 100, tripEnabled: true })],
      config: {
        enabled: true,
        foodEnabled: true,
        tripEnabled: true,
        maxBytes: 10_000_000,
        maxThumbBytes: 1_000_000,
        putUrlTtlSeconds: 300,
        dailyUploadCap: 50,
        globalDailyCap: 1000,
        maxPerFoodLog: 4,
        maxPerTrip: 300,
        maxFeedPostPhotos: 4,
        maxBatch: 10,
        recapHighlightMax: 6,
        reportAutohideTrip: options.autohideTrip ?? 3,
        reportAutohideFood: 3,
        getUrlTtlSeconds: 3600,
        experienceStripMax: 8,
      },
      recapShareGate: gate,
      recapPhotoPort: port,
    });

    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    let activeUser = w.recipientId;
    await app.register(photoRoutes, {
      photoService: service,
      requireSession: async (req: any) => {
        req.userId = activeUser;
        req.user = { id: activeUser };
      },
    });
    // the album route on the same app, for the "block removes the uploader" read-back
    registerTripRecapRoutes(app, {
      requireSession: async (req: any) => {
        req.userId = activeUser;
        req.user = { id: activeUser };
      },
      recapShareGate: gate,
      tripShareFacts: facts,
      recapPhotoPort: port,
    });
    await app.ready();
    return {
      app,
      setUser(id) {
        activeUser = id;
      },
    };
  }

  async function report(app: FastifyInstance, photoId: string, shareId: string | undefined): Promise<any> {
    return app.inject({
      method: 'POST',
      url: `/photos/${photoId}/report`,
      payload: { reason: 'spam', ...(shareId ? { shareId } : {}) },
    });
  }

  // Row 16
  it('reports an approved photo that is NOT a recap highlight through the share -> 204 and one stored report (old code: 404)', async () => {
    const early = randomUUID();
    const late = randomUUID();
    // same New York day: only the earliest is the recap highlight
    insertPhotos(world.db, [
      approved(world, early, '2026-10-20T14:00:00.000Z'),
      approved(world, late, '2026-10-20T16:00:00.000Z'),
    ]);
    const realPort = new DefaultRecapPhotoPort({ pool: world.pool, store: new FakeObjectStore() });
    const { facts } = createCountingTripShareFacts(world.pool);
    const access = await new DefaultRecapShareGate({ pool: world.pool, tripShareFacts: facts }).resolve(
      world.shareId,
      world.recipientId,
    );
    expect(access).not.toBeNull();
    const highlights = await realPort.highlights(access!, world.recipientId);
    expect(highlights.map((p) => p.id)).toEqual([early]);

    const { app } = await buildPhotoApp(world);
    const res = await report(app, late, world.shareId);
    expect(res.statusCode).toBe(204);
    const rows = world.db.public.many(`SELECT photo_id, reporter_id, status FROM photo_reports`) as Array<{
      photo_id: string;
      reporter_id: string;
      status: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ photo_id: late, reporter_id: world.recipientId, status: 'open' });
  });

  // Row 17 (report negatives)
  describe('report negatives answer photo_not_found and record nothing', () => {
    async function expectRejected(w: RecapAlbumWorld, photoId: string, shareId = w.shareId): Promise<void> {
      const { app } = await buildPhotoApp(w);
      const before = reportCount(w);
      const res = await report(app, photoId, shareId);
      expect(res.statusCode).toBe(404);
      expect(res.json().error?.code).toBe('photo_not_found');
      expect(reportCount(w)).toBe(before);
    }

    it('a photo of another Trip', async () => {
      const id = randomUUID();
      insertPhotos(world.db, [
        { id, ownerId: world.carolId, tripId: world.otherTripId, status: 'approved', sortAt: '2026-10-20T10:00:00.000Z' },
      ]);
      await expectRejected(world, id);
    });

    it.each(['pending', 'hidden', 'needs_review', 'rejected', 'uploading', 'deleted'] as const)(
      'a %s photo',
      async (status) => {
        const id = randomUUID();
        insertPhotos(world.db, [
          { id, ownerId: world.senderId, tripId: world.tripId, status, sortAt: '2026-10-20T10:00:00.000Z' },
        ]);
        await expectRejected(world, id);
      },
    );

    it('a photo whose uploader the recipient blocked', async () => {
      const id = randomUUID();
      insertPhotos(world.db, [approved(world, id, '2026-10-20T10:00:00.000Z', { ownerId: world.bobId })]);
      world.db.public.none(
        `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${world.recipientId}', '${world.bobId}')`,
      );
      await expectRejected(world, id);
    });

    it('a photo whose uploader blocked the recipient', async () => {
      const id = randomUUID();
      insertPhotos(world.db, [approved(world, id, '2026-10-20T10:00:00.000Z', { ownerId: world.aliceId })]);
      world.db.public.none(
        `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ('${world.aliceId}', '${world.recipientId}')`,
      );
      await expectRejected(world, id);
    });

    it("the recipient's own photo", async () => {
      const id = randomUUID();
      insertPhotos(world.db, [approved(world, id, '2026-10-20T10:00:00.000Z', { ownerId: world.recipientId })]);
      await expectRejected(world, id);
    });

    it('a share with includePhotos=false', async () => {
      const noPhotos = createRecapAlbumWorld({ includePhotos: false });
      const id = randomUUID();
      insertPhotos(noPhotos.db, [approved(noPhotos, id, '2026-10-20T10:00:00.000Z')]);
      await expectRejected(noPhotos, id);
    });

    it('an unfriended recipient', async () => {
      const id = randomUUID();
      insertPhotos(world.db, [approved(world, id, '2026-10-20T10:00:00.000Z')]);
      world.db.public.none('DELETE FROM friendships');
      await expectRejected(world, id);
    });

    it('a deleted share and an unknown share id', async () => {
      const id = randomUUID();
      insertPhotos(world.db, [approved(world, id, '2026-10-20T10:00:00.000Z')]);
      await expectRejected(world, id, randomUUID());
      world.db.public.none(
        `UPDATE share_recipients SET recipient_deleted_at = now() WHERE share_id = '${world.shareId}'`,
      );
      await expectRejected(world, id);
    });
  });

  // Row 17 (block)
  describe('block with { photoId, shareId }', () => {
    it('accepts any approved Trip photo: 201, no user id in the body, and the album afterwards omits that uploader', async () => {
      const bobPhoto = randomUUID();
      const sendersPhoto = randomUUID();
      insertPhotos(world.db, [
        approved(world, bobPhoto, '2026-10-20T10:00:00.000Z', { ownerId: world.bobId }),
        approved(world, sendersPhoto, '2026-10-20T11:00:00.000Z'),
      ]);
      const { app } = await buildPhotoApp(world);

      const before = await getAlbum(app, world.shareId);
      expect(before.body.photos.map((p: { id: string }) => p.id)).toEqual([sendersPhoto, bobPhoto]);

      const res = await app.inject({
        method: 'POST',
        url: '/me/blocks',
        payload: { photoId: bobPhoto, shareId: world.shareId },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.blockId).toBeDefined();
      expect(body.userId).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(world.bobId);
      // Bob is not a Friend of the recipient, so his name is not revealed either
      expect(body.displayName).toBeNull();

      const after = await getAlbum(app, world.shareId);
      expect(after.body.photos.map((p: { id: string }) => p.id)).toEqual([sendersPhoto]);
    });

    it.each(['other_trip', 'pending', 'unfriended', 'include_photos_false'] as const)(
      'rejects with photo_not_found and records no block: %s',
      async (scenario) => {
        let w = world;
        const id = randomUUID();
        if (scenario === 'other_trip') {
          insertPhotos(w.db, [
            { id, ownerId: w.carolId, tripId: w.otherTripId, status: 'approved', sortAt: '2026-10-20T10:00:00.000Z' },
          ]);
        } else if (scenario === 'pending') {
          insertPhotos(w.db, [
            { id, ownerId: w.bobId, tripId: w.tripId, status: 'pending', sortAt: '2026-10-20T10:00:00.000Z' },
          ]);
        } else if (scenario === 'unfriended') {
          insertPhotos(w.db, [approved(w, id, '2026-10-20T10:00:00.000Z', { ownerId: w.bobId })]);
          w.db.public.none('DELETE FROM friendships');
        } else {
          w = createRecapAlbumWorld({ includePhotos: false });
          insertPhotos(w.db, [approved(w, id, '2026-10-20T10:00:00.000Z', { ownerId: w.bobId })]);
        }
        const { app } = await buildPhotoApp(w);
        const before = blockCount(w);
        const res = await app.inject({
          method: 'POST',
          url: '/me/blocks',
          payload: { photoId: id, shareId: w.shareId },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json().error?.code).toBe('photo_not_found');
        expect(blockCount(w)).toBe(before);
      },
    );
  });

  // Row 18: D31 stays
  it('D31: a recipient report is recorded but does not hide the photo; a current member report does (threshold 1)', async () => {
    const id = randomUUID();
    // alice's approved photo; the recipient is not a Trip member
    insertPhotos(world.db, [approved(world, id, '2026-10-20T16:00:00.000Z', { ownerId: world.aliceId })]);
    const { app, setUser } = await buildPhotoApp(world, { autohideTrip: 1 });

    const recipientReport = await report(app, id, world.shareId);
    expect(recipientReport.statusCode).toBe(204);
    const reports = world.db.public.many(`SELECT status FROM photo_reports WHERE photo_id = '${id}'`) as Array<{
      status: string;
    }>;
    expect(reports).toEqual([{ status: 'open' }]);
    const afterRecipient = world.db.public.one(`SELECT status FROM photos WHERE id = '${id}'`) as { status: string };
    expect(afterRecipient.status).toBe('approved');

    // a current Trip member (Bob) reports without a shareId and tips the threshold
    setUser(world.bobId);
    const memberReport = await report(app, id, undefined);
    expect(memberReport.statusCode).toBe(204);
    const afterMember = world.db.public.one(`SELECT status FROM photos WHERE id = '${id}'`) as { status: string };
    expect(afterMember.status).toBe('hidden');
  });
});
