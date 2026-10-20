/**
 * Pure projection of TripSummaryDTO into TripRecapFiguresDTO.
 *
 * Implements: Task 21.3, Task 22.7
 * Validates: Requirements 15.12, 15.16, 15.21, 15.22, Property 40, Property 43,
 * decisions D26 and D34
 */

import type {
  TripRecapFiguresDTO,
  TripRecapSuperlativeDTO,
  TripRecapTopRatedDTO,
  TripSummaryDTO,
} from '@dwt/shared';

/**
 * Pure allowlist projection that extracts only the safe recap figures
 * for a shared trip summary. The result is built from explicit literal keys and
 * never spreads the summary, so a field added to `TripSummaryDTO` later cannot
 * reach a recipient until it is added here, to Requirement 15.21 and to the
 * exact-key-set tests.
 *
 * Aggregate counts (decision D34) come from Trip-wide fields only. `perMember` is
 * never read, so nothing per-person (member ids, counts, ratings, avatar presets)
 * can be derived from it. `experienceId` is never copied into a top-rated row.
 */
export function projectRecapFigures(summary: TripSummaryDTO): TripRecapFiguresDTO {
  const distinctExperienceCount = summary.distinctExperienceCount;
  const plannedCompletedCount = summary.plannedCompletedCount;
  const plannedTotalCount = summary.plannedTotalCount;

  const superlatives: TripRecapSuperlativeDTO[] = (summary.superlatives ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    icon: s.icon,
    ...(s.experienceName !== undefined ? { experienceName: s.experienceName } : {}),
    ...(s.value !== undefined ? { value: s.value } : {}),
    ...(s.memberDisplayName !== undefined ? { memberDisplayName: s.memberDisplayName } : {}),
  }));

  // Catalog-only fields (park, category, imageUrl) are public catalog data, included
  // only when the Experience has them (null and undefined are both "absent").
  const topRated: TripRecapTopRatedDTO[] = (summary.topRated ?? []).slice(0, 3).map((item) => ({
    experienceName: item.experienceName,
    meanRating: item.meanRating,
    ratingCount: item.ratingCount,
    ...(item.park !== undefined && item.park !== null ? { park: item.park } : {}),
    ...(item.category !== undefined && item.category !== null ? { category: item.category } : {}),
    ...(item.imageUrl !== undefined && item.imageUrl !== null ? { imageUrl: item.imageUrl } : {}),
  }));

  return {
    distinctExperienceCount,
    plannedCompletedCount,
    plannedTotalCount,
    // The summary's totals are optional on the type: an absent total is an explicit 0
    // here (never a sum over perMember, which is forbidden).
    totalCompletionsCount: summary.totalCompletionsCount ?? 0,
    totalRatingsCount: summary.totalRatingsCount ?? 0,
    // Distinct parks, robust even if a breakdown ever repeats a park.
    parksExploredCount: new Set((summary.parkBreakdown ?? []).map((p) => p.park)).size,
    superlatives,
    topRated,
  };
}
