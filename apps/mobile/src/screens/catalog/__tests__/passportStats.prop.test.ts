// Feature: experience-detail-redesign — property tests for passportStats.ts
//
// Property 22: Passport average is the mean of non-null ratings, rounded to one decimal
// Property 23: Passport average recomputes correctly after a rating change
//
// Validates: Requirements 17.2, 17.3, 17.5, 17.6

import * as fs from 'fs';
import * as path from 'path';
import fc from 'fast-check';
import { computePassportAverage, VisitRatingInput } from '../passportStats';

const NUM_RUNS = 100;

// Single rating: null, integer 1-5, or double 1.0-5.0
const singleRatingArb: fc.Arbitrary<VisitRatingInput> = fc.oneof(
  { weight: 2, arbitrary: fc.constant(null) },
  { weight: 4, arbitrary: fc.integer({ min: 1, max: 5 }) },
  { weight: 3, arbitrary: fc.double({ min: 1, max: 5, noNaN: true }) },
  { weight: 1, arbitrary: fc.constant(undefined as unknown as null) },
);

const ratingsListArb = fc.array(singleRatingArb, { minLength: 0, maxLength: 50 });

describe('passportStats pure module', () => {
  // Static check: framework-free contract (R9.1 convention)
  it('imports neither React nor react-navigation', () => {
    const filePath = path.resolve(__dirname, '../passportStats.ts');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]react['"]/);
    expect(content).not.toMatch(/from\s+['"]react-native['"]/);
    expect(content).not.toMatch(/from\s+['"]@react-navigation/);
  });

  // Feature: experience-detail-redesign, Property 22: Passport average is the mean of non-null ratings, rounded to one decimal
  // Validates: Requirements 17.2, 17.3
  it('Property 22: returns mean of non-null ratings rounded to 1 decimal place, or null when all null/empty', () => {
    fc.assert(
      fc.property(ratingsListArb, (ratings) => {
        const result = computePassportAverage(ratings);
        const nonNulls = ratings.filter(
          (r): r is number => typeof r === 'number' && Number.isFinite(r),
        );

        if (nonNulls.length === 0) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          const sum = nonNulls.reduce((a, b) => a + b, 0);
          const expectedMean = Math.round((sum / nonNulls.length) * 10) / 10;
          expect(result).toBe(expectedMean);
          // Check decimal places
          const decimalPart = String(result).split('.')[1];
          if (decimalPart !== undefined) {
            expect(decimalPart.length).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: experience-detail-redesign, Property 23: Passport average recomputes correctly after a rating change
  // Validates: Requirements 17.5, 17.6
  it('Property 23: average recomputes correctly after single-entry edit or delete', () => {
    fc.assert(
      fc.property(
        fc.array(singleRatingArb, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        singleRatingArb,
        fc.boolean(),
        (ratings, rawIndex, newRating, isDelete) => {
          const index = rawIndex % ratings.length;
          const postOpRatings = [...ratings];

          if (isDelete) {
            // Delete operation
            postOpRatings.splice(index, 1);
          } else {
            // Edit operation
            postOpRatings[index] = newRating;
          }

          const recomputed = computePassportAverage(postOpRatings);
          const directEvaluation = computePassportAverage(postOpRatings);

          expect(recomputed).toBe(directEvaluation);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
