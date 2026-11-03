import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeSavingsPlan } from '../savingsPlan.js';

describe('savingsPlan', () => {
  // Feature: trip-budget, Property 4: Savings plan is the minimal sufficient weekly amount
  // Validates: Requirements 8.2, 8.3, 8.4
  it('Property 4: computes minimal sufficient weekly amount, respects statuses, and is non-increasing as saved increases', () => {
    // Generate dates around a reference point
    const baseDate = new Date('2026-10-25T00:00:00.000Z');
    const dateArb = fc.integer({ min: -60, max: 365 }).map((dayOffset) => {
      const d = new Date(baseDate.getTime() + dayOffset * 86_400_000);
      return d.toISOString().split('T')[0]!;
    });

    fc.assert(
      fc.property(
        fc.nat(10_000_000), // targetCents
        fc.nat(10_000_000), // savedCents
        dateArb, // today
        dateArb, // tripStartDate
        (targetCents, savedCents, today, tripStartDate) => {
          const plan = computeSavingsPlan({ targetCents, savedCents, today, tripStartDate });
          const remaining = Math.max(0, targetCents - savedCents);

          expect(plan.targetCents).toBe(targetCents);
          expect(plan.savedCents).toBe(savedCents);
          expect(plan.remainingCents).toBe(remaining);

          if (remaining === 0) {
            // Requirement 8.3 takes precedence
            expect(plan.status).toBe('on_track');
            expect(plan.perWeekCents).toBe(0);
            if (plan.daysUntilStart > 0) {
              expect(plan.weeksRemaining).toBe(Math.ceil(plan.daysUntilStart / 7));
            } else {
              expect(plan.weeksRemaining).toBeNull();
            }
          } else if (plan.daysUntilStart <= 0) {
            // Requirement 8.4: remaining > 0 and daysUntilStart <= 0
            expect(plan.status).toBe('trip_started_or_past');
            expect(plan.weeksRemaining).toBeNull();
            expect(plan.perWeekCents).toBeNull();
          } else {
            // Normal saving mode: remaining > 0 and daysUntilStart > 0
            expect(plan.status).toBe('saving');
            const weeks = Math.ceil(plan.daysUntilStart / 7);
            expect(plan.weeksRemaining).toBe(weeks);
            expect(plan.perWeekCents).not.toBeNull();
            const perWeek = plan.perWeekCents!;

            // Minimal sufficient weekly amount:
            // perWeek * weeks >= remaining and (perWeek - 1) * weeks < remaining
            expect(perWeek * weeks).toBeGreaterThanOrEqual(remaining);
            if (perWeek > 0) {
              expect((perWeek - 1) * weeks).toBeLessThan(remaining);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 4 (monotonicity): perWeek is non-increasing as saved increases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }), // targetCents
        fc.nat(10_000_000), // saved1
        fc.nat(10_000_000), // saved2
        fc.integer({ min: 1, max: 100 }), // days ahead
        (targetCents, s1, s2, daysAhead) => {
          const savedLow = Math.min(s1, s2);
          const savedHigh = Math.max(s1, s2);
          const today = '2026-10-25';
          const tripStartDate = new Date(Date.parse('2026-10-25T00:00:00.000Z') + daysAhead * 86_400_000)
            .toISOString()
            .split('T')[0]!;

          const planLow = computeSavingsPlan({
            targetCents,
            savedCents: savedLow,
            today,
            tripStartDate,
          });
          const planHigh = computeSavingsPlan({
            targetCents,
            savedCents: savedHigh,
            today,
            tripStartDate,
          });

          const perWeekLow = planLow.perWeekCents ?? 0;
          const perWeekHigh = planHigh.perWeekCents ?? 0;

          expect(perWeekHigh).toBeLessThanOrEqual(perWeekLow);
        },
      ),
      { numRuns: 100 },
    );
  });

  describe('edge cases', () => {
    it('handles 0 days until start (same day) with remaining > 0', () => {
      const plan = computeSavingsPlan({
        targetCents: 50000,
        savedCents: 10000,
        today: '2026-11-01',
        tripStartDate: '2026-11-01',
      });
      expect(plan.daysUntilStart).toBe(0);
      expect(plan.remainingCents).toBe(40000);
      expect(plan.status).toBe('trip_started_or_past');
      expect(plan.weeksRemaining).toBeNull();
      expect(plan.perWeekCents).toBeNull();
    });

    it('handles 1 day until start', () => {
      const plan = computeSavingsPlan({
        targetCents: 10000,
        savedCents: 0,
        today: '2026-11-01',
        tripStartDate: '2026-11-02',
      });
      expect(plan.daysUntilStart).toBe(1);
      expect(plan.weeksRemaining).toBe(1);
      expect(plan.perWeekCents).toBe(10000);
      expect(plan.status).toBe('saving');
    });

    it('handles 7 days until start (exactly 1 week)', () => {
      const plan = computeSavingsPlan({
        targetCents: 7000,
        savedCents: 0,
        today: '2026-11-01',
        tripStartDate: '2026-11-08',
      });
      expect(plan.daysUntilStart).toBe(7);
      expect(plan.weeksRemaining).toBe(1);
      expect(plan.perWeekCents).toBe(7000);
      expect(plan.status).toBe('saving');
    });

    it('handles 8 days until start (spills into 2 weeks)', () => {
      const plan = computeSavingsPlan({
        targetCents: 10001,
        savedCents: 0,
        today: '2026-11-01',
        tripStartDate: '2026-11-09',
      });
      expect(plan.daysUntilStart).toBe(8);
      expect(plan.weeksRemaining).toBe(2);
      expect(plan.perWeekCents).toBe(5001); // ceil(10001 / 2) = 5001
      expect(plan.status).toBe('saving');
    });

    it('handles 14 days until start (exactly 2 weeks)', () => {
      const plan = computeSavingsPlan({
        targetCents: 10000,
        savedCents: 0,
        today: '2026-11-01',
        tripStartDate: '2026-11-15',
      });
      expect(plan.daysUntilStart).toBe(14);
      expect(plan.weeksRemaining).toBe(2);
      expect(plan.perWeekCents).toBe(5000);
      expect(plan.status).toBe('saving');
    });

    it('handles saved above target (remaining 0)', () => {
      const plan = computeSavingsPlan({
        targetCents: 10000,
        savedCents: 15000,
        today: '2026-11-01',
        tripStartDate: '2026-11-15',
      });
      expect(plan.remainingCents).toBe(0);
      expect(plan.daysUntilStart).toBe(14);
      expect(plan.weeksRemaining).toBe(2);
      expect(plan.perWeekCents).toBe(0);
      expect(plan.status).toBe('on_track');
    });

    it('handles trip started in the past with remaining > 0', () => {
      const plan = computeSavingsPlan({
        targetCents: 20000,
        savedCents: 5000,
        today: '2026-11-05',
        tripStartDate: '2026-11-01',
      });
      expect(plan.daysUntilStart).toBe(-4);
      expect(plan.remainingCents).toBe(15000);
      expect(plan.status).toBe('trip_started_or_past');
      expect(plan.weeksRemaining).toBeNull();
      expect(plan.perWeekCents).toBeNull();
    });

    it('overlap case: remaining = 0 with daysUntilStart <= 0 yields on_track with perWeekCents 0 (Round 3 L1)', () => {
      // Trip started yesterday, but everything was saved
      const plan = computeSavingsPlan({
        targetCents: 20000,
        savedCents: 25000,
        today: '2026-11-05',
        tripStartDate: '2026-11-01',
      });
      expect(plan.daysUntilStart).toBe(-4);
      expect(plan.remainingCents).toBe(0);
      expect(plan.status).toBe('on_track');
      expect(plan.perWeekCents).toBe(0);
      expect(plan.weeksRemaining).toBeNull();
    });

    it('overlap case: remaining = 0 on trip start day (daysUntilStart = 0) yields on_track with perWeekCents 0', () => {
      const plan = computeSavingsPlan({
        targetCents: 20000,
        savedCents: 20000,
        today: '2026-11-01',
        tripStartDate: '2026-11-01',
      });
      expect(plan.daysUntilStart).toBe(0);
      expect(plan.remainingCents).toBe(0);
      expect(plan.status).toBe('on_track');
      expect(plan.perWeekCents).toBe(0);
      expect(plan.weeksRemaining).toBeNull();
    });
  });
});

