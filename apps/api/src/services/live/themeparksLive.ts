/**
 * ThemeParks.wiki live HTTP client.
 *
 * Thin, typed wrapper around the single upstream endpoint used by the
 * Live_Service per design.md "ThemeParks live client" and Requirements
 * R1.1, R1.8, R2.6:
 *
 *   - `GET /entity/{id}/live`  → `getEntityLive(id, signal?)`
 *
 * Design notes:
 *
 *   1. **Modeled on `createThemeParksClient`.** This client reuses the same
 *      `UpstreamError` discriminated-failure type
 *      (`http_status | network | invalid_response | aborted`) and the
 *      injected `FetchLike` / `baseUrl` pattern as the catalog client, so
 *      the base URL still flows from `AppConfig.themeparks.baseUrl` and tests
 *      inject a fake `fetch` without monkey-patching.
 *
 *   2. **Gross-shape validation only.** Unlike the catalog client, the live
 *      client validates only the *gross* shape: the top-level body is an
 *      object and `liveData` is an array of objects. It deliberately does NOT
 *      validate field-by-field — that is the projection's job
 *      (`projectLiveDetail`), so that a recognized-but-partial payload still
 *      projects whatever it can (R1.10, R1.17). A wholly unparseable body
 *      (non-JSON, non-object, or missing/!array `liveData`) is surfaced as
 *      `UpstreamError('invalid_response')`, which the orchestrator treats as
 *      a failed retrieval (R1.8).
 *
 *   3. **Deadline-aware.** `getEntityLive` forwards an optional `AbortSignal`
 *      into `fetch` so the orchestrator's 5-second deadline (R2.6) can cancel
 *      an in-flight request. An aborted request surfaces as
 *      `UpstreamError('aborted')`.
 *
 * Validates: Requirements 1.1, 1.8, 2.6.
 */

import {
  UpstreamError,
  THEMEPARKS_DEFAULT_BASE_URL,
  type FetchLike,
} from '../catalog/themeparks.js';

// ---------------------------------------------------------------------------
// Wire-shape types — minimal, tolerant projection of the live payload
// ---------------------------------------------------------------------------

/**
 * Single entity's live entry from `GET /entity/{id}/live`.
 *
 * Modeled as fully optional / `unknown`-tolerant: every field is optional and
 * validated downstream inside `projectLiveDetail`, so neither this client nor
 * the projection ever throws on a partial or surprising payload. The verified
 * real responses are treated as ground truth over the published OpenAPI schema
 * (see requirements Assumptions).
 */
export interface ThemeParksLiveEntry {
  readonly id?: string;
  /** OPERATING | CLOSED | DOWN | REFURBISHMENT | ... */
  readonly status?: string;
  /** Upstream freshness timestamp → Upstream_Last_Updated. */
  readonly lastUpdated?: string;
  readonly queue?: {
    readonly STANDBY?: { readonly waitTime?: number | null };
    readonly SINGLE_RIDER?: { readonly waitTime?: number | null };
    readonly RETURN_TIME?: {
      readonly state?: string;
      readonly returnStart?: string;
      readonly returnEnd?: string;
    };
    readonly PAID_RETURN_TIME?: {
      readonly state?: string;
      readonly returnStart?: string;
      readonly returnEnd?: string;
      readonly price?: {
        readonly amount?: number;
        readonly currency?: string;
        readonly formatted?: string;
      };
    };
    readonly BOARDING_GROUP?: {
      readonly allocationStatus?: string;
      readonly currentGroupStart?: number;
      readonly currentGroupEnd?: number;
      readonly nextAllocationTime?: string;
      readonly estimatedWait?: number;
    };
  };
  readonly showtimes?: readonly {
    readonly type?: string;
    readonly startTime?: string;
    readonly endTime?: string;
  }[];
  readonly operatingHours?: readonly {
    readonly type?: string;
    readonly startTime?: string;
    readonly endTime?: string;
  }[];
  readonly diningAvailability?: readonly {
    readonly partySize?: number;
    readonly waitTime?: number;
  }[];
  readonly forecast?: readonly {
    readonly time?: string;
    readonly waitTime?: number;
    readonly percentage?: number;
  }[];
}

