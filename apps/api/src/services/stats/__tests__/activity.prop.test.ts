// Feature: stats-experience-redesign, Property 14: Activity volume bounds & repeat multiplier >= 1.0
// Feature: stats-experience-redesign, Property 15: Most-ridden podium ordering & determinism
// Feature: stats-experience-redesign, Property 16: Personal records derivation & null-park filtering

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { PARKS, type Park } from '@dwt/shared';

import {
  rollUpActivity,
  type RawActivityMaterial,
  type RawMostRiddenRow,
  type RawProductiveDayRow,
  type RawMarathonRecordRow,
} from '../activity.js';

const NUM_RUNS = 100;

describe('rollUpActivity Property Tests', () => {
  it('Property 14: Activity volume bounds & repeat multiplier >= 1.0', () => {
    // Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
    fc.assert(
      fc.property(
        fc.record({
          totalLogs: fc.integer({ min: 0, max: 10_000 }),
          distinctParkDays: fc.integer({ min: 0, max: 500 }),
          uniqueLoggedExperiences: fc.integer({ min: 0, max: 500 }),
        }),
        (volume) => {
          const raw: RawActivityMaterial = {
            volume,
            mostRidden: [],
            mostProductiveDay: null,
            marathonRecord: null,
          };

          const stats = rollUpActivity(raw);

          // Invariant: repeatMultiplier is always >= 1.0
          expect(stats.repeatMultiplier).toBeGreaterThanOrEqual(1.0);

          if (volume.totalLogs === 0) {
            expect(stats.totalLogs).toBe(0);
            expect(stats.distinctParkDays).toBe(0);
            expect(stats.repeatMultiplier).toBe(1.0);
            expect(stats.averageRidesPerDay).toBe(0.0);
            expect(stats.mostRidden).toEqual([]);
            expect(stats.personalRecords).toEqual({});
          } else {
            expect(stats.totalLogs).toBe(volume.totalLogs);
            expect(stats.distinctParkDays).toBe(volume.distinctParkDays);

            if (volume.distinctParkDays === 0) {
              expect(stats.averageRidesPerDay).toBe(0.0);
            } else {
              const expectedAvg = Number(
                (volume.totalLogs / volume.distinctParkDays).toFixed(1),
              );
              expect(stats.averageRidesPerDay).toBe(expectedAvg);
            }

            if (volume.uniqueLoggedExperiences === 0) {
              expect(stats.repeatMultiplier).toBe(1.0);
            } else {
              const expectedMultiplier = Math.max(
                1.0,
                Number(
                  (volume.totalLogs / volume.uniqueLoggedExperiences).toFixed(1),
                ),
              );
              expect(stats.repeatMultiplier).toBe(expectedMultiplier);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 15: Most-ridden podium ordering & determinism', () => {
    // Validates: Requirements 19.1, 19.2, 19.3
    const mostRiddenRowArb: fc.Arbitrary<RawMostRiddenRow> = fc.record({
      experienceId: fc.uuid(),
      experienceName: fc.string({ minLength: 1, maxLength: 50 }),
      park: fc.oneof(fc.constantFrom(...PARKS), fc.constant(null)),
      count: fc.integer({ min: 1, max: 100 }),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.array(mostRiddenRowArb, { minLength: 0, maxLength: 10 }),
        (totalLogs, mostRiddenRows) => {
          const raw: RawActivityMaterial = {
            volume: {
              totalLogs,
              distinctParkDays: 5,
              uniqueLoggedExperiences: 10,
            },
            mostRidden: mostRiddenRows,
            mostProductiveDay: null,
            marathonRecord: null,
          };

          const stats = rollUpActivity(raw);

          // Most ridden array has at most 5 elements
          expect(stats.mostRidden.length).toBeLessThanOrEqual(5);
          expect(stats.mostRidden.length).toBe(
            Math.min(5, mostRiddenRows.length),
          );

          // Each item preserves position and fields from input slice
          for (let i = 0; i < stats.mostRidden.length; i++) {
            expect(stats.mostRidden[i]).toEqual(mostRiddenRows[i]);
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('Property 16: Personal records derivation & null-park filtering', () => {
    // Validates: Requirements 20.1, 20.2, 20.3, 20.4, 20.5, 20.6
    const productiveDayArb: fc.Arbitrary<RawProductiveDayRow> = fc.record({
      date: fc.date().map((d) => d.toISOString().slice(0, 10)),
      rideCount: fc.integer({ min: 1, max: 50 }),
      parks: fc.array(
        fc.oneof(
          fc.constantFrom(...PARKS),
          fc.constant(null as unknown as Park),
        ),
        { minLength: 0, maxLength: 5 },
      ),
    });

    const marathonRecordArb: fc.Arbitrary<RawMarathonRecordRow> = fc.record({
      experienceId: fc.uuid(),
      experienceName: fc.string({ minLength: 1, maxLength: 50 }),
      date: fc.date().map((d) => d.toISOString().slice(0, 10)),
      count: fc.integer({ min: 1, max: 20 }),
    });

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.option(productiveDayArb, { nil: null }),
        fc.option(marathonRecordArb, { nil: null }),
        (totalLogs, productiveDay, marathonRecord) => {
          const raw: RawActivityMaterial = {
            volume: {
              totalLogs,
              distinctParkDays: totalLogs > 0 ? 3 : 0,
              uniqueLoggedExperiences: totalLogs > 0 ? 5 : 0,
            },
            mostRidden: [],
            mostProductiveDay: productiveDay,
            marathonRecord: marathonRecord,
          };

          const stats = rollUpActivity(raw);

          if (totalLogs === 0) {
            expect(stats.personalRecords).toEqual({});
          } else {
            if (productiveDay) {
              expect(stats.personalRecords.mostProductiveDay).toBeDefined();
              expect(stats.personalRecords.mostProductiveDay?.date).toBe(
                productiveDay.date,
              );
              expect(stats.personalRecords.mostProductiveDay?.rideCount).toBe(
                productiveDay.rideCount,
              );
              // Requirement 20.2: Defensively filter out null parks
              expect(
                stats.personalRecords.mostProductiveDay?.parks.every(
                  (p: Park) => p !== null && p !== undefined && PARKS.includes(p),
                ),
              ).toBe(true);
            } else {
              expect(stats.personalRecords.mostProductiveDay).toBeUndefined();
            }

            if (marathonRecord) {
              expect(stats.personalRecords.marathonRecord).toEqual(
                marathonRecord,
              );
            } else {
              expect(stats.personalRecords.marathonRecord).toBeUndefined();
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
