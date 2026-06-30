// Feature: experience-live-details, Property 12: Wait/status display gating is a pure function of status and wait presence
/**
 * Property-based tests for `waitStatusDisplay`.
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 *
 * The Ride/Character_Meet wait-and-status display is a pure function of the
 * Operating_Status and whether a standby Wait_Time is present:
 *   - `standby` (with the value) iff status is `Operating` AND a wait is
 *     present (R4.2);
 *   - `no_wait` when status is `Operating` AND the wait is absent (R4.4);
 *   - `none` for any non-Operating status — Closed / Down / Refurbishment /
 *     Unknown — regardless of whether a wait is present (R4.3).
 *
 * The tests sweep the full status x wait-presence space and assert the
 * decision is deterministic (same inputs -> identical result).
 */

import fc from 'fast-check';

import type { OperatingStatus } from '@dwt/shared';

import { waitStatusDisplay } from '../liveView';

const NUM_RUNS = 100;

const STATUSES: readonly OperatingStatus[] = [
  'Operating',
  'Closed',
  'Down',
  'Refurbishment',
  'Unknown',
] as const;

const NON_OPERATING: readonly OperatingStatus[] = STATUSES.filter(
  (status) => status !== 'Operating',
);

const statusArb = fc.constantFrom(...STATUSES);
// Whole-minute standby wait in [0, 1440] (R1.5/R1.6 domain), or absent.
const waitArb = fc.option(fc.integer({ min: 0, max: 1440 }), {
  nil: undefined,
});

describe('waitStatusDisplay (Property 12: wait/status display gating)', () => {
  it('shows the standby value iff Operating and a wait is present; no_wait iff Operating and absent; none otherwise', () => {
    fc.assert(
      fc.property(statusArb, waitArb, (status, waitMinutes) => {
        const result = waitStatusDisplay(status, waitMinutes);

        if (status === 'Operating' && waitMinutes !== undefined) {
          // R4.2: standby value shown, carrying the exact wait.
          expect(result).toEqual({ kind: 'standby', waitMinutes });
        } else if (status === 'Operating') {
          // R4.4: Operating but no wait posted.
          expect(result).toEqual({ kind: 'no_wait' });
        } else {
          // R4.3: any non-Operating status shows nothing, regardless of wait.
          expect(result).toEqual({ kind: 'none' });
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns none for every non-Operating status regardless of wait presence (R4.3)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NON_OPERATING), waitArb, (status, waitMinutes) => {
        expect(waitStatusDisplay(status, waitMinutes)).toEqual({ kind: 'none' });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic: identical inputs yield identical results over the full status x wait-presence space', () => {
    fc.assert(
      fc.property(statusArb, waitArb, (status, waitMinutes) => {
        expect(waitStatusDisplay(status, waitMinutes)).toEqual(
          waitStatusDisplay(status, waitMinutes),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
