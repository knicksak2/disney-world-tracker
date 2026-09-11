/**
 * Unit tests for the pin-collection contracts.
 *
 * Covers valid and invalid cases for:
 *   - `pinSchema` across the criteria kinds (count, set, landComplete,
 *     parkComplete, catalogComplete, singleDay, compound), rejecting a bad
 *     tier, an unknown criteria kind, an out-of-range single-day feat, a
 *     single-member compound, and unknown extra fields (`.strict`).
 *   - `userPinProgressSchema` accepting unlocked + locked projections and
 *     rejecting a `percentComplete` of 100 (locked progress is `[0, 99]`).
 *
 * Validates: Requirements 1, 3.1, 7, 12, 18, 19
 */

import { describe, expect, it } from 'vitest';

import { PIN_TIERS, PIN_TRACKS } from '../../enums.js';
import { pinCriteriaSchema, pinSchema, userPinProgressSchema } from '../Pin.js';

function pin(criteria: unknown, over: Record<string, unknown> = {}) {
  return {
    id: 'gold_example',
    tier: 'gold',
    track: 'attractions',
    name: 'Example',
    description: 'An example pin.',
    criteria,
    ...over,
  };
}

describe('pinSchema — valid criteria kinds', () => {
  it('accepts a count-ladder pin', () => {
    expect(pinSchema.safeParse(pin({ kind: 'count', metric: 'attractions', threshold: 100 })).success).toBe(true);
  });

  it('accepts a set pin (all / n)', () => {
    expect(pinSchema.safeParse(pin({ kind: 'set', setId: 'roller_coasters', required: 'all' })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'set', setId: 'dark_rides', required: 6 })).success).toBe(true);
  });

  it('accepts a combined-land completion', () => {
    expect(
      pinSchema.safeParse(pin({ kind: 'landComplete', lands: ['Hollywood Boulevard', 'Sunset Boulevard'] })).success,
    ).toBe(true);
  });

  it('accepts park mastery and sovereign', () => {
    expect(pinSchema.safeParse(pin({ kind: 'parkComplete', park: 'EPCOT', scope: 'attractions' })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'parkComplete', park: 'EPCOT', scope: 'everything' })).success).toBe(true);
  });

  it('accepts the completion apexes', () => {
    expect(pinSchema.safeParse(pin({ kind: 'catalogComplete', scope: 'attractions' })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'catalogComplete', scope: 'all' })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'parksAttractionsComplete' })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'allLandsVisited' })).success).toBe(true);
  });

  it('accepts single-day feats', () => {
    expect(pinSchema.safeParse(pin({ kind: 'singleDay', feat: { type: 'multiPark', parks: 4 } })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'singleDay', feat: { type: 'rideMarathon', rides: 15 } })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'singleDay', feat: { type: 'grandSlam' } })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ kind: 'singleDay', feat: { type: 'aroundTheWorld' } })).success).toBe(true);
  });

  it('accepts a compound (Legendary Guide: 50 friend rides + 5 trips)', () => {
    expect(
      pinSchema.safeParse(
        pin(
          {
            kind: 'compound',
            all: [
              { kind: 'count', metric: 'friendRides', threshold: 50 },
              { kind: 'count', metric: 'trips', threshold: 5 },
            ],
          },
          { id: 'prism_legendary_guide', tier: 'prism', track: 'social' },
        ),
      ).success,
    ).toBe(true);
  });

  it('accepts every declared tier and track', () => {
    for (const tier of PIN_TIERS) {
      expect(pinSchema.safeParse(pin({ kind: 'allLandsVisited' }, { tier, id: `${tier}_x` })).success).toBe(true);
    }
    for (const track of PIN_TRACKS) {
      expect(pinSchema.safeParse(pin({ kind: 'allLandsVisited' }, { track })).success).toBe(true);
    }
  });
});

describe('pinSchema — invalid', () => {
  it('rejects an unknown tier', () => {
    expect(pinSchema.safeParse(pin({ kind: 'allLandsVisited' }, { tier: 'diamond' })).success).toBe(false);
  });

  it('rejects an unknown criteria kind', () => {
    expect(pinSchema.safeParse(pin({ kind: 'ride_everything' })).success).toBe(false);
  });

  it('rejects a multiPark feat outside 2..4', () => {
    expect(pinSchema.safeParse(pin({ kind: 'singleDay', feat: { type: 'multiPark', parks: 5 } })).success).toBe(false);
  });

  it('rejects a compound with fewer than two members', () => {
    expect(
      pinSchema.safeParse(pin({ kind: 'compound', all: [{ kind: 'count', metric: 'trips', threshold: 5 }] })).success,
    ).toBe(false);
  });

  it('rejects a non-positive count threshold', () => {
    expect(pinSchema.safeParse(pin({ kind: 'count', metric: 'attractions', threshold: 0 })).success).toBe(false);
  });

  it('rejects unknown extra fields (strict)', () => {
    expect(pinSchema.safeParse(pin({ kind: 'allLandsVisited' }, { surprise: true })).success).toBe(false);
  });
});

describe('pinCriteriaSchema — direct', () => {
  it('parses a bare criteria node', () => {
    expect(pinCriteriaSchema.safeParse({ kind: 'parksAttractionsComplete' }).success).toBe(true);
  });

  it('rejects an unknown discriminator', () => {
    expect(pinCriteriaSchema.safeParse({ kind: 'nope' }).success).toBe(false);
  });
});

describe('userPinProgressSchema', () => {
  it('accepts an unlocked, unclaimed (ready-to-claim) projection', () => {
    expect(
      userPinProgressSchema.safeParse({
        pinId: 'gold_example',
        unlocked: true,
        awardedAt: '2026-01-02T15:00:00Z',
        currentValue: null,
        targetValue: null,
        percentComplete: null,
        claimedAt: null,
      }).success,
    ).toBe(true);
  });

  it('accepts an unlocked, claimed projection', () => {
    expect(
      userPinProgressSchema.safeParse({
        pinId: 'gold_example',
        unlocked: true,
        awardedAt: '2026-01-02T15:00:00Z',
        currentValue: null,
        targetValue: null,
        percentComplete: null,
        claimedAt: '2026-01-02T15:05:00Z',
      }).success,
    ).toBe(true);
  });

  it('accepts a locked projection with progress (claimedAt is always null)', () => {
    expect(
      userPinProgressSchema.safeParse({
        pinId: 'gold_example',
        unlocked: false,
        awardedAt: null,
        currentValue: 60,
        targetValue: 100,
        percentComplete: 60,
        claimedAt: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a percentComplete of 100 (locked progress is [0, 99])', () => {
    expect(
      userPinProgressSchema.safeParse({
        pinId: 'gold_example',
        unlocked: false,
        awardedAt: null,
        currentValue: 100,
        targetValue: 100,
        percentComplete: 100,
        claimedAt: null,
      }).success,
    ).toBe(false);
  });

  it('rejects a projection missing claimedAt (.strict schema requires it)', () => {
    expect(
      userPinProgressSchema.safeParse({
        pinId: 'gold_example',
        unlocked: true,
        awardedAt: '2026-01-02T15:00:00Z',
        currentValue: null,
        targetValue: null,
        percentComplete: null,
      }).success,
    ).toBe(false);
  });
});
