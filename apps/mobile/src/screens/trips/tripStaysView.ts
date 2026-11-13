/**
 * Pure helpers for the "Where you're staying" card and the Stay sheet (trip-lodging-stays tasks 8.2 and 8.3): the
 * editable draft shape, its validation and conversion to the wire input, the add-a-stay date defaults, and the text
 * the card shows (dates, nights, kind badge, "N of M people", warnings in words).
 *
 * Validates: Requirements 7.1, 7.3, 7.5, 7.6, 7.8, 6.4
 */

import {
  TRIP_STAY_PLACE_NAME_MAX,
  effectiveStays,
  formatMonthDay,
  tonightsStay,
  type StayType,
  type TripDTO,
  type TripStayDTO,
  type TripStayInput,
  type TripStayWarningDTO,
} from '@dwt/shared';

/** The kind badge text (R7.1); the kind is always conveyed in words, never by colour alone (R7.8). */
export const STAY_KIND_LABEL: Readonly<Record<StayType, string>> = {
  resort: 'Disney Resort',
  partner_hotel: 'Partner hotel',
  offsite: 'Other lodging',
};

/** The sheet's kind choices, in display order. */
export const STAY_KIND_ORDER: readonly StayType[] = ['resort', 'partner_hotel', 'offsite'];

/** One person who can be on a Stay: a Trip member (`m:<userId>`) or guest (`g:<guestId>`). */
export interface StayPerson {
  readonly key: string;
  readonly name: string;
}

/** What the Stay sheet edits. Dates are `''` while unset. `partyKeys: null` means Everyone (R6.4). */
export interface StayDraft {
  readonly id?: string;
  readonly lodgingKind: StayType;
  readonly resortId: string | null;
  readonly placeName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly partyKeys: readonly string[] | null;
}

export function memberKey(userId: string): string {
  return `m:${userId}`;
}

export function guestKey(guestId: string): string {
  return `g:${guestId}`;
}

/** The draft for an existing Stay. */
export function stayToDraft(s: TripStayDTO): StayDraft {
  return {
    id: s.id,
    lodgingKind: s.lodgingKind,
    resortId: s.resortId,
    placeName: s.placeName ?? '',
    checkIn: s.checkIn ?? '',
    checkOut: s.checkOut ?? '',
    partyKeys: s.partyKeys,
  };
}

/**
 * Dates for a new Stay (R7.6): check-in is the latest check-out among the scheduled Stays, or the Trip start; check-out
 * is the Trip end. When that would not be after the check-in (the Stays already reach the Trip end), check-out is left
 * unset for the user to pick.
 */
export function newStayDates(
  stays: readonly Pick<TripStayDTO, 'checkIn' | 'checkOut'>[],
  tripStart: string,
  tripEnd: string,
): { checkIn: string; checkOut: string } {
  let checkIn = tripStart;
  for (const s of stays) {
    if (s.checkIn !== null && s.checkOut !== null && s.checkOut > checkIn) checkIn = s.checkOut;
  }
  return { checkIn, checkOut: tripEnd > checkIn ? tripEnd : '' };
}

/** A blank draft for "Add a stay": a Disney Resort with the R7.6 dates and Everyone on it. */
export function newStayDraft(
  stays: readonly Pick<TripStayDTO, 'checkIn' | 'checkOut'>[],
  tripStart: string,
  tripEnd: string,
): StayDraft {
  return { lodgingKind: 'resort', resortId: null, placeName: '', partyKeys: null, ...newStayDates(stays, tripStart, tripEnd) };
}

/** The first problem with a draft, in words, or null when it can be saved. Mirrors the server rules (R2.1, R2.5). */
export function validateStayDraft(d: StayDraft): string | null {
  if (d.lodgingKind === 'resort') {
    if (d.resortId === null) return 'Choose the Disney Resort.';
  } else {
    const name = d.placeName.trim();
    if (name.length === 0) return 'Enter the name of the place you are staying.';
    if (name.length > TRIP_STAY_PLACE_NAME_MAX) return `The name can be at most ${TRIP_STAY_PLACE_NAME_MAX} characters.`;
  }
  const hasIn = d.checkIn !== '';
  const hasOut = d.checkOut !== '';
  if (hasIn !== hasOut) return 'Set both the check-in and check-out dates, or neither.';
  if (hasIn && d.checkOut <= d.checkIn) return 'Check-out must be after check-in.';
  if (d.partyKeys !== null && d.partyKeys.length === 0) return 'Choose who is staying, or pick Everyone.';
  return null;
}

