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

import type { Park } from '@dwt/shared';
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
  readonly logEntries: readonly {
    memberId: string;
    experienceId: string;
    experienceName: string;
    park?: string | null;
    category?: string | null;
    imageUrl?: string | null;
  }[];
  readonly confirmedTags: readonly {
    memberId: string;
    experienceId: string;
    experienceName?: string | null;
    park?: string | null;
    category?: string | null;
    imageUrl?: string | null;
  }[];
  readonly ratings: readonly {
    memberId?: string;
    experienceId: string;
    value: number;
  }[];
  readonly plannedItems: readonly { experienceId: string }[];
}

/** A single top-rated Experience entry in the Trip_Summary. */
export interface TopRatedExperience {
  readonly experienceId: string;
  readonly experienceName: string;
  readonly meanRating: number;
  readonly ratingCount: number;
  readonly park?: Park | null;
  readonly category?: string | null;
  readonly imageUrl?: string | null;
}

/** A single Member's contribution counts in the Trip_Summary. */
export interface PerMemberContribution {
  readonly memberId: string;
  readonly logEntryCount: number;
  readonly confirmedTagCount: number;
  readonly totalCompletedCount?: number;
  readonly topRatedExperienceName?: string | null;
  readonly topRating?: number | null;
}

/** A superlative or highlight badge awarded on the Trip. */
export interface TripSuperlative {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly memberId?: string | undefined;
  readonly memberDisplayName?: string | undefined;
  readonly experienceName?: string | undefined;
  readonly value?: string | number | undefined;
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
  readonly totalCompletionsCount?: number;
  readonly totalRatingsCount?: number;
  readonly parkBreakdown?: readonly { park: Park; count: number }[];
  readonly categoryBreakdown?: readonly { category: string; count: number }[];
  readonly superlatives?: readonly TripSuperlative[];
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

  const topRated = deriveTopRated(logEntries, confirmedTags, ratings);
  const perMember = derivePerMember(logEntries, confirmedTags, ratings);
  const parkBreakdown = deriveParkBreakdown(logEntries, confirmedTags);
  const categoryBreakdown = deriveCategoryBreakdown(logEntries, confirmedTags);
  const superlatives = deriveSuperlatives(perMember, topRated, parkBreakdown, ratings);

