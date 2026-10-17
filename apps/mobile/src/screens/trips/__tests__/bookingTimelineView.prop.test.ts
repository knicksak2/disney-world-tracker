/**
 * Property and unit tests for bookingTimelineView presentation helpers (Task 11.2).
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.14
 */

import fc from 'fast-check';
import type { BookingWindowDTO, StayType, LightningLaneTiming, WindowStatus } from '@dwt/shared';
import {
  countdownLabel,
  statusPresentation,
  donePresentation,
  splitWindows,
  formatDropMoment,
  sourceLabel,
  pickChangedSettings,
  checkInRangeText,
  type SettingsFormValues,
} from '../bookingTimelineView';

describe('bookingTimelineView', () => {
  // Feature: trip-booking-timeline, Property 41: Presentation helpers map status, countdown, and form changes exactly
  describe('Property 41: Presentation helpers', () => {
    it('countdownLabel maps status and daysUntilDrop correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.constantFrom<WindowStatus>('upcoming', 'open', 'past'),
          (days, status) => {
            const label = countdownLabel({ status, daysUntilDrop: days });
            if (status === 'upcoming') {
              if (days > 1) {
                expect(label).toBe(`Opens in ${days} days`);
              } else if (days === 1) {
                expect(label).toBe('Opens tomorrow');
              } else {
                expect(label).toBe('Opens today');
              }
            } else if (status === 'open') {
              expect(label).toBe('Open now');
            } else {
              expect(label).toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('statusPresentation and donePresentation are pairwise distinct in icon and label', () => {
      const statuses: WindowStatus[] = ['upcoming', 'open', 'past'];
      const statusResults = statuses.map((s) => statusPresentation(s));
      const statusIcons = new Set(statusResults.map((r) => r.icon));
      const statusLabels = new Set(statusResults.map((r) => r.label));

      expect(statusIcons.size).toBe(3);
      expect(statusLabels.size).toBe(3);

      const doneResults = [donePresentation(true), donePresentation(false)];
      const doneIcons = new Set(doneResults.map((r) => r.icon));
      const doneLabels = new Set(doneResults.map((r) => r.label));

      expect(doneIcons.size).toBe(2);
      expect(doneLabels.size).toBe(2);

      // Verify each status x done pair has distinct representations
      for (const s of statuses) {
        const sp = statusPresentation(s);
        for (const d of [true, false]) {
          const dp = donePresentation(d);
          expect(sp.icon).not.toBe(dp.icon);
          expect(sp.label).not.toBe(dp.label);
        }
      }
    });

    it('splitWindows partitions active and past while preserving order', () => {
      const windowArb = fc.record({
        windowKey: fc.string(),
        kind: fc.constantFrom<'dining' | 'lightning_lane'>('dining', 'lightning_lane'),
        dropOn: fc.constant('2025-06-01'),
        dropAt: fc.constant('2025-06-01T10:00:00.000Z'),
        coveredDates: fc.constant(['2025-06-01']),
        status: fc.constantFrom<WindowStatus>('upcoming', 'open', 'past'),
        daysUntilDrop: fc.constant(null),
        done: fc.boolean(),
        doneAt: fc.constant(null),
        doneByDisplayName: fc.constant(null),
        bookedCount: fc.constant(0),
      }) as fc.Arbitrary<BookingWindowDTO>;

      fc.assert(
        fc.property(fc.array(windowArb, { minLength: 0, maxLength: 30 }), (windows) => {
          const { active, past } = splitWindows(windows);

          expect(active.length + past.length).toBe(windows.length);
          for (const w of active) {
            expect(w.status === 'upcoming' || w.status === 'open').toBe(true);
          }
          for (const w of past) {
            expect(w.status).toBe('past');
          }

          // Order preservation: filter original list should equal partitioned list
          const expectedActive = windows.filter((w) => w.status !== 'past');
          const expectedPast = windows.filter((w) => w.status === 'past');
          expect(active).toEqual(expectedActive);
          expect(past).toEqual(expectedPast);
        }),
        { numRuns: 100 },
      );
    });

    it('pickChangedSettings contains exactly the differing fields and is empty when equal', () => {
      const stayTypes: Array<StayType | null> = ['resort', 'partner_hotel', 'offsite', null];
      const llTimings: Array<LightningLaneTiming | null> = [
        'seven_day',
        'three_day',
        'three_day_daily',
        null,
      ];
      const dates: Array<string | null> = ['2025-06-01', '2025-06-15', null];

      const formArb = fc.record({
        stayType: fc.constantFrom(...stayTypes),
        lightningLaneTiming: fc.constantFrom(...llTimings),
        checkInOverride: fc.constantFrom(...dates),
      }) as fc.Arbitrary<SettingsFormValues>;

      fc.assert(
        fc.property(formArb, formArb, (stored, draft) => {
          const delta = pickChangedSettings(stored, draft);

          if (draft.stayType !== stored.stayType) {
            expect(delta.stayType).toBe(draft.stayType);
          } else {
            expect('stayType' in delta).toBe(false);
          }

          if (draft.lightningLaneTiming !== stored.lightningLaneTiming) {
            expect(delta.lightningLaneTiming).toBe(draft.lightningLaneTiming);
          } else {
            expect('lightningLaneTiming' in delta).toBe(false);
          }

          if (draft.checkInOverride !== stored.checkInOverride) {
            expect(delta.checkInOverride).toBe(draft.checkInOverride);
          } else {
            expect('checkInOverride' in delta).toBe(false);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('unit examples', () => {
    it('formatDropMoment produces time in America/New_York containing 6:00 AM and ET', () => {
      const formatted = formatDropMoment('2025-06-01T10:00:00Z');
      expect(formatted).toContain('6:00 AM');
      expect(formatted).toContain('ET');
      expect(formatted).toContain('Jun 1');
    });

    it('checkInRangeText builds range text from checkInOverrideRange', () => {
      const text = checkInRangeText('2025-07-01');
      expect(text).toBe('Choose a date from Jun 1 to Jul 1');
    });

    it('sourceLabel returns Set by an Organizer only for override', () => {
      expect(sourceLabel('override')).toBe('Set by an Organizer');
      expect(sourceLabel('auto')).toBe('Detected automatically');
      expect(sourceLabel('trip_start')).toBe('Detected automatically');
    });
  });
});
