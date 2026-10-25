/**
 * Photos repository — Postgres persistence and transactional operations.
 *
 * Implements: Task 7.1
 * Validates: Requirements 4.9, 4.10, 4.11, 5.1, 5.2, 5.3, 5.10, 5.12, 8.3, 8.4,
 *            8.5, 8.6, 8.16, 8.20, 9.4, 10.3, 10.5, 11.1, 11.2, 11.4, 19.3,
 *            19.4, 19.11, 19.12
 */

import type { PoolClient } from 'pg';
import type { DbPool } from '../../db/pool.js';
import type { PhotoStatus } from '@dwt/shared';

export interface PhotoRow {
  readonly id: string;
  readonly owner_id: string | null;
  readonly target_kind: 'food_log' | 'trip';
  readonly target_id: string;
  readonly scope_id: string;
  readonly feed_item_id: string | null;
  readonly status: 'uploading' | 'pending' | 'approved' | 'rejected' | 'needs_review' | 'hidden' | 'deleted';
  readonly object_key: string;
  readonly thumb_key: string;
  readonly byte_size: number;
  readonly thumb_byte_size: number;
  readonly width: number;
  readonly height: number;
  readonly taken_at: Date | null;
  readonly sort_at: Date;
  readonly harm_verdict: 'pass' | 'flag' | null;
  readonly vision_verdict: 'pass' | 'reject' | null;
  readonly reject_reason: 'harm' | 'not_food' | 'face_visible' | 'too_much_text' | 'invalid_image' | null;
  readonly hidden_reason: 'reports' | null;
  readonly vision_fields: unknown | null;
  readonly attempts: number;
  readonly next_attempt_at: Date;
  readonly lease_until: Date | null;
  readonly last_error_code: string | null;
  readonly delete_attempts: number;
  readonly created_at: Date;
  readonly confirmed_at: Date | null;
  readonly moderated_at: Date | null;
  readonly deleted_at: Date | null;
  readonly full_etag: string | null;
  readonly thumb_etag: string | null;
  readonly served_at: Date | null;
  readonly upload_cleaned_at: Date | null;
  readonly approved_by_operator: boolean;
}

// Public read rows deliberately carry NO object_key / thumb_key. Those columns keep the
// `u/<id>/...` upload keys forever, but approval deletes the upload objects, so serving URLs
// must be derived from the photo id and status via readKeysFor / photoKeys (domain/).
export interface FoodGalleryRow {
  readonly id: string;
  readonly scope_id: string;
  readonly width: number;
  readonly height: number;
  readonly created_at: Date;
  readonly owner_id: string | null;
  readonly display_name: string | null;
  readonly avatar_preset: string | null;
  readonly food_item_name?: string | null;
}

export type MyPhotoListRow = Pick<
  PhotoRow,
  | 'id'
  | 'owner_id'
  | 'target_kind'
  | 'target_id'
  | 'scope_id'
  | 'feed_item_id'
  | 'status'
  | 'reject_reason'
  | 'width'
  | 'height'
  | 'created_at'
>;

export interface InsertUploadingPhotoParams {
  readonly id?: string;
  readonly ownerId: string;
  readonly targetKind: 'food_log' | 'trip';
  readonly targetId: string;
  readonly scopeId: string;
  readonly objectKey: string;
  readonly thumbKey: string;
  readonly byteSize: number;
  readonly thumbByteSize: number;
  readonly width: number;
  readonly height: number;
  readonly takenAt?: Date | null;
  readonly sortAt?: Date;
  readonly createdAt?: Date;
}

export const PHOTO_SELECT_COLUMNS = [
  'id',
  'owner_id',
  'target_kind',
  'target_id',
  'scope_id',
  'feed_item_id',
  'status',
  'object_key',
  'thumb_key',
  'byte_size',
  'thumb_byte_size',
  'width',
  'height',
  'taken_at',
  'sort_at',
  'harm_verdict',
  'vision_verdict',
  'reject_reason',
  'hidden_reason',
  'vision_fields',
  'attempts',
  'next_attempt_at',
  'lease_until',
  'last_error_code',
  'delete_attempts',
  'created_at',
  'confirmed_at',
  'moderated_at',
  'deleted_at',
  'full_etag',
  'thumb_etag',
  'served_at',
  'upload_cleaned_at',
  'approved_by_operator',
].join(', ');

export const PHOTO_ALIASED_COLUMNS = [
  'p.id',
  'p.owner_id',
  'p.target_kind',
  'p.target_id',
  'p.scope_id',
  'p.feed_item_id',
  'p.status',
  'p.object_key',
  'p.thumb_key',
  'p.byte_size',
  'p.thumb_byte_size',
  'p.width',
  'p.height',
  'p.taken_at',
  'p.sort_at',
  'p.harm_verdict',
  'p.vision_verdict',
  'p.reject_reason',
  'p.hidden_reason',
  'p.vision_fields',
  'p.attempts',
  'p.next_attempt_at',
  'p.lease_until',
  'p.last_error_code',
  'p.delete_attempts',
  'p.created_at',
  'p.confirmed_at',
  'p.moderated_at',
  'p.deleted_at',
  'p.full_etag',
  'p.thumb_etag',
  'p.served_at',
  'p.upload_cleaned_at',
  'p.approved_by_operator',
].join(', ');

// Fixed SQL statements for food read queries
const SQL_DISH_GALLERY_FIRST_PAGE = `
SELECT p.id, p.scope_id, p.width, p.height, p.created_at,
       p.owner_id, pr.display_name, pr.avatar_preset
  FROM photos p
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'food_log' AND p.scope_id = $1 AND p.status = 'approved'
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                       OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))
 ORDER BY p.created_at DESC, p.id DESC
 LIMIT $3;
`;

const SQL_DISH_GALLERY_PAGINATED = `
SELECT p.id, p.scope_id, p.width, p.height, p.created_at,
       p.owner_id, pr.display_name, pr.avatar_preset
  FROM photos p
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'food_log' AND p.scope_id = $1 AND p.status = 'approved'
   AND (p.created_at < $3 OR (p.created_at = $3 AND p.id < $4))
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                       OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))
 ORDER BY p.created_at DESC, p.id DESC
 LIMIT $5;
`;