/** The wire input for a draft. Fields that do not apply to the kind are left out (the server rejects them). */
export function draftToInput(d: StayDraft): TripStayInput {
  const base = {
    ...(d.id !== undefined ? { id: d.id } : {}),
    ...(d.checkIn !== '' && d.checkOut !== '' ? { checkIn: d.checkIn, checkOut: d.checkOut } : {}),
    partyKeys: d.partyKeys === null ? null : [...d.partyKeys],
  };
  return d.lodgingKind === 'resort'
    ? { ...base, lodgingKind: 'resort', resortId: d.resortId }
    : { ...base, lodgingKind: d.lodgingKind, placeName: d.placeName.trim() };
}

/**
 * The full list to PUT after saving `draft`: every current Stay as it is, with the draft replacing the Stay that has
 * its id, or appended when it is new. Ids are kept so the server preserves them (R5.3).
 */
export function staysAfterSave(current: readonly TripStayDTO[], draft: StayDraft): TripStayInput[] {
  const inputs = current.map((s) => draftToInput(stayToDraft(s)));
  if (draft.id === undefined) return [...inputs, draftToInput(draft)];
  return current.map((s, i) => (s.id === draft.id ? draftToInput(draft) : inputs[i]!));
}

/** The full list to PUT after removing the Stay with `stayId`. */
export function staysAfterRemove(current: readonly TripStayDTO[], stayId: string): TripStayInput[] {
  return current.filter((s) => s.id !== stayId).map((s) => draftToInput(stayToDraft(s)));
}

