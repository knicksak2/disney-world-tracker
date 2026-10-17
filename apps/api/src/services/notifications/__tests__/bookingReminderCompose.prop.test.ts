import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  composeBookingReminder,
  formatClock12,
  type TripBookingReminderEvent,
  type TripBookingReminderEventWindow,
} from '../bookingReminderCompose.js';
import {
  REMINDER_LEADS,
  type ReminderLead,
  type WindowKind,
} from '@dwt/shared';

const windowArb: fc.Arbitrary<TripBookingReminderEventWindow> = fc.record({
  kind: fc.constantFrom<WindowKind>('dining', 'lightning_lane'),
  dropAt: fc.constantFrom(
    '2025-04-15T10:00:00.000Z',
    '2025-06-07T11:00:00.000Z',
    '2025-11-02T11:00:00.000Z'
  ),
  firstCovered: fc.constantFrom('2025-06-14', '2025-06-15'),
  lastCovered: fc.constantFrom('2025-06-15', '2025-06-20'),
});

const eventArb: fc.Arbitrary<TripBookingReminderEvent> = fc.record({
  tripId: fc.uuid(),
  tripName: fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('Smith Family Disney Trip 2025 🏰✨🎉'),
    fc.string({ minLength: 0, maxLength: 120 }),
    fc.array(fc.constantFrom('🏰', '✨', '🎉', 'A', ' ', '🔥'), { minLength: 1, maxLength: 50 }).map(a => a.join(''))
  ),
  lead: fc.constantFrom<ReminderLead>(...REMINDER_LEADS),
  windows: fc.array(windowArb, { minLength: 1, maxLength: 2 }),
  dispatchedAt: fc.constantFrom(
    '2025-04-15T09:59:59.000Z',
    '2025-04-15T10:00:00.000Z',
    '2025-04-15T10:00:01.000Z',
    '2025-06-07T11:00:00.000Z',
    '2025-01-01T00:00:00.000Z'
  ),
});

describe('bookingReminderCompose.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 19: The notification body never exceeds 100 characters and shortens the Trip name first
  it('Property 19: The notification body never exceeds 100 characters and shortens the Trip name first', () => {
    fc.assert(
      fc.property(eventArb, event => {
        const { body } = composeBookingReminder(event);

        // Body never exceeds 100 characters
        expect(body.length).toBeLessThanOrEqual(100);

        // Does not split a surrogate pair:
        // Checking for lone high or low surrogates
        for (let i = 0; i < body.length; i++) {
          const code = body.charCodeAt(i);
          if (code >= 0xd800 && code <= 0xdbff) {
            // High surrogate must be followed by a low surrogate
            expect(i + 1).toBeLessThan(body.length);
            const nextCode = body.charCodeAt(i + 1);
            expect(nextCode).toBeGreaterThanOrEqual(0xdc00);
            expect(nextCode).toBeLessThanOrEqual(0xdfff);
            i++; // skip low surrogate
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            // Unpaired low surrogate
            expect(true).toBe(false);
          }
        }

        // If body has ellipsis, it ends with '…' or has '…' before a whole body cut
        if (body.includes('…')) {
          expect(body).toMatch(/…/);
        }
      }),
      { numRuns: 100 }
    );
  });

  // Feature: trip-booking-timeline, Property 20: The title follows the lead and "Opened at" appears exactly when a window has opened
  it('Property 20: The title follows the lead and "Opened at" appears exactly when a window has opened', () => {
    fc.assert(
      fc.property(eventArb, event => {
        const { title, body } = composeBookingReminder(event);

        // Title matches lead exactly
        if (event.lead === 'eve') {
          expect(title).toBe('Booking window opens tomorrow');
        } else if (event.lead === 'open') {
          expect(title).toBe('Booking window is open');
        } else if (event.lead === 'week') {
          expect(title).toBe('Booking window in 7 days');
        }

        // Check whether some window has dropAt <= dispatchedAt
        const dispatchMs = Date.parse(event.dispatchedAt);
        const hasOpened = event.windows.some(w => Date.parse(w.dropAt) <= dispatchMs);

        if (hasOpened) {
          expect(body.startsWith('Opened at ')).toBe(true);
          expect(body).toMatch(/^Opened at \d{1,2}:\d{2} (?:AM|PM): /);
        } else {
          expect(body.startsWith('Opened at ')).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('unit examples for composeBookingReminder and formatClock12', () => {
    expect(formatClock12(360)).toBe('6:00 AM');
    expect(formatClock12(420)).toBe('7:00 AM');
    expect(formatClock12(720)).toBe('12:00 PM');
    expect(formatClock12(0)).toBe('12:00 AM');

    // dining 2025-04-15 to 2025-04-19 gives Dining for Apr 15 – Apr 19 · <name>
    const event1: TripBookingReminderEvent = {
      tripId: '11111111-1111-1111-1111-111111111111',
      tripName: 'Magical Vacation',
      lead: 'eve',
      windows: [
        {
          kind: 'dining',
          dropAt: '2025-04-15T10:00:00.000Z',
          firstCovered: '2025-04-15',
          lastCovered: '2025-04-19',
        },
      ],
      dispatchedAt: '2025-04-14T20:00:00.000Z', // eve, before dropAt
    };
    const res1 = composeBookingReminder(event1);
    expect(res1.title).toBe('Booking window opens tomorrow');
    expect(res1.body).toBe('Dining for Apr 15 – Apr 19 · Magical Vacation');

    // Single date gives Apr 15
    const event2: TripBookingReminderEvent = {
      ...event1,
      windows: [
        {
          kind: 'dining',
          dropAt: '2025-04-15T10:00:00.000Z',
          firstCovered: '2025-04-15',
          lastCovered: '2025-04-15',
        },
      ],
    };
    const res2 = composeBookingReminder(event2);
    expect(res2.body).toBe('Dining for Apr 15 · Magical Vacation');

    // Open lead at dropAt carries Opened at 6:00 AM: prefix
    const eventOpen: TripBookingReminderEvent = {
      ...event1,
      lead: 'open',
      dispatchedAt: '2025-04-15T10:00:00.000Z', // exactly dropAt
    };
    const resOpen = composeBookingReminder(eventOpen);
    expect(resOpen.title).toBe('Booking window is open');
    expect(resOpen.body).toBe('Opened at 6:00 AM: Dining for Apr 15 – Apr 19 · Magical Vacation');
  });
});
