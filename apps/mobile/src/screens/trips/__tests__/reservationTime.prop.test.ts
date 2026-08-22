// Feature: trip-reservations, Property 8: A picked park-local time round-trips to the correct UTC instant

import fc from 'fast-check';

import { etWallClockToIso, isoToWheelTime } from '../reservations';
import { WHEEL_HOURS, wheelMinutes } from '../../../components/TimeWheelPicker';

const NUM_RUNS = 200;

const hourArb = fc.constantFrom(...WHEEL_HOURS);
const minuteArb = fc.constantFrom(...wheelMinutes(5));
const meridiemArb = fc.constantFrom('AM', 'PM');

/** An EDT date (UTC-4) and an EST date (UTC-5), so DST is exercised both ways. */
const dateArb = fc.constantFrom('2026-08-21', '2026-10-01', '2027-01-15', '2027-06-30');

/** Expected UTC hour for a park-local 12-hour selection, given the ET offset. */
function expectedUtcHour(hour12: number, meridiem: string, offsetHours: number): number {
  let h = hour12 % 12;
  if (meridiem === 'PM') h += 12;
  return (h - offsetHours + 24) % 24;
}

/** ET offset in hours for a date: -4 during EDT, -5 during EST. */
function etOffsetHours(dateString: string): number {
  // Derived the same way the implementation does, from Intl, so the test does
  // not hardcode a DST calendar.
  const anchor = new Date(`${dateString}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(anchor);
  const hour = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '12', 10);
  return (hour === 24 ? 0 : hour) - 12;
}

describe('Property 8: A picked park-local time round-trips to the correct UTC instant', () => {
  it('converts every hour / 5-minute step / meridiem to the right UTC instant', () => {
    fc.assert(
      fc.property(dateArb, hourArb, minuteArb, meridiemArb, (date, hour, minute, meridiem) => {
        const iso = etWallClockToIso(date, `${hour}:${minute} ${meridiem}`);
        expect(iso).not.toBeNull();

        const parsed = new Date(iso!);
        const offset = etOffsetHours(date);
        expect(parsed.getUTCHours()).toBe(
          expectedUtcHour(Number.parseInt(hour, 10), meridiem, offset),
        );
        expect(parsed.getUTCMinutes()).toBe(Number.parseInt(minute, 10));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('round-trips a selection through the instant and back unchanged', () => {
    fc.assert(
      fc.property(dateArb, hourArb, minuteArb, meridiemArb, (date, hour, minute, meridiem) => {
        const selection = `${hour}:${minute} ${meridiem}`;
        const iso = etWallClockToIso(date, selection)!;
        expect(isoToWheelTime(iso)).toBe(selection);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('never converts a PM selection to its AM instant — the defect that prompted the picker', () => {
    fc.assert(
      fc.property(dateArb, hourArb, minuteArb, (date, hour, minute) => {
        const am = etWallClockToIso(date, `${hour}:${minute} AM`)!;
        const pm = etWallClockToIso(date, `${hour}:${minute} PM`)!;
        expect(am).not.toBe(pm);
        // PM is always exactly 12 hours after AM for the same clock face.
        expect(new Date(pm).getTime() - new Date(am).getTime()).toBe(12 * 60 * 60 * 1000);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('maps 12 AM to midnight and 12 PM to noon park time, not the reverse', () => {
    fc.assert(
      fc.property(dateArb, minuteArb, (date, minute) => {
        expect(isoToWheelTime(etWallClockToIso(date, `12:${minute} AM`)!)).toBe(
          `12:${minute} AM`,
        );
        expect(isoToWheelTime(etWallClockToIso(date, `12:${minute} PM`)!)).toBe(
          `12:${minute} PM`,
        );
        // Midnight ET is strictly earlier in the day than noon ET.
        const midnight = new Date(etWallClockToIso(date, `12:${minute} AM`)!).getTime();
        const noon = new Date(etWallClockToIso(date, `12:${minute} PM`)!).getTime();
        expect(midnight).toBeLessThan(noon);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a 12-hour value whose hour is out of range rather than coercing it', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.integer({ min: 13, max: 99 }),
        minuteArb,
        meridiemArb,
        (date, hour, minute, meridiem) => {
          expect(etWallClockToIso(date, `${hour}:${minute} ${meridiem}`)).toBeNull();
        },
      ),
      { numRuns: NUM_RUNS },
    );
    expect(etWallClockToIso('2026-10-01', '0:30 AM')).toBeNull();
  });

  it('still accepts the 24-hour form for backward compatibility', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 0, max: 23 }), minuteArb, (date, hour, minute) => {
        const iso = etWallClockToIso(date, `${String(hour).padStart(2, '0')}:${minute}`);
        expect(iso).not.toBeNull();
        const offset = etOffsetHours(date);
        expect(new Date(iso!).getUTCHours()).toBe((hour - offset + 24) % 24);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
