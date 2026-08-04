/**
 * ThemeParks.wiki live HTTP client.
 *
 * Thin, typed wrapper around the single upstream endpoint the
 * `Live_Service` reads per design.md section 8a and Requirements R11.1,
 * R11.2:
 *
 *   - `GET /entity/{externalId}/live` → `getEntityLive(externalId)`
 *
 * Design notes:
 *
 *   1. **Not a Disney source.** ThemeParks.wiki is a third-party API, so
 *      this client MUST NOT route through the `Disney_Transport`
 *      (R11.10). It instead mirrors the transport discipline of
 *      `createThemeParksClient` in `../catalog/themeparks.ts`: an
 *      injected `FetchLike` defaulting to the global `fetch`, base URL
 *      normalization, a bare `GET` with `Accept: application/json`, a
 *      single typed `UpstreamError` for every failure mode, and a
 *      defensive top-level shape assertion.
 *
 *   2. **Shared error type.** Every failure — non-2xx HTTP status,
 *      transport error, malformed JSON, request abort — surfaces as the
 *      same `UpstreamError` the catalog client raises, imported from
 *      `../catalog/themeparks.js`. The live service catches a single
 *      class and falls back to stale-serve or 503 (design.md 8c).
 *
 *   3. **Tolerant projection.** The pure projection (task 13.4,
 *      `themeParksLiveProject.ts`) consumes this shape, so the wire types
 *      here are a minimal, deliberately loose projection: only the
 *      top-level `liveData` array is required; every field inside a live
 *      entry is optional. Absent optional fields are tolerated rather
 *      than rejected so upstream evolution never breaks the read path.
 *      The projection is responsible for omitting absent/unparseable
 *      fields (R11.8).
 *
 *   4. **No retries / no caching.** Both concerns belong to the live
 *      service (deadline + `Live_Cache`). Keeping this client a single
 *      round-trip per call makes its behaviour straightforward to reason
 *      about and to fake.
 *
 * Validates: Requirements 11.1, 11.2.
 */

import {
  UpstreamError,
  THEMEPARKS_DEFAULT_BASE_URL,
  type FetchLike,
} from '../catalog/themeparks.js';

// ---------------------------------------------------------------------------
// Wire-shape types — minimal tolerant projection of the v1 `/live` schema
// ---------------------------------------------------------------------------

/**
 * A single queue-type entry. ThemeParks.wiki keys the `queue` object by
 * queue type (`STANDBY`, `SINGLE_RIDER`, `RETURN_TIME`,
 * `PAID_RETURN_TIME`, `BOARDING_GROUP`). Every field is optional because
 * the shape varies by queue type; the projection reads only what each
 * type carries.
 */
export interface ThemeParksQueueEntry {
  /** Standby / single-rider wait in whole minutes. */
  readonly waitTime?: number | null;
  /** Coarse state label, e.g. `'AVAILABLE'` | `'SOLD_OUT'` | `'CLOSED'`. */
  readonly state?: string;
  /** ISO instant when a (paid) return window opens. */
  readonly returnStart?: string | null;
  /** ISO instant when a (paid) return window closes. */
  readonly returnEnd?: string | null;
  /** Paid-return-time price (Lightning Lane). */
  readonly price?: {
    readonly amount?: number;
    readonly currency?: string;
    readonly formatted?: string;
  };
  /** Boarding-group allocation status, e.g. `'AVAILABLE'` | `'PAUSED'`. */
  readonly allocationStatus?: string;
  /** Current boarding-group range (virtual queue). */
  readonly currentGroupStart?: number | null;
  readonly currentGroupEnd?: number | null;
  readonly estimatedWait?: number | null;
  readonly nextAllocationTime?: string | null;
}

/**
 * The `queue` object of a live entry. Keyed by the queue type token.
 * Named keys are surfaced for convenience; the index signature keeps the
 * type tolerant of queue types the projection does not yet read.
 */
export interface ThemeParksQueue {
  readonly STANDBY?: ThemeParksQueueEntry;
  readonly SINGLE_RIDER?: ThemeParksQueueEntry;
  readonly RETURN_TIME?: ThemeParksQueueEntry;
  readonly PAID_RETURN_TIME?: ThemeParksQueueEntry;
  readonly BOARDING_GROUP?: ThemeParksQueueEntry;
  readonly [queueType: string]: ThemeParksQueueEntry | undefined;
}

