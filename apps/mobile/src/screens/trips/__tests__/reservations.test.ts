import type { PlannedItemDTO } from '@dwt/shared';

import {
  countReservations,
  etWallClockToIso,
  formatGroupDate,
  groupReservationsByDate,
  isoToEtWallClock,
  isReservation,
  RESERVATION_KIND_ICONS,
  reservationKindPresentation,
  reservationTitle,
} from '../reservations';

function item(overrides: Partial<PlannedItemDTO> = {}): PlannedItemDTO {
  return {
    id: 'item-1',
    experienceId: 'exp-1',
    experienceName: 'Be Our Guest',
    park: 'Magic Kingdom',
    customTitle: null,
    addedByDisplayName: 'Ada',
    plannedDate: '2026-10-01',
    plannedTime: '2026-10-01T22:00:00.000Z',
    isFixed: true,
    isLightningLane: false,
    useSingleRider: false,
    priority: 2,
    itemType: 'experience',
    durationMinutes: 60,
    windowStartMinutes: null,
    windowEndMinutes: null,
    mealPeriod: null,
    scheduledShowtime: null,
    predictedWaitMinutes: null,
    travelFromPrev: null,
    optimizedAt: null,
    reservationKind: 'dining',
    confirmationNumber: 'ABC123456',
    partySize: 4,
    ...overrides,
  };
}

describe('isReservation (R1.3)', () => {
  it('is true only when a kind is present', () => {
    expect(isReservation(item({ reservationKind: 'dining' }))).toBe(true);
    expect(isReservation(item({ reservationKind: 'lightning_lane' }))).toBe(true);
    expect(isReservation(item({ reservationKind: null }))).toBe(false);
  });

  it('is false for a self-pinned fixed item with no kind', () => {
    // The distinction the whole feature rests on: a pinned time is not a booking.
    const selfPinned = item({
      reservationKind: null,
      isFixed: true,
      plannedTime: '2026-10-01T18:00:00.000Z',
    });
    expect(isReservation(selfPinned)).toBe(false);
  });
});

