/**
 * Trip lodging stays: constants, Zod schemas, DTOs and the pure helpers every consumer uses to answer
 * "where is the party staying, and when?" (`.kiro/specs/trip-lodging-stays`).
 *
 * A Stay is one lodging booking of a Trip: a kind (`resort`, `partner_hotel` or `offsite`), a catalog Resort or a
 * free-text name, a check-in and a check-out, and optionally the subset of the party who are on it. Nights are the
 * half-open range `[checkIn, checkOut)`; two stays may share a hand-off date (one's check-out is the next one's
 * check-in) but never a night.
 *
 * `effectiveStays` is the single place that interprets a Trip's lodging data. It turns dated stays, undated (legacy)
 * stays, or no stays at all into an ordered list of segments, so booking, the hub, the Live Glance and the dining
 * plan never re-implement the legacy, gap or implicit rules.
 *
 * Everything here is pure, total and works on `YYYY-MM-DD` strings with UTC-midnight arithmetic (never a local-time
 * `Date`).
 *
 * Validates: Requirements 1.2, 1.4, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1 to 3.7, 5.7, 6.1, 12.1, 12.2, 12.3
 */

import { z } from 'zod';

import { STAY_TYPES, type StayType } from './enums.js';
import { uuidSchema } from './schemas/primitives.js';
import { addCalendarDays, diffCalendarDays, listCalendarDates } from './tripBooking.js';
import { tripCalendarDateSchema } from './trips.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Most Stays one Trip may hold (R1.4). Does not exceed `TRIP_RESORT_LIMIT` (20), which bounds the `trip_resorts` projection. */
export const TRIP_STAY_LIMIT = 8;
/** Most nights one Stay may cover (R2.3). */
export const TRIP_STAY_MAX_NIGHTS = 60;
/** Most days between the earliest check-in and the latest check-out of one Trip's Stays (R2.3). */
export const TRIP_STAY_SPAN_MAX_DAYS = 90;
/** Longest free-text lodging name (R1.2). */
export const TRIP_STAY_PLACE_NAME_MAX = 100;
/** Most Person_Keys a Stay's `partyKeys` may name (R6.1). */
export const TRIP_STAY_PARTY_KEYS_MAX = 50;

/** Display name of a synthesized segment standing for lodging the Trip has not recorded (R3.2, R3.4). */
export const TRIP_STAY_NO_LODGING_NAME = 'No lodging recorded';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** A Person_Key: `m:<member id>` or `g:<guest id>` (the member-XOR-guest pattern of `trip-expenses`). */
export const personKeySchema = z.string().regex(/^[mg]:[A-Za-z0-9_-]{1,64}$/u);

const placeNameSchema = z.string().trim().min(1).max(TRIP_STAY_PLACE_NAME_MAX);

/**
 * One Stay as submitted to `PUT /trips/:id/stays` (R5.2). `id` names an existing Stay to keep (R5.3); omit it to
 * create one. Kind rules (R1.2, R1.3, R2.5): a `resort` Stay needs `resortId` and has no `placeName`; any other kind
 * needs `placeName` and has no `resortId`. `checkIn` and `checkOut` are both present or both absent, and
 * `checkOut` is after `checkIn`.
 */
export const tripStayInputSchema = z
  .object({
    id: uuidSchema.optional(),
    lodgingKind: z.enum(STAY_TYPES),
    resortId: uuidSchema.nullable().optional(),
    placeName: placeNameSchema.nullable().optional(),
    checkIn: tripCalendarDateSchema.nullable().optional(),
    checkOut: tripCalendarDateSchema.nullable().optional(),
    partyKeys: z.array(personKeySchema).max(TRIP_STAY_PARTY_KEYS_MAX).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path: string, message = 'trip_validation_failed'): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };

    if (v.lodgingKind === 'resort') {
      if (v.resortId == null) issue('resortId');
      if (v.placeName != null) issue('placeName');
    } else {
      if (v.placeName == null) issue('placeName');
      if (v.resortId != null) issue('resortId');
    }

    const hasIn = v.checkIn != null;
    const hasOut = v.checkOut != null;
    if (hasIn !== hasOut) {
      issue(hasIn ? 'checkOut' : 'checkIn');
    } else if (v.checkIn != null && v.checkOut != null && v.checkOut <= v.checkIn) {
      issue('checkOut');
    }
  });

