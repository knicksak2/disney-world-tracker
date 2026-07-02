/**
 * Facilities_Client — Disney_Sync_Gateway + Menu_Service portion.
 *
 * A thin, config-driven client that talks to Disney's internal Couchbase
 * Sync Gateway and the reverse-engineered Menu_Service. Every Disney HTTP
 * request is dispatched through the shared {@link DisneyTransport}
 * (`services/catalog/disney/transport.ts`): the client owns URL building, body
 * encoding, response parsing, the Public_Token cache, and the auth headers,
 * while the transport owns the `User-Agent`, rate limiting, retry/backoff, and
 * WAF-vs-auth classification. A client physically cannot reach a Disney source
 * except through `transport.request(spec)` (design.md §3, Requirements 1.2,
 * 1.3, 5.3, 6.2, 6.3, 7.3).
 *
 * Design notes:
 *
 *   1. **Config-driven, no `process.env`.** The Sync Gateway base URL and the
 *      `Static_Credentials` (HTTP Basic username/password) are supplied through
 *      the client options, which the composition root wires from
 *      `AppConfig.disney`. This module never reads `process.env`.
 *
 *   2. **Auth headers built here, injected via `spec.headers` (R5.3).** Sync
 *      Gateway requests carry `Authorization: Basic <base64(user:pass)>`;
 *      Menu_Service / authorization-service (`web`) requests carry
 *      `Authorization: Bearer <Public_Token>`. The transport passes these
 *      through untouched and adds the target-appropriate `User-Agent` itself —
 *      the client no longer sets a `User-Agent`.
 *
 *   3. **Transport owns failure classification.** Non-2xx statuses, transport
 *      failures, and caller cancellation are classified and raised by the
 *      transport as a single typed error; the client only raises
 *      `UpstreamError('invalid_response')` when a *successful* response body
 *      cannot be parsed into the agreed shape (JSON for `_changes`/menus,
 *      `multipart/related` for `_bulk_get`).
 *
 *   4. **Incremental `_changes` (R6.2, R6.3, R7.3).**
 *      `listChannelDocumentIds(channel, since?)` optionally carries a `since`
 *      sequence to drive a Delta_Sync and returns both the per-document change
 *      records (each with a `deleted`/tombstone flag) and the enumeration's
 *      `last_seq` so the orchestrator can persist the Changes_Checkpoint.
 *
 *   5. **Pure batching.** Batching of `_bulk_get` ids is delegated to the pure
 *      {@link chunk} helper so the "batches partition the id set without loss"
 *      invariant is property-testable independently of the transport.
 *
 *   6. **Menu_Service + Public_Token.** `getMenus` fetches a restaurant's raw
 *      menus with `Authorization: Bearer <Public_Token>`. The Public_Token is an
 *      app-level anonymous OAuth bearer obtained from Disney's authorization
 *      service via the `assertion`/`public` grant; it is acquired lazily only
 *      when no unexpired token is held, cached in memory with its expiry, and
 *      reused until it expires. The clock is injectable through `options.now` so
 *      expiry behavior is deterministically testable. Both the token grant and
 *      the menu request go through the transport with `target: 'web'`.
 *
 * Validates: Requirements 1.2, 1.3, 5.3, 6.2, 6.3, 7.3
 */

import type { FacilityDocument } from './facilityDoc.js';
import type { RawMenu } from './menu.js';
import { parseBulkGet } from './multipart.js';
import type { DisneyTransport } from './transport.js';
import { UpstreamError } from '../themeparks.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The documented default Sync Gateway base URL (requirements Glossary). The
 * config loader is the authoritative source of this default; it is duplicated
 * here only as a standalone-construction convenience, mirroring
 * `THEMEPARKS_DEFAULT_BASE_URL`.
 */
export const DISNEY_SYNC_GATEWAY_DEFAULT_BASE_URL =
  'https://realtime-sync-gw.wdprapps.disney.com/park-platform-pub/';

