/**
 * Shared pg-mem harness for the recipient photo album tests (decision D35).
 *
 * Builds a database with the migrations the recap tests use (0001, 0002, 0013, 0015, 0040, 0062,
 * 0063), seeds a small world (sender/member, recipient, uploaders, trips, friendship, share), and
 * inserts photo rows that satisfy the migration 0062 CHECK constraints.
 *
 * Implements: Task 21.6
 * Validates: Requirements 15.25 to 15.30, 16.10
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';

import type { DbPool } from '../../../db/pool.js';
import type { TripSummarySharePayload } from '@dwt/shared';
import { pair as canonicalPair } from '../../friends/canonicalPair.js';
import type { TripRole } from '../../trips/permissions.js';
import type { TripShareFacts } from '../../sharing/ports.js';
import { photoKeys } from '../domain/objectKeys.js';
import { FakeObjectStore } from './fakes.js';

export function buildPgMemDatabase(): IMemoryDb {
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

function applyMigration(db: IMemoryDb, name: string): void {
  const here = dirname(fileURLToPath(import.meta.url));
  let sql = readFileSync(resolve(here, '..', '..', '..', '..', 'migrations', name), 'utf8');
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

  // pg-mem cannot plan the correlated user_blocks NOT EXISTS; rewrite it to two NOT IN subqueries.
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

/**
 * Wraps a pg-mem pool with the SQL adaptations the recap tests need. When `queryLog` is given,
 * every SQL text issued through the wrapper is pushed to it (used to prove "zero queries").
 */
