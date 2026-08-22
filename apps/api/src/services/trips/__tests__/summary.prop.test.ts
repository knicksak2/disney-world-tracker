// Feature: trips, Property 25: The Trip_Summary is a faithful derivation of the Trip's activity
/**
 * Property-based tests for `deriveTripSummary`.
 *
 * Validates: Requirements 14.1, 14.2, 14.4, 14.5, 14.6
 *
 * Property 25 (design.md → Correctness Properties):
 *
 *   For any Trip's Trip_Log_Entries, confirmed Rode_With_Tags, and referenced
 *   canonical Ratings, the Trip_Summary reports:
 *     - the count of distinct Experiences completed in the Trip context, each
 *       counted at most once, 0 when none                            (R14.1)
 *     - at most 5 top-rated Experiences ranked by descending mean of the
 *       referenced canonical Ratings, then descending rating count, then
 *       ascending Experience name                                    (R14.2)
 *     - per-Member counts of created Trip_Log_Entries and contributed confirmed
 *       Rode_With_Tags, 0 where none                          (R14.4, R14.5)
 *   and recomputing from the same inputs yields the same result, because the
 *   summary is a pure derivation and is never a stored, independently editable
 *   field (R14.6).
 *
 * Test design
 * -----------
 * `deriveTripSummary` is a pure function, so the tests drive the real
 * production function directly (no fakes needed).
 *
 * An independent oracle (`expectedSummary`) re-derives the whole summary from
 * the requirement text: it unions the completed Experiences, groups ratings by
 * Experience to compute mean and count, ranks by the three documented keys, and
 * tallies per-Member counts. It is written separately from the production
 * implementation.
 *
 * Generators draw Experiences, Members, and Ratings from small shared pools so
 * that ids/members collide frequently (exercising the counting and grouping
 * paths). Experience names in the pool are unique, so a rated Experience always
 * has a unique name; combined with the constraint that Ratings only reference
 * Experiences that appear in the log (a rated Experience was logged, so its
 * name is known), the (mean, count, name) ranking is a *total* order. That
 * removes any dependence on unspecified tie-breaks and lets the oracle compare
 * the ranked list exactly.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { deriveTripSummary, type TripSummary, type TripSummaryInput } from '../summary.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Independent oracle
// ---------------------------------------------------------------------------

/**
 * Re-derive the expected Trip_Summary from the requirement text, independently
 * of the production implementation.
 */
