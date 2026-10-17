import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseReminderLeads, parseClockMinutes } from '../reminderConfig.js';
import { deriveDueReminders, type ReminderEnv } from '../reminders.js';
import { deriveBookingTimeline, type TimelineTripInput } from '../timeline.js';
import { REMINDER_LEADS } from '@dwt/shared';

describe('reminderConfig.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 14: Enabled-lead parsing ignores unknown tokens and an empty set derives nothing
  it('Property 14: Enabled-lead parsing ignores unknown tokens and an empty set derives nothing', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            fc.constantFrom('eve', 'EVE', ' open ', 'WEEK', 'Week', 'Open'),
            fc.string({ minLength: 1, maxLength: 10 })
          )
        ),
        tokens => {
          const raw = tokens.join(',');
          const parsed = parseReminderLeads(raw);

          // Every parsed item is in REMINDER_LEADS
          for (const item of parsed) {
            expect(REMINDER_LEADS).toContain(item);
          }

          // No duplicates
          expect(new Set(parsed).size).toBe(parsed.length);

          // Canonical order
          let lastIndex = -1;
          for (const item of parsed) {
            const idx = REMINDER_LEADS.indexOf(item);
            expect(idx).toBeGreaterThan(lastIndex);
            lastIndex = idx;
          }

          // Case and whitespace tolerance
          const normalizedTokens = tokens.map(t => t.trim().toLowerCase());
          for (const lead of REMINDER_LEADS) {
            if (normalizedTokens.includes(lead)) {
              expect(parsed).toContain(lead);
            }
          }
        }
      ),
      { numRuns: 100 }
    );

    // Empty leads set derives nothing for any input
    const trip: TimelineTripInput = {
      startDate: '2025-06-14',
      endDate: '2025-06-20',
      hasResortStay: true,
      settings: null,
    };
    const timeline = deriveBookingTimeline(trip);
    const env: ReminderEnv = {
      nowMs: Date.parse(timeline.windows[0]!.dropAt),
      today: '2025-04-15',
      leads: parseReminderLeads(''), // empty
      catchupMs: 180 * 60 * 1000,
    };
    const due = deriveDueReminders(timeline.windows, new Set(), new Set(), env);
    expect(due).toEqual([]);
  });

  it('unit examples for parseReminderLeads and parseClockMinutes', () => {
    expect(parseReminderLeads('eve, OPEN ,bogus,eve')).toEqual(['eve', 'open']);
    expect(parseReminderLeads('')).toEqual([]);
    expect(parseReminderLeads('   ')).toEqual([]);

    expect(parseClockMinutes('06:00')).toBe(360);
    expect(parseClockMinutes('07:30')).toBe(450);
    expect(parseClockMinutes('23:59')).toBe(1439);
    expect(parseClockMinutes('00:00')).toBe(0);

    expect(parseClockMinutes('24:00')).toBeNull();
    expect(parseClockMinutes('6:0')).toBeNull();
    expect(parseClockMinutes('abc')).toBeNull();
    expect(parseClockMinutes('')).toBeNull();
  });
});
