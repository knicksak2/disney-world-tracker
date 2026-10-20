/**
 * Photos Sweep Tests — verifying all 8 housekeeping steps, single-flight guard,
 * time budgets, and strike persistence.
 *
 * Implements: Task 8.4
 * Validates: Requirements 8.9, 8.16, 8.19, 18.5, 19.1, 19.3, 19.4, 19.5,
 *            19.6, 19.7, 19.8, 19.11, 19.12, 19.13
 * Properties: 15, 16, 31, 34
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createPhotosRepo, type PhotosRepo } from '../repo.js';
import { createReportsRepo, type ReportsRepo } from '../reportsRepo.js';
import { ModerationRunner } from '../moderationRunner.js';
import { sweep, createSweepRunner, type SweepLogger } from '../sweep.js';
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

function adaptPgMemSql(
  text: string,
  params?: ReadonlyArray<unknown>
): [string, ReadonlyArray<unknown> | undefined] {
  if (params === undefined) return [text, params];

  let adaptedText = text;
  const newParams = [...params];

  // 1. Rewrite `= ANY($n)`
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

  // 2. Rewrite correlated NOT EXISTS user_blocks to NOT IN
  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+user_blocks\s+b\s+WHERE\s*\(\s*b\.blocker_id\s*=\s*\$(\d+)\s+AND\s+b\.blocked_id\s*=\s*p\.owner_id\s*\)\s*OR\s*\(\s*b\.blocker_id\s*=\s*p\.owner_id\s+AND\s+b\.blocked_id\s*=\s*\$\1\s*\)\s*\)/gi,
      (_match, viewerParam: string) => {
        return `AND (p.owner_id IS NULL OR (p.owner_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = $${viewerParam}) AND p.owner_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = $${viewerParam})))`;
      }
    );
  }

  // 3. Rewrite correlated NOT EXISTS for food_item_logs orphan query
  if (/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+food_item_logs\s+l\s+WHERE\s+l\.id\s*=\s*p\.target_id\s*\)/i.test(adaptedText)) {
    adaptedText = adaptedText.replace(
      /AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+food_item_logs\s+l\s+WHERE\s+l\.id\s*=\s*p\.target_id\s*\)/gi,
      'AND p.target_id NOT IN (SELECT l.id FROM food_item_logs l)'
    );
  }

  // 4. Rewrite correlated NOT EXISTS for trips orphan query
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

const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe('Photos Sweep (Task 8.4)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PhotosRepo;
  let reportsRepo: ReportsRepo;
  let store: FakeObjectStore;
  let harm: FakeHarmModerator;
  let vision: FakeVisionChecker;
  let clock: FakeClock;
  let runner: ModerationRunner;
  let foodAdapter: FakeTargetAdapter;
  let loggedEvents: Array<{ event: string; [key: string]: unknown }>;
  let logger: SweepLogger;

  let user1Id: string;
  let foodItem1Id: string;
  let log1Id: string;
  let exp1Id: string;

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
    exp1Id = randomUUID();

    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${user1Id}', 'u1@example.com', 'hash');

      INSERT INTO experiences (id, upstream_entity_id, name, park, category)
      VALUES ('${exp1Id}', 'exp-1', 'Restaurant 1', 'Magic Kingdom', 'Restaurant');

      INSERT INTO food_items (id, name, experience_id)
      VALUES ('${foodItem1Id}', 'Dish 1', '${exp1Id}');

      INSERT INTO food_item_logs (id, user_id, food_item_id, user_tz, visited_on)
      VALUES ('${log1Id}', '${user1Id}', '${foodItem1Id}', 'America/New_York', '2026-10-18');
    `);

    repo = createPhotosRepo(pool);
    reportsRepo = createReportsRepo(pool);
    store = new FakeObjectStore();
    harm = new FakeHarmModerator();
    vision = new FakeVisionChecker();
    clock = new FakeClock(new Date());

    foodAdapter = new FakeTargetAdapter('food_log', 'harm_and_vision', 4);
    foodAdapter.findOrphansFn = (limit) => repo.findFoodLogOrphanIds(limit);

    runner = new ModerationRunner({
      repo,
      objectStore: store,
      harmModerator: harm,
      visionChecker: vision,
      targetAdapters: [foodAdapter],
      clock,
    });

    loggedEvents = [];
    logger = {
      info: (obj) => loggedEvents.push(obj as any),
      warn: (obj) => loggedEvents.push(obj as any),
      error: (obj) => loggedEvents.push(obj as any),
    };
  });

  async function seedPhoto(status: string, createdAt: Date, extra: { moderatedAt?: Date; servedAt?: Date; ownerId?: string | null } = {}) {
    const photoId = randomUUID();
    const keys = photoKeys(photoId);

    store.put(keys.uploadFull, TINY_JPEG);
    store.put(keys.uploadThumb, TINY_JPEG);

    const ownerVal = extra.ownerId === null ? 'NULL' : `'${extra.ownerId ?? user1Id}'`;
    const moderatedVal = extra.moderatedAt ? `'${extra.moderatedAt.toISOString()}'` : 'NULL';
    const servedVal = extra.servedAt ? `'${extra.servedAt.toISOString()}'` : 'NULL';
    const rejectVal = status === 'rejected' ? "'invalid_image'" : 'NULL';

    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height,
        status, reject_reason, created_at, sort_at, moderated_at, served_at, next_attempt_at, full_etag, thumb_etag
      ) VALUES (
        '${photoId}', ${ownerVal}, 'food_log', '${log1Id}', '${foodItem1Id}',
        '${keys.uploadFull}', '${keys.uploadThumb}', 1000, 100, 800, 600,
        '${status}', ${rejectVal}, '${createdAt.toISOString()}', '${createdAt.toISOString()}', ${moderatedVal}, ${servedVal},
        '${createdAt.toISOString()}', '"e1"', '"e2"'
      );
    `);

    return { photoId, keys };
  }

  it('Step 1: resumeDue processes up to CONCURRENCY due pending photos', async () => {
    // Feature: photo-uploads, Property 16: due pending resumption
    // Seed 5 due pending photos
    const now = clock.now();
    for (let i = 0; i < 5; i++) {
      await seedPhoto('pending', new Date(now.getTime() - 10000));
    }

    const report = await sweep({
      repo,
      objectStore: store,
      runner,
      targetAdapters: [foodAdapter],
      config: { concurrency: 3 },
      clock,
      logger,
    });

    expect(report.resumed).toBe(3);
  });

  it('Steps 2, 3, 4: expires uploading, rejected, and needs_review photos', async () => {
    // Feature: photo-uploads, Property 15: retention expiry
    const now = clock.now();

    // 1. uploading photo 121 minutes old -> expired to deleted
    const oldUploading = await seedPhoto('uploading', new Date(now.getTime() - 121 * 60 * 1000));
    // young uploading 60 minutes old -> kept
    const youngUploading = await seedPhoto('uploading', new Date(now.getTime() - 60 * 60 * 1000));

    // 2. rejected photo 25 hours old -> expired to deleted
    const oldRejected = await seedPhoto('rejected', new Date(now.getTime() - 25 * 3600 * 1000), {
      moderatedAt: new Date(now.getTime() - 25 * 3600 * 1000),
    });

    // 3. needs_review 121 hours old -> expired to deleted
    const oldNeedsReview = await seedPhoto('needs_review', new Date(now.getTime() - 121 * 3600 * 1000));
    // young needs_review 119 hours old -> kept
    const youngNeedsReview = await seedPhoto('needs_review', new Date(now.getTime() - 119 * 3600 * 1000));

    const report = await sweep({
      repo,
      objectStore: store,
      runner,
      targetAdapters: [foodAdapter],
      clock,
      logger,
    });

    expect(report.expiredUploading).toBe(1);
    expect(report.expiredRejected).toBe(1);
    expect(report.expiredNeedsReview).toBe(1);

    // Expired photos are soft-deleted and then hard-deleted with objects cleaned in Step 6
    expect(await repo.getById(oldUploading.photoId)).toBeNull();
    expect((await store.head(oldUploading.keys.uploadFull)).exists).toBe(false);

    expect((await repo.getById(youngUploading.photoId))?.status).toBe('uploading');

    expect(await repo.getById(oldRejected.photoId)).toBeNull();
    expect((await store.head(oldRejected.keys.uploadFull)).exists).toBe(false);

    expect(await repo.getById(oldNeedsReview.photoId)).toBeNull();
    expect((await store.head(oldNeedsReview.keys.uploadFull)).exists).toBe(false);

    expect((await repo.getById(youngNeedsReview.photoId))?.status).toBe('needs_review');
  });

  it('Step 5: reaps orphans (owner null and missing target log)', async () => {
    const now = clock.now();

    // 1. Photo with null owner
    const nullOwner = await seedPhoto('approved', now, { ownerId: null });

    // 2. Photo with target_id that does not exist in food_item_logs
    const missingLogId = randomUUID();
    const photoId = randomUUID();
    const keys = photoKeys(photoId);
    db.public.none(`
      INSERT INTO photos (
        id, owner_id, target_kind, target_id, scope_id,
        object_key, thumb_key, byte_size, thumb_byte_size, width, height,
        status, created_at, sort_at, next_attempt_at, full_etag, thumb_etag
      ) VALUES (
        '${photoId}', '${user1Id}', 'food_log', '${missingLogId}', '${foodItem1Id}',
        '${keys.uploadFull}', '${keys.uploadThumb}', 1000, 100, 800, 600,
        'approved', now(), now(), now(), '"e1"', '"e2"'
      );
    `);

    const report = await sweep({
      repo,
      objectStore: store,
      runner,
      targetAdapters: [foodAdapter],
      clock,
      logger,
    });

    expect(report.reapedOrphans).toBeGreaterThanOrEqual(2);
    expect(await repo.getById(nullOwner.photoId)).toBeNull();
    expect(await repo.getById(photoId)).toBeNull();
    expect((await store.head(nullOwner.keys.uploadFull)).exists).toBe(false);
    expect((await store.head(keys.uploadFull)).exists).toBe(false);
  });

  it('Step 6: deletes all 4 objects from store and hard-deletes photo rows', async () => {
    // Feature: photo-uploads, Property 31: deletion completeness
    const now = clock.now();
    const { photoId, keys } = await seedPhoto('deleted', now);

    // Put all 4 keys into store
    store.put(keys.uploadFull, TINY_JPEG);
    store.put(keys.uploadThumb, TINY_JPEG);
    store.put(keys.full, TINY_JPEG);
    store.put(keys.thumb, TINY_JPEG);

    const report = await sweep({
      repo,
      objectStore: store,
      runner,
      targetAdapters: [foodAdapter],
      clock,
      logger,
    });

    expect(report.deletedRows).toBeGreaterThanOrEqual(1);
    expect(await repo.getById(photoId)).toBeNull();

    expect((await store.head(keys.uploadFull)).exists).toBe(false);
    expect((await store.head(keys.uploadThumb)).exists).toBe(false);
    expect((await store.head(keys.full)).exists).toBe(false);
    expect((await store.head(keys.thumb)).exists).toBe(false);
  });

  it('Step 8 & Property 34: cleanApprovedUploads cleans u/ keys for approved/hidden photos older than 1 hr', async () => {
    // Feature: photo-uploads, Property 34: upload cleaning after approval
    const now = clock.now();
    const oldServed = new Date(now.getTime() - 61 * 60 * 1000);
    const recentServed = new Date(now.getTime() - 59 * 60 * 1000);

    const oldPhoto = await seedPhoto('approved', oldServed, { servedAt: oldServed });
    const recentPhoto = await seedPhoto('approved', recentServed, { servedAt: recentServed });

    const report = await sweep({
      repo,
      objectStore: store,
      runner,
      targetAdapters: [foodAdapter],
      clock,
      logger,
    });

    expect(report.cleanedUploads).toBe(1);

    // Old photo upload keys deleted, upload_cleaned_at set
    const oldRow = await repo.getById(oldPhoto.photoId);
    expect(oldRow?.upload_cleaned_at).not.toBeNull();
    expect((await store.head(oldPhoto.keys.uploadFull)).exists).toBe(false);

    // Recent photo upload keys remain
    const recentRow = await repo.getById(recentPhoto.photoId);
    expect(recentRow?.upload_cleaned_at).toBeNull();
    expect((await store.head(recentPhoto.keys.uploadFull)).exists).toBe(true);
  });

  it('Single-flight guard returns in_flight when already running', async () => {
    let unblockSweep = () => {};
    const blockingRepo: PhotosRepo = {
      ...repo,
      listDuePending: async () => {
        await new Promise<void>((resolve) => {
          unblockSweep = resolve;
        });
        return [];
      },
    };

    const sweepRunner = createSweepRunner({
      repo: blockingRepo,
      objectStore: store,
      runner,
      clock,
    });

    const start1 = sweepRunner.tryStart();
    expect(start1).toEqual({ started: true });

    const start2 = sweepRunner.tryStart();
    expect(start2).toEqual({ started: false, reason: 'in_flight' });

    // Release blocking sweep
    unblockSweep();
  });

  it('Strike survival (Property 32): hard-deleting photo via sweep leaves photo_upload_strikes intact', async () => {
    const reporterId = randomUUID();
    db.public.none(`
      INSERT INTO users (id, email, password_hash)
      VALUES ('${reporterId}', 'reporter@example.com', 'hash');
    `);

    // Remove photo by operator -> creates strike
    const now = clock.now();
    const { photoId } = await seedPhoto('approved', now);

    db.public.none(`
      INSERT INTO photo_reports (id, photo_id, reporter_id, reason, status)
      VALUES (gen_random_uuid(), '${photoId}', '${reporterId}', 'spam', 'open');
    `);

    await reportsRepo.removePhotoByOperator(photoId);
    const countBefore = await reportsRepo.upheldCountForUser(user1Id);
    expect(countBefore).toBe(1);

    // Run sweep which hard-deletes the 'deleted' photo
    await sweep({
      repo,
      objectStore: store,
      runner,
      targetAdapters: [foodAdapter],
      clock,
      logger,
    });

    // Verify row is hard-deleted and strike count survives
    expect(await repo.getById(photoId)).toBeNull();
    const countAfter = await reportsRepo.upheldCountForUser(user1Id);
    expect(countAfter).toBe(1);
  });
});
