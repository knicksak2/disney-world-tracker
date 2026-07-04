/**
 * ShareReaction DTO (sender view).
 *
 * The sender of a `Share` can see the reactions their recipients attached
 * (R11.7). Each reaction is one recipient's single `Share_Reaction`, drawn
 * from the closed `Reaction_Vocabulary`, together with the reactor's identity
 * and the moment they reacted. A recipient holds at most one reaction per
 * Share (R11.4); resubmitting replaces the prior value (R11.5).
 *
 * Validates: Requirements 11.7
 */

import type { ShareReactionValue } from '../enums.js';

export interface ShareReactionDTO {
  /** The reaction value, drawn from the closed `Reaction_Vocabulary`. */
  readonly reaction: ShareReactionValue;

  /** The recipient (reactor) who attached this reaction. */
  readonly reactorId: string;

  /** The reactor's display name, joined from `profiles` for the sender view. */
  readonly reactorDisplayName: string;

  /** ISO-8601 timestamp the reaction was attached (or last replaced). */
  readonly reactedAt: string;
}