/** Strip a redundant leading "Disney's " prefix from a Stay's displayName (R7.1). */
export function shortStayName(name: string): string {
  return name.replace(/^Disney['\u2019]s\s+/iu, '');
}

/** "Dec 15 to Dec 20", or "Dates not set" for an unscheduled Stay (R7.1, R7.2). */
export function stayDatesLabel(s: Pick<TripStayDTO, 'checkIn' | 'checkOut'>): string {
  if (s.checkIn === null || s.checkOut === null) return 'Dates not set';
  return `${formatMonthDay(s.checkIn)} to ${formatMonthDay(s.checkOut)}`;
}

/** Compact date pill for the 2-line Hub stay header: "Dec 15–16", "Dec 28–Jan 3", or "Dates not set" (R7.1). */
export function shortStayDatesLabel(s: Pick<TripStayDTO, 'checkIn' | 'checkOut'>): string {
  if (s.checkIn === null || s.checkOut === null) return 'Dates not set';
  if (s.checkIn.slice(0, 7) === s.checkOut.slice(0, 7)) {
    const outDay = Number(s.checkOut.split('-')[2]);
    return `${formatMonthDay(s.checkIn)}\u2013${outDay}`;
  }
  return `${formatMonthDay(s.checkIn)}\u2013${formatMonthDay(s.checkOut)}`;
}

/** Compact right-hand label for an expanded Hub stay row: "Dec 15–16 · 1n", or "Dates not set" (R7.1, R7.2). */
export function shortStayDatesAndNights(s: Pick<TripStayDTO, 'checkIn' | 'checkOut' | 'nights'>): string {
  if (s.checkIn === null || s.checkOut === null) return 'Dates not set';
  const dates = shortStayDatesLabel(s);
  return s.nights !== null ? `${dates} \u00b7 ${s.nights}n` : dates;
}

/**
 * Optional secondary caption for a compact Hub stay row: null for the common case (Disney Resort + Everyone), or
 * non-Disney kind and/or "N of M people" joined by " · " when present (R7.1, R7.8).
 */
export function compactStayCaption(
  s: Pick<TripStayDTO, 'lodgingKind' | 'partyKeys'>,
  people: readonly StayPerson[],
): string | null {
  const parts: string[] = [];
  if (s.lodgingKind !== 'resort') {
    parts.push(STAY_KIND_LABEL[s.lodgingKind]);
  }
  const party = partyLabel(s.partyKeys, people);
  if (party !== null) {
    parts.push(party);
  }
  return parts.length > 0 ? parts.join(' \u00b7 ') : null;
}

export type HubStayEyebrow = 'STAYING AT' | 'TONIGHT' | 'CHECK-IN TODAY' | 'CHECK-OUT TODAY';

export interface HubStaySummary {
  readonly stay: TripStayDTO;
  readonly index: number;
  readonly total: number;
  readonly eyebrow: HubStayEyebrow;
  readonly countText: string | null;
  readonly title: string;
  readonly datesPill: string;
  readonly isCurrentToday: boolean;
}

/**
 * Resolve the 2-line collapsible stay header on the Trip hub (R7.1):
 * - When `today` is an active night of a Stay (`checkIn <= today < checkOut`), shows that Stay (`CHECK-IN TODAY` when
 *   checking into a subsequent Stay on `today`, otherwise `TONIGHT`).
 * - When `today` is the final check-out date (`checkOut === today` with no incoming Stay), shows that Stay (`CHECK-OUT TODAY`).
 * - Otherwise (before/after the trip, in an uncovered gap, or when all Stays are undated), shows the first Stay (`STAYING AT`).
 */
export function hubStaySummary(stays: readonly TripStayDTO[], today?: string): HubStaySummary | null {
  if (stays.length === 0) return null;

  let index = 0;
  let eyebrow: HubStayEyebrow = 'STAYING AT';
  let isCurrentToday = false;

  if (today !== undefined) {
    const activeIdx = stays.findIndex(
      (s) => s.checkIn !== null && s.checkOut !== null && s.checkIn <= today && today < s.checkOut,
    );
    if (activeIdx >= 0) {
      index = activeIdx;
      const activeStay = stays[activeIdx]!;
      eyebrow = activeIdx > 0 && activeStay.checkIn === today ? 'CHECK-IN TODAY' : 'TONIGHT';
      isCurrentToday = true;
    } else {
      const checkoutIdx = stays.findIndex((s) => s.checkOut === today);
      if (checkoutIdx >= 0) {
        index = checkoutIdx;
        eyebrow = 'CHECK-OUT TODAY';
        isCurrentToday = true;
      }
    }
  }

  const stay = stays[index]!;
  return {
    stay,
    index,
    total: stays.length,
    eyebrow,
    countText: stays.length > 1 ? `(${index + 1} of ${stays.length} stays)` : null,
    title: shortStayName(stay.displayName),
    datesPill: shortStayDatesLabel(stay),
    isCurrentToday,
  };
}

export function nightsLabel(nights: number | null): string | null {
  if (nights === null) return null;
  return nights === 1 ? '1 night' : `${nights} nights`;
}

/**
 * "N of M people" when the Stay names its party (R7.1). Only keys of people still on the Trip count, because a key whose
 * person left is inert (R6.2). Null for Everyone.
 */
export function partyLabel(partyKeys: readonly string[] | null, people: readonly StayPerson[]): string | null {
  if (partyKeys === null) return null;
  const current = new Set(people.map((p) => p.key));
  const on = new Set(partyKeys.filter((k) => current.has(k)));
  const total = people.length;
  return `${on.size} of ${total} ${total === 1 ? 'person' : 'people'}`;
}

/**
 * The lodging name the Live Glance "No Scheduled Plans Today" line uses (R8): the Stay whose night is `today`, or on the
 * last day the Stay being checked out of; on a hand-off date the incoming Stay (R8.5). With only undated Stays, the first
 * one's name (R8.4). Undefined when no Stay resolves for today, including a night no Stay covers (R8.3), so the caller
 * keeps its generic fallback. A Trip with no Stays at all keeps the old behaviour: its first recorded Resort.
 */
export function glanceLodgingName(
  trip: Pick<TripDTO, 'startDate' | 'endDate' | 'stays' | 'resorts'>,
  today: string,
): string | undefined {
  if (trip.stays.length === 0) return trip.resorts[0]?.name;
  const tonight = tonightsStay(effectiveStays(trip, trip.stays), today);
  if (tonight === null || tonight.source === 'implicit_gap' || tonight.source === 'implicit_no_lodging') {
    return undefined;
  }
  return tonight.displayName;
}

/** One warning as a sentence (R7.3), never relying on colour. */
export function stayWarningText(w: TripStayWarningDTO, stays: readonly Pick<TripStayDTO, 'id' | 'displayName'>[]): string {
  const rawName = stays.find((s) => s.id === w.stayId)?.displayName;
  const name = rawName !== undefined ? shortStayName(rawName) : 'A stay';
  switch (w.code) {
    case 'gap':
    case 'trip_not_covered':
      return w.from !== undefined && w.to !== undefined
        ? `${formatMonthDay(w.from)} to ${formatMonthDay(w.to)} has no lodging recorded`
        : 'Some nights of the trip have no lodging recorded';
    case 'outside_trip':
      return `${name} has nights outside the trip dates`;
    case 'unscheduled':
      return `${name} has no dates yet`;
  }
}
