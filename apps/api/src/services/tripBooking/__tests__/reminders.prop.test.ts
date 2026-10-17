import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  reminderFireAt,
  ledgerKey,
  isDue,
  deriveDueReminders,
  inSendWindow,
  reminderHorizonDays,
  reminderHorizonDate,
  isCandidateTrip,
  coalesceReminders,
  selectRecipients,
  type ReminderEnv,
  type DueReminder,
} from '../reminders.js';
import {
  deriveBookingTimeline,
  type TimelineTripInput,
} from '../timeline.js';
import {
  REMINDER_LEADS,
  addCalendarDays,
  type ReminderLead,
  type WindowKind,
} from '@dwt/shared';
import { wdwMinutesFromMidnight, wdwToday } from '../../trips/wdwClock.js';

const tripInputArb: fc.Arbitrary<TimelineTripInput> = fc
  .record({
    startDate: fc.constantFrom(
      '2025-03-08',
      '2025-03-09',
      '2025-03-10',
      '2025-11-01',
      '2025-11-02',
      '2025-06-14',
      '2025-09-01'
    ),
    nights: fc.integer({ min: 1, max: 20 }),
    hasResortStay: fc.boolean(),
  })
  .map(r => ({
    startDate: r.startDate,
    endDate: addCalendarDays(r.startDate, r.nights),
    hasResortStay: r.hasResortStay,
    settings: null,
  }));

