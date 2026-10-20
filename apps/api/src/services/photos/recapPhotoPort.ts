/**
 * RecapPhotoPort implementation — selects and presigns trip recap highlight photos.
 *
 * Implements: Task 21.3, Task 21.4, Task 21.6
 * Validates: Requirements 15.4, 15.5, 15.27 to 15.29, 16.8, 16.10, decisions D21, D29, D32, D35
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import type { ObjectStore } from './ports.js';
import type { RecapAlbumPage, RecapPhotoPort, RecapShareAccess } from '../sharing/ports.js';
import type { SharedSummaryPhotoDTO } from '@dwt/shared';
import { decodeAlbumCursor, encodeAlbumCursor } from './domain/albumCursor.js';
import { selectRecapHighlights } from './domain/recapHighlights.js';
import { photoKeys } from './domain/objectKeys.js';

export interface DefaultRecapPhotoPortOptions {
  readonly pool: DbPool;
  readonly store: ObjectStore;
  readonly recapHighlightMax?: number;
  readonly urlTtlSeconds?: number;
}

export class DefaultRecapPhotoPort implements RecapPhotoPort {
  private readonly pool: DbPool;
  private readonly store: ObjectStore;
  private readonly recapHighlightMax: number;
  private readonly urlTtlSeconds: number;

  constructor(options: DefaultRecapPhotoPortOptions) {
    this.pool = options.pool;
    this.store = options.store;
    this.recapHighlightMax = options.recapHighlightMax ?? 6;
    this.urlTtlSeconds = options.urlTtlSeconds ?? 3600;
  }

  async highlights(access: RecapShareAccess, recipientId: string): Promise<SharedSummaryPhotoDTO[]> {
    if (!access.tripAvailable || !access.includePhotos) {
      return [];
    }

    const sql = `
      SELECT p.id, p.sort_at, p.width, p.height
        FROM photos p
       WHERE p.target_kind = 'trip'
         AND p.target_id = $1
         AND p.status = 'approved'
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
            WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
               OR (b.blocker_id = p.owner_id AND b.blocked_id = $2)
         )
       ORDER BY p.sort_at ASC, p.id ASC;
    `;

    const res = await this.pool.query<{
      id: string;
      sort_at: string | Date;
      width: number;
      height: number;
    }>(sql, [access.tripId, recipientId]);

    const candidates = res.rows.map((row) => ({
      id: row.id,
      sortAt: new Date(row.sort_at),
      width: row.width,
      height: row.height,
    }));

    const selected = selectRecapHighlights(candidates, this.recapHighlightMax);

    const items: SharedSummaryPhotoDTO[] = await Promise.all(
      selected.map(async (photo) => {
        // Serving keys derive from the photo id (all candidates are `approved`). The row's
        // object_key / thumb_key still hold the deleted `u/` upload keys, so never use them.
        const keys = photoKeys(photo.id);
        const [url, thumbUrl] = await Promise.all([
          this.store.presignGet({ key: keys.full, expiresInSeconds: this.urlTtlSeconds }),
          this.store.presignGet({ key: keys.thumb, expiresInSeconds: this.urlTtlSeconds }),
        ]);
        return {
          id: photo.id,
          thumbUrl,
          url,
          width: photo.width,
          height: photo.height,
          sortAt: photo.sortAt.toISOString(),
        };
      })
    );

    return items;
  }

  async isHighlight(access: RecapShareAccess, recipientId: string, photoId: string): Promise<boolean> {
    const items = await this.highlights(access, recipientId);
    return items.some((item) => item.id === photoId);
  }

  /**
   * One keyset page of every approved, not-blocked photo of the share's Trip (decision D35).
   * Selects only id, sort_at, width, height so no identity can leak; URLs come from
   * `photoKeys(id)` only.
   */
  async albumPage(
    access: RecapShareAccess,
    recipientId: string,
    params: { readonly cursor?: string | undefined; readonly limit: number },
  ): Promise<RecapAlbumPage> {
    if (!access.tripAvailable || !access.includePhotos) {
      return { photos: [], nextCursor: null };
    }

    let res: { rows: AlbumRow[] };
    if (params.cursor === undefined) {
      res = await this.pool.query<AlbumRow>(SQL_RECAP_ALBUM_FIRST_PAGE, [
        access.tripId,
        recipientId,
        params.limit + 1,
      ]);
    } else {
      const decoded = decodeAlbumCursor(params.cursor);
      if (!decoded) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      res = await this.pool.query<AlbumRow>(SQL_RECAP_ALBUM_PAGINATED, [
        access.tripId,
        recipientId,
        decoded.sortAt,
        decoded.id,
        params.limit + 1,
      ]);
    }

    const hasMore = res.rows.length > params.limit;
    const pageRows = res.rows.slice(0, params.limit);

    const photos: SharedSummaryPhotoDTO[] = await Promise.all(
      pageRows.map(async (row) => {
        // Serving keys derive from the photo id (every row is `approved`). The row's
        // object_key / thumb_key still hold the deleted `u/` upload keys, so never use them.
        const keys = photoKeys(row.id);
        const [url, thumbUrl] = await Promise.all([
          this.store.presignGet({ key: keys.full, expiresInSeconds: this.urlTtlSeconds }),
          this.store.presignGet({ key: keys.thumb, expiresInSeconds: this.urlTtlSeconds }),
        ]);
        return {
          id: row.id,
          thumbUrl,
          url,
          width: row.width,
          height: row.height,
          sortAt: new Date(row.sort_at).toISOString(),
        };
      }),
    );

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeAlbumCursor({ sortAt: new Date(last.sort_at), id: last.id })
        : null;

    return { photos, nextCursor };
  }

  /**
   * True when the photo is an approved photo of the share's Trip that is not blocked either way
   * with the recipient (decision D35, widens D32). Runs no query when the gate flags forbid it.
   */
  async isAlbumPhoto(access: RecapShareAccess, recipientId: string, photoId: string): Promise<boolean> {
    if (!access.tripAvailable || !access.includePhotos) {
      return false;
    }
    const res = await this.pool.query(SQL_RECAP_IS_ALBUM_PHOTO, [photoId, access.tripId, recipientId]);
    return res.rows.length > 0;
  }
}

