/**
 * Pure projection of a raw ThemeParks.wiki live entry into the strict
 * `LiveDetailDTO` domain model.
 *
 * `projectLiveDetail(raw, ctx)` is the correctness core of the `Live_Service`.
 * Mirroring the purity discipline of `services/catalog/classify.ts`, it is
 * intentionally:
 *
 *   - **Pure**: depends only on its arguments; no I/O, no globals, and no
 *     ambient clock — the "current day" and the Park time zone arrive via
 *     `ProjectionContext`.
 *   - **Total**: always returns a complete `LiveDetailDTO`; it never throws.
 *     Every unrecognized, missing, malformed, or out-of-range upstream value
 *     maps to its documented absent / `Unknown` / empty representation.
 *   - **Deterministic**: equal inputs always produce equal outputs, which
 *     makes it a sound property-test target (design.md → Correctness
 *     Properties 1-6).
 *
 * The projection treats the verified real-response shapes as ground truth over
 * the published (incomplete) OpenAPI schema, and tolerates any partial or
 * surprising payload defensively (see requirements Assumptions).
 *
 * Mapping rules (each maps directly to an acceptance criterion):
 *
 *   - Operating_Status (R1.3, R1.4): a total lookup of the recognized status
 *     tokens with an `Unknown` default.
 *   - Wait_Time / Single_Rider_Wait (R1.5, R1.6, R1.11, R1.12): kept only when
 *     an integer in [0, 1440]; otherwise absent.
 *   - Return_Window / Paid_Return_Window (R1.13, R1.14): state mapped to a
 *     known label, optional times carried iff present and parseable, and the
 *     paid variant's amount / currency / formatted string carried verbatim.
 *   - Boarding_Group_Status (R1.15): allocation mapped to a known label, with
 *     optional group numbers, next-allocation time, and a clamped estimated
 *     wait carried iff present.
 *   - Wait_Time_Forecast (R1.16, R1.17): an ordered series; the whole forecast
 *     degrades to absent if it is missing or any entry is unparseable, while
 *     every other field is still projected.
 *   - Showtimes / Operating_Hours (R1.7, R1.18, R1.19): only current-day
 *     entries, each with an optional `type` label.
 *   - Dining_Availability (R1.20, R1.21): exactly one entry per upstream list
 *     item, independent of Operating_Hours; an empty array when missing.
 *   - Upstream_Last_Updated (R1.22): carried when present, absent otherwise,
 *     kept distinct from Retrieved_At.
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.10, 1.11, 1.12, 1.13,
 * 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.20, 1.21, 1.22
 */

import type {
  BoardingGroupAllocation,
  BoardingGroupStatus,
  DiningAvailabilityEntry,
  ForecastEntry,
  LiveDetailDTO,
  OperatingHours,
  OperatingStatus,
  PaidReturnWindow,
  ReturnWindow,
  ReturnWindowState,
  Showtime,
} from '@dwt/shared';

import { isCurrentParkDay, WDW_TIME_ZONE } from './parkTime.js';
import type { ThemeParksLiveEntry } from './themeparksLive.js';

// ---------------------------------------------------------------------------
// Projection context
// ---------------------------------------------------------------------------

/**
 * The ambient information the projection needs but must not read from globals.
 * Keeping the clock and time zone in the context is what makes the projection
 * pure and deterministic.
 */