/** A single showtime entry. */
export interface ThemeParksShowtime {
  readonly type?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

/** A single operating-hours entry for the current park day. */
export interface ThemeParksOperatingHours {
  readonly type?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

/** A single wait-time forecast entry. */
export interface ThemeParksForecastEntry {
  readonly time?: string;
  readonly waitTime?: number | null;
  readonly percentage?: number | null;
}

/** A single walk-up dining availability entry. */
export interface ThemeParksDiningAvailabilityEntry {
  readonly partySize?: number | null;
  readonly waitTime?: number | null;
  readonly id?: string;
}

/**
 * One entry in the `liveData` array. All fields optional so the
 * projection decides what to read and what to omit; only the array's
 * presence is enforced by the client.
 */
export interface ThemeParksLiveEntry {
  readonly id?: string;
  readonly name?: string;
  readonly entityType?: string;
  /** Operating status token, e.g. `'OPERATING'` | `'CLOSED'` | `'DOWN'`. */
  readonly status?: string;
  /** ISO instant of the upstream's last update for this entry. */
  readonly lastUpdated?: string;
  readonly queue?: ThemeParksQueue;
  readonly showtimes?: readonly ThemeParksShowtime[];
  readonly operatingHours?: readonly ThemeParksOperatingHours[];
  readonly forecast?: readonly ThemeParksForecastEntry[];
  readonly diningAvailability?: readonly ThemeParksDiningAvailabilityEntry[];
}

/**
 * Response body of `GET /entity/{externalId}/live`.
 *
 * The envelope carries the resolved entity's id/name/entityType and its
 * IANA `timezone` (used by the projection to scope times to the park
 * day, R11.9), plus the `liveData` array. Only `liveData` (an array) is
 * asserted; everything else is tolerated when absent.
 */
export interface ThemeParksLiveResponse {
  readonly id?: string;
  readonly name?: string;
  readonly entityType?: string;
  readonly timezone?: string;
  readonly liveData: readonly ThemeParksLiveEntry[];
}

export interface ThemeParksPurchase {
  readonly id?: string;
  readonly name?: string;
  readonly type?: string;
  readonly price?: {
    readonly amount?: number;
    readonly currency?: string;
  };
  readonly available?: boolean;
}

export interface ThemeParksScheduleEntry {
  readonly date?: string;
  readonly type?: string;
  readonly openingTime?: string;
  readonly closingTime?: string;
  readonly description?: string;
  readonly purchases?: readonly ThemeParksPurchase[];
}

export interface ThemeParksScheduleResponse {
  readonly id?: string;
  readonly name?: string;
  readonly entityType?: string;
  readonly timezone?: string;
  readonly schedule: readonly ThemeParksScheduleEntry[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ThemeParksLiveClientOptions {
  /**
   * Base URL for the API. Trailing slashes are tolerated. Defaults to
   * `THEMEPARKS_DEFAULT_BASE_URL` when omitted.
   */
  readonly baseUrl?: string;
  /**
   * Override the HTTP transport. Defaults to `globalThis.fetch`. Tests
   * inject a fake here; the rest of the codebase never does.
   */
  readonly fetch?: FetchLike;
}

/**
 * Public surface of the ThemeParks.wiki live client.
 */
export interface ThemeParksLiveClient {
  /**
   * Fetch the live feed for the entity whose ThemeParks.wiki
   * `External_Id` equals `externalId` (the Experience's `Enterprise_Id`,
   * R11.2). Returns the tolerant parsed body; raises `UpstreamError` on
   * any failure.
   */
  getEntityLive(externalId: string, signal?: AbortSignal): Promise<ThemeParksLiveResponse>;
  /**
   * Fetch the schedule feed for the entity. Returns the tolerant parsed body;
   * raises `UpstreamError` on any failure.
   */
  getEntitySchedule(externalId: string, signal?: AbortSignal): Promise<ThemeParksScheduleResponse>;
}

/**
 * Construct a ThemeParks.wiki live client.
 *
 * Mirrors `createThemeParksClient`: a plain-object factory with an
 * injected transport. This is HTTP only — no clock, no cache, no
 * retries.
 */
export function createThemeParksLiveClient(
  options: ThemeParksLiveClientOptions = {},
): ThemeParksLiveClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? THEMEPARKS_DEFAULT_BASE_URL);
  const fetchImpl: FetchLike = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    // Defensive: fail at construction time rather than at the first
    // request when the host runtime lacks `fetch` and none was injected.
    throw new Error(
      'createThemeParksLiveClient: no fetch implementation available; ' +
        'pass `options.fetch` or run on a runtime with a global `fetch`.',
    );
  }

