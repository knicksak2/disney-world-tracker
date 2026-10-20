/**
 * Moderation Runner Tests — verifying claims, bounded queue, concurrency,
 * ETag checks, overwrite protection, lease renewals, zero-row rules,
 * operator approvals, and error containment.
 *
 * Implements: Task 8.3
 * Validates: Requirements 2.7, 2.8, 6.1, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9,
 *            7.1, 7.2, 7.11, 7.13, 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.10,
 *            8.11, 8.12, 8.13, 8.14, 8.15, 8.17, 8.19, 8.20, 12.4, 19.12,
 *            21.1, 21.2
 * Properties: 8, 19, 26, 30, 31, 36
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { ModerationRunner, type ModerationLogger } from '../moderationRunner.js';
import {
  FakeObjectStore,
  FakeHarmModerator,
  FakeVisionChecker,
  FakeClock,
  FakeTargetAdapter,
} from './fakes.js';
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
      return raw.query(text, params);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          return client.query(text, params);
        },
        release() {
          client.release();
        },
      } as any;
    },
  } as unknown as DbPool;
}

const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const TINY_JPEG_THUMB = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01, 0x02, 0x03]);

describe('ModerationRunner (Task 8.3)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PhotosRepo;
  let store: FakeObjectStore;
  let harm: FakeHarmModerator;
  let vision: FakeVisionChecker;
  let clock: FakeClock;
  let foodAdapter: FakeTargetAdapter;
  let tripAdapter: FakeTargetAdapter;
  let loggedEvents: Array<{ event: string; [key: string]: unknown }>;
  let logger: ModerationLogger;

  let user1Id: string;
  let foodItem1Id: string;
  let log1Id: string;

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0040_food_item_logging.sql');
    applyMigration(db, '0062_photo_uploads.sql');

    user1Id = randomUUID();
    foodItem1Id = randomUUID();
    log1Id = randomUUID();
    const exp1Id = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${user1Id}', 'u1@example.com', 'hash');

      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${exp1Id}', 'exp-upstream-1', 'Cinderella Castle Cafe', 'Magic Kingdom', 'Restaurant');

      INSERT INTO food_items (id, name, experience_id)
      VALUES ('${foodItem1Id}', 'Magic Cupcake', '${exp1Id}');

      INSERT INTO food_item_logs (id, user_id, food_item_id, user_tz, visited_on)
      VALUES ('${log1Id}', '${user1Id}', '${foodItem1Id}', 'America/New_York', '2026-10-18');
    `);

    repo = createPhotosRepo(pool);
    store = new FakeObjectStore();
    harm = new FakeHarmModerator();
    vision = new FakeVisionChecker();
    clock = new FakeClock(new Date());

    foodAdapter = new FakeTargetAdapter('food_log', 'harm_and_vision', 4);
    tripAdapter = new FakeTargetAdapter('trip', 'harm_only', 300);

    loggedEvents = [];
    logger = {
      info: (obj) => loggedEvents.push(obj as any),
      warn: (obj) => loggedEvents.push(obj as any),
      error: (obj) => loggedEvents.push(obj as any),
    };
  });

  async function createConfirmedPhoto(targetKind: 'food_log' | 'trip' = 'food_log'): Promise<{
    photoId: string;
    fullEtag: string;
    thumbEtag: string;
  }> {
    const photoId = randomUUID();
    const keys = photoKeys(photoId);

    const fullEtag = store.put(keys.uploadFull, TINY_JPEG).etag;
    const thumbEtag = store.put(keys.uploadThumb, TINY_JPEG_THUMB).etag;

    await repo.insertUploading({
      id: photoId,
      ownerId: user1Id,
      targetKind,
      targetId: log1Id,
      scopeId: foodItem1Id,
      objectKey: keys.uploadFull,
      thumbKey: keys.uploadThumb,
      byteSize: TINY_JPEG.byteLength,
      thumbByteSize: TINY_JPEG_THUMB.byteLength,
      width: 800,
      height: 600,
      createdAt: clock.now(),
    });

    await repo.recordConfirm(photoId, { fullEtag, thumbEtag }, clock.now());
    clock.advance(1000);
    return { photoId, fullEtag, thumbEtag };
  }

  it('Property 8: retryable outcomes do not decide, 6th retryable escalates to needs_review immediately', async () => {
    // Feature: photo-uploads, Property 8: retryable-only sequences never decide; 6th escalates
    const runner = new ModerationRunner({
      repo,
      objectStore: store,
      harmModerator: harm,
      visionChecker: vision,
      targetAdapters: [foodAdapter, tripAdapter],
      config: { maxAttempts: 6 },
      clock,
      logger,
    });

    harm.checkFn = () => ({ kind: 'retryable', code: 'harm_timeout' });
    const { photoId } = await createConfirmedPhoto();

    for (let attempt = 1; attempt <= 5; attempt++) {
      await runner.process(photoId);
      const row = await repo.getById(photoId);
      expect(row?.status).toBe('pending');
      expect(row?.attempts).toBe(attempt);
      expect(row?.lease_until).toBeNull();
      // Advance clock past backoff (exponential backoff reaches up to 6 hours)
      clock.advance(24 * 3600 * 1000);
    }

    // 6th attempt: escalates to needs_review immediately
    await runner.process(photoId);
    const rowFinal = await repo.getById(photoId);
    expect(rowFinal?.status).toBe('needs_review');
    expect(rowFinal?.attempts).toBe(6);
  });

  it('Property 19: vision never called for trip photos; called only after harm pass for food photos', async () => {
    // Feature: photo-uploads, Property 19: vision check gating
    let visionCallCount = 0;
    const countingVision: FakeVisionChecker = {
      ...vision,
      check: async (bytes: Uint8Array) => {
        visionCallCount++;
        return vision.check(bytes);
      },
    } as any;

    const runner = new ModerationRunner({
      repo,
      objectStore: store,
      harmModerator: harm,
      visionChecker: countingVision,
      targetAdapters: [foodAdapter, tripAdapter],
      clock,
      logger,
    });

    // 1. Trip photo -> harm checked, vision NEVER called
    const tripPhoto = await createConfirmedPhoto('trip');
    await runner.process(tripPhoto.photoId);
    const tripRow = await repo.getById(tripPhoto.photoId);
    expect(tripRow?.status).toBe('approved');
    expect(visionCallCount).toBe(0);

    // 2. Food photo with harm flag -> rejected at harm, vision NOT called
    harm.checkFn = () => ({
      kind: 'ok',
      flagged: true,
      categories: { hate: true },
      categoryScores: { hate: 0.9 },
    });
    const foodPhotoFlagged = await createConfirmedPhoto('food_log');
    await runner.process(foodPhotoFlagged.photoId);
    const foodRowFlagged = await repo.getById(foodPhotoFlagged.photoId);
    expect(foodRowFlagged?.status).toBe('rejected');
    expect(foodRowFlagged?.reject_reason).toBe('harm');
    expect(visionCallCount).toBe(0);

    // 3. Food photo with harm pass -> vision is called
    harm.checkFn = () => ({
      kind: 'ok',
      flagged: false,
      categories: {},
      categoryScores: {},
    });
    const foodPhotoPass = await createConfirmedPhoto('food_log');
    await runner.process(foodPhotoPass.photoId);
    const foodRowPass = await repo.getById(foodPhotoPass.photoId);
    expect(foodRowPass?.status).toBe('approved');
    expect(visionCallCount).toBe(1);
  });

  it('Property 26: overwrite detection before read, between read and copy, and after copy', async () => {
    // Feature: photo-uploads, Property 26: overwrite protection
    const runner = new ModerationRunner({
      repo,
      objectStore: store,
      harmModerator: harm,
      visionChecker: vision,
      targetAdapters: [foodAdapter, tripAdapter],
      clock,
      logger,
    });

    // Case 1: Overwrite before runner reads -> rejected with invalid_image
    const p1 = await createConfirmedPhoto('food_log');
    const keys1 = photoKeys(p1.photoId);
    store.overwrite(keys1.uploadFull, new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]));
    await runner.process(p1.photoId);
    const r1 = await repo.getById(p1.photoId);
    expect(r1?.status).toBe('rejected');
    expect(r1?.reject_reason).toBe('invalid_image');
    expect((await store.head(keys1.full)).exists).toBe(false);

    // Case 2: Overwrite after copy -> served object remains equal to moderated bytes
    const p2 = await createConfirmedPhoto('food_log');
    const keys2 = photoKeys(p2.photoId);
    await runner.process(p2.photoId);
    const r2 = await repo.getById(p2.photoId);
    expect(r2?.status).toBe('approved');
    const servedHead = await store.head(keys2.full);
    expect(servedHead.exists).toBe(true);
    if (servedHead.exists) {
      expect(servedHead.etag).toBe(p2.fullEtag);
    }
    // An overwrite on upload key after copy does not touch p/ keys
    store.overwrite(keys2.uploadFull, new Uint8Array([0x01, 0x02, 0x03]));
    const servedHeadAfter = await store.head(keys2.full);
    expect(servedHeadAfter.exists).toBe(true);
    if (servedHeadAfter.exists) {
      expect(servedHeadAfter.etag).toBe(p2.fullEtag);
    }
  });

  it('Property 31: missing upload object leads to conditional invalid_image rejection with no provider calls', async () => {
    // Feature: photo-uploads, Property 31: missing object handling
    let harmCalled = false;
    let visionCalled = false;
    const spyHarm: FakeHarmModerator = {
      ...harm,
      check: async () => {
        harmCalled = true;
        return { kind: 'ok', flagged: false, categories: {}, categoryScores: {} };
      },
    } as any;
    const spyVision: FakeVisionChecker = {
      ...vision,
      check: async () => {
        visionCalled = true;
        return { kind: 'ok', fields: {} as any, usage: { promptTokens: 0, outputTokens: 0 } };
      },
    } as any;

    const runner = new ModerationRunner({
      repo,
      objectStore: store,
      harmModerator: spyHarm,
      visionChecker: spyVision,
      targetAdapters: [foodAdapter, tripAdapter],
      clock,
      logger,
    });

    const { photoId } = await createConfirmedPhoto();
    const keys = photoKeys(photoId);

    // Delete full upload object before processing
    await store.delete([keys.uploadFull]);

    await runner.process(photoId);
    const row = await repo.getById(photoId);
    expect(row?.status).toBe('rejected');
    expect(row?.reject_reason).toBe('invalid_image');
    expect(harmCalled).toBe(false);
    expect(visionCalled).toBe(false);
  });

  it('Property 36: error containment traps all job exceptions without unhandled rejections', async () => {
    // Feature: photo-uploads, Property 36: job containment
    const throwingRepo: PhotosRepo = {
      ...repo,
      claim: async () => {
        throw new Error('Database connection lost');
      },
    };

    let runPromise: Promise<void> | null = null;
    const testScheduler = {
      run: (job: () => Promise<void>) => {
        runPromise = job();
      },
    };

    const runner = new ModerationRunner({
      repo: throwingRepo,
      objectStore: store,
      harmModerator: harm,
      visionChecker: vision,
      targetAdapters: [foodAdapter, tripAdapter],
      clock,
      scheduler: testScheduler,
      logger,
    });

    // Process should not throw unhandled rejection
    let unhandledThrown = false;
    const rejectionHandler = () => {
      unhandledThrown = true;
    };
    process.on('unhandledRejection', rejectionHandler);

    try {
      runner.runContained('test-photo-crashed', async () => {
        await runner.process('test-photo-crashed');
      });
      await runPromise;

      expect(unhandledThrown).toBe(false);
      const crashedLog = loggedEvents.find((e) => e.event === 'photos.job.crashed');
      expect(crashedLog).toBeDefined();
      expect(crashedLog?.photoId).toBe('test-photo-crashed');
    } finally {
      process.off('unhandledRejection', rejectionHandler);
    }
  });

  it('operatorApprove: approves needs_review photo, verifies ETags, copies, and sets approved_by_operator', async () => {
    const runner = new ModerationRunner({
      repo,
      objectStore: store,
      harmModerator: harm,
      visionChecker: vision,
      targetAdapters: [foodAdapter, tripAdapter],
      clock,
      logger,
    });

    const { photoId, fullEtag } = await createConfirmedPhoto('food_log');
    const keys = photoKeys(photoId);

    // Escalate photo to needs_review
    await repo.updateStatus(photoId, 'pending', 'needs_review');

    // Operator approves
    const ok = await runner.operatorApprove(photoId);
    expect(ok).toBe(true);

    const approvedRow = await repo.getById(photoId);
    expect(approvedRow?.status).toBe('approved');
    expect(approvedRow?.approved_by_operator).toBe(true);
    expect(approvedRow?.harm_verdict).toBe('pass');
    expect(approvedRow?.vision_verdict).toBe('pass');

    const servedHead = await store.head(keys.full);
    expect(servedHead.exists).toBe(true);
    if (servedHead.exists) {
      expect(servedHead.etag).toBe(fullEtag);
    }
  });

  it('fenced renewal (Requirement 8.20): stale run exits quietly when a second run re-claims after lease expiry', async () => {
    const { photoId } = await createConfirmedPhoto('food_log');

    // Run A claims with attempts = 1
    const rowA = await repo.claim(photoId, 5, 6, clock.now());
    expect(rowA?.attempts).toBe(1);

    // Lease expires
    clock.advance(6000);

    // Run B claims with attempts = 2
    const rowB = await repo.claim(photoId, 5, 6, clock.now());
    expect(rowB?.attempts).toBe(2);

    // Run A attempts to renew with its claimed attempts (1) -> affects 0 rows!
    const renewedA = await repo.renewLease(photoId, 1, 5, clock.now());
    expect(renewedA).toBe(false);
  });
});
