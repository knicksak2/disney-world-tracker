/**
 * Unit tests for the pure Stays view helpers (trip-lodging-stays tasks 8.2 and 8.3).
 *
 * Validates: Requirements 7.1, 7.3, 7.5, 7.6, 6.2, 6.4
 */

import type { TripStayDTO } from '@dwt/shared';

import {
  compactStayCaption,
  draftToInput,
  glanceLodgingName,
  hubStaySummary,
  newStayDates,
  newStayDraft,
  nightsLabel,
  partyLabel,
  shortStayDatesAndNights,
  shortStayDatesLabel,
  shortStayName,
  stayDatesLabel,
  stayToDraft,
  stayWarningText,
  staysAfterRemove,
  staysAfterSave,
  validateStayDraft,
  type StayDraft,
} from '../tripStaysView';

function stay(over: Partial<TripStayDTO>): TripStayDTO {
  return {
    id: 's1',
    position: 0,
    lodgingKind: 'resort',
    resortId: 'r1',
    placeName: null,
    displayName: 'Beach Club',
    checkIn: '2027-12-15',
    checkOut: '2027-12-20',
    nights: 5,
    partyKeys: null,
    ...over,
  };
}

describe('newStayDates (R7.6)', () => {
  it('uses the Trip start and end when there are no stays', () => {
    expect(newStayDates([], '2027-12-15', '2027-12-31')).toEqual({ checkIn: '2027-12-15', checkOut: '2027-12-31' });
  });

  it('starts at the latest check-out among dated stays, ignoring undated ones', () => {
    const stays = [
      stay({ checkIn: '2027-12-20', checkOut: '2027-12-26' }),
      stay({ checkIn: '2027-12-15', checkOut: '2027-12-20' }),
      stay({ checkIn: null, checkOut: null }),
    ];
    expect(newStayDates(stays, '2027-12-15', '2027-12-31')).toEqual({ checkIn: '2027-12-26', checkOut: '2027-12-31' });
  });

  it('leaves check-out unset when the stays already reach the Trip end', () => {
    expect(newStayDates([stay({ checkOut: '2027-12-31' })], '2027-12-15', '2027-12-31')).toEqual({
      checkIn: '2027-12-31',
      checkOut: '',
    });
  });

  it('a new draft is a Disney Resort stay for everyone', () => {
    expect(newStayDraft([], '2027-12-15', '2027-12-31')).toEqual({
      lodgingKind: 'resort',
      resortId: null,
      placeName: '',
      partyKeys: null,
      checkIn: '2027-12-15',
      checkOut: '2027-12-31',
    });
  });
});

describe('validateStayDraft', () => {
  const ok: StayDraft = { lodgingKind: 'resort', resortId: 'r1', placeName: '', checkIn: '', checkOut: '', partyKeys: null };
  it.each([
    [{ resortId: null }, 'Choose the Disney Resort.'],
    [{ lodgingKind: 'offsite', resortId: null, placeName: '   ' }, 'Enter the name of the place you are staying.'],
    [{ lodgingKind: 'partner_hotel', resortId: null, placeName: 'x'.repeat(101) }, 'The name can be at most 100 characters.'],
    [{ checkIn: '2027-12-15' }, 'Set both the check-in and check-out dates, or neither.'],
    [{ checkIn: '2027-12-15', checkOut: '2027-12-15' }, 'Check-out must be after check-in.'],
    [{ partyKeys: [] }, 'Choose who is staying, or pick Everyone.'],
  ] as [Partial<StayDraft>, string][])('rejects %o', (patch, message) => {
    expect(validateStayDraft({ ...ok, ...patch })).toBe(message);
  });

  it('accepts a complete resort stay and an undated off-site stay', () => {
    expect(validateStayDraft({ ...ok, checkIn: '2027-12-15', checkOut: '2027-12-16' })).toBeNull();
    expect(validateStayDraft({ ...ok, lodgingKind: 'offsite', resortId: null, placeName: 'Aunt May' })).toBeNull();
  });
});