/**
 * Sync Gateway `User-Agent`. Disney's Couchbase Sync Gateway rejects requests
 * that do not identify as the Couchbase Lite client with HTTP 403 — even when
 * the Basic credentials are valid. This is verified behaviour: the identical
 * authenticated request returns 200 with this header and 403 without it. The
 * value mirrors the Couchbase Lite client string the mobile app sends.
 *
 * The header itself is injected by the {@link DisneyTransport}; this constant is
 * exported so the transport has a single source of truth for the value.
 */
export const DISNEY_SYNC_GATEWAY_USER_AGENT =
  'CouchbaseLite/3.2.1-9 (Java; Android 16; sdk_gphone64_x86_64) EE/release, Commit/2109502be2@02fbcb1b8b44 Core/3.2.1 (19)';

/**
 * `User-Agent` for Disney's public web services (authorization + Menu_Service).
 * These endpoints likewise reject a default Node `User-Agent`; a browser-like
 * value keeps them from returning 403. Injected by the {@link DisneyTransport}.
 */
export const DISNEY_WEB_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * The Sync Gateway channel listing catalog entities (Facilities_Channel,
 * requirements Glossary).
 */
export const FACILITIES_CHANNEL = 'wdw.facilities.1_0.en_us';

/**
 * The maximum number of document ids permitted in a single `POST /_bulk_get`
 * request body. Batching never exceeds this size.
 */
export const BULK_GET_BATCH_SIZE = 100;

/**
 * Default base URL of the reverse-engineered Menu_Service (`diningMenuSvc`),
 * from which a restaurant's full menus are fetched by Enterprise_Id.
 * A restaurant's menus are requested at `<baseUrl>/<encoded Enterprise_Id>`.
 * Overridable via `options.menuService.baseUrl` (tests inject a stand-in).
 */
export const DISNEY_MENU_SERVICE_DEFAULT_BASE_URL =
  'https://api.wdprapps.disney.com/explorer-service/public/finder/dining-menus';

/**
 * Default endpoint of Disney's authorization service that issues the app-level
 * anonymous Public_Token via the `assertion`/`public` grant. Overridable via
 * `options.menuService.authorizationUrl`.
 */
export const DISNEY_AUTHORIZATION_TOKEN_URL = 'https://authorization.go.com/token';

/**
 * Default OAuth client identifier presented when acquiring the anonymous
 * Public_Token. This is the app-level (not per-guest) client the Menu_Service
 * accepts. Overridable via `options.menuService.clientId`.
 */
export const DISNEY_PUBLIC_TOKEN_CLIENT_ID = 'WDPRO-MOBILE.MDX.WDW.IOS-PROD';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * `fetch`-shaped function. Retained as the single source of truth for the
 * transport's injected `fetch` type (`transport.ts` imports it); the client
 * itself no longer invokes `fetch` — all egress flows through the transport.
 */
export type FetchLike = typeof globalThis.fetch;

/**
 * The HTTP Basic `Static_Credentials` required by the Disney_Sync_Gateway
 * (requirements Glossary, R1.2). Supplied through configuration.
 */
export interface DisneySyncGatewayCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * A single `_changes` result: the document id and whether the change is a
 * tombstone (`deleted: true`). The tombstone flag drives delete propagation in
 * the incremental sync (R7.3).
 */
export interface ChannelChange {
  readonly id: string;
  readonly deleted: boolean;
}

/**
 * The result of enumerating a channel via `POST /_changes`: the per-document
 * change records and the enumeration's `last_seq`. `lastSeq` is persisted as
 * the Changes_Checkpoint so a subsequent Delta_Sync can resume from it (R6.3).
 */
export interface ChannelChanges {
  readonly changes: ReadonlyArray<ChannelChange>;
  readonly lastSeq: string;
}

