/**
 * Shared DTO types for Experience Favorites.
 */

import type { ExperienceCategory, Park } from '../enums.js';

/** Bulk read shape backing `GET /me/favorites` and the mobile `useFavoritedExperiences` cache. */
export interface FavoritesResponseDTO {
  readonly experienceIds: readonly string[];
}

/** One row of a Trip's Group Favorites (`GET /trips/:id/favorites/shared`). */
export interface GroupFavoriteDTO {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly favoritingCount: number;
  readonly favoritingDisplayNames: readonly string[];
}

export interface GroupFavoritesResponseDTO {
  readonly items: readonly GroupFavoriteDTO[];
}
