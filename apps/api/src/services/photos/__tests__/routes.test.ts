/**
 * Route integration tests for Core Photo Routes (Task 9.1).
 *
 * Exercises:
 * - GET /photos/config
 * - POST /photos/uploads
 * - POST /photos/confirm
 * - GET /photos/:id
 * - GET /me/photos/status
 * - GET /me/photos
 * - DELETE /photos/:id
 * - POST /photos/:id/report
 * - POST /me/blocks
 * - DELETE /me/blocks/:blockId
 * - GET /me/blocks
 * - 404 on PATCH /photos/:id
 * - Rate limiting on mutations
 * - Private, no-store headers
 * - Object keys and bucket names leak prevention
 *
 * Implements: Task 9.1
 * Validates: Requirements 3.1, 3.6, 4.1, 4.3, 4.7, 4.10, 4.11, 5.8, 5.10, 5.11,
 *            9.3, 9.5, 9.8, 10.4, 10.9, 12.7, 16.1, 16.7, 17.1, 20.2
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { registerRateLimit } from '../../../plugins/rateLimit.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { createReportsRepo, type ReportsRepo } from '../reportsRepo.js';
import { PhotoService, type PhotoServiceConfig } from '../service.js';
import { photoRoutes } from '../routes.js';
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

describe('Core Photo Routes (Task 9.1)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PhotosRepo;
  let reportsRepo: ReportsRepo;
  let store: FakeObjectStore;
  let clock: FakeClock;
  let foodAdapter: FakeTargetAdapter;

  let user1Id: string;
  let user2Id: string;
  let foodItem1Id: string;
  let log1Id: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');

    user1Id = randomUUID();
    user2Id = randomUUID();
    foodItem1Id = randomUUID();
    log1Id = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${user1Id}', 'u1@example.com', 'hash'),
             ('${user2Id}', 'u2@example.com', 'hash');

      INSERT INTO profiles (user_id, display_name, avatar_preset)
      VALUES ('${user1Id}', 'Alice', 'castle'),
             ('${user2Id}', 'Bob', 'wishing-star');

      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${randomUUID()}', 'exp-1', 'Restaurant', 'Magic Kingdom', 'Restaurant');

      INSERT INTO food_items (id, name, experience_id)
      VALUES ('${foodItem1Id}', 'Dole Whip', (SELECT id FROM experiences LIMIT 1));

      INSERT INTO food_item_logs (id, user_id, food_item_id, user_tz, visited_on)
      VALUES ('${log1Id}', '${user1Id}', '${foodItem1Id}', 'America/New_York', '2026-10-18');
    `);

    repo = createPhotosRepo(pool);
    reportsRepo = createReportsRepo(pool);
    store = new FakeObjectStore();
    clock = new FakeClock(new Date('2026-10-18T12:00:00Z'));

    foodAdapter = new FakeTargetAdapter('food_log', 'harm_and_vision', 4);
    foodAdapter.authorizeFn = async (uid, tid) => {
      if (uid === user1Id && tid === log1Id) {
        return { scopeId: foodItem1Id };
      }
      throw new Error('food_log_not_found');
    };
  });

  function createTestServer(options: {
    config?: Partial<PhotoServiceConfig>;
    currentUserId?: string | null;
    rateLimitMutations?: number;
    enabledOverride?: boolean;
  } = {}): {
    app: FastifyInstance;
    service: PhotoService;
    setUserId: (id: string | null) => void;
  } {
    let activeUserId = options.currentUserId !== undefined ? options.currentUserId : user1Id;

    const fullConfig: PhotoServiceConfig = {
      ...DEFAULT_CONFIG,
      ...options.config,
    };

    const service = new PhotoService({
      pool,
      repo,
      reportsRepo,
      objectStore: store,
      targetAdapters: [foodAdapter],
      config: fullConfig,
      clock,
    });

    const requireSession: preHandlerHookHandler = async (request, reply) => {
      const auth = request.headers.authorization;
      if (!auth || activeUserId === null) {
        await reply.code(401).send({ error: { code: 'unauthorized', message: 'No session.' } });
        return;
      }
      request.userId = activeUserId;
    };

    const app = fastify({ logger: false });
    registerErrorHandler(app);

    if (options.rateLimitMutations !== undefined) {
      registerRateLimit(app, {
        reads: { max: 1000, timeWindowMs: 60000 },
        mutations: { max: options.rateLimitMutations, timeWindowMs: 60000 },
      });
    }

    void app.register(photoRoutes, {
      photoService: service,
      requireSession,
      ...(options.enabledOverride !== undefined ? { enabled: options.enabledOverride } : {}),
    });

    return {
      app,
      service,
      setUserId: (id: string | null) => {
        activeUserId = id;
      },
    };
  }

  it('unauthenticated requests return 401 across all protected routes', async () => {
    const { app } = createTestServer({ currentUserId: null });
    await app.ready();

    const routesToTest = [
      { method: 'GET', url: '/photos/config' },
      { method: 'POST', url: '/photos/uploads', payload: {} },
      { method: 'POST', url: '/photos/confirm', payload: {} },
      { method: 'GET', url: `/photos/${randomUUID()}` },
      { method: 'GET', url: `/me/photos/status?ids=${randomUUID()}` },
      { method: 'GET', url: `/me/photos?targetKind=food_log&scopeId=${randomUUID()}` },
      { method: 'DELETE', url: `/photos/${randomUUID()}` },
      { method: 'POST', url: `/photos/${randomUUID()}/report`, payload: { reason: 'spam' } },
      { method: 'POST', url: '/me/blocks', payload: { userId: randomUUID() } },
      { method: 'DELETE', url: `/me/blocks/${randomUUID()}` },
      { method: 'GET', url: '/me/blocks' },
    ];

    for (const r of routesToTest) {
      const res = await app.inject({
        method: r.method as any,
        url: r.url,
        ...(r.payload ? { payload: r.payload } : {}),
      });
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('unauthorized');
    }
  });

  it('GET /photos/config returns PhotoClientConfigDTO and remains accessible when disabled', async () => {
    // 1. Enabled
    const { app: appEnabled } = createTestServer();
    await appEnabled.ready();
    const res1 = await appEnabled.inject({
      method: 'GET',
      url: '/photos/config',
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.enabled).toBe(true);
    expect(body1.foodEnabled).toBe(true);
    expect(body1.dailyCap).toBe(20);
    expect(body1.remainingToday).toBe(20);
    expect(body1.experienceStripMax).toBe(8);
    expect(res1.headers['cache-control']).toBe('private, no-store');

    // 2. Disabled
    const { app: appDisabled } = createTestServer({ config: { enabled: false } });
    await appDisabled.ready();
    const res2 = await appDisabled.inject({
      method: 'GET',
      url: '/photos/config',
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.enabled).toBe(false);
    expect(body2.remainingToday).toBe(0);

    // 3. When disabled, other photo routes are NOT registered (404)
    const res3 = await appDisabled.inject({
      method: 'POST',
      url: '/photos/uploads',
      headers: { authorization: 'Bearer session-token' },
      payload: {},
    });
    expect(res3.statusCode).toBe(404);
  });

  it('POST /photos/uploads creates uploading rows, returns presigned u/ URLs, and does not leak bucket or object keys', async () => {
    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/photos/uploads',
      headers: { authorization: 'Bearer session-token' },
      payload: {
        target: { kind: 'food_log', id: log1Id },
        items: [
          {
            contentType: 'image/jpeg',
            byteSize: 50000,
            thumbByteSize: 5000,
            width: 1024,
            height: 768,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const body = res.json();
    expect(body.slots).toHaveLength(1);
    const slot = body.slots[0];
    expect(slot.photoId).toBeDefined();
    // PUT URLs point at u/ prefix
    expect(slot.putUrl).toContain(`u/${slot.photoId}/full.jpg`);
    expect(slot.thumbPutUrl).toContain(`u/${slot.photoId}/thumb.jpg`);

    // Verify raw body contains no bucket name or leaked key strings
    const rawBody = res.body;
    expect(rawBody).not.toContain('test-bucket');
  });

  it('Kill switch and per-kind kill switch reject upload initiation with photo_uploads_disabled', async () => {
    // Overall kill switch off
    const { app: appOff } = createTestServer({ config: { enabled: false }, enabledOverride: true });
    await appOff.ready();
    const resOff = await appOff.inject({
      method: 'POST',
      url: '/photos/uploads',
      headers: { authorization: 'Bearer session-token' },
      payload: {
        target: { kind: 'food_log', id: log1Id },
        items: [
          {
            contentType: 'image/jpeg',
            byteSize: 50000,
            thumbByteSize: 5000,
            width: 800,
            height: 600,
          },
        ],
      },
    });
    expect(resOff.statusCode).toBe(503);
    expect(resOff.json().error.code).toBe('photo_uploads_disabled');
    expect(resOff.json().error.details.reason).toBe('kill_switch');

    // Food kill switch off
    const { app: appFoodOff } = createTestServer({ config: { foodEnabled: false } });
    await appFoodOff.ready();
    const resFoodOff = await appFoodOff.inject({
      method: 'POST',
      url: '/photos/uploads',
      headers: { authorization: 'Bearer session-token' },
      payload: {
        target: { kind: 'food_log', id: log1Id },
        items: [
          {
            contentType: 'image/jpeg',
            byteSize: 50000,
            thumbByteSize: 5000,
            width: 800,
            height: 600,
          },
        ],
      },
    });
    expect(resFoodOff.statusCode).toBe(503);
    expect(resFoodOff.json().error.code).toBe('photo_uploads_disabled');
    expect(resFoodOff.json().error.details.reason).toBe('kill_switch');
  });

  it('Banned user is refused with photo_uploads_banned', async () => {
    await reportsRepo.addBan(user1Id);
    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/photos/uploads',
      headers: { authorization: 'Bearer session-token' },
      payload: {
        target: { kind: 'food_log', id: log1Id },
        items: [
          {
            contentType: 'image/jpeg',
            byteSize: 1000,
            thumbByteSize: 100,
            width: 800,
            height: 600,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('photo_uploads_banned');
  });

  it('Global daily cap reached returns photo_uploads_disabled with reason global_cap and 503', async () => {
    const { app } = createTestServer({ config: { globalDailyCap: 1 } });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/photos/uploads',
      headers: { authorization: 'Bearer session-token' },
      payload: {
        target: { kind: 'food_log', id: log1Id },
        items: [
          {
            contentType: 'image/jpeg',
            byteSize: 1000,
            thumbByteSize: 100,
            width: 800,
            height: 600,
          },
          {
            contentType: 'image/jpeg',
            byteSize: 1000,
            thumbByteSize: 100,
            width: 800,
            height: 600,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('photo_uploads_disabled');
    expect(res.json().error.details.reason).toBe('global_cap');
  });

  it('POST /photos/confirm returns 202 with PhotoConfirmResponseDTO', async () => {
    const { app, service } = createTestServer();
    await app.ready();

    // 1. Initiate upload
    const initRes = await service.initiate(user1Id, {
      target: { kind: 'food_log', id: log1Id },
      items: [
        {
          contentType: 'image/jpeg',
          byteSize: 50000,
          thumbByteSize: 5000,
          width: 800,
          height: 600,
        },
      ],
    });
    const photoId = initRes.slots[0]!.photoId;
    const keys = photoKeys(photoId);

    // Place objects in store
    store.put(keys.uploadFull, new Uint8Array([1, 2, 3]));
    store.put(keys.uploadThumb, new Uint8Array([1, 2, 3]));

    // 2. Confirm
    const res = await app.inject({
      method: 'POST',
      url: '/photos/confirm',
      headers: { authorization: 'Bearer session-token' },
      payload: { photoIds: [photoId] },
    });

    expect(res.statusCode).toBe(202);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const body = res.json();
    expect(body.results).toEqual([{ photoId, result: 'accepted' }]);
  });

  it('GET /photos/:id and GET /me/photos/status?ids= return MyPhotoDTO and batch status', async () => {
    const { app, service } = createTestServer();
    await app.ready();

    const initRes = await service.initiate(user1Id, {
      target: { kind: 'food_log', id: log1Id },
      items: [
        {
          contentType: 'image/jpeg',
          byteSize: 50000,
          thumbByteSize: 5000,
          width: 800,
          height: 600,
        },
      ],
    });
    const photoId = initRes.slots[0]!.photoId;

    // Single status
    const resSingle = await app.inject({
      method: 'GET',
      url: `/photos/${photoId}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resSingle.statusCode).toBe(200);
    expect(resSingle.headers['cache-control']).toBe('private, no-store');
    expect(resSingle.json().id).toBe(photoId);
    expect(resSingle.json().status).toBe('uploading');

    // Batch status
    const resBatch = await app.inject({
      method: 'GET',
      url: `/me/photos/status?ids=${photoId},${randomUUID()}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resBatch.statusCode).toBe(200);
    expect(resBatch.headers['cache-control']).toBe('private, no-store');
    const batchBody = resBatch.json();
    // Only returns the owned photo
    expect(batchBody.photos).toHaveLength(1);
    expect(batchBody.photos[0].id).toBe(photoId);

    // 11 IDs rejected with validation_failed
    const elevenIds = Array.from({ length: 11 }, () => randomUUID()).join(',');
    const res11 = await app.inject({
      method: 'GET',
      url: `/me/photos/status?ids=${elevenIds}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res11.statusCode).toBe(400);
    expect(res11.json().error.code).toBe('validation_failed');
  });

  it('owner DTO for an approved photo presigns p/ serving keys derived from the id (row still holds u/ keys)', async () => {
    const { app, service } = createTestServer();
    await app.ready();

    const initRes = await service.initiate(user1Id, {
      target: { kind: 'food_log', id: log1Id },
      items: [{ contentType: 'image/jpeg', byteSize: 50000, thumbByteSize: 5000, width: 800, height: 600 }],
    });
    const photoId = initRes.slots[0]!.photoId;
    const keys = photoKeys(photoId);

    await repo.recordConfirm(photoId, { fullEtag: 'f', thumbEtag: 't' });
    await repo.markApproved({ id: photoId, harmVerdict: 'pass', visionVerdict: 'pass' });
    // Production state after approval: serving objects exist, upload objects are deleted.
    store.put(keys.full, new Uint8Array([1]));
    store.put(keys.thumb, new Uint8Array([2]));

    const row = await repo.getById(photoId);
    expect(row?.object_key).toBe(keys.uploadFull);
    expect(row?.thumb_key).toBe(keys.uploadThumb);

    const res = await app.inject({
      method: 'GET',
      url: `/photos/${photoId}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(res.statusCode).toBe(200);
    const dto = res.json();
    expect(dto.status).toBe('approved');
    expect(FakeObjectStore.keyFromUrl(dto.url)).toBe(keys.full);
    expect(FakeObjectStore.keyFromUrl(dto.thumbUrl)).toBe(keys.thumb);
    expect(store.missingGetKeys()).toEqual([]);
  });

  it('GET /me/photos validates queries and paginates caller photos', async () => {
    const { app } = createTestServer();
    await app.ready();

    // Missing scopeId -> validation_failed
    const resBad = await app.inject({
      method: 'GET',
      url: '/me/photos?targetKind=food_log',
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resBad.statusCode).toBe(400);
    expect(resBad.json().error.code).toBe('validation_failed');

    // Valid query
    const resOk = await app.inject({
      method: 'GET',
      url: `/me/photos?targetKind=food_log&scopeId=${foodItem1Id}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resOk.statusCode).toBe(200);
    expect(resOk.headers['cache-control']).toBe('private, no-store');
    expect(resOk.json().items).toBeInstanceOf(Array);
  });

  it('DELETE /photos/:id soft deletes own photo; stranger returns photo_not_found', async () => {
    const { app, service, setUserId } = createTestServer();
    await app.ready();

    const initRes = await service.initiate(user1Id, {
      target: { kind: 'food_log', id: log1Id },
      items: [
        {
          contentType: 'image/jpeg',
          byteSize: 50000,
          thumbByteSize: 5000,
          width: 800,
          height: 600,
        },
      ],
    });
    const photoId = initRes.slots[0]!.photoId;

    // Stranger cannot delete -> photo_not_found
    setUserId(user2Id);
    const resForeign = await app.inject({
      method: 'DELETE',
      url: `/photos/${photoId}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resForeign.statusCode).toBe(404);
    expect(resForeign.json().error.code).toBe('photo_not_found');

    // Owner deletes -> 204
    setUserId(user1Id);
    const resOwner = await app.inject({
      method: 'DELETE',
      url: `/photos/${photoId}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resOwner.statusCode).toBe(204);

    // Now photo is deleted
    const resCheck = await app.inject({
      method: 'GET',
      url: `/photos/${photoId}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resCheck.statusCode).toBe(404);
  });

  it('PATCH /photos/:id is not registered (returns 404)', async () => {
    const { app } = createTestServer();
    await app.ready();

    const res = await app.inject({
      method: 'PATCH',
      url: `/photos/${randomUUID()}`,
      headers: { authorization: 'Bearer session-token' },
      payload: { visibility: 'public' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('Block routes: POST /me/blocks, DELETE /me/blocks/:blockId, and GET /me/blocks', async () => {
    const { app, setUserId } = createTestServer();
    await app.ready();

    // Seed approved photo for user2
    const photo2Id = randomUUID();
    const keys2 = photoKeys(photo2Id);
    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height,
        status, created_at, sort_at, full_etag, thumb_etag
      ) VALUES (
        '${photo2Id}', '${user2Id}', 'food_log', '${randomUUID()}', '${foodItem1Id}',
        '${keys2.full}', '${keys2.thumb}', 1000, 100, 800, 600,
        'approved', now(), now(), '"e1"', '"e2"'
      );
    `);

    // 1. Both keys or neither -> validation_failed
    const resBad1 = await app.inject({
      method: 'POST',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
      payload: { userId: user2Id, photoId: photo2Id },
    });
    expect(resBad1.statusCode).toBe(400);
    expect(resBad1.json().error.code).toBe('validation_failed');

    const resBad2 = await app.inject({
      method: 'POST',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
      payload: {},
    });
    expect(resBad2.statusCode).toBe(400);
    expect(resBad2.json().error.code).toBe('validation_failed');

    // 2. Self-owned photo -> validation_failed
    // (create approved photo for user1)
    const photo1Id = randomUUID();
    const keys1 = photoKeys(photo1Id);
    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height,
        status, created_at, sort_at, full_etag, thumb_etag
      ) VALUES (
        '${photo1Id}', '${user1Id}', 'food_log', '${randomUUID()}', '${foodItem1Id}',
        '${keys1.full}', '${keys1.thumb}', 1000, 100, 800, 600,
        'approved', now(), now(), '"e1"', '"e2"'
      );
    `);
    const resSelf = await app.inject({
      method: 'POST',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
      payload: { photoId: photo1Id },
    });
    expect(resSelf.statusCode).toBe(400);
    expect(resSelf.json().error.code).toBe('validation_failed');

    // 3. Invisible photo -> photo_not_found
    const resInvisible = await app.inject({
      method: 'POST',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
      payload: { photoId: randomUUID() },
    });
    expect(resInvisible.statusCode).toBe(404);
    expect(resInvisible.json().error.code).toBe('photo_not_found');

    // 4. Successful block via photoId -> returns BlockedUserDTO with blockId, no userId, null name for stranger
    const resBlock = await app.inject({
      method: 'POST',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
      payload: { photoId: photo2Id },
    });
    expect(resBlock.statusCode).toBe(201);
    const blockBody = resBlock.json();
    expect(blockBody.blockId).toBeDefined();
    expect(blockBody.userId).toBeUndefined();
    expect(blockBody.displayName).toBeNull(); // stranger

    // 5. GET /me/blocks lists the block
    const resList = await app.inject({
      method: 'GET',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resList.statusCode).toBe(200);
    const listBody = resList.json();
    expect(listBody).toHaveLength(1);
    expect(listBody[0].blockId).toBe(blockBody.blockId);
    expect(listBody[0].displayName).toBeNull();

    // 6. DELETE /me/blocks/:blockId by another user deletes nothing
    setUserId(user2Id);
    const resDelOther = await app.inject({
      method: 'DELETE',
      url: `/me/blocks/${blockBody.blockId}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resDelOther.statusCode).toBe(204);

    setUserId(user1Id);
    const resListStill = await app.inject({
      method: 'GET',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resListStill.json()).toHaveLength(1);

    // 7. Blocker deletes own block -> 204 and block list is empty
    const resDelOwn = await app.inject({
      method: 'DELETE',
      url: `/me/blocks/${blockBody.blockId}`,
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resDelOwn.statusCode).toBe(204);

    const resListEmpty = await app.inject({
      method: 'GET',
      url: '/me/blocks',
      headers: { authorization: 'Bearer session-token' },
    });
    expect(resListEmpty.json()).toHaveLength(0);
  });

  it('Rate limit: mutation budget exhaustion returns rate_limit_exceeded (Requirement 16.7)', async () => {
    // Test server with mutation rate limit of 1
    const { app } = createTestServer({ rateLimitMutations: 1 });
    await app.ready();

    // First mutation succeeds (or fails with domain error, but consumes budget)
    const res1 = await app.inject({
      method: 'POST',
      url: `/photos/${randomUUID()}/report`,
      headers: { authorization: 'Bearer session-token' },
      payload: { reason: 'spam' },
    });
    expect(res1.statusCode).toBe(404); // domain 404 (photo not found), but rate limit tracked

    // Second mutation trips the limit -> 429 rate_limit_exceeded
    const res2 = await app.inject({
      method: 'POST',
      url: `/photos/${randomUUID()}/report`,
      headers: { authorization: 'Bearer session-token' },
      payload: { reason: 'spam' },
    });
    expect(res2.statusCode).toBe(429);
    expect(res2.json().error.code).toBe('rate_limit_exceeded');
  });
});
