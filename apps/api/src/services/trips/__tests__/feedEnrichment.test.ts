/**
 * Trip Feed Enrichment integration and property tests (Task 20.2).
 *
 * Validates: Requirements 14.4, 14.5, 14.6, 14.7, 14.9, 14.10, 14.11, 14.14, 17.3;
 *            Properties 22, 35, 42.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PhotoStatus, TripFeedItemDTO, TripPostSlotState } from '@dwt/shared';
import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { FakeObjectStore } from '../../photos/__tests__/fakes.js';
import {
  postVisibleToNonAuthor,
  tripPostSlotState,
} from '../../photos/domain/accessPolicy.js';
import { DefaultFeedPhotoPort } from '../../photos/feedPhotoPort.js';
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
  let adaptedText = text.replace(/\bFOR UPDATE(?:\s+OF\s+\w+)?/gi, '');
  if (params === undefined) return [adaptedText, params];

  const newParams = [...params];

  if (adaptedText.includes('rode_with_tags')) {
    adaptedText = adaptedText.replace(
      /\(SELECT count\(\*\)::int\s+FROM rode_with_tags[\s\S]*?AS rode_with_count/gi,
      '0 AS rode_with_count',
    );
    adaptedText = adaptedText.replace(
      /\(SELECT json_agg[\s\S]*?WHERE rwt\.log_entry_id = le\.id\)\s+AS rode_with/gi,
      'NULL AS rode_with',
    );
  }

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

describe('Task 20.2: Feed Enrichment (FeedPhotoPort & GET /trips/:id/feed)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let tripRepo: TripRepo;
  let fakeStore: FakeObjectStore;
  let feedPhotoPort: DefaultFeedPhotoPort;

  let organizerId: string;
  let authorMemberId: string;
  let otherMemberId: string;
  let tripId: string;

  function buildTestServer(options: {
    userId: string | null;
    withPort?: boolean;
  }): FastifyInstance {
    const app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request, reply) => {
      if (!options.userId) {
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'Authentication required' },
        });
      }
      (request as any).userId = options.userId;
    };

    app.register(
      tripRoutes({
        repo: tripRepo,
        requireSession,
        pool,
        ...(options.withPort === false ? {} : { feedPhotoPort }),
      }),
    );

    return app;
  }

  function seedPhoto(overrides: {
    id?: string;
    ownerId?: string;
    scopeId?: string;
    status?: PhotoStatus;
    feedItemId?: string | null;
  } = {}): string {
    const id = overrides.id ?? randomUUID();
    const ownerId = overrides.ownerId ?? authorMemberId;
    const scopeId = overrides.scopeId ?? tripId;
    const status = overrides.status ?? 'approved';
    const harm = (status === 'approved' || status === 'hidden') ? "'pass'" : 'NULL';
    const etag = (status === 'approved' || status === 'hidden') ? "'etag'" : 'NULL';
    const rejectReason = status === 'rejected' ? "'harm'" : 'NULL';
    const feedItemId = overrides.feedItemId ? `'${overrides.feedItemId}'` : 'NULL';

    db.public.none(`
      INSERT INTO photos (
        id, target_kind, target_id, scope_id, owner_id,
        status, object_key, thumb_key, width, height, byte_size, thumb_byte_size,
        sort_at, created_at, full_etag, thumb_etag, served_at, harm_verdict, reject_reason, feed_item_id
      ) VALUES (
        '${id}', 'trip', '${scopeId}', '${scopeId}', '${ownerId}',
        '${status}', 'p/${id}/full.jpg', 'p/${id}/thumb.jpg',
        1920, 1080, 204800, 20480, now(), now(), ${etag}, ${etag}, now(), ${harm}, ${rejectReason}, ${feedItemId}
      );
    `);

    return id;
  }

  function seedPost(overrides: {
    id?: string;
    actorId?: string;
    photoIds?: string[];
    caption?: string;
    tripId?: string;
  } = {}): string {
    const id = overrides.id ?? randomUUID();
    const actorId = overrides.actorId ?? authorMemberId;
    const tId = overrides.tripId ?? tripId;
    const photoIds = overrides.photoIds ?? [];
    const metadata: Record<string, unknown> = { photoIds };
    if (overrides.caption !== undefined) {
      metadata.caption = overrides.caption;
    }

    db.public.none(`
      INSERT INTO trip_feed_items (
        id, trip_id, type, actor_id, metadata, created_at
      ) VALUES (
        '${id}', '${tId}', 'member_post', '${actorId}', '${JSON.stringify(metadata)}', now()
      );
    `);

    return id;
  }

  beforeEach(() => {
    db = buildPgMemDatabase();
    const { Pool: PgMemPool } = db.adapters.createPg();
    pool = withPgMemCompat(new PgMemPool() as unknown as DbPool);

    applyMigration(db, '0001_init.sql');
    applyMigration(db, '0002_experience_images.sql');
    applyMigration(db, '0006_experience_land.sql');
    applyMigration(db, '0013_avatar_presets.sql');
    applyMigration(db, '0015_trips.sql');
    applyMigration(db, '0062_photo_uploads.sql');
    applyMigration(db, '0063_trip_photos.sql');
    applyMigration(db, '0064_account_deletion.sql');

    organizerId = randomUUID();
    authorMemberId = randomUUID();
    otherMemberId = randomUUID();
    tripId = randomUUID();

    // Seed users and profiles
    db.public.none(`
      INSERT INTO users (id, email, password_hash) VALUES
        ('${organizerId}', 'org@example.com', 'hash'),
        ('${authorMemberId}', 'author@example.com', 'hash'),
        ('${otherMemberId}', 'other@example.com', 'hash');

      INSERT INTO profiles (user_id, display_name, avatar_preset) VALUES
        ('${organizerId}', 'Organizer User', 'castle'),
        ('${authorMemberId}', 'Author User', 'wishing-star'),
        ('${otherMemberId}', 'Other Member', 'ear-balloon');

      INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES
        ('${tripId}', '${organizerId}', 'Enrichment Trip', 'Notes', '2026-11-01', '2026-11-07');

      INSERT INTO trip_memberships (trip_id, user_id, role) VALUES
        ('${tripId}', '${organizerId}', 'organizer'),
        ('${tripId}', '${authorMemberId}', 'member'),
        ('${tripId}', '${otherMemberId}', 'member');
    `);

    tripRepo = createTripRepo(pool, {
      completions: {} as any,
      ratings: {} as any,
      resolveFoodList: () => Promise.resolve(null),
    });
    fakeStore = new FakeObjectStore();
    feedPhotoPort = new DefaultFeedPhotoPort({
      pool,
      store: fakeStore,
      urlTtlSeconds: 3600,
    });
  });

  describe('Property 22: Feed post validation and slot visibility', () => {
    // Feature: photo-uploads, Property 22: Feed post validation and slot visibility
    it('slot visibility truth table across all status, mine, and blocked combinations', () => {
      const allStatuses: Array<PhotoStatus | null> = [
        'uploading',
        'pending',
        'needs_review',
        'approved',
        'rejected',
        'hidden',
        'deleted',
        null,
      ];
      const bools = [true, false];

      for (const status of allStatuses) {
        for (const mine of bools) {
          for (const blocked of bools) {
            const actual = tripPostSlotState({ status, mine, blocked });

            // Expected according to design.md Components truth table
            let expected: TripPostSlotState;
            if (status === 'deleted' || status === null) {
              expected = 'removed';
            } else if (blocked && !mine) {
              expected = 'unavailable';
            } else if (status === 'approved') {
              expected = 'ready';
            } else if (
              mine &&
              (status === 'uploading' ||
                status === 'pending' ||
                status === 'needs_review' ||
                status === 'rejected' ||
                status === 'hidden')
            ) {
              expected = 'checking';
            } else if (!mine && (status === 'pending' || status === 'needs_review')) {
              expected = 'checking';
            } else if (!mine && status === 'rejected') {
              expected = 'removed';
            } else if (!mine && (status === 'hidden' || status === 'uploading')) {
              expected = 'unavailable';
            } else {
              expected = 'unavailable';
            }

            expect(
              actual,
              `tripPostSlotState failed for status=${status}, mine=${mine}, blocked=${blocked}`,
            ).toBe(expected);
          }
        }
      }
    });

    it('postVisibleToNonAuthor returns true iff at least one slot is ready or checking', () => {
      expect(postVisibleToNonAuthor([{ state: 'ready' }])).toBe(true);
      expect(postVisibleToNonAuthor([{ state: 'checking' }])).toBe(true);
      expect(postVisibleToNonAuthor([{ state: 'removed' }, { state: 'ready' }])).toBe(true);
      expect(postVisibleToNonAuthor([{ state: 'removed' }])).toBe(false);
      expect(postVisibleToNonAuthor([{ state: 'unavailable' }])).toBe(false);
      expect(postVisibleToNonAuthor([{ state: 'removed' }, { state: 'unavailable' }])).toBe(false);
      expect(postVisibleToNonAuthor([])).toBe(false);
    });
  });

  describe('Property 35: Post slot order and placeholders survive the sweep', () => {
    // Feature: photo-uploads, Property 35: Post slot order and placeholders survive the sweep
    it('maintains [c, a, b] order through soft delete and hard delete, returning removed slots', async () => {
      const c = seedPhoto({ status: 'approved' });
      const a = seedPhoto({ status: 'approved' });
      const b = seedPhoto({ status: 'approved' });

      const postId = seedPost({ photoIds: [c, a, b] });

      // Initial read: author gets [c, a, b] all ready
      const resInitial = await feedPhotoPort.slotsForFeedItems(tripId, authorMemberId, [postId]);
      const initialSlots = resInitial.get(postId)?.slots;
      expect(initialSlots?.map((s) => s.photoId)).toEqual([c, a, b]);
      expect(initialSlots?.map((s) => s.state)).toEqual(['ready', 'ready', 'ready']);

      // Step 1: soft-delete 'a'
      db.public.none(`UPDATE photos SET status = 'deleted' WHERE id = '${a}';`);

      const resStep1 = await feedPhotoPort.slotsForFeedItems(tripId, authorMemberId, [postId]);
      const slots1 = resStep1.get(postId)?.slots;
      expect(slots1?.map((s) => s.photoId)).toEqual([c, a, b]);
      expect(slots1?.map((s) => s.state)).toEqual(['ready', 'removed', 'ready']);
      expect(slots1?.find((s) => s.photoId === a)?.url).toBeNull();
      expect(slots1?.find((s) => s.photoId === a)?.thumbUrl).toBeNull();

      // Step 2: run sweep hard delete for 'a' and 'c' so their rows are completely gone
      db.public.none(`DELETE FROM photos WHERE id IN ('${a}', '${c}');`);

      const resStep2 = await feedPhotoPort.slotsForFeedItems(tripId, authorMemberId, [postId]);
      const slots2 = resStep2.get(postId)?.slots;
      expect(slots2?.map((s) => s.photoId)).toEqual([c, a, b]);
      expect(slots2?.map((s) => s.state)).toEqual(['removed', 'removed', 'ready']);

      // Step 3: hard delete 'b' as well (all rows swept)
      db.public.none(`DELETE FROM photos WHERE id = '${b}';`);

      const resStep3 = await feedPhotoPort.slotsForFeedItems(tripId, authorMemberId, [postId]);
      const slots3 = resStep3.get(postId)?.slots;
      expect(slots3?.map((s) => s.photoId)).toEqual([c, a, b]);
      expect(slots3?.map((s) => s.state)).toEqual(['removed', 'removed', 'removed']);
      expect(resStep3.get(postId)?.authorId).toBe(authorMemberId);
    });

    it('statement count is exactly 2 for 1 post and 2 for 25 posts against real SQL', async () => {
      let queryCount = 0;
      const countingPool: DbPool = {
        async query(text: string, params?: ReadonlyArray<unknown>) {
          queryCount++;
          return (pool as any).query(text, params as any);
        },
        async connect() {
          return pool.connect();
        },
      } as unknown as DbPool;

      const port = new DefaultFeedPhotoPort({
        pool: countingPool,
        store: fakeStore,
        urlTtlSeconds: 3600,
      });

      // 1 post
      const p1 = seedPhoto();
      const post1 = seedPost({ photoIds: [p1] });

      queryCount = 0;
      const res1 = await port.slotsForFeedItems(tripId, authorMemberId, [post1]);
      expect(res1.size).toBe(1);
      expect(queryCount).toBe(2);

      // 25 posts
      const post25Ids: string[] = [post1];
      for (let i = 0; i < 24; i++) {
        const photo = seedPhoto();
        const post = seedPost({ photoIds: [photo] });
        post25Ids.push(post);
      }

      queryCount = 0;
      const res25 = await port.slotsForFeedItems(tripId, authorMemberId, post25Ids);
      expect(res25.size).toBe(25);
      expect(queryCount).toBe(2);
    });
  });

  describe('Author source and visibility (Requirement 14.11, Property 18)', () => {
    it('author gets mine: true with all slots removed; non-author gets mine false/absent and post is omitted when all slots removed', async () => {
      const p1 = seedPhoto({ status: 'approved' });
      const postId = seedPost({ photoIds: [p1] });

      // Soft delete photo
      db.public.none(`UPDATE photos SET status = 'deleted' WHERE id = '${p1}';`);

      const authorServer = buildTestServer({ userId: authorMemberId });
      const nonAuthorServer = buildTestServer({ userId: otherMemberId });

      // Author sees post with mine: true and slot 'removed'
      const authorRes = await authorServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });
      expect(authorRes.statusCode).toBe(200);
      const authorFeed = authorRes.json() as TripFeedItemDTO[];
      const authorItem = authorFeed.find((item) => item.id === postId);
      expect(authorItem).toBeDefined();
      expect(authorItem?.mine).toBe(true);
      expect(authorItem?.photos?.[0]?.state).toBe('removed');

      // Non-author does not see post because all slots are removed
      const nonAuthorRes = await nonAuthorServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });
      expect(nonAuthorRes.statusCode).toBe(200);
      const nonAuthorFeed = nonAuthorRes.json() as TripFeedItemDTO[];
      const nonAuthorItem = nonAuthorFeed.find((item) => item.id === postId);
      expect(nonAuthorItem).toBeUndefined();
    });

    it('neither serialized feed nor DTO contains authorId, actor_id, or photoIds', async () => {
      const p1 = seedPhoto({ status: 'approved' });
      const postId = seedPost({ photoIds: [p1], caption: 'Wonderful day!' });

      const server = buildTestServer({ userId: authorMemberId });
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });

      expect(res.statusCode).toBe(200);
      const rawText = res.body;

      // Sentinel check: no authorId or actor_id or photoIds key in serialized body
      expect(rawText).not.toContain('"authorId"');
      expect(rawText).not.toContain('"actor_id"');
      expect(rawText).not.toContain('"photoIds"');

      // DTO check
      const feed = res.json() as TripFeedItemDTO[];
      const item = feed.find((i) => i.id === postId);
      expect(item).toBeDefined();
      expect((item as any).authorId).toBeUndefined();
      expect((item as any).actor_id).toBeUndefined();
      expect(item?.metadata?.photoIds).toBeUndefined();
      expect(item?.metadata?.caption).toBe('Wonderful day!');
      expect(item?.photos?.[0]?.photoId).toBe(p1);
    });

    it('blocked uploader renders unavailable slot for non-author', async () => {
      const p1 = seedPhoto({ status: 'approved', ownerId: authorMemberId });
      const p2 = seedPhoto({ status: 'approved', ownerId: authorMemberId });
      const postId = seedPost({ photoIds: [p1, p2] });

      // otherMemberId blocks authorMemberId
      db.public.none(`
        INSERT INTO user_blocks (id, blocker_id, blocked_id, created_at)
        VALUES ('${randomUUID()}', '${otherMemberId}', '${authorMemberId}', now());
      `);

      const nonAuthorServer = buildTestServer({ userId: otherMemberId });
      const res = await nonAuthorServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });

      expect(res.statusCode).toBe(200);
      const feed = res.json() as TripFeedItemDTO[];
      // Since all slots are unavailable to this viewer, the post is omitted
      const item = feed.find((i) => i.id === postId);
      expect(item).toBeUndefined();
    });

    it('post with one checking slot is shown to another member', async () => {
      const pChecking = seedPhoto({ status: 'pending', ownerId: authorMemberId });
      const postId = seedPost({ photoIds: [pChecking] });

      const nonAuthorServer = buildTestServer({ userId: otherMemberId });
      const res = await nonAuthorServer.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });

      expect(res.statusCode).toBe(200);
      const feed = res.json() as TripFeedItemDTO[];
      const item = feed.find((i) => i.id === postId);
      expect(item).toBeDefined();
      expect(item?.mine).toBe(false);
      expect(item?.photos?.[0]?.state).toBe('checking');
      expect(item?.photos?.[0]?.url).toBeNull();
      expect(item?.photos?.[0]?.thumbUrl).toBeNull();
    });

    it('existing feed items are unchanged and carry no mine', async () => {
      const expId = randomUUID();
      db.public.none(`
        INSERT INTO experiences (id, upstream_entity_id, name, park, category)
        VALUES ('${expId}', 'exp-feed-1', 'Pirates of the Caribbean', 'Magic Kingdom', 'Ride');

        INSERT INTO trip_feed_items (id, trip_id, type, actor_id, metadata, created_at)
        VALUES ('${randomUUID()}', '${tripId}', 'trip_created', '${organizerId}', '{}', now());
      `);

      const server = buildTestServer({ userId: authorMemberId });
      const res = await server.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });

      expect(res.statusCode).toBe(200);
      const feed = res.json() as TripFeedItemDTO[];
      const tripCreatedItem = feed.find((i) => i.type === 'trip_created');
      expect(tripCreatedItem).toBeDefined();
      expect(tripCreatedItem?.mine).toBeUndefined();
      expect(tripCreatedItem?.photos).toBeUndefined();
    });
  });

  describe('Property 42: Photos disabled (Requirement 14.14, Property 42)', () => {
    // Feature: photo-uploads, Property 42: Disabling photos never leaks photo data or breaks the recap
    it('with no FeedPhotoPort wired, returns photos: [], no mine, caption intact, and strips photoIds', async () => {
      const pId = randomUUID();
      const postId = seedPost({ photoIds: [pId], caption: 'Secret trip caption' });

      // 1. Without port wired
      const serverNoPort = buildTestServer({ userId: authorMemberId, withPort: false });
      const resNoPort = await serverNoPort.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });

      expect(resNoPort.statusCode).toBe(200);
      const bodyTextNoPort = resNoPort.body;
      expect(bodyTextNoPort).not.toContain('"photoIds"');
      expect(bodyTextNoPort).not.toContain(pId);
      expect(bodyTextNoPort).toContain('Secret trip caption');

      const feedNoPort = resNoPort.json() as TripFeedItemDTO[];
      const itemNoPort = feedNoPort.find((i) => i.id === postId);
      expect(itemNoPort).toBeDefined();
      expect(itemNoPort?.photos).toEqual([]);
      expect(itemNoPort?.mine).toBeUndefined();
      expect(itemNoPort?.metadata?.caption).toBe('Secret trip caption');
      expect(itemNoPort?.metadata?.photoIds).toBeUndefined();

      // 2. With port wired
      const serverWithPort = buildTestServer({ userId: authorMemberId, withPort: true });
      const resWithPort = await serverWithPort.inject({
        method: 'GET',
        url: `/trips/${tripId}/feed`,
      });

      expect(resWithPort.statusCode).toBe(200);
      const bodyTextWithPort = resWithPort.body;
      expect(bodyTextWithPort).not.toContain('"photoIds"');

      const feedWithPort = resWithPort.json() as TripFeedItemDTO[];
      const itemWithPort = feedWithPort.find((i) => i.id === postId);
      expect(itemWithPort).toBeDefined();
      expect(itemWithPort?.photos?.length).toBe(1);
      expect(itemWithPort?.metadata?.photoIds).toBeUndefined();
      expect(itemWithPort?.metadata?.caption).toBe('Secret trip caption');
    });
  });
});