export interface FacilitiesClientOptions {
  /**
   * The shared {@link DisneyTransport}. All Disney HTTP flows through it; the
   * transport owns the `User-Agent`, rate limiting, retry/backoff, and
   * classification (R1.1, R5.1, R5.2).
   */
  readonly transport: DisneyTransport;
  /**
   * Sync Gateway base URL. Trailing slashes are tolerated. Defaults to
   * {@link DISNEY_SYNC_GATEWAY_DEFAULT_BASE_URL} when omitted; in production the
   * config loader always supplies it from `AppConfig.disney.syncGateway.baseUrl`.
   */
  readonly baseUrl?: string;
  /** HTTP Basic `Static_Credentials` for the Sync Gateway (R1.2). */
  readonly credentials: DisneySyncGatewayCredentials;
  /**
   * Menu_Service settings. All fields are optional and fall back to the
   * documented reverse-engineered defaults ({@link DISNEY_MENU_SERVICE_DEFAULT_BASE_URL},
   * {@link DISNEY_AUTHORIZATION_TOKEN_URL}, {@link DISNEY_PUBLIC_TOKEN_CLIENT_ID}).
   * Tests inject stand-in URLs so token acquisition and menu retrieval can be
   * driven without contacting Disney.
   */
  readonly menuService?: {
    /** Menu_Service base URL; trailing slashes tolerated. */
    readonly baseUrl?: string;
    /** Authorization-service token endpoint issuing the Public_Token. */
    readonly authorizationUrl?: string;
    /** OAuth client id presented in the anonymous `assertion`/`public` grant. */
    readonly clientId?: string;
  };
  /**
   * Injectable monotonic clock returning milliseconds since the epoch, used to
   * decide whether the cached Public_Token is still unexpired. Defaults to
   * `Date.now`. Tests pass a controllable clock so Public_Token acquisition
   * (obtained exactly when none unexpired is held) is deterministic.
   */
  readonly now?: () => number;
}

/**
 * Public surface of the Facilities_Client. The Sync Gateway operations and the
 * Menu_Service operation are implemented here.
 */
export interface FacilitiesClient {
  /**
   * POST /_changes for a channel; returns the per-document change records (each
   * carrying a `deleted`/tombstone flag) and the enumeration's `last_seq`
   * (R6.2, R6.3, R7.3). An optional `since` sequence drives an incremental
   * Delta_Sync; omitting it enumerates the whole channel (Bootstrap_Sync).
   */
  listChannelDocumentIds(channel: string, since?: string): Promise<ChannelChanges>;

  /**
   * POST /_bulk_get for the given ids, batched 1..100 per request until all ids
   * are requested; returns every fetched Facility_Document. An empty id set
   * returns `[]` and sends no request.
   */
  bulkGetDocuments(ids: readonly string[]): Promise<readonly FacilityDocument[]>;

  /**
   * GET a restaurant's raw menus from the Menu_Service by Enterprise_Id.
   *
   * The request carries `Authorization: Bearer <Public_Token>` (R1.3). When no
   * unexpired Public_Token is held, one is first obtained from Disney's
   * authorization service via the anonymous `assertion`/`public` grant, cached
   * in memory with its expiry, and reused until it expires. An empty or
   * unrecognized response body yields `[]` (no menus) rather than an error, so
   * the caller can treat "no menus" uniformly.
   */
  getMenus(enterpriseId: string): Promise<readonly RawMenu[]>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Partition `items` into consecutive chunks of at most `size` elements.
 *
 * Pure, total, and deterministic. The concatenation of the returned chunks
 * equals `items` exactly (no element dropped, added, reordered, or
 * duplicated), every non-final chunk has exactly `size` elements, and an empty
 * input yields no chunks (design Property 1).
 *
 * @throws RangeError when `size` is not a positive integer — a programmer
 *   error, not an upstream condition.
 */
export function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`chunk: size must be a positive integer, received ${size}.`);
  }
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Construct a Facilities_Client backed by the shared {@link DisneyTransport}.
 *
 * Returns a plain object (rather than a class) to keep the surface narrow and
 * match the pattern used by the rest of the API (`createThemeParksClient`,
 * `avatarStore`, `lockout`, etc.).
 */
