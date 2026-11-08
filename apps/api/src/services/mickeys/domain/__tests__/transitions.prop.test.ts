// Feature: hidden-mickeys, Property 11: Status transitions

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { MICKEY_STATUSES, type MickeyStatus } from '@dwt/shared';
import { canTransition } from '../transitions.js';

describe('transitions domain module', () => {
  const allowedPairs = new Set([
    'pending->approved',
    'pending->rejected',
    'approved->retired',
    'retired->approved',
    'approved->hidden',
    'hidden->approved',
    'hidden->retired',
  ]);

  // Feature: hidden-mickeys, Property 11: Status transitions
  it('Property 11: canTransition allows exactly the 7 documented status transitions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<MickeyStatus>(...MICKEY_STATUSES),
        fc.constantFrom<MickeyStatus>(...MICKEY_STATUSES),
        (from, to) => {
          const key = `${from}->${to}`;
          const isAllowed = canTransition(from, to);
          if (allowedPairs.has(key)) {
            expect(isAllowed).toBe(true);
          } else {
            expect(isAllowed).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
