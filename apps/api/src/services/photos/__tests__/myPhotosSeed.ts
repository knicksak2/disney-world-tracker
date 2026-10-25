import type { IMemoryDb } from 'pg-mem';
import { photoKeys } from '../domain/objectKeys.js';

export interface SeedMyPhotoRow {
  readonly id: string;
  readonly ownerId: string | null;
  readonly targetKind: 'food_log' | 'trip';
  readonly targetId: string;
  readonly scopeId: string;
  readonly status:
    | 'uploading'
    | 'pending'
    | 'approved'
    | 'rejected'
    | 'needs_review'
    | 'hidden'
    | 'deleted';
  readonly createdAt: string;
  readonly feedItemId?: string | null;
  readonly width?: number;
  readonly height?: number;
}

/**
 * Seeds photos with a single multi-row INSERT statement with explicit created_at.
 * Derives columns required by migration 0062 CHECK constraints:
 * - distinct u/ keys (uploadFull / uploadThumb)
 * - harm_verdict 'pass' and both ETags for approved and hidden
 * - vision_verdict 'pass' for served food_log rows
 * - reject_reason 'harm' for rejected
 * - feed_item_id only for trip
 */
export function seedMyPhotos(db: IMemoryDb, rows: readonly SeedMyPhotoRow[]): void {
  if (rows.length === 0) return;

  const values = rows.map((p) => {
    const keys = photoKeys(p.id);
    const served = p.status === 'approved' || p.status === 'hidden';
    const harmVerdict = served ? "'pass'" : 'NULL';
    const visionVerdict = served && p.targetKind === 'food_log' ? "'pass'" : 'NULL';
    const fullEtag = served ? "'e1'" : 'NULL';
    const thumbEtag = served ? "'e2'" : 'NULL';
    const rejectReason = p.status === 'rejected' ? "'harm'" : 'NULL';
    const hiddenReason = p.status === 'hidden' ? "'reports'" : 'NULL';
    const owner = p.ownerId ? `'${p.ownerId}'` : 'NULL';
    const feed = p.feedItemId && p.targetKind === 'trip' ? `'${p.feedItemId}'` : 'NULL';
    const width = p.width ?? 800;
    const height = p.height ?? 600;

    return `('${p.id}', ${owner}, '${p.targetKind}', '${p.targetId}', '${p.scopeId}', '${p.status}', '${keys.uploadFull}', '${keys.uploadThumb}', 1000, 200, ${width}, ${height}, '${p.createdAt}', '${p.createdAt}', ${harmVerdict}, ${visionVerdict}, ${fullEtag}, ${thumbEtag}, ${rejectReason}, ${hiddenReason}, ${feed})`;
  });

  db.public.none(`
    INSERT INTO photos (
      id, owner_id, target_kind, target_id, scope_id, status,
      object_key, thumb_key, byte_size, thumb_byte_size, width, height,
      created_at, sort_at, harm_verdict, vision_verdict, full_etag, thumb_etag,
      reject_reason, hidden_reason, feed_item_id
    )
    VALUES ${values.join(',\n           ')};
  `);
}

