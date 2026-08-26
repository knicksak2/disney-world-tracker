// Feature: catalog-taxonomy-cleanup, Property 5: The queue gate follows the snapshot, not the category
// Feature: catalog-taxonomy-cleanup, Property 6: Ride behavior is preserved when prediction is unavailable
// Feature: catalog-taxonomy-cleanup, Property 7: A wait-posting show is never modeled at zero
// Feature: catalog-taxonomy-cleanup, Property 8: Duration never falls through to the ride default for a new category

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { EXPERIENCE_CATEGORIES, type ExperienceCategory, type WaitSnapshot } from '@dwt/shared';
import {
  DEFAULT_BREAK_DUR,
  DEFAULT_GAME_DUR,
  DEFAULT_PLAY_AREA_DUR,
  DEFAULT_RIDE_DUR,
  DEFAULT_WALKTHROUGH_DUR,
  isStandbyBearing,
  optimize,
  resolveDefaultDuration,
  type OptimizeInput,
  type OptimizeInputItem,
} from '../optimizer.js';

const mockDate = '2026-08-25';

function baseItem(overrides: Partial<OptimizeInputItem> = {}): OptimizeInputItem {
  return {
    id: 'item-1',
    experienceId: 'exp-1',
    park: 'Magic Kingdom',
    coords: { lat: 28.4177, lng: -81.5812 },
    plannedTime: null,
    isFixed: false,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: null,
    ...overrides,
  };
}

function baseInput(item: OptimizeInputItem, snapshots: Record<string, WaitSnapshot> = {}): OptimizeInput {
  return {
    items: [item],
    date: mockDate,
    walkingSpeed: 'moderate',
    earlyEntryEligible: false,
    snapshots,
    startHour: 10,
    endHour: 18,
    seed: 42,
  };
}

