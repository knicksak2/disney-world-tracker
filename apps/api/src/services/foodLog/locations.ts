/**
 * Repository and operations for User_Submitted_Locations (Feature: food-item-logging).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.7
 */

import type {
  LocationSuggestionDTO,
  Park,
  UserSubmittedLocationDTO,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

export const LOCATION_NAME_MAX_LENGTH = 200;
export const LOCATION_SIMILARITY_THRESHOLD = 0.3;
export const LOCATION_SUGGEST_LIMIT = 10;

export interface UserSubmittedLocationRepo {
  createLocation(
    userId: string,
    name: string,
    park: Park,
  ): Promise<UserSubmittedLocationDTO>;
  suggestLocations(
    park?: Park,
    name?: string,
    limit?: number,
  ): Promise<readonly LocationSuggestionDTO[]>;
  findLocation(locationId: string): Promise<UserSubmittedLocationDTO | null>;
}

interface LocationRow {
  id: string;
  name: string;
  park: Park;
}

interface SuggestionRow {
  id: string;
  name: string;
  park: Park;
  sim: number;
}

export function createUserSubmittedLocationRepo(pool: DbPool): UserSubmittedLocationRepo {
  return {
    async createLocation(
      userId: string,
      name: string,
      park: Park,
    ): Promise<UserSubmittedLocationDTO> {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > LOCATION_NAME_MAX_LENGTH) {
        throw new AppError(
          'validation_failed',
          'Location name must be between 1 and 200 characters',
        );
      }

      try {
        const res = await pool.query<LocationRow>(
          `INSERT INTO user_submitted_locations (name, park, created_by_user_id)
           VALUES ($1, $2, $3)
           RETURNING id, name, park`,
          [trimmed, park, userId],
        );

        return {
          id: res.rows[0]!.id,
          name: res.rows[0]!.name,
          park: res.rows[0]!.park,
        };
      } catch (err: unknown) {
        const existing = await pool.query<{ id: string }>(
          `SELECT id FROM user_submitted_locations
            WHERE park = $1 AND lower(name) = lower($2)`,
          [park, trimmed],
        );

        if (existing.rows.length > 0) {
          throw new AppError(
            'location_duplicate',
            'A location with that name already exists in this park',
            { details: { existingId: existing.rows[0]!.id } },
          );
        }
        throw err;
      }
    },

    async suggestLocations(
      park?: Park,
      name?: string,
      limit: number = LOCATION_SUGGEST_LIMIT,
    ): Promise<readonly LocationSuggestionDTO[]> {
      const trimmed = name?.trim() ?? '';
      if (!trimmed) {
        return [];
      }

      const res = await pool.query<SuggestionRow>(
        `SELECT id, name, park, similarity(lower(name), lower($2)) AS sim
           FROM user_submitted_locations
          WHERE ($1::varchar IS NULL OR park = $1)
            AND (similarity(lower(name), lower($2)) >= $3 OR lower(name) LIKE '%' || lower($2) || '%')
          ORDER BY sim DESC
          LIMIT $4`,
        [park ?? null, trimmed, LOCATION_SIMILARITY_THRESHOLD, limit],
      );

      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        park: r.park,
        similarity: Number(r.sim),
      }));
    },

    async findLocation(locationId: string): Promise<UserSubmittedLocationDTO | null> {
      const res = await pool.query<LocationRow>(
        `SELECT id, name, park
           FROM user_submitted_locations
          WHERE id = $1`,
        [locationId],
      );

      if (res.rows.length === 0) {
        return null;
      }

      return {
        id: res.rows[0]!.id,
        name: res.rows[0]!.name,
        park: res.rows[0]!.park,
      };
    },
  };
}
