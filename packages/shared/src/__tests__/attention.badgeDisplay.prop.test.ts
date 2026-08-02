// Feature: notification-center, Property 8: Badge display derivation
/**
 * Property-based test for the Notification_Center Attention_Badge display
 * derivation.
 *
 * Property 8 (design.md → Correctness Properties):
 *
 *   For any total attention count n, the badge display is hidden when n is 0,
 *   the exact value n when n is between 1 and 99 inclusive, and "99+" when n is
 *   100 or greater; and the badge's display mode and displayed value are always
 *   derived from the single badge count (the shown indicator is always
 *   consistent with that count).
 *
 * The test drives `badgeDisplayFor(count)` from `../attention.ts`, which returns
 * the pure `BadgeDisplay` mode (`'hidden' | 'count' | 'overflow'`). Generators
 * deliberately concentrate around the 99/100 boundary — the single place the
 * `count` → `overflow` transition happens — while also covering zero, the full
 * 1..99 band, and large values, so the boundary rule (R4.4: "99+" including at
 * exactly 100) is exercised rather than only interior points.
 *
 * Validates: Requirements 4.2, 4.3, 4.4, 4.6, 10.3, 10.4
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { badgeDisplayFor, type BadgeDisplay } from '../attention.js';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------
// Generators — cover zero, the 1..99 band, and the 99/100 boundary densely,
// plus large values, so the single count→overflow transition is well probed.
// ---------------------------------------------------------------------------

/**
 * Integer counts that emphasize the interesting regions:
 * - the boundary neighborhood 95..105 (the count↔overflow transition),
 * - zero and small positive values,
 * - the full 1..99 exact-display band,
 * - large values well beyond the overflow threshold.
 */
const countArb: fc.Arbitrary<number> = fc.oneof(
  // Dense sampling around the 99/100 boundary — the crux of R4.4.
  fc.integer({ min: 95, max: 105 }),
  // Zero and the low end of the exact-display band.
  fc.integer({ min: 0, max: 5 }),
  // The whole 1..99 exact-display band (R4.3).
  fc.integer({ min: 1, max: 99 }),
  // Large counts, all of which must overflow (R4.4).
  fc.integer({ min: 100, max: 100_000 }),
);

/**
 * Independent oracle mirroring the spec's mapping directly, so the assertion
 * does not merely restate the implementation under test.
 */
function expectedDisplay(n: number): BadgeDisplay {
  if (n <= 0) return 'hidden';
  if (n <= 99) return 'count';
  return 'overflow';
}

// ---------------------------------------------------------------------------
// Property 8
// ---------------------------------------------------------------------------

describe('Property 8: Badge display derivation', () => {
  it('is hidden at zero (R4.2, R10.4)', () => {
    expect(badgeDisplayFor(0)).toBe('hidden');
  });

  it('shows the exact-value mode across the full 1..99 band (R4.3, R10.3)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99 }), (n) => {
        expect(badgeDisplayFor(n)).toBe('count');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('overflows to "99+" at exactly 100 and above (R4.4)', () => {
    // Pin the exact boundary called out by R4.4 …
    expect(badgeDisplayFor(99)).toBe('count');
    expect(badgeDisplayFor(100)).toBe('overflow');
    // … then confirm every count at or beyond the threshold overflows.
    fc.assert(
      fc.property(fc.integer({ min: 100, max: 1_000_000 }), (n) => {
        expect(badgeDisplayFor(n)).toBe('overflow');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('matches the specified hidden/count/overflow mapping for any count, including the 99/100 boundary (R4.2, R4.3, R4.4)', () => {
    fc.assert(
      fc.property(countArb, (n) => {
        expect(badgeDisplayFor(n)).toBe(expectedDisplay(n));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is a total function of the single count — deterministic and always one of the three modes (R4.6, R10.4)', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const display = badgeDisplayFor(n);
        // Derived solely from the one count: same input → same mode.
        expect(badgeDisplayFor(n)).toBe(display);
        // The indicator is always exactly one of the three defined modes.
        expect(['hidden', 'count', 'overflow']).toContain(display);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('visibility (badge shown ⇔ count > 0) is consistent with the derived mode (R4.6, R10.3, R10.4)', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        const display = badgeDisplayFor(n);
        const shown = display !== 'hidden';
        // Shown for a positive count, hidden otherwise — a single source of truth.
        expect(shown).toBe(n > 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
