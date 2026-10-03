// Feature: navigation-redesign, Property 2: Sort/filter never drops or duplicates a Row and resolves closed/down last
// Feature: navigation-redesign, Property 3: Walk-on/Headliner are threshold/id-exact and monotonic
/**
 * Property-based tests for parkLiveView.ts (Task 5.2).
 *
 * Validates: Requirements 10.2, 10.4, 10.5
 */

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import {
  HEADLINER_EXPERIENCE_IDS,
  type ExperienceDTO,
  type ParkLiveEntryDTO,
} from '@dwt/shared';

import {
  buildLiveWaitsRows,
  getWaitStatus,
  isHeadliner,
  isLiveWaitEligible,
  isWalkOn,
  type LiveWaitsFilter,
} from '../parkLiveView';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const statusArb = fc.constantFrom('OPERATING', 'CLOSED', 'DOWN', 'REFURBISHMENT', 'UNKNOWN', 'operating', 'closed');

const entryArb: fc.Arbitrary<ParkLiveEntryDTO> = fc.record({
  experienceId: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  status: statusArb,
  waitMinutes: fc.oneof(
    fc.integer({ min: 0, max: 300 }),
    fc.constant(null),
  ),
});

const filterArb: fc.Arbitrary<LiveWaitsFilter> = fc.constantFrom('all', 'walkOn', 'lightningLane', 'headliners');

function createMockExperience(id: string): ExperienceDTO {
  return {
    id,
    name: 'Experience ' + id,
    park: 'Magic Kingdom',
    category: 'Ride',
    active: true,
    description: '',
    imageUrl: null,
    areaType: 'ThemePark',
  };
}

