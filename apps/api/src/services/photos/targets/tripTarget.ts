/**
 * Trip Target Adapter.
 *
 * Implements: Task 19.1
 * Validates: Requirements 12.1, 12.2, 12.4, 12.5, 12.6, 12.8, 12.9
 */

import { AppError } from '../../../errors/AppError.js';
import type { DbPool } from '../../../db/pool.js';
import type { TargetAdapter } from '../ports.js';
import { assertTripMember } from '../../trips/authz.js';
import { can } from '../../trips/permissions.js';

import type { PhotosRepo } from '../repo.js';

export interface TripTargetOptions {
  readonly pool: DbPool;
  readonly photosRepo?: PhotosRepo | undefined;
  readonly maxPerTrip?: number | undefined;
  readonly tripEnabled?: boolean | undefined;
}

export class TripTarget implements TargetAdapter {
  readonly kind = 'trip' as const;
  readonly screen = 'harm_only' as const;

  private readonly pool: DbPool;
  private readonly photosRepo?: PhotosRepo | undefined;
  readonly maxPerTarget: number;
  readonly enabled: boolean;

  constructor(options: TripTargetOptions) {
    this.pool = options.pool;
    this.photosRepo = options.photosRepo;
    this.maxPerTarget = options.maxPerTrip ?? 300;
    this.enabled = options.tripEnabled ?? true;
  }

  async authorizeUpload(userId: string, targetId: string): Promise<{ scopeId: string }> {
    const role = await assertTripMember(this.pool, userId, targetId);
    if (!can(role, 'upload_trip_photo')) {
      throw new AppError('trip_forbidden', 'User is not permitted to upload photos to this trip');
    }
    return { scopeId: targetId };
  }

  async canViewScope(viewerId: string, scopeId: string): Promise<boolean> {
    try {
      await assertTripMember(this.pool, viewerId, scopeId);
      return true;
    } catch {
      return false;
    }
  }

  async canDeleteOthers(userId: string, scopeId: string): Promise<boolean> {
    try {
      const role = await assertTripMember(this.pool, userId, scopeId);
      return can(role, 'delete_any_trip_photo');
    } catch {
      return false;
    }
  }

  async findOrphanPhotoIds(limit: number): Promise<readonly string[]> {
    if (this.photosRepo) {
      return this.photosRepo.findTripOrphanIds(limit);
    }
    // Anti-join (equivalent to NOT EXISTS because `trips.id` is the primary key);
    // see `findTripOrphanIds` in `../repo.ts` for why this form is used.
    const sql = `
      SELECT p.id
        FROM photos p
        LEFT JOIN trips t ON t.id = p.target_id
       WHERE p.target_kind = 'trip'
         AND p.status <> 'deleted'
         AND t.id IS NULL
       LIMIT $1;
    `;
    const res = await this.pool.query<{ id: string }>(sql, [limit]);
    return res.rows.map((r) => r.id);
  }
}

