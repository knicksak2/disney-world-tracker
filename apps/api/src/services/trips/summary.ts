/**
 * Trip_Summary derivation.
 *
 * Pure derivation of a Trip's summary view from the Trip's log entries,
 * confirmed rode-with tags, and the referenced canonical Ratings. The summary
 * is never stored as an independent editable field; it is always computed from
 * this activity (R14.6).
 *
 * The module performs no I/O and does not mutate its input, so it can be
 * property-tested cheaply across many inputs. The repo assembles the inputs
 * (log entries, confirmed tags, and the referenced canonical Ratings) and maps
 * the result onto a `TripSummaryDTO` with per-Member display names.
 *
 * Validates: Requirements R14.1, R14.2, R14.3, R14.4, R14.5, R14.6, R14.7
 *
 * The Trip_Summary is additionally extended with the Planned_List
 * planned-versus-completed counts (planned-list-completion-sync R5). Those two
 * counts reuse `derivePlannedCounts` from `@dwt/shared` so the server summary
 * and the client Planned_List presentation compute completion with literally
 * the same set-membership match and cannot drift.
 */

import { derivePlannedCounts } from '@dwt/shared';

/**
 * Inputs to the Trip_Summary derivation.
 *
 * `logEntries`    — one entry per Trip_Log_Entry a Member created, carrying the
 *                   completing Member, the Experience, and the Experience name.
 * `confirmedTags` — one entry per confirmed Rode_With_Tag, carrying the
 *                   contributing (Tagged) Member and the Experience.
 * `ratings`       — the referenced canonical Ratings for Experiences completed
 *                   in the Trip context; each is a single Member's canonical
 *                   Rating value for an Experience.
 * `plannedItems`  — the Trip's Planned_Items, each carrying its referenced
 *                   Experience; the source of the planned total count and, via
 *                   the Planned_Completion_Match against `logEntries`, the
 *                   planned-completed count (R5.1, R5.3).
 */
export interface TripSummaryInput {
  readonly logEntries: readonly { memberId: string; experienceId: string; experienceName: string }[];
  readonly confirmedTags: readonly { memberId: string; experienceId: string }[];
  readonly ratings: readonly { experienceId: string; value: number }[];
  readonly plannedItems: readonly { experienceId: string }[];
}

/** A single top-rated Experience entry in the Trip_Summary. */
export interface TopRatedExperience {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly meanRating: number;
  readonly ratingCount: number;
}

/** A single Member's contribution counts in the Trip_Summary. */
export interface PerMemberContribution {
  readonly memberId: string;
  readonly logEntryCount: number;
  readonly confirmedTagCount: number;
}

/**
 * The derived Trip_Summary.
 *
 * `distinctExperienceCount` — count of distinct Experiences completed in the
 *                             Trip context, each counted at most once, `0` when
 *                             none (R14.1).
 * `topRated`                — up to 5 top-rated Experiences ranked by descending
 *                             mean referenced canonical Rating, then descending
 *                             rating count, then ascending Experience name;
 *                             empty when no rated Experience exists (R14.2,
 *                             R14.3).
 * `perMember`               — per-Member log-entry and confirmed-tag counts,
 *                             `0` where none (R14.4, R14.5).
 * `plannedTotalCount`       — total number of Planned_Items in the Trip, `0`
 *                             for an empty Planned_List (R5.1, R5.4).
 * `plannedCompletedCount`   — number of Planned_Items whose referenced
 *                             Experience matches at least one Trip_Log_Entry in
 *                             the Trip, each counted at most once, clamped
 *                             `0 <= plannedCompletedCount <= plannedTotalCount`
 *                             (R5.2, R5.5, R5.6).
 *
 * The shape exposes both per-Trip aggregates and per-Member counts so a future
 * trip-to-trip comparison can consume it (R14.7).
 */
export interface TripSummary {
  readonly distinctExperienceCount: number;
  readonly topRated: readonly TopRatedExperience[];
  readonly perMember: readonly PerMemberContribution[];
  readonly plannedTotalCount: number;
  readonly plannedCompletedCount: number;
}

/** Maximum number of Experiences surfaced in `topRated` (R14.2). */
const TOP_RATED_LIMIT = 5;

/**
 * Derive the Trip_Summary from the Trip's activity.
 *
 * @param input Log entries, confirmed rode-with tags, and referenced canonical
 *              Ratings for the Trip.
 * @returns The derived summary; a faithful function of the input only.
 */