describe('optimizerTaxonomy - Unit / Branch Tests', () => {
  const bearingSnapshot: WaitSnapshot = {
    experienceId: 'exp-1',
    isVirtualQueue: false,
    waits: [
      { hour: 10, predictedWaitMinutes: 35 },
      { hour: 11, predictedWaitMinutes: 40 },
    ],
  };

  const nonBearingSnapshot: WaitSnapshot = {
    experienceId: 'exp-1',
    isVirtualQueue: false,
    waits: [],
  };

  it('isStandbyBearing returns true for valid wait arrays or virtual queues, and false otherwise', () => {
    expect(isStandbyBearing(undefined, false)).toBe(false);
    expect(isStandbyBearing(nonBearingSnapshot, false)).toBe(false);
    expect(isStandbyBearing(bearingSnapshot, false)).toBe(true);
    expect(
      isStandbyBearing(
        {
          experienceId: 'exp-1',
          isVirtualQueue: true,
          waits: [],
        },
        false,
      ),
    ).toBe(true);
    expect(
      isStandbyBearing(
        {
          experienceId: 'exp-1',
          isVirtualQueue: false,
          waits: [{ hour: 10, predictedWaitMinutes: -1, singleRiderWaitMinutes: 20 }],
        },
        true,
      ),
    ).toBe(true);
  });

  describe('Explicit Branch Tests (Requirement 3 & 4)', () => {
    it('Walkthrough with Standby_Bearing snapshot models non-zero wait', () => {
      const item = baseItem({ category: 'Walkthrough' });
      const res = optimize(baseInput(item, { 'exp-1': bearingSnapshot }));
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.predictedWaitMinutes).toBeGreaterThan(0);
      expect(res.totalWaitMinutes).toBeGreaterThan(0);
    });

    it('Walkthrough with non-bearing snapshot models 0 wait', () => {
      const item = baseItem({ category: 'Walkthrough' });
      const res = optimize(baseInput(item, { 'exp-1': nonBearingSnapshot }));
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.predictedWaitMinutes).toBe(0);
      expect(res.totalWaitMinutes).toBe(0);
    });

    it('PlayArea with Standby_Bearing snapshot models non-zero wait, non-bearing models 0', () => {
      const item = baseItem({ category: 'PlayArea' });
      const res1 = optimize(baseInput(item, { 'exp-1': bearingSnapshot }));
      expect(res1.items[0]?.predictedWaitMinutes).toBeGreaterThan(0);

      const res2 = optimize(baseInput(item, { 'exp-1': nonBearingSnapshot }));
      expect(res2.items[0]?.predictedWaitMinutes).toBe(0);
    });

    it('Game with Standby_Bearing snapshot models non-zero wait, non-bearing models 0', () => {
      const item = baseItem({ category: 'Game' });
      const res1 = optimize(baseInput(item, { 'exp-1': bearingSnapshot }));
      expect(res1.items[0]?.predictedWaitMinutes).toBeGreaterThan(0);

      const res2 = optimize(baseInput(item, { 'exp-1': nonBearingSnapshot }));
      expect(res2.items[0]?.predictedWaitMinutes).toBe(0);
    });

    it('Show with no showtimes but Standby_Bearing snapshot models standby path with non-zero wait and NO showtimes_unavailable warning (R3.6)', () => {
      const item = baseItem({ category: 'Show' });
      const res = optimize(baseInput(item, { 'exp-1': bearingSnapshot }));
      expect(res.items[0]?.predictedWaitMinutes).toBeGreaterThan(0);
      expect(res.warnings).toEqual([]);
      expect(res.items[0]?.scheduledShowtime).toBeNull();
    });

    it('Show with no showtimes and non-bearing snapshot models 0 wait and emits showtimes_unavailable warning', () => {
      const item = baseItem({ category: 'Show' });
      const res = optimize(baseInput(item, { 'exp-1': nonBearingSnapshot }));
      expect(res.items[0]?.predictedWaitMinutes).toBe(0);
      expect(res.warnings).toContain('showtimes_unavailable:item-1');
    });

    it('Show with showtimes slots to doors time on the showtime path (R3.5)', () => {
      // 12:00 PM EDT = 16:00 UTC
      const showtimeSnap: WaitSnapshot = {
        experienceId: 'exp-1',
        isVirtualQueue: false,
        showtimes: ['2026-08-25T16:00:00.000Z'],
        waits: [{ hour: 10, predictedWaitMinutes: 50 }],
      };
      const item = baseItem({ category: 'Show' });
      const res = optimize(baseInput(item, { 'exp-1': showtimeSnap }));
      expect(res.items[0]?.predictedWaitMinutes).toBe(15);
      expect(res.items[0]?.scheduledShowtime).toBe('2026-08-25T16:00:00.000Z');
    });

    it('Duration resolution applies correct category defaults and precedence (R4.1-R4.5)', () => {
      // Defaults when no overrides
      expect(resolveDefaultDuration(baseItem({ category: 'Walkthrough' }))).toBe(DEFAULT_WALKTHROUGH_DUR);
      expect(resolveDefaultDuration(baseItem({ category: 'PlayArea' }))).toBe(DEFAULT_PLAY_AREA_DUR);
      expect(resolveDefaultDuration(baseItem({ category: 'Game' }))).toBe(DEFAULT_GAME_DUR);
      expect(resolveDefaultDuration(baseItem({ category: 'Ride' }))).toBe(DEFAULT_RIDE_DUR);
      expect(resolveDefaultDuration(baseItem({ itemType: 'break' }))).toBe(DEFAULT_BREAK_DUR);

      // Catalog duration precedence
      expect(
        resolveDefaultDuration(
          baseItem({ category: 'Walkthrough', catalogDurationMinutes: 45 }),
        ),
      ).toBe(45);
      expect(
        resolveDefaultDuration(
          baseItem({ category: 'PlayArea', catalogDurationMinutes: 15 }),
        ),
      ).toBe(15);
      expect(
        resolveDefaultDuration(
          baseItem({ category: 'Game', catalogDurationMinutes: 50 }),
        ),
      ).toBe(50);

      // User duration override always wins over catalog duration
      expect(
        resolveDefaultDuration(
          baseItem({
            category: 'Walkthrough',
            catalogDurationMinutes: 45,
            durationMinutes: 10,
          }),
        ),
      ).toBe(10);
    });
  });
});

