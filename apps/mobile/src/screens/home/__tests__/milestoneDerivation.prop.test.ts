/**
 * Property-based tests for resolveEarliestActiveMilestone.
 *
 * Feature: navigation-redesign, Property 11: Earliest Active Milestone Selection for Upcoming Vacation Card
 * Validates: Requirement 2.8
 */

import fc from 'fast-check';
import type { BookingWindowDTO, WindowKind, WindowStatus } from '@dwt/shared';
import { resolveEarliestActiveMilestone } from '../milestoneDerivation';

function arbitraryBookingWindow(): fc.Arbitrary<BookingWindowDTO> {
  return fc.record({
    windowKey: fc.uuid().map((id) => `window:${id}`),
    kind: fc.constantFrom<WindowKind>('dining', 'lightning_lane'),
    dropOn: fc.constantFrom('2026-11-01', '2026-11-07', '2026-12-01', '2026-12-10'),
    dropAt: fc.constantFrom(
      '2026-11-01T10:00:00.000Z',
      '2026-11-07T11:00:00.000Z',
      '2026-12-01T12:00:00.000Z',
      '2026-12-10T12:00:00.000Z',
    ),
    coveredDates: fc.constant(['2026-12-10']),
    status: fc.constantFrom<WindowStatus>('upcoming', 'open', 'past'),
    daysUntilDrop: fc.nat({ max: 90 }),
    done: fc.boolean(),
    doneAt: fc.constant(null),
    doneByDisplayName: fc.constant(null),
    bookedCount: fc.nat({ max: 5 }),
  });
}

describe('Feature: navigation-redesign, Property 11: Earliest Active Milestone Selection', () => {
  it('returns null for empty, null, or undefined input', () => {
    expect(resolveEarliestActiveMilestone(null)).toBeNull();
    expect(resolveEarliestActiveMilestone(undefined)).toBeNull();
    expect(resolveEarliestActiveMilestone([])).toBeNull();
  });

  it('Property 11: always picks the earliest chronological active, unfinished window', () => {
    fc.assert(
      fc.property(fc.array(arbitraryBookingWindow(), { minLength: 1, maxLength: 10 }), (windows) => {
        const result = resolveEarliestActiveMilestone(windows);
        const eligible = windows.filter((w) => w.status !== 'past' && !w.done);

        if (eligible.length === 0) {
          expect(result).toBeNull();
        } else {
          expect(result).not.toBeNull();
          const earliest = [...eligible].sort((a, b) => a.dropAt.localeCompare(b.dropAt))[0]!;
          expect(result!.windowKey).toBe(earliest.windowKey);
          expect(result!.kind).toBe(earliest.kind);
          expect(result!.isOpenNow).toBe(earliest.status === 'open');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('omits windows that are marked done even if status is open or upcoming', () => {
    const windows: BookingWindowDTO[] = [
      {
        windowKey: 'dining:2026-11-01',
        kind: 'dining',
        dropOn: '2026-11-01',
        dropAt: '2026-11-01T10:00:00.000Z',
        coveredDates: ['2026-12-10'],
        status: 'open',
        daysUntilDrop: 0,
        done: true,
        doneAt: '2026-11-01T10:05:00.000Z',
        doneByDisplayName: 'Nicholas',
        bookedCount: 2,
      },
      {
        windowKey: 'lightning_lane:2026-12-03',
        kind: 'lightning_lane',
        dropOn: '2026-12-03',
        dropAt: '2026-12-03T12:00:00.000Z',
        coveredDates: ['2026-12-10'],
        status: 'upcoming',
        daysUntilDrop: 32,
        done: false,
        doneAt: null,
        doneByDisplayName: null,
        bookedCount: 0,
      },
    ];

    const result = resolveEarliestActiveMilestone(windows);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('lightning_lane');
    expect(result!.title).toContain('⚡ Lightning Lane opens in 32 days');
  });
});

