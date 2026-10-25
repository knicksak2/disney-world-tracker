import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeHarmVerdict } from '../harmVerdict.js';

describe('harmVerdict properties', () => {
  // Feature: photo-uploads, Property 6: Harm verdict
  it('Property 6: Harm verdict returns flag iff flagged is true or any score >= threshold, and is monotone', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.double({ min: 0, max: 1, noNaN: true })),
        fc.double({ min: 0.1, max: 0.9, noNaN: true }),
        (flagged, categoryScores, threshold) => {
          const verdict = computeHarmVerdict({ flagged, categoryScores }, threshold);

          const hasScoreGte = Object.values(categoryScores).some((s) => s >= threshold);
          const expected = flagged || hasScoreGte ? 'flag' : 'pass';

          expect(verdict).toBe(expected);

          // Monotonicity: raising any category score can never turn flag into pass
          const bumpedScores: Record<string, number> = Object.create(null);
          for (const [cat, score] of Object.entries(categoryScores)) {
            bumpedScores[cat] = Math.min(1, score + 0.1);
          }
          const bumpedVerdict = computeHarmVerdict({ flagged, categoryScores: bumpedScores }, threshold);
          if (verdict === 'flag') {
            expect(bumpedVerdict).toBe('flag');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('uses default threshold 0.5 when omitted', () => {
    expect(computeHarmVerdict({ flagged: false, categoryScores: { hate: 0.49 } })).toBe('pass');
    expect(computeHarmVerdict({ flagged: false, categoryScores: { hate: 0.5 } })).toBe('flag');
    expect(computeHarmVerdict({ flagged: false, categoryScores: { hate: 0.51 } })).toBe('flag');
    expect(computeHarmVerdict({ flagged: true })).toBe('flag');
    expect(computeHarmVerdict({ flagged: false })).toBe('pass');
  });
});
