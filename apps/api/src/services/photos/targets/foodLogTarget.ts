/**
 * Food Log Target Adapter.
 *
 * Implements: Task 8.1
 * Validates: Requirements 10.1, 10.2, 19.4
 */

import { AppError } from '../../../errors/AppError.js';
import type { DbPool } from '../../../db/pool.js';
import type { TargetAdapter } from '../ports.js';
import type { PhotosRepo } from '../repo.js';

export interface FoodLogTargetOptions {
  readonly pool: DbPool;
  readonly photosRepo?: PhotosRepo;
  readonly maxPerFoodLog?: number;
  readonly foodEnabled?: boolean;
}

export class FoodLogTarget implements TargetAdapter {
  readonly kind = 'food_log' as const;
  readonly screen = 'harm_and_vision' as const;

  private readonly pool: DbPool;
  private readonly photosRepo?: PhotosRepo | undefined;
  readonly maxPerTarget: number;
  readonly enabled: boolean;

  constructor(options: FoodLogTargetOptions) {
    this.pool = options.pool;
    this.photosRepo = options.photosRepo;
    this.maxPerTarget = options.maxPerFoodLog ?? 4;
    this.enabled = options.foodEnabled ?? true;
  }

  async authorizeUpload(userId: string, targetId: string): Promise<{ scopeId: string }> {
    // SQL touches only food_item_logs.id, user_id, and food_item_id (Requirement 10.1)
    const sql = `
      SELECT id, user_id, food_item_id
        FROM food_item_logs
       WHERE id = $1;
    `;
    const res = await this.pool.query<{ id: string; user_id: string; food_item_id: string }>(sql, [targetId]);
    if (res.rows.length === 0) {
      throw new AppError('food_log_not_found', 'Food log not found');
    }

    const row = res.rows[0];
    if (!row || row.user_id !== userId) {
      throw new AppError('food_log_not_found', 'Food log not found');
    }

    return { scopeId: row.food_item_id };
  }

  async canViewScope(_viewerId: string, _scopeId: string): Promise<boolean> {
    return true;
  }

  async canDeleteOthers(_userId: string, _scopeId: string): Promise<boolean> {
    return false;
  }

  async findOrphanPhotoIds(limit: number): Promise<string[]> {
    if (this.photosRepo) {
      const ids = await this.photosRepo.findFoodLogOrphanIds(limit);
      return [...ids];
    }

    const sql = `
      SELECT p.id
        FROM photos p
       WHERE p.target_kind = 'food_log'
         AND p.status <> 'deleted'
         AND NOT EXISTS (SELECT 1 FROM food_item_logs l WHERE l.id = p.target_id)
       LIMIT $1;
    `;
    const res = await this.pool.query<{ id: string }>(sql, [limit]);
    return res.rows.map((r) => r.id);
  }
}