  return {
    distinctExperienceCount: completedExperiences.size,
    topRated,
    perMember,
    plannedTotalCount,
    plannedCompletedCount,
    totalCompletionsCount: logEntries.length + confirmedTags.length,
    totalRatingsCount: ratings.length,
    parkBreakdown,
    categoryBreakdown,
    superlatives,
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
  logEntries: readonly {
    experienceId: string;
    experienceName: string;
    park?: string | null;
    category?: string | null;
    imageUrl?: string | null;
  }[],
  confirmedTags: readonly {
    experienceId: string;
    experienceName?: string | null;
    park?: string | null;
    category?: string | null;
    imageUrl?: string | null;
  }[],
  ratings: readonly { experienceId: string; value: number }[],
): TopRatedExperience[] {
  // Names, parks, categories, and images come from the Trip's log entries / tags.
  const metaByExperience = new Map<
    string,
    { name: string; park?: Park | null; category?: string | null; imageUrl?: string | null }
  >();

  for (const entry of logEntries) {
    if (!metaByExperience.has(entry.experienceId)) {
      metaByExperience.set(entry.experienceId, {
        name: entry.experienceName,
        park: (entry.park as Park) ?? null,
        category: entry.category ?? null,
        imageUrl: entry.imageUrl ?? null,
      });
    }
  }
  for (const tag of confirmedTags) {
    if (!metaByExperience.has(tag.experienceId)) {
      metaByExperience.set(tag.experienceId, {
        name: tag.experienceName ?? '',
        park: (tag.park as Park) ?? null,
        category: tag.category ?? null,
        imageUrl: tag.imageUrl ?? null,
      });
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
    const meta = metaByExperience.get(experienceId);
    ranked.push({
      experienceId,
      experienceName: meta?.name ?? '',
      meanRating: sum / count,
      ratingCount: count,
      ...(meta?.park !== undefined ? { park: meta.park } : {}),
      ...(meta?.category !== undefined ? { category: meta.category } : {}),
      ...(meta?.imageUrl !== undefined ? { imageUrl: meta.imageUrl } : {}),
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
  logEntries: readonly { memberId: string; experienceId: string; experienceName: string }[],
  confirmedTags: readonly { memberId: string; experienceId: string; experienceName?: string | null }[],
  ratings: readonly { memberId?: string; experienceId: string; value: number }[],
): PerMemberContribution[] {
  const logEntryCounts = new Map<string, number>();
  const confirmedTagCounts = new Map<string, number>();

  for (const entry of logEntries) {
    logEntryCounts.set(entry.memberId, (logEntryCounts.get(entry.memberId) ?? 0) + 1);
  }
  for (const tag of confirmedTags) {
    confirmedTagCounts.set(tag.memberId, (confirmedTagCounts.get(tag.memberId) ?? 0) + 1);
  }

  // Build a name lookup for experiences
  const nameByExperience = new Map<string, string>();
  for (const entry of logEntries) {
    if (!nameByExperience.has(entry.experienceId)) {
      nameByExperience.set(entry.experienceId, entry.experienceName);
    }
  }
  for (const tag of confirmedTags) {
    if (tag.experienceName && !nameByExperience.has(tag.experienceId)) {
      nameByExperience.set(tag.experienceId, tag.experienceName);
    }
  }

  // Find each member's personal top-rated experience on this trip
  const memberRatings = new Map<string, { experienceId: string; value: number }[]>();
  for (const r of ratings) {
    if (r.memberId) {
      const list = memberRatings.get(r.memberId) ?? [];
      list.push({ experienceId: r.experienceId, value: r.value });
      memberRatings.set(r.memberId, list);
    }
  }

  const memberIds = new Set<string>([...logEntryCounts.keys(), ...confirmedTagCounts.keys()]);

  return [...memberIds]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((memberId) => {
      const logEntryCount = logEntryCounts.get(memberId) ?? 0;
      const confirmedTagCount = confirmedTagCounts.get(memberId) ?? 0;
      const totalCompletedCount = logEntryCount + confirmedTagCount;

      let topRatedExperienceName: string | null = null;
      let topRating: number | null = null;

      const userRatings = memberRatings.get(memberId);
      if (userRatings && userRatings.length > 0) {
        // Sort descending by rating value, then ascending experience name
        userRatings.sort((a, b) => {
          if (b.value !== a.value) return b.value - a.value;
          const nameA = nameByExperience.get(a.experienceId) ?? '';
          const nameB = nameByExperience.get(b.experienceId) ?? '';
          return nameA.localeCompare(nameB);
        });
        topRating = userRatings[0]!.value;
        topRatedExperienceName = nameByExperience.get(userRatings[0]!.experienceId) ?? null;
      }

      return {
        memberId,
        logEntryCount,
        confirmedTagCount,
        totalCompletedCount,
        topRatedExperienceName,
        topRating,
      };
    });
}

/**
 * Breakdown of distinct completed experiences by Walt Disney World park (R14.9).
 */
function deriveParkBreakdown(
  logEntries: readonly { experienceId: string; park?: string | null }[],
  confirmedTags: readonly { experienceId: string; park?: string | null }[],
): readonly { park: Park; count: number }[] {
  const parkByExperience = new Map<string, Park>();

  for (const entry of logEntries) {
    if (entry.park && !parkByExperience.has(entry.experienceId)) {
      parkByExperience.set(entry.experienceId, entry.park as Park);
    }
  }
  for (const tag of confirmedTags) {
    if (tag.park && !parkByExperience.has(tag.experienceId)) {
      parkByExperience.set(tag.experienceId, tag.park as Park);
    }
  }

  const counts = new Map<Park, number>();
  for (const [, park] of parkByExperience) {
    counts.set(park, (counts.get(park) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([park, count]) => ({ park, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.park.localeCompare(b.park);
    });
}

/**
 * Breakdown of distinct completed experiences by category (R14.10).
 */
function deriveCategoryBreakdown(
  logEntries: readonly { experienceId: string; category?: string | null }[],
  confirmedTags: readonly { experienceId: string; category?: string | null }[],
): readonly { category: string; count: number }[] {
  const categoryByExperience = new Map<string, string>();

  for (const entry of logEntries) {
    if (entry.category && !categoryByExperience.has(entry.experienceId)) {
      categoryByExperience.set(entry.experienceId, entry.category);
    }
  }
  for (const tag of confirmedTags) {
    if (tag.category && !categoryByExperience.has(tag.experienceId)) {
      categoryByExperience.set(tag.experienceId, tag.category);
    }
  }

  const counts = new Map<string, number>();
  for (const [, cat] of categoryByExperience) {
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.category.localeCompare(b.category);
    });
}

/**
 * Derive group superlatives and fun badges from Trip activity (R14.11).
 */
function deriveSuperlatives(
  perMember: readonly PerMemberContribution[],
  topRated: readonly TopRatedExperience[],
  parkBreakdown: readonly { park: Park; count: number }[],
  ratings: readonly { memberId?: string; value: number }[],
): readonly TripSuperlative[] {
  const superlatives: TripSuperlative[] = [];

  if (perMember.length === 0) {
    return superlatives;
  }

  // 1. Group MVP — highest total completions (logs + tags)
  const sortedByTotal = [...perMember].sort(
    (a, b) => (b.totalCompletedCount ?? 0) - (a.totalCompletedCount ?? 0) || a.memberId.localeCompare(b.memberId),
  );
  if (sortedByTotal[0] && (sortedByTotal[0].totalCompletedCount ?? 0) > 0) {
    superlatives.push({
      id: 'group_mvp',
      title: 'Group MVP',
      description: 'Most experiences completed across the entire trip',
      icon: 'trophy',
      memberId: sortedByTotal[0].memberId,
      value: sortedByTotal[0].totalCompletedCount,
    });
  }

  // 2. Lead Explorer — highest log entry count
  const sortedByLogs = [...perMember].sort(
    (a, b) => b.logEntryCount - a.logEntryCount || a.memberId.localeCompare(b.memberId),
  );
  if (sortedByLogs[0] && sortedByLogs[0].logEntryCount > 0) {
    superlatives.push({
      id: 'lead_explorer',
      title: 'Lead Explorer',
      description: 'Logged the most completions for the party',
      icon: 'compass',
      memberId: sortedByLogs[0].memberId,
      value: sortedByLogs[0].logEntryCount,
    });
  }

  // 3. Best Co-Pilot — highest confirmed rode-with tags
  const sortedByTags = [...perMember].sort(
    (a, b) => b.confirmedTagCount - a.confirmedTagCount || a.memberId.localeCompare(b.memberId),
  );
  if (sortedByTags[0] && sortedByTags[0].confirmedTagCount > 0) {
    superlatives.push({
      id: 'best_copilot',
      title: 'Best Co-Pilot',
      description: 'Most confirmed rode-with tags on group rides',
      icon: 'people',
      memberId: sortedByTags[0].memberId,
      value: sortedByTags[0].confirmedTagCount,
    });
  }

  // 4. Chief Critic — most ratings submitted
  const ratingsCountByMember = new Map<string, number>();
  for (const r of ratings) {
    if (r.memberId) {
      ratingsCountByMember.set(r.memberId, (ratingsCountByMember.get(r.memberId) ?? 0) + 1);
    }
  }
  const sortedCritics = [...ratingsCountByMember.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  if (sortedCritics[0] && sortedCritics[0][1] > 0) {
    superlatives.push({
      id: 'chief_critic',
      title: 'Chief Critic',
      description: 'Submitted the most experience ratings',
      icon: 'star',
      memberId: sortedCritics[0][0],
      value: sortedCritics[0][1],
    });
  }

  // 5. Crowd Favorite — #1 top-rated experience
  if (topRated.length > 0 && topRated[0]) {
    const formatted = Math.round(topRated[0].meanRating * 10) / 10;
    const ratingStr = Number.isInteger(formatted) ? String(formatted) : formatted.toFixed(1);
    superlatives.push({
      id: 'crowd_favorite',
      title: 'Crowd Favorite',
      description: 'Highest average rating from the group',
      icon: 'sparkles',
      experienceName: topRated[0].experienceName,
      value: `${ratingStr} ★`,
    });
  }

  // 6. Top Park Explored — park with most completed experiences
  if (parkBreakdown.length > 0 && parkBreakdown[0]) {
    superlatives.push({
      id: 'top_park',
      title: 'Top Park Explored',
      description: 'Park with the most completed experiences',
      icon: 'map',
      value: `${parkBreakdown[0].park} (${parkBreakdown[0].count})`,
    });
  }

  return superlatives;
}

