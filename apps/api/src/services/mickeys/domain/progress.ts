import type { MickeySummaryDTO, Park } from '@dwt/shared';

export interface MickeyProgressInputItem {
  readonly id: string;
  readonly official: boolean;
  readonly status: string;
  readonly park: Park | null;
}

const PARK_ORDER: Record<string, number> = {
  'Magic Kingdom': 1,
  'EPCOT': 2,
  'Hollywood Studios': 3,
  'Animal Kingdom': 4,
  'Typhoon Lagoon': 5,
  'Blizzard Beach': 6,
  'Disney Springs': 7,
};

/**
 * Summarizes hunt progress for a user (Requirements 2.5-2.8, Properties 5 and 6).
 *
 * Rules:
 * - Only approved Official Hidden Mickeys contribute to overall and byPark totals and finds.
 * - Total is independent of confidenceLabel, active flags, and reports on Official entries.
 * - Hidden Mickeys with park === null are all grouped into a single { park: null } entry.
 * - overall.total and overall.found equal the sum of byPark entries.
 * - community.found counts user finds on approved Community Hidden Mickeys.
 * - Community entries never alter overall or byPark totals or finds.
 */
export function summarizeProgress(
  mickeys: ReadonlyArray<MickeyProgressInputItem>,
  userFoundIds: ReadonlySet<string>,
): MickeySummaryDTO {
  const parkMap = new Map<Park | null, { total: number; found: number }>();
  let communityFound = 0;
  let communityTotal = 0;
  let overallTotal = 0;
  let overallFound = 0;

  for (const m of mickeys) {
    if (m.status !== 'approved') {
      continue;
    }

    if (!m.official) {
      communityTotal++;
      if (userFoundIds.has(m.id)) {
        communityFound++;
      }
      continue;
    }

    // Approved Official entry
    const isFound = userFoundIds.has(m.id);
    overallTotal++;
    if (isFound) {
      overallFound++;
    }

    const key = m.park ?? null;
    const existing = parkMap.get(key) ?? { total: 0, found: 0 };
    existing.total++;
    if (isFound) {
      existing.found++;
    }
    parkMap.set(key, existing);
  }

  const byPark = Array.from(parkMap.entries())
    .map(([park, counts]) => ({
      park,
      total: counts.total,
      found: counts.found,
    }))
    .sort((a, b) => {
      if (a.park === null) return 1;
      if (b.park === null) return -1;
      const orderA = PARK_ORDER[a.park] ?? 99;
      const orderB = PARK_ORDER[b.park] ?? 99;
      return orderA - orderB;
    });

  return {
    overall: {
      total: overallTotal,
      found: overallFound,
    },
    byPark,
    community: {
      found: communityFound,
      total: communityTotal,
    },
  };
}
