/**
 * Pure Disney-sourced live projection.
 *
 * `projectLiveDetail(input, ctx)` is the Disney-sourced replacement for
 * `services/live/project.ts`. It projects the Experience's documents from the
 * four live Sync Gateway channels — Status (`wdw.facilitystatus.1_0`),
 * Dining-Status (`wdw.diningfacilitystatus.1_0`), Forecast
 * (`wdw.forecastedwaittimes.1_0.en_us`), and Schedule (`wdw.today.1_0.{Type}`)
 * — into the strict `LiveDetailDTO` domain model (design.md → "8. Live
 * projection", Requirement 9).
 *
 * Mirroring the purity discipline of the retired ThemeParks.wiki projection and
 * the sibling pure cores (`classifyFacility.ts`, `enrich.ts`, `imagery.ts`), it
 * is intentionally:
 *
 *   - **Pure**: depends only on its arguments; no I/O, no globals, and no
 *     ambient clock — the "current day" and the Park time zone arrive via
 *     `ProjectionContext`.
 *   - **Total**: always returns a complete `LiveDetailDTO`; it never throws.
 *     The Disney sources are undocumented and reverse-engineered, so every
 *     missing, malformed, or out-of-range value maps to its documented absent /
 *     `Unknown` / empty representation rather than failing (R9.6).
 *   - **Deterministic**: equal inputs always produce equal outputs, which makes
 *     it a sound property-test target (task 5.12, Property 19).
 *
 * Mapping rules (each maps directly to an acceptance criterion):
 *
 *   - Operating_Status (R9.2, R9.6): a total, case-insensitive lookup of the
 *     recognized status tokens from the Status doc, with an `Unknown` default;
 *     `status` is the one field that is always present.
 *   - Wait_Time / Single_Rider_Wait (R9.2): kept only when an integer in
 *     [0, 1440]; otherwise absent.
 *   - Dining_Availability (R9.3): one entry per upstream party-size entry from
 *     the Dining-Status doc, each carrying its status, party size, and
 *     estimated wait only when present and valid; an empty array when absent.
 *   - Wait_Time_Forecast (R9.4): an ordered series from the Forecast doc; the
 *     whole forecast degrades to absent when it is missing or any entry is
 *     unparseable into `{ time, waitMinutes in [0,1440], percentage in
 *     [0,100] }`, while every other field is still projected.
 *   - Showtimes / Operating_Hours (R9.5): only current-day entries from the
 *     Schedule docs, split by schedule type into operating hours (open+close)
 *     and showtimes (start, optional end), each with an optional `type` label.
 *   - Times (R9.8): current-day scoping uses the Park time zone from `ctx`
 *     (`WDW_TIME_ZONE`); instants are emitted as canonical ISO-8601 so the App
 *     renders them in Park-local time at the display boundary.
 *
 * Out of scope (R9.7, R15.4, R15.5, R15.6): Lightning Lane return windows
 * (`returnWindow` / `paidReturnWindow`), boarding-group / virtual-queue
 * information, and the Individual Lightning Lane price are never read or
 * emitted — the revised `LiveDetailDTO` has no field for them.
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 15.4, 15.5, 15.6
 */

import type {
  DiningAvailabilityEntry,
  ForecastEntry,
  LiveDetailDTO,
  OperatingHours,
  OperatingStatus,
  Showtime,
} from '@dwt/shared';

import { isCurrentParkDay, WDW_TIME_ZONE } from '../../live/parkTime.js';

// ---------------------------------------------------------------------------
// Projection context
// ---------------------------------------------------------------------------

/**
 * The ambient information the projection needs but must not read from globals.
 * Keeping the clock and time zone in the context is what makes the projection
 * pure and deterministic. Relocated here from the retired ThemeParks.wiki
 * projection (`services/live/project.ts`) so the surviving Disney live modules
 * own the type they depend on.
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
// Raw Disney channel document shapes (tolerant / defensive)
// ---------------------------------------------------------------------------

/**
 * A live status/wait document from the Status_Channel
 * (`wdw.facilitystatus.1_0`). Every field is optional so a partial payload
 * still projects (R9.6): a missing `status` becomes `Unknown`, and a missing or
 * out-of-range wait becomes absent.
 */
export interface StatusDoc {
  /** Raw Operating_Status token, e.g. `"Operating"`, `"Closed"`, `"Down"`. */
  readonly status?: string;
  /** Standby wait in whole minutes (R9.2). */
  readonly waitMinutes?: number;
  /** Single_Rider_Wait in whole minutes (R9.2). */
  readonly singleRiderWaitMinutes?: number;
  /** Upstream last-update timestamp. */
  readonly lastUpdate?: string;
}

/**
 * One walk-up party-size entry inside a {@link DiningStatusDoc}. Each field is
 * carried only when present and valid (R9.3).
 */
