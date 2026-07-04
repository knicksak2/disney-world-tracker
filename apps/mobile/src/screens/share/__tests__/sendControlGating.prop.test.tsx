// Feature: social-sharing-loop, Property 3: Composer send control is gated by recipient count
//
// Validates: Requirements 2.6, 2.7, 2.15
//
// Property 3 (from design.md):
//   For any number of selected recipient Friends n, the Share_Composer's send
//   control is enabled if and only if 1 <= n <= 50 (and the User has at least
//   one Friend available).
//
// This targets the pure send-gating logic behind the Share_Composer, extracted
// into `recipientGating.ts` (task 5.2):
//   - `canSend(recipientCount, friendCount)` — the send control is enabled iff
//     the User has >= 1 Friend available (R2.15) AND the selected recipient
//     count is within [1, 50] (R2.6, R2.7).
//   - `isRecipientCountValid(count)` — the count is within [1, 50].
//   - `hasNoFriends(friendCount)` — the User has zero Friends available.
//
// Test strategy:
//   - `canSend` is a framework-free pure function, so the property runs without
//     rendering — no React, react-navigation, or expo mocks needed.
//   - Generate recipient counts spanning below, within, and above the valid
//     window (including 0, the boundaries 1 and 50, and values > 50) so
//     fast-check exercises both sides of each boundary and shrinks toward them.
//   - Generate friend counts spanning zero (no-friends empty state) and one or
//     more available Friends.
//   - Assert the biconditional against an independently computed reference:
//     enabled iff friendCount >= 1 AND 1 <= recipientCount <= 50.
//   - Include focused sub-properties for each requirement: the no-friends gate
//     (R2.15), the count-range gate (R2.6/R2.7), and the exact boundaries.

import fc from 'fast-check';

import {
  MIN_RECIPIENTS,
  MAX_RECIPIENTS,
  canSend,
  hasNoFriends,
  isRecipientCountValid,
} from '../recipientGating';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Recipient counts spanning the full space around the valid window: 0, values
 * within [1, 50], and values above 50. Weighted to concentrate near the
 * boundaries so both sides of `MIN_RECIPIENTS` and `MAX_RECIPIENTS` are hit.
 */
const recipientCountArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constant(MIN_RECIPIENTS), // 1 (lower boundary, valid)
  fc.constant(MAX_RECIPIENTS), // 50 (upper boundary, valid)
  fc.constant(MAX_RECIPIENTS + 1), // 51 (just over, invalid)
  fc.integer({ min: MIN_RECIPIENTS, max: MAX_RECIPIENTS }), // within window
  fc.integer({ min: 0, max: 500 }), // full sweep including over-limit
);

/** Friend counts spanning zero (empty state) and one-or-more available. */
const friendCountArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 0, max: 500 }),
);

// Reference oracle, computed independently of the implementation.
const expectedCanSend = (recipientCount: number, friendCount: number): boolean =>
  friendCount >= MIN_RECIPIENTS &&
  recipientCount >= MIN_RECIPIENTS &&
  recipientCount <= MAX_RECIPIENTS;

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('Property 3: Composer send control is gated by recipient count (R2.6, R2.7, R2.15)', () => {
  test('send is enabled iff the User has >=1 Friend AND recipient count is in [1, 50]', () => {
    fc.assert(
      fc.property(recipientCountArb, friendCountArb, (recipientCount, friendCount) => {
        const enabled = canSend(recipientCount, friendCount);

        expect(enabled).toBe(expectedCanSend(recipientCount, friendCount));
      }),
      { numRuns: 100 },
    );
  });

  test('send is disabled when the User has zero Friends, regardless of count (R2.15)', () => {
    fc.assert(
      fc.property(recipientCountArb, (recipientCount) => {
        expect(canSend(recipientCount, 0)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  test('with friends available, send is enabled iff count is within [1, 50] (R2.6, R2.7)', () => {
    fc.assert(
      fc.property(
        recipientCountArb,
        fc.integer({ min: 1, max: 500 }),
        (recipientCount, friendCount) => {
          const withinWindow =
            recipientCount >= MIN_RECIPIENTS && recipientCount <= MAX_RECIPIENTS;

          expect(canSend(recipientCount, friendCount)).toBe(withinWindow);
          expect(isRecipientCountValid(recipientCount)).toBe(withinWindow);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('send is disabled when count is 0 or greater than 50 (R2.7)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(0), fc.integer({ min: MAX_RECIPIENTS + 1, max: 500 })),
        fc.integer({ min: 1, max: 500 }),
        (recipientCount, friendCount) => {
          expect(canSend(recipientCount, friendCount)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('hasNoFriends is true exactly when there are zero (or fewer) friends available', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500 }), (friendCount) => {
        expect(hasNoFriends(friendCount)).toBe(friendCount <= 0);
      }),
      { numRuns: 100 },
    );
  });

  test('boundaries: 1 and 50 are valid, 0 and 51 are not (with friends available)', () => {
    expect(canSend(MIN_RECIPIENTS, 1)).toBe(true); // 1
    expect(canSend(MAX_RECIPIENTS, 1)).toBe(true); // 50
    expect(canSend(MIN_RECIPIENTS - 1, 1)).toBe(false); // 0
    expect(canSend(MAX_RECIPIENTS + 1, 1)).toBe(false); // 51
  });
});
