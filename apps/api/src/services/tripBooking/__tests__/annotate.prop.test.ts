import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  deriveBookingTimeline,
  annotateWindows,
  windowStatus,
  daysUntilDrop,
  type AnnotateContext,
  type TimelineTripInput,
} from '../timeline.js';
import {
  addCalendarDays,
  diffCalendarDays,
  type WindowStatus,
} from '@dwt/shared';
import { wdwToday } from '../../trips/wdwClock.js';

const tripInputArb: fc.Arbitrary<TimelineTripInput> = fc
  .record({
    startOffset: fc.integer({ min: 0, max: 200 }),
    nights: fc.integer({ min: 1, max: 20 }),
    hasResortStay: fc.boolean(),
  })
  .map(r => ({
    startDate: addCalendarDays('2025-01-01', r.startOffset),
    endDate: addCalendarDays('2025-01-01', r.startOffset + r.nights),
    hasResortStay: r.hasResortStay,
    settings: null,
  }));

describe('annotate.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 8: Window status is a monotone function of a single instant, and the countdown matches it
  it('Property 8: Window status is a monotone function of a single instant, and the countdown matches it', () => {
    fc.assert(
      fc.property(
        tripInputArb,
        fc.integer({ min: -80, max: 40 }),
        (trip, dayOffset) => {
          const timeline = deriveBookingTimeline(trip);
          if (timeline.windows.length === 0) return;

          // Test sweeping instants from before dropAt to far after
          const sampleWindow = timeline.windows[0]!;
          const dropAtMs = Date.parse(sampleWindow.dropAt);
          const dropOn = sampleWindow.dropOn;
          const lastCovered = sampleWindow.coveredDates[sampleWindow.coveredDates.length - 1]!;

          // Specific boundary test: dropAt === now
          const exactNow = new Date(dropAtMs);
          const exactToday = wdwToday(exactNow);
          const statusAtEquality = windowStatus(sampleWindow, exactNow, exactToday);
          expect(statusAtEquality).not.toBe('upcoming');
          if (lastCovered >= exactToday) {
            expect(statusAtEquality).toBe('open');
          } else {
            expect(statusAtEquality).toBe('past');
          }

          // Just before dropAt (1 ms before)
          const justBeforeNow = new Date(dropAtMs - 1);
          const justBeforeToday = wdwToday(justBeforeNow);
          expect(windowStatus(sampleWindow, justBeforeNow, justBeforeToday)).toBe('upcoming');

          // Sweep sequence of increasing times
          const times = [
            dropAtMs - 86_400_000 * 2,
            dropAtMs - 1000,
            dropAtMs,
            dropAtMs + 1000,
            Date.parse(`${lastCovered}T23:59:59.000Z`) + 86_400_000 * 2,
          ].sort((a, b) => a - b);

          const statusOrder: Record<WindowStatus, number> = {
            upcoming: 0,
            open: 1,
            past: 2,
          };

          let previousStatusLevel = -1;
          for (const t of times) {
            const now = new Date(t);
            const today = wdwToday(now);
            const status = windowStatus(sampleWindow, now, today);
            const statusLevel = statusOrder[status];
            expect(statusLevel).toBeGreaterThanOrEqual(previousStatusLevel);
            previousStatusLevel = statusLevel;

            const days = daysUntilDrop(sampleWindow, status, today);
            if (status === 'upcoming') {
              expect(days).not.toBeNull();
              expect(days!).toBeGreaterThanOrEqual(0);
              expect(days).toBe(Math.max(0, diffCalendarDays(dropOn, today)));
            } else {
              expect(days).toBeNull();
            }
          }

          // Whole timeline annotation returns every window including past
          const arbitraryNow = new Date(dropAtMs + dayOffset * 86_400_000);
          const ctx: AnnotateContext = {
            now: arbitraryNow,
            doneMarks: new Map(),
            reservations: [],
          };
          const annotated = annotateWindows(timeline, ctx);
          expect(annotated.length).toBe(timeline.windows.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 9: Done flag and bookedCount are independent, correct annotations
  it('Property 9: Done flag and bookedCount are independent, correct annotations', () => {
    fc.assert(
      fc.property(
        tripInputArb,
        fc.array(
          fc.record({
            markedAt: fc.constant('2025-05-01T12:00:00.000Z'),
            markedByDisplayName: fc.string({ minLength: 1, maxLength: 20 }),
          })
        ),
        fc.array(
          fc.record({
            kind: fc.constantFrom('dining', 'lightning_lane', 'other'),
            plannedDateOffset: fc.integer({ min: -5, max: 25 }),
          })
        ),
        (trip, markData, rawReservations) => {
          const timeline = deriveBookingTimeline(trip);
          if (timeline.windows.length === 0) return;

          // Build random done marks
          const doneMarks = new Map<string, { markedAt: string; markedByDisplayName: string }>();
          timeline.windows.forEach((w, idx) => {
            if (markData[idx]) {
              doneMarks.set(w.windowKey, markData[idx]!);
            }
          });

          // Build reservations mapped to trip dates
          const reservations = rawReservations.map(r => ({
            kind: r.kind,
            plannedDate: addCalendarDays(trip.startDate, r.plannedDateOffset),
          }));

          const now = new Date(Date.parse(timeline.windows[0]!.dropAt));
          const ctx: AnnotateContext = {
            now,
            doneMarks,
            reservations,
          };

          const annotated = annotateWindows(timeline, ctx);

          for (let i = 0; i < timeline.windows.length; i++) {
            const w = timeline.windows[i]!;
            const a = annotated[i]!;

            // done and marker display name
            const mark = doneMarks.get(w.windowKey);
            if (mark) {
              expect(a.done).toBe(true);
              expect(a.doneAt).toBe(mark.markedAt);
              expect(a.doneByDisplayName).toBe(mark.markedByDisplayName);
            } else {
              expect(a.done).toBe(false);
              expect(a.doneAt).toBeNull();
              expect(a.doneByDisplayName).toBeNull();
            }

            // bookedCount matches exact filter
            const expectedCount = reservations.filter(
              r => r.kind === w.kind && w.coveredDates.includes(r.plannedDate)
            ).length;
            expect(a.bookedCount).toBe(expectedCount);
          }

          // Changing reservations or marks changes NO window's status or daysUntilDrop
          const emptyCtx: AnnotateContext = {
            now,
            doneMarks: new Map(),
            reservations: [],
          };
          const baseAnnotated = annotateWindows(timeline, emptyCtx);
          for (let i = 0; i < annotated.length; i++) {
            expect(annotated[i]!.status).toBe(baseAnnotated[i]!.status);
            expect(annotated[i]!.daysUntilDrop).toBe(baseAnnotated[i]!.daysUntilDrop);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 10: Done marks follow the Window_Key across a date change
  it('Property 10: Done marks follow the Window_Key across a date change', () => {
    fc.assert(
      fc.property(
        tripInputArb,
        fc.integer({ min: 1, max: 30 }),
        (trip, shiftDays) => {
          const t1 = deriveBookingTimeline(trip);
          if (t1.windows.length === 0) return;

          // Record a done mark on the first window of t1
          const firstWindow = t1.windows[0]!;
          const doneMarks = new Map([
            [
              firstWindow.windowKey,
              { markedAt: '2025-04-01T10:00:00.000Z', markedByDisplayName: 'Alice' },
            ],
            [
              'dining:1999-01-01', // A vanished/unrelated key
              { markedAt: '1999-01-01T10:00:00.000Z', markedByDisplayName: 'Ghost' },
            ],
          ]);

          // Shift trip dates by shiftDays
          const shiftedTrip: TimelineTripInput = {
            ...trip,
            startDate: addCalendarDays(trip.startDate, shiftDays),
            endDate: addCalendarDays(trip.endDate, shiftDays),
          };
          const t2 = deriveBookingTimeline(shiftedTrip);

          const now = new Date('2025-01-01T00:00:00.000Z');
          const annotated = annotateWindows(t2, {
            now,
            doneMarks,
            reservations: [],
          });

          // After shift, a window is done iff its NEW key is in doneMarks
          for (const a of annotated) {
            if (doneMarks.has(a.windowKey)) {
              expect(a.done).toBe(true);
            } else {
              expect(a.done).toBe(false);
            }
          }

          // If a key was unchanged (e.g. shiftDays = 0, or zero-shift case), done is preserved
          const unchangedAnnotated = annotateWindows(t1, {
            now,
            doneMarks,
            reservations: [],
          });
          expect(unchangedAnnotated[0]!.done).toBe(true);

          // Stored map is unmodified
          expect(doneMarks.size).toBe(2);
          expect(doneMarks.has('dining:1999-01-01')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