export type TripStayInput = z.infer<typeof tripStayInputSchema>;

/** Body of `PUT /trips/:id/stays`: the complete list of the Trip's Stays (R5.2, R5.3). */
export const tripStaysPutSchema = z
  .object({
    stays: z.array(tripStayInputSchema).max(TRIP_STAY_LIMIT),
  })
  .strict();

export type TripStaysPutInput = z.infer<typeof tripStaysPutSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * The minimal shape of a stored Stay that the pure helpers read. Both the API repo rows and `TripStayDTO` satisfy it.
 * A Stay is *scheduled* only when both dates are present and `checkOut` is after `checkIn`; anything else (including
 * a malformed row with one date) is treated as unscheduled so the helpers stay total.
 */
export interface StayRecord {
  readonly id: string;
  readonly position: number;
  readonly lodgingKind: StayType;
  readonly resortId: string | null;
  readonly displayName: string;
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  readonly partyKeys: readonly string[] | null;
}

/** A Stay as returned to a Trip_Member (R1.5). `nights` is null for an unscheduled Stay. */
export interface TripStayDTO extends StayRecord {
  readonly placeName: string | null;
  readonly nights: number | null;
}

export type TripStayWarningCode = 'gap' | 'outside_trip' | 'unscheduled' | 'trip_not_covered';

/**
 * An advisory finding about a Trip's Stays (R5.7); never blocking. For `gap` and `trip_not_covered`, `from` is the
 * first uncovered night and `to` is the day after the last uncovered night (check-out style, exclusive). For
 * `outside_trip` and `unscheduled`, `stayId` names the Stay.
 */
export interface TripStayWarningDTO {
  readonly code: TripStayWarningCode;
  readonly stayId?: string;
  readonly from?: string;
  readonly to?: string;
}

export type EffectiveStaySource = 'stay' | 'legacy_resorts' | 'implicit_no_lodging' | 'implicit_gap';

/** One segment of lodging as every consumer should see it (R3.1). `checkOut` is exclusive of the night count. */
export interface EffectiveStay {
  readonly id: string | null;
  readonly source: EffectiveStaySource;
  readonly lodgingKind: StayType;
  readonly displayName: string;
  readonly resortId: string | null;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly partyKeys: readonly string[] | null;
}

export type StayValidationCode =
  | 'count_exceeded'
  | 'dates_incomplete'
  | 'dates_inverted'
  | 'nights_exceeded'
  | 'overlap'
  | 'span_exceeded';

export interface StayValidationError {
  readonly code: StayValidationCode;
  /** Index into the validated list; absent for list-level errors (`count_exceeded`, `span_exceeded`). */
  readonly stayIndex?: number;
  readonly message: string;
}

/** The part of a Stay that date validation reads; a `TripStayInput`, a `StayRecord` and a `TripStayDTO` all satisfy it. */
export interface StayDateFields {
  readonly checkIn?: string | null;
  readonly checkOut?: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** True when the Stay has both dates and `checkOut` is after `checkIn` (so it covers at least one night). */
export function isScheduledStay(s: StayDateFields): s is { checkIn: string; checkOut: string } {
  return typeof s.checkIn === 'string' && typeof s.checkOut === 'string' && s.checkOut > s.checkIn;
}

/** The nights of a Stay: every date from `checkIn` up to, but not including, `checkOut` (R3.6). Empty when not after. */
export function stayNights(checkIn: string, checkOut: string): string[] {
  if (checkOut <= checkIn) return [];
  return listCalendarDates(checkIn, addCalendarDays(checkOut, -1));
}

/**
 * Validates a list of Stays that is about to be stored (R2.1, R2.2, R2.3). Returns every error found; an empty list
 * means valid. Unscheduled Stays (no dates) never produce a date error. Two Stays that only touch at a hand-off date
 * are valid. The result does not depend on input order beyond the `stayIndex` it reports.
 */
export function validateStays(stays: readonly StayDateFields[]): StayValidationError[] {
  const errors: StayValidationError[] = [];

  if (stays.length > TRIP_STAY_LIMIT) {
    errors.push({
      code: 'count_exceeded',
      message: `A trip can hold at most ${TRIP_STAY_LIMIT} stays.`,
    });
  }

  const dated: { index: number; checkIn: string; checkOut: string }[] = [];
  stays.forEach((s, index) => {
    const hasIn = typeof s.checkIn === 'string';
    const hasOut = typeof s.checkOut === 'string';
    if (hasIn !== hasOut) {
      errors.push({ code: 'dates_incomplete', stayIndex: index, message: 'A stay needs both a check-in and a check-out, or neither.' });
      return;
    }
    if (!hasIn || !hasOut) return;
    const checkIn = s.checkIn as string;
    const checkOut = s.checkOut as string;
    if (checkOut <= checkIn) {
      errors.push({ code: 'dates_inverted', stayIndex: index, message: 'Check-out must be after check-in.' });
      return;
    }
    if (diffCalendarDays(checkOut, checkIn) > TRIP_STAY_MAX_NIGHTS) {
      errors.push({
        code: 'nights_exceeded',
        stayIndex: index,
        message: `A stay can cover at most ${TRIP_STAY_MAX_NIGHTS} nights.`,
      });
    }
    dated.push({ index, checkIn, checkOut });
  });

  // Overlap: sort by check-in and compare each stay with the latest check-out seen so far, so every stay that shares a
  // night with an earlier one is reported (not only adjacent pairs). A stay starting on the previous one's check-out
  // date is a valid hand-off.
  const ordered = [...dated].sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.index - b.index);
  let maxEnd: string | null = null;
  for (const s of ordered) {
    if (maxEnd !== null && s.checkIn < maxEnd) {
      errors.push({ code: 'overlap', stayIndex: s.index, message: 'Stays cannot share a night.' });
    }
    if (maxEnd === null || s.checkOut > maxEnd) maxEnd = s.checkOut;
  }