export interface DiningStatusEntry {
  /** Walk-up availability status for the party size (R9.3). */
  readonly status?: string;
  /** Party size the entry applies to (R9.3). */
  readonly partySize?: number;
  /** Estimated wait in whole minutes (R9.3). */
  readonly estimatedWaitMinutes?: number;
}

/**
 * A walk-up dining-availability document from the Dining_Status_Channel
 * (`wdw.diningfacilitystatus.1_0`), present only for restaurants. The
 * per-party-size entries are carried under `availability`; a missing list
 * projects to an empty `diningAvailability` array (R9.3).
 */
export interface DiningStatusDoc {
  /** Per-party-size walk-up availability entries (R9.3). */
  readonly availability?: readonly DiningStatusEntry[];
  /** Upstream last-update timestamp. */
  readonly lastUpdate?: string;
}

/**
 * One hourly entry inside a {@link ForecastDoc}. An entry is valid only when it
 * parses into `{ time, waitMinutes in [0,1440], percentage in [0,100] }`
 * (R9.4).
 */
export interface ForecastDocEntry {
  /** Forecast instant timestamp. */
  readonly time?: string;
  /** Predicted standby wait in whole minutes (R9.4). */
  readonly waitMinutes?: number;
  /** Relative busyness percentage, 0 to 100 (R9.4). */
  readonly percentage?: number;
}

/**
 * An hourly wait-time forecast document from the Forecast_Channel
 * (`wdw.forecastedwaittimes.1_0.en_us`). The whole forecast degrades to absent
 * when the list is missing or any entry is unparseable (R9.4, R9.6).
 */
export interface ForecastDoc {
  /** Ordered hourly forecast entries (R9.4). */
  readonly forecasts?: readonly ForecastDocEntry[];
  /** Upstream last-update timestamp. */
  readonly lastUpdate?: string;
}

/**
 * One schedule entry inside a {@link ScheduleDoc}. `type` distinguishes
 * operating hours from showtimes (see {@link OPERATING_HOURS_TYPE_TOKENS}); the
 * start/end timestamps scope the entry to the current Park day (R9.5).
 */
export interface ScheduleEntry {
  /** Schedule_Type / Operating_Hours_Type label, e.g. `"Operating"`. */
  readonly type?: string;
  /** Start instant of the entry, current day. */
  readonly startTime?: string;
  /** End instant of the entry. */
  readonly endTime?: string;
}

/**
 * A current-day schedule document from the Schedule_Channel
 * (`wdw.today.1_0.{Type}`), carrying showtimes and operating hours for one
 * Experience (R9.5). Multiple documents may be provided (one per entity type),
 * so the projection accepts a list of them.
 */
export interface ScheduleDoc {
  /** The schedule entries carried by this document (R9.5). */
  readonly schedules?: readonly ScheduleEntry[];
  /** Upstream last-update timestamp. */
  readonly lastUpdate?: string;
}

/**
 * The set of documents the live projection consumes for a single Experience.
 * Every input is optional: an Experience may have none, some, or all of the
 * four live documents present (R9.6).
 */
export interface LiveProjectionInput {
  /** Status_Channel document (R9.2). */
  readonly status?: StatusDoc;
  /** Dining_Status_Channel document, restaurants only (R9.3). */
  readonly diningStatus?: DiningStatusDoc;
  /** Forecast_Channel document (R9.4). */
  readonly forecast?: ForecastDoc;
  /** Current-day Schedule_Channel documents (R9.5). */
  readonly schedule?: readonly ScheduleDoc[];
}

// ---------------------------------------------------------------------------
// Status lookup + schedule-type classification tables
// ---------------------------------------------------------------------------

/**
 * Total lookup of the recognized upstream status tokens. Any token not present
 * here — including a missing status — maps to `Unknown` (R9.6).
 */
const STATUS_BY_TOKEN: Readonly<Record<string, OperatingStatus>> = {
  OPERATING: 'Operating',
  CLOSED: 'Closed',
  DOWN: 'Down',
  REFURBISHMENT: 'Refurbishment',
};

/**
 * Normalized Schedule_Type tokens that denote Park operating hours rather than
 * a performance showtime. A schedule entry whose normalized `type` is in this
 * set is projected as an {@link OperatingHours} entry; every other entry is
 * projected as a {@link Showtime} (R9.5).
 *
 * Normalization uppercases the token and collapses spaces and hyphens to
 * underscores, so `"Extra Magic Hours"` and `"extra-magic-hours"` both match
 * `EXTRA_MAGIC_HOURS`.
 */