describe('optimizerTaxonomy - Property Tests', () => {
  const NUM_RUNS = 200;

  const validCategories: readonly ExperienceCategory[] = EXPERIENCE_CATEGORIES;
  const nonShowCategories: readonly ExperienceCategory[] = EXPERIENCE_CATEGORIES.filter(
    (c) => c !== 'Show' && c !== 'Parade',
  );

  const standbyBearingSnapshotArb: fc.Arbitrary<WaitSnapshot> = fc.record({
    experienceId: fc.constant('exp-1'),
    isVirtualQueue: fc.boolean(),
    waits: fc.array(
      fc
        .record({
          hour: fc.integer({ min: 0, max: 23 }),
          predictedWaitMinutes: fc.integer({ min: 1, max: 120 }),
          hasSingleRider: fc.boolean(),
          singleRiderWaitMinutes: fc.integer({ min: 1, max: 60 }),
        })
        .map((w) =>
          w.hasSingleRider
            ? {
                hour: w.hour,
                predictedWaitMinutes: w.predictedWaitMinutes,
                singleRiderWaitMinutes: w.singleRiderWaitMinutes,
              }
            : {
                hour: w.hour,
                predictedWaitMinutes: w.predictedWaitMinutes,
              },
        ),
      { minLength: 1, maxLength: 5 },
    ),
  });

  it('Property 5: The queue gate follows the snapshot, not the category (Category-Invariance)', () => {
    fc.assert(
      fc.property(
        standbyBearingSnapshotArb,
        fc.constantFrom(...nonShowCategories),
        fc.constantFrom(...nonShowCategories),
        (snapshot, catA, catB) => {
          const itemA = baseItem({ category: catA });
          const itemB = baseItem({ category: catB });

          const resA = optimize(baseInput(itemA, { 'exp-1': snapshot }));
          const resB = optimize(baseInput(itemB, { 'exp-1': snapshot }));

          // Modeled wait is strictly identical holding snapshot fixed and varying category
          expect(resA.items[0]?.predictedWaitMinutes).toBe(resB.items[0]?.predictedWaitMinutes);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 6: Ride behavior is preserved when prediction is unavailable', () => {
    fc.assert(
      fc.property(fc.constantFrom(...validCategories), fc.boolean(), (category, isLightningLane) => {
        const item = baseItem({ category, isLightningLane });
        // Empty snapshots map
        const res = optimize(baseInput(item, {}));

        if (category === 'Ride' || category === 'Character_Meet') {
          const expectedWait = isLightningLane ? 10 : 30;
          expect(res.items[0]?.predictedWaitMinutes).toBe(expectedWait);
        } else {
          expect(res.items[0]?.predictedWaitMinutes).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 7: A wait-posting show is never modeled at zero', () => {
    fc.assert(
      fc.property(
        standbyBearingSnapshotArb,
        fc.constantFrom('Show' as const, 'Parade' as const),
        (snapshot, category) => {
          // Snapshot without showtimes but Standby_Bearing
          const { showtimes: _st, ...rest } = snapshot;
          const snapWithoutShowtimes: WaitSnapshot = {
            ...rest,
            isVirtualQueue: false,
          };

          const item = baseItem({ category });
          const res = optimize(baseInput(item, { 'exp-1': snapWithoutShowtimes }));

          // Never zero (unless VQ), and no showtimes_unavailable warning
          expect(res.items[0]?.predictedWaitMinutes).toBeGreaterThan(0);
          expect(res.warnings).not.toContain(`showtimes_unavailable:${item.id}`);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 8: Duration never falls through to the ride default for a new category', () => {
    const newCategoryArb = fc.constantFrom(
      { category: 'Walkthrough' as const, defaultDur: DEFAULT_WALKTHROUGH_DUR },
      { category: 'PlayArea' as const, defaultDur: DEFAULT_PLAY_AREA_DUR },
      { category: 'Game' as const, defaultDur: DEFAULT_GAME_DUR },
    );

    fc.assert(
      fc.property(
        newCategoryArb,
        fc.option(fc.integer({ min: 1, max: 180 }), { nil: null }),
        fc.option(fc.integer({ min: 1, max: 180 }), { nil: null }),
        ({ category, defaultDur }, userDuration, catalogDuration) => {
          const item = baseItem({
            category,
            durationMinutes: userDuration,
            catalogDurationMinutes: catalogDuration,
          });

          const resolved = resolveDefaultDuration(item);

          if (userDuration !== null) {
            expect(resolved).toBe(userDuration);
          } else if (catalogDuration !== null) {
            expect(resolved).toBe(catalogDuration);
          } else {
            expect(resolved).toBe(defaultDur);
            expect(resolved).not.toBe(DEFAULT_RIDE_DUR);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