export function createFacilitiesClient(options: FacilitiesClientOptions): FacilitiesClient {
  const transport = options.transport;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DISNEY_SYNC_GATEWAY_DEFAULT_BASE_URL);
  const authorization = basicAuthHeader(options.credentials);

  // Menu_Service configuration, defaulting to the documented reverse-engineered
  // endpoints when the caller does not override them (R1.3).
  const menuBaseUrl = normalizeBaseUrl(
    options.menuService?.baseUrl ?? DISNEY_MENU_SERVICE_DEFAULT_BASE_URL,
  );
  const authorizationUrl = options.menuService?.authorizationUrl ?? DISNEY_AUTHORIZATION_TOKEN_URL;
  const clientId = options.menuService?.clientId ?? DISNEY_PUBLIC_TOKEN_CLIENT_ID;

  // Injectable clock (ms since epoch) governing Public_Token expiry.
  const nowMs: () => number = options.now ?? (() => Date.now());

  // In-memory Public_Token cache: null until the first acquisition, then the
  // token value and the absolute instant (ms) at which it expires. A token is
  // "unexpired" while `expiresAtMs > nowMs()`.
  let cachedToken: { readonly value: string; readonly expiresAtMs: number } | null = null;

  /**
   * Return a currently-unexpired Public_Token, acquiring (and caching) a fresh
   * one via the anonymous `assertion`/`public` grant only when none unexpired is
   * held.
   */
  async function ensurePublicToken(): Promise<string> {
    if (cachedToken !== null && cachedToken.expiresAtMs > nowMs()) {
      return cachedToken.value;
    }
    const { accessToken, expiresInSeconds } = await acquirePublicToken(
      transport,
      authorizationUrl,
      clientId,
    );
    // Expiry is measured from the clock at acquisition time; a missing/invalid
    // `expires_in` yields a token that is immediately expired (re-acquired next
    // call), which is the safe default for an undocumented upstream.
    cachedToken = { value: accessToken, expiresAtMs: nowMs() + expiresInSeconds * 1000 };
    return cachedToken.value;
  }

  return {
    async listChannelDocumentIds(channel: string, since?: string): Promise<ChannelChanges> {
      const url = `${baseUrl}/_changes`;
      // The `sync_gateway/bychannel` filter selects the channel's documents;
      // `style`, `filter`, and `feed` are fixed. `since` (when supplied) drives
      // an incremental Delta_Sync (R6.2).
      const requestBody: Record<string, unknown> = {
        style: 'all_docs',
        filter: 'sync_gateway/bychannel',
        feed: 'normal',
        channels: channel,
      };
      if (since !== undefined) {
        requestBody['since'] = since;
      }

      const response = await transport.request({
        target: 'sync_gateway',
        url,
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        accept: 'application/json',
      });

      return extractChanges(parseJson(response.text, url), url);
    },

    async bulkGetDocuments(ids: readonly string[]): Promise<readonly FacilityDocument[]> {
      // An empty id set returns [] and sends no request.
      if (ids.length === 0) {
        return [];
      }

      const url = `${baseUrl}/_bulk_get`;
      const documents: FacilityDocument[] = [];

      // Batches of 1..100 ids, in order, until all requested ids are fetched.
      // Batching is pure and property-tested via `chunk`.
      for (const batch of chunk(ids, BULK_GET_BATCH_SIZE)) {
        const response = await transport.request({
          target: 'sync_gateway',
          url,
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ docs: batch.map((id) => ({ id })), json: true }),
          accept: 'multipart/related',
        });

        // `parseBulkGet` drops individually malformed parts and raises
        // `UpstreamError('invalid_response')` only when the whole body yields
        // no document at all.
        const contentType = response.headers['content-type'] ?? '';
        const { documents: parsed } = parseBulkGet(contentType, response.text);
        documents.push(...parsed);
      }

      return documents;
    },

    async getMenus(enterpriseId: string): Promise<readonly RawMenu[]> {
      // Acquire/reuse the Public_Token first, then call the Menu_Service with
      // it as bearer auth (R1.3).
      const token = await ensurePublicToken();
      const url = `${menuBaseUrl}/${encodeURIComponent(enterpriseId)}`;

      const response = await transport.request({
        target: 'web',
        url,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        accept: 'application/json',
      });

      // The Menu_Service shape is undocumented; extract the raw menu array
      // defensively. An empty/unrecognized body means "no menus".
      return extractRawMenus(parseJson(response.text, url));
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
 * Build the `Authorization: Basic ...` header value from the Static_Credentials
 * (R1.2). Uses Node's `Buffer` (available on the pinned Node 20 runtime).
 */
function basicAuthHeader(credentials: DisneySyncGatewayCredentials): string {
  const token = Buffer.from(`${credentials.username}:${credentials.password}`, 'utf8').toString(
    'base64',
  );
  return `Basic ${token}`;
}

/**
 * Parse a response body text as JSON. A body that cannot be parsed is a
 * successful-transport-but-unparseable-body condition and surfaces as
 * `UpstreamError('invalid_response')`.
 */
function parseJson(text: string, url: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new UpstreamError('invalid_response', `Upstream ${url} returned a non-JSON body.`, {
      url,
      cause,
    });
  }
}