/** Response body of `GET /entity/{id}/live`. */
export interface ThemeParksLiveResponse {
  readonly id?: string;
  readonly name?: string;
  readonly entityType?: string;
  readonly timezone?: string;
  readonly liveData: readonly ThemeParksLiveEntry[];
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
   * Override the HTTP transport. Defaults to `globalThis.fetch`. Tests inject
   * a fake here; the rest of the codebase never does.
   */
  readonly fetch?: FetchLike;
}

export interface ThemeParksLiveClient {
  /**
   * `GET /entity/{id}/live`. Returns the parsed body on a 2xx response, or
   * throws `UpstreamError` on non-2xx (`http_status`), transport error
   * (`network`), abort/deadline (`aborted`), or a non-JSON / wrong-shape body
   * (`invalid_response`). `signal` carries the 5-second deadline (R2.6).
   */
  getEntityLive(
    upstreamId: string,
    signal?: AbortSignal,
  ): Promise<ThemeParksLiveResponse>;
}

/**
 * Construct a ThemeParks.wiki live client. Returning a plain object (rather
 * than a class) keeps the surface narrow and matches `createThemeParksClient`.
 */
export function createThemeParksLiveClient(
  options: ThemeParksLiveClientOptions = {},
): ThemeParksLiveClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? THEMEPARKS_DEFAULT_BASE_URL);
  const fetchImpl: FetchLike = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    // Defensive: fail at construction time rather than at the first request
    // when the host lacks `fetch` and the caller did not inject one.
    throw new Error(
      'createThemeParksLiveClient: no fetch implementation available; ' +
        'pass `options.fetch` or run on a runtime with a global `fetch`.',
    );
  }

  return {
    async getEntityLive(
      upstreamId: string,
      signal?: AbortSignal,
    ): Promise<ThemeParksLiveResponse> {
      // Encode the id to stay safe against reserved URL characters. Upstream
      // ids are GUIDs/slugs in practice, but encoding is the defensive default.
      const url = `${baseUrl}/entity/${encodeURIComponent(upstreamId)}/live`;
      const body = await requestJson(fetchImpl, url, signal);
      return assertLiveResponse(body, url);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Strip trailing slashes so path concatenation never produces `//`. */
function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/u, '');
}

/**
 * Issue a GET request and parse the body as JSON, forwarding `signal` so the
 * deadline can cancel the in-flight request (R2.6). Translates every failure
 * mode into a typed `UpstreamError`.
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
      // Only attach `signal` when supplied so we don't pass `undefined`
      // under `exactOptionalPropertyTypes`.
      ...(signal !== undefined ? { signal } : {}),
    });
  } catch (cause) {
    // Distinguish a tripped deadline (`AbortError`) from a broken transport so
    // logs and metrics can separate the two.
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
 * Validate the *gross* shape of `GET /entity/{id}/live`: the top-level body is
 * an object and `liveData` is an array whose entries are objects. Field-level
 * validation is deliberately deferred to `projectLiveDetail` so a partial but
 * recognizable payload still projects whatever it can (R1.10, R1.17). A wholly
 * unparseable body is an `invalid_response` upstream error (R1.8).
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
  for (const entry of liveData) {
    if (!isPlainObject(entry)) {
      throw new UpstreamError(
        'invalid_response',
        `Upstream ${url} returned a liveData entry that is not an object.`,
        { url },
      );
    }
  }
  // Gross shape verified above; the `unknown` hop satisfies TS that we know
  // more than its narrowing of `Record<string, unknown>` shows.
  return body as unknown as ThemeParksLiveResponse;
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