export function deriveTripSummary(input: TripSummaryInput): TripSummary {
  const { logEntries, confirmedTags, ratings, plannedItems } = input;

  // Distinct Experiences completed in the Trip context — via a log entry OR a
  // confirmed tag — counted at most once, 0 when none (R14.1).
  const completedExperiences = new Set<string>();
  for (const entry of logEntries) {
    completedExperiences.add(entry.experienceId);
  }
  for (const tag of confirmedTags) {
    completedExperiences.add(tag.experienceId);
  }

  // Planned_List planned-versus-completed counts (R5). The completed set is the
  // Experiences referenced by the Trip's Trip_Log_Entries, so a Planned_Item
  // counts as completed exactly when at least one Trip_Log_Entry references its
  // Experience (R5.2). Reusing `derivePlannedCounts` keeps this match identical
  // to the client Planned_List presentation.
  const loggedExperienceIds = new Set<string>();
  for (const entry of logEntries) {
    loggedExperienceIds.add(entry.experienceId);
  }
  const { plannedTotalCount, plannedCompletedCount } = derivePlannedCounts(plannedItems, loggedExperienceIds);

  return {
    distinctExperienceCount: completedExperiences.size,
    topRated: deriveTopRated(logEntries, ratings),
    perMember: derivePerMember(logEntries, confirmedTags),
    plannedTotalCount,
    plannedCompletedCount,
  };
}

/**
 * Rank Experiences by their referenced canonical Ratings.
 *
 * Groups the referenced Ratings by Experience, computes each Experience's mean
 * Rating and Rating count, then ranks by descending mean, breaking ties by
 * descending Rating count and then ascending Experience name. Capped at 5.
 * Returns an empty list when no Experience has a referenced Rating (R14.2,
 * R14.3).
 */
function deriveTopRated(
  logEntries: readonly { experienceId: string; experienceName: string }[],
  ratings: readonly { experienceId: string; value: number }[],
): TopRatedExperience[] {
  // Names come from the Trip's log entries; the first observed name for an
  // Experience is used, falling back to the empty string when unavailable so
  // the ascending-name tie-break stays deterministic.
  const nameByExperience = new Map<string, string>();
  for (const entry of logEntries) {
    if (!nameByExperience.has(entry.experienceId)) {
      nameByExperience.set(entry.experienceId, entry.experienceName);
    }
  }

  const sumByExperience = new Map<string, number>();
  const countByExperience = new Map<string, number>();
  for (const rating of ratings) {
    sumByExperience.set(rating.experienceId, (sumByExperience.get(rating.experienceId) ?? 0) + rating.value);
    countByExperience.set(rating.experienceId, (countByExperience.get(rating.experienceId) ?? 0) + 1);
  }

  const ranked: TopRatedExperience[] = [];
  for (const [experienceId, count] of countByExperience) {
    const sum = sumByExperience.get(experienceId) ?? 0;
    ranked.push({
      experienceId,
      experienceName: nameByExperience.get(experienceId) ?? '',
      meanRating: sum / count,
      ratingCount: count,
    });
  }

  ranked.sort(compareTopRated);
  return ranked.slice(0, TOP_RATED_LIMIT);
}

/**
 * Compare two rated Experiences for `topRated` order: descending mean Rating,
 * then descending Rating count, then ascending Experience name.
 */
function compareTopRated(a: TopRatedExperience, b: TopRatedExperience): number {
  if (a.meanRating !== b.meanRating) {
    return b.meanRating - a.meanRating;
  }
  if (a.ratingCount !== b.ratingCount) {
    return b.ratingCount - a.ratingCount;
  }
  if (a.experienceName !== b.experienceName) {
    return a.experienceName < b.experienceName ? -1 : 1;
  }
  return 0;
}

/**
 * Count each Member's Trip_Log_Entries and confirmed contributed Rode_With_Tags.
 *
 * Covers every Member that appears in the Trip's activity (log entries or
 * confirmed tags), reporting `0` for whichever count that Member has none of
 * (R14.4, R14.5). Ordered by Member identifier for a deterministic result.
 */
function derivePerMember(
  logEntries: readonly { memberId: string }[],
  confirmedTags: readonly { memberId: string }[],
): PerMemberContribution[] {
  const logEntryCounts = new Map<string, number>();
  const confirmedTagCounts = new Map<string, number>();

  for (const entry of logEntries) {
    logEntryCounts.set(entry.memberId, (logEntryCounts.get(entry.memberId) ?? 0) + 1);
  }
  for (const tag of confirmedTags) {
    confirmedTagCounts.set(tag.memberId, (confirmedTagCounts.get(tag.memberId) ?? 0) + 1);
  }

  const memberIds = new Set<string>([...logEntryCounts.keys(), ...confirmedTagCounts.keys()]);

  return [...memberIds]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((memberId) => ({
      memberId,
      logEntryCount: logEntryCounts.get(memberId) ?? 0,
      confirmedTagCount: confirmedTagCounts.get(memberId) ?? 0,
    }));
}
