/**
 * Share DTO.
 *
 * The sender's canonical record of a Share, mirroring the `shares` table in
 * the design. A Share carries either a single Experience (with optional
 * sender's Rating and/or Note) or the sender's overall progress, discriminated
 * by `payloadKind`. Per-recipient delivery state lives in `ShareRecipientDTO`.
 *
 * The `payloadSnapshot` is a structural snapshot taken at delivery time
 * (R9.1, R9.4-R9.7) so the recipient sees the values the sender intended at
 * send-time even if the underlying Rating, Note, or stats subsequently
 * change. Two payload variants are exposed at the type level so callers can
 * branch by `payloadKind`.
 *
 * Validates: Requirements 9.1, 9.4, 9.5, 9.6, 9.7
 */

import type { Park } from '../enums.js';
import type { ExperienceCategory, SharePayloadKind } from '../enums.js';
import type { CompletionCell } from './Stats.js';

/**
 * Snapshot of an `experience` Share payload.
 *
 * - When the sender chose to include a Rating and one existed at delivery
 *   time, `rating` is an integer in `1..10` (R9.4).
 * - When the sender chose to include a Rating but none existed at delivery
 *   time, `rating` is `null` and `ratingUnavailable` is `true` (R9.5).
 * - When the sender did not choose to include a Rating, both `rating` and
 *   `ratingUnavailable` are absent.
 * - The Note body, when included, is at most 2000 characters (R9.6).
 */
export interface ExperienceSharePayload {
  readonly kind: 'experience';
  readonly experienceId: string;
  readonly rating?: number | null;
  readonly ratingUnavailable?: boolean;
  readonly note?: string;
}

/**
 * Snapshot of a `progress` Share payload (R9.7).
 *
 * Each percentage is in `[0.0, 100.0]` to one decimal place; the per-Park and
 * per-Experience_Category breakdowns are keyed by the Park / category enum
 * member name.
 *
 * The expanded-stats feature adds two curated fields captured at share
 * creation time so shares stay headline-worthy without dumping every number:
 * - `topFacet` — the sender's top per-Facet_Value_Key Coverage_Statistic as a
 *   {@link CompletionCell} plus its display label. Present whenever the sender
 *   has at least one facet statistic (even when its `completed` is 0) and
 *   omitted entirely when the sender has none (R10.2, R10.7, R10.8).
 * - `percentileRank` — the sender's Percentile_Rank in `[0.0, 100.0]` to one
 *   decimal place, `0.0` when the sender has zero Completions (R10.3).
 */
export interface ProgressSharePayload {
  readonly kind: 'progress';
  readonly overallPercent: number;
  readonly perParkPercent: { readonly [park in Park]?: number };
  readonly perCategoryPercent: { readonly [category in ExperienceCategory]?: number };
  readonly topFacet?: { readonly label: string; readonly cell: CompletionCell };
  readonly percentileRank?: number;
}

export type SharePayload = ExperienceSharePayload | ProgressSharePayload;

export interface ShareDTO {
  readonly id: string;
  readonly senderId: string;

  /**
   * Discriminator matching `payloadSnapshot.kind`. Stored explicitly to mirror
   * the `shares.payload_kind` column in the design and keep the wire format
   * easy to query without inspecting the snapshot.
   */
  readonly payloadKind: SharePayloadKind;

  /** Snapshot captured at delivery time (R9.1, R9.4-R9.7). */
  readonly payloadSnapshot: SharePayload;

  /** ISO-8601 timestamp the Share was sent. */
  readonly sentAt: string;
}

/**
 * One entry in the sender's own list of Shares they sent, backing the mobile
 * Sent Shares surface (design → Reaction_Service, "a minimal Sent Shares
 * surface on mobile"). It carries just enough to render each Share's content
 * and to key the per-Share reactions read (`GET /me/shares/:shareId/reactions`,
 * R11.7): the Share id, its payload kind and snapshot, and when it was sent.
 * The reactions themselves are fetched per Share via that dedicated endpoint,
 * so this DTO does not embed them.
 */
export interface SentShareDTO {
  readonly shareId: string;
  readonly payloadKind: SharePayloadKind;
  readonly payload: SharePayload;
  readonly sentAt: string;
}