const SQL_EXPERIENCE_GALLERY_FIRST_PAGE = `
SELECT p.id, p.scope_id, p.width, p.height, p.created_at,
       p.owner_id, pr.display_name, pr.avatar_preset, fi.name AS food_item_name
  FROM photos p
  JOIN food_items fi ON fi.id = p.scope_id
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'food_log' AND fi.experience_id = $1 AND p.status = 'approved'
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                       OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))
 ORDER BY p.created_at DESC, p.id DESC
 LIMIT $3;
`;

const SQL_EXPERIENCE_GALLERY_PAGINATED = `
SELECT p.id, p.scope_id, p.width, p.height, p.created_at,
       p.owner_id, pr.display_name, pr.avatar_preset, fi.name AS food_item_name
  FROM photos p
  JOIN food_items fi ON fi.id = p.scope_id
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'food_log' AND fi.experience_id = $1 AND p.status = 'approved'
   AND (p.created_at < $3 OR (p.created_at = $3 AND p.id < $4))
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                       OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))
 ORDER BY p.created_at DESC, p.id DESC
 LIMIT $5;
`;

const SQL_LOCATION_GALLERY_FIRST_PAGE = `
SELECT p.id, p.scope_id, p.width, p.height, p.created_at,
       p.owner_id, pr.display_name, pr.avatar_preset, fi.name AS food_item_name
  FROM photos p
  JOIN food_items fi ON fi.id = p.scope_id
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'food_log' AND fi.location_id = $1 AND p.status = 'approved'
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                       OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))
 ORDER BY p.created_at DESC, p.id DESC
 LIMIT $3;
`;

const SQL_LOCATION_GALLERY_PAGINATED = `
SELECT p.id, p.scope_id, p.width, p.height, p.created_at,
       p.owner_id, pr.display_name, pr.avatar_preset, fi.name AS food_item_name
  FROM photos p
  JOIN food_items fi ON fi.id = p.scope_id
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'food_log' AND fi.location_id = $1 AND p.status = 'approved'
   AND (p.created_at < $3 OR (p.created_at = $3 AND p.id < $4))
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                    WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
                       OR (b.blocker_id = p.owner_id AND b.blocked_id = $2))
 ORDER BY p.created_at DESC, p.id DESC
 LIMIT $5;
`;

const SQL_TRIP_ALBUM_FIRST_PAGE = `
SELECT p.id, p.target_id, p.width, p.height, p.sort_at, p.created_at,
       p.owner_id, p.status, p.feed_item_id,
       pr.display_name AS uploader_display_name, pr.avatar_preset AS uploader_avatar_preset
  FROM photos p
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'trip' AND p.target_id = $1
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND (
     (p.owner_id = $2 AND p.status <> 'deleted')
     OR (
       (p.owner_id <> $2 OR p.owner_id IS NULL)
       AND p.status = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
             OR (b.blocker_id = p.owner_id AND b.blocked_id = $2)
       )
     )
   )
 ORDER BY p.sort_at DESC, p.id DESC
 LIMIT $3;
`;

const SQL_TRIP_ALBUM_PAGINATED = `
SELECT p.id, p.target_id, p.width, p.height, p.sort_at, p.created_at,
       p.owner_id, p.status, p.feed_item_id,
       pr.display_name AS uploader_display_name, pr.avatar_preset AS uploader_avatar_preset
  FROM photos p
  LEFT JOIN profiles pr ON pr.user_id = p.owner_id
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'trip' AND p.target_id = $1
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND (p.sort_at < $3 OR (p.sort_at = $3 AND p.id < $4))
   AND (
     (p.owner_id = $2 AND p.status <> 'deleted')
     OR (
       (p.owner_id <> $2 OR p.owner_id IS NULL)
       AND p.status = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks b
          WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
             OR (b.blocker_id = p.owner_id AND b.blocked_id = $2)
       )
     )
   )
 ORDER BY p.sort_at DESC, p.id DESC
 LIMIT $5;
`;

const SQL_TRIP_APPROVED_HIGHLIGHTS = `
SELECT p.id, p.owner_id, p.sort_at, p.width, p.height
  FROM photos p
  LEFT JOIN users ou ON ou.id = p.owner_id
 WHERE p.target_kind = 'trip' AND p.target_id = $1
   AND (p.owner_id IS NULL OR ou.deletion_state = 'active')
   AND p.status = 'approved'
   AND NOT EXISTS (
     SELECT 1 FROM user_blocks b
      WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
         OR (b.blocker_id = p.owner_id AND b.blocked_id = $2)
   )
 ORDER BY p.sort_at ASC, p.id ASC;
`;

export const SQL_MY_PHOTOS_FIRST_PAGE = `
SELECT id, owner_id, target_kind, target_id, scope_id, feed_item_id, status, reject_reason,
       width, height, created_at
  FROM photos
 WHERE owner_id = $1
   AND status <> 'deleted'
 ORDER BY created_at DESC, id DESC
 LIMIT $2;
`;

export const SQL_MY_PHOTOS_NEXT_PAGE = `
SELECT id, owner_id, target_kind, target_id, scope_id, feed_item_id, status, reject_reason,
       width, height, created_at
  FROM photos
 WHERE owner_id = $1
   AND status <> 'deleted'
   AND (created_at < $2
        OR (created_at = $2 AND id < $3))
 ORDER BY created_at DESC, id DESC
 LIMIT $4;
`;

export interface TripPhotoRow {
  readonly id: string;
  readonly target_id: string;
  readonly width: number;
  readonly height: number;
  readonly sort_at: Date;
  readonly created_at: Date;
  readonly owner_id: string | null;
  readonly status: PhotoStatus;
  readonly feed_item_id: string | null;
  readonly uploader_display_name: string | null;
  readonly uploader_avatar_preset: string | null;
}

export interface ListTripPhotosParams {
  readonly tripId: string;
  readonly viewerId: string;
  readonly limit: number;
  readonly cursor?: { readonly sortAt: Date; readonly id: string };
}

export interface TripHighlightRow {
  readonly id: string;
  readonly owner_id?: string | null;
  readonly sort_at: Date;
  readonly width: number;
  readonly height: number;
}

