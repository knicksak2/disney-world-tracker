// Feature: trip-budget, Property 14: Cache state derives from five-rule order
/**
 * Property 14:
 * ticketCacheState is a total, deterministic function that evaluates in strict five-rule order:
 * 1. !enabled || (control.blockedUntil > now) -> disabled
 * 2. !pairPermitted || set.lastError === 'not_offered' || set.asOf != null -> ready
 * 3. set.lastError != null -> failed
 * 4. inFlight || cooled -> warming
 * 5. otherwise -> failed
 *
 * Validates: Requirements 14.1, 14.2
 */

import { describe, expect, it } from 'vitest';
import { ticketCacheState, type CacheStateInput, type TicketCacheState } from '../cacheState.js';

const CFG = { attemptIntervalHours: 24, claimTimeoutMinutes: 15 };
const NOW = new Date('2026-07-01T12:00:00.000Z');

function referenceRuleOrder(i: CacheStateInput): TicketCacheState {
  if (!i.enabled || (i.control.blockedUntil !== null && i.control.blockedUntil.getTime() > i.now.getTime())) {
    return 'disabled';
  }
  if (!i.pairPermitted || i.set?.lastError === 'not_offered' || (i.set !== null && i.set.asOf !== null)) {
    return 'ready';
  }
  if (i.set !== null && i.set.lastError !== null) {
    return 'failed';
  }
  const inFlight =
    i.control.inProgressSince !== null &&
    i.now.getTime() - i.control.inProgressSince.getTime() < i.cfg.claimTimeoutMinutes * 60 * 1000;
  const cooled =
    i.control.lastAttemptAt === null ||
    i.now.getTime() - i.control.lastAttemptAt.getTime() >= i.cfg.attemptIntervalHours * 3600 * 1000;

  if (inFlight || cooled) {
    return 'warming';
  }
  return 'failed';
}

describe('cacheState — Property 14: Cache state derives from five-rule order', () => {
  it('Property 14: full cross product matches reference rule order', () => {
    const enabledOptions = [true, false];
    const blockOptions = [
      null, // no block
      new Date(NOW.getTime() + 3600 * 1000), // active block in future
      new Date(NOW.getTime() - 3600 * 1000), // expired block
    ];
    const inProgressOptions = [
      null, // not in flight
      new Date(NOW.getTime() - 5 * 60 * 1000), // active in flight (5 min ago < 15 min)
      new Date(NOW.getTime() - 20 * 60 * 1000), // expired in flight (20 min ago > 15 min)
    ];
    const lastAttemptOptions = [
      null, // never attempted
      new Date(NOW.getTime() - 2 * 3600 * 1000), // cooldown active (2h ago < 24h)
      new Date(NOW.getTime() - 25 * 3600 * 1000), // cooldown elapsed (25h ago >= 24h)
    ];
    const pairPermittedOptions = [true, false];
    const setOptions: Array<{ asOf: Date | null; lastError: string | null } | null> = [
      null, // set absent
      { asOf: null, lastError: null }, // no rows, no error
      { asOf: null, lastError: 'network' },
      { asOf: null, lastError: 'invalid_response' },
      { asOf: null, lastError: 'start_date_rejected' },
      { asOf: null, lastError: 'not_offered' },
      { asOf: new Date(NOW.getTime() - 3600 * 1000), lastError: null }, // cached rows present
    ];

    for (const enabled of enabledOptions) {
      for (const blockedUntil of blockOptions) {
        for (const inProgressSince of inProgressOptions) {
          for (const lastAttemptAt of lastAttemptOptions) {
            for (const pairPermitted of pairPermittedOptions) {
              for (const set of setOptions) {
                const input: CacheStateInput = {
                  enabled,
                  now: NOW,
                  control: { blockedUntil, inProgressSince, lastAttemptAt },
                  pairPermitted,
                  set,
                  cfg: CFG,
                };
                const expected = referenceRuleOrder(input);
                const actual = ticketCacheState(input);
                expect(actual).toBe(expected);
              }
            }
          }
        }
      }
    }
  });

  it('Property 14 regression: warming is NEVER returned when lastError is a non-not_offered code', () => {
    // With switch on, no block, cooldown elapsed: set has lastError='network' and asOf=null -> must be 'failed', not 'warming'
    const input: CacheStateInput = {
      enabled: true,
      now: NOW,
      control: {
        blockedUntil: null,
        inProgressSince: null,
        lastAttemptAt: new Date(NOW.getTime() - 30 * 3600 * 1000), // cooldown elapsed
      },
      pairPermitted: true,
      set: { asOf: null, lastError: 'network' },
      cfg: CFG,
    };

    expect(ticketCacheState(input)).toBe('failed');
  });

  it('Property 14: permitted never-attempted pair yields warming', () => {
    const input: CacheStateInput = {
      enabled: true,
      now: NOW,
      control: {
        blockedUntil: null,
        inProgressSince: null,
        lastAttemptAt: null, // never attempted
      },
      pairPermitted: true,
      set: null, // absent
      cfg: CFG,
    };

    expect(ticketCacheState(input)).toBe('warming');
  });

  it('Property 14: never-fetched set with cooldown active and nothing in flight yields failed', () => {
    const input: CacheStateInput = {
      enabled: true,
      now: NOW,
      control: {
        blockedUntil: null,
        inProgressSince: null,
        lastAttemptAt: new Date(NOW.getTime() - 2 * 3600 * 1000), // cooldown active (2h ago < 24h)
      },
      pairPermitted: true,
      set: { asOf: null, lastError: null },
      cfg: CFG,
    };

    expect(ticketCacheState(input)).toBe('failed');
  });

  it('Property 14: not_offered and non-permitted pairs yield ready', () => {
    // not_offered yields ready
    expect(
      ticketCacheState({
        enabled: true,
        now: NOW,
        control: { blockedUntil: null, inProgressSince: null, lastAttemptAt: null },
        pairPermitted: true,
        set: { asOf: null, lastError: 'not_offered' },
        cfg: CFG,
      }),
    ).toBe('ready');

    // non-permitted yields ready
    expect(
      ticketCacheState({
        enabled: true,
        now: NOW,
        control: { blockedUntil: null, inProgressSince: null, lastAttemptAt: null },
        pairPermitted: false,
        set: null,
        cfg: CFG,
      }),
    ).toBe('ready');
  });
});
