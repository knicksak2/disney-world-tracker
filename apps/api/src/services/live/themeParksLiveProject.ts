/**
 * Pure ThemeParks.wiki live projection.
 *
 * `projectThemeParksLive(input, now)` is the ThemeParks.wiki-sourced replacement
 * for the retired Disney projection (`services/catalog/disney/liveProject.ts`).
 * It projects one entity's live payload from the ThemeParks.wiki
 * `GET /entity/{externalId}/live` shape (design.md → "8b. themeParksLiveProject")
 * into the strict `LiveDetailDTO` domain model (Requirement 11).
 *
 * Mirroring the discipline of the retired Disney projection and the sibling pure
 * cores, it is intentionally:
 *
 *   - **Pure**: depends only on its arguments; no I/O, no globals, and no
 *     ambient clock — the "current day" arrives via the injected `now`.
 *   - **Total**: always returns a complete `LiveDetailDTO`; it never throws. The
 *     ThemeParks.wiki payload is treated defensively, so every missing,
 *     malformed, or out-of-range value maps to its documented absent /
 *     `Unknown` / empty representation rather than failing (R11.8).
 *   - **Deterministic**: equal inputs always produce equal outputs, which makes
 *     it a sound property-test target (task 13.5, Property 13).
 *
 * Mapping rules (each maps directly to an acceptance criterion):
 *
 *   - `status` (R11.8): a total, case-insensitive lookup of the recognized
 *     ThemeParks status tokens, defaulting to `Unknown`; `status` is the one
 *     field that is always present.
 *   - `waitMinutes` / `singleRiderWaitMinutes` (R11.3): from `queue.STANDBY`
 *     and `queue.SINGLE_RIDER`, kept only when an integer in [0, 1440].
 *   - `forecast` / `showtimes` / `operatingHours` (R11.4, R11.9): scoped to the
 *     current Park day (`isCurrentParkDay`) and emitted as canonical ISO-8601
 *     instants; entries whose required times are absent/unparseable or fall on
 *     another day are dropped.
 *   - `diningAvailability` (R11.5): one entry per upstream walk-up entry, each
 *     field carried only when present and valid; an empty array when absent.
 *   - `lightningLane` (R11.6): coarse Lightning Lane price + return-window state
 *     from `queue.PAID_RETURN_TIME` / `paidReturnWindow`, emitted only when at
 *     least one sub-field is present and valid; omitted entirely otherwise.
 *   - `boardingGroup` (R11.7): boarding-group / virtual-queue status from
 *     `queue.BOARDING_GROUP`, emitted only when at least one sub-field is
 *     present and valid; omitted entirely otherwise.
 *
 * Any absent or unparseable field is omitted rather than fabricated (R11.8).
 * Current-day scoping is computed in the Park's local time zone (R11.9); the
 * time zone defaults to `WDW_TIME_ZONE` but the caller may override it (and a
 * `timezone` carried on the payload is honored as a fallback).
 *
 * Validates: Requirements 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9
 */

import type {
  BoardingGroupState,
  DiningAvailabilityEntry,
  ForecastEntry,
  LightningLaneState,
  LiveDetailDTO,
  OperatingHours,
  OperatingStatus,
  Showtime,
} from '@dwt/shared';

import { isCurrentParkDay, WDW_TIME_ZONE } from './parkTime.js';

// ---------------------------------------------------------------------------
// Raw ThemeParks.wiki live shapes (tolerant / defensive)
// ---------------------------------------------------------------------------

/**
 * A single wait-carrying queue entry (`queue.STANDBY`, `queue.SINGLE_RIDER`).
 * `waitTime` is ThemeParks.wiki's field name for the standby/single-rider wait
 * in whole minutes (R11.3).
 */
export interface ThemeParksQueueWait {
  /** Wait in whole minutes; kept only when an integer in [0, 1440]. */
  readonly waitTime?: number | null;
}

/**
 * The Lightning Lane paid-return-time queue entry
 * (`queue.PAID_RETURN_TIME` / `queue.RETURN_TIME` / `paidReturnWindow`), the
 * only source of the coarse Lightning Lane state (R11.6). Every field is
 * optional so a partial payload still projects.
 */