export interface ProjectionContext {
  /**
   * IANA time zone for the Park (WDW = `'America/New_York'`); used only to
   * scope "current day" showtimes and operating hours.
   */
  readonly parkTimeZone: string;
  /** The instant the projection is run; used only to scope the current day. */
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// Status / state lookup tables
// ---------------------------------------------------------------------------

/**
 * Total lookup of the recognized upstream status tokens. Any token not present
 * here — including a missing status — maps to `Unknown` (R1.4).
 */
const STATUS_BY_TOKEN: Readonly<Record<string, OperatingStatus>> = {
  OPERATING: 'Operating',
  CLOSED: 'Closed',
  DOWN: 'Down',
  REFURBISHMENT: 'Refurbishment',
};

/** Recognized RETURN_TIME / PAID_RETURN_TIME state tokens (R1.13). */
const RETURN_STATE_BY_TOKEN: Readonly<Record<string, ReturnWindowState>> = {
  AVAILABLE: 'Available',
  TEMP_FULL: 'Temporarily_Full',
  FINISHED: 'Finished',
};

/** Recognized BOARDING_GROUP allocation tokens (R1.15). */
const ALLOCATION_BY_TOKEN: Readonly<Record<string, BoardingGroupAllocation>> = {
  AVAILABLE: 'Available',
  PAUSED: 'Paused',
  CLOSED: 'Closed',
};

// ---------------------------------------------------------------------------
// Small total helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw status token to an `OperatingStatus`, defaulting to `Unknown` for
 * any unrecognized or missing value (R1.3, R1.4). Matching is case-insensitive
 * so a lower/mixed-case upstream token still resolves.
 */
function mapStatus(raw: string | undefined): OperatingStatus {
  if (typeof raw !== 'string') {
    return 'Unknown';
  }
  return STATUS_BY_TOKEN[raw.toUpperCase()] ?? 'Unknown';
}

/**
 * Keep a minute-valued field only when it is an integer in [0, 1440]
 * (R1.5, R1.6, R1.11, R1.12, R1.15). A missing, non-numeric, non-integer, or
 * out-of-range value is represented as absent (`undefined`).
 */
function validMinutes(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return undefined;
  }
  if (value < 0 || value > 1440) {
    return undefined;
  }
  return value;
}

/**
 * Keep an optional integer (e.g. boarding-group numbers, party size) only when
 * it is genuinely an integer; otherwise absent.
 */
function validInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * Normalize a raw timestamp string into a canonical ISO-8601 UTC instant
 * (`Z`-suffixed), or `undefined` when the value is missing or unparseable.
 *
 * Upstream timestamps may carry a zone offset; normalizing through `Date`
 * yields the absolute instant in the canonical wire form the DTO schema
 * expects, independent of the original offset. The Park-local rendering of the
 * instant happens at the display boundary, not here.
 */
function toIsoInstant(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Queue projections
// ---------------------------------------------------------------------------

/**
 * Project a return-time queue into a `ReturnWindow`. Returns `undefined` when
 * the queue is absent or its state is unrecognized, since a `ReturnWindow`
 * requires one of the known states (R1.13). Optional start/end times are
 * carried iff present and parseable.
 */
function projectReturnWindow(
  queue:
    | NonNullable<NonNullable<ThemeParksLiveEntry['queue']>['RETURN_TIME']>
    | undefined,
): ReturnWindow | undefined {
  if (queue === undefined || queue === null) {
    return undefined;
  }
  const state = mapReturnState(queue.state);
  if (state === undefined) {
    return undefined;
  }
  const start = toIsoInstant(queue.returnStart);
  const end = toIsoInstant(queue.returnEnd);
  return {
    state,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
  };
}

/** Map a raw return/paid-return state token, or `undefined` when unrecognized. */
function mapReturnState(raw: string | undefined): ReturnWindowState | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  return RETURN_STATE_BY_TOKEN[raw.toUpperCase()];
}

/**
 * Project a paid return-time queue into a `PaidReturnWindow`. Returns
 * `undefined` unless both the state is recognized and a complete price
 * (numeric amount, string currency, string formatted) is present; the price
 * strings are carried verbatim from upstream (R1.14).
 */
function projectPaidReturnWindow(
  queue: NonNullable<NonNullable<ThemeParksLiveEntry['queue']>['PAID_RETURN_TIME']>,
): PaidReturnWindow | undefined {
  const state = mapReturnState(queue.state);
  if (state === undefined) {
    return undefined;
  }
  const price = queue.price;
  if (
    price === undefined ||
    price === null ||
    typeof price.amount !== 'number' ||
    typeof price.currency !== 'string' ||
    typeof price.formatted !== 'string'
  ) {
    return undefined;
  }
  const start = toIsoInstant(queue.returnStart);
  const end = toIsoInstant(queue.returnEnd);
  return {
    state,
    ...(start !== undefined ? { start } : {}),
    ...(end !== undefined ? { end } : {}),
    price: {
      amount: price.amount,
      currency: price.currency,
      formatted: price.formatted,
    },
  };
}

