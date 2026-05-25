/**
 * ThemeParks.wiki HTTP client.
 *
 * Thin, typed wrapper around the two upstream endpoints used by the
 * Catalog_Service per design.md "Catalog_Sync" and Requirements R1.1, R1.2:
 *
 *   - `GET /destinations`            → `getDestinations()`
 *   - `GET /entity/{id}/children`    → `getEntityChildren(id)`
 *
 * Design notes:
 *
 *   1. **Hosting agnostic.** The base URL is supplied through `AppConfig`
 *      (`config.themeparks.baseUrl`) and defaults to
 *      `https://api.themeparks.wiki/v1` per the requirements glossary. The
 *      base URL is never read directly from `process.env` here; the
 *      `loadConfig()` boundary owns that concern.
 *
 *   2. **Single error type.** Every failure mode — non-2xx HTTP status,
 *      network/transport error, malformed JSON, request-aborted — is
 *      surfaced as the typed `UpstreamError` defined below. The Catalog
 *      sync orchestrator (task 9.3) catches a single class and records
 *      `catalog_sync_runs.status = 'failed'` (R1.13). Callers never see
 *      raw `fetch` errors.
 *
 *   3. **Built-in `fetch`.** Node 20 (the project's pinned runtime via
 *      `.nvmrc`) ships a `fetch` global backed by `undici`. Using the
 *      global keeps the dependency graph minimal and means tests can
 *      inject any `fetch`-shaped function without monkey-patching.
 *
 *   4. **Minimal projection.** Only the fields the Catalog domain reads
 *      (`id`, `name`, `entityType`, optional `parentId`, optional `slug`,
 *      optional `parks`) are typed here. The full upstream payload is
 *      richer; trimming the projection insulates the rest of the
 *      codebase from upstream evolution that doesn't affect catalog
 *      logic.
 *
 *   5. **No retries / no caching.** Both concerns belong to the sync
 *      orchestrator (BullMQ retry/backoff) and the cache repository
 *      respectively. Keeping this client a single round-trip per call
 *      makes its behaviour straightforward to reason about and to fake.
 *
 * Validates: Requirements 1.1, 1.2.
 */

// ---------------------------------------------------------------------------
// Wire-shape types — minimal projection of the v1 OpenAPI schema
// ---------------------------------------------------------------------------

/**
 * Single destination entry from `GET /destinations`.
 *
 * `id` is the GUID for the destination root entity; `parks` lists the
 * destination's top-level parks (the Walt Disney World destination
 * exposes its theme parks, water parks, and Disney Springs here).
 */
export interface ThemeParksDestinationParkEntry {
  readonly id: string;
  readonly name: string;
}

export interface ThemeParksDestinationEntry {
  readonly id: string;
  readonly name: string;
  readonly slug?: string;
  readonly externalId?: string;
  readonly parks?: readonly ThemeParksDestinationParkEntry[];
}

/** Response body of `GET /destinations`. */
export interface ThemeParksDestinationsResponse {
  readonly destinations: readonly ThemeParksDestinationEntry[];
}

/**
 * Single child entity from `GET /entity/{id}/children`.
 *
 * Per the upstream OpenAPI spec, `id`, `name`, and `entityType` are
 * required; `parentId` and `externalId` are present on most entities but
 * are typed as optional to tolerate upstream omissions without forcing
 * the parser to throw.
 */
export interface ThemeParksEntityChild {
  readonly id: string;
  readonly name: string;
  readonly entityType: string;
  readonly parentId?: string;
  readonly externalId?: string;
  /**
   * Some `ATTRACTION` entities carry a sub-classifier (e.g. `"PARADE"`,
   * `"MEET_AND_GREET"`). Modelled as an arbitrary string because the
   * upstream value space is open and `classify()` only reads two
   * specific tokens.
   */
  readonly attractionType?: string;
}

/** Response body of `GET /entity/{id}/children`. */
export interface ThemeParksEntityChildrenResponse {
  readonly id: string;
  readonly name: string;
  readonly entityType: string;
  readonly timezone?: string;
  readonly children: readonly ThemeParksEntityChild[];
}