export interface ThemeParksPaidReturnTime {
  /** Whether a paid return window is currently offered, when present. */
  readonly available?: boolean;
  /** Coarse state label, e.g. `AVAILABLE` | `SOLD_OUT`, when present. */
  readonly state?: string;
  /** Coarse Lightning Lane price, when present. */
  readonly price?: {
    readonly amount?: number;
    readonly currency?: string;
  } | null;
  /** Return-window start instant, when present. */
  readonly returnStart?: string;
  /** Return-window end instant, when present. */
  readonly returnEnd?: string;
}

/**
 * The boarding-group / virtual-queue queue entry (`queue.BOARDING_GROUP`), the
 * only source of the boarding-group state (R11.7). ThemeParks.wiki labels the
 * coarse state `allocationStatus`; `state` is tolerated as an alias.
 */
export interface ThemeParksBoardingGroup {
  /** Whether boarding-group enrollment is currently available, when present. */
  readonly available?: boolean;
  /** ThemeParks.wiki coarse state label, when present. */
  readonly allocationStatus?: string;
  /** Alias for the coarse state label, when present. */
  readonly state?: string;
  /** Current allocated group range start, when present. */
  readonly currentGroupStart?: number;
  /** Current allocated group range end, when present. */
  readonly currentGroupEnd?: number;
}

/**
 * The `queue` object of a live-data entity. Each queue kind is optional so an
 * Experience carries only the kinds that apply to it (R11.8).
 */
export interface ThemeParksLiveQueue {
  readonly STANDBY?: ThemeParksQueueWait | null;
  readonly SINGLE_RIDER?: ThemeParksQueueWait | null;
  readonly PAID_RETURN_TIME?: ThemeParksPaidReturnTime | null;
  readonly RETURN_TIME?: ThemeParksPaidReturnTime | null;
  readonly BOARDING_GROUP?: ThemeParksBoardingGroup | null;
}

/**
 * A scheduled performance occurrence (`showtimes[]`). Times are scoped to the
 * current Park day and emitted as canonical ISO instants (R11.4, R11.9).
 */