  if (dated.length > 0) {
    const first = ordered[0]!.checkIn;
    const last = dated.reduce((m, s) => (s.checkOut > m ? s.checkOut : m), dated[0]!.checkOut);
    if (diffCalendarDays(last, first) > TRIP_STAY_SPAN_MAX_DAYS) {
      errors.push({
        code: 'span_exceeded',
        message: `The first check-in and the last check-out can be at most ${TRIP_STAY_SPAN_MAX_DAYS} days apart.`,
      });
    }
  }

  return errors;
}

interface TripDates {
  readonly startDate: string;
  readonly endDate: string;
}

function byScheduleOrder(a: StayRecord, b: StayRecord): number {
  return (
    (a.checkIn ?? '').localeCompare(b.checkIn ?? '') ||
    a.position - b.position ||
    a.id.localeCompare(b.id)
  );
}

function byPositionOrder(a: StayRecord, b: StayRecord): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

function nightCount(checkIn: string, checkOut: string): number {
  return Math.max(0, diffCalendarDays(checkOut, checkIn));
}

/** Maximal runs of consecutive Trip nights that no scheduled Stay covers, as `[firstNight, lastNight]` pairs. */
function uncoveredRuns(trip: TripDates, scheduled: readonly StayRecord[]): { first: string; last: string; length: number }[] {
  const covered = new Set<string>();
  for (const s of scheduled) {
    for (const n of stayNights(s.checkIn as string, s.checkOut as string)) covered.add(n);
  }
  const runs: { first: string; last: string; length: number }[] = [];
  let current: { first: string; last: string; length: number } | null = null;
  for (const night of stayNights(trip.startDate, trip.endDate)) {
    if (covered.has(night)) {
      current = null;
      continue;
    }
    if (current === null) {
      current = { first: night, last: night, length: 1 };
      runs.push(current);
    } else {
      current.last = night;
      current.length += 1;
    }
  }
  return runs;
}

/**
 * The one answer to "where is the party staying?" for any Trip (R3.1 to R3.5, R3.7). Total: never throws.
 *
 *  - With at least one scheduled Stay: those Stays (`source: 'stay'`) plus an `offsite` `implicit_gap` segment for
 *    every maximal run of Trip nights no Stay covers.
 *  - With only unscheduled Stays: one `legacy_resorts` segment spanning the Trip, taking the kind and name of the first
 *    Stay by position.
 *  - With no Stays: one `offsite` `implicit_no_lodging` segment spanning the Trip.
 *
 * The result is ordered by `checkIn`.
 */