describe('draftToInput and the list helpers', () => {
  it('drops the fields that do not apply to the kind and trims the name', () => {
    expect(
      draftToInput({ lodgingKind: 'offsite', resortId: 'r1', placeName: ' Aunt May ', checkIn: '', checkOut: '', partyKeys: ['m:a'] }),
    ).toEqual({ lodgingKind: 'offsite', placeName: 'Aunt May', partyKeys: ['m:a'] });
    expect(
      draftToInput({ id: 's1', lodgingKind: 'resort', resortId: 'r1', placeName: 'ignored', checkIn: '2027-12-15', checkOut: '2027-12-20', partyKeys: null }),
    ).toEqual({ id: 's1', lodgingKind: 'resort', resortId: 'r1', checkIn: '2027-12-15', checkOut: '2027-12-20', partyKeys: null });
  });

  it('stayToDraft then draftToInput round-trips a stored stay', () => {
    const s = stay({ id: 's9', lodgingKind: 'partner_hotel', resortId: null, placeName: 'Swan', partyKeys: ['g:x'] });
    expect(draftToInput(stayToDraft(s))).toEqual({
      id: 's9',
      lodgingKind: 'partner_hotel',
      placeName: 'Swan',
      checkIn: '2027-12-15',
      checkOut: '2027-12-20',
      partyKeys: ['g:x'],
    });
  });

  it('staysAfterSave replaces the stay with the draft id in place, or appends a new one', () => {
    const a = stay({ id: 'a' });
    const b = stay({ id: 'b', checkIn: '2027-12-20', checkOut: '2027-12-26' });
    const edited = staysAfterSave([a, b], { ...stayToDraft(a), checkOut: '2027-12-18' });
    expect(edited.map((s) => [s.id, s.checkOut])).toEqual([
      ['a', '2027-12-18'],
      ['b', '2027-12-26'],
    ]);
    const added = staysAfterSave([a], { lodgingKind: 'offsite', resortId: null, placeName: 'X', checkIn: '', checkOut: '', partyKeys: null });
    expect(added.map((s) => s.id)).toEqual(['a', undefined]);
  });

  it('staysAfterRemove keeps every other stay with its id', () => {
    expect(staysAfterRemove([stay({ id: 'a' }), stay({ id: 'b' })], 'a').map((s) => s.id)).toEqual(['b']);
  });
});