describe('reminders.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 12: Fire_At matches the lead schedule at the exact WDW wall-clock time
  it('Property 12: Fire_At matches the lead schedule at the exact WDW wall-clock time', () => {
    fc.assert(
      fc.property(tripInputArb, trip => {
        const timeline = deriveBookingTimeline(trip);
        for (const w of timeline.windows) {
          // eve: 20:00 WDW on dropOn - 1
          const eveFire = reminderFireAt(w, 'eve');
          const eveDate = addCalendarDays(w.dropOn, -1);
          expect(wdwMinutesFromMidnight(eveDate, eveFire)).toBe(20 * 60);

          // week: 09:00 WDW on dropOn - 7
          const weekFire = reminderFireAt(w, 'week');
          const weekDate = addCalendarDays(w.dropOn, -7);
          expect(wdwMinutesFromMidnight(weekDate, weekFire)).toBe(9 * 60);

          // open: equals dropAt
          const openFire = reminderFireAt(w, 'open');
          expect(openFire).toBe(w.dropAt);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 13: A reminder is due exactly when inside its catch-up window and not suppressed
  it('Property 13: A reminder is due exactly when inside its catch-up window and not suppressed', () => {
    // Specific boundary unit checks for half-open interval: fireAt <= now < fireAt + catchup
    const catchupMs = 180 * 60 * 1000;
    const fireAtMs = 100_000_000;
    expect(isDue(fireAtMs, fireAtMs - 1, catchupMs)).toBe(false); // lower bound strictly before -> false
    expect(isDue(fireAtMs, fireAtMs, catchupMs)).toBe(true); // lower bound equality -> true
    expect(isDue(fireAtMs, fireAtMs + catchupMs - 1, catchupMs)).toBe(true); // upper bound - 1 -> true
    expect(isDue(fireAtMs, fireAtMs + catchupMs, catchupMs)).toBe(false); // upper bound equality -> false (exclusive!)

    fc.assert(
      fc.property(
        tripInputArb,
        fc.constantFrom<ReminderLead>('eve', 'open', 'week'),
        fc.integer({ min: -5, max: 200 }),
        (trip, lead, minuteOffset) => {
          const timeline = deriveBookingTimeline(trip);
          if (timeline.windows.length === 0) return;

          const w = timeline.windows[0]!;
          const fireAt = reminderFireAt(w, lead);
          const fireAtMs = Date.parse(fireAt);
          const nowMs = fireAtMs + minuteOffset * 60_000;
          const today = wdwToday(new Date(nowMs));

          const env: ReminderEnv = {
            nowMs,
            today,
            leads: [lead],
            catchupMs,
          };

          const key = ledgerKey(w.kind, w.dropAt, lead);

          // Test 1: normal derivation
          const res = deriveDueReminders([w], new Set(), new Set(), env);
          const expectedDue =
            isDue(fireAtMs, nowMs, catchupMs) &&
            w.coveredDates[w.coveredDates.length - 1]! >= today;

          if (expectedDue) {
            expect(res.length).toBe(1);
            expect(res[0]!.windowKey).toBe(w.windowKey);
            expect(res[0]!.lead).toBe(lead);
          } else {
            expect(res.length).toBe(0);
          }

          // Test 2: claimed ledger key is NOT returned again
          const resClaimed = deriveDueReminders([w], new Set(), new Set([key]), env);
          expect(resClaimed.length).toBe(0);

          // Test 3: done window returns NOTHING
          const resDone = deriveDueReminders([w], new Set([w.windowKey]), new Set(), env);
          expect(resDone.length).toBe(0);

          // Test 4: removing done mark restores unclaimed reminder
          const resRestored = deriveDueReminders([w], new Set(), new Set(), env);
          expect(resRestored).toEqual(res);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 16: A Trip date change produces fresh reminders and no stale ones
  it('Property 16: A Trip date change produces fresh reminders and no stale ones', () => {
    fc.assert(
      fc.property(
        tripInputArb,
        fc.integer({ min: 1, max: 20 }),
        (trip, shiftDays) => {
          const t1 = deriveBookingTimeline(trip);
          if (t1.windows.length === 0) return;

          // Shift trip dates
          const shiftedTrip: TimelineTripInput = {
            ...trip,
            startDate: addCalendarDays(trip.startDate, shiftDays),
            endDate: addCalendarDays(trip.endDate, shiftDays),
          };
          const t2 = deriveBookingTimeline(shiftedTrip);

          expect(t2.windows.length).toBe(t1.windows.length);

          // For every window, shifting changes dropAt and produces a distinct ledger key
          for (let i = 0; i < t1.windows.length; i++) {
            const w1 = t1.windows[i]!;
            const w2 = t2.windows[i]!;

            expect(w2.dropAt).not.toBe(w1.dropAt);

            for (const lead of REMINDER_LEADS) {
              const oldKey = ledgerKey(w1.kind, w1.dropAt, lead);
              const newKey = ledgerKey(w2.kind, w2.dropAt, lead);
              expect(newKey).not.toBe(oldKey);

              // Pre-shift claimed key does not suppress the shifted window
              const preShiftClaimed = new Set([oldKey]);
              const fireAt = reminderFireAt(w2, lead);
              const nowMs = Date.parse(fireAt);
              const env: ReminderEnv = {
                nowMs,
                today: wdwToday(new Date(nowMs)),
                leads: [lead],
                catchupMs: 180 * 60 * 1000,
              };

              const due = deriveDueReminders([w2], new Set(), preShiftClaimed, env);
              expect(due.length).toBe(1);
              expect(due[0]!.dropAt).toBe(w2.dropAt);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 28: Every due reminder belongs to a Trip the pass evaluates (horizon soundness)
  it('Property 28: Every due reminder belongs to a Trip the pass evaluates (horizon soundness)', () => {
    // Assert horizon literal requirements
    expect(reminderHorizonDays(['eve', 'open'])).toBe(61);
    expect(reminderHorizonDays(['eve', 'open', 'week'])).toBe(67);

    fc.assert(
      fc.property(
        tripInputArb,
        fc.subarray([...REMINDER_LEADS], { minLength: 1 }),
        fc.integer({ min: -80, max: 20 }),
        (trip, leads, dayOffset) => {
          const timeline = deriveBookingTimeline(trip);
          if (timeline.windows.length === 0) return;

          const now = new Date(
            Date.parse(timeline.windows[0]!.dropAt) + dayOffset * 86_400_000
          );
          const today = wdwToday(now);
          const horizonDate = reminderHorizonDate(today, leads);

          const env: ReminderEnv = {
            nowMs: now.getTime(),
            today,
            leads,
            catchupMs: 180 * 60 * 1000,
          };

          const due = deriveDueReminders(timeline.windows, new Set(), new Set(), env);
          if (due.length > 0) {
            // Must satisfy candidate trip predicate
            const isCand = isCandidateTrip(
              {
                startDate: trip.startDate,
                endDate: trip.endDate,
                checkInOverride: trip.settings?.checkInOverride ?? null,
              },
              today,
              horizonDate
            );
            expect(isCand).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('inSendWindow correctly checks bounds', () => {
    expect(inSendWindow(360, 360, 1380)).toBe(true); // 06:00 inclusive
    expect(inSendWindow(1380, 360, 1380)).toBe(false); // 23:00 exclusive
    expect(inSendWindow(359, 360, 1380)).toBe(false); // 05:59
  });

  describe('coalescing and recipients', () => {
    // Feature: trip-booking-timeline, Property 17: Coalescing conserves reminders and respects kind and range rules
    it('Property 17: Coalescing conserves reminders and respects kind and range rules', () => {
      const dueReminderArb: fc.Arbitrary<DueReminder> = fc.record({
        windowKey: fc.string({ minLength: 1 }),
        kind: fc.constantFrom<WindowKind>('dining', 'lightning_lane'),
        dropOn: fc.constant('2025-06-01'),
        dropAt: fc.constantFrom('2025-06-01T10:00:00.000Z', '2025-06-01T11:00:00.000Z'),
        lead: fc.constantFrom<ReminderLead>('eve', 'open', 'week'),
        fireAt: fc.constant('2025-05-31T20:00:00.000Z'),
        firstCovered: fc.constantFrom('2025-06-10', '2025-06-12'),
        lastCovered: fc.constantFrom('2025-06-15', '2025-06-20'),
      });

      fc.assert(
        fc.property(
          fc.array(dueReminderArb, { minLength: 1, maxLength: 10 }),
          reminders => {
            const groups = coalesceReminders(reminders);

            // Sum of reminderCount equals input length
            const totalCount = groups.reduce((acc, g) => acc + g.reminderCount, 0);
            expect(totalCount).toBe(reminders.length);

            // At most one group per lead
            const leads = groups.map(g => g.lead);
            expect(new Set(leads).size).toBe(groups.length);

            for (const g of groups) {
              // <= 2 distinct kinds per group
              expect(g.windows.length).toBeLessThanOrEqual(2);

              // Dining before lightning_lane if both present
              if (g.windows.length === 2) {
                expect(g.windows[0]!.kind).toBe('dining');
                expect(g.windows[1]!.kind).toBe('lightning_lane');
              }

              // Entry range spans min(firstCovered) to max(lastCovered) of that kind
              for (const kw of g.windows) {
                const ofKind = reminders.filter(r => r.lead === g.lead && r.kind === kw.kind);
                const minFirst = ofKind.map(r => r.firstCovered).sort()[0]!;
                const maxLast = ofKind.map(r => r.lastCovered).sort().reverse()[0]!;
                expect(kw.firstCovered).toBe(minFirst);
                expect(kw.lastCovered).toBe(maxLast);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    // Feature: trip-booking-timeline, Property 18: Recipients are the Trip's members minus its muted members
    it('Property 18: Recipients are the Trip\'s members minus its muted members', () => {
      fc.assert(
        fc.property(
          fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
          fc.array(fc.uuid(), { minLength: 0, maxLength: 10 }),
          (members, muted) => {
            const recipients = selectRecipients(members, muted);

            // Sorted without duplicates
            for (let i = 0; i < recipients.length - 1; i++) {
              expect(recipients[i]!.localeCompare(recipients[i + 1]!)).toBeLessThan(0);
            }

            const mutedSet = new Set(muted);
            for (const r of recipients) {
              expect(members).toContain(r);
              expect(mutedSet.has(r)).toBe(false);
            }

            for (const m of members) {
              if (!mutedSet.has(m)) {
                expect(recipients).toContain(m);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