export interface PhotosRepo {
  insertUploading(params: InsertUploadingPhotoParams, client?: DbPool | PoolClient): Promise<PhotoRow>;
  getById(id: string, client?: DbPool | PoolClient): Promise<PhotoRow | null>;
  recordConfirm(
    id: string,
    params: { fullEtag: string; thumbEtag: string },
    now?: Date,
    client?: DbPool | PoolClient
  ): Promise<PhotoRow | null>;
  claim(
    id: string,
    leaseSeconds: number,
    maxAttempts: number,
    now?: Date,
    client?: DbPool | PoolClient
  ): Promise<PhotoRow | null>;
  renewLease(
    id: string,
    claimedAttempts: number,
    leaseSeconds: number,
    now?: Date,
    client?: DbPool | PoolClient
  ): Promise<boolean>;
  recordRetryable(
    id: string,
    errorCode: string,
    nextAttemptAt: Date,
    client?: DbPool | PoolClient
  ): Promise<PhotoRow | null>;
  escalateToNeedsReview(
    id: string,
    maxAttempts: number,
    now?: Date,
    client?: DbPool | PoolClient
  ): Promise<PhotoRow | null>;
  markApproved(
    params: {
      id: string;
      harmVerdict: 'pass';
      visionVerdict?: 'pass' | null;
      approvedByOperator?: boolean;
      allowedStatus?: 'pending' | 'needs_review';
      moderatedAt?: Date;
      servedAt?: Date;
    },
    client?: DbPool | PoolClient
  ): Promise<PhotoRow | null>;
  updateStatus(
    id: string,
    expectedStatus: string | readonly string[],
    newStatus: string,
    fields?: {
      rejectReason?: string | null;
      hiddenReason?: string | null;
      harmVerdict?: string | null;
      visionVerdict?: string | null;
      visionFields?: unknown | null;
      moderatedAt?: Date | null;
    },
    client?: DbPool | PoolClient
  ): Promise<PhotoRow | null>;
  listOwn(ownerId: string, limit?: number, client?: DbPool | PoolClient): Promise<readonly PhotoRow[]>;
  listOwnByIds(ownerId: string, ids: readonly string[], client?: DbPool | PoolClient): Promise<readonly PhotoRow[]>;
  listMine(
    ownerId: string,
    targetKind: 'food_log' | 'trip',
    scopeId: string,
    cursor?: { createdAt: Date; id: string },
    limit?: number,
    client?: DbPool | PoolClient
  ): Promise<readonly PhotoRow[]>;
  listAllMine(
    ownerId: string,
    cursor: { createdAt: Date; id: string } | undefined,
    limit: number,
    client?: DbPool | PoolClient
  ): Promise<readonly MyPhotoListRow[]>;
  listFoodByScope(
    params: { scopeId: string; viewerId: string; limit: number; cursor?: { createdAt: Date; id: string } },
    client?: DbPool | PoolClient
  ): Promise<readonly FoodGalleryRow[]>;
  listFoodByExperience(
    params: { experienceId: string; viewerId: string; limit: number; cursor?: { createdAt: Date; id: string } },
    client?: DbPool | PoolClient
  ): Promise<readonly FoodGalleryRow[]>;
  listFoodByLocation(
    params: { locationId: string; viewerId: string; limit: number; cursor?: { createdAt: Date; id: string } },
    client?: DbPool | PoolClient
  ): Promise<readonly FoodGalleryRow[]>;
  listTripPhotos(
    params: ListTripPhotosParams,
    client?: DbPool | PoolClient
  ): Promise<readonly TripPhotoRow[]>;
  listTripApprovedHighlights(
    tripId: string,
    viewerId: string,
    client?: DbPool | PoolClient
  ): Promise<readonly TripHighlightRow[]>;
  lockTarget(targetId: string, client: DbPool | PoolClient): Promise<void>;
  reserveQuota(
    userId: string,
    day: string,
    count: number,
    cap: number,
    client?: DbPool | PoolClient
  ): Promise<{ ok: boolean; uploadCount?: number }>;
  reserveGlobalUploads(
    day: string,
    count: number,
    bytes: number,
    cap: number,
    client?: DbPool | PoolClient
  ): Promise<{ ok: boolean; uploads?: number; uploadBytes?: number }>;
  getUserDailyUploadCount(
    userId: string,
    day: string,
    client?: DbPool | PoolClient
  ): Promise<number>;
  getGlobalDailyUploadCount(
    day: string,
    client?: DbPool | PoolClient
  ): Promise<number>;
  countLiveForTarget(
    targetKind: 'food_log' | 'trip',
    targetId: string,
    now: Date,
    putUrlTtlSeconds: number,
    client?: DbPool | PoolClient
  ): Promise<number>;
  friendIdsAmong(
    viewerId: string,
    ownerIds: readonly string[],
    client?: DbPool | PoolClient
  ): Promise<Set<string>>;
  expireNeedsReview(maxAgeHours: number, now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]>;
  listApprovedNeedingUploadCleanup(
    limit: number,
    olderThanMinutes?: number,
    now?: Date,
    client?: DbPool | PoolClient
  ): Promise<readonly PhotoRow[]>;
  markUploadCleaned(id: string, now?: Date, client?: DbPool | PoolClient): Promise<boolean>;
  findFoodLogOrphanIds(limit: number, client?: DbPool | PoolClient): Promise<readonly string[]>;
  findTripOrphanIds(limit: number, client?: DbPool | PoolClient): Promise<readonly string[]>;
  findOwnerNullOrphanIds(limit: number, client?: DbPool | PoolClient): Promise<readonly string[]>;
  softDeleteByIds(ids: readonly string[], now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]>;
  softDeleteByTarget(
    targetKind: 'food_log' | 'trip',
    targetId: string,
    now?: Date,
    client?: DbPool | PoolClient
  ): Promise<readonly string[]>;
  /** With `limit`, marks at most that many photos `deleted` per call (oldest id first); without it, all of them. */
  softDeleteByOwner(
    ownerId: string,
    now?: Date,
    client?: DbPool | PoolClient,
    limit?: number
  ): Promise<readonly string[]>;
  listDeleted(limit: number, client?: DbPool | PoolClient): Promise<readonly PhotoRow[]>;
  hardDelete(id: string, client?: DbPool | PoolClient): Promise<boolean>;
  incrementDeleteAttempts(id: string, client?: DbPool | PoolClient): Promise<boolean>;
  expireUploading(cutoff: Date, now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]>;
  expireRejected(cutoff: Date, now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]>;
  pruneCounters(cutoffDate: string, client?: DbPool | PoolClient): Promise<number>;
  pruneUsageDaily(cutoffDate: string, client?: DbPool | PoolClient): Promise<number>;
  pruneVisionFields(cutoffDate: Date, client?: DbPool | PoolClient): Promise<number>;
  incrementUsageCounters(
    day: string,
    increments: {
      harmCalls?: number;
      visionCalls?: number;
      promptTokens?: number;
      outputTokens?: number;
      rejections?: number;
      needsReview?: number;
      exifPresent?: number;
    },
    client?: DbPool | PoolClient
  ): Promise<void>;
  listDuePending(limit: number, now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]>;
}