describe('card text (R7.1, R7.3)', () => {
  it('dates, nights, shortStayDatesLabel, shortStayDatesAndNights, compactStayCaption and the undated case', () => {
    expect(stayDatesLabel(stay({}))).toBe('Dec 15 to Dec 20');
    expect(stayDatesLabel(stay({ checkIn: null, checkOut: null }))).toBe('Dates not set');
    expect(shortStayDatesLabel(stay({ checkIn: '2027-12-15', checkOut: '2027-12-20' }))).toBe('Dec 15\u201320');
    expect(shortStayDatesLabel(stay({ checkIn: '2027-12-28', checkOut: '2028-01-03' }))).toBe('Dec 28\u2013Jan 3');
    expect(shortStayDatesLabel(stay({ checkIn: null, checkOut: null }))).toBe('Dates not set');
    expect(shortStayDatesAndNights(stay({ checkIn: '2027-12-15', checkOut: '2027-12-16', nights: 1 }))).toBe('Dec 15\u201316 \u00b7 1n');
    expect(shortStayDatesAndNights(stay({ checkIn: '2027-12-28', checkOut: '2028-01-03', nights: 6 }))).toBe('Dec 28\u2013Jan 3 \u00b7 6n');
    expect(shortStayDatesAndNights(stay({ checkIn: null, checkOut: null, nights: null }))).toBe('Dates not set');
    const people = [
      { key: 'm:1', name: 'A' },
      { key: 'm:2', name: 'B' },
      { key: 'g:1', name: 'C' },
    ];
    expect(compactStayCaption(stay({ lodgingKind: 'resort', partyKeys: null }), people)).toBeNull();
    expect(compactStayCaption(stay({ lodgingKind: 'partner_hotel', partyKeys: null }), people)).toBe('Partner hotel');
    expect(compactStayCaption(stay({ lodgingKind: 'resort', partyKeys: ['m:1', 'g:1'] }), people)).toBe('2 of 3 people');
    expect(compactStayCaption(stay({ lodgingKind: 'offsite', partyKeys: ['m:1'] }), people)).toBe('Other lodging \u00b7 1 of 3 people');
    expect(nightsLabel(1)).toBe('1 night');
    expect(nightsLabel(5)).toBe('5 nights');
    expect(nightsLabel(null)).toBeNull();
  });

  it('shortStayName strips a leading "Disney\'s " prefix', () => {
    expect(shortStayName("Disney's All-Star Sports Resort")).toBe('All-Star Sports Resort');
    expect(shortStayName('Disney\u2019s Animal Kingdom Lodge')).toBe('Animal Kingdom Lodge');
    expect(shortStayName('Walt Disney World Swan Hotel')).toBe('Walt Disney World Swan Hotel');
    expect(shortStayName('Beach Club')).toBe('Beach Club');
  });

  it('hubStaySummary resolves pre-trip, tonight, check-in transfer day, and check-out day', () => {
    const s1 = stay({
      id: 's1',
      displayName: "Disney's All-Star Sports Resort",
      checkIn: '2026-12-15',
      checkOut: '2026-12-16',
      nights: 1,
    });
    const s2 = stay({
      id: 's2',
      displayName: "Disney's Animal Kingdom Lodge",
      checkIn: '2026-12-16',
      checkOut: '2026-12-23',
      nights: 7,
    });
    const s3 = stay({
      id: 's3',
      displayName: "Disney's Beach Club Resort",
      checkIn: '2026-12-23',
      checkOut: '2026-12-31',
      nights: 8,
    });
    const split = [s1, s2, s3];

    expect(hubStaySummary([], '2026-12-15')).toBeNull();

    // Pre-trip: shows first stay with its own dates (Dec 15–16) and STAYING AT (1 of 3 stays)
    expect(hubStaySummary(split, '2026-11-10')).toEqual({
      stay: s1,
      index: 0,
      total: 3,
      eyebrow: 'STAYING AT',
      countText: '(1 of 3 stays)',
      title: 'All-Star Sports Resort',
      datesPill: 'Dec 15\u201316',
      isCurrentToday: false,
    });

    // Night 1 (Dec 15): TONIGHT (1 of 3 stays)
    expect(hubStaySummary(split, '2026-12-15')).toMatchObject({
      stay: s1,
      eyebrow: 'TONIGHT',
      countText: '(1 of 3 stays)',
      title: 'All-Star Sports Resort',
      datesPill: 'Dec 15\u201316',
      isCurrentToday: true,
    });

    // Mid-trip (Dec 18): TONIGHT (2 of 3 stays) · Animal Kingdom Lodge · Dec 16–23
    expect(hubStaySummary(split, '2026-12-18')).toMatchObject({
      stay: s2,
      eyebrow: 'TONIGHT',
      countText: '(2 of 3 stays)',
      title: 'Animal Kingdom Lodge',
      datesPill: 'Dec 16\u201323',
      isCurrentToday: true,
    });

    // Transfer day (Dec 23): CHECK-IN TODAY (3 of 3 stays) · Beach Club Resort · Dec 23–31
    expect(hubStaySummary(split, '2026-12-23')).toMatchObject({
      stay: s3,
      eyebrow: 'CHECK-IN TODAY',
      countText: '(3 of 3 stays)',
      title: 'Beach Club Resort',
      datesPill: 'Dec 23\u201331',
      isCurrentToday: true,
    });

    // Final check-out day (Dec 31): CHECK-OUT TODAY (3 of 3 stays)
    expect(hubStaySummary(split, '2026-12-31')).toMatchObject({
      stay: s3,
      eyebrow: 'CHECK-OUT TODAY',
      countText: '(3 of 3 stays)',
      title: 'Beach Club Resort',
      isCurrentToday: true,
    });

    // Single stay: countText is null
    expect(hubStaySummary([s2], '2026-12-18')?.countText).toBeNull();
  });

  it('"N of M people" counts only people still on the Trip, and is absent for Everyone', () => {
    const people = [
      { key: 'm:a', name: 'A' },
      { key: 'm:b', name: 'B' },
      { key: 'g:c', name: 'C' },
    ];
    expect(partyLabel(null, people)).toBeNull();
    expect(partyLabel(['m:a', 'g:c'], people)).toBe('2 of 3 people');
    expect(partyLabel(['m:a', 'm:gone', 'm:a'], people)).toBe('1 of 3 people'); // stale and duplicate keys are inert
    expect(partyLabel(['m:a'], [{ key: 'm:a', name: 'A' }])).toBe('1 of 1 person');
  });

  it('warnings read as sentences and strip leading "Disney\'s "', () => {
    const stays = [stay({ id: 's1', displayName: "Disney's Beach Club" })];
    expect(stayWarningText({ code: 'gap', from: '2027-12-20', to: '2027-12-22' }, stays)).toBe(
      'Dec 20 to Dec 22 has no lodging recorded',
    );
    expect(stayWarningText({ code: 'trip_not_covered', from: '2027-12-26', to: '2027-12-31' }, stays)).toBe(
      'Dec 26 to Dec 31 has no lodging recorded',
    );
    expect(stayWarningText({ code: 'outside_trip', stayId: 's1' }, stays)).toBe('Beach Club has nights outside the trip dates');
    expect(stayWarningText({ code: 'unscheduled', stayId: 's1' }, stays)).toBe('Beach Club has no dates yet');
    expect(stayWarningText({ code: 'unscheduled', stayId: 'gone' }, stays)).toBe('A stay has no dates yet');
  });
});