export function withPgMemCompat(base: DbPool, queryLog?: string[]): DbPool {
  const raw = base as unknown as {
    query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
    connect(): Promise<{
      query(t: string, p?: ReadonlyArray<unknown>): Promise<unknown>;
      release(): void;
    }>;
  };
  return {
    query(text: string, params?: ReadonlyArray<unknown>) {
      queryLog?.push(text);
      const [t, p] = adaptPgMemSql(text, params);
      return raw.query(t, p);
    },
    async connect() {
      const client = await raw.connect();
      return {
        query(text: string, params?: ReadonlyArray<unknown>) {
          queryLog?.push(text);
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

export const SENTINEL_UPLOADER_ALICE = 'SENTINEL_UPLOADER_ALICE';
export const SENTINEL_UPLOADER_BOB = 'SENTINEL_UPLOADER_BOB';
export const SENTINEL_CAPTION = 'SENTINEL_CAPTION';

export interface RecapAlbumWorld {
  readonly db: IMemoryDb;
  readonly pool: DbPool;
  /** Every SQL text issued through `pool` (after construction). */
  readonly queryLog: string[];
  /** Sharer, Trip organizer and member. */
  readonly senderId: string;
  /** Friend of the sender and recipient of the share. */
  readonly recipientId: string;
  /** Member uploader (SENTINEL_UPLOADER_ALICE), friend of nobody. */
  readonly aliceId: string;
  /** Member uploader (SENTINEL_UPLOADER_BOB); tests block him on demand. */
  readonly bobId: string;
  /** Uploader on another Trip. */
  readonly carolId: string;
  /** A user with no relation to anyone. */
  readonly strangerId: string;
  readonly tripId: string;
  readonly otherTripId: string;
  readonly shareId: string;
}

/** Fresh pg-mem database with the world described on `RecapAlbumWorld`. */
export function createRecapAlbumWorld(options: { includePhotos?: boolean } = {}): RecapAlbumWorld {
  const db = buildPgMemDatabase();
  const { Pool: PgMemPool } = db.adapters.createPg();
  const queryLog: string[] = [];
  const pool = withPgMemCompat(new PgMemPool() as unknown as DbPool, queryLog);

  for (const name of [
    '0001_init.sql',
    '0002_experience_images.sql',
    '0013_avatar_presets.sql',
    '0015_trips.sql',
    '0040_food_item_logging.sql',
    '0062_photo_uploads.sql',
    '0063_trip_photos.sql',
  ]) {
    applyMigration(db, name);
  }

  const senderId = randomUUID();
  const recipientId = randomUUID();
  const aliceId = randomUUID();
  const bobId = randomUUID();
  const carolId = randomUUID();
  const strangerId = randomUUID();
  const tripId = randomUUID();
  const otherTripId = randomUUID();
  const shareId = randomUUID();

  db.public.none(`
    INSERT INTO users (id, email, password_hash)
    VALUES ('${senderId}', 'sender@example.com', 'h1'),
           ('${recipientId}', 'recipient@example.com', 'h2'),
           ('${aliceId}', 'alice@example.com', 'h3'),
           ('${bobId}', 'bob@example.com', 'h4'),
           ('${carolId}', 'carol@example.com', 'h5'),
           ('${strangerId}', 'stranger@example.com', 'h6');

    INSERT INTO profiles (user_id, display_name, avatar_preset)
    VALUES ('${senderId}', 'Sender Sam', 'castle'),
           ('${recipientId}', 'Recipient Rae', 'wishing-star'),
           ('${aliceId}', '${SENTINEL_UPLOADER_ALICE}', 'fireworks'),
           ('${bobId}', '${SENTINEL_UPLOADER_BOB}', 'popcorn'),
           ('${carolId}', 'Carol Other', 'castle'),
           ('${strangerId}', 'Sam Stranger', 'popcorn');

    INSERT INTO trips (id, name, creator_id, start_date, end_date)
    VALUES ('${tripId}', 'Magic Kingdom 2026', '${senderId}', '2026-10-18', '2026-10-25'),
           ('${otherTripId}', 'Other Trip', '${carolId}', '2026-11-01', '2026-11-05');

    INSERT INTO trip_memberships (trip_id, user_id, role)
    VALUES ('${tripId}', '${senderId}', 'organizer'),
           ('${tripId}', '${aliceId}', 'member'),
           ('${tripId}', '${bobId}', 'member'),
           ('${otherTripId}', '${carolId}', 'organizer');
  `);

  const pair = canonicalPair(senderId, recipientId);
  db.public.none(`
    INSERT INTO friendships (user_lo_id, user_hi_id)
    VALUES ('${pair.lo}', '${pair.hi}');
  `);

  const payload: TripSummarySharePayload = {
    kind: 'tripSummary',
    tripId,
    tripName: 'Magic Kingdom 2026',
    sharerDisplayName: 'Sender Sam',
    includePhotos: options.includePhotos ?? true,
  };
  db.public.none(`
    INSERT INTO shares (id, sender_id, payload_kind, payload_snapshot)
    VALUES ('${shareId}', '${senderId}', 'tripSummary', '${JSON.stringify(payload)}');

    INSERT INTO share_recipients (share_id, recipient_id)
    VALUES ('${shareId}', '${recipientId}');
  `);

  return {
    db,
    pool,
    queryLog,
    senderId,
    recipientId,
    aliceId,
    bobId,
    carolId,
    strangerId,
    tripId,
    otherTripId,
    shareId,
  };
}

export type SeedPhotoStatus =
  | 'uploading'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'needs_review'
  | 'hidden'
  | 'deleted';

export interface SeedPhoto {
  readonly id: string;
  readonly ownerId: string;
  readonly tripId: string;
  readonly status: SeedPhotoStatus;
  /** ISO timestamp. */
  readonly sortAt: string;
  readonly width?: number;
  readonly height?: number;
  /** Trip post (member_post feed item) the photo is attached to; the item must exist. */
  readonly feedItemId?: string;
}

/** Inserts a member_post feed item whose metadata holds the caption (identity-bearing, must never leak). */
export function insertFeedPost(
  db: IMemoryDb,
  post: { readonly id: string; readonly tripId: string; readonly actorId: string; readonly caption: string },
): void {
  db.public.none(`
    INSERT INTO trip_feed_items (id, trip_id, type, actor_id, metadata)
    VALUES ('${post.id}', '${post.tripId}', 'member_post', '${post.actorId}', '${JSON.stringify({ caption: post.caption })}');
  `);
}

/**
 * Inserts rows with ONE multi-row INSERT. Rows keep the `u/` upload keys exactly as production
 * leaves them after approval (distinct object_key/thumb_key); approved/hidden carry harm_verdict
 * 'pass' and both etags; rejected carries a reject_reason (migration 0062 CHECKs).
 */
export function insertPhotos(db: IMemoryDb, photos: readonly SeedPhoto[]): void {
  if (photos.length === 0) return;
  const values = photos.map((p) => {
    const keys = photoKeys(p.id);
    const served = p.status === 'approved' || p.status === 'hidden';
    const harm = served ? "'pass'" : 'NULL';
    const etags = served ? "'e1', 'e2'" : 'NULL, NULL';
    const reject = p.status === 'rejected' ? "'harm'" : 'NULL';
    const feed = p.feedItemId ? `'${p.feedItemId}'` : 'NULL';
    return `('${p.id}', '${p.ownerId}', 'trip', '${p.tripId}', '${p.tripId}', '${p.status}', '${keys.uploadFull}', '${keys.uploadThumb}', 1000, 200, ${p.width ?? 800}, ${p.height ?? 600}, '${p.sortAt}', ${harm}, ${etags}, ${reject}, ${feed})`;
  });
  db.public.none(`
    INSERT INTO photos (id, owner_id, target_kind, target_id, scope_id, status, object_key, thumb_key, byte_size, thumb_byte_size, width, height, sort_at, harm_verdict, full_etag, thumb_etag, reject_reason, feed_item_id)
    VALUES ${values.join(',\n           ')};
  `);
}

/** A FakeObjectStore holding ONLY the `p/` serving objects of the given approved photos. */
export function storeWithServingObjects(photoIds: readonly string[]): FakeObjectStore {
  const store = new FakeObjectStore();
  for (const id of photoIds) {
    const keys = photoKeys(id);
    store.put(keys.full, new Uint8Array([1, 2, 3]));
    store.put(keys.thumb, new Uint8Array([4, 5, 6]));
  }
  return store;
}

export interface FactsCounters {
  isMember: number;
  tripName: number;
  summary: number;
  roleOf: number;
}

/** TripShareFacts backed by the world's trips/trip_memberships tables, counting each call. */
export function createCountingTripShareFacts(pool: DbPool): { facts: TripShareFacts; counters: FactsCounters } {
  const counters: FactsCounters = { isMember: 0, tripName: 0, summary: 0, roleOf: 0 };
  const facts: TripShareFacts = {
    async roleOf(userId, targetTripId) {
      counters.roleOf++;
      const res = await pool.query<{ role: TripRole }>(
        'SELECT role FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
        [targetTripId, userId],
      );
      return res.rows[0]?.role ?? null;
    },
    async tripName(targetTripId) {
      counters.tripName++;
      const res = await pool.query<{ name: string }>('SELECT name FROM trips WHERE id = $1', [targetTripId]);
      return res.rows[0]?.name ?? null;
    },
    async isMember(userId, targetTripId) {
      counters.isMember++;
      const res = await pool.query<{ exists: number }>(
        'SELECT 1 FROM trip_memberships WHERE trip_id = $1 AND user_id = $2',
        [targetTripId, userId],
      );
      return res.rows.length > 0;
    },
    async summary() {
      counters.summary++;
      return {
        distinctExperienceCount: 15,
        plannedCompletedCount: 10,
        plannedTotalCount: 12,
        totalCompletionsCount: 42,
        totalRatingsCount: 19,
        parkBreakdown: [{ park: 'Magic Kingdom', count: 30 }],
        topRated: [],
        perMember: [],
        superlatives: [],
      };
    },
  };
  return { facts, counters };
}