describe('parkLiveView property tests', () => {
  it('Property 2: Sort/filter never drops or duplicates a Row and resolves closed/down last', () => {
    fc.assert(
      fc.property(
        fc.array(entryArb, { maxLength: 25 }),
        filterArb,
        (entries, filter) => {
          // Build experience map
          const experiencesById = new Map<string, ExperienceDTO>();
          for (const entry of entries) {
            experiencesById.set(entry.experienceId, createMockExperience(entry.experienceId));
          }

          const rows = buildLiveWaitsRows(entries, experiencesById, filter);

          // 1. Result has no duplicate experienceIds
          const seenIds = new Set<string>();
          for (const row of rows) {
            expect(seenIds.has(row.experienceId)).toBe(false);
            seenIds.add(row.experienceId);
          }

          // 2. Result is a subset of input experienceIds
          const inputIds = new Set(entries.map((e) => e.experienceId));
          for (const row of rows) {
            expect(inputIds.has(row.experienceId)).toBe(true);
          }

          // 3. Under 'all', every unique input entry is present exactly once
          if (filter === 'all') {
            expect(rows.length).toBe(inputIds.size);
          }

          // 4. Numeric-wait Rows precede closed/down Rows
          let seenClosedOrDown = false;
          for (const row of rows) {
            if (row.isClosedOrDown) {
              seenClosedOrDown = true;
            } else {
              expect(seenClosedOrDown).toBe(false);
            }
          }

          // 5. Numeric-wait Rows are sorted ascending by waitMinutes
          const numericRows = rows.filter((r) => !r.isClosedOrDown);
          for (let i = 0; i < numericRows.length - 1; i++) {
            const current = numericRows[i]!.waitMinutes!;
            const next = numericRows[i + 1]!.waitMinutes!;
            expect(current).toBeLessThanOrEqual(next);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 3: Walk-on/Headliner are threshold/id-exact and monotonic', () => {
    // Amendment (Requirement 10.5a): isHeadliner now checks id-allowlist
    // membership against HEADLINER_EXPERIENCE_IDS rather than a thrillFactor
    // facet intersection — generate candidate ids from a mix of real curated
    // ids and arbitrary ones so both the true and false branches are exercised.
    const candidateIdArb = fc.oneof(
      fc.constantFrom(...HEADLINER_EXPERIENCE_IDS),
      fc.uuid(),
    );
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: -50, max: 200 }), fc.constant(null)),
        fc.integer({ min: 10, max: 60 }),
        candidateIdArb,
        (waitMinutes, threshold, candidateId) => {
          // Walk-on exactness:
          const walkOn = isWalkOn(waitMinutes, threshold);
          const expectedWalkOn = waitMinutes !== null && waitMinutes >= 0 && waitMinutes <= threshold;
          expect(walkOn).toBe(expectedWalkOn);

          // Monotonicity: raising the threshold never removes a previously included row
          if (walkOn) {
            expect(isWalkOn(waitMinutes, threshold + 10)).toBe(true);
          }

          // Headliner exactness:
          const exp = createMockExperience(candidateId);
          const headliner = isHeadliner(exp);
          const expectedHeadliner = (HEADLINER_EXPERIENCE_IDS as readonly string[]).includes(candidateId);
          expect(headliner).toBe(expectedHeadliner);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  describe('isLiveWaitEligible and category filtering (Requirement 10.2)', () => {
    it('always excludes Restaurant experiences from Live Waits regardless of waitMinutes or status', () => {
      const restaurantExp = createMockExperience('exp-restaurant');
      (restaurantExp as any).category = 'Restaurant';

      const entryClosed: ParkLiveEntryDTO = {
        experienceId: 'exp-restaurant',
        name: 'The Crystal Palace',
        status: 'CLOSED',
        waitMinutes: null,
      };
      expect(isLiveWaitEligible(entryClosed, restaurantExp)).toBe(false);

      const entryWithWait: ParkLiveEntryDTO = {
        experienceId: 'exp-restaurant',
        name: 'The Crystal Palace',
        status: 'OPERATING',
        waitMinutes: 20,
      };
      expect(isLiveWaitEligible(entryWithWait, restaurantExp)).toBe(false);
    });

    it('excludes Shows and Parades without active standby wait times, but includes theater shows with standby waits', () => {
      const showExp = createMockExperience('exp-show');
      (showExp as any).category = 'Show';

      // Schedule-only show without wait time -> excluded
      const scheduleOnlyShow: ParkLiveEntryDTO = {
        experienceId: 'exp-show',
        name: 'The Dapper Dans',
        status: 'CLOSED',
        waitMinutes: null,
      };
      expect(isLiveWaitEligible(scheduleOnlyShow, showExp)).toBe(false);

      // Continuous theater show with posted standby wait -> included
      const theaterShowWithWait: ParkLiveEntryDTO = {
        experienceId: 'exp-show',
        name: "Mickey's PhilharMagic",
        status: 'OPERATING',
        waitMinutes: 15,
      };
      expect(isLiveWaitEligible(theaterShowWithWait, showExp)).toBe(true);

      const paradeExp = createMockExperience('exp-parade');
      (paradeExp as any).category = 'Parade';
      const paradeEntry: ParkLiveEntryDTO = {
        experienceId: 'exp-parade',
        name: "Mickey's Boo-To-You Halloween Parade",
        status: 'CLOSED',
        waitMinutes: null,
      };
      expect(isLiveWaitEligible(paradeEntry, paradeExp)).toBe(false);
    });

    it('includes Rides and Character Meets even when closed/down (waitMinutes is null)', () => {
      const rideExp = createMockExperience('exp-ride');
      (rideExp as any).category = 'Ride';

      const closedRide: ParkLiveEntryDTO = {
        experienceId: 'exp-ride',
        name: 'Space Mountain',
        status: 'CLOSED',
        waitMinutes: null,
      };
      expect(isLiveWaitEligible(closedRide, rideExp)).toBe(true);

      const meetExp = createMockExperience('exp-meet');
      (meetExp as any).category = 'Character_Meet';

      const closedMeet: ParkLiveEntryDTO = {
        experienceId: 'exp-meet',
        name: 'Town Square Theater Mickey',
        status: 'CLOSED',
        waitMinutes: null,
      };
      expect(isLiveWaitEligible(closedMeet, meetExp)).toBe(true);
    });

    it('buildLiveWaitsRows filters out restaurants and schedule-only entertainment', () => {
      const rideExp = createMockExperience('exp-ride');
      const restaurantExp = createMockExperience('exp-restaurant');
      (restaurantExp as any).category = 'Restaurant';
      const showNoWaitExp = createMockExperience('exp-show-nowait');
      (showNoWaitExp as any).category = 'Show';
      const showWithWaitExp = createMockExperience('exp-show-wait');
      (showWithWaitExp as any).category = 'Show';

      const map = new Map<string, ExperienceDTO>([
        ['exp-ride', rideExp],
        ['exp-restaurant', restaurantExp],
        ['exp-show-nowait', showNoWaitExp],
        ['exp-show-wait', showWithWaitExp],
      ]);

      const entries: ParkLiveEntryDTO[] = [
        { experienceId: 'exp-ride', name: 'Space Mountain', status: 'OPERATING', waitMinutes: 45 },
        { experienceId: 'exp-restaurant', name: 'The Crystal Palace', status: 'CLOSED', waitMinutes: null },
        { experienceId: 'exp-show-nowait', name: 'The Dapper Dans', status: 'CLOSED', waitMinutes: null },
        { experienceId: 'exp-show-wait', name: "Mickey's PhilharMagic", status: 'OPERATING', waitMinutes: 10 },
      ];

      const rows = buildLiveWaitsRows(entries, map, 'all');

      expect(rows.map((r) => r.experienceId)).toEqual(['exp-show-wait', 'exp-ride']);
      expect(rows.some((r) => r.experienceId === 'exp-restaurant')).toBe(false);
      expect(rows.some((r) => r.experienceId === 'exp-show-nowait')).toBe(false);
    });

    it('buildLiveWaitsRows filters by lightningLane when selected', () => {
      const rideWithLL = createMockExperience('exp-ride');
      (rideWithLL as any).category = 'Ride';
      const showNoLL = createMockExperience('exp-show');
      (showNoLL as any).category = 'Show';

      const map = new Map<string, ExperienceDTO>([
        ['exp-ride', rideWithLL],
        ['exp-show', showNoLL],
      ]);

      const entries: ParkLiveEntryDTO[] = [
        {
          experienceId: 'exp-ride',
          name: 'Space Mountain',
          status: 'OPERATING',
          waitMinutes: 45,
          lightningLane: {
            state: 'AVAILABLE',
            returnStart: '2026-09-17T18:00:00Z',
          },
        },
        { experienceId: 'exp-show', name: "Mickey's PhilharMagic", status: 'OPERATING', waitMinutes: 10 },
      ];

      const rows = buildLiveWaitsRows(entries, map, 'lightningLane');
      expect(rows.map((r) => r.experienceId)).toEqual(['exp-ride']);
      expect(rows[0]!.lightningLane).toBeDefined();
      expect(rows[0]!.isLightningLane).toBe(true);
    });

    it('getWaitStatus maps wait minutes and status to visual categories', () => {
      expect(getWaitStatus(null, true)).toBe('down');
      expect(getWaitStatus(30, true)).toBe('down');
      expect(getWaitStatus(null, false)).toBe('down');
      expect(getWaitStatus(0, false)).toBe('low');
      expect(getWaitStatus(20, false)).toBe('low');
      expect(getWaitStatus(25, false)).toBe('low');
      expect(getWaitStatus(26, false)).toBe('mod');
      expect(getWaitStatus(40, false)).toBe('mod');
      expect(getWaitStatus(50, false)).toBe('mod');
      expect(getWaitStatus(51, false)).toBe('high');
      expect(getWaitStatus(120, false)).toBe('high');
    });

    // Feature: experience-favorites, Property 7: Live Waits Favorites Filter Is Park-Scoped and Re-Applies on Park Switch
    it('Property 7: Live Waits Favorites Filter Is Park-Scoped and Re-Applies on Park Switch', () => {
      fc.assert(
        fc.property(
          fc.array(entryArb, { maxLength: 20 }),
          fc.array(entryArb, { maxLength: 20 }),
          fc.array(fc.uuid(), { maxLength: 10 }),
          (parkAEntries, parkBEntries, favoritedList) => {
            const favoritedIds = new Set(favoritedList);

            const experiencesById = new Map<string, ExperienceDTO>();
            for (const entry of [...parkAEntries, ...parkBEntries]) {
              experiencesById.set(
                entry.experienceId,
                createMockExperience(entry.experienceId),
              );
            }

            // Compute for Park A
            const rowsParkA = buildLiveWaitsRows(
              parkAEntries,
              experiencesById,
              'favorites',
              favoritedIds,
            );

            // 1. Every row in rowsParkA must be in favoritedIds AND must have come from parkAEntries
            const parkAIds = new Set(parkAEntries.map((e) => e.experienceId));
            for (const row of rowsParkA) {
              expect(favoritedIds.has(row.experienceId)).toBe(true);
              expect(parkAIds.has(row.experienceId)).toBe(true);
            }

            // 2. Exact intersection: all live-wait-eligible parkA entries that are favorited must be in rowsParkA
            const allEligibleParkA = buildLiveWaitsRows(
              parkAEntries,
              experiencesById,
              'all',
            );
            const expectedParkA = allEligibleParkA.filter((r) =>
              favoritedIds.has(r.experienceId),
            );
            expect(rowsParkA.map((r) => r.experienceId)).toEqual(
              expectedParkA.map((r) => r.experienceId),
            );

            // 3. Park switch: compute for Park B with the same 'favorites' filter
            const rowsParkB = buildLiveWaitsRows(
              parkBEntries,
              experiencesById,
              'favorites',
              favoritedIds,
            );

            const parkBIds = new Set(parkBEntries.map((e) => e.experienceId));
            for (const row of rowsParkB) {
              expect(favoritedIds.has(row.experienceId)).toBe(true);
              expect(parkBIds.has(row.experienceId)).toBe(true);
            }

            const allEligibleParkB = buildLiveWaitsRows(
              parkBEntries,
              experiencesById,
              'all',
            );
            const expectedParkB = allEligibleParkB.filter((r) =>
              favoritedIds.has(r.experienceId),
            );
            expect(rowsParkB.map((r) => r.experienceId)).toEqual(
              expectedParkB.map((r) => r.experienceId),
            );
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });

    // Feature: experience-favorites, Property 8: buildLiveWaitsRows's New Parameter Is Fully Backward Compatible
    it('Property 8: buildLiveWaitsRows with omitted favoritedIds reproduces pre-existing behavior for every non-favorites filter', () => {
      const legacyFilterArb: fc.Arbitrary<LiveWaitsFilter> = fc.constantFrom(
        'all',
        'walkOn',
        'lightningLane',
        'headliners',
      );

      fc.assert(
        fc.property(
          fc.array(entryArb, { maxLength: 20 }),
          legacyFilterArb,
          (entries, filter) => {
            const experiencesById = new Map<string, ExperienceDTO>();
            for (const entry of entries) {
              experiencesById.set(entry.experienceId, createMockExperience(entry.experienceId));
            }

            // Call with 3 arguments (omitting favoritedIds)
            const resultOmitted = buildLiveWaitsRows(entries, experiencesById, filter);

            // Call with 4 arguments explicitly passing an empty set (the default)
            const resultExplicitDefault = buildLiveWaitsRows(
              entries,
              experiencesById,
              filter,
              new Set<string>(),
            );

            expect(resultOmitted).toEqual(resultExplicitDefault);
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });
});

