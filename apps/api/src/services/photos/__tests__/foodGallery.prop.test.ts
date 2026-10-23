/**
 * Property tests for Property 39 (Experience photo strip, server half).
 *
 * Implements: Task 9.6
 * Validates: Requirements 27.2, 27.3, 27.7, 27.8, 27.11, 27.12, 27.13
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeAll, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { createPhotosRepo, type FoodGalleryRow, type PhotosRepo } from '../repo.js';

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

interface OraclePhoto {
  id: string;
  ownerId: string;
  scopeId: string;
  foodItemName: string;
  status: 'uploading' | 'pending' | 'approved' | 'rejected' | 'needs_review' | 'hidden' | 'deleted';
  createdAt: Date;
  experienceId: string;
}

function oracleFilterAndSort(
  photos: readonly OraclePhoto[],
  targetExperienceId: string,
  blockedUserIds: ReadonlySet<string>,
  limit: number
): {
  firstPage: OraclePhoto[];
  nextCursor: { createdAt: Date; id: string } | null;
  secondPage: OraclePhoto[];
} {
  const qualifying = photos.filter(
    (p) =>
      p.experienceId === targetExperienceId &&
      p.status === 'approved' &&
      !blockedUserIds.has(p.ownerId)
  );

  // Order by (created_at DESC, id DESC)
  const sorted = [...qualifying].sort((a, b) => {
    const diff = b.createdAt.getTime() - a.createdAt.getTime();
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });

  const firstPage = sorted.slice(0, limit);
  const hasMore = sorted.length > limit;
  const nextCursor =
    hasMore && firstPage.length > 0
      ? { createdAt: firstPage[firstPage.length - 1]!.createdAt, id: firstPage[firstPage.length - 1]!.id }
      : null;

  const secondPage = hasMore ? sorted.slice(limit, limit * 2) : [];

  return { firstPage, nextCursor, secondPage };
}

describe('Property 39: Experience photo strip (server half)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let repo: PhotosRepo;

  beforeAll(() => {
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

    repo = createPhotosRepo(pool);
  });

  // Feature: photo-uploads, Property 39: Experience photo strip
  it('Property 39: Server half restaurant gallery matches in-memory oracle with status filter, bidirectional block filter, keyset ordering, and foodItemName attachment', async () => {
    const statusArb = fc.constantFrom<
      'uploading' | 'pending' | 'approved' | 'rejected' | 'needs_review' | 'hidden' | 'deleted'
    >('uploading', 'pending', 'approved', 'rejected', 'needs_review', 'hidden', 'deleted');

    const photoModelArb = fc.record({
      id: fc.uuid(),
      ownerIndex: fc.integer({ min: 0, max: 3 }),
      dishIndex: fc.integer({ min: 0, max: 2 }),
      status: statusArb,
      createdAtMs: fc.integer({ min: 1700000000000, max: 1700000100000 }),
    });

    const scenarioArb = fc.record({
      viewerIndex: fc.constant(0),
      limit: fc.integer({ min: 1, max: 10 }),
      // Block pairs among users: [blockerIndex, blockedIndex]
      blockPairs: fc.array(
        fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 })),
        { maxLength: 4 }
      ),
      photos: fc.array(photoModelArb, { minLength: 0, maxLength: 20 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ limit, blockPairs, photos }) => {
        // Clean dynamic tables
        db.public.none(`
          DELETE FROM photos;
          DELETE FROM user_blocks;
          DELETE FROM food_items;
          DELETE FROM experiences;
          DELETE FROM users;
        `);

        // Seed 4 users (user 0 is viewer)
        const userIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const viewerId = userIds[0]!;

        for (let i = 0; i < userIds.length; i++) {
          db.public.none(`
            INSERT INTO users (id, email, password_hash)
            VALUES ('${userIds[i]}', 'u${i}@example.com', 'h');
            INSERT INTO profiles (user_id, display_name, avatar_preset)
            VALUES ('${userIds[i]}', 'User ${i}', 'castle');
          `);
        }

        // Seed 1 experience and 3 dishes with distinct names
        const experienceId = randomUUID();
        db.public.none(`
          INSERT INTO experiences (id, upstream_entity_id, name, park, category)
          VALUES ('${experienceId}', 'exp-1', 'Be Our Guest Restaurant', 'Magic Kingdom', 'Restaurant');
        `);

        const dishes = [
          { id: randomUUID(), name: 'Grey Stuff Gateau' },
          { id: randomUUID(), name: 'French Onion Soup' },
          { id: randomUUID(), name: 'Filet Mignon' },
        ];

        for (const dish of dishes) {
          db.public.none(`
            INSERT INTO food_items (id, name, experience_id)
            VALUES ('${dish.id}', '${dish.name}', '${experienceId}');
          `);
        }

        // Seed blocks (skip self-blocks)
        const validBlocks: Array<{ blocker: string; blocked: string }> = [];
        const blockedUsersForViewer = new Set<string>();

        for (const [blockerIdx, blockedIdx] of blockPairs) {
          if (blockerIdx === blockedIdx) continue;
          const blockerId = userIds[blockerIdx]!;
          const blockedId = userIds[blockedIdx]!;
          // Dedup
          if (!validBlocks.some((b) => b.blocker === blockerId && b.blocked === blockedId)) {
            validBlocks.push({ blocker: blockerId, blocked: blockedId });
            db.public.none(`
              INSERT INTO user_blocks (id, blocker_id, blocked_id)
              VALUES ('${randomUUID()}', '${blockerId}', '${blockedId}')
              ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
            `);
          }
          // Bi-directional check against viewer
          if (blockerId === viewerId) {
            blockedUsersForViewer.add(blockedId);
          }
          if (blockedId === viewerId) {
            blockedUsersForViewer.add(blockerId);
          }
        }

        // Dedup photo IDs in generated array
        const seenPhotoIds = new Set<string>();
        const oraclePhotos: OraclePhoto[] = [];

        for (const p of photos) {
          if (seenPhotoIds.has(p.id)) continue;
          seenPhotoIds.add(p.id);

          const ownerId = userIds[p.ownerIndex]!;
          const dish = dishes[p.dishIndex]!;
          const createdAt = new Date(p.createdAtMs);

          oraclePhotos.push({
            id: p.id,
            ownerId,
            scopeId: dish.id,
            foodItemName: dish.name,
            status: p.status,
            createdAt,
            experienceId,
          });

          // Insert photo into pg-mem with constraints satisfied
          const isServed = p.status === 'approved' || p.status === 'hidden';
          const harmVerdict = isServed ? "'pass'" : 'NULL';
          const visionVerdict = isServed ? "'pass'" : 'NULL';
          const fullEtag = isServed ? "'full-etag'" : 'NULL';
          const thumbEtag = isServed ? "'thumb-etag'" : 'NULL';
          const servedAt = isServed ? `'${createdAt.toISOString()}'` : 'NULL';
          const rejectReason = p.status === 'rejected' ? "'not_food'" : 'NULL';
          const hiddenReason = p.status === 'hidden' ? "'reports'" : 'NULL';

          db.public.none(`
            INSERT INTO photos (
              id, owner_id, target_kind, target_id, scope_id, status,
              object_key, thumb_key, byte_size, thumb_byte_size, width, height,
              created_at, sort_at, harm_verdict, vision_verdict, full_etag, thumb_etag, served_at,
              reject_reason, hidden_reason
            ) VALUES (
              '${p.id}', '${ownerId}', 'food_log', '${randomUUID()}', '${dish.id}', '${p.status}',
              'u/${p.id}/full.jpg', 'u/${p.id}/thumb.jpg', 50000, 5000, 800, 600,
              '${createdAt.toISOString()}', '${createdAt.toISOString()}', ${harmVerdict}, ${visionVerdict},
              ${fullEtag}, ${thumbEtag}, ${servedAt},
              ${rejectReason}, ${hiddenReason}
            );
          `);
        }

        // Compute oracle
        const oracle = oracleFilterAndSort(
          oraclePhotos,
          experienceId,
          blockedUsersForViewer,
          limit
        );

        // Run repo query for page 1
        const repoPage1: readonly FoodGalleryRow[] = await repo.listFoodByExperience({
          experienceId,
          viewerId,
          limit,
        });

        // 1. Length matches oracle first page
        expect(repoPage1).toHaveLength(oracle.firstPage.length);

        // 2. Each entry matches oracle entry in exact order, with food_item_name attached
        for (let i = 0; i < oracle.firstPage.length; i++) {
          const expItem = oracle.firstPage[i]!;
          const actualItem = repoPage1[i]!;

          expect(actualItem.id).toBe(expItem.id);
          expect(actualItem.food_item_name).toBe(expItem.foodItemName);
          expect(actualItem.created_at.getTime()).toBe(expItem.createdAt.getTime());
          expect(actualItem.food_item_name).toBeTruthy();
        }

        // 3. Keyset cursor and page 2 verification
        if (oracle.nextCursor) {
          const repoPage2: readonly FoodGalleryRow[] = await repo.listFoodByExperience({
            experienceId,
            viewerId,
            limit,
            cursor: {
              createdAt: oracle.nextCursor.createdAt,
              id: oracle.nextCursor.id,
            },
          });

          expect(repoPage2).toHaveLength(oracle.secondPage.length);

          for (let j = 0; j < oracle.secondPage.length; j++) {
            const expItem = oracle.secondPage[j]!;
            const actualItem = repoPage2[j]!;

            expect(actualItem.id).toBe(expItem.id);
            expect(actualItem.food_item_name).toBe(expItem.foodItemName);
            expect(actualItem.created_at.getTime()).toBe(expItem.createdAt.getTime());
          }

          // No overlap between page 1 and page 2
          const page1Ids = new Set(repoPage1.map((r) => r.id));
          for (const item2 of repoPage2) {
            expect(page1Ids.has(item2.id)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: photo-uploads, Property 39: Experience photo strip (location gallery)
  it('Property 39: Server half location gallery matches in-memory oracle with status filter, bidirectional block filter, keyset ordering, and foodItemName attachment', async () => {
    const statusArb = fc.constantFrom<
      'uploading' | 'pending' | 'approved' | 'rejected' | 'needs_review' | 'hidden' | 'deleted'
    >('uploading', 'pending', 'approved', 'rejected', 'needs_review', 'hidden', 'deleted');

    const photoModelArb = fc.record({
      id: fc.uuid(),
      ownerIndex: fc.integer({ min: 0, max: 3 }),
      dishIndex: fc.integer({ min: 0, max: 2 }),
      status: statusArb,
      createdAtMs: fc.integer({ min: 1700000000000, max: 1700000100000 }),
    });

    const scenarioArb = fc.record({
      viewerIndex: fc.constant(0),
      limit: fc.integer({ min: 1, max: 10 }),
      blockPairs: fc.array(
        fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 3 })),
        { maxLength: 4 }
      ),
      photos: fc.array(photoModelArb, { minLength: 0, maxLength: 20 }),
    });

    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ limit, blockPairs, photos }) => {
        // Clean dynamic tables
        db.public.none(`
          DELETE FROM photos;
          DELETE FROM user_blocks;
          DELETE FROM food_items;
          DELETE FROM user_submitted_locations;
          DELETE FROM users;
        `);

        // Seed 4 users
        const userIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const viewerId = userIds[0]!;

        for (let i = 0; i < userIds.length; i++) {
          db.public.none(`
            INSERT INTO users (id, email, password_hash)
            VALUES ('${userIds[i]}', 'u${i}@example.com', 'h');
            INSERT INTO profiles (user_id, display_name, avatar_preset)
            VALUES ('${userIds[i]}', 'User ${i}', 'castle');
          `);
        }

        // Seed 1 location and 3 dishes
        const locationId = randomUUID();
        db.public.none(`
          INSERT INTO user_submitted_locations (id, name, park, created_by_user_id)
          VALUES ('${locationId}', 'Fantasyland Popcorn Cart', 'Magic Kingdom', '${viewerId}');
        `);

        const dishes = [
          { id: randomUUID(), name: 'Buttered Popcorn' },
          { id: randomUUID(), name: 'Caramel Corn' },
          { id: randomUUID(), name: 'Cheddar Corn' },
        ];

        for (const dish of dishes) {
          db.public.none(`
            INSERT INTO food_items (id, name, location_id)
            VALUES ('${dish.id}', '${dish.name}', '${locationId}');
          `);
        }

        // Seed blocks
        const validBlocks: Array<{ blocker: string; blocked: string }> = [];
        const blockedUsersForViewer = new Set<string>();

        for (const [blockerIdx, blockedIdx] of blockPairs) {
          if (blockerIdx === blockedIdx) continue;
          const blockerId = userIds[blockerIdx]!;
          const blockedId = userIds[blockedIdx]!;
          if (!validBlocks.some((b) => b.blocker === blockerId && b.blocked === blockedId)) {
            validBlocks.push({ blocker: blockerId, blocked: blockedId });
            db.public.none(`
              INSERT INTO user_blocks (id, blocker_id, blocked_id)
              VALUES ('${randomUUID()}', '${blockerId}', '${blockedId}')
              ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
            `);
          }
          if (blockerId === viewerId) blockedUsersForViewer.add(blockedId);
          if (blockedId === viewerId) blockedUsersForViewer.add(blockerId);
        }

        const seenPhotoIds = new Set<string>();
        const oraclePhotos: OraclePhoto[] = [];

        for (const p of photos) {
          if (seenPhotoIds.has(p.id)) continue;
          seenPhotoIds.add(p.id);

          const ownerId = userIds[p.ownerIndex]!;
          const dish = dishes[p.dishIndex]!;
          const createdAt = new Date(p.createdAtMs);

          oraclePhotos.push({
            id: p.id,
            ownerId,
            scopeId: dish.id,
            foodItemName: dish.name,
            status: p.status,
            createdAt,
            experienceId: locationId,
          });

          const isServed = p.status === 'approved' || p.status === 'hidden';
          const harmVerdict = isServed ? "'pass'" : 'NULL';
          const visionVerdict = isServed ? "'pass'" : 'NULL';
          const fullEtag = isServed ? "'full-etag'" : 'NULL';
          const thumbEtag = isServed ? "'thumb-etag'" : 'NULL';
          const servedAt = isServed ? `'${createdAt.toISOString()}'` : 'NULL';
          const rejectReason = p.status === 'rejected' ? "'not_food'" : 'NULL';
          const hiddenReason = p.status === 'hidden' ? "'reports'" : 'NULL';

          db.public.none(`
            INSERT INTO photos (
              id, owner_id, target_kind, target_id, scope_id, status,
              object_key, thumb_key, byte_size, thumb_byte_size, width, height,
              created_at, sort_at, harm_verdict, vision_verdict, full_etag, thumb_etag, served_at,
              reject_reason, hidden_reason
            ) VALUES (
              '${p.id}', '${ownerId}', 'food_log', '${randomUUID()}', '${dish.id}', '${p.status}',
              'u/${p.id}/full.jpg', 'u/${p.id}/thumb.jpg', 50000, 5000, 800, 600,
              '${createdAt.toISOString()}', '${createdAt.toISOString()}', ${harmVerdict}, ${visionVerdict},
              ${fullEtag}, ${thumbEtag}, ${servedAt},
              ${rejectReason}, ${hiddenReason}
            );
          `);
        }

        const oracle = oracleFilterAndSort(
          oraclePhotos,
          locationId,
          blockedUsersForViewer,
          limit
        );

        const repoPage1: readonly FoodGalleryRow[] = await repo.listFoodByLocation({
          locationId,
          viewerId,
          limit,
        });

        expect(repoPage1).toHaveLength(oracle.firstPage.length);

        for (let i = 0; i < oracle.firstPage.length; i++) {
          const expItem = oracle.firstPage[i]!;
          const actualItem = repoPage1[i]!;

          expect(actualItem.id).toBe(expItem.id);
          expect(actualItem.food_item_name).toBe(expItem.foodItemName);
          expect(actualItem.created_at.getTime()).toBe(expItem.createdAt.getTime());
          expect(actualItem.food_item_name).toBeTruthy();
        }

        if (oracle.nextCursor) {
          const repoPage2: readonly FoodGalleryRow[] = await repo.listFoodByLocation({
            locationId,
            viewerId,
            limit,
            cursor: {
              createdAt: oracle.nextCursor.createdAt,
              id: oracle.nextCursor.id,
            },
          });

          expect(repoPage2).toHaveLength(oracle.secondPage.length);

          for (let j = 0; j < oracle.secondPage.length; j++) {
            const expItem = oracle.secondPage[j]!;
            const actualItem = repoPage2[j]!;

            expect(actualItem.id).toBe(expItem.id);
            expect(actualItem.food_item_name).toBe(expItem.foodItemName);
            expect(actualItem.created_at.getTime()).toBe(expItem.createdAt.getTime());
          }

          const page1Ids = new Set(repoPage1.map((r) => r.id));
          for (const item2 of repoPage2) {
            expect(page1Ids.has(item2.id)).toBe(false);
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