export interface ThemeParksShowtime {
  readonly type?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

/**
 * An operating-hours entry (`operatingHours[]`), carrying the open/close
 * instants for the current Park day (R11.4, R11.9).
 */
export interface ThemeParksOperatingHours {
  readonly type?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

/**
 * An hourly forecast entry (`forecast[]`). ThemeParks.wiki labels the predicted
 * wait `waitTime`; a valid entry parses into `{ time, waitTime in [0,1440],
 * percentage in [0,100] }` (R11.4).
 */
export interface ThemeParksForecastEntry {
  readonly time?: string;
  readonly waitTime?: number;
  readonly percentage?: number;
}

/**
 * A walk-up dining-availability entry (`diningAvailability[]`), present for
 * restaurants (R11.5). ThemeParks.wiki labels the estimated wait `waitTime`.
 */
export interface ThemeParksDiningAvailabilityEntry {
  readonly status?: string;
  readonly partySize?: number;
  readonly waitTime?: number;
}

/**
 * One entity's live payload from the ThemeParks.wiki
 * `GET /entity/{externalId}/live` feed — i.e. a single element of the response's
 * `liveData` array, already resolved to the Experience by the entity resolver
 * (task 13.2). Every field is optional so any payload projects (R11.8).
 */
export interface ThemeParksLiveInput {
  /** Raw Operating_Status token, e.g. `"OPERATING"`, `"CLOSED"`, `"DOWN"`. */
  readonly status?: string;
  /** Upstream last-update timestamp. */
  readonly lastUpdated?: string;
  /** The queue object carrying standby/single-rider/LL/boarding-group state. */
  readonly queue?: ThemeParksLiveQueue | null;
  /** Alias source for the Lightning Lane state carried outside `queue`. */
  readonly paidReturnWindow?: ThemeParksPaidReturnTime | null;
  /** Current-day showtimes (R11.4). */
  readonly showtimes?: readonly ThemeParksShowtime[];
  /** Current-day operating hours (R11.4). */
  readonly operatingHours?: readonly ThemeParksOperatingHours[];
  /** Hourly wait-time forecast (R11.4). */
  readonly forecast?: readonly ThemeParksForecastEntry[];
  /** Walk-up dining availability, restaurants only (R11.5). */
  readonly diningAvailability?: readonly ThemeParksDiningAvailabilityEntry[];
  /** Park-local IANA time zone carried on the payload, when present. */
  readonly timezone?: string;
}

// ---------------------------------------------------------------------------
// Status lookup table
// ---------------------------------------------------------------------------

/**
 * Total lookup of the recognized ThemeParks.wiki status tokens. Any token not
 * present here — including a missing status — maps to `Unknown` (R11.8).
 */
const STATUS_BY_TOKEN: Readonly<Record<string, OperatingStatus>> = {
  OPERATING: 'Operating',
  CLOSED: 'Closed',
  DOWN: 'Down',
  REFURBISHMENT: 'Refurbishment',
};

// ---------------------------------------------------------------------------
// Small total helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw status token to an `OperatingStatus`, defaulting to `Unknown` for
 * any unrecognized or missing value (R11.8). Matching is case-insensitive so a
 * lower/mixed-case upstream token still resolves.
 */
function mapStatus(raw: unknown): OperatingStatus {
  if (typeof raw !== 'string') {
    return 'Unknown';
  }
  return STATUS_BY_TOKEN[raw.trim().toUpperCase()] ?? 'Unknown';
}

/**
 * Keep a minute-valued field only when it is an integer in [0, 1440] (R11.3).
 * A missing, non-numeric, non-integer, or out-of-range value is absent.
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
 * Keep an optional integer (e.g. party size, boarding-group bound) only when it
 * is genuinely an integer; otherwise absent.
 */
function validInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * Keep a finite number (e.g. a Lightning Lane price amount); otherwise absent.
 */
function validNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Keep an explicit boolean, or `undefined` when the value is missing or not a
 * boolean (so a boolean is never fabricated from a truthy/falsy proxy).
 */
function validBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Keep a non-empty trimmed string, or `undefined` when the value is missing,
 * not a string, or blank after trimming.
 */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalize a raw timestamp string into a canonical ISO-8601 UTC instant
 * (`Z`-suffixed), or `undefined` when the value is missing or unparseable. The
 * Park-local rendering happens at the display boundary; current-day scoping
 * below uses the Park time zone (R11.9).
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
// Sub-projections
// ---------------------------------------------------------------------------

/**
 * Project the current-day forecast series (R11.4, R11.9): each entry must parse
 * into `{ time, waitMinutes in [0,1440], percentage in [0,100] }` and fall on
 * the current Park day; invalid or off-day entries are dropped, and the result
 * is sorted ascending by instant. Returns `undefined` when the source is absent
 * or yields no valid current-day entry (never fabricating an empty forecast).
 */
function projectForecast(
  entries: readonly ThemeParksForecastEntry[] | undefined,
  now: Date,
  timeZone: string,
): readonly ForecastEntry[] | undefined {
  if (!Array.isArray(entries)) {
    return undefined;
  }
  const result: ForecastEntry[] = [];
  for (const raw of entries) {
    const time = toIsoInstant(raw?.time);
    const waitMinutes = validMinutes(raw?.waitTime);
    const percentage = raw?.percentage;
    if (
      time === undefined ||
      waitMinutes === undefined ||
      typeof percentage !== 'number' ||
      !Number.isFinite(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      continue;
    }
    if (!isCurrentParkDay(new Date(time), now, timeZone)) {
      continue;
    }
    result.push({ time, waitMinutes, percentage });
  }
  if (result.length === 0) {
    return undefined;
  }
  return result.sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
  );
}

/**
 * Project current-day showtimes (R11.4, R11.9): a showtime is any entry with a
 * parseable `startTime` on the current Park day; the end time and the `type`
 * label are each carried only when present and valid.
 */
function projectShowtimes(
  entries: readonly ThemeParksShowtime[] | undefined,
  now: Date,
  timeZone: string,
): readonly Showtime[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const result: Showtime[] = [];
  for (const entry of entries) {
    const start = toIsoInstant(entry?.startTime);
    if (start === undefined) {
      continue;
    }
    if (!isCurrentParkDay(new Date(start), now, timeZone)) {
      continue;
    }
    const end = toIsoInstant(entry?.endTime);
    const type = nonEmptyString(entry?.type);
    result.push({
      start,
      ...(end !== undefined ? { end } : {}),
      ...(type !== undefined ? { type } : {}),
    });
  }
  return result;
}

/**
 * Project current-day operating hours (R11.4, R11.9): an entry needs a
 * parseable `startTime` (open) and `endTime` (close) where the open time falls
 * on the current Park day; the `type` label is carried only when present.
 */
function projectOperatingHours(
  entries: readonly ThemeParksOperatingHours[] | undefined,
  now: Date,
  timeZone: string,
): readonly OperatingHours[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const result: OperatingHours[] = [];
  for (const entry of entries) {
    const open = toIsoInstant(entry?.startTime);
    const close = toIsoInstant(entry?.endTime);
    if (open === undefined || close === undefined) {
      continue;
    }
    if (!isCurrentParkDay(new Date(open), now, timeZone)) {
      continue;
    }
    const type = nonEmptyString(entry?.type);
    result.push({
      open,
      close,
      ...(type !== undefined ? { type } : {}),
    });
  }
  return result;
}

/**
 * Project the walk-up dining availability list (R11.5): one entry per upstream
 * entry, each carrying its status, party size, and estimated wait only when
 * present and valid. A missing or non-array source yields an empty array.
 */
function projectDiningAvailability(
  entries: readonly ThemeParksDiningAvailabilityEntry[] | undefined,
): readonly DiningAvailabilityEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries.map((raw): DiningAvailabilityEntry => {
    const status = nonEmptyString(raw?.status);
    const partySize = validInteger(raw?.partySize);
    const estimatedWaitMinutes = validMinutes(raw?.waitTime);
    return {
      ...(status !== undefined ? { status } : {}),
      ...(partySize !== undefined ? { partySize } : {}),
      ...(estimatedWaitMinutes !== undefined ? { estimatedWaitMinutes } : {}),
    };
  });
}

/**
 * Project the coarse Lightning Lane state from the paid-return-time source
 * (R11.6). Prefers `queue.PAID_RETURN_TIME`, then `queue.RETURN_TIME`, then the
 * top-level `paidReturnWindow`. Each sub-field is carried only when present and
 * valid; returns `undefined` when no sub-field is valid so the field is omitted
 * entirely rather than emitted empty (R11.8).
 */
function projectLightningLane(
  input: ThemeParksLiveInput,
): LightningLaneState | undefined {
  const source =
    input.queue?.PAID_RETURN_TIME ??
    input.queue?.RETURN_TIME ??
    input.paidReturnWindow ??
    undefined;
  if (source === undefined || source === null) {
    return undefined;
  }

  const available = validBoolean(source.available);
  const state = nonEmptyString(source.state);
  const returnStart = toIsoInstant(source.returnStart);
  const returnEnd = toIsoInstant(source.returnEnd);

  const amount = validNumber(source.price?.amount);
  const currency = nonEmptyString(source.price?.currency);
  const price =
    amount !== undefined && currency !== undefined
      ? { amount, currency }
      : undefined;

  if (
    available === undefined &&
    state === undefined &&
    returnStart === undefined &&
    returnEnd === undefined &&
    price === undefined
  ) {
    return undefined;
  }

  return {
    ...(available !== undefined ? { available } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(returnStart !== undefined ? { returnStart } : {}),
    ...(returnEnd !== undefined ? { returnEnd } : {}),
    ...(state !== undefined ? { state } : {}),
  };
}

/**
 * Project the boarding-group / virtual-queue state from `queue.BOARDING_GROUP`
 * (R11.7). Each sub-field is carried only when present and valid; the coarse
 * state is read from `allocationStatus` (ThemeParks.wiki's label) or its `state`
 * alias. Returns `undefined` when no sub-field is valid so the field is omitted
 * entirely rather than emitted empty (R11.8).
 */
function projectBoardingGroup(
  input: ThemeParksLiveInput,
): BoardingGroupState | undefined {
  const source = input.queue?.BOARDING_GROUP ?? undefined;
  if (source === undefined || source === null) {
    return undefined;
  }

  const available = validBoolean(source.available);
  const currentGroupStart = validInteger(source.currentGroupStart);
  const currentGroupEnd = validInteger(source.currentGroupEnd);
  const state = nonEmptyString(source.allocationStatus) ?? nonEmptyString(source.state);

  if (
    available === undefined &&
    currentGroupStart === undefined &&
    currentGroupEnd === undefined &&
    state === undefined
  ) {
    return undefined;
  }

  return {
    ...(available !== undefined ? { available } : {}),
    ...(currentGroupStart !== undefined ? { currentGroupStart } : {}),
    ...(currentGroupEnd !== undefined ? { currentGroupEnd } : {}),
    ...(state !== undefined ? { state } : {}),
  };
}

// ---------------------------------------------------------------------------
// Top-level projection
// ---------------------------------------------------------------------------

/**
 * Project a single ThemeParks.wiki live-data entity into a `LiveDetailDTO`.
 * Total over all inputs: unrecognized / missing / out-of-range values map to
 * the documented absent / `Unknown` / empty representations rather than
 * throwing (R11.8).
 *
 * `status` is always present (`Unknown` when the token is absent or
 * unrecognized). `waitMinutes` / `singleRiderWaitMinutes` come from
 * `queue.STANDBY` / `queue.SINGLE_RIDER`; `forecast` / `showtimes` /
 * `operatingHours` are scoped to the current Park day and emitted as canonical
 * ISO instants; `diningAvailability` from the walk-up entries; and
 * `lightningLane` / `boardingGroup` are carried only when ThemeParks.wiki
 * provides them (R11.6, R11.7).
 *
 * @param input - One entity's ThemeParks.wiki live payload.
 * @param now - The instant used to scope the current Park day (R11.9).
 * @param timeZone - IANA Park time zone; defaults to `WDW_TIME_ZONE`, falling
 *   back to a `timezone` carried on the payload when the default is unchanged.
 * @returns The projected `LiveDetailDTO`.
 */
export function projectThemeParksLive(
  input: ThemeParksLiveInput,
  now: Date,
  timeZone: string = WDW_TIME_ZONE,
): LiveDetailDTO {
  const tz = timeZone === WDW_TIME_ZONE ? nonEmptyString(input.timezone) ?? WDW_TIME_ZONE : timeZone;

  const waitMinutes = validMinutes(input.queue?.STANDBY?.waitTime);
  const singleRiderWaitMinutes = validMinutes(input.queue?.SINGLE_RIDER?.waitTime);
  const forecast = projectForecast(input.forecast, now, tz);
  const lightningLane = projectLightningLane(input);
  const boardingGroup = projectBoardingGroup(input);
  const upstreamLastUpdated = toIsoInstant(input.lastUpdated);

  return {
    status: mapStatus(input.status),
    ...(waitMinutes !== undefined ? { waitMinutes } : {}),
    ...(singleRiderWaitMinutes !== undefined ? { singleRiderWaitMinutes } : {}),
    ...(forecast !== undefined ? { forecast } : {}),
    showtimes: projectShowtimes(input.showtimes, now, tz),
    operatingHours: projectOperatingHours(input.operatingHours, now, tz),
    diningAvailability: projectDiningAvailability(input.diningAvailability),
    ...(lightningLane !== undefined ? { lightningLane } : {}),
    ...(boardingGroup !== undefined ? { boardingGroup } : {}),
    ...(upstreamLastUpdated !== undefined ? { upstreamLastUpdated } : {}),
  };
}

/** Re-export the Park time-zone constant for callers constructing scope. */
export { WDW_TIME_ZONE };
