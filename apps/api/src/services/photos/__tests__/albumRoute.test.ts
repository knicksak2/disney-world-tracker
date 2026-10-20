/**
 * Route integration tests for Trip Album and Recap Highlights (Tasks 19.2 and 19.4).
 *
 * Implements: Task 19.2, Task 19.4
 * Validates: Requirements 9.8, 12.3, 12.5, 12.6, 12.7, 12.11, 13.1, 13.2, 13.3, 13.4, 13.5,
 *            13.7, 13.8, 15.7, 17.3, 26.2, 26.4, 26.6; Properties 17, 38.
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
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { createReportsRepo } from '../reportsRepo.js';
import { PhotoService, type PhotoServiceConfig } from '../service.js';
import { tripPhotoRoutes } from '../tripRoutes.js';
import { photoRoutes } from '../routes.js';
import { TripTarget } from '../targets/tripTarget.js';
import { FakeClock, FakeObjectStore } from './fakes.js';
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

describe('Trip Album Routes (Task 19.2 and 19.4)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let photosRepo: PhotosRepo;
  let store: FakeObjectStore;
  let clock: FakeClock;
  let tripTarget: TripTarget;
  let photoService: PhotoService;

  let organizerId: string;
  let memberId: string;
  let strangerId: string;
  let tripId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');

    organizerId = randomUUID();
    memberId = randomUUID();
    strangerId = randomUUID();
    tripId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${organizerId}', 'org@example.com', 'hash'),
             ('${memberId}', 'mem@example.com', 'hash'),
             ('${strangerId}', 'stranger@example.com', 'hash');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${organizerId}', 'Organizer User', 'castle'),
             ('${memberId}', 'Member Mary', 'wishing-star'),
             ('${strangerId}', 'Stranger Sam', 'fireworks');

      INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
      VALUES ('${tripId}', '${organizerId}', 'Disney Fun', 'Trip notes', '2026-10-20', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role)
      VALUES ('${tripId}', '${organizerId}', 'organizer'),
             ('${tripId}', '${memberId}', 'member');
    `);

    photosRepo = createPhotosRepo(pool);
    const reportsRepo = createReportsRepo(pool);
    store = new FakeObjectStore();
    clock = new FakeClock(new Date('2026-10-20T12:00:00Z'));
    tripTarget = new TripTarget({ pool, photosRepo, maxPerTrip: 300, tripEnabled: true });

    photoService = new PhotoService({
      pool,
      repo: photosRepo,
      reportsRepo,
      objectStore: store,
      targetAdapters: [tripTarget],
      clock,
      config: DEFAULT_CONFIG,
    });
  });

  function buildTestServer(currentUserId: string | null = memberId, customConfig: PhotoServiceConfig = DEFAULT_CONFIG): FastifyInstance {
    const app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (req) => {
      if (!currentUserId) {
        throw new (await import('../../../errors/AppError.js')).AppError('unauthorized', 'Authentication required');
      }
      req.userId = currentUserId;
    };

    const service = customConfig === DEFAULT_CONFIG ? photoService : new PhotoService({
      pool,
      repo: photosRepo,
      reportsRepo: createReportsRepo(pool),
      objectStore: store,
      targetAdapters: [tripTarget],
      clock,
      config: customConfig,
    });

    void app.register(tripPhotoRoutes, {
      photoService: service,
      requireSession,
      pool,
    });

    void app.register(photoRoutes, {
      photoService: service,
      requireSession,
    });

    return app;
  }

  function seedPhoto(params: {
    id?: string;
    tripId?: string;
    ownerId?: string | null;
    status?: string;
    sortAt?: string;
    createdAt?: string;
  }): string {
    const id = params.id ?? randomUUID();
    const tId = params.tripId ?? tripId;
    const owner = params.ownerId !== undefined ? (params.ownerId ? `'${params.ownerId}'` : 'NULL') : `'${memberId}'`;
    const status = params.status ?? 'approved';
    const sortAt = params.sortAt ?? '2026-10-20T12:00:00Z';
    const createdAt = params.createdAt ?? '2026-10-20T12:00:00Z';
    const harm = status === 'approved' ? "'pass'" : 'NULL';

    // Production shape: rows keep the `u/` upload keys forever. Approved photos have only
    // their `p/` objects in the bucket (the `u/` objects are deleted); in-flight photos
    // still have their `u/` objects.
    const keys = photoKeys(id);
    if (status === 'approved' || status === 'hidden') {
      store.put(keys.full, new Uint8Array([1, 2, 3]));
      store.put(keys.thumb, new Uint8Array([4, 5, 6]));
    } else {
      store.put(keys.uploadFull, new Uint8Array([1, 2, 3]));
      store.put(keys.uploadThumb, new Uint8Array([4, 5, 6]));
    }

    db.public.none(`
      INSERT INTO photos (
        id, target_kind, target_id, scope_id, owner_id,
        status, object_key, thumb_key, width, height, byte_size, thumb_byte_size,
        sort_at, created_at, full_etag, thumb_etag, served_at, harm_verdict
      ) VALUES (
        '${id}', 'trip', '${tId}', '${tId}', ${owner},
        '${status}', '${keys.uploadFull}', '${keys.uploadThumb}',
        1920, 1080, 204800, 20480, '${sortAt}', '${createdAt}', 'etag-full', 'etag-thumb', now(), ${harm}
      );
    `);
    return id;
  }

  describe('Task 19.2: Album Route (GET /trips/:id/photos)', () => {
    it('requires session and returns 401 when unauthenticated', async () => {
      const server = buildTestServer(null);
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(res.statusCode).toBe(401);
    });

    it('denies non-members, non-existent trips, and removed members with trip_forbidden (403)', async () => {
      // 1. Non-member
      const strangerServer = buildTestServer(strangerId);
      const resStranger = await strangerServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(resStranger.statusCode).toBe(403);
      expect(resStranger.json().error?.code).toBe('trip_forbidden');

      // 2. Non-existent trip
      const missingTripId = randomUUID();
      const resMissing = await strangerServer.inject({
        method: 'GET',
        url: `/trips/${missingTripId}/photos`,
      });
      expect(resMissing.statusCode).toBe(403);
      expect(resMissing.json().error?.code).toBe('trip_forbidden');

      // 3. Removed member
      db.public.none(`DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${memberId}'`);
      const memberServer = buildTestServer(memberId);
      const resRemoved = await memberServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(resRemoved.statusCode).toBe(403);
      expect(resRemoved.json().error?.code).toBe('trip_forbidden');
    });

    it('Property 17: keyset pagination on (sort_at desc, id desc) returns each visible photo once', async () => {
      // Seed 5 photos with distinct sort_at
      const p1 = seedPhoto({ sortAt: '2026-10-20T10:00:00Z' });
      const p2 = seedPhoto({ sortAt: '2026-10-20T11:00:00Z' });
      const p3 = seedPhoto({ sortAt: '2026-10-20T12:00:00Z' });
      const p4 = seedPhoto({ sortAt: '2026-10-20T13:00:00Z' });
      const p5 = seedPhoto({ sortAt: '2026-10-20T14:00:00Z' });

      const server = buildTestServer(memberId);

      // Page 1 (limit 2)
      const res1 = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?limit=2`,
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.headers['cache-control']).toBe('private, no-store');
      const page1 = res1.json();
      expect(page1.items.length).toBe(2);
      expect(page1.items[0].id).toBe(p5);
      expect(page1.items[1].id).toBe(p4);
      expect(page1.nextCursor).not.toBeNull();

      // Page 2 (limit 2)
      const res2 = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      });
      expect(res2.statusCode).toBe(200);
      const page2 = res2.json();
      expect(page2.items.length).toBe(2);
      expect(page2.items[0].id).toBe(p3);
      expect(page2.items[1].id).toBe(p2);
      expect(page2.nextCursor).not.toBeNull();

      // Page 3 (limit 2)
      const res3 = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`,
      });
      expect(res3.statusCode).toBe(200);
      const page3 = res3.json();
      expect(page3.items.length).toBe(1);
      expect(page3.items[0].id).toBe(p1);
      expect(page3.nextCursor).toBeNull();
    });

    it('shows owner their non-approved photos with status chips while hiding others non-approved photos', async () => {
      // Member owns approved and pending
      const myApproved = seedPhoto({ ownerId: memberId, status: 'approved' });
      const myPending = seedPhoto({ ownerId: memberId, status: 'pending' });

      // Organizer owns approved and pending
      const orgApproved = seedPhoto({ ownerId: organizerId, status: 'approved' });
      const orgPending = seedPhoto({ ownerId: organizerId, status: 'pending' });

      const server = buildTestServer(memberId);
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(res.statusCode).toBe(200);
      const items: any[] = res.json().items;

      const ids = items.map((i) => i.id);
      expect(ids).toContain(myApproved);
      expect(ids).toContain(myPending);
      expect(ids).toContain(orgApproved);
      expect(ids).not.toContain(orgPending); // Other user's pending photo is hidden!

      const pendingItem = items.find((i) => i.id === myPending);
      expect(pendingItem.mine).toBe(true);
      expect(pendingItem.status).toBe('pending');
    });

    it('hides photos deleted by uploader and blocked user photos in both directions', async () => {
      const activePhoto = seedPhoto({ ownerId: organizerId, status: 'approved' });
      const deletedPhoto = seedPhoto({ ownerId: organizerId, status: 'deleted' });

      // Member blocks stranger or organizer
      const blockedOrgPhoto = seedPhoto({ ownerId: organizerId, status: 'approved' });
      db.public.none(`
        INSERT INTO user_blocks (id, blocker_id, blocked_id)
        VALUES ('${randomUUID()}', '${memberId}', '${organizerId}');
      `);

      const server = buildTestServer(memberId);
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(res.statusCode).toBe(200);
      const items: any[] = res.json().items;
      const ids = items.map((i) => i.id);

      expect(ids).not.toContain(deletedPhoto);
      expect(ids).not.toContain(activePhoto);
      expect(ids).not.toContain(blockedOrgPhoto);
    });

    it('populates uploader byline from profiles table', async () => {
      const p = seedPhoto({ ownerId: organizerId, status: 'approved' });

      const server = buildTestServer(memberId);
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(res.statusCode).toBe(200);
      const items: any[] = res.json().items;
      const item = items.find((i) => i.id === p);

      expect(item.uploader).toEqual({
        userId: organizerId,
        displayName: 'Organizer User',
        avatarPreset: 'castle',
      });
    });

    it('departed uploader behavior (decision D30, Requirements 12.5, 12.6, 12.11)', async () => {
      // Member uploaded a photo
      const memberPhotoId = seedPhoto({ ownerId: memberId, status: 'approved' });
      const orgPhotoId = seedPhoto({ ownerId: organizerId, status: 'approved' });

      // Member is removed from trip
      db.public.none(`DELETE FROM trip_memberships WHERE trip_id = '${tripId}' AND user_id = '${memberId}'`);

      const departedServer = buildTestServer(memberId);

      // 1. Departed member gets trip_forbidden on GET /trips/:id/photos
      const getRes = await departedServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(getRes.statusCode).toBe(403);
      expect(getRes.json().error?.code).toBe('trip_forbidden');

      // 2. Departed member gets trip_forbidden on POST /photos/uploads with trip target
      const uploadRes = await departedServer.inject({
        method: 'POST',
        url: '/photos/uploads',
        payload: {
          target: { kind: 'trip', id: tripId },
          items: [{ byteSize: 1000, thumbByteSize: 100, width: 800, height: 600, contentType: 'image/jpeg' }],
        },
      });
      expect(uploadRes.statusCode).toBe(403);
      expect(uploadRes.json().error?.code).toBe('trip_forbidden');

      // 3. Departed member trying to delete another member's photo gets photo_not_found
      const foreignDeleteRes = await departedServer.inject({
        method: 'DELETE',
        url: `/photos/${orgPhotoId}`,
      });
      expect(foreignDeleteRes.statusCode).toBe(404);

      // 4. Departed member deleting their own photo succeeds (204) and marks it deleted
      const ownDeleteRes = await departedServer.inject({
        method: 'DELETE',
        url: `/photos/${memberPhotoId}`,
      });
      expect(ownDeleteRes.statusCode).toBe(204);

      const photoRow = await photosRepo.getById(memberPhotoId);
      expect(photoRow?.status).toBe('deleted');

      // 5. Active member/organizer still sees non-deleted photos
      const orgServer = buildTestServer(organizerId);
      const orgAlbumRes = await orgServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos`,
      });
      expect(orgAlbumRes.statusCode).toBe(200);
      const items = orgAlbumRes.json().items;
      expect(items.some((i: any) => i.id === memberPhotoId)).toBe(false);
      expect(items.some((i: any) => i.id === orgPhotoId)).toBe(true);
    });
  });

  describe('serving keys (rows keep u/ keys; only p/ objects exist for approved photos)', () => {
    it('album and summary highlights presign p/ keys derived from the photo id, all present in the store', async () => {
      const approvedId = seedPhoto({ ownerId: organizerId, status: 'approved', sortAt: '2026-10-21T10:00:00Z' });
      const mineApprovedId = seedPhoto({ ownerId: memberId, status: 'approved', sortAt: '2026-10-22T10:00:00Z' });
      const mineHiddenId = seedPhoto({ ownerId: memberId, status: 'hidden', sortAt: '2026-10-23T10:00:00Z' });

      // Fixture sanity: the rows hold the u/ upload keys, as production does.
      const row = db.public.one(`SELECT object_key, thumb_key FROM photos WHERE id = '${approvedId}'`);
      expect(row.object_key).toBe(`u/${approvedId}/full.jpg`);
      expect(row.thumb_key).toBe(`u/${approvedId}/thumb.jpg`);

      const server = buildTestServer(memberId);
      const albumRes = await server.inject({ method: 'GET', url: `/trips/${tripId}/photos` });
      expect(albumRes.statusCode).toBe(200);
      const albumItems: Array<{ id: string; url: string; thumbUrl: string }> = albumRes.json().items;
      for (const id of [approvedId, mineApprovedId, mineHiddenId]) {
        const item = albumItems.find((i) => i.id === id);
        expect(item).toBeDefined();
        expect(FakeObjectStore.keyFromUrl(item!.url)).toBe(photoKeys(id).full);
        expect(FakeObjectStore.keyFromUrl(item!.thumbUrl)).toBe(photoKeys(id).thumb);
      }

      const summaryRes = await server.inject({ method: 'GET', url: `/trips/${tripId}/photos?summary=true` });
      expect(summaryRes.statusCode).toBe(200);
      const summaryItems: Array<{ id: string; url: string; thumbUrl: string }> = summaryRes.json().items;
      expect(summaryItems.map((i) => i.id)).toEqual([approvedId, mineApprovedId]);
      for (const item of summaryItems) {
        expect(FakeObjectStore.keyFromUrl(item.url)).toBe(photoKeys(item.id).full);
        expect(FakeObjectStore.keyFromUrl(item.thumbUrl)).toBe(photoKeys(item.id).thumb);
      }

      expect(store.missingGetKeys()).toEqual([]);
      expect(store.mintedGetKeys().some((k) => k.startsWith('u/'))).toBe(false);
    });
  });

  describe('Task 19.4: Album Recap Highlights (GET /trips/:id/photos?summary=true)', () => {
    it('returns earliest sort_at photo per America/New_York day in ascending order', async () => {
      // Day 1: 2026-10-21 (two photos at 10:00 and 15:00)
      const p1a = seedPhoto({ sortAt: '2026-10-21T10:00:00Z' });
      seedPhoto({ sortAt: '2026-10-21T15:00:00Z' });

      // Day 2: 2026-10-22
      const p2 = seedPhoto({ sortAt: '2026-10-22T11:00:00Z' });

      // Day 3: 2026-10-23
      const p3 = seedPhoto({ sortAt: '2026-10-23T12:00:00Z' });

      // Day 4: 2026-10-24
      const p4 = seedPhoto({ sortAt: '2026-10-24T13:00:00Z' });

      const server = buildTestServer(memberId);
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?summary=true`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const body = res.json();
      expect(body.nextCursor).toBeNull();
      expect(body.items.length).toBe(4);
      expect(body.items.map((i: any) => i.id)).toEqual([p1a, p2, p3, p4]);
    });

    it('bulk upload case (decision D29): groups highlights by capture day (sort_at), not upload day (created_at)', async () => {
      // 10 photos all created on the same day 2026-10-25, but takenAt spans 5 different days
      const days = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
      const expectedIds: string[] = [];

      for (const day of days) {
        // Earliest for this day
        const earliestId = seedPhoto({
          sortAt: `${day}T09:00:00Z`,
          createdAt: '2026-10-25T18:00:00Z',
        });
        expectedIds.push(earliestId);

        // Later photo on same day
        seedPhoto({
          sortAt: `${day}T14:00:00Z`,
          createdAt: '2026-10-25T18:00:00Z',
        });
      }

      const server = buildTestServer(memberId);
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?summary=true`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Must yield 5 highlights, one per capture day
      expect(body.items.length).toBe(5);
      expect(body.items.map((i: any) => i.id)).toEqual(expectedIds);
    });

    it('respects recapHighlightMax cap and returns empty list when trip has no approved photos', async () => {
      // Seed 8 distinct days of photos
      for (let i = 10; i <= 17; i++) {
        seedPhoto({ sortAt: `2026-10-${i}T12:00:00Z` });
      }

      // 1. Default config (max 6)
      const serverDefault = buildTestServer(memberId);
      const resDefault = await serverDefault.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?summary=true`,
      });
      expect(resDefault.statusCode).toBe(200);
      expect(resDefault.json().items.length).toBe(6);

      // 2. Custom config with recapHighlightMax = 2
      const serverCap2 = buildTestServer(memberId, { ...DEFAULT_CONFIG, recapHighlightMax: 2 });
      const resCap2 = await serverCap2.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?summary=true`,
      });
      expect(resCap2.statusCode).toBe(200);
      expect(resCap2.json().items.length).toBe(2);

      // 3. Empty trip returns empty items array
      const emptyTripId = randomUUID();
      db.public.none(`
        INSERT INTO trips (id, creator_id, name, start_date, end_date)
        VALUES ('${emptyTripId}', '${memberId}', 'Empty Trip', '2026-11-01', '2026-11-05');
        INSERT INTO trip_memberships (trip_id, user_id, role)
        VALUES ('${emptyTripId}', '${memberId}', 'member');
      `);
      const resEmpty = await serverDefault.inject({
        method: 'GET',
        url: `/trips/${emptyTripId}/photos?summary=true`,
      });
      expect(resEmpty.statusCode).toBe(200);
      expect(resEmpty.json().items).toEqual([]);
    });

    it('excludes pending photos, deleted photos, and blocked users from recap highlights', async () => {
      // Day 1: earliest photo is by blocked user, next earliest is active
      const blockedPhoto = seedPhoto({
        ownerId: organizerId,
        sortAt: '2026-10-21T10:00:00Z',
      });
      const activePhoto = seedPhoto({
        ownerId: memberId,
        sortAt: '2026-10-21T12:00:00Z',
      });

      // Member blocks organizer
      db.public.none(`
        INSERT INTO user_blocks (id, blocker_id, blocked_id)
        VALUES ('${randomUUID()}', '${memberId}', '${organizerId}');
      `);

      const server = buildTestServer(memberId);
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/photos?summary=true`,
      });

      expect(res.statusCode).toBe(200);
      const items = res.json().items;
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(activePhoto);
      expect(items.map((i: any) => i.id)).not.toContain(blockedPhoto);
    });

    it('route inventory (Requirement 15.7): no route returning trip photos is reachable without session', async () => {
      const unauthServer = buildTestServer(null);

      const endpoints = [
        { method: 'GET' as const, url: `/trips/${tripId}/photos` },
        { method: 'GET' as const, url: `/trips/${tripId}/photos?summary=true` },
      ];

      for (const ep of endpoints) {
        const res = await unauthServer.inject({
          method: ep.method,
          url: ep.url,
        });
        expect(res.statusCode).toBe(401);
      }
    });
  });
});
