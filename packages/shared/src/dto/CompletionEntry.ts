/**
 * Friend Completions DTOs.
 *
 * A `CompletionEntryDTO` is one item in a Friend's Completions list, surfaced
 * by the Friend-scoped Completions read (`GET /users/:userId/completions`). It
 * carries the completed Experience's name, Park, and Experience_Category, the
 * Completion date, the Friend's Rating for that Experience when one exists, and
 * the Friend's Note text only when that Note exists and is marked shareable.
 *
 * `rating` is `null` as a no-rating indicator (R4.3, R4.4). `sharedNote` is
 * `null` in both the no-Note case and the present-but-not-shareable case, so
 * the response discloses nothing about whether a non-shareable Note exists
 * (R4.6, R4.7).
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.6, 4.7
 */

import type { ExperienceCategory, Park } from '../enums.js';

export interface CompletionEntryDTO {
  /**
   * Catalog Experience_Id (UUID) of the completed Experience — the navigation
   * target used to open the ExperienceDetail view for this entry (R1.1, R1.3).
   */
  readonly experienceId: string;

  /** Completed Experience's name (R4.2). */
  readonly experienceName: string;

  /** Owning Park (R4.2). */
  readonly park: Park;

  /** Experience classification (R4.2). */
  readonly category: ExperienceCategory;

  /** ISO-8601 calendar date (YYYY-MM-DD) the Experience was completed (R4.2). */
  readonly completedOn: string;

  /** Integer Rating in `1..10`, or `null` as a no-rating indicator (R4.3, R4.4). */
  readonly rating: number | null;

  /**
   * The Friend's Note body when a Note exists and is marked shareable, else
   * `null`. `null` is indistinguishable between the no-Note and
   * present-but-not-shareable cases (R4.6, R4.7).
   */
  readonly sharedNote: string | null;
}

export interface FriendCompletionsDTO {
  readonly entries: readonly CompletionEntryDTO[];
}