// ---------------------------------------------------------------------------
// UpstreamError
// ---------------------------------------------------------------------------

/**
 * Discriminator for the kind of upstream failure that occurred. The sync
 * orchestrator only needs the boolean "did we successfully reach an
 * agreed shape?" — the discriminator exists so logs and metrics can
 * categorize failures without parsing the message.
 */
export type UpstreamErrorKind =
  /** HTTP request completed but the server returned a non-2xx status. */
  | 'http_status'
  /** Transport layer failed before a response was received (DNS, TCP, TLS, etc.). */
  | 'network'
  /** Response body could not be parsed as JSON. */
  | 'invalid_response'
  /** Request was aborted by the caller (timeout/deadline). */
  | 'aborted';

/**
 * Construction options for `UpstreamError`. All fields are optional so
 * callers only need to set what's relevant for the failure mode.
 */
export interface UpstreamErrorOptions {
  /** HTTP status code, when `kind === 'http_status'`. */
  readonly status?: number;
  /** Absolute URL the request was made against, for diagnostics. */
  readonly url?: string;
  /** Underlying error preserved for log context. */
  readonly cause?: unknown;
}

/**
 * Single typed error class surfaced by every method on the ThemeParks
 * client. Catching `UpstreamError` is sufficient for the sync
 * orchestrator to roll up the run as `failed` and serve cached data with
 * `staleCache: true` (R1.13).
 */
export class UpstreamError extends Error {
  public readonly kind: UpstreamErrorKind;
  public readonly status?: number;
  public readonly url?: string;

  constructor(kind: UpstreamErrorKind, message: string, options: UpstreamErrorOptions = {}) {
    // Forward `cause` through the `Error` constructor only when actually
    // supplied so we don't emit `cause: undefined` under
    // `exactOptionalPropertyTypes`.
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'UpstreamError';
    this.kind = kind;
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.url !== undefined) {
      this.url = options.url;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * The default base URL per the requirements glossary. Overridable via
 * `AppConfig.themeparks.baseUrl` (set from `THEMEPARKS_BASE_URL`).
 */
export const THEMEPARKS_DEFAULT_BASE_URL = 'https://api.themeparks.wiki/v1';

/**
 * `fetch`-shaped function used by the client. Typed as the global
 * `fetch` so callers can pass either `globalThis.fetch` (the default) or
 * a stand-in for tests without pulling in any third-party HTTP library.
 */
export type FetchLike = typeof globalThis.fetch;

export interface ThemeParksClientOptions {
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
 * Public surface of the ThemeParks client.
 */
export interface ThemeParksClient {
  getDestinations(): Promise<ThemeParksDestinationsResponse>;
  getEntityChildren(id: string): Promise<ThemeParksEntityChildrenResponse>;
}

/**
 * Construct a ThemeParks.wiki client.
 *
 * The function is the only public entry point of this module. Returning
 * a plain object (rather than a class) keeps the surface narrow and
 * matches the pattern used by the rest of the API (`avatarStore`,
 * `lockout`, etc.).
 */
export function createThemeParksClient(
  options: ThemeParksClientOptions = {},
): ThemeParksClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? THEMEPARKS_DEFAULT_BASE_URL);
  const fetchImpl: FetchLike = options.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    // Defensive: if the host runtime lacks `fetch` and the caller did
    // not inject one, fail at construction time rather than at the first
    // request — the latter would obscure the configuration error.
    throw new Error(
      'createThemeParksClient: no fetch implementation available; ' +
        'pass `options.fetch` or run on a runtime with a global `fetch`.',
    );
  }