describe('glanceLodgingName (R8)', () => {
  const trip = (stays: TripStayDTO[], resorts: { id: string; name: string }[] = []) => ({
    startDate: '2027-12-15',
    endDate: '2027-12-31',
    stays,
    resorts,
  });
  const pop = stay({ id: 'pop', displayName: 'Pop Century', checkIn: '2027-12-15', checkOut: '2027-12-20' });
  const riviera = stay({ id: 'riv', displayName: 'Riviera', checkIn: '2027-12-20', checkOut: '2027-12-26' });
  const aunt = stay({
    id: 'aunt',
    lodgingKind: 'offsite',
    resortId: null,
    placeName: 'Aunt May',
    displayName: 'Aunt May',
    checkIn: '2027-12-26',
    checkOut: '2027-12-31',
  });

  it("names the stay whose night is today", () => {
    expect(glanceLodgingName(trip([pop, riviera, aunt]), '2027-12-17')).toBe('Pop Century');
    expect(glanceLodgingName(trip([pop, riviera, aunt]), '2027-12-22')).toBe('Riviera');
  });

  it('on a hand-off date names the incoming stay (R8.5)', () => {
    expect(glanceLodgingName(trip([pop, riviera, aunt]), '2027-12-20')).toBe('Riviera');
  });

  it('on the last day names the stay being checked out of, and an off-site place by its name (R8.2)', () => {
    expect(glanceLodgingName(trip([pop, riviera, aunt]), '2027-12-31')).toBe('Aunt May');
  });

  it('with only undated stays names the first one by position (R8.4)', () => {
    const a = stay({ id: 'a', position: 0, displayName: 'Beach Club', checkIn: null, checkOut: null });
    const b = stay({ id: 'b', position: 1, displayName: 'Yacht Club', checkIn: null, checkOut: null });
    expect(glanceLodgingName(trip([b, a]), '2027-12-17')).toBe('Beach Club');
  });

  it('returns undefined on a night no stay covers, and outside the stays (R8.3)', () => {
    expect(glanceLodgingName(trip([pop, aunt]), '2027-12-22')).toBeUndefined();
    expect(glanceLodgingName(trip([pop]), '2028-01-05')).toBeUndefined();
  });

  it('a Trip with no stays keeps the old behaviour: its first recorded resort, or nothing', () => {
    expect(glanceLodgingName(trip([], [{ id: 'r', name: 'Contemporary' }]), '2027-12-17')).toBe('Contemporary');
    expect(glanceLodgingName(trip([]), '2027-12-17')).toBeUndefined();
  });
});
