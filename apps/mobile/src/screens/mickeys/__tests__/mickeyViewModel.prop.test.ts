// Feature: hidden-mickeys, Property 24: Venue grouping and area summary resolution
import fc from 'fast-check';
import {
  MICKEY_CONFIDENCE_LABELS,
  MICKEY_DIFFICULTIES,
  MICKEY_ZONES,
  PARKS,
  type MickeyListItemDTO,
  type MickeySummaryDTO,
  type Park,
} from '@dwt/shared';
import {
  formatParkTabLabel,
  groupMickeysByVenue,
  resolveActiveAreaSummary,
  stepProgressLabel,
} from '../mickeyViewModel';

const parkOrNullArb = fc.option(fc.constantFrom(...PARKS), { nil: null });

const mickeyItemArb: fc.Arbitrary<MickeyListItemDTO> = fc.record({
  id: fc.uuid(),
  experienceId: fc.constantFrom('exp-a', 'exp-b', 'exp-c', 'exp-d'),
  experienceName: fc.constantFrom('Haunted Mansion', 'Space Mountain', 'California Grill', 'Jiko'),
  park: parkOrNullArb,
  land: fc.option(fc.constantFrom('Liberty Square', 'Tomorrowland', 'Contemporary Resort'), {
    nil: null,
  }),
  zone: fc.constantFrom(...MICKEY_ZONES),
  difficulty: fc.constantFrom(...MICKEY_DIFFICULTIES),
  clue1: fc.string({ minLength: 10, maxLength: 60 }),
  official: fc.boolean(),
  communityVerified: fc.boolean(),
  confidenceLabel: fc.constantFrom(...MICKEY_CONFIDENCE_LABELS),
  hintLevel: fc.constantFrom(1 as const, 2 as const, 3 as const),
  found: fc.boolean(),
});