const OPERATING_HOURS_TYPE_TOKENS: ReadonlySet<string> = new Set([
  'OPERATING',
  'EXTRA_MAGIC_HOURS',
  'EXTRA_MAGIC_HOUR',
  'EARLY_ENTRY',
  'EARLY_PARK_ENTRY',
  'EXTENDED_EVENING',
  'EXTENDED_EVENING_HOURS',
  'SPECIAL_TICKETED_EVENT',
]);

// ---------------------------------------------------------------------------
// Small total helpers
// ---------------------------------------------------------------------------

/**
 * Map a raw status token to an `OperatingStatus`, defaulting to `Unknown` for
 * any unrecognized or missing value (R9.2, R9.6). Matching is case-insensitive
 * so a lower/mixed-case upstream token still resolves.
 */
function mapStatus(raw: string | undefined): OperatingStatus {
  if (typeof raw !== 'string') {
    return 'Unknown';
  }
  return STATUS_BY_TOKEN[raw.toUpperCase()] ?? 'Unknown';
}

/**
 * Keep a minute-valued field only when it is an integer in [0, 1440] (R9.2,
 * R9.3, R9.4). A missing, non-numeric, non-integer, or out-of-range value is
 * represented as absent (`undefined`).
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
 * Keep an optional integer (e.g. party size) only when it is genuinely an
 * integer; otherwise absent.
 */
function validInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
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
 * (`Z`-suffixed), or `undefined` when the value is missing or unparseable.
 *
 * Upstream timestamps may carry a zone offset; normalizing through `Date`
 * yields the absolute instant in the canonical wire form the DTO schema
 * expects. The Park-local rendering of the instant happens at the display
 * boundary, while the current-day scoping below uses `ctx.parkTimeZone`
 * (R9.8).
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

/**
 * Normalize a Schedule_Type label for membership testing against
 * {@link OPERATING_HOURS_TYPE_TOKENS}: uppercase, with spaces and hyphens
 * collapsed to underscores.
 */