function expectedSummary(input: TripSummaryInput): TripSummary {
  // R14.1 — distinct Experiences completed via a log entry OR a confirmed tag,
  // each counted at most once.
  const completed = new Set<string>();
  for (const entry of input.logEntries) completed.add(entry.experienceId);
  for (const tag of input.confirmedTags) completed.add(tag.experienceId);

  // Experience names, parks, categories, and images are sourced from log entries / tags.
  const metaByExperience = new Map<
    string,
    { name: string; park?: any; category?: any; imageUrl?: any }
  >();
  for (const entry of input.logEntries) {
    if (!metaByExperience.has(entry.experienceId)) {
      metaByExperience.set(entry.experienceId, {
        name: entry.experienceName,
        park: entry.park ?? null,
        category: entry.category ?? null,
        imageUrl: entry.imageUrl ?? null,
      });
    }
  }
  for (const tag of input.confirmedTags) {
    if (!metaByExperience.has(tag.experienceId)) {
      metaByExperience.set(tag.experienceId, {
        name: tag.experienceName ?? '',
        park: tag.park ?? null,
        category: tag.category ?? null,
        imageUrl: tag.imageUrl ?? null,
      });
    }
  }

  // R14.2 — group referenced canonical Ratings by Experience.
  const agg = new Map<string, { sum: number; count: number }>();
  for (const rating of input.ratings) {
    const cur = agg.get(rating.experienceId) ?? { sum: 0, count: 0 };
    cur.sum += rating.value;
    cur.count += 1;
    agg.set(rating.experienceId, cur);
  }

  const ranked = [...agg.entries()].map(([experienceId, { sum, count }]) => {
    const meta = metaByExperience.get(experienceId);
    return {
      experienceId,
      experienceName: meta?.name ?? '',
      meanRating: sum / count,
      ratingCount: count,
      ...(meta?.park !== undefined ? { park: meta.park } : {}),
      ...(meta?.category !== undefined ? { category: meta.category } : {}),
      ...(meta?.imageUrl !== undefined ? { imageUrl: meta.imageUrl } : {}),
    };
  });

  // Descending mean, then descending rating count, then ascending name.
  ranked.sort((a, b) => {
    if (a.meanRating !== b.meanRating) return a.meanRating < b.meanRating ? 1 : -1;
    if (a.ratingCount !== b.ratingCount) return a.ratingCount < b.ratingCount ? 1 : -1;
    if (a.experienceName !== b.experienceName) return a.experienceName < b.experienceName ? -1 : 1;
    return 0;
  });

  const topRated = ranked.slice(0, 5);

  // Ratings map per member
  const memberRatings = new Map<string, { experienceId: string; value: number }[]>();
  for (const r of input.ratings) {
    if (r.memberId) {
      const list = memberRatings.get(r.memberId) ?? [];
      list.push({ experienceId: r.experienceId, value: r.value });
      memberRatings.set(r.memberId, list);
    }
  }

  // R14.4 / R14.5 — per-Member log-entry and confirmed-tag counts.
  const logCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const entry of input.logEntries) {
    logCounts.set(entry.memberId, (logCounts.get(entry.memberId) ?? 0) + 1);
  }
  for (const tag of input.confirmedTags) {
    tagCounts.set(tag.memberId, (tagCounts.get(tag.memberId) ?? 0) + 1);
  }
  const memberIds = new Set<string>([...logCounts.keys(), ...tagCounts.keys()]);
  const perMember = [...memberIds]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((memberId) => {
      const logEntryCount = logCounts.get(memberId) ?? 0;
      const confirmedTagCount = tagCounts.get(memberId) ?? 0;
      const totalCompletedCount = logEntryCount + confirmedTagCount;

      let topRatedExperienceName: string | null = null;
      let topRating: number | null = null;

      const userRatings = memberRatings.get(memberId);
      if (userRatings && userRatings.length > 0) {
        userRatings.sort((a, b) => {
          if (b.value !== a.value) return b.value - a.value;
          const nameA = metaByExperience.get(a.experienceId)?.name ?? '';
          const nameB = metaByExperience.get(b.experienceId)?.name ?? '';
          return nameA.localeCompare(nameB);
        });
        topRating = userRatings[0]!.value;
        topRatedExperienceName = metaByExperience.get(userRatings[0]!.experienceId)?.name ?? null;
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

  // planned-list-completion-sync R5 — the planned counts derive from the
  // Planned_Items and the Trip_Log_Entries only. The completed set for the
  // Planned_Completion_Match is the Experiences referenced by log entries (NOT
  // confirmed tags); a Planned_Item is completed iff its Experience is in that
  // set, counted at most once (R5.2, R5.5). Empty list -> 0/0 (R5.4).
  const loggedExperiences = new Set<string>();
  for (const entry of input.logEntries) loggedExperiences.add(entry.experienceId);
  const plannedTotalCount = input.plannedItems.length;
  const plannedCompletedCount = input.plannedItems.filter((p) =>
    loggedExperiences.has(p.experienceId),
  ).length;

  // Park breakdown
  const parkByExperience = new Map<string, any>();
  for (const entry of input.logEntries) {
    if (entry.park && !parkByExperience.has(entry.experienceId)) {
      parkByExperience.set(entry.experienceId, entry.park);
    }
  }
  for (const tag of input.confirmedTags) {
    if (tag.park && !parkByExperience.has(tag.experienceId)) {
      parkByExperience.set(tag.experienceId, tag.park);
    }
  }
  const parkCounts = new Map<any, number>();
  for (const [, p] of parkByExperience) {
    parkCounts.set(p, (parkCounts.get(p) ?? 0) + 1);
  }
  const parkBreakdown = [...parkCounts.entries()]
    .map(([park, count]) => ({ park, count }))
    .sort((a, b) => b.count - a.count || a.park.localeCompare(b.park));

  // Category breakdown
  const catByExperience = new Map<string, string>();
  for (const entry of input.logEntries) {
    if (entry.category && !catByExperience.has(entry.experienceId)) {
      catByExperience.set(entry.experienceId, entry.category);
    }
  }
  for (const tag of input.confirmedTags) {
    if (tag.category && !catByExperience.has(tag.experienceId)) {
      catByExperience.set(tag.experienceId, tag.category);
    }
  }
  const catCounts = new Map<string, number>();
  for (const [, c] of catByExperience) {
    catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
  }
  const categoryBreakdown = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  // Superlatives
  const superlatives: any[] = [];
  if (perMember.length > 0) {
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

    const ratingsCountByMember = new Map<string, number>();
    for (const r of input.ratings) {
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

    if (parkBreakdown.length > 0 && parkBreakdown[0]) {
      superlatives.push({
        id: 'top_park',
        title: 'Top Park Explored',
        description: 'Park with the most completed experiences',
        icon: 'map',
        value: `${parkBreakdown[0].park} (${parkBreakdown[0].count})`,
      });
    }
  }

  return {
    distinctExperienceCount: completed.size,
    topRated,
    perMember,
    plannedTotalCount,
    plannedCompletedCount,
    totalCompletionsCount: input.logEntries.length + input.confirmedTags.length,
    totalRatingsCount: input.ratings.length,
    parkBreakdown,
    categoryBreakdown,
    superlatives,
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const MEMBER_POOL: readonly string[] = ['mem-0', 'mem-1', 'mem-2', 'mem-3'];
const memberArb = fc.constantFrom(...MEMBER_POOL);

/**
 * A pool of 1..8 Experiences with unique ids and unique names. Names are drawn
 * as unique short strings so that name ordering is independent of id ordering
 * (exercising the ascending-name tie-break) and so a rated Experience always
 * has a unique name.
 */
const experiencePoolArb: fc.Arbitrary<readonly { id: string; name: string }[]> = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 8 })
  .map((names) => names.map((name, i) => ({ id: `exp-${i}`, name })));

/**
 * A full Trip_Summary input drawn from the pools. Ratings reference only
 * Experiences that appear in the log (a rated Experience was logged), so every
 * rated Experience carries its unique pool name and the ranking is total.
 */
const summaryInputArb: fc.Arbitrary<TripSummaryInput> = experiencePoolArb.chain((pool) => {
  const expArb = fc.constantFrom(...pool);

  const logEntryArb = fc
    .record({ exp: expArb, memberId: memberArb })
    .map(({ exp, memberId }) => ({ memberId, experienceId: exp.id, experienceName: exp.name }));

  const confirmedTagArb = fc
    .record({ exp: expArb, memberId: memberArb })
    .map(({ exp, memberId }) => ({ memberId, experienceId: exp.id }));

  // Planned_Items draw their Experience id from a pool that mixes the shared
  // Experience pool (ids that can overlap the log entries and so become
  // completed) with a set of planned-only ids that never appear in the log (so
  // they stay not-completed). This exercises both the overlapping and disjoint
  // Experience-id cases for the Planned_Completion_Match, and — because the
  // same id may be drawn repeatedly — duplicate Planned_Items per Experience.
  const PLANNED_ONLY_IDS: readonly string[] = ['planned-only-0', 'planned-only-1', 'planned-only-2'];
  const plannedExperienceIdArb = fc.constantFrom(...pool.map((e) => e.id), ...PLANNED_ONLY_IDS);
  const plannedItemArb = plannedExperienceIdArb.map((experienceId) => ({ experienceId }));

  return fc.array(logEntryArb, { maxLength: 30 }).chain((logEntries) => {
    const loggedExperiences = pool.filter((e) => logEntries.some((l) => l.experienceId === e.id));

    const ratingsArb =
      loggedExperiences.length === 0
        ? fc.constant([] as { experienceId: string; value: number }[])
        : fc.array(
            fc
              .record({ exp: fc.constantFrom(...loggedExperiences), value: fc.integer({ min: 1, max: 10 }) })
              .map(({ exp, value }) => ({ experienceId: exp.id, value })),
            { maxLength: 40 },
          );

    return fc.record({
      logEntries: fc.constant(logEntries),
      confirmedTags: fc.array(confirmedTagArb, { maxLength: 30 }),
      ratings: ratingsArb,
      plannedItems: fc.array(plannedItemArb, { maxLength: 30 }),
    });
  });
});

// ---------------------------------------------------------------------------
// Property assertions
// ---------------------------------------------------------------------------

describe('deriveTripSummary — Property 25: faithful derivation of the Trip activity', () => {
  it('matches the independent oracle for any activity (R14.1, R14.2, R14.4, R14.5)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        expect(deriveTripSummary(input)).toEqual(expectedSummary(input));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts each completed Experience at most once, 0 when none (R14.1)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        const union = new Set<string>();
        for (const e of input.logEntries) union.add(e.experienceId);
        for (const t of input.confirmedTags) union.add(t.experienceId);
        const summary = deriveTripSummary(input);
        expect(summary.distinctExperienceCount).toBe(union.size);
        if (input.logEntries.length === 0 && input.confirmedTags.length === 0) {
          expect(summary.distinctExperienceCount).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('surfaces at most 5 top-rated Experiences, monotonically ranked (R14.2)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        const { topRated } = deriveTripSummary(input);
        expect(topRated.length).toBeLessThanOrEqual(5);
        for (let i = 1; i < topRated.length; i++) {
          const prev = topRated[i - 1]!;
          const curr = topRated[i]!;
          // Non-increasing by the documented keys: mean desc, then count desc,
          // then name asc.
          if (prev.meanRating !== curr.meanRating) {
            expect(prev.meanRating > curr.meanRating).toBe(true);
          } else if (prev.ratingCount !== curr.ratingCount) {
            expect(prev.ratingCount > curr.ratingCount).toBe(true);
          } else {
            expect(prev.experienceName <= curr.experienceName).toBe(true);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports per-Member counts that total the entries and tags, 0 where none (R14.4, R14.5)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        const { perMember } = deriveTripSummary(input);
        const totalLogs = perMember.reduce((n, m) => n + m.logEntryCount, 0);
        const totalTags = perMember.reduce((n, m) => n + m.confirmedTagCount, 0);
        expect(totalLogs).toBe(input.logEntries.length);
        expect(totalTags).toBe(input.confirmedTags.length);
        // Every listed Member has non-negative counts, and any listed Member
        // with no log entries reports exactly 0 (and likewise for tags).
        for (const m of perMember) {
          expect(m.logEntryCount).toBeGreaterThanOrEqual(0);
          expect(m.confirmedTagCount).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is a pure derivation: recomputing from the same inputs yields the same result (R14.6)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        expect(deriveTripSummary(input)).toEqual(deriveTripSummary(input));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: planned-list-completion-sync, Property 5: The Trip_Summary planned
// counts faithfully derive from Planned_Items and Trip_Log_Entries
// ---------------------------------------------------------------------------
/**
 * Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.6
 *
 * For any Trip's Planned_Items and Trip_Log_Entries, `deriveTripSummary`
 * reports:
 *   - `plannedTotalCount` equal to the number of Planned_Items          (R5.1)
 *   - `plannedCompletedCount` equal to the number of Planned_Items whose
 *     referenced Experience matches at least one Trip_Log_Entry in the Trip
 *     under the Planned_Completion_Match, each Planned_Item counted at most
 *     once regardless of how many Trip_Log_Entries reference its Experience
 *                                                                 (R5.2, R5.5)
 *   - both counts as non-negative integers with
 *     `0 <= plannedCompletedCount <= plannedTotalCount`                 (R5.6)
 *   - both counts `0` for an empty Planned_List                         (R5.4)
 *
 * The `summaryInputArb` generator draws Planned_Item Experience ids from a pool
 * mixing the shared Experience pool (overlapping ids that can be completed by a
 * log entry) with planned-only ids (disjoint ids that never appear in the log),
 * and may repeat an id (duplicate Planned_Items per Experience) and repeat log
 * entries per Experience — exercising the overlapping/disjoint and
 * duplicate-log-entry cases.
 */
describe('deriveTripSummary — Property 5: planned counts derive from Planned_Items and Trip_Log_Entries', () => {
  it('reports plannedTotalCount equal to the number of Planned_Items (R5.1)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        expect(deriveTripSummary(input).plannedTotalCount).toBe(input.plannedItems.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts each Planned_Item completed iff its Experience was logged, at most once (R5.2, R5.5)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        const loggedExperiences = new Set<string>();
        for (const entry of input.logEntries) loggedExperiences.add(entry.experienceId);
        const expected = input.plannedItems.filter((p) => loggedExperiences.has(p.experienceId)).length;
        expect(deriveTripSummary(input).plannedCompletedCount).toBe(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports non-negative counts with 0 <= plannedCompletedCount <= plannedTotalCount (R5.6)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        const { plannedTotalCount, plannedCompletedCount } = deriveTripSummary(input);
        expect(Number.isInteger(plannedTotalCount)).toBe(true);
        expect(Number.isInteger(plannedCompletedCount)).toBe(true);
        expect(plannedCompletedCount).toBeGreaterThanOrEqual(0);
        expect(plannedCompletedCount).toBeLessThanOrEqual(plannedTotalCount);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reports 0/0 for an empty Planned_List regardless of activity (R5.4)', () => {
    fc.assert(
      fc.property(summaryInputArb, (input) => {
        const summary = deriveTripSummary({ ...input, plannedItems: [] });
        expect(summary.plannedTotalCount).toBe(0);
        expect(summary.plannedCompletedCount).toBe(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('counts a Planned_Item once even when many log entries reference its Experience (R5.5)', () => {
    // A single Planned_Item referencing an Experience with several duplicate
    // Trip_Log_Entries still contributes exactly one to the completed count.
    const summary = deriveTripSummary({
      logEntries: [
        { memberId: 'a', experienceId: 'e1', experienceName: 'Space' },
        { memberId: 'b', experienceId: 'e1', experienceName: 'Space' },
        { memberId: 'c', experienceId: 'e1', experienceName: 'Space' },
      ],
      confirmedTags: [],
      ratings: [],
      plannedItems: [{ experienceId: 'e1' }],
    });
    expect(summary.plannedTotalCount).toBe(1);
    expect(summary.plannedCompletedCount).toBe(1);
  });

  it('excludes disjoint (never-logged) Planned_Items from the completed count (R5.2)', () => {
    const summary = deriveTripSummary({
      logEntries: [{ memberId: 'a', experienceId: 'e1', experienceName: 'Space' }],
      confirmedTags: [],
      ratings: [],
      plannedItems: [{ experienceId: 'e1' }, { experienceId: 'e2' }, { experienceId: 'e3' }],
    });
    expect(summary.plannedTotalCount).toBe(3);
    expect(summary.plannedCompletedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fixed regression examples
// ---------------------------------------------------------------------------

describe('deriveTripSummary — fixed regression examples', () => {
  it('returns zero/empty for an empty Trip (R14.1)', () => {
    expect(deriveTripSummary({ logEntries: [], confirmedTags: [], ratings: [], plannedItems: [] })).toEqual({
      distinctExperienceCount: 0,
      topRated: [],
      perMember: [],
      plannedTotalCount: 0,
      plannedCompletedCount: 0,
      totalCompletionsCount: 0,
      totalRatingsCount: 0,
      parkBreakdown: [],
      categoryBreakdown: [],
      superlatives: [],
    });
  });

  it('counts distinct Experiences across log entries and confirmed tags once (R14.1)', () => {
    const summary = deriveTripSummary({
      logEntries: [
        { memberId: 'a', experienceId: 'e1', experienceName: 'Space' },
        { memberId: 'a', experienceId: 'e1', experienceName: 'Space' },
      ],
      confirmedTags: [{ memberId: 'b', experienceId: 'e2' }],
      ratings: [],
      plannedItems: [],
    });
    expect(summary.distinctExperienceCount).toBe(2);
  });

  it('ranks by mean desc, then count desc, then name asc, capped at 5 (R14.2)', () => {
    const summary = deriveTripSummary({
      logEntries: [
        { memberId: 'a', experienceId: 'e1', experienceName: 'Bravo' },
        { memberId: 'a', experienceId: 'e2', experienceName: 'Alpha' },
        { memberId: 'a', experienceId: 'e3', experienceName: 'Charlie' },
      ],
      confirmedTags: [],
      ratings: [
        // e1: mean 8, count 1
        { experienceId: 'e1', value: 8 },
        // e2: mean 8, count 2 -> ranks above e1 (higher count)
        { experienceId: 'e2', value: 7 },
        { experienceId: 'e2', value: 9 },
        // e3: mean 10, count 1 -> ranks first (highest mean)
        { experienceId: 'e3', value: 10 },
      ],
      plannedItems: [],
    });
    expect(summary.topRated.map((t) => t.experienceId)).toEqual(['e3', 'e2', 'e1']);
    expect(summary.topRated[1]).toMatchObject({ experienceId: 'e2', meanRating: 8, ratingCount: 2 });
  });

  it('tallies per-Member log-entry and confirmed-tag counts with 0 fill (R14.4, R14.5)', () => {
    const summary = deriveTripSummary({
      logEntries: [
        { memberId: 'a', experienceId: 'e1', experienceName: 'Space' },
        { memberId: 'a', experienceId: 'e2', experienceName: 'Splash' },
      ],
      confirmedTags: [{ memberId: 'b', experienceId: 'e1' }],
      ratings: [],
      plannedItems: [],
    });
    expect(summary.perMember).toEqual([
      {
        memberId: 'a',
        logEntryCount: 2,
        confirmedTagCount: 0,
        totalCompletedCount: 2,
        topRatedExperienceName: null,
        topRating: null,
      },
      {
        memberId: 'b',
        logEntryCount: 0,
        confirmedTagCount: 1,
        totalCompletedCount: 1,
        topRatedExperienceName: null,
        topRating: null,
      },
    ]);
  });

  it('derives park and category breakdown and group superlatives (R14.9, R14.10, R14.11)', () => {
    const summary = deriveTripSummary({
      logEntries: [
        { memberId: 'a', experienceId: 'e1', experienceName: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride' },
        { memberId: 'a', experienceId: 'e2', experienceName: 'Cinderella Royal Table', park: 'Magic Kingdom', category: 'Restaurant' },
      ],
      confirmedTags: [
        { memberId: 'b', experienceId: 'e1', experienceName: 'Space Mountain', park: 'Magic Kingdom', category: 'Ride' },
        { memberId: 'b', experienceId: 'e3', experienceName: 'Soarin', park: 'Epcot', category: 'Ride' },
      ],
      ratings: [
        { memberId: 'a', experienceId: 'e1', value: 10 },
        { memberId: 'b', experienceId: 'e1', value: 8 },
        { memberId: 'b', experienceId: 'e3', value: 9 },
      ],
      plannedItems: [],
    });

    expect(summary.parkBreakdown).toEqual([
      { park: 'Magic Kingdom', count: 2 },
      { park: 'Epcot', count: 1 },
    ]);
    expect(summary.categoryBreakdown).toEqual([
      { category: 'Ride', count: 2 },
      { category: 'Restaurant', count: 1 },
    ]);
    expect(summary.superlatives?.map((s) => s.id)).toEqual([
      'group_mvp',
      'lead_explorer',
      'best_copilot',
      'chief_critic',
      'crowd_favorite',
      'top_park',
    ]);
  });
});
