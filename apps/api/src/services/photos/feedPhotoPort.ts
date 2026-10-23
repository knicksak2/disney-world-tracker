/**
 * FeedPhotoPort implementation — batches photo slot calculation for feed items.
 *
 * Implements: Task 20.2
 * Validates: Requirements 14.4, 14.5, 14.6, 14.7, 14.9, 14.10, 14.11, 14.14, 17.3
 */

import type { PhotoStatus, TripPostPhotoSlotDTO } from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import type { FeedPhotoPort, FeedPostPhotos, ObjectStore } from './ports.js';
import { readKeysFor, tripPostSlotState } from './domain/accessPolicy.js';

export interface DefaultFeedPhotoPortOptions {
  readonly pool: DbPool;
  readonly store: ObjectStore;
  readonly urlTtlSeconds?: number;
}

interface PhotoRow {
  id: string;
  ownerId: string | null;
  status: PhotoStatus;
  width: number | null;
  height: number | null;
  isBlocked: boolean;
}

export class DefaultFeedPhotoPort implements FeedPhotoPort {
  private readonly pool: DbPool;
  private readonly store: ObjectStore;
  private readonly urlTtlSeconds: number;

  constructor(options: DefaultFeedPhotoPortOptions) {
    this.pool = options.pool;
    this.store = options.store;
    this.urlTtlSeconds = options.urlTtlSeconds ?? 3600;
  }

  async slotsForFeedItems(
    tripId: string,
    viewerId: string,
    feedItemIds: readonly string[],
  ): Promise<Map<string, FeedPostPhotos>> {
    const resultMap = new Map<string, FeedPostPhotos>();
    if (feedItemIds.length === 0) {
      return resultMap;
    }

    // Statement 1: Post rows with actor_id and metadata->'photoIds'
    const sqlPosts = `
      SELECT id, actor_id, metadata->'photoIds' AS photo_ids
        FROM trip_feed_items
       WHERE trip_id = $1
         AND id = ANY($2)
         AND type = 'member_post';
    `;

    const res1 = await this.pool.query<{
      id: string;
      actor_id: string;
      photo_ids: unknown;
    }>(sqlPosts, [tripId, feedItemIds]);

    const posts = res1.rows.map((row) => {
      let photoIds: string[] = [];
      if (Array.isArray(row.photo_ids)) {
        photoIds = row.photo_ids.map((id) => String(id));
      } else if (typeof row.photo_ids === 'string') {
        try {
          const parsed = JSON.parse(row.photo_ids);
          if (Array.isArray(parsed)) {
            photoIds = parsed.map((id) => String(id));
          }
        } catch {
          photoIds = [];
        }
      }
      return {
        id: row.id,
        actorId: row.actor_id,
        photoIds,
      };
    });

    const allPhotoIds = [...new Set(posts.flatMap((p) => p.photoIds))];

    // Statement 2: Photo rows for union of listed photo IDs, explicit columns, scope_id = tripId
    const sqlPhotos = `
      SELECT p.id,
             p.owner_id,
             p.status,
             p.width,
             p.height,
             CASE
               WHEN p.owner_id IS NOT NULL AND (
                 p.owner_id IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = $3)
                 OR p.owner_id IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = $3)
               ) THEN true
               ELSE false
             END AS is_blocked
        FROM photos p
        LEFT JOIN users ou ON ou.id = p.owner_id
       WHERE p.scope_id = $1
         AND p.id = ANY($2)
         AND (p.owner_id IS NULL OR ou.deletion_state = 'active');
    `;

    const res2 = await this.pool.query<{
      id: string;
      owner_id: string | null;
      status: PhotoStatus;
      width: number | null;
      height: number | null;
      is_blocked: boolean;
    }>(sqlPhotos, [tripId, allPhotoIds, viewerId]);

    const photosById = new Map<string, PhotoRow>();
    for (const row of res2.rows) {
      photosById.set(row.id, {
        id: row.id,
        ownerId: row.owner_id,
        status: row.status,
        width: row.width,
        height: row.height,
        isBlocked: Boolean(row.is_blocked),
      });
    }

    for (const post of posts) {
      const authorId = post.actorId;
      const isMine = authorId === viewerId;
      const slots: TripPostPhotoSlotDTO[] = [];

      for (const photoId of post.photoIds) {
        const photo = photosById.get(photoId);
        if (!photo) {
          slots.push({
            photoId,
            state: 'removed',
            mine: isMine,
            status: null,
            thumbUrl: null,
            url: null,
            width: null,
            height: null,
          });
          continue;
        }

        const slotState = tripPostSlotState({
          status: photo.status,
          mine: isMine,
          blocked: photo.isBlocked,
        });

        const readKeys = readKeysFor(
          { status: photo.status, viewer: isMine ? 'owner' : 'other' },
          photo.id,
        );

        let thumbUrl: string | null = null;
        let url: string | null = null;
        let width: number | null = null;
        let height: number | null = null;

        if (slotState === 'ready' && readKeys.full && readKeys.thumb) {
          // Serving keys come from readKeysFor (photo id + status), never from the row's
          // object_key / thumb_key columns, which keep the deleted `u/` upload keys.
          const [fullSigned, thumbSigned] = await Promise.all([
            this.store.presignGet({ key: readKeys.full, expiresInSeconds: this.urlTtlSeconds }),
            this.store.presignGet({ key: readKeys.thumb, expiresInSeconds: this.urlTtlSeconds }),
          ]);
          url = fullSigned;
          thumbUrl = thumbSigned;
          width = photo.width;
          height = photo.height;
        } else if (
          isMine &&
          (slotState === 'checking' ||
            photo.status === 'uploading' ||
            photo.status === 'pending' ||
            photo.status === 'needs_review')
        ) {
          const thumbKey = readKeys.uploadThumb ?? readKeys.thumb;
          if (thumbKey) {
            thumbUrl = await this.store.presignGet({
              key: thumbKey,
              expiresInSeconds: this.urlTtlSeconds,
            });
            width = photo.width;
            height = photo.height;
          }
        }

        slots.push({
          photoId,
          state: slotState,
          mine: isMine,
          status: isMine ? photo.status : (slotState === 'ready' ? 'approved' : null),
          thumbUrl,
          url,
          width,
          height,
        });
      }

      resultMap.set(post.id, {
        authorId,
        slots,
      });
    }

    return resultMap;
  }
}