export function createPhotosRepo(pool: DbPool): PhotosRepo {
  const getDb = (client?: DbPool | PoolClient) => client ?? pool;

  return {
    async insertUploading(params: InsertUploadingPhotoParams, client?: DbPool | PoolClient): Promise<PhotoRow> {
      const db = getDb(client);
      const sql = `
        INSERT INTO photos (
          id, owner_id, target_kind, target_id, scope_id,
          object_key, thumb_key, byte_size, thumb_byte_size, width, height,
          taken_at, sort_at, created_at, next_attempt_at, status
        ) VALUES (
          COALESCE($1, gen_random_uuid()), $2, $3, $4, $5,
          $6, $7, $8, $9, $10, $11,
          $12, COALESCE($13, now()), COALESCE($14, now()), now(), 'uploading'
        )
        RETURNING ${PHOTO_SELECT_COLUMNS};
      `;
      const res = await db.query<PhotoRow>(sql, [
        params.id ?? null,
        params.ownerId,
        params.targetKind,
        params.targetId,
        params.scopeId,
        params.objectKey,
        params.thumbKey,
        params.byteSize,
        params.thumbByteSize,
        params.width,
        params.height,
        params.takenAt ?? null,
        params.sortAt ?? null,
        params.createdAt ?? null,
      ]);
      const row = res.rows[0];
      if (!row) throw new Error('insertUploading failed to return row');
      return row;
    },

    async getById(id: string, client?: DbPool | PoolClient): Promise<PhotoRow | null> {
      const db = getDb(client);
      const sql = `SELECT ${PHOTO_SELECT_COLUMNS} FROM photos WHERE id = $1;`;
      const res = await db.query<PhotoRow>(sql, [id]);
      return res.rows[0] ?? null;
    },

    async recordConfirm(
      id: string,
      params: { fullEtag: string; thumbEtag: string },
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<PhotoRow | null> {
      const db = getDb(client);
      const sql = `
        UPDATE photos
           SET status = 'pending',
               confirmed_at = COALESCE(confirmed_at, COALESCE($2, now())),
               full_etag = $3,
               thumb_etag = $4
         WHERE id = $1 AND status IN ('uploading', 'pending')
        RETURNING ${PHOTO_SELECT_COLUMNS};
      `;
      const res = await db.query<PhotoRow>(sql, [id, now ?? null, params.fullEtag, params.thumbEtag]);
      return res.rows[0] ?? null;
    },

    async claim(
      id: string,
      leaseSeconds: number,
      maxAttempts: number,
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<PhotoRow | null> {
      const db = getDb(client);
      const currentTime = now ?? new Date();
      const leaseUntil = new Date(currentTime.getTime() + leaseSeconds * 1000);

      const sql = `
        UPDATE photos
           SET lease_until = $2,
               attempts = attempts + 1
         WHERE id = $1
           AND status = 'pending'
           AND next_attempt_at <= $3
           AND (lease_until IS NULL OR lease_until < $3)
           AND attempts < $4
        RETURNING ${PHOTO_SELECT_COLUMNS};
      `;
      const res = await db.query<PhotoRow>(sql, [id, leaseUntil, currentTime, maxAttempts]);
      return res.rows[0] ?? null;
    },

    async renewLease(
      id: string,
      claimedAttempts: number,
      leaseSeconds: number,
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<boolean> {
      const db = getDb(client);
      const currentTime = now ?? new Date();
      const leaseUntil = new Date(currentTime.getTime() + leaseSeconds * 1000);

      const sql = `
        UPDATE photos
           SET lease_until = $2
         WHERE id = $1
           AND status = 'pending'
           AND attempts = $3
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [id, leaseUntil, claimedAttempts]);
      return res.rows.length > 0;
    },

    async recordRetryable(
      id: string,
      errorCode: string,
      nextAttemptAt: Date,
      client?: DbPool | PoolClient
    ): Promise<PhotoRow | null> {
      const db = getDb(client);
      const sql = `
        UPDATE photos
           SET last_error_code = $2,
               next_attempt_at = $3,
               lease_until = NULL
         WHERE id = $1
           AND status = 'pending'
        RETURNING ${PHOTO_SELECT_COLUMNS};
      `;
      const res = await db.query<PhotoRow>(sql, [id, errorCode, nextAttemptAt]);
      return res.rows[0] ?? null;
    },

    async escalateToNeedsReview(
      id: string,
      maxAttempts: number,
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<PhotoRow | null> {
      const db = getDb(client);
      const currentTime = now ?? new Date();
      const sql = `
        UPDATE photos
           SET status = 'needs_review',
               last_error_code = 'max_attempts'
         WHERE id = $1
           AND status = 'pending'
           AND attempts >= $2
           AND (lease_until IS NULL OR lease_until < $3)
        RETURNING ${PHOTO_SELECT_COLUMNS};
      `;
      const res = await db.query<PhotoRow>(sql, [id, maxAttempts, currentTime]);
      return res.rows[0] ?? null;
    },

    async markApproved(
      params: {
        id: string;
        harmVerdict: 'pass';
        visionVerdict?: 'pass' | null;
        approvedByOperator?: boolean;
        allowedStatus?: 'pending' | 'needs_review';
        moderatedAt?: Date;
        servedAt?: Date;
      },
      client?: DbPool | PoolClient
    ): Promise<PhotoRow | null> {
      const db = getDb(client);
      const allowedStatus = params.allowedStatus ?? 'pending';
      const sql = `
        UPDATE photos
           SET status = 'approved',
               moderated_at = COALESCE($2, now()),
               served_at = COALESCE($3, now()),
               harm_verdict = $4,
               vision_verdict = $5,
               approved_by_operator = $6
         WHERE id = $1
           AND status = $7
        RETURNING ${PHOTO_SELECT_COLUMNS};
      `;
      const res = await db.query<PhotoRow>(sql, [
        params.id,
        params.moderatedAt ?? null,
        params.servedAt ?? null,
        params.harmVerdict,
        params.visionVerdict ?? null,
        params.approvedByOperator ?? false,
        allowedStatus,
      ]);
      return res.rows[0] ?? null;
    },

    async updateStatus(
      id: string,
      expectedStatus: string | readonly string[],
      newStatus: string,
      fields?: {
        rejectReason?: string | null;
        hiddenReason?: string | null;
        harmVerdict?: string | null;
        visionVerdict?: string | null;
        visionFields?: unknown | null;
        moderatedAt?: Date | null;
      },
      client?: DbPool | PoolClient
    ): Promise<PhotoRow | null> {
      const db = getDb(client);
      const statuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];

      const sql = `
        UPDATE photos
           SET status = $2,
               reject_reason = COALESCE($3, reject_reason),
               hidden_reason = COALESCE($4, hidden_reason),
               harm_verdict = COALESCE($5, harm_verdict),
               vision_verdict = COALESCE($6, vision_verdict),
               vision_fields = COALESCE($7, vision_fields),
               moderated_at = COALESCE($8, moderated_at)
         WHERE id = $1
           AND status = ANY($9)
        RETURNING ${PHOTO_SELECT_COLUMNS};
      `;
      const res = await db.query<PhotoRow>(sql, [
        id,
        newStatus,
        fields?.rejectReason ?? null,
        fields?.hiddenReason ?? null,
        fields?.harmVerdict ?? null,
        fields?.visionVerdict ?? null,
        fields?.visionFields ? JSON.stringify(fields.visionFields) : null,
        fields?.moderatedAt ?? null,
        statuses,
      ]);
      return res.rows[0] ?? null;
    },

    async listOwn(ownerId: string, limit: number = 50, client?: DbPool | PoolClient): Promise<readonly PhotoRow[]> {
      const db = getDb(client);
      const sql = `
        SELECT ${PHOTO_SELECT_COLUMNS}
          FROM photos
         WHERE owner_id = $1
           AND status <> 'deleted'
         ORDER BY created_at DESC, id DESC
         LIMIT $2;
      `;
      const res = await db.query<PhotoRow>(sql, [ownerId, limit]);
      return res.rows;
    },

    async listOwnByIds(
      ownerId: string,
      ids: readonly string[],
      client?: DbPool | PoolClient
    ): Promise<readonly PhotoRow[]> {
      const db = getDb(client);
      if (ids.length === 0) return [];
      const sql = `
        SELECT ${PHOTO_SELECT_COLUMNS}
          FROM photos
         WHERE owner_id = $1
           AND id = ANY($2)
           AND status <> 'deleted';
      `;
      const res = await db.query<PhotoRow>(sql, [ownerId, ids]);
      return res.rows;
    },

    async listMine(
      ownerId: string,
      targetKind: 'food_log' | 'trip',
      scopeId: string,
      cursor?: { createdAt: Date; id: string },
      limit: number = 50,
      client?: DbPool | PoolClient
    ): Promise<readonly PhotoRow[]> {
      const db = getDb(client);
      if (!cursor) {
        const sql = `
          SELECT ${PHOTO_SELECT_COLUMNS}
            FROM photos
           WHERE owner_id = $1
             AND target_kind = $2
             AND scope_id = $3
             AND status <> 'deleted'
           ORDER BY created_at DESC, id DESC
           LIMIT $4;
        `;
        const res = await db.query<PhotoRow>(sql, [ownerId, targetKind, scopeId, limit]);
        return res.rows;
      }

      const sql = `
        SELECT ${PHOTO_SELECT_COLUMNS}
          FROM photos
         WHERE owner_id = $1
           AND target_kind = $2
           AND scope_id = $3
           AND status <> 'deleted'
           AND (created_at < $4 OR (created_at = $4 AND id < $5))
         ORDER BY created_at DESC, id DESC
         LIMIT $6;
      `;
      const res = await db.query<PhotoRow>(sql, [
        ownerId,
        targetKind,
        scopeId,
        cursor.createdAt,
        cursor.id,
        limit,
      ]);
      return res.rows;
    },

    async listAllMine(
      ownerId: string,
      cursor: { createdAt: Date; id: string } | undefined,
      limit: number,
      client?: DbPool | PoolClient
    ): Promise<readonly MyPhotoListRow[]> {
      const db = getDb(client);
      if (!cursor) {
        const res = await db.query<MyPhotoListRow>(SQL_MY_PHOTOS_FIRST_PAGE, [ownerId, limit]);
        return res.rows;
      }
      const res = await db.query<MyPhotoListRow>(SQL_MY_PHOTOS_NEXT_PAGE, [
        ownerId,
        cursor.createdAt,
        cursor.id,
        limit,
      ]);
      return res.rows;
    },

    async listFoodByScope(
      params: { scopeId: string; viewerId: string; limit: number; cursor?: { createdAt: Date; id: string } },
      client?: DbPool | PoolClient
    ): Promise<readonly FoodGalleryRow[]> {
      const db = getDb(client);
      if (!params.cursor) {
        const res = await db.query<FoodGalleryRow>(SQL_DISH_GALLERY_FIRST_PAGE, [
          params.scopeId,
          params.viewerId,
          params.limit,
        ]);
        return res.rows;
      }
      const res = await db.query<FoodGalleryRow>(SQL_DISH_GALLERY_PAGINATED, [
        params.scopeId,
        params.viewerId,
        params.cursor.createdAt,
        params.cursor.id,
        params.limit,
      ]);
      return res.rows;
    },

    async listFoodByExperience(
      params: { experienceId: string; viewerId: string; limit: number; cursor?: { createdAt: Date; id: string } },
      client?: DbPool | PoolClient
    ): Promise<readonly FoodGalleryRow[]> {
      const db = getDb(client);
      if (!params.cursor) {
        const res = await db.query<FoodGalleryRow>(SQL_EXPERIENCE_GALLERY_FIRST_PAGE, [
          params.experienceId,
          params.viewerId,
          params.limit,
        ]);
        return res.rows;
      }
      const res = await db.query<FoodGalleryRow>(SQL_EXPERIENCE_GALLERY_PAGINATED, [
        params.experienceId,
        params.viewerId,
        params.cursor.createdAt,
        params.cursor.id,
        params.limit,
      ]);
      return res.rows;
    },

    async listFoodByLocation(
      params: { locationId: string; viewerId: string; limit: number; cursor?: { createdAt: Date; id: string } },
      client?: DbPool | PoolClient
    ): Promise<readonly FoodGalleryRow[]> {
      const db = getDb(client);
      if (!params.cursor) {
        const res = await db.query<FoodGalleryRow>(SQL_LOCATION_GALLERY_FIRST_PAGE, [
          params.locationId,
          params.viewerId,
          params.limit,
        ]);
        return res.rows;
      }
      const res = await db.query<FoodGalleryRow>(SQL_LOCATION_GALLERY_PAGINATED, [
        params.locationId,
        params.viewerId,
        params.cursor.createdAt,
        params.cursor.id,
        params.limit,
      ]);
      return res.rows;
    },

    async listTripPhotos(
      params: ListTripPhotosParams,
      client?: DbPool | PoolClient
    ): Promise<readonly TripPhotoRow[]> {
      const db = getDb(client);
      if (!params.cursor) {
        const res = await db.query<TripPhotoRow>(SQL_TRIP_ALBUM_FIRST_PAGE, [
          params.tripId,
          params.viewerId,
          params.limit,
        ]);
        return res.rows.map((r) => ({
          ...r,
          sort_at: new Date(r.sort_at),
          created_at: new Date(r.created_at),
        }));
      }
      const res = await db.query<TripPhotoRow>(SQL_TRIP_ALBUM_PAGINATED, [
        params.tripId,
        params.viewerId,
        params.cursor.sortAt,
        params.cursor.id,
        params.limit,
      ]);
      return res.rows.map((r) => ({
        ...r,
        sort_at: new Date(r.sort_at),
        created_at: new Date(r.created_at),
      }));
    },

    async listTripApprovedHighlights(
      tripId: string,
      viewerId: string,
      client?: DbPool | PoolClient
    ): Promise<readonly TripHighlightRow[]> {
      const db = getDb(client);
      const res = await db.query<TripHighlightRow>(SQL_TRIP_APPROVED_HIGHLIGHTS, [tripId, viewerId]);
      return res.rows.map((r) => ({
        ...r,
        sort_at: new Date(r.sort_at),
      }));
    },

    async lockTarget(targetId: string, client: DbPool | PoolClient): Promise<void> {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1));', [targetId]);
    },

    async reserveQuota(
      userId: string,
      day: string,
      count: number,
      cap: number,
      client?: DbPool | PoolClient
    ): Promise<{ ok: boolean; uploadCount?: number }> {
      const db = getDb(client);
      await db.query(
        `INSERT INTO photo_upload_counters(user_id, day, upload_count)
         VALUES ($1, $2, 0)
         ON CONFLICT (user_id, day) DO NOTHING;`,
        [userId, day]
      );

      const res = await db.query<{ upload_count: number }>(
        `UPDATE photo_upload_counters
            SET upload_count = upload_count + $3
          WHERE user_id = $1 AND day = $2 AND upload_count + $3 <= $4
         RETURNING upload_count;`,
        [userId, day, count, cap]
      );

      if (res.rows.length === 0 || !res.rows[0]) {
        return { ok: false };
      }
      return { ok: true, uploadCount: res.rows[0].upload_count };
    },

    async reserveGlobalUploads(
      day: string,
      count: number,
      bytes: number,
      cap: number,
      client?: DbPool | PoolClient
    ): Promise<{ ok: boolean; uploads?: number; uploadBytes?: number }> {
      const db = getDb(client);
      await db.query(
        `INSERT INTO photo_usage_daily(day)
         VALUES ($1)
         ON CONFLICT (day) DO NOTHING;`,
        [day]
      );

      const res = await db.query<{ uploads: number; upload_bytes: string }>(
        `UPDATE photo_usage_daily
            SET uploads = uploads + $2,
                upload_bytes = upload_bytes + $3
          WHERE day = $1 AND uploads + $2 <= $4
         RETURNING uploads, upload_bytes;`,
        [day, count, bytes, cap]
      );

      if (res.rows.length === 0 || !res.rows[0]) {
        return { ok: false };
      }
      return {
        ok: true,
        uploads: res.rows[0].uploads,
        uploadBytes: Number(res.rows[0].upload_bytes),
      };
    },

    async getUserDailyUploadCount(
      userId: string,
      day: string,
      client?: DbPool | PoolClient
    ): Promise<number> {
      const db = getDb(client);
      const res = await db.query<{ upload_count: number }>(
        `SELECT upload_count FROM photo_upload_counters WHERE user_id = $1 AND day = $2;`,
        [userId, day]
      );
      return res.rows[0]?.upload_count ?? 0;
    },

    async getGlobalDailyUploadCount(
      day: string,
      client?: DbPool | PoolClient
    ): Promise<number> {
      const db = getDb(client);
      const res = await db.query<{ uploads: number }>(
        `SELECT uploads FROM photo_usage_daily WHERE day = $1;`,
        [day]
      );
      return res.rows[0]?.uploads ?? 0;
    },

    async countLiveForTarget(
      targetKind: 'food_log' | 'trip',
      targetId: string,
      now: Date,
      putUrlTtlSeconds: number,
      client?: DbPool | PoolClient
    ): Promise<number> {
      const db = getDb(client);
      const cutoff = new Date(now.getTime() - putUrlTtlSeconds * 1000);
      const sql = `
        SELECT COUNT(*)::int AS count
          FROM photos
         WHERE target_kind = $1
           AND target_id = $2
           AND status <> 'deleted'
           AND NOT (status = 'uploading' AND created_at < $3);
      `;
      const res = await db.query<{ count: number }>(sql, [targetKind, targetId, cutoff]);
      return res.rows[0]?.count ?? 0;
    },

    async friendIdsAmong(
      viewerId: string,
      ownerIds: readonly string[],
      client?: DbPool | PoolClient
    ): Promise<Set<string>> {
      const db = getDb(client);
      if (ownerIds.length === 0) return new Set();

      const sql = `
        SELECT DISTINCT CASE WHEN user_lo_id = $1 THEN user_hi_id ELSE user_lo_id END AS friend_id
          FROM active_friendships
         WHERE (user_lo_id = $1 AND user_hi_id = ANY($2))
            OR (user_hi_id = $1 AND user_lo_id = ANY($2));
      `;
      const res = await db.query<{ friend_id: string }>(sql, [viewerId, ownerIds]);
      return new Set(res.rows.map((r) => r.friend_id));
    },

    async expireNeedsReview(
      maxAgeHours: number,
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<readonly string[]> {
      const db = getDb(client);
      const currentTime = now ?? new Date();
      const cutoff = new Date(currentTime.getTime() - maxAgeHours * 3600 * 1000);

      const sql = `
        UPDATE photos
           SET status = 'deleted',
               deleted_at = $2
         WHERE status = 'needs_review'
           AND created_at < $1
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [cutoff, currentTime]);
      return res.rows.map((r) => r.id);
    },

    async listApprovedNeedingUploadCleanup(
      limit: number,
      olderThanMinutes: number = 60,
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<readonly PhotoRow[]> {
      const db = getDb(client);
      const currentTime = now ?? new Date();
      const cutoff = new Date(currentTime.getTime() - olderThanMinutes * 60 * 1000);

      const sql = `
        SELECT ${PHOTO_SELECT_COLUMNS}
          FROM photos
         WHERE status IN ('approved', 'hidden')
           AND served_at < $1
           AND upload_cleaned_at IS NULL
         ORDER BY served_at ASC
         LIMIT $2;
      `;
      const res = await db.query<PhotoRow>(sql, [cutoff, limit]);
      return res.rows;
    },

    async markUploadCleaned(id: string, now?: Date, client?: DbPool | PoolClient): Promise<boolean> {
      const db = getDb(client);
      const sql = `
        UPDATE photos
           SET upload_cleaned_at = COALESCE($2, now())
         WHERE id = $1
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [id, now ?? null]);
      return res.rows.length > 0;
    },

    async findFoodLogOrphanIds(limit: number, client?: DbPool | PoolClient): Promise<readonly string[]> {
      const db = getDb(client);
      const sql = `
        SELECT p.id
          FROM photos p
         WHERE p.target_kind = 'food_log'
           AND p.status <> 'deleted'
           AND NOT EXISTS (SELECT 1 FROM food_item_logs l WHERE l.id = p.target_id)
         LIMIT $1;
      `;
      const res = await db.query<{ id: string }>(sql, [limit]);
      return res.rows.map((r) => r.id);
    },

    async findTripOrphanIds(limit: number, client?: DbPool | PoolClient): Promise<readonly string[]> {
      const db = getDb(client);
      // Anti-join (equivalent to NOT EXISTS because `trips.id` is the primary
      // key): pg-mem cannot resolve `p.target_id` inside a correlated NOT EXISTS
      // subquery over `trips`, and this form runs unchanged on Postgres.
      const sql = `
        SELECT p.id
          FROM photos p
          LEFT JOIN trips t ON t.id = p.target_id
         WHERE p.target_kind = 'trip'
           AND p.status <> 'deleted'
           AND t.id IS NULL
         LIMIT $1;
      `;
      const res = await db.query<{ id: string }>(sql, [limit]);
      return res.rows.map((r) => r.id);
    },

    async findOwnerNullOrphanIds(limit: number, client?: DbPool | PoolClient): Promise<readonly string[]> {
      const db = getDb(client);
      const sql = `
        SELECT p.id
          FROM photos p
         WHERE p.owner_id IS NULL
           AND p.status <> 'deleted'
         LIMIT $1;
      `;
      const res = await db.query<{ id: string }>(sql, [limit]);
      return res.rows.map((r) => r.id);
    },

    async softDeleteByIds(
      ids: readonly string[],
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<readonly string[]> {
      const db = getDb(client);
      if (ids.length === 0) return [];
      const sql = `
        UPDATE photos
           SET status = 'deleted',
               deleted_at = COALESCE($2, now())
         WHERE id = ANY($1)
           AND status <> 'deleted'
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [ids, now ?? null]);
      return res.rows.map((r) => r.id);
    },

    async softDeleteByTarget(
      targetKind: 'food_log' | 'trip',
      targetId: string,
      now?: Date,
      client?: DbPool | PoolClient
    ): Promise<readonly string[]> {
      const db = getDb(client);
      const sql = `
        UPDATE photos
           SET status = 'deleted',
               deleted_at = COALESCE($3, now())
         WHERE target_kind = $1
           AND target_id = $2
           AND status <> 'deleted'
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [targetKind, targetId, now ?? null]);
      return res.rows.map((r) => r.id);
    },

    async softDeleteByOwner(
      ownerId: string,
      now?: Date,
      client?: DbPool | PoolClient,
      limit?: number
    ): Promise<readonly string[]> {
      const db = getDb(client);
      if (limit === undefined) {
        const sql = `
        UPDATE photos
           SET status = 'deleted',
               deleted_at = COALESCE($2, now())
         WHERE owner_id = $1
           AND status <> 'deleted'
        RETURNING id;
      `;
        const res = await db.query<{ id: string }>(sql, [ownerId, now ?? null]);
        return res.rows.map((r) => r.id);
      }
      if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError(`softDeleteByOwner: limit must be a positive integer, got ${String(limit)}`);
      }
      // Bounded form: at most `limit` rows per call. Rows already `deleted` drop out of the page, so a
      // caller repeating until fewer than `limit` ids return reaches none left. Two statements (read a
      // page of ids, then mark exactly those) keep the cap explicit and independent of how a planner
      // evaluates a LIMIT subselect inside an UPDATE.
      const page = await db.query<{ id: string }>(
        `SELECT id FROM photos
          WHERE owner_id = $1
            AND status <> 'deleted'
          ORDER BY id
          LIMIT $2;`,
        [ownerId, limit]
      );
      const ids = page.rows.map((r) => r.id);
      if (ids.length === 0) return [];
      const marked = await db.query<{ id: string }>(
        `UPDATE photos
            SET status = 'deleted',
                deleted_at = COALESCE($2, now())
          WHERE id = ANY($1)
            AND status <> 'deleted'
         RETURNING id;`,
        [ids, now ?? null]
      );
      return marked.rows.map((r) => r.id);
    },

    async listDeleted(limit: number, client?: DbPool | PoolClient): Promise<readonly PhotoRow[]> {
      const db = getDb(client);
      const sql = `
        SELECT ${PHOTO_SELECT_COLUMNS}
          FROM photos
         WHERE status = 'deleted'
         ORDER BY deleted_at ASC, id ASC
         LIMIT $1;
      `;
      const res = await db.query<PhotoRow>(sql, [limit]);
      return res.rows;
    },

    async hardDelete(id: string, client?: DbPool | PoolClient): Promise<boolean> {
      const db = getDb(client);
      const sql = `DELETE FROM photos WHERE id = $1 AND status = 'deleted' RETURNING id;`;
      const res = await db.query<{ id: string }>(sql, [id]);
      return res.rows.length > 0;
    },

    async incrementDeleteAttempts(id: string, client?: DbPool | PoolClient): Promise<boolean> {
      const db = getDb(client);
      const sql = `UPDATE photos SET delete_attempts = delete_attempts + 1 WHERE id = $1 RETURNING id;`;
      const res = await db.query<{ id: string }>(sql, [id]);
      return res.rows.length > 0;
    },

    async expireUploading(cutoff: Date, now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]> {
      const db = getDb(client);
      const sql = `
        UPDATE photos
           SET status = 'deleted',
               deleted_at = COALESCE($2, now())
         WHERE status = 'uploading'
           AND created_at < $1
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [cutoff, now ?? null]);
      return res.rows.map((r) => r.id);
    },

    async expireRejected(cutoff: Date, now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]> {
      const db = getDb(client);
      const sql = `
        UPDATE photos
           SET status = 'deleted',
               deleted_at = COALESCE($2, now())
         WHERE status = 'rejected'
           AND moderated_at < $1
        RETURNING id;
      `;
      const res = await db.query<{ id: string }>(sql, [cutoff, now ?? null]);
      return res.rows.map((r) => r.id);
    },

    async pruneCounters(cutoffDate: string, client?: DbPool | PoolClient): Promise<number> {
      const db = getDb(client);
      const sql = `DELETE FROM photo_upload_counters WHERE day < $1;`;
      const res = await db.query(sql, [cutoffDate]);
      return res.rowCount ?? 0;
    },

    async pruneUsageDaily(cutoffDate: string, client?: DbPool | PoolClient): Promise<number> {
      const db = getDb(client);
      const sql = `DELETE FROM photo_usage_daily WHERE day < $1;`;
      const res = await db.query(sql, [cutoffDate]);
      return res.rowCount ?? 0;
    },

    async pruneVisionFields(cutoffDate: Date, client?: DbPool | PoolClient): Promise<number> {
      const db = getDb(client);
      const sql = `
        UPDATE photos
           SET vision_fields = NULL
         WHERE created_at < $1
           AND vision_fields IS NOT NULL;
      `;
      const res = await db.query(sql, [cutoffDate]);
      return res.rowCount ?? 0;
    },

    async incrementUsageCounters(
      day: string,
      increments: {
        harmCalls?: number;
        visionCalls?: number;
        promptTokens?: number;
        outputTokens?: number;
        rejections?: number;
        needsReview?: number;
        exifPresent?: number;
      },
      client?: DbPool | PoolClient
    ): Promise<void> {
      const db = getDb(client);
      const sql = `
        INSERT INTO photo_usage_daily (
          day, harm_calls, vision_calls, vision_prompt_tokens, vision_output_tokens,
          rejections, needs_review, exif_present
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (day) DO UPDATE SET
          harm_calls = photo_usage_daily.harm_calls + EXCLUDED.harm_calls,
          vision_calls = photo_usage_daily.vision_calls + EXCLUDED.vision_calls,
          vision_prompt_tokens = photo_usage_daily.vision_prompt_tokens + EXCLUDED.vision_prompt_tokens,
          vision_output_tokens = photo_usage_daily.vision_output_tokens + EXCLUDED.vision_output_tokens,
          rejections = photo_usage_daily.rejections + EXCLUDED.rejections,
          needs_review = photo_usage_daily.needs_review + EXCLUDED.needs_review,
          exif_present = photo_usage_daily.exif_present + EXCLUDED.exif_present;
      `;
      await db.query(sql, [
        day,
        increments.harmCalls ?? 0,
        increments.visionCalls ?? 0,
        increments.promptTokens ?? 0,
        increments.outputTokens ?? 0,
        increments.rejections ?? 0,
        increments.needsReview ?? 0,
        increments.exifPresent ?? 0,
      ]);
    },

    async listDuePending(limit: number, now?: Date, client?: DbPool | PoolClient): Promise<readonly string[]> {
      const db = getDb(client);
      const currentTime = now ?? new Date();
      const sql = `
        SELECT id
          FROM photos
         WHERE status = 'pending'
           AND next_attempt_at <= $1
           AND (lease_until IS NULL OR lease_until < $1)
         ORDER BY next_attempt_at ASC, id ASC
         LIMIT $2;
      `;
      const res = await db.query<{ id: string }>(sql, [currentTime, limit]);
      return res.rows.map((r) => r.id);
    },
  };
}
