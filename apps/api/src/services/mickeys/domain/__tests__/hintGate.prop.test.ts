// Feature: hidden-mickeys, Property 1: Spoiler gating
// Feature: hidden-mickeys, Property 2: Hint level is monotonic

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { visibleLayers, nextHintLevel } from '../hintGate.js';

describe('hintGate domain module', () => {
  // Feature: hidden-mickeys, Property 1: Spoiler gating
  it('Property 1: visibleLayers exposes clue2 and reveal strictly based on hint level or found status', () => {
    fc.assert(
      fc.property(
        fc.record({ clue2: fc.string({ minLength: 10 }), reveal: fc.string({ minLength: 10 }) }),
        fc.option(
          fc.record({
            hintLevel: fc.integer({ min: 1, max: 3 }),
            found: fc.boolean(),
          }),
          { nil: null },
        ),
        (m, p) => {
          const visible = visibleLayers(m, p);
          const level = p?.hintLevel ?? 1;
          const found = p?.found ?? false;

          // clue2 is present iff hintLevel >= 2 or found is true
          if (level >= 2 || found) {
            expect(visible.clue2).toBe(m.clue2);
          } else {
            expect(visible.clue2).toBeUndefined();
          }

          // reveal is present iff hintLevel >= 3 or found is true
          if (level >= 3 || found) {
            expect(visible.reveal).toBe(m.reveal);
          } else {
            expect(visible.reveal).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: hidden-mickeys, Property 2: Hint level is monotonic
  it('Property 2: nextHintLevel is monotonic across arbitrary request sequences', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 50 }),
        (requestedLevels) => {
          let current = 1;
          for (const req of requestedLevels) {
            const next = nextHintLevel(current, req);
            expect(next).toBeGreaterThanOrEqual(current);
            expect(next).toBe(Math.max(current, req));
            expect(next).toBeLessThanOrEqual(3);
            expect(next).toBeGreaterThanOrEqual(1);
            current = next;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