  return {
    async getEntityLive(
      externalId: string,
      signal?: AbortSignal,
    ): Promise<ThemeParksLiveResponse> {
      // `externalId` is interpolated into the path; encode to keep the
      // request safe against ids that contain reserved URL characters.
      const url = `${baseUrl}/entity/${encodeURIComponent(externalId)}/live`;
      const body = await requestJson(fetchImpl, url, signal);
      return assertLiveResponse(body, url);
    },

    async getEntitySchedule(
      externalId: string,
      signal?: AbortSignal,
    ): Promise<ThemeParksScheduleResponse> {
      const url = `${baseUrl}/entity/${encodeURIComponent(externalId)}/schedule`;
      const body = await requestJson(fetchImpl, url, signal);
      return assertScheduleResponse(body, url);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip trailing slashes from the configured base URL so that path
 * concatenation never produces `//` segments.
 */
function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/u, '');
}

/**
 * Issue a GET request and parse the body as JSON. Translates every
 * failure mode into a typed `UpstreamError`.
 */
async function requestJson(
  fetchImpl: FetchLike,
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // Only forward `signal` when supplied so we don't emit
      // `signal: undefined` under `exactOptionalPropertyTypes`.
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (cause) {
    if (isAbortError(cause)) {
      throw new UpstreamError('aborted', `Request to ${url} was aborted.`, {
        url,
        cause,
      });
    }
    throw new UpstreamError(
      'network',
      `Network error contacting ${url}: ${describeError(cause)}`,
      { url, cause },
    );
  }

  if (!response.ok) {
    throw new UpstreamError(
      'http_status',
      `Upstream ${url} returned HTTP ${response.status}.`,
      { status: response.status, url },
    );
  }

  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    throw new UpstreamError(
      'invalid_response',
      `Upstream ${url} returned a non-JSON body.`,
      { url, cause },
    );
  }
}

/**
 * Validate the minimum shape of `GET /entity/{externalId}/live`: a plain
 * object carrying a `liveData` array. Every field inside is optional and
 * passes through untouched — the pure projection (task 13.4) owns
 * per-field tolerance. A wholly missing or non-object payload, or a
 * missing `liveData` array, is an `invalid_response` upstream error.
 */
function assertLiveResponse(body: unknown, url: string): ThemeParksLiveResponse {
  if (!isPlainObject(body)) {
    throw new UpstreamError('invalid_response', `Upstream ${url} returned a non-object body.`, {
      url,
    });
  }
  const liveData = (body as Record<string, unknown>)['liveData'];
  if (!Array.isArray(liveData)) {
    throw new UpstreamError(
      'invalid_response',
      `Upstream ${url} response is missing the \`liveData\` array.`,
      { url },
    );
  }
  // Required top-level array verified above; the `unknown` hop satisfies
  // TS that we know more than its narrowing shows. Per-entry fields are
  // deliberately left untyped-tolerant for the projection.
  return body as unknown as ThemeParksLiveResponse;
}

function assertScheduleResponse(body: unknown, url: string): ThemeParksScheduleResponse {
  if (!isPlainObject(body)) {
    throw new UpstreamError('invalid_response', `Upstream ${url} returned a non-object body.`, { url });
  }
  const schedule = (body as Record<string, unknown>)['schedule'];
  if (!Array.isArray(schedule)) {
    throw new UpstreamError('invalid_response', `Upstream ${url} response is missing the \`schedule\` array.`, { url });
  }
  return body as unknown as ThemeParksScheduleResponse;
}

/** True for plain JSON-like objects (i.e. not arrays, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Best-effort string description of an unknown thrown value. */
function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return 'unknown error';
}

/**
 * Recognize a thrown `AbortError` from any of the common shapes:
 *   - `DOMException` with `name === 'AbortError'` (browser/undici);
 *   - generic `Error` whose `name` is `'AbortError'`;
 *   - any object with `name === 'AbortError'`.
 */
function isAbortError(cause: unknown): boolean {
  if (cause instanceof Error && cause.name === 'AbortError') {
    return true;
  }
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    (cause as { name?: unknown }).name === 'AbortError'
  ) {
    return true;
  }
  return false;
}