describe('groupReservationsByDate (R2.1, R2.4, R2.7)', () => {
  it('returns no groups for an empty list', () => {
    expect(groupReservationsByDate([])).toEqual([]);
  });

  it('excludes items with a null reservationKind', () => {
    const groups = groupReservationsByDate([
      item({ id: 'a', reservationKind: null }),
      item({ id: 'b', reservationKind: 'dining' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['b']);
  });

  it('emits no group at all when nothing is a reservation', () => {
    const groups = groupReservationsByDate([
      item({ id: 'a', reservationKind: null }),
      item({ id: 'b', reservationKind: null }),
    ]);
    expect(groups).toEqual([]);
  });

  it('groups a single date into one group', () => {
    const groups = groupReservationsByDate([
      item({ id: 'a', plannedTime: '2026-10-01T22:00:00.000Z' }),
      item({ id: 'b', plannedTime: '2026-10-01T14:00:00.000Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.date).toBe('2026-10-01');
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('orders groups by date ascending even when the input is out of order', () => {
    const groups = groupReservationsByDate([
      item({ id: 'c', plannedDate: '2026-10-05', plannedTime: '2026-10-05T14:00:00.000Z' }),
      item({ id: 'a', plannedDate: '2026-10-01', plannedTime: '2026-10-01T14:00:00.000Z' }),
      item({ id: 'b', plannedDate: '2026-10-03', plannedTime: '2026-10-03T14:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-01', '2026-10-03', '2026-10-05']);
  });

  it('orders items within a group by Booked_Time ascending', () => {
    const groups = groupReservationsByDate([
      item({ id: 'dinner', plannedTime: '2026-10-01T23:00:00.000Z' }),
      item({ id: 'breakfast', plannedTime: '2026-10-01T12:00:00.000Z' }),
      item({ id: 'lunch', plannedTime: '2026-10-01T17:00:00.000Z' }),
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('breaks a Booked_Time tie stably by id', () => {
    const sameMinute = '2026-10-01T18:00:00.000Z';
    const forward = groupReservationsByDate([
      item({ id: 'zeta', plannedTime: sameMinute }),
      item({ id: 'alpha', plannedTime: sameMinute }),
    ]);
    const reversed = groupReservationsByDate([
      item({ id: 'alpha', plannedTime: sameMinute }),
      item({ id: 'zeta', plannedTime: sameMinute }),
    ]);
    expect(forward[0]!.items.map((i) => i.id)).toEqual(['alpha', 'zeta']);
    expect(reversed[0]!.items.map((i) => i.id)).toEqual(['alpha', 'zeta']);
  });

  it('keeps a reservation dated outside the trip range in its own group (R2.7)', () => {
    // This function is deliberately unaware of the Trip's start/end dates.
    const groups = groupReservationsByDate([
      item({ id: 'in', plannedDate: '2026-10-01', plannedTime: '2026-10-01T14:00:00.000Z' }),
      item({ id: 'out', plannedDate: '2027-01-15', plannedTime: '2027-01-15T14:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(['2026-10-01', '2027-01-15']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['out']);
  });

  it('skips a malformed reservation with no date rather than creating an untitled group', () => {
    const groups = groupReservationsByDate([
      item({ id: 'ok' }),
      item({ id: 'no-date', plannedDate: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['ok']);
  });

  it('sorts a reservation with an unparseable time last instead of scrambling the group', () => {
    const groups = groupReservationsByDate([
      item({ id: 'broken', plannedTime: 'not-a-timestamp' }),
      item({ id: 'good', plannedTime: '2026-10-01T14:00:00.000Z' }),
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['good', 'broken']);
  });

  it('does not mutate the input array or its order', () => {
    const input = [
      item({ id: 'b', plannedTime: '2026-10-01T23:00:00.000Z' }),
      item({ id: 'a', plannedTime: '2026-10-01T12:00:00.000Z' }),
    ];
    const snapshot = input.map((i) => i.id);
    groupReservationsByDate(input);
    expect(input.map((i) => i.id)).toEqual(snapshot);
  });
});

describe('countReservations', () => {
  it('totals items across groups', () => {
    const groups = groupReservationsByDate([
      item({ id: 'a', plannedDate: '2026-10-01', plannedTime: '2026-10-01T14:00:00.000Z' }),
      item({ id: 'b', plannedDate: '2026-10-01', plannedTime: '2026-10-01T18:00:00.000Z' }),
      item({ id: 'c', plannedDate: '2026-10-02', plannedTime: '2026-10-02T14:00:00.000Z' }),
    ]);
    expect(countReservations(groups)).toBe(3);
  });

  it('is zero for no groups', () => {
    expect(countReservations([])).toBe(0);
  });
});

describe('reservationKindPresentation (R2.3)', () => {
  it('gives every kind a distinct icon AND a text label', () => {
    const dining = reservationKindPresentation('dining');
    const ll = reservationKindPresentation('lightning_lane');
    const activity = reservationKindPresentation('activity');
    const other = reservationKindPresentation('other');

    expect(dining).toEqual({ icon: 'restaurant-outline', label: 'Dining' });
    expect(ll).toEqual({ icon: 'flash-outline', label: 'Lightning Lane' });
    expect(activity).toEqual({ icon: 'ticket-outline', label: 'Activity' });
    expect(other).toEqual({ icon: 'bookmark-outline', label: 'Reservation' });

    // Every kind carries a non-empty label, so kind is never icon/color-only.
    for (const p of [dining, ll, activity, other]) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.icon.length).toBeGreaterThan(0);
    }
  });

  it('falls back to the neutral presentation for an unknown kind', () => {
    const unknown = reservationKindPresentation('time_travel' as never);
    expect(unknown).toEqual({ icon: RESERVATION_KIND_ICONS.other, label: 'Reservation' });
  });
});

describe('reservationTitle (R2.2, R5.2)', () => {
  it('prefers the catalog Experience name', () => {
    expect(reservationTitle(item({ experienceName: 'Ohana', customTitle: 'ignored' }))).toBe(
      'Ohana',
    );
  });

  it('falls back to the custom title for a non-catalog reservation', () => {
    const offProperty = item({
      experienceId: null,
      experienceName: null,
      itemType: 'break',
      customTitle: 'Off-property steakhouse',
    });
    expect(reservationTitle(offProperty)).toBe('Off-property steakhouse');
  });

  it('labels an untitled non-catalog reservation by its kind, never as a break (R5.2)', () => {
    const untitled = item({
      experienceId: null,
      experienceName: null,
      itemType: 'break',
      customTitle: null,
      reservationKind: 'dining',
    });
    expect(reservationTitle(untitled)).toBe('Dining');
    expect(reservationTitle(untitled)).not.toMatch(/break/iu);
  });

  it('treats whitespace-only names as absent', () => {
    expect(
      reservationTitle(item({ experienceName: '   ', customTitle: 'Real Title' })),
    ).toBe('Real Title');
    expect(
      reservationTitle(
        item({ experienceName: null, customTitle: '  ', reservationKind: 'activity' }),
      ),
    ).toBe('Activity');
  });
});

describe('etWallClockToIso — park-local wall clock to UTC instant', () => {
  it('converts a summer (EDT, UTC-4) time', () => {
    // 6:30 PM ET on Oct 1 2026 is 22:30Z.
    expect(etWallClockToIso('2026-10-01', '18:30')).toBe('2026-10-01T22:30:00.000Z');
  });

  it('converts a winter (EST, UTC-5) time — DST is handled, not hardcoded', () => {
    // 6:30 PM ET on Jan 15 2027 is 23:30Z, an hour later in UTC than the EDT case.
    expect(etWallClockToIso('2027-01-15', '18:30')).toBe('2027-01-15T23:30:00.000Z');
  });

  it('accepts a single-digit hour', () => {
    expect(etWallClockToIso('2026-10-01', '9:15')).toBe('2026-10-01T13:15:00.000Z');
  });

  it('handles midnight and the last minute of the day', () => {
    expect(etWallClockToIso('2026-10-01', '00:00')).toBe('2026-10-01T04:00:00.000Z');
    expect(etWallClockToIso('2026-10-01', '23:59')).toBe('2026-10-02T03:59:00.000Z');
  });

  it('trims surrounding whitespace', () => {
    expect(etWallClockToIso('2026-10-01', '  18:30  ')).toBe('2026-10-01T22:30:00.000Z');
  });

  it('returns null for a malformed time', () => {
    for (const bad of ['', 'half six', '18', '18:5', '1830', '18:30:00', '25:00', '18:75']) {
      expect(etWallClockToIso('2026-10-01', bad)).toBeNull();
    }
  });

  it('returns null for a malformed date', () => {
    for (const bad of ['', '2026-10', '10/01/2026', 'tomorrow']) {
      expect(etWallClockToIso(bad, '18:30')).toBeNull();
    }
  });

  it('round-trips with isoToEtWallClock across a DST boundary', () => {
    for (const date of ['2026-10-01', '2027-01-15', '2027-06-30']) {
      for (const time of ['00:00', '09:15', '18:30', '23:59']) {
        const iso = etWallClockToIso(date, time)!;
        expect(iso).not.toBeNull();
        // A single-digit hour normalizes to two digits on the way back.
        const expected = time.length === 5 ? time : `0${time}`;
        expect(isoToEtWallClock(iso)).toBe(expected);
      }
    }
  });
});

describe('isoToEtWallClock — UTC instant to park-local HH:MM', () => {
  it('renders an instant as park-local 24-hour time', () => {
    expect(isoToEtWallClock('2026-10-01T22:00:00.000Z')).toBe('18:00');
  });

  it('renders midnight ET as 00:00, not 24:00', () => {
    expect(isoToEtWallClock('2026-10-01T04:00:00.000Z')).toBe('00:00');
  });

  it('returns an empty string for an absent or unparseable value', () => {
    expect(isoToEtWallClock(null)).toBe('');
    expect(isoToEtWallClock(undefined)).toBe('');
    expect(isoToEtWallClock('')).toBe('');
    expect(isoToEtWallClock('not-a-timestamp')).toBe('');
  });
});

describe('formatGroupDate', () => {
  it('formats a calendar date as a weekday heading', () => {
    expect(formatGroupDate('2026-10-01')).toBe('Thu, Oct 1');
    expect(formatGroupDate('2026-10-03')).toBe('Sat, Oct 3');
  });

  it('does not shift the day for a date at either end of the month', () => {
    expect(formatGroupDate('2026-10-31')).toBe('Sat, Oct 31');
    expect(formatGroupDate('2026-11-01')).toBe('Sun, Nov 1');
  });

  it('passes a malformed value through unchanged rather than throwing', () => {
    expect(formatGroupDate('not-a-date')).toBe('not-a-date');
  });
});
