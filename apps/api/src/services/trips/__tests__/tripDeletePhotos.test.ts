/**
 * Trip delete photo lifecycle integration tests (Task 19.3).
 *
 * Validates: Requirements 12.9, 19.4; Property 16.
 *
 * Exercises:
 * - DELETE /trips/:id calls photoLifecycle.softDeleteForTarget('trip', id) first.
 * - Deleting a trip sets its photos 'deleted' immediately when photoLifecycle is wired.
 * - When photoLifecycle is absent, the reaper/sweep step still finds and marks
 *   orphaned trip photos as deleted (Property 16 integration).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { createPhotosRepo, type PhotosRepo } from '../../photos/repo.js';
import { createReportsRepo } from '../../photos/reportsRepo.js';
import { PhotoService, type PhotoServiceConfig } from '../../photos/service.js';
import { TripTarget } from '../../photos/targets/tripTarget.js';
import { ModerationRunner } from '../../photos/moderationRunner.js';
import { sweep } from '../../photos/sweep.js';
import { FakeClock, FakeHarmModerator, FakeObjectStore, FakeVisionChecker } from '../../photos/__tests__/fakes.js';
import { createTripRepo, type TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

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

describe('Trip delete photo lifecycle hook (Task 19.3)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let tripRepo: TripRepo;
  let photosRepo: PhotosRepo;
  let store: FakeObjectStore;
  let clock: FakeClock;
  let tripTarget: TripTarget;
  let photoService: PhotoService;

  let organizerId: string;
  let tripId: string;
  let photoId: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');
    applyMigration(db, '0064_account_deletion.sql');

    organizerId = randomUUID();
    tripId = randomUUID();
    photoId = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${organizerId}', 'org@example.com', 'hash');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${organizerId}', 'Organizer User', 'castle');

      INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
      VALUES ('${tripId}', '${organizerId}', 'Family Vacation', 'Trip notes', '2026-10-20', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role)
      VALUES ('${tripId}', '${organizerId}', 'organizer');
    `);

    tripRepo = createTripRepo(pool, {
      completions: {
        async listCompletionsForUser() { return []; },
        async markCompleted() { return { id: randomUUID(), userId: organizerId, experienceId: randomUUID(), completedAt: new Date() } as any; },
        async unmarkCompleted() { return true; },
      } as any,
      ratings: {
        async listRatingsForUser() { return []; },
        async setRating() { return { id: randomUUID(), userId: organizerId, experienceId: randomUUID(), rating: 5, ratedAt: new Date() } as any; },
        async clearRating() { return true; },
      } as any,
    });

    photosRepo = createPhotosRepo(pool);
    const reportsRepo = createReportsRepo(pool);
    store = new FakeObjectStore();
    clock = new FakeClock(new Date('2026-10-20T12:00:00Z'));
    tripTarget = new TripTarget({ pool, maxPerTrip: 300, tripEnabled: true });

    photoService = new PhotoService({
      pool,
      repo: photosRepo,
      reportsRepo,
      objectStore: store,
      targetAdapters: [tripTarget],
      clock,
      config: DEFAULT_CONFIG,
    });

    // Seed a photo for the trip
    db.public.none(`
      INSERT INTO photos (
        id, target_kind, target_id, scope_id, owner_id,
        status, object_key, thumb_key, width, height, byte_size, thumb_byte_size,
        sort_at, created_at, full_etag, thumb_etag, served_at, harm_verdict
      ) VALUES (
        '${photoId}', 'trip', '${tripId}', '${tripId}', '${organizerId}',
        'approved', 'p/${photoId}/full.jpg', 'p/${photoId}/thumb.jpg',
        1920, 1080, 204800, 20480, now(), now(), 'etag-full', 'etag-thumb', now(), 'pass'
      );
    `);
  });

  function buildTestServer(withHook: boolean): FastifyInstance {
    const app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (req) => {
      req.userId = organizerId;
    };

    const plugin = tripRoutes({
      repo: tripRepo,
      pool,
      requireSession,
      ...(withHook ? { photoLifecycle: photoService } : {}),
    });

    void app.register(plugin);
    return app;
  }

  it('deleting a trip with photoLifecycle wired sets its photos deleted immediately (Requirement 12.9)', async () => {
    const server = buildTestServer(true);

    const res = await server.inject({
      method: 'DELETE',
      url: `/trips/${tripId}`,
    });
    expect(res.statusCode).toBe(204);

    // Verify trip is deleted
    const tripCheck = await pool.query('SELECT id FROM trips WHERE id = $1', [tripId]);
    expect(tripCheck.rows.length).toBe(0);

    // Verify photo is marked deleted immediately
    const photoRow = await photosRepo.getById(photoId);
    expect(photoRow).not.toBeNull();
    expect(photoRow?.status).toBe('deleted');
    expect(photoRow?.deleted_at).not.toBeNull();
  });

  it('when photoLifecycle is absent, deleting a trip leaves photos to be reaped on next sweep (Property 16 integration)', async () => {
    const server = buildTestServer(false);

    const res = await server.inject({
      method: 'DELETE',
      url: `/trips/${tripId}`,
    });
    expect(res.statusCode).toBe(204);

    // Trip is deleted
    const tripCheck = await pool.query('SELECT id FROM trips WHERE id = $1', [tripId]);
    expect(tripCheck.rows.length).toBe(0);

    // Immediately after DELETE, without hook, photo is still approved in DB
    const photoBeforeSweep = await photosRepo.getById(photoId);
    expect(photoBeforeSweep?.status).toBe('approved');

    // Run sweep with trip target adapter
    const harm = new FakeHarmModerator();
    const vision = new FakeVisionChecker();
    const runner = new ModerationRunner({
      repo: photosRepo,
      objectStore: store,
      harmModerator: harm,
      visionChecker: vision,
      targetAdapters: [tripTarget],
      clock,
    });

    const sweepResult = await sweep({
      repo: photosRepo,
      objectStore: store,
      runner,
      targetAdapters: [tripTarget],
      clock,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    // The orphan reaper step in sweep reaps the photo whose trip no longer exists,
    // and subsequent step 6 hard-deletes it after cleaning objects (Property 16).
    expect(sweepResult.reapedOrphans).toBe(1);
    expect(sweepResult.deletedRows).toBe(1);

    const photoAfterSweep = await photosRepo.getById(photoId);
    expect(photoAfterSweep).toBeNull();
  });
});
