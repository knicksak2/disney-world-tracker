import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  PURGE_STALE_CLAIM_MS,
  canTransition,
  classifyLoginEligibility,
  computeScheduledPurgeAt,
  isClaimable,
  isRestorable,
  orderForClaim,
  type DeletionState,
} from '../deletionState.js';

const RUNS = { numRuns: 100 };

const stateArb = fc.constantFrom<DeletionState>('active', 'pending_deletion', 'purging', 'tombstone');
// Millisecond timestamps in a window around "now" (2020..2040) keep every Date valid.
const msArb = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2040, 0, 1) });
const dateArb = msArb.map((ms) => new Date(ms));
const maybeDateArb = fc.option(dateArb, { nil: null });

describe('deletionState properties', () => {
  // Feature: account-deletion, Property 1: Only the specified state transitions exist
  it('Property 1: canTransition is true for exactly the four allowed edges', () => {
    const allowed = new Set([
      'active->pending_deletion',
      'pending_deletion->active',
      'pending_deletion->purging',
      'purging->purging',
    ]);
    fc.assert(
      fc.property(stateArb, stateArb, (from, to) => {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}->${to}`));
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 2: Restoration is possible exactly while now is before the scheduled purge
  it('Property 2: isRestorable iff pending_deletion, scheduled, and now < scheduledPurgeAt', () => {
    fc.assert(
      fc.property(stateArb, maybeDateArb, dateArb, (state, scheduledPurgeAt, now) => {
        const expected =
          state === 'pending_deletion' &&
          scheduledPurgeAt !== null &&
          now.getTime() < scheduledPurgeAt.getTime();
        expect(isRestorable({ state, scheduledPurgeAt }, now)).toBe(expected);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 2: Restoration is possible exactly while now is before the scheduled purge
  it('Property 2: at now == scheduledPurgeAt restoration is false, one millisecond earlier it is true', () => {
    fc.assert(
      fc.property(dateArb, (schedule) => {
        const s = { state: 'pending_deletion' as const, scheduledPurgeAt: schedule };
        expect(isRestorable(s, schedule)).toBe(false);
        expect(isRestorable(s, new Date(schedule.getTime() - 1))).toBe(true);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 3: The scheduled purge date is fixed at request time
  it('Property 3: computeScheduledPurgeAt(t, g) equals t + g * 86,400,000 ms for g in 1..365', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 1, max: 365 }), (t, g) => {
        const before = t.getTime();
        const result = computeScheduledPurgeAt(t, g);
        expect(result.getTime()).toBe(before + g * 86_400_000);
        expect(t.getTime()).toBe(before);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 3: The scheduled purge date is fixed at request time
  it('Property 3: a stored date does not move when the grace period is later computed differently', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.integer({ min: 1, max: 365 }),
        fc.integer({ min: 1, max: 365 }),
        (t, g1, g2) => {
          const stored = computeScheduledPurgeAt(t, g1);
          const storedMs = stored.getTime();
          computeScheduledPurgeAt(t, g2); // a "config change" and re-computation
          expect(stored.getTime()).toBe(storedMs);
        },
      ),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 3: The scheduled purge date is fixed at request time
  it('Property 3: values outside 1..365 and non-integers throw RangeError', () => {
    const bad = fc.oneof(
      fc.integer({ min: -1000, max: 0 }),
      fc.integer({ min: 366, max: 100_000 }),
      fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isInteger(d)),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    );
    fc.assert(
      fc.property(dateArb, bad, (t, g) => {
        expect(() => computeScheduledPurgeAt(t, g)).toThrow(RangeError);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 7: Login eligibility is a function of state and time only
  it('Property 7: classifyLoginEligibility depends only on (state, scheduledPurgeAt, now)', () => {
    fc.assert(
      fc.property(stateArb, maybeDateArb, dateArb, (state, scheduledPurgeAt, now) => {
        const result = classifyLoginEligibility({ state, scheduledPurgeAt }, now);
        if (state === 'active') {
          expect(result).toBe('active');
        } else if (
          state === 'pending_deletion' &&
          scheduledPurgeAt !== null &&
          now.getTime() < scheduledPurgeAt.getTime()
        ) {
          expect(result).toBe('restorable');
        } else {
          expect(result).toBe('ineligible');
        }
        // Same inputs, same output (no hidden state).
        expect(classifyLoginEligibility({ state, scheduledPurgeAt }, now)).toBe(result);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 31: A permanently failing account cannot starve the purge queue (pure part)
  it('Property 31 (pure): isClaimable matches its definition for every state, schedule, claim and now', () => {
    fc.assert(
      fc.property(stateArb, maybeDateArb, maybeDateArb, dateArb, (state, scheduledPurgeAt, claimedAt, now) => {
        const expected =
          (state === 'pending_deletion' &&
            scheduledPurgeAt !== null &&
            scheduledPurgeAt.getTime() <= now.getTime()) ||
          (state === 'purging' &&
            (claimedAt === null || claimedAt.getTime() <= now.getTime() - PURGE_STALE_CLAIM_MS));
        expect(isClaimable({ state, scheduledPurgeAt, claimedAt }, now)).toBe(expected);
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 31: A permanently failing account cannot starve the purge queue (pure part)
  it('Property 31 (pure): sorting by orderForClaim equals sorting by the (attempts, schedule, id) tuple, and an account with fewer attempts is never behind one with more', () => {
    const accountArb = fc.record({
      attempts: fc.integer({ min: 0, max: 40 }),
      scheduledPurgeAt: dateArb,
      id: fc.uuid(),
    });
    fc.assert(
      fc.property(fc.array(accountArb, { minLength: 0, maxLength: 30 }), (accounts) => {
        const sorted = [...accounts].sort(orderForClaim);
        const byTuple = [...accounts].sort((x, y) => {
          if (x.attempts !== y.attempts) return x.attempts - y.attempts;
          const xt = x.scheduledPurgeAt.getTime();
          const yt = y.scheduledPurgeAt.getTime();
          if (xt !== yt) return xt - yt;
          return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
        });
        expect(sorted).toEqual(byTuple);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i - 1]!.attempts).toBeLessThanOrEqual(sorted[i]!.attempts);
        }
        // The first BATCH claimed from a shuffled input never include a higher-attempts account
        // while a lower-attempts one is left behind.
        const batch = 3;
        const claimed = sorted.slice(0, batch);
        const left = sorted.slice(batch);
        const maxClaimed = Math.max(-1, ...claimed.map((c) => c.attempts));
        for (const l of left) expect(l.attempts).toBeGreaterThanOrEqual(maxClaimed);
      }),
      RUNS,
    );
  });
});
