/**
 * Property tests for the pure pin render model (Properties 5, 6, 10).
 *
 * These assert the visual invariants the design locks: rim widths grow with rarity, the
 * capstone outranks the ramp with a bespoke treatment, and ascending ladder rungs are
 * monotonically richer. They run against the pure functions in `pinRenderModel`, so a
 * regression in the constants or the ladder curve fails here rather than only on a device.
 */
import fc from 'fast-check';
import type { PinTier } from '@dwt/shared';

import {
  RAMP_TIERS,
  CAPSTONE_TIER,
  RIM_BY_TIER,
  METALS,
  ladderComplexity,
  rimFor,
  isCapstone,
  resolvePinRender,
  type LadderComplexity,
} from '../pinRenderModel';

describe('pinRenderModel properties', () => {
  // Feature: pin-collection, Property 6: Rim Scaling by Tier Invariant
  test('Property 6: rim width is strictly increasing across the six ramp tiers', () => {
    for (let i = 1; i < RAMP_TIERS.length; i += 1) {
      const prev = RAMP_TIERS[i - 1]!;
      const cur = RAMP_TIERS[i]!;
      expect(RIM_BY_TIER[cur]).toBeGreaterThan(RIM_BY_TIER[prev]);
    }
    // exact locked sequence
    expect(RAMP_TIERS.map((t) => RIM_BY_TIER[t])).toEqual([4.2, 5.2, 6.2, 7.2, 8.2, 9.2]);
  });

  // Feature: pin-collection, Property 10: Seven-Tier Rarity Monotonicity
  test('Property 10: capstone outranks prism in rim and renders bespoke, not a ramp rung', () => {
    // rim non-decreasing across the whole ramp, and the capstone strictly above prism
    const rampRims = RAMP_TIERS.map((t) => RIM_BY_TIER[t]);
    for (let i = 1; i < rampRims.length; i += 1) {
      expect(rampRims[i]!).toBeGreaterThanOrEqual(rampRims[i - 1]!);
    }
    expect(RIM_BY_TIER[CAPSTONE_TIER]).toBeGreaterThan(RIM_BY_TIER.prism);
    // bespoke treatment: the capstone is flagged as such and carries its own Aurora-Gold ramp
    // distinct from every ramp tier's metal.
    expect(isCapstone(CAPSTONE_TIER)).toBe(true);
    expect(isCapstone('prism')).toBe(false);
    const mythicMetal = METALS[CAPSTONE_TIER].join(',');
    for (const t of RAMP_TIERS) {
      expect(METALS[t].join(',')).not.toEqual(mythicMetal);
    }
    expect(resolvePinRender({ tier: CAPSTONE_TIER, mode: 'diecut' }, true).capstone).toBe(true);
  });

  // Feature: pin-collection, Property 5: Intra-Tier Visual Complexity Monotonicity
  test('Property 5: ascending ladder rungs never decrease any ornament field', () => {
    const fields: readonly (keyof LadderComplexity)[] = [
      'rays',
      'sparks',
      'bezel',
      'stars',
      'coreR',
      'sparkTipR',
    ];
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }), // maxLevel (top rung index)
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        (maxLevel, a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const cLo = ladderComplexity(lo, maxLevel);
          const cHi = ladderComplexity(hi, maxLevel);
          for (const f of fields) {
            expect(cHi[f]).toBeGreaterThanOrEqual(cLo[f]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: pin-collection, Property 5 (boundaries): the ladder spans its full documented range
  test('Property 5: the bottom rung is the sparse end and the top rung the rich end', () => {
    const bottom = ladderComplexity(0, 11);
    const top = ladderComplexity(11, 11);
    expect(bottom.rays).toBe(8);
    expect(top.rays).toBe(24);
    expect(bottom.stars).toBe(4);
    expect(top.stars).toBe(31);
    expect(top.sparks).toBeGreaterThan(bottom.sparks);
    expect(top.coreR).toBeGreaterThan(bottom.coreR);
  });

  test('rim override is honoured when a pin pins a thicker rim', () => {
    expect(rimFor('gold')).toBe(6.2);
    expect(rimFor('gold', 8)).toBe(8);
  });

  test('locked pins render the darkened dead ramp and locked enamel', () => {
    const locked = resolvePinRender({ tier: 'gold' as PinTier, mode: 'contained' }, false);
    expect(locked.locked).toBe(true);
    expect(locked.metal).toEqual(METALS.dead);
    expect(locked.enamel).toBe('#2b2536');
    const unlocked = resolvePinRender({ tier: 'gold' as PinTier, mode: 'contained' }, true);
    expect(unlocked.metal).toEqual(METALS.gold);
  });
});