export function effectiveStays(trip: TripDates, stays: readonly StayRecord[]): EffectiveStay[] {
  const scheduled = stays.filter((s) => isScheduledStay(s)).sort(byScheduleOrder);

  if (scheduled.length > 0) {
    const segments: EffectiveStay[] = scheduled.map((s) => ({
      id: s.id,
      source: 'stay',
      lodgingKind: s.lodgingKind,
      displayName: s.displayName,
      resortId: s.resortId,
      checkIn: s.checkIn as string,
      checkOut: s.checkOut as string,
      nights: nightCount(s.checkIn as string, s.checkOut as string),
      partyKeys: s.partyKeys,
    }));
    for (const run of uncoveredRuns(trip, scheduled)) {
      segments.push({
        id: null,
        source: 'implicit_gap',
        lodgingKind: 'offsite',
        displayName: TRIP_STAY_NO_LODGING_NAME,
        resortId: null,
        checkIn: run.first,
        checkOut: addCalendarDays(run.last, 1),
        nights: run.length,
        partyKeys: null,
      });
    }
    return segments.sort((a, b) => a.checkIn.localeCompare(b.checkIn) || a.checkOut.localeCompare(b.checkOut));
  }

  const span = {
    checkIn: trip.startDate,
    checkOut: trip.endDate,
    nights: nightCount(trip.startDate, trip.endDate),
  };

  if (stays.length > 0) {
    const first = [...stays].sort(byPositionOrder)[0]!;
    return [
      {
        id: null,
        source: 'legacy_resorts',
        lodgingKind: first.lodgingKind,
        displayName: first.displayName,
        resortId: first.resortId,
        ...span,
        partyKeys: null,
      },
    ];
  }

  return [
    {
      id: null,
      source: 'implicit_no_lodging',
      lodgingKind: 'offsite',
      displayName: TRIP_STAY_NO_LODGING_NAME,
      resortId: null,
      ...span,
      partyKeys: null,
    },
  ];
}

/** The segment whose night is `date` (`checkIn <= date < checkOut`), or null (R3.6). */
export function stayForNight(effective: readonly EffectiveStay[], date: string): EffectiveStay | null {
  return effective.find((s) => s.checkIn <= date && date < s.checkOut) ?? null;
}

/**
 * The stay to name "tonight" (R3.6, R8.1, R8.5): the segment whose night is `today` (on a hand-off date that is the
 * incoming stay), otherwise the segment being checked out of today, otherwise null.
 */
export function tonightsStay(effective: readonly EffectiveStay[], today: string): EffectiveStay | null {
  return stayForNight(effective, today) ?? effective.find((s) => s.checkOut === today) ?? null;
}

/**
 * Advisory findings about a Trip's Stays (R5.7). Never blocking. Order: `unscheduled` per unscheduled Stay, then the
 * uncovered-night findings by date, then `outside_trip` per Stay.
 *
 *  - `unscheduled`: a Stay with no usable dates.
 *  - With at least one scheduled Stay: `gap` for a run of Trip nights between two scheduled Stays that none covers;
 *    `trip_not_covered` for uncovered Trip nights before the first or after the last scheduled Stay; `outside_trip`
 *    for a scheduled Stay with a night before the Trip's start or on/after the Trip's end.
 */
export function computeStayWarnings(trip: TripDates, stays: readonly StayRecord[]): TripStayWarningDTO[] {
  const warnings: TripStayWarningDTO[] = [];
  const ordered = [...stays].sort(byPositionOrder);

  for (const s of ordered) {
    if (!isScheduledStay(s)) warnings.push({ code: 'unscheduled', stayId: s.id });
  }

  const scheduled = stays.filter((s) => isScheduledStay(s)).sort(byScheduleOrder);
  if (scheduled.length === 0) return warnings;

  const firstCheckIn = scheduled[0]!.checkIn as string;
  const lastCheckOut = scheduled.reduce(
    (m, s) => ((s.checkOut as string) > m ? (s.checkOut as string) : m),
    scheduled[0]!.checkOut as string,
  );

  for (const run of uncoveredRuns(trip, scheduled)) {
    const code: TripStayWarningCode =
      run.last < firstCheckIn || run.first >= lastCheckOut ? 'trip_not_covered' : 'gap';
    warnings.push({ code, from: run.first, to: addCalendarDays(run.last, 1) });
  }

  for (const s of scheduled) {
    if ((s.checkIn as string) < trip.startDate || (s.checkOut as string) > trip.endDate) {
      warnings.push({ code: 'outside_trip', stayId: s.id });
    }
  }

  return warnings;
}