/**
 * Acquire an app-level anonymous Public_Token from Disney's authorization
 * service using the `assertion`/`public` grant (R1.3). The grant carries no
 * per-guest credential — only the app-level `client_id` — and is sent as a
 * standard form-encoded OAuth token request through the transport with
 * `target: 'web'`. Returns the bearer token and its lifetime in seconds; a
 * missing/invalid `expires_in` maps to `0` so the caller treats the token as
 * immediately expired.
 */
async function acquirePublicToken(
  transport: DisneyTransport,
  url: string,
  clientId: string,
): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const body = new URLSearchParams({
    grant_type: 'assertion',
    assertion_type: 'public',
    client_id: clientId,
  }).toString();

  const response = await transport.request({
    target: 'web',
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    accept: 'application/json',
  });

  const parsed = parseJson(response.text, url);

  if (!isPlainObject(parsed) || typeof parsed['access_token'] !== 'string') {
    throw new UpstreamError(
      'invalid_response',
      `Public_Token endpoint ${url} response is missing a string \`access_token\`.`,
      { url },
    );
  }

  const expiresInRaw = parsed['expires_in'];
  const expiresInSeconds =
    typeof expiresInRaw === 'number' && Number.isFinite(expiresInRaw) && expiresInRaw > 0
      ? expiresInRaw
      : 0;

  return { accessToken: parsed['access_token'], expiresInSeconds };
}

/**
 * Defensively extract the raw menu array from an undocumented Menu_Service
 * response. Accepts either a bare array of menus or an object wrapping them
 * under a `menus` array; any other shape (including an empty or absent body)
 * yields `[]`, which the caller treats as "no menus". Individual entries are
 * passed through as tolerant {@link RawMenu} values — `projectMenus` defends
 * against missing/typed fields — so a partial payload still projects what it
 * can.
 */
function extractRawMenus(body: unknown): readonly RawMenu[] {
  const candidate = Array.isArray(body)
    ? body
    : isPlainObject(body) && Array.isArray(body['menus'])
      ? body['menus']
      : [];

  return candidate.filter((entry): entry is RawMenu => isPlainObject(entry));
}

/**
 * Extract the per-document change records and `last_seq` from a Sync Gateway
 * `_changes` response.
 *
 * The response shape is `{ results: [{ id, seq, changes, deleted? }, ...],
 * last_seq }`. A response that is not an object or is missing the `results`
 * array is an `invalid_response` upstream failure. Individual result entries
 * without a string `id` are skipped defensively; an entry's `deleted: true`
 * flag marks a tombstone (R7.3). `last_seq` is coerced to a string checkpoint
 * (R6.3); an absent `last_seq` yields the empty string.
 */
function extractChanges(body: unknown, url: string): ChannelChanges {
  if (!isPlainObject(body)) {
    throw new UpstreamError('invalid_response', `Upstream ${url} returned a non-object body.`, {
      url,
    });
  }
  const results = body['results'];
  if (!Array.isArray(results)) {
    throw new UpstreamError(
      'invalid_response',
      `Upstream ${url} response is missing the \`results\` array.`,
      { url },
    );
  }

  const changes: ChannelChange[] = [];
  for (const entry of results) {
    if (isPlainObject(entry) && typeof entry['id'] === 'string') {
      changes.push({ id: entry['id'], deleted: entry['deleted'] === true });
    }
  }

  const lastSeqRaw = body['last_seq'];
  const lastSeq =
    typeof lastSeqRaw === 'string'
      ? lastSeqRaw
      : typeof lastSeqRaw === 'number' && Number.isFinite(lastSeqRaw)
        ? String(lastSeqRaw)
        : '';

  return { changes, lastSeq };
}

/** True for plain JSON-like objects (i.e. not arrays, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
