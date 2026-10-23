import { describe, expect, it } from 'vitest';

import {
  PURGE_ATTEMPTS_ALERT,
  PURGE_STALE_CLAIM_MS,
  canTransition,
  classifyLoginEligibility,
  computeScheduledPurgeAt,
  isClaimable,
  isRestorable,
  orderForClaim,
  type DeletionState,
} from '../deletionState.js';

const T = (iso: string): Date => new Date(iso);

describe('deletionState constants', () => {
  it('pins the stale-claim window and the alert threshold', () => {
    expect(PURGE_STALE_CLAIM_MS).toBe(900_000);
    expect(PURGE_ATTEMPTS_ALERT).toBe(5);
  });
});

describe('canTransition', () => {
  it('allows exactly the four documented edges', () => {
    expect(canTransition('active', 'pending_deletion')).toBe(true);
    expect(canTransition('pending_deletion', 'active')).toBe(true);
    expect(canTransition('pending_deletion', 'purging')).toBe(true);
    expect(canTransition('purging', 'purging')).toBe(true);
  });

  it('rejects skips and every edge into or out of tombstone', () => {
    expect(canTransition('active', 'purging')).toBe(false);
    expect(canTransition('purging', 'active')).toBe(false);
    expect(canTransition('purging', 'pending_deletion')).toBe(false);
    expect(canTransition('active', 'active')).toBe(false);
    expect(canTransition('tombstone', 'active')).toBe(false);
    expect(canTransition('purging', 'tombstone')).toBe(false);
    expect(canTransition('tombstone', 'tombstone')).toBe(false);
  });
});

describe('computeScheduledPurgeAt', () => {
  it('adds whole days in UTC milliseconds', () => {
    expect(computeScheduledPurgeAt(T('2026-01-01T00:00:00.000Z'), 30).toISOString()).toBe(
      '2026-01-31T00:00:00.000Z',
    );
    expect(computeScheduledPurgeAt(T('2026-01-01T12:34:56.789Z'), 1).toISOString()).toBe(
      '2026-01-02T12:34:56.789Z',
    );
  });

  it('is not shifted by a daylight-saving boundary (pure 86,400,000 ms days)', () => {
    // 2026-03-08 is the US spring-forward date; the result must still be exactly N * 24h later.
    const start = T('2026-03-01T12:00:00.000Z');
    expect(computeScheduledPurgeAt(start, 10).getTime() - start.getTime()).toBe(10 * 86_400_000);
  });

  it('accepts the bounds 1 and 365 and rejects 0, 366, fractions, NaN and Infinity', () => {
    const t = T('2026-01-01T00:00:00.000Z');
    expect(() => computeScheduledPurgeAt(t, 1)).not.toThrow();
    expect(() => computeScheduledPurgeAt(t, 365)).not.toThrow();
    for (const bad of [0, 366, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => computeScheduledPurgeAt(t, bad), String(bad)).toThrow(RangeError);
    }
  });

  it('does not mutate the request instant', () => {
    const t = T('2026-01-01T00:00:00.000Z');
    computeScheduledPurgeAt(t, 30);
    expect(t.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('isRestorable / classifyLoginEligibility', () => {
  const schedule = T('2026-02-01T00:00:00.000Z');

  it('is restorable strictly before the schedule and not at or after it', () => {
    const s = { state: 'pending_deletion' as const, scheduledPurgeAt: schedule };
    expect(isRestorable(s, new Date(schedule.getTime() - 1))).toBe(true);
    expect(isRestorable(s, schedule)).toBe(false);
    expect(isRestorable(s, new Date(schedule.getTime() + 1))).toBe(false);
  });

  it('is never restorable without a schedule or outside pending_deletion', () => {
    const early = T('2026-01-01T00:00:00.000Z');
    expect(isRestorable({ state: 'pending_deletion', scheduledPurgeAt: null }, early)).toBe(false);
    for (const state of ['active', 'purging', 'tombstone'] as const) {
      expect(isRestorable({ state, scheduledPurgeAt: schedule }, early)).toBe(false);
    }
  });

  it('classifies each state', () => {
    const early = T('2026-01-01T00:00:00.000Z');
    const late = T('2026-03-01T00:00:00.000Z');
    expect(classifyLoginEligibility({ state: 'active', scheduledPurgeAt: null }, early)).toBe('active');
    expect(
      classifyLoginEligibility({ state: 'pending_deletion', scheduledPurgeAt: schedule }, early),
    ).toBe('restorable');
    expect(
      classifyLoginEligibility({ state: 'pending_deletion', scheduledPurgeAt: schedule }, late),
    ).toBe('ineligible');
    expect(classifyLoginEligibility({ state: 'purging', scheduledPurgeAt: schedule }, early)).toBe(
      'ineligible',
    );
    expect(
      classifyLoginEligibility({ state: 'tombstone', scheduledPurgeAt: null }, early),
    ).toBe('ineligible');
  });
});

describe('isClaimable', () => {
  const now = T('2026-02-01T12:00:00.000Z');
  const due = (state: DeletionState, scheduledPurgeAt: Date | null, claimedAt: Date | null) =>
    isClaimable({ state, scheduledPurgeAt, claimedAt }, now);

  it('claims a pending account once its schedule has arrived (inclusive)', () => {
    expect(due('pending_deletion', now, null)).toBe(true);
    expect(due('pending_deletion', new Date(now.getTime() - 1), null)).toBe(true);
    expect(due('pending_deletion', new Date(now.getTime() + 1), null)).toBe(false);
    expect(due('pending_deletion', null, null)).toBe(false);
  });

  it('re-claims a purging account only when released or stale (inclusive at 15 minutes)', () => {
    expect(due('purging', null, null)).toBe(true);
    expect(due('purging', null, new Date(now.getTime() - PURGE_STALE_CLAIM_MS))).toBe(true);
    expect(due('purging', null, new Date(now.getTime() - PURGE_STALE_CLAIM_MS + 1))).toBe(false);
    expect(due('purging', null, now)).toBe(false);
  });

  it('never claims an active account or a tombstone', () => {
    expect(due('active', null, null)).toBe(false);
    expect(due('tombstone', null, null)).toBe(false);
  });
});

describe('orderForClaim', () => {
  const a = { attempts: 0, scheduledPurgeAt: T('2026-02-02T00:00:00Z'), id: 'b' };

  it('orders by attempts first, then schedule, then id', () => {
    expect(orderForClaim({ ...a, attempts: 0 }, { ...a, attempts: 3 })).toBeLessThan(0);
    expect(
      orderForClaim(
        { ...a, scheduledPurgeAt: T('2026-02-01T00:00:00Z') },
        { ...a, scheduledPurgeAt: T('2026-02-03T00:00:00Z') },
      ),
    ).toBeLessThan(0);
    expect(orderForClaim({ ...a, id: 'a' }, { ...a, id: 'b' })).toBeLessThan(0);
    expect(orderForClaim(a, { ...a })).toBe(0);
  });

  it('puts a fresh account ahead of an older one that keeps failing', () => {
    const failing = { attempts: 3, scheduledPurgeAt: T('2026-01-01T00:00:00Z'), id: 'a' };
    const fresh = { attempts: 0, scheduledPurgeAt: T('2026-02-01T00:00:00Z'), id: 'z' };
    expect([failing, fresh].sort(orderForClaim)[0]).toBe(fresh);
  });
});
