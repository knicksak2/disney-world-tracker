import { wdwIsoAtMinutes, wdwToday } from '../trips/wdwClock.js';
import {
  BOOKING_RULES,
  BOOKING_RULES_VERSION,
  addCalendarDays,
  diffCalendarDays,
  isCheckInOverrideValid,
  listCalendarDates,
  type StayType,
  type LightningLaneTiming,
  type WindowKind,
  type WindowStatus,
  WINDOW_KINDS,
  type BookingWindowDTO,
  type WindowRule,
} from '@dwt/shared';

export interface StoredBookingSettings {
  readonly stayType: StayType | null;
  readonly lightningLaneTiming: LightningLaneTiming | null;
  readonly checkInOverride: string | null; // stored value, may be out of range after a Trip date edit
}

export interface TimelineTripInput {
  readonly startDate: string;
  readonly endDate: string;
  readonly hasResortStay: boolean; // ≥ 1 trip_resorts row
  readonly settings: StoredBookingSettings | null;
}

export interface DerivedWindow {
  readonly windowKey: string;
  readonly kind: WindowKind;
  readonly dropOn: string;
  readonly dropAt: string;
  readonly coveredDates: readonly string[];
}

export interface DerivedTimeline {
  readonly rulesVersion: number;
  readonly stayType: { readonly value: StayType; readonly source: 'auto' | 'override' };
  readonly lightningLaneTiming: { readonly value: LightningLaneTiming; readonly source: 'auto' | 'override' };
  readonly arrival: { readonly value: string; readonly source: 'trip_start' | 'override' };
  readonly stayDates: readonly string[];
  readonly windows: readonly DerivedWindow[];
}

export function resolveSettings(trip: TimelineTripInput): {
  stayType: { value: StayType; source: 'auto' | 'override' };
  lightningLaneTiming: { value: LightningLaneTiming; source: 'auto' | 'override' };
  arrival: { value: string; source: 'trip_start' | 'override' };
} {
  const s = trip.settings;
  const stayType: { value: StayType; source: 'auto' | 'override' } =
    s?.stayType != null
      ? { value: s.stayType, source: 'override' }
      : { value: trip.hasResortStay ? 'resort' : 'offsite', source: 'auto' };

  const lightningLaneTiming: { value: LightningLaneTiming; source: 'auto' | 'override' } =
    s?.lightningLaneTiming != null
      ? { value: s.lightningLaneTiming, source: 'override' }
      : { value: BOOKING_RULES.lightning_lane.defaultTimingByStayType[stayType.value], source: 'auto' };

  const arrival: { value: string; source: 'trip_start' | 'override' } =
    s?.checkInOverride != null && isCheckInOverrideValid(s.checkInOverride, trip.startDate)
      ? { value: s.checkInOverride, source: 'override' }
      : { value: trip.startDate, source: 'trip_start' };

  return { stayType, lightningLaneTiming, arrival };
}

function mk(kind: WindowKind, dropOn: string, covered: readonly string[]): DerivedWindow {
  return {
    windowKey: `${kind}:${dropOn}`,
    kind,
    dropOn,
    dropAt: wdwIsoAtMinutes(dropOn, BOOKING_RULES[kind].dropMinutes),
    coveredDates: covered,
  };
}

export function applyRule(
  kind: WindowKind,
  rule: WindowRule,
  stayDates: readonly string[],
  arrival: string
): DerivedWindow[] {
  if (stayDates.length === 0) return [];
  const head = rule.headCoverDays === null ? stayDates : stayDates.slice(0, rule.headCoverDays);
  const out: DerivedWindow[] = [mk(kind, addCalendarDays(arrival, -rule.headOffsetDays), head)];
  const rest = stayDates.slice(head.length);
  if (rest.length > 0 && rule.tail !== null) {
    if (rule.tail.mode === 'shared') {
      out.push(mk(kind, addCalendarDays(arrival, -rule.tail.offsetDays), rest));
    } else {
      for (const d of rest) {
        out.push(mk(kind, addCalendarDays(d, -rule.tail.offsetDays), [d]));
      }
    }
  }
  return out;
}

export function compareWindows(a: DerivedWindow, b: DerivedWindow): number {
  return (
    a.dropAt.localeCompare(b.dropAt) ||
    WINDOW_KINDS.indexOf(a.kind) - WINDOW_KINDS.indexOf(b.kind) ||
    a.coveredDates[0]!.localeCompare(b.coveredDates[0]!)
  );
}

export function deriveBookingTimeline(trip: TimelineTripInput): DerivedTimeline {
  const r = resolveSettings(trip);
  const arrival = r.arrival.value;
  const stay = listCalendarDates(arrival, trip.endDate);
  if (stay.length === 0) {
    return {
      rulesVersion: BOOKING_RULES_VERSION,
      ...r,
      stayDates: [],
      windows: [],
    };
  }
  const dining = applyRule(
    'dining',
    BOOKING_RULES.dining.byStayType[r.stayType.value],
    stay,
    arrival
  );
  const ll = applyRule(
    'lightning_lane',
    BOOKING_RULES.lightning_lane.byTiming[r.lightningLaneTiming.value],
    stay,
    arrival
  );
  const windows = [...dining, ...ll].sort(compareWindows);
  return {
    rulesVersion: BOOKING_RULES_VERSION,
    ...r,
    stayDates: stay,
    windows,
  };
}

export interface AnnotateContext {
  readonly now: Date; // captured ONCE per request (R3.4)
  readonly doneMarks: ReadonlyMap<string, { markedAt: string; markedByDisplayName: string }>; // by windowKey
  readonly reservations: readonly { kind: string; plannedDate: string }[]; // planned_date NOT NULL only
}

export function windowStatus(w: DerivedWindow, now: Date, today: string): WindowStatus {
  if (Date.parse(w.dropAt) > now.getTime()) return 'upcoming';
  return w.coveredDates[w.coveredDates.length - 1]! >= today ? 'open' : 'past';
}

export function daysUntilDrop(w: DerivedWindow, status: WindowStatus, today: string): number | null {
  return status === 'upcoming' ? Math.max(0, diffCalendarDays(w.dropOn, today)) : null;
}

export function bookedCount(w: DerivedWindow, reservations: AnnotateContext['reservations']): number {
  return reservations.filter(r => r.kind === w.kind && w.coveredDates.includes(r.plannedDate)).length;
}

export function annotateWindows(d: DerivedTimeline, ctx: AnnotateContext): BookingWindowDTO[] {
  const today = wdwToday(ctx.now);
  return d.windows.map(w => {
    const status = windowStatus(w, ctx.now, today);
    const mark = ctx.doneMarks.get(w.windowKey);
    return {
      windowKey: w.windowKey,
      kind: w.kind,
      dropOn: w.dropOn,
      dropAt: w.dropAt,
      coveredDates: w.coveredDates,
      status,
      daysUntilDrop: daysUntilDrop(w, status, today),
      done: mark !== undefined,
      doneAt: mark?.markedAt ?? null,
      doneByDisplayName: mark?.markedByDisplayName ?? null,
      bookedCount: bookedCount(w, ctx.reservations),
    };
  });
}