/**
 * Project a boarding-group queue into a `BoardingGroupStatus`. Returns
 * `undefined` when the queue is absent or its allocation status is
 * unrecognized (R1.15). Optional group numbers, next-allocation time, and a
 * clamped estimated wait are carried iff present and valid.
 */
function projectBoardingGroup(
  queue: NonNullable<NonNullable<ThemeParksLiveEntry['queue']>['BOARDING_GROUP']>,
): BoardingGroupStatus | undefined {
  const allocation = mapAllocation(queue.allocationStatus);
  if (allocation === undefined) {
    return undefined;
  }
  const currentGroupStart = validInteger(queue.currentGroupStart);
  const currentGroupEnd = validInteger(queue.currentGroupEnd);
  const nextAllocationTime = toIsoInstant(queue.nextAllocationTime);
  const estimatedWaitMinutes = validMinutes(queue.estimatedWait);
  return {
    allocation,
    ...(currentGroupStart !== undefined ? { currentGroupStart } : {}),
    ...(currentGroupEnd !== undefined ? { currentGroupEnd } : {}),
    ...(nextAllocationTime !== undefined ? { nextAllocationTime } : {}),
    ...(estimatedWaitMinutes !== undefined ? { estimatedWaitMinutes } : {}),
  };
}

/** Map a raw allocation token, or `undefined` when unrecognized. */
function mapAllocation(
  raw: string | undefined,
): BoardingGroupAllocation | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  return ALLOCATION_BY_TOKEN[raw.toUpperCase()];
}

// ---------------------------------------------------------------------------
// Forecast / schedule / dining projections
// ---------------------------------------------------------------------------

/**
 * Project the forecast series (R1.16, R1.17). Returns `undefined` when the
 * forecast is missing or when ANY entry fails to parse into
 * `{ time, waitMinutes in [0,1440], percentage in [0,100] }` — degrading the
 * whole forecast in isolation while every other field is still projected.
 * When every entry parses, the upstream order is preserved.
 */
