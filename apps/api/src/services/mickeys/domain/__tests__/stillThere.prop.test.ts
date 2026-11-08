// Feature: hidden-mickeys, Property 7: Still-there confidence
// Feature: hidden-mickeys, Property 9: Community verified derivation

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  stillThereConfidence,
  confidenceLabel,
  isCommunityVerified,
  DEFAULT_STILL_THERE_PARAMS,
} from '../stillThere.js';
import type { MickeyConfidenceLabel } from '@dwt/shared';

describe('stillThere domain module', () => {
  const now = new Date('2026-11-06T12:00:00Z');

  describe('Property 7: Still-there confidence worked values and invariants', () => {
    it('matches exact worked values with default parameters and fresh votes', () => {
      // 0 votes -> 0.9
      const c0 = stillThereConfidence([], now, DEFAULT_STILL_THERE_PARAMS);
      expect(c0).toBe(0.9);
      expect(confidenceLabel(c0)).toBe('confirmed');

      // 1 fresh gone vote -> 2.7 / 4 = 0.675 (confirmed)
      const c1 = stillThereConfidence([{ vote: 'gone', votedAt: now }], now, DEFAULT_STILL_THERE_PARAMS);
      expect(c1).toBeCloseTo(0.675, 5);
      expect(confidenceLabel(c1)).toBe('confirmed');

      // 2 fresh gone votes -> 2.7 / 5 = 0.54 (uncertain)
      const c2 = stillThereConfidence(
        [
          { vote: 'gone', votedAt: now },
          { vote: 'gone', votedAt: now },
        ],
        now,
        DEFAULT_STILL_THERE_PARAMS,
      );
      expect(c2).toBeCloseTo(0.54, 5);
      expect(confidenceLabel(c2)).toBe('uncertain');

      // 3 fresh gone votes -> 2.7 / 6 = 0.45 (uncertain)
      const c3 = stillThereConfidence(
        [
          { vote: 'gone', votedAt: now },
          { vote: 'gone', votedAt: now },
          { vote: 'gone', votedAt: now },
        ],
        now,
        DEFAULT_STILL_THERE_PARAMS,
      );
      expect(c3).toBeCloseTo(0.45, 5);
      expect(confidenceLabel(c3)).toBe('uncertain');

      // 4 fresh gone votes -> 2.7 / 7 ≈ 0.3857 (possibly_removed)
      const c4 = stillThereConfidence(
        [
          { vote: 'gone', votedAt: now },
          { vote: 'gone', votedAt: now },
          { vote: 'gone', votedAt: now },
          { vote: 'gone', votedAt: now },
        ],
        now,
        DEFAULT_STILL_THERE_PARAMS,
      );
      expect(c4).toBeCloseTo(2.7 / 7, 5);
      expect(confidenceLabel(c4)).toBe('possibly_removed');
    });

    // Feature: hidden-mickeys, Property 7: Still-there confidence
    it('Property 7: confidence score is always in [0, 1] and monotonic with respect to vote additions', () => {
      const voteArb = fc.record({
        vote: fc.constantFrom<'there' | 'gone'>('there', 'gone'),
        votedAt: fc.date({ min: new Date('2020-01-01'), max: now }),
      });

      fc.assert(
        fc.property(fc.array(voteArb, { maxLength: 20 }), voteArb, (votes, extraVote) => {
          const baseConfidence = stillThereConfidence(votes, now, DEFAULT_STILL_THERE_PARAMS);
          expect(baseConfidence).toBeGreaterThanOrEqual(0);
          expect(baseConfidence).toBeLessThanOrEqual(1);

          const withExtra = stillThereConfidence([...votes, extraVote], now, DEFAULT_STILL_THERE_PARAMS);
          expect(withExtra).toBeGreaterThanOrEqual(0);
          expect(withExtra).toBeLessThanOrEqual(1);

          if (extraVote.vote === 'there') {
            // Adding a 'there' vote never lowers confidence
            expect(withExtra).toBeGreaterThanOrEqual(baseConfidence - 1e-9);
          } else {
            // Adding a 'gone' vote never raises confidence
            expect(withExtra).toBeLessThanOrEqual(baseConfidence + 1e-9);
          }
        }),
        { numRuns: 100 },
      );
    });

    // Feature: hidden-mickeys, Property 7: Still-there confidence
    it('Property 7: aging a vote moves confidence toward prior value and never away from it', () => {
      const voteArb = fc.record({
        vote: fc.constantFrom<'there' | 'gone'>('there', 'gone'),
        votedAt: fc.date({ min: new Date('2026-01-01'), max: now }),
      });

      fc.assert(
        fc.property(
          fc.array(voteArb, { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 1, max: 100 }),
          (votes, extraAgeDays) => {
            const cFresh = stillThereConfidence(votes, now, DEFAULT_STILL_THERE_PARAMS);
            const agedVotes = votes.map((v) => ({
              ...v,
              votedAt: new Date(v.votedAt.getTime() - extraAgeDays * 86_400_000),
            }));
            const cAged = stillThereConfidence(agedVotes, now, DEFAULT_STILL_THERE_PARAMS);

            const prior = DEFAULT_STILL_THERE_PARAMS.priorValue;
            const distFresh = Math.abs(cFresh - prior);
            const distAged = Math.abs(cAged - prior);

            // Aging decreases distance to prior (or stays equal within float tolerance)
            expect(distAged).toBeLessThanOrEqual(distFresh + 1e-9);
          },
        ),
        { numRuns: 100 },
      );
    });

    // Feature: hidden-mickeys, Property 7: Still-there confidence
    it('Property 7: confidenceLabel partitions [0, 1] into three contiguous ranges', () => {
      fc.assert(
        fc.property(fc.double({ min: 0, max: 1 }), (score) => {
          const label = confidenceLabel(score, DEFAULT_STILL_THERE_PARAMS);
          if (score >= DEFAULT_STILL_THERE_PARAMS.confirmedMin) {
            expect(label).toBe('confirmed');
          } else if (score >= DEFAULT_STILL_THERE_PARAMS.uncertainMin) {
            expect(label).toBe('uncertain');
          } else {
            expect(label).toBe('possibly_removed');
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 9: Community verified derivation', () => {
    // Feature: hidden-mickeys, Property 9: Community verified derivation
    it('Property 9: isCommunityVerified derivation satisfies all criteria and boundaries', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.constantFrom<MickeyConfidenceLabel>('confirmed', 'uncertain', 'possibly_removed'),
          fc.integer({ min: 0, max: 10 }),
          fc.integer({ min: 1, max: 5 }),
          (official, label, otherThereVoters, min) => {
            const verified = isCommunityVerified({
              official,
              label,
              otherThereVoters,
              min,
            });

            // Official entries are never community verified
            if (official) {
              expect(verified).toBe(false);
              return;
            }

            // possibly_removed entries are never community verified
            if (label === 'possibly_removed') {
              expect(verified).toBe(false);
              return;
            }

            // Otherwise, verified iff otherThereVoters >= min
            expect(verified).toBe(otherThereVoters >= min);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