function normalizeScheduleType(type: string): string {
  return type.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

// ---------------------------------------------------------------------------
// Dining / forecast / schedule projections
// ---------------------------------------------------------------------------

/**
 * Project the walk-up dining availability list (R9.3): exactly one entry per
 * upstream party-size entry, each carrying its status, party size, and
 * estimated wait only when present and valid. A missing or absent list yields
 * an empty array (never absent).
 */
function projectDiningAvailability(
  doc: DiningStatusDoc | undefined,
): readonly DiningAvailabilityEntry[] {
  if (doc === undefined || !Array.isArray(doc.availability)) {
    return [];
  }
  return doc.availability.map((raw): DiningAvailabilityEntry => {
    const status = nonEmptyString(raw?.status);
    const partySize = validInteger(raw?.partySize);
    const estimatedWaitMinutes = validMinutes(raw?.estimatedWaitMinutes);
    return {
      ...(status !== undefined ? { status } : {}),
      ...(partySize !== undefined ? { partySize } : {}),
      ...(estimatedWaitMinutes !== undefined ? { estimatedWaitMinutes } : {}),
    };
  });
}

/**
 * Project the forecast series (R9.4). Returns `undefined` when the forecast is
 * missing or when ANY entry fails to parse into `{ time, waitMinutes in
 * [0,1440], percentage in [0,100] }` — degrading the whole forecast in
 * isolation while every other field is still projected (R9.6). When every
 * entry parses, the upstream order is preserved.
 */
function projectForecast(
  doc: ForecastDoc | undefined,
): readonly ForecastEntry[] | undefined {
  if (doc === undefined || !Array.isArray(doc.forecasts)) {
    return undefined;
  }
  const entries: ForecastEntry[] = [];
  for (const raw of doc.forecasts) {
    const time = toIsoInstant(raw?.time);
    const waitMinutes = validMinutes(raw?.waitMinutes);
    const percentage = raw?.percentage;
    if (
      time === undefined ||
      waitMinutes === undefined ||
      typeof percentage !== 'number' ||
      Number.isNaN(percentage) ||
      percentage < 0 ||
      percentage > 100
    ) {
      // Any unparseable entry collapses the whole forecast to absent (R9.6).
      return undefined;
    }
    entries.push({ time, waitMinutes, percentage });
  }
  return entries;
}

/**
 * Decide whether a schedule entry denotes Park operating hours. An entry with a
 * recognized operating-hours `type` (see {@link OPERATING_HOURS_TYPE_TOKENS})
 * is treated as operating hours; every other entry — including one with an
 * absent or unrecognized `type` — is treated as a showtime (R9.5).
 */
function isOperatingHoursEntry(entry: ScheduleEntry): boolean {
  const type = nonEmptyString(entry.type);
  if (type === undefined) {
    return false;
  }
  return OPERATING_HOURS_TYPE_TOKENS.has(normalizeScheduleType(type));
}

/**
 * Flatten the schedule documents into a single ordered entry list, preserving
 * document and in-document order. A missing list or a document without
 * `schedules` contributes nothing.
 */
function scheduleEntries(
  docs: readonly ScheduleDoc[] | undefined,
): readonly ScheduleEntry[] {
  if (!Array.isArray(docs)) {
    return [];
  }
  const entries: ScheduleEntry[] = [];
  for (const doc of docs) {
    if (doc !== undefined && Array.isArray(doc.schedules)) {
      entries.push(...doc.schedules);
    }
  }
  return entries;
}

/**
 * Project current-day showtimes (R9.5). A showtime entry is any non
 * operating-hours schedule entry with a parseable start that falls on the
 * current Park day; the end time and the `type` label are each carried iff
 * present and valid.
 */
function projectShowtimes(
  entries: readonly ScheduleEntry[],
  ctx: ProjectionContext,
): readonly Showtime[] {
  const result: Showtime[] = [];
  for (const entry of entries) {
    if (isOperatingHoursEntry(entry)) {
      continue;
    }
    const start = toIsoInstant(entry.startTime);
    if (start === undefined) {
      continue;
    }
    if (!isCurrentParkDay(new Date(start), ctx.now, ctx.parkTimeZone)) {
      continue;
    }
    const end = toIsoInstant(entry.endTime);
    const type = nonEmptyString(entry.type);
    result.push({
      start,
      ...(end !== undefined ? { end } : {}),
      ...(type !== undefined ? { type } : {}),
    });
  }
  return result;
}

/**
 * Project current-day operating hours (R9.5). An operating-hours entry is a
 * schedule entry whose `type` is a recognized operating-hours token, with a
 * parseable open and close where the open time falls on the current Park day;
 * the `type` label is carried iff present.
 */
function projectOperatingHours(
  entries: readonly ScheduleEntry[],
  ctx: ProjectionContext,
): readonly OperatingHours[] {
  const result: OperatingHours[] = [];
  for (const entry of entries) {
    if (!isOperatingHoursEntry(entry)) {
      continue;
    }
    const open = toIsoInstant(entry.startTime);
    const close = toIsoInstant(entry.endTime);
    if (open === undefined || close === undefined) {
      continue;
    }
    if (!isCurrentParkDay(new Date(open), ctx.now, ctx.parkTimeZone)) {
      continue;
    }
    const type = nonEmptyString(entry.type);
    result.push({
      open,
      close,
      ...(type !== undefined ? { type } : {}),
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Top-level projection
// ---------------------------------------------------------------------------

/**
 * Project the Disney live documents for a single Experience into a
 * `LiveDetailDTO`. Total over all inputs: unrecognized / missing / out-of-range
 * values map to the documented absent / `Unknown` / empty representations
 * rather than throwing (R9.6).
 *
 * `status` is always present (`Unknown` when the Status doc is absent or its
 * token is unrecognized). `waitMinutes` and `singleRiderWaitMinutes` come from
 * the Status doc; `diningAvailability` from the Dining-Status doc; `forecast`
 * from the Forecast doc; and `showtimes` / `operatingHours` from the current-day
 * Schedule docs, scoped to the Park time zone from `ctx` (R9.8). Lightning Lane
 * / boarding-group / ILL fields are never emitted (R9.7, R15.4, R15.5, R15.6).
 *
 * @param input - The Status, Dining-Status, Forecast, and Schedule documents.
 * @param ctx - The Park time zone and the instant used to scope the current day.
 * @returns The projected `LiveDetailDTO`.
 */
export function projectLiveDetail(
  input: LiveProjectionInput,
  ctx: ProjectionContext,
): LiveDetailDTO {
  const status = input.status;

  const waitMinutes = validMinutes(status?.waitMinutes);
  const singleRiderWaitMinutes = validMinutes(status?.singleRiderWaitMinutes);
  const forecast = projectForecast(input.forecast);
  const entries = scheduleEntries(input.schedule);

  const upstreamLastUpdated =
    toIsoInstant(status?.lastUpdate) ??
    toIsoInstant(input.diningStatus?.lastUpdate) ??
    toIsoInstant(input.forecast?.lastUpdate);

  return {
    status: mapStatus(status?.status),
    ...(waitMinutes !== undefined ? { waitMinutes } : {}),
    ...(singleRiderWaitMinutes !== undefined ? { singleRiderWaitMinutes } : {}),
    ...(forecast !== undefined ? { forecast } : {}),
    showtimes: projectShowtimes(entries, ctx),
    operatingHours: projectOperatingHours(entries, ctx),
    diningAvailability: projectDiningAvailability(input.diningStatus),
    ...(upstreamLastUpdated !== undefined ? { upstreamLastUpdated } : {}),
  };
}

/** Re-export the Park time-zone constant for callers constructing a context. */
export { WDW_TIME_ZONE };
