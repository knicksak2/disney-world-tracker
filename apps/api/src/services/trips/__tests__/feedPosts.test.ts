/**
 * Trip Feed Posts integration and property tests (Task 20.1).
 *
 * Validates: Requirements 14.1, 14.2, 14.3, 14.7, 14.8, 14.10, 14.12, 14.13;
 *            Properties 18, 22, 41.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import fc from 'fast-check';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { registerErrorHandler } from '../../../errors/handler.js';
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
  params?: ReadonlyArray<unknown>,
): [string, ReadonlyArray<unknown> | undefined] {
  let adaptedText = text.replace(/\bFOR UPDATE(?:\\s+OF\\s+\\w+)?/gi, '');
  if (params === undefined) return [adaptedText, params];

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

describe('Task 20.1: Trip Feed Posts (POST & DELETE /trips/:id/feed/posts)', () => {
  let db: IMemoryDb;
  let pool: DbPool;
  let tripRepo: TripRepo;

  let organizerId: string;
  let memberId: string;
  let nonMemberId: string;
  let tripAId: string;
  let tripBId: string;

  function buildTestServer(userId: string | null): FastifyInstance {
    const app = Fastify();
    registerErrorHandler(app);

    const requireSession: preHandlerHookHandler = async (request, reply) => {
      if (!userId) {
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'Authentication required' },
        });
      }
      (request as any).userId = userId;
    };

    app.register(
      tripRoutes({
        repo: tripRepo,
        requireSession,
        pool,
      }),
    );

    return app;
  }

  function seedPhoto(overrides: {
    id?: string;
    ownerId?: string;
    scopeId?: string;
    status?: string;
    feedItemId?: string | null;
  } = {}): string {
    const id = overrides.id ?? randomUUID();
    const ownerId = overrides.ownerId ?? memberId;
    const scopeId = overrides.scopeId ?? tripAId;
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
    memberId = randomUUID();
    nonMemberId = randomUUID();
    tripAId = randomUUID();
    tripBId = randomUUID();

    // Users & profiles
    for (const [uid, email, name] of [
      [organizerId, 'org@example.com', 'Organizer User'],
      [memberId, 'member@example.com', 'Member User'],
      [nonMemberId, 'stranger@example.com', 'Stranger User'],
    ]) {
      db.public.none(`
        INSERT INTO users (id, email, password_hash)
        VALUES ('${uid}', '${email}', 'hash');
        INSERT INTO profiles (user_id, display_name, avatar_preset)
        VALUES ('${uid}', '${name}', 'castle');
      `);
    }

    // Trips
    db.public.none(`
      INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
      VALUES ('${tripAId}', '${organizerId}', 'Trip Alpha', 'Trip A notes', '2026-10-20', '2026-10-25');
      INSERT INTO trips (id, creator_id, name, description, start_date, end_date)
      VALUES ('${tripBId}', '${organizerId}', 'Trip Beta', 'Trip B notes', '2026-10-20', '2026-10-25');

      INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ('${tripAId}', '${organizerId}', 'organizer');
      INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ('${tripAId}', '${memberId}', 'member');
      INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ('${tripBId}', '${organizerId}', 'organizer');
    `);

    tripRepo = createTripRepo(pool, {
      completions: {} as any,
      ratings: {} as any,
      resolveFoodList: vi.fn(),
      resolveExperienceList: vi.fn(),
    });
  });

  it('stores metadata.photoIds in the exact author request order (send [c, a, b] and read row back)', async () => {
    const c = seedPhoto();
    const a = seedPhoto();
    const b = seedPhoto();

    const server = buildTestServer(memberId);
    const res = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: {
        photoIds: [c, a, b],
        caption: 'Great day at the park!',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();

    // Read feed row back from DB
    const rows = db.public.many(`SELECT id, type, actor_id, metadata FROM trip_feed_items WHERE id = '${body.id}'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('member_post');
    expect(rows[0].actor_id).toBe(memberId);
    expect(rows[0].metadata.caption).toBe('Great day at the park!');
    expect(rows[0].metadata.photoIds).toEqual([c, a, b]);

    // Photos have feed_item_id linked
    const pRows = db.public.many(`SELECT id, feed_item_id FROM photos WHERE id IN ('${c}', '${a}', '${b}')`);
    expect(pRows).toHaveLength(3);
    for (const pr of pRows) {
      expect(pr.feed_item_id).toBe(body.id);
    }
  });

  it('accepts pending, approved, and needs_review while refusing uploading, rejected, hidden, and deleted with validation_failed', async () => {
    const server = buildTestServer(memberId);

    // Allowed statuses
    for (const status of ['pending', 'approved', 'needs_review']) {
      const pid = seedPhoto({ status });
      const res = await server.inject({
        method: 'POST',
        url: `/trips/${tripAId}/feed/posts`,
        payload: { photoIds: [pid] },
      });
      expect(res.statusCode).toBe(201);
      const post = db.public.many(`SELECT id FROM trip_feed_items WHERE id = '${res.json().id}'`);
      expect(post).toHaveLength(1);
    }

    // Refused statuses
    for (const status of ['uploading', 'rejected', 'hidden', 'deleted']) {
      const pid = seedPhoto({ status });
      const beforeCount = db.public.many(`SELECT id FROM trip_feed_items WHERE type = 'member_post'`).length;

      const res = await server.inject({
        method: 'POST',
        url: `/trips/${tripAId}/feed/posts`,
        payload: { photoIds: [pid] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error?.code).toBe('validation_failed');

      const afterCount = db.public.many(`SELECT id FROM trip_feed_items WHERE type = 'member_post'`).length;
      expect(afterCount).toBe(beforeCount); // No feed row created
    }
  });

  it('refuses already linked photo, another user photo, or photo of another trip with validation_failed', async () => {
    const server = buildTestServer(memberId);

    // 1. Photo already linked to a feed item
    const existingFeedId = randomUUID();
    db.public.none(`
      INSERT INTO trip_feed_items (id, trip_id, type, actor_id, metadata)
      VALUES ('${existingFeedId}', '${tripAId}', 'member_post', '${memberId}', '{}');
    `);
    const linkedPhoto = seedPhoto({ feedItemId: existingFeedId });
    const resLinked = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: { photoIds: [linkedPhoto] },
    });
    expect(resLinked.statusCode).toBe(400);
    expect(resLinked.json().error?.code).toBe('validation_failed');

    // 2. Another user's photo
    const foreignUserPhoto = seedPhoto({ ownerId: organizerId });
    const resForeignUser = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: { photoIds: [foreignUserPhoto] },
    });
    expect(resForeignUser.statusCode).toBe(400);
    expect(resForeignUser.json().error?.code).toBe('validation_failed');

    // 3. Photo of another trip
    const foreignTripPhoto = seedPhoto({ scopeId: tripBId });
    const resForeignTrip = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: { photoIds: [foreignTripPhoto] },
    });
    expect(resForeignTrip.statusCode).toBe(400);
    expect(resForeignTrip.json().error?.code).toBe('validation_failed');
  });

  it('Property 18: deleting a post deletes its photos, reactions, and comments', async () => {
    const p1 = seedPhoto();
    const p2 = seedPhoto();

    const server = buildTestServer(memberId);
    const postRes = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: { photoIds: [p1, p2] },
    });
    expect(postRes.statusCode).toBe(201);
    const feedItemId = postRes.json().id;

    // Add reaction and comment on the feed item through existing routes
    const reactRes = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/feed_item/${feedItemId}/reactions`,
      payload: { reaction: 'love' },
    });
    expect(reactRes.statusCode).toBe(201);

    const commentRes = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/feed_item/${feedItemId}/comments`,
      payload: { body: 'Great photos!' },
    });
    expect(commentRes.statusCode).toBe(201);

    // Verify rows exist before delete
    expect(db.public.many(`SELECT * FROM trip_reactions WHERE target_id = '${feedItemId}'`)).toHaveLength(1);
    expect(db.public.many(`SELECT * FROM trip_comments WHERE target_id = '${feedItemId}'`)).toHaveLength(1);

    // Author deletes the post
    const delRes = await server.inject({
      method: 'DELETE',
      url: `/trips/${tripAId}/feed/posts/${feedItemId}`,
    });
    expect(delRes.statusCode).toBe(204);

    // Assert photos are marked 'deleted'
    const photos = db.public.many(`SELECT id, status FROM photos WHERE id IN ('${p1}', '${p2}')`);
    expect(photos).toHaveLength(2);
    for (const p of photos) {
      expect(p.status).toBe('deleted');
    }

    // Assert reactions and comments deleted
    expect(db.public.many(`SELECT * FROM trip_reactions WHERE target_id = '${feedItemId}'`)).toHaveLength(0);
    expect(db.public.many(`SELECT * FROM trip_comments WHERE target_id = '${feedItemId}'`)).toHaveLength(0);

    // Assert feed item deleted
    expect(db.public.many(`SELECT * FROM trip_feed_items WHERE id = '${feedItemId}'`)).toHaveLength(0);
  });

  it('authorization: author can delete own post, organizer can delete any post, non-author non-organizer cannot delete', async () => {
    const p1 = seedPhoto();
    const serverAuthor = buildTestServer(memberId);
    const postRes = await serverAuthor.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: { photoIds: [p1] },
    });
    const feedItemId = postRes.json().id;

    // Another non-organizer member
    const otherMemberId = randomUUID();
    db.public.none(`
      INSERT INTO users (id, email, password_hash) VALUES ('${otherMemberId}', 'other@example.com', 'hash');
      INSERT INTO profiles (user_id, display_name, avatar_preset) VALUES ('${otherMemberId}', 'Other Member', 'castle');
      INSERT INTO trip_memberships (trip_id, user_id, role) VALUES ('${tripAId}', '${otherMemberId}', 'member');
    `);

    const serverOther = buildTestServer(otherMemberId);
    const delResOther = await serverOther.inject({
      method: 'DELETE',
      url: `/trips/${tripAId}/feed/posts/${feedItemId}`,
    });
    expect(delResOther.statusCode).toBe(403);
    expect(delResOther.json().error?.code).toBe('trip_forbidden');

    // Post and photo are untouched
    expect(db.public.many(`SELECT * FROM trip_feed_items WHERE id = '${feedItemId}'`)).toHaveLength(1);
    expect(db.public.many(`SELECT status FROM photos WHERE id = '${p1}'`)[0].status).toBe('approved');

    // Organizer can delete
    const serverOrg = buildTestServer(organizerId);
    const delResOrg = await serverOrg.inject({
      method: 'DELETE',
      url: `/trips/${tripAId}/feed/posts/${feedItemId}`,
    });
    expect(delResOrg.statusCode).toBe(204);
    expect(db.public.many(`SELECT * FROM trip_feed_items WHERE id = '${feedItemId}'`)).toHaveLength(0);
    expect(db.public.many(`SELECT status FROM photos WHERE id = '${p1}'`)[0].status).toBe('deleted');
  });

  it('Property 41 (double create, Requirement 14.12): repeated create with same photo is refused, rolls back, leaves second unlinked', async () => {
    const p = seedPhoto();
    const q = seedPhoto();

    const server = buildTestServer(memberId);

    // 1. Create post A with photo p
    const resA = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: { photoIds: [p] },
    });
    expect(resA.statusCode).toBe(201);
    const postAId = resA.json().id;

    const countBefore = db.public.many(`SELECT id FROM trip_feed_items WHERE type = 'member_post'`).length;

    // 2. Second create with [p, q] fails
    const resB = await server.inject({
      method: 'POST',
      url: `/trips/${tripAId}/feed/posts`,
      payload: { photoIds: [p, q] },
    });
    expect(resB.statusCode).toBe(400);
    expect(resB.json().error?.code).toBe('validation_failed');

    // Count is unchanged: no second feed item created
    const countAfter = db.public.many(`SELECT id FROM trip_feed_items WHERE type = 'member_post'`).length;
    expect(countAfter).toBe(countBefore);

    // q was unlinked (rollback undid any partial link)
    const qRow = db.public.many(`SELECT feed_item_id FROM photos WHERE id = '${q}'`)[0];
    expect(qRow.feed_item_id).toBeNull();

    // p.feed_item_id still equals post A's id
    const pRow = db.public.many(`SELECT feed_item_id FROM photos WHERE id = '${p}'`)[0];
    expect(pRow.feed_item_id).toBe(postAId);

    // 3. Race condition simulation: photo moved to rejected between validating read and link
    const r = seedPhoto();
    await expect(
      tripRepo.createFeedPost(tripAId, memberId, [r], undefined, {
        beforeGuardedUpdate: async () => {
          // pg-mem proves the guard (statement semantics) and not true concurrency or the FOR UPDATE lock,
          // as the design already says for the advisory lock.
          db.public.none(`UPDATE photos SET status = 'rejected', reject_reason = 'harm' WHERE id = '${r}'`);
        },
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    // 4. Deleting post A leaves nothing blanked in any other post
    const delRes = await server.inject({
      method: 'DELETE',
      url: `/trips/${tripAId}/feed/posts/${postAId}`,
    });
    expect(delRes.statusCode).toBe(204);
  });

  it('delete scoping (Requirement 14.13): post in another trip, non-member_post, or unknown id all return trip_not_found', async () => {
    // 1. Organizer creates post in Trip B
    const photoB = seedPhoto({ scopeId: tripBId, ownerId: organizerId });
    const serverOrg = buildTestServer(organizerId);

    const postBRes = await serverOrg.inject({
      method: 'POST',
      url: `/trips/${tripBId}/feed/posts`,
      payload: { photoIds: [photoB] },
    });
    expect(postBRes.statusCode).toBe(201);
    const postBId = postBRes.json().id;

    // Organizer of Trip A tries to delete Trip B's post via Trip A's endpoint
    const crossDeleteRes = await serverOrg.inject({
      method: 'DELETE',
      url: `/trips/${tripAId}/feed/posts/${postBId}`,
    });
    expect(crossDeleteRes.statusCode).toBe(404);
    expect(crossDeleteRes.json().error?.code).toBe('trip_not_found');

    // Trip B's post and photo are untouched
    expect(db.public.many(`SELECT * FROM trip_feed_items WHERE id = '${postBId}'`)).toHaveLength(1);
    expect(db.public.many(`SELECT status FROM photos WHERE id = '${photoB}'`)[0].status).toBe('approved');

    // 2. Passing id of a non-member_post (e.g. completion_logged) in caller's own trip
    const systemFeedId = randomUUID();
    db.public.none(`
      INSERT INTO trip_feed_items (id, trip_id, type, actor_id, metadata)
      VALUES ('${systemFeedId}', '${tripAId}', 'completion_logged', '${organizerId}', '{}');
    `);

    const delSysRes = await serverOrg.inject({
      method: 'DELETE',
      url: `/trips/${tripAId}/feed/posts/${systemFeedId}`,
    });
    expect(delSysRes.statusCode).toBe(404);
    expect(delSysRes.json().error?.code).toBe('trip_not_found');
    expect(db.public.many(`SELECT * FROM trip_feed_items WHERE id = '${systemFeedId}'`)).toHaveLength(1);

    // 3. Unknown id
    const unknownId = randomUUID();
    const delUnknownRes = await serverOrg.inject({
      method: 'DELETE',
      url: `/trips/${tripAId}/feed/posts/${unknownId}`,
    });
    expect(delUnknownRes.statusCode).toBe(404);
    expect(delUnknownRes.json().error?.code).toBe('trip_not_found');
  });

  // Feature: photo-uploads, Property 22: Trip feed post creation and slot visibility
  it('Property 22: feed post creation succeeds only for valid photo set; failure creates nothing', async () => {
    const server = buildTestServer(memberId);

    await fc.assert(
      fc.asyncProperty(
        fc.record({
          count: fc.integer({ min: 1, max: 4 }),
          hasForeignOwner: fc.boolean(),
          hasForeignScope: fc.boolean(),
          hasInvalidStatus: fc.boolean(),
          hasDuplicate: fc.boolean(),
        }),
        async ({ count, hasForeignOwner, hasForeignScope, hasInvalidStatus, hasDuplicate }) => {
          const photoIds: string[] = [];
          for (let i = 0; i < count; i++) {
            const pid = seedPhoto({
              ownerId: hasForeignOwner && i === 0 ? organizerId : memberId,
              scopeId: hasForeignScope && i === 0 ? tripBId : tripAId,
              status: hasInvalidStatus && i === 0 ? 'rejected' : 'approved',
            });
            photoIds.push(pid);
          }

          const isDuplicate = hasDuplicate && photoIds.length > 1;
          if (isDuplicate && photoIds[0] !== undefined) {
            photoIds[1] = photoIds[0];
          }

          const shouldSucceed = !hasForeignOwner && !hasForeignScope && !hasInvalidStatus && !isDuplicate;

          const beforeCount = db.public.many(`SELECT id FROM trip_feed_items WHERE type = 'member_post'`).length;

          const res = await server.inject({
            method: 'POST',
            url: `/trips/${tripAId}/feed/posts`,
            payload: { photoIds },
          });

          const afterCount = db.public.many(`SELECT id FROM trip_feed_items WHERE type = 'member_post'`).length;

          if (shouldSucceed) {
            expect(res.statusCode).toBe(201);
            expect(afterCount).toBe(beforeCount + 1);
          } else {
            expect(res.statusCode).toBe(400);
            expect(res.json().error?.code).toBe('validation_failed');
            expect(afterCount).toBe(beforeCount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