describe('mickeyViewModel property tests (Property 24)', () => {
  it('groupMickeysByVenue partitions items by experienceId preserving venue and item order', () => {
    fc.assert(
      fc.property(fc.array(mickeyItemArb, { minLength: 0, maxLength: 30 }), (items) => {
        const groups = groupMickeysByVenue(items);

        // Total count across groups equals input length
        const sumCounts = groups.reduce((acc, g) => acc + g.items.length, 0);
        expect(sumCounts).toBe(items.length);

        // Distinct experienceIds in first-seen order
        const seenExpIds: string[] = [];
        for (const item of items) {
          if (!seenExpIds.includes(item.experienceId)) {
            seenExpIds.push(item.experienceId);
          }
        }
        expect(groups.map((g) => g.experienceId)).toEqual(seenExpIds);

        // Each group's foundCount, totalCount, and sub-item indices are exact
        for (const group of groups) {
          const expectedItems = items.filter((i) => i.experienceId === group.experienceId);
          expect(group.totalCount).toBe(expectedItems.length);
          expect(group.foundCount).toBe(expectedItems.filter((i) => i.found).length);
          expect(group.items.map((x) => x.item)).toEqual(expectedItems);

          group.items.forEach((sub, idx) => {
            expect(sub.indexInVenue).toBe(idx + 1);
            expect(sub.totalInVenue).toBe(expectedItems.length);
            expect(sub.mickeyPositionLabel).toBe(`Mickey ${idx + 1} of ${expectedItems.length}`);
          });
        }
      }),
      { numRuns: 100 },
    );
  });

  it('resolveActiveAreaSummary resolves All, Park, and Resort (null park) entries and clamps percent to [0, 100]', () => {
    const entryArb = (park: Park | null) =>
      fc
        .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))
        .map(([a, b]) => ({
          park,
          found: Math.min(a, b),
          total: Math.max(a, b),
        }));

    const summaryArb: fc.Arbitrary<MickeySummaryDTO> = fc
      .tuple(
        entryArb('Magic Kingdom'),
        entryArb('EPCOT'),
        entryArb(null),
        fc.integer({ min: 0, max: 50 }),
      )
      .map(([mk, ep, resort, commFound]) => ({
        overall: {
          found: mk.found + ep.found + resort.found,
          total: mk.total + ep.total + resort.total,
        },
        byPark: [mk, ep, resort],
        community: { found: commFound },
      }));

    fc.assert(
      fc.property(
        summaryArb,
        fc.constantFrom<'All' | Park | 'Resort'>('All', 'Magic Kingdom', 'EPCOT', 'Resort'),
        (summary, tab) => {
          const res = resolveActiveAreaSummary(summary, tab);
          expect(res.percent).toBeGreaterThanOrEqual(0);
          expect(res.percent).toBeLessThanOrEqual(100);

          if (tab === 'All') {
            expect(res.found).toBe(summary.overall.found);
            expect(res.total).toBe(summary.overall.total);
          } else if (tab === 'Resort') {
            const nullEntry = summary.byPark.find((p) => p.park === null)!;
            expect(res.found).toBe(nullEntry.found);
            expect(res.total).toBe(nullEntry.total);
          } else {
            const parkEntry = summary.byPark.find((p) => p.park === tab)!;
            expect(res.found).toBe(parkEntry.found);
            expect(res.total).toBe(parkEntry.total);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('stepProgressLabel reflects the highest unlocked step or found status', () => {
    expect(stepProgressLabel({ hintLevel: 1, found: false })).toBe('Step 1 of 3 Unlocked');
    expect(stepProgressLabel({ hintLevel: 2, clue2: 'Hint 2', found: false })).toBe(
      'Step 2 of 3 Unlocked',
    );
    expect(stepProgressLabel({ hintLevel: 3, reveal: 'Reveal', found: false })).toBe(
      'All 3 Steps Unlocked',
    );
    expect(stepProgressLabel({ hintLevel: 1, found: true })).toBe('All 3 Steps Unlocked');
  });

  it('clamps non-zero progress to at least 1% (e.g. 1/220 -> 1%) and formats park tab counts', () => {
    const summary: MickeySummaryDTO = {
      overall: { found: 1, total: 220 },
      byPark: [
        { park: 'Magic Kingdom', found: 0, total: 58 },
        { park: null, found: 1, total: 35 },
      ],
      community: { found: 0 },
    };

    expect(resolveActiveAreaSummary(summary, 'All').percent).toBe(1);
    expect(resolveActiveAreaSummary(summary, 'Magic Kingdom').percent).toBe(0);
    expect(resolveActiveAreaSummary(summary, 'Resort').percent).toBe(3);

    expect(formatParkTabLabel(summary, 'All')).toBe('All Parks 1/220');
    expect(formatParkTabLabel(summary, 'Magic Kingdom')).toBe('Magic Kingdom 0/58');
    expect(formatParkTabLabel(summary, 'Resort')).toBe('Resorts 1/35');
  });

  it('Property 24b: resolveActiveAreaSummary with community scope reflects community summary counts and items', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (commFound, extraTotal) => {
          const total = commFound + extraTotal;
          const summary: MickeySummaryDTO = {
            overall: { found: 10, total: 100 },
            byPark: [{ park: 'Magic Kingdom', found: 10, total: 100 }],
            community: { found: commFound, total },
          };

          const res = resolveActiveAreaSummary(summary, 'All', 'community');
          expect(res.found).toBe(commFound);
          expect(res.total).toBe(total);
          expect(res.percent).toBeGreaterThanOrEqual(0);
          expect(res.percent).toBeLessThanOrEqual(100);
          expect(res.subtext).toBe('Community finds across Disney World');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('formatParkTabLabel formats community counts correctly when scope is community', () => {
    const summary: MickeySummaryDTO = {
      overall: { found: 1, total: 220 },
      byPark: [{ park: 'Magic Kingdom', found: 1, total: 68 }],
      community: { found: 0, total: 1 },
    };

    const commItems: MickeyListItemDTO[] = [
      {
        id: 'comm-1',
        clue1: 'Near the register in the gift shop',
        zone: 'interior',
        difficulty: 'easy',
        official: false,
        experienceId: 'exp-resort',
        experienceName: 'Contemporary Gift Shop',
        land: null,
        park: null,
        hintLevel: 1,
        found: false,
        confidenceLabel: 'confirmed',
        communityVerified: true,
      },
    ];

    expect(formatParkTabLabel(summary, 'All', 'community', commItems)).toBe('All Parks 0/1');
    expect(formatParkTabLabel(summary, 'Resort', 'community', commItems)).toBe('Resorts 0/1');
    expect(formatParkTabLabel(summary, 'Magic Kingdom', 'community', commItems)).toBe(
      'Magic Kingdom 0/0',
    );
  });
});
