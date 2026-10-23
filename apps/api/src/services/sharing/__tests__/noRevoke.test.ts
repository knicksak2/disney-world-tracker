/**
 * Tests for Task 21.2: No sender revoke; recipient delete ends access (decision D22).
 *
 * Validates: Requirements 15.6, 15.11
 *
 * Exercises:
 * 1. After a recipient calls DELETE /me/inbox/:shareId, GET /me/inbox/:shareId/trip-recap
 *    answers the collapsed validation_failed and returns no photo or figure, while a second
 *    recipient of the same share still reads it.
 * 2. Route-inventory guard (tightened): collect every route registered by the Sharing plugin
 *    and the photos plugin through Fastify's onRoute hook and assert the set of (method, url)
 *    equals an explicit allowlist (fails on any unlisted route).
 * 3. Behavior check for existing mutations: with a delivered tripSummary share, the sender
 *    calling POST /me/inbox/:shareId/open and DELETE /me/inbox/:shareId changes no share_recipients
 *    row and the recipient's recap read still works.
 * 4. shares has no revoke column in database schema.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TripRecapDTO, TripSummaryDTO, TripSummarySharePayload } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/index.js';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import { FakeObjectStore } from '../../photos/__tests__/fakes.js';
import { foodReadRoutes } from '../../photos/foodReadRoutes.js';
import { DefaultRecapPhotoPort } from '../../photos/recapPhotoPort.js';
import { createPhotosRepo } from '../../photos/repo.js';
import { createReportsRepo } from '../../photos/reportsRepo.js';
import { photoRoutes } from '../../photos/routes.js';
import { PhotoService, type PhotoServiceConfig } from '../../photos/service.js';
import { sweepCronRoute } from '../../photos/sweepCronRoute.js';
import { TripTarget } from '../../photos/targets/tripTarget.js';
import { tripPhotoRoutes } from '../../photos/tripRoutes.js';
import type { TripRole } from '../../trips/permissions.js';
import type { RecapPhotoPort, TripShareFacts } from '../ports.js';
import { createSharingRepo, type SharingRepo } from '../repo.js';
import { sharingRoutes } from '../routes.js';
import { DefaultRecapShareGate } from '../tripRecapGate.js';

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

function adaptPgMemSql(
  text: string,
  params?: ReadonlyArray<unknown>,
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
      },
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

describe('Task 21.2: No sender revoke; recipient delete ends access (decision D22)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let sharingRepo: SharingRepo;
  let photosRepo: ReturnType<typeof createPhotosRepo>;
  let reportsRepo: ReturnType<typeof createReportsRepo>;
  let photoService: PhotoService;
  let fakeStore: FakeObjectStore;

  let senderId: string;
  let recipient1Id: string;
  let recipient2Id: string;
  let tripId: string;
  let shareId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0002_experience_images.sql');
    applyMigration(db, '0006_experience_land.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');
  // The friend gate and the inbox read the 0064 visibility views.
  applyMigration(db, '0064_account_deletion.sql');

    senderId = randomUUID();
    recipient1Id = randomUUID();
    recipient2Id = randomUUID();
    tripId = randomUUID();
    shareId = randomUUID();

    // Users & profiles
    db.public.none(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('${senderId}', 'sender@example.com', 'h1'),
        ('${recipient1Id}', 'rec1@example.com', 'h2'),
        ('${recipient2Id}', 'rec2@example.com', 'h3');

      INSERT INTO profiles (user_id, display_name, avatar_preset) VALUES
        ('${senderId}', 'Alice Sender', 'castle'),
        ('${recipient1Id}', 'Bob Recipient', 'wishing-star'),
        ('${recipient2Id}', 'Charlie Recipient', 'ear-balloon');

      INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES
        ('${tripId}', '${senderId}', 'Magic Kingdom Trip', 'Trip Notes', '2026-10-20', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role) VALUES
        ('${tripId}', '${senderId}', 'organizer');
    `);

    // Friendships (sender is friends with recipient 1 and recipient 2)
    const pair1 = canonicalPair(senderId, recipient1Id);
    const pair2 = canonicalPair(senderId, recipient2Id);
    db.public.none(`
      INSERT INTO friendships (user_lo_id, user_hi_id) VALUES
        ('${pair1.lo}', '${pair1.hi}'),
        ('${pair2.lo}', '${pair2.hi}');
    `);

    // Seed approved photo on trip
    const photoId = randomUUID();
    db.public.none(`
      INSERT INTO photos (
        id, target_kind, target_id, scope_id, owner_id,
        status, object_key, thumb_key, width, height, byte_size, thumb_byte_size,
        sort_at, created_at, full_etag, thumb_etag, served_at, harm_verdict
      ) VALUES (
        '${photoId}', 'trip', '${tripId}', '${tripId}', '${senderId}',
        'approved', 'p/${photoId}/full.jpg', 'p/${photoId}/thumb.jpg',
        1920, 1080, 204800, 20480, now(), now(), 'etag', 'etag', now(), 'pass'
      );
    `);

    // Delivered tripSummary share
    const payload: TripSummarySharePayload = {
      kind: 'tripSummary',
      tripId,
      tripName: 'Magic Kingdom Trip',
      sharerDisplayName: 'Alice Sender',
      includePhotos: true,
    };

    db.public.none(`
      INSERT INTO shares (id, sender_id, payload_kind, payload_snapshot)
      VALUES ('${shareId}', '${senderId}', 'tripSummary', '${JSON.stringify(payload)}');

      INSERT INTO share_recipients (share_id, recipient_id)
      VALUES ('${shareId}', '${recipient1Id}'),
             ('${shareId}', '${recipient2Id}');
    `);

    sharingRepo = createSharingRepo(pool);
    photosRepo = createPhotosRepo(pool);
    reportsRepo = createReportsRepo(pool);
    fakeStore = new FakeObjectStore();
    photoService = new PhotoService({
      pool,
      repo: photosRepo,
      reportsRepo,
      objectStore: fakeStore,
      config: DEFAULT_CONFIG,
      targetAdapters: [new TripTarget({ pool })],
    });
  });

  function createTripShareFacts(): TripShareFacts {
    return {
      async roleOf(userId, targetTripId) {
        const res = await pool.query<{ role: TripRole }>(
          'SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
          [targetTripId, userId],
        );
        return res.rows[0]?.role ?? null;
      },
      async tripName(targetTripId) {
        const res = await pool.query<{ name: string }>(
          'SELECT name FROM trips WHERE id = $1',
          [targetTripId],
        );
        return res.rows[0]?.name ?? null;
      },
      async isMember(userId, targetTripId) {
        const res = await pool.query(
          'SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
          [targetTripId, userId],
        );
        return (res.rows?.length ?? 0) > 0;
      },
      async summary(_targetTripId) {
        return {
          tripId,
          name: 'Magic Kingdom Trip',
          startDate: '2026-10-20',
          endDate: '2026-10-25',
          distinctExperienceCount: 5,
          plannedCompletedCount: 3,
          plannedTotalCount: 8,
          superlatives: [],
          topRated: [],
          perMember: [],
        } as unknown as TripSummaryDTO;
      },
    };
  }

  function buildServerWithUser(userId: string | null): FastifyInstance {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request, reply) => {
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'No session' },
        });
      }
      (request as any).userId = userId;
    };

    const tripShareFacts = createTripShareFacts();
    const recapShareGate = new DefaultRecapShareGate({ pool, tripShareFacts });
    const recapPhotoPort: RecapPhotoPort = new DefaultRecapPhotoPort({ pool, store: fakeStore, urlTtlSeconds: 3600 });

    app.register(
      sharingRoutes({
        repo: sharingRepo,
        requireSession,
        resolveSenderDisplayName: async () => 'Alice Sender',
        tripShareFacts,
        recapShareGate,
        recapPhotoPort,
      }),
    );

    return app;
  }

  it('after a recipient calls DELETE /me/inbox/:shareId, recap read answers validation_failed, while second recipient still reads', async () => {
    const recipient1App = buildServerWithUser(recipient1Id);
    const recipient2App = buildServerWithUser(recipient2Id);

    // Initial read by recipient 1 succeeds with figures and photos
    const read1Before = await recipient1App.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(read1Before.statusCode).toBe(200);
    const recap1Before = read1Before.json() as TripRecapDTO;
    expect(recap1Before.recap?.distinctExperienceCount).toBe(5);
    expect(recap1Before.photos.access).toBe('granted');
    expect(recap1Before.photos.photos.length).toBe(1);

    // Recipient 1 calls DELETE /me/inbox/:shareId (soft delete)
    const deleteRes = await recipient1App.inject({
      method: 'DELETE',
      url: `/me/inbox/${shareId}`,
    });
    expect(deleteRes.statusCode).toBe(204);

    // Recipient 1 calls GET /me/inbox/:shareId/trip-recap: answers collapsed validation_failed (400)
    const read1After = await recipient1App.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(read1After.statusCode).toBe(400);
    const errorBody = read1After.json() as { error: { code: string; message: string } };
    expect(errorBody.error.code).toBe('validation_failed');
    // Body contains no photos, no recap figures, no URLs
    expect(read1After.body).not.toContain('"recap"');
    expect(read1After.body).not.toContain('"photos"');
    expect(read1After.body).not.toContain('http');

    // Second recipient (recipient 2) of the same share still reads it successfully
    const read2 = await recipient2App.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(read2.statusCode).toBe(200);
    const recap2 = read2.json() as TripRecapDTO;
    expect(recap2.recap?.distinctExperienceCount).toBe(5);
    expect(recap2.photos.access).toBe('granted');
    expect(recap2.photos.photos.length).toBe(1);
  });

  it('behavior check for existing mutations: sender calling open and delete changes no share_recipients row, and recipient recap read still works', async () => {
    const senderApp = buildServerWithUser(senderId);
    const recipientApp = buildServerWithUser(recipient1Id);

    // Sender calling POST /me/inbox/:shareId/open fails (sender is not a recipient)
    const openRes = await senderApp.inject({
      method: 'POST',
      url: `/me/inbox/${shareId}/open`,
    });
    expect(openRes.statusCode).toBe(400);
    expect(openRes.json().error.code).toBe('validation_failed');

    // Sender calling DELETE /me/inbox/:shareId fails (sender is not a recipient)
    const deleteRes = await senderApp.inject({
      method: 'DELETE',
      url: `/me/inbox/${shareId}`,
    });
    expect(deleteRes.statusCode).toBe(400);
    expect(deleteRes.json().error.code).toBe('validation_failed');

    // Directly verify database: share_recipients rows for recipient1 and recipient2 are unchanged
    const rowsRes = await pool.query<{
      recipient_id: string;
      opened_at: Date | null;
      recipient_deleted_at: Date | null;
    }>(
      'SELECT recipient_id, opened_at, recipient_deleted_at FROM share_recipients WHERE share_id = $1 ORDER BY recipient_id',
      [shareId],
    );
    expect(rowsRes.rows.length).toBe(2);
    for (const row of rowsRes.rows) {
      expect(row.opened_at).toBeNull();
      expect(row.recipient_deleted_at).toBeNull();
    }

    // Recipient 1's recap read still works
    const recapRes = await recipientApp.inject({
      method: 'GET',
      url: `/me/inbox/${shareId}/trip-recap`,
    });
    expect(recapRes.statusCode).toBe(200);
    const recap = recapRes.json() as TripRecapDTO;
    expect(recap.recap?.distinctExperienceCount).toBe(5);
    expect(recap.photos.access).toBe('granted');
  });

  it('route-inventory guard: Sharing plugin and photos plugin register exactly the allowlisted routes with no revoke route', async () => {
    const app = Fastify({ logger: false });
    const registeredRoutes: Array<{ method: string; url: string }> = [];

    app.addHook('onRoute', (routeOptions) => {
      // Normalize method to array of strings
      const methods = Array.isArray(routeOptions.method)
        ? routeOptions.method
        : [routeOptions.method];
      for (const m of methods) {
        if (m === 'HEAD' && routeOptions.url !== '/internal/photos/sweep/run') {
          // Fastify internal or unneeded HEAD
          continue;
        }
        registeredRoutes.push({ method: m.toUpperCase(), url: routeOptions.url });
      }
    });

    const requireSession: preHandlerHookHandler = async () => {};
    const tripShareFacts = createTripShareFacts();
    const recapShareGate = new DefaultRecapShareGate({ pool, tripShareFacts });
    const recapPhotoPort: RecapPhotoPort = new DefaultRecapPhotoPort({ pool, store: fakeStore, urlTtlSeconds: 3600 });

    // Register Sharing plugin
    await app.register(
      sharingRoutes({
        repo: sharingRepo,
        requireSession,
        resolveSenderDisplayName: async () => 'Alice',
        tripShareFacts,
        recapShareGate,
        recapPhotoPort,
      }),
    );

    // Register photos plugin routes
    await app.register(photoRoutes, { photoService, requireSession, enabled: true });
    await app.register(foodReadRoutes, { photoService, requireSession });
    await app.register(tripPhotoRoutes, { photoService, requireSession, pool });
    await app.register(sweepCronRoute, {
      sweepRunner: { tryStart: async () => ({ started: true }) } as any,
      cronSecret: 'secret',
    });

    await app.ready();

    const actual = registeredRoutes
      .map((r) => `${r.method} ${r.url}`)
      .sort();

    // Exact allowlist per Task 21.2
    const expected = [
      // Seven sharing routes
      'GET /me/inbox',
      'GET /me/inbox/unread-count',
      'POST /me/inbox/read-all',
      'GET /me/shares',
      'POST /me/shares',
      'POST /me/inbox/:shareId/open',
      'DELETE /me/inbox/:shareId',
      // Recap read route
      'GET /me/inbox/:shareId/trip-recap',
      'GET /me/inbox/:shareId/trip-recap/photos',
      // Photos routes
      'GET /photos/config',
      'POST /photos/uploads',
      'POST /photos/confirm',
      'GET /photos/:id',
      'GET /me/photos/status',
      'GET /me/photos',
      'DELETE /photos/:id',
      'POST /photos/:id/report',
      'POST /me/blocks',
      'DELETE /me/blocks/:blockId',
      'GET /me/blocks',
      'GET /food-items/:foodItemId/photos',
      'GET /experiences/:id/food-photos',
      'GET /locations/:id/food-photos',
      'GET /trips/:id/photos',
      'POST /internal/photos/sweep/run',
      'HEAD /internal/photos/sweep/run',
    ].sort();

    expect(
      actual,
      'Route inventory changed! Review whether any new route can update shares or share_recipients rows of a delivered tripSummary share',
    ).toEqual(expected);

    // Explicitly verify no route contains 'revoke', 'cancel', or 'unsend'
    for (const r of actual) {
      expect(r.toLowerCase()).not.toContain('revoke');
      expect(r.toLowerCase()).not.toContain('unsend');
      expect(r.toLowerCase()).not.toContain('cancel');
    }
  });

  it('shares table has no revoke column in database schema', async () => {
    const res = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_name = 'shares';`,
    );

    const columnNames = res.rows.map((r) => r.column_name.toLowerCase());
    expect(columnNames.length).toBeGreaterThan(0);

    for (const col of columnNames) {
      expect(col).not.toContain('revoke');
      expect(col).not.toContain('unsend');
      expect(col).not.toContain('canceled');
      expect(col).not.toContain('cancelled');
    }
  });
});
