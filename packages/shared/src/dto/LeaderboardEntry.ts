/**
 * LeaderboardEntry DTO.
 *
 * One row of the Highest-Rated Experiences section on the Home_Screen. Each
 * entry contains the Experience's name, Park, Experience_Category, the
 * Aggregate_Rating mean rendered to one decimal place, and the count of
 * contributing Ratings (R11.5). Only Experiences with `count >= 3` and
 * `active == true` qualify (R11.2); the leaderboard contains at most 10
 * entries ordered by `mean DESC, count DESC, lower(name) ASC` (R11.3, R11.4).
 *
 * Validates: Requirements 11.2, 11.3, 11.4, 11.5
 */

import type { ExperienceCategory, Park } from '../enums.js';

export interface LeaderboardEntryDTO {
  readonly experienceId: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;

  /** Aggregate mean to one decimal place, in `[1.0, 10.0]`. */
  readonly value: number;

  /** Number of contributing Ratings; `>= 3` by qualification (R11.2). */
  readonly count: number;
}
