/**
 * Favorite repository implementation.
 *
 * Persists and queries user experience favorites in `experience_favorites`.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5
 */

import { AppError } from '../../../errors/AppError.js';
import type { DbPool } from '../../../db/pool.js';

export interface FavoriteRepo {
  /** Idempotent insert. No-op (not an error) if already favorited. */
  favorite(userId: string, experienceId: string): Promise<void>;
  /** Idempotent delete. No-op (not an error) if not currently favorited. */
  unfavorite(userId: string, experienceId: string): Promise<void>;
  /** Every experienceId the user has favorited. No ordering guarantee. */
  listFavoriteIds(userId: string): Promise<readonly string[]>;
}

export function createFavoriteRepo(pool: DbPool): FavoriteRepo {
  return {
    favorite: async (userId: string, experienceId: string): Promise<void> => {
      const expRes = await pool.query<{ id: string }>(
        `SELECT id FROM experiences WHERE id = $1 AND active = TRUE`,
        [experienceId],
      );
      if (expRes.rows.length === 0) {
        throw new AppError('experience_not_found', 'Experience not found');
      }
      await pool.query(
        `INSERT INTO experience_favorites (user_id, experience_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, experience_id) DO NOTHING`,
        [userId, experienceId],
      );
    },

    unfavorite: async (userId: string, experienceId: string): Promise<void> => {
      await pool.query(
        `DELETE FROM experience_favorites WHERE user_id = $1 AND experience_id = $2`,
        [userId, experienceId],
      );
    },

    listFavoriteIds: async (userId: string): Promise<readonly string[]> => {
      const res = await pool.query<{ experience_id: string }>(
        `SELECT experience_id FROM experience_favorites WHERE user_id = $1`,
        [userId],
      );
      return res.rows.map((r) => r.experience_id);
    },
  };
}