interface AlbumRow {
  id: string;
  sort_at: string | Date;
  width: number;
  height: number;
}

const SQL_RECAP_ALBUM_FIRST_PAGE = `
  SELECT p.id, p.sort_at, p.width, p.height
    FROM photos p
   WHERE p.target_kind = 'trip'
     AND p.target_id = $1
     AND p.status = 'approved'
     AND NOT EXISTS (
       SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
           OR (b.blocker_id = p.owner_id AND b.blocked_id = $2)
     )
   ORDER BY p.sort_at DESC, p.id DESC
   LIMIT $3;
`;

const SQL_RECAP_ALBUM_PAGINATED = `
  SELECT p.id, p.sort_at, p.width, p.height
    FROM photos p
   WHERE p.target_kind = 'trip'
     AND p.target_id = $1
     AND p.status = 'approved'
     AND (p.sort_at < $3 OR (p.sort_at = $3 AND p.id < $4))
     AND NOT EXISTS (
       SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = $2 AND b.blocked_id = p.owner_id)
           OR (b.blocker_id = p.owner_id AND b.blocked_id = $2)
     )
   ORDER BY p.sort_at DESC, p.id DESC
   LIMIT $5;
`;

const SQL_RECAP_IS_ALBUM_PHOTO = `
  SELECT 1
    FROM photos p
   WHERE p.id = $1
     AND p.target_kind = 'trip'
     AND p.target_id = $2
     AND p.status = 'approved'
     AND NOT EXISTS (
       SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = $3 AND b.blocked_id = p.owner_id)
           OR (b.blocker_id = p.owner_id AND b.blocked_id = $3)
     )
   LIMIT 1;
`;