  return {
    async getDestinations(): Promise<ThemeParksDestinationsResponse> {
      const url = `${baseUrl}/destinations`;
      const body = await requestJson(fetchImpl, url);
      return assertDestinationsResponse(body, url);
    },

    async getEntityChildren(id: string): Promise<ThemeParksEntityChildrenResponse> {
      // `id` is interpolated into the path; encode to keep the request
      // safe against IDs that contain reserved URL characters. The
      // upstream IDs in practice are GUIDs and slugs, both of which are
      // already URL-safe, but encoding is the defensive default.
      const url = `${baseUrl}/entity/${encodeURIComponent(id)}/children`;
      const body = await requestJson(fetchImpl, url);
      return assertEntityChildrenResponse(body, url);
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
async function requestJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (cause) {
    // `fetch` rejects on transport-level failures (DNS, TCP, TLS) and on
    // explicit `AbortError`. Distinguish the two so logs and metrics can
    // separate "deadline tripped" from "network broken".
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
 * Validate the minimum shape of `GET /destinations`. We require only the
 * fields the Catalog domain reads; richer fields (slug, externalId,
 * parks) are passed through when present and dropped silently when
 * absent. A wholly missing or non-object payload is an
 * `invalid_response` upstream error.
 */
function assertDestinationsResponse(
  body: unknown,
  url: string,
): ThemeParksDestinationsResponse {
  if (!isPlainObject(body)) {
    throw new UpstreamError('invalid_response', `Upstream ${url} returned a non-object body.`, {
      url,
    });
  }
  const destinations = (body as Record<string, unknown>)['destinations'];
  if (!Array.isArray(destinations)) {
    throw new UpstreamError(
      'invalid_response',
      `Upstream ${url} response is missing the \`destinations\` array.`,
      { url },
    );
  }
  for (const entry of destinations) {
    if (!isPlainObject(entry)) {
      throw new UpstreamError(
        'invalid_response',
        `Upstream ${url} returned a destination entry that is not an object.`,
        { url },
      );
    }
    const rec = entry as Record<string, unknown>;
    if (typeof rec['id'] !== 'string' || typeof rec['name'] !== 'string') {
      throw new UpstreamError(
        'invalid_response',
        `Upstream ${url} returned a destination entry missing \`id\` or \`name\`.`,
        { url },
      );
    }
  }
  // Required fields verified above; the `unknown` hop satisfies TS that we
  // know more than its narrowing of `Record<string, unknown>` shows.
  return body as unknown as ThemeParksDestinationsResponse;
}

/**
 * Validate the minimum shape of `GET /entity/{id}/children`. Same
 * tolerance rules as `assertDestinationsResponse`: required fields are
 * checked; optional fields pass through when present.
 */
function assertEntityChildrenResponse(
  body: unknown,
  url: string,
): ThemeParksEntityChildrenResponse {
  if (!isPlainObject(body)) {
    throw new UpstreamError('invalid_response', `Upstream ${url} returned a non-object body.`, {
      url,
    });
  }
  const rec = body as Record<string, unknown>;
  if (
    typeof rec['id'] !== 'string' ||
    typeof rec['name'] !== 'string' ||
    typeof rec['entityType'] !== 'string'
  ) {
    throw new UpstreamError(
      'invalid_response',
      `Upstream ${url} response is missing required entity fields.`,
      { url },
    );
  }
  const children = rec['children'];
  if (!Array.isArray(children)) {
    throw new UpstreamError(
      'invalid_response',
      `Upstream ${url} response is missing the \`children\` array.`,
      { url },
    );
  }
  for (const child of children) {
    if (!isPlainObject(child)) {
      throw new UpstreamError(
        'invalid_response',
        `Upstream ${url} returned a child entry that is not an object.`,
        { url },
      );
    }
    const childRec = child as Record<string, unknown>;
    if (
      typeof childRec['id'] !== 'string' ||
      typeof childRec['name'] !== 'string' ||
      typeof childRec['entityType'] !== 'string'
    ) {
      throw new UpstreamError(
        'invalid_response',
        `Upstream ${url} returned a child missing \`id\`, \`name\`, or \`entityType\`.`,
        { url },
      );
    }
  }
  return body as unknown as ThemeParksEntityChildrenResponse;
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