function projectForecast(
  forecast: ThemeParksLiveEntry['forecast'],
): readonly ForecastEntry[] | undefined {
  if (!Array.isArray(forecast)) {
    return undefined;
  }
  const entries: ForecastEntry[] = [];
  for (const raw of forecast) {
    const time = toIsoInstant(raw?.time);
    const waitMinutes = validMinutes(raw?.waitTime);
    const percentage = raw?.percentage;
    if (
      time === undefined ||
      waitMinutes === undefined ||
      typeof percentage !== 'number' ||
      Number.isNaN(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      // Any unparseable entry collapses the whole forecast to absent (R1.17).
      return undefined;
    }
    entries.push({ time, waitMinutes, percentage });
  }
  return entries;
}

/**
 * Project current-day showtimes (R1.7, R1.18). An entry is kept only when it
 * has a parseable start that falls on the current Park day; the end time and
 * the `type` label are each carried iff present and valid.
 */
function projectShowtimes(
  showtimes: ThemeParksLiveEntry['showtimes'],
  ctx: ProjectionContext,
): readonly Showtime[] {
  if (!Array.isArray(showtimes)) {
    return [];
  }
  const result: Showtime[] = [];
  for (const raw of showtimes) {
    const start = toIsoInstant(raw?.startTime);
    if (start === undefined) {
      continue;
    }
    if (!isCurrentParkDay(new Date(start), ctx.now, ctx.parkTimeZone)) {
      continue;
    }
    const end = toIsoInstant(raw?.endTime);
    const type = typeof raw?.type === 'string' ? raw.type : undefined;
    result.push({
      start,
      ...(end !== undefined ? { end } : {}),
      ...(type !== undefined ? { type } : {}),
    });
  }
  return result;
}

/**
 * Project current-day operating hours (R1.19). An entry is kept only when it
 * has both a parseable open and close, with the open time falling on the
 * current Park day; the `type` label is carried iff present.
 */
function projectOperatingHours(
  operatingHours: ThemeParksLiveEntry['operatingHours'],
  ctx: ProjectionContext,
): readonly OperatingHours[] {
  if (!Array.isArray(operatingHours)) {
    return [];
  }
  const result: OperatingHours[] = [];
  for (const raw of operatingHours) {
    const open = toIsoInstant(raw?.startTime);
    const close = toIsoInstant(raw?.endTime);
    if (open === undefined || close === undefined) {
      continue;
    }
    if (!isCurrentParkDay(new Date(open), ctx.now, ctx.parkTimeZone)) {
      continue;
    }
    const type = typeof raw?.type === 'string' ? raw.type : undefined;
    result.push({
      open,
      close,
      ...(type !== undefined ? { type } : {}),
    });
  }
  return result;
}

/**
 * Project the walk-up dining availability list (R1.20, R1.21): exactly one
 * entry per upstream list item, each carrying an optional integer party size
 * and an optional clamped estimated wait. A missing or empty list yields an
 * empty array (never absent), independently of whether operating hours exist.
 */
function projectDiningAvailability(
  diningAvailability: ThemeParksLiveEntry['diningAvailability'],
): readonly DiningAvailabilityEntry[] {
  if (!Array.isArray(diningAvailability)) {
    return [];
  }
  return diningAvailability.map((raw) => {
    const partySize = validInteger(raw?.partySize);
    const estimatedWaitMinutes = validMinutes(raw?.waitTime);
    return {
      ...(partySize !== undefined ? { partySize } : {}),
      ...(estimatedWaitMinutes !== undefined ? { estimatedWaitMinutes } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Top-level projection
// ---------------------------------------------------------------------------

/**
 * Project the raw upstream live entry into a `LiveDetailDTO`. Total over all
 * inputs: unrecognized / missing / out-of-range values map to the documented
 * absent / `Unknown` / empty representations rather than throwing.
 */
export function projectLiveDetail(
  raw: ThemeParksLiveEntry,
  ctx: ProjectionContext,
): LiveDetailDTO {
  const queue = raw.queue ?? undefined;

  const waitMinutes = validMinutes(queue?.STANDBY?.waitTime);
  const singleRiderWaitMinutes = validMinutes(queue?.SINGLE_RIDER?.waitTime);
  const returnWindow = projectReturnWindow(queue?.RETURN_TIME);
  const paidReturnWindow =
    queue?.PAID_RETURN_TIME !== undefined && queue.PAID_RETURN_TIME !== null
      ? projectPaidReturnWindow(queue.PAID_RETURN_TIME)
      : undefined;
  const boardingGroup =
    queue?.BOARDING_GROUP !== undefined && queue.BOARDING_GROUP !== null
      ? projectBoardingGroup(queue.BOARDING_GROUP)
      : undefined;
  const forecast = projectForecast(raw.forecast);
  const upstreamLastUpdated = toIsoInstant(raw.lastUpdated);

  return {
    status: mapStatus(raw.status),
    ...(waitMinutes !== undefined ? { waitMinutes } : {}),
    ...(singleRiderWaitMinutes !== undefined ? { singleRiderWaitMinutes } : {}),
    ...(returnWindow !== undefined ? { returnWindow } : {}),
    ...(paidReturnWindow !== undefined ? { paidReturnWindow } : {}),
    ...(boardingGroup !== undefined ? { boardingGroup } : {}),
    ...(forecast !== undefined ? { forecast } : {}),
    showtimes: projectShowtimes(raw.showtimes, ctx),
    operatingHours: projectOperatingHours(raw.operatingHours, ctx),
    diningAvailability: projectDiningAvailability(raw.diningAvailability),
    ...(upstreamLastUpdated !== undefined ? { upstreamLastUpdated } : {}),
  };
}

/** Re-export the Park time-zone constant for callers constructing a context. */
export { WDW_TIME_ZONE };
