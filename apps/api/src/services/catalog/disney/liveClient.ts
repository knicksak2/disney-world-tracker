/**
 * Disney live-document client (Sync Gateway live channels).
 *
 * The production {@link DisneyLiveClient} used by `disney/liveService.ts`. It
 * fetches an Experience's live documents from the `Disney_Sync_Gateway`'s four
 * live channels — Status (`wdw.facilitystatus.1_0`), Dining-Status
 * (`wdw.diningfacilitystatus.1_0`), Forecast (`wdw.forecastedwaittimes.1_0.en_us`),
 * and Schedule (`wdw.today.1_0.{Type}`) — keyed by the Experience's
 * `Enterprise_Id` (R9.1), and shapes them into the pure projection's
 * {@link LiveProjectionInput} (R9.2–R9.5).
 *
 * It talks ONLY to the Disney Sync Gateway (never ThemeParks.wiki, R14.1,
 * R14.2), reusing the same HTTP Basic `Static_Credentials`, the same
 * `POST /_bulk_get` transport, the same `multipart/related` parser
 * (`parseBulkGet`), and the same single typed `UpstreamError` vocabulary as the
 * catalog `Facilities_Client`, so a Sync Gateway transport failure surfaces to
 * the orchestrator as a failed retrieval (→ serve stale / 503, R12.10, R14.4).
 *
 * Source-of-truth note. The live channels are undocumented and
 * reverse-engineered; the Sync Gateway keys a facility's status document by its
 * `Enterprise_Id`, so this client requests the `Enterprise_Id` via `_bulk_get`
 * and routes each returned document into the projection slot its `channels`
 * membership indicates. Consistent with the design's defensive posture, a 2xx
 * response that yields no recognizable live document is treated as "no live
 * data" (an empty {@link LiveProjectionInput} — the projection then reports
 * `status: 'Unknown'`, R9.6) rather than an error; only transport/status
 * failures propagate as `UpstreamError`.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 14.1, 14.2
 */

import { UpstreamError } from '../themeparks.js';
import { parseBulkGet } from './multipart.js';
import type {
  DiningStatusDoc,
  DiningStatusEntry,
  ForecastDoc,
  ForecastDocEntry,
  LiveProjectionInput,
  ScheduleDoc,
  ScheduleEntry,
  StatusDoc,
} from './liveProject.js';
import type { DisneyLiveClient } from './liveService.js';
import type { DisneySyncGatewayCredentials, FetchLike } from './facilitiesClient.js';
import { DISNEY_SYNC_GATEWAY_DEFAULT_BASE_URL } from './facilitiesClient.js';

// ---------------------------------------------------------------------------
// Live channel constants (requirements Glossary)
// ---------------------------------------------------------------------------

/** Status_Channel: live status / standby / single-rider docs (R9.2). */
export const STATUS_CHANNEL = 'wdw.facilitystatus.1_0';
/** Dining_Status_Channel: walk-up dining availability docs (R9.3). */
export const DINING_STATUS_CHANNEL = 'wdw.diningfacilitystatus.1_0';
/** Forecast_Channel: hourly wait-time forecast docs (R9.4). */
export const FORECAST_CHANNEL = 'wdw.forecastedwaittimes.1_0.en_us';
/** Schedule_Channel prefix: current-day schedule docs grouped by type (R9.5). */
export const SCHEDULE_CHANNEL_PREFIX = 'wdw.today.1_0.';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DisneyLiveClientOptions {
  /**
   * Sync Gateway base URL. Trailing slashes tolerated. Defaults to
   * {@link DISNEY_SYNC_GATEWAY_DEFAULT_BASE_URL}; production supplies it from
   * `AppConfig.disney.syncGateway.baseUrl` (R1.5, R13.5).
   */
  readonly baseUrl?: string;
  /** HTTP Basic `Static_Credentials` for the Sync Gateway (R1.2). */
  readonly credentials: DisneySyncGatewayCredentials;
  /** Override the HTTP transport. Defaults to `globalThis.fetch`. */
  readonly fetch?: FetchLike;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a Sync-Gateway-backed {@link DisneyLiveClient}. Returns a plain
 * object matching the `createFacilitiesClient` pattern.
 */
export function createDisneyLiveClient(
  options: DisneyLiveClientOptions,
): DisneyLiveClient {
  const baseUrl = normalizeBaseUrl(
    options.baseUrl ?? DISNEY_SYNC_GATEWAY_DEFAULT_BASE_URL,
  );
  const fetchImpl: FetchLike = options.fetch ?? globalThis.fetch;
  const authorization = basicAuthHeader(options.credentials);

  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'createDisneyLiveClient: no fetch implementation available; ' +
        'pass `options.fetch` or run on a runtime with a global `fetch`.',
    );
  }

  return {
    async getEntityLiveInput(
      enterpriseId: string,
      signal?: AbortSignal,
    ): Promise<LiveProjectionInput> {
      const url = `${baseUrl}/_bulk_get`;
      const { contentType, text } = await postBulkGet(
        fetchImpl,
        url,
        authorization,
        liveDocumentIds(enterpriseId),
        signal,
      );

      // A 2xx body that yields no recognizable document means "no live data"
      // rather than a failure: the projection reports `status: 'Unknown'`
      // (R9.6). `parseBulkGet` raises `invalid_response` on a wholly
      // unparseable body; for the live path we fold that into "no data".
      let documents: readonly Record<string, unknown>[];
      try {
        const parsed = parseBulkGet(contentType, text);
        documents =
          parsed.documents as unknown as readonly Record<string, unknown>[];
      } catch (err) {
        if (err instanceof UpstreamError && err.kind === 'invalid_response') {
          return {};
        }
        throw err;
      }

      return routeLiveDocuments(documents);
    },
  };
}

// ---------------------------------------------------------------------------
// Candidate document ids
// ---------------------------------------------------------------------------

/**
 * The candidate live-document ids to request for an `Enterprise_Id`. The Sync
 * Gateway keys a facility's status document by its `Enterprise_Id`, so that is
 * the primary candidate; the returned documents are routed to their projection
 * slot by channel membership (see {@link routeLiveDocuments}), so requesting the
 * `Enterprise_Id` yields whichever live documents the gateway co-keys under it.
 */
export function liveDocumentIds(enterpriseId: string): readonly string[] {
  return [enterpriseId];
}

// ---------------------------------------------------------------------------
// Document routing + defensive field mapping
// ---------------------------------------------------------------------------

/**
 * Route a set of raw Sync Gateway documents into the projection input by
 * inspecting each document's `channels` membership (R9.2–R9.5). A document that
 * belongs to no recognized live channel is ignored. Later documents of the same
 * kind override earlier ones (the gateway returns at most one per kind in
 * practice), except Schedule documents which accumulate (one per entity type).
 */
export function routeLiveDocuments(
  documents: readonly Record<string, unknown>[],
): LiveProjectionInput {
  let status: StatusDoc | undefined;
  let diningStatus: DiningStatusDoc | undefined;
  let forecast: ForecastDoc | undefined;
  const schedule: ScheduleDoc[] = [];

  for (const doc of documents) {
    const channels = readStringArray(doc['channels']);
    if (channels.includes(STATUS_CHANNEL)) {
      status = toStatusDoc(doc);
    } else if (channels.includes(DINING_STATUS_CHANNEL)) {
      diningStatus = toDiningStatusDoc(doc);
    } else if (channels.includes(FORECAST_CHANNEL)) {
      forecast = toForecastDoc(doc);
    } else if (channels.some((c) => c.startsWith(SCHEDULE_CHANNEL_PREFIX))) {
      schedule.push(toScheduleDoc(doc));
    }
  }

  return {
    ...(status !== undefined ? { status } : {}),
    ...(diningStatus !== undefined ? { diningStatus } : {}),
    ...(forecast !== undefined ? { forecast } : {}),
    ...(schedule.length > 0 ? { schedule } : {}),
  };
}

/**
 * Map a raw status document into a {@link StatusDoc}. Every field is optional
 * and copied only when it has the plausible primitive type; the pure projection
 * validates ranges and defaults `status` to `Unknown` when absent (R9.2, R9.6).
 */
function toStatusDoc(doc: Record<string, unknown>): StatusDoc {
  const status = readString(doc['status']);
  const waitMinutes = readNumber(doc['waitMinutes'] ?? doc['waitTime']);
  const singleRiderWaitMinutes = readNumber(
    doc['singleRiderWaitMinutes'] ?? doc['singleRiderWaitTime'],
  );
  const lastUpdate = readString(doc['lastUpdate']);
  return {
    ...(status !== undefined ? { status } : {}),
    ...(waitMinutes !== undefined ? { waitMinutes } : {}),
    ...(singleRiderWaitMinutes !== undefined ? { singleRiderWaitMinutes } : {}),
    ...(lastUpdate !== undefined ? { lastUpdate } : {}),
  };
}

/**
 * Map a raw dining-status document into a {@link DiningStatusDoc}: one entry per
 * upstream party-size entry, each field carried only when plausibly typed
 * (R9.3). The projection validates and drops invalid fields.
 */
function toDiningStatusDoc(doc: Record<string, unknown>): DiningStatusDoc {
  const rawAvailability = doc['availability'] ?? doc['partyMix'];
  const availability = Array.isArray(rawAvailability)
    ? rawAvailability
        .filter(isPlainObject)
        .map((entry): DiningStatusEntry => {
          const s = readString(entry['status']);
          const partySize = readNumber(entry['partySize']);
          const estimatedWaitMinutes = readNumber(
            entry['estimatedWaitMinutes'] ?? entry['waitTime'],
          );
          return {
            ...(s !== undefined ? { status: s } : {}),
            ...(partySize !== undefined ? { partySize } : {}),
            ...(estimatedWaitMinutes !== undefined
              ? { estimatedWaitMinutes }
              : {}),
          };
        })
    : [];
  const lastUpdate = readString(doc['lastUpdate']);
  return {
    availability,
    ...(lastUpdate !== undefined ? { lastUpdate } : {}),
  };
}

/**
 * Map a raw forecast document into a {@link ForecastDoc} (R9.4). The projection
 * degrades the whole forecast to absent if any entry is unparseable, so this
 * mapping simply carries plausible fields through.
 */
function toForecastDoc(doc: Record<string, unknown>): ForecastDoc {
  const rawForecasts = doc['forecasts'] ?? doc['forecast'];
  const forecasts = Array.isArray(rawForecasts)
    ? rawForecasts.filter(isPlainObject).map((entry): ForecastDocEntry => {
        const time = readString(entry['time'] ?? entry['timestamp']);
        const waitMinutes = readNumber(entry['waitMinutes'] ?? entry['waitTime']);
        const percentage = readNumber(entry['percentage']);
        return {
          ...(time !== undefined ? { time } : {}),
          ...(waitMinutes !== undefined ? { waitMinutes } : {}),
          ...(percentage !== undefined ? { percentage } : {}),
        };
      })
    : [];
  const lastUpdate = readString(doc['lastUpdate']);
  return {
    forecasts,
    ...(lastUpdate !== undefined ? { lastUpdate } : {}),
  };
}

/**
 * Map a raw schedule document into a {@link ScheduleDoc} (R9.5). The projection
 * scopes entries to the current Park day and splits showtimes from operating
 * hours, so this mapping only carries the raw schedule entries through.
 */
function toScheduleDoc(doc: Record<string, unknown>): ScheduleDoc {
  const rawSchedules = doc['schedules'] ?? doc['schedule'];
  const schedules = Array.isArray(rawSchedules)
    ? rawSchedules.filter(isPlainObject).map((entry): ScheduleEntry => {
        const type = readString(entry['type']);
        const startTime = readString(entry['startTime']);
        const endTime = readString(entry['endTime']);
        return {
          ...(type !== undefined ? { type } : {}),
          ...(startTime !== undefined ? { startTime } : {}),
          ...(endTime !== undefined ? { endTime } : {}),
        };
      })
    : [];
  const lastUpdate = readString(doc['lastUpdate']);
  return {
    schedules,
    ...(lastUpdate !== undefined ? { lastUpdate } : {}),
  };
}

// ---------------------------------------------------------------------------
// HTTP transport (Sync Gateway, HTTP Basic) — mirrors facilitiesClient
// ---------------------------------------------------------------------------

/**
 * POST `_bulk_get` for the given document ids under HTTP Basic auth, expecting a
 * `multipart/related` body. Returns the raw body text and its `Content-Type`.
 * Transport/status failures surface as a typed `UpstreamError` (R1.7–R1.10);
 * the body is parsed by the caller. The `signal` carries the orchestrator's
 * 5-second deadline (R2.6).
 */
async function postBulkGet(
  fetchImpl: FetchLike,
  url: string,
  authorization: string,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<{ contentType: string; text: string }> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'multipart/related',
      },
      body: JSON.stringify({ docs: ids.map((id) => ({ id })), json: true }),
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

  const contentType = response.headers.get('content-type') ?? '';
  try {
    const text = await response.text();
    return { contentType, text };
  } catch (cause) {
    throw new UpstreamError(
      'invalid_response',
      `Upstream ${url} returned an unreadable body.`,
      { url, cause },
    );
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/u, '');
}

function basicAuthHeader(credentials: DisneySyncGatewayCredentials): string {
  const token = Buffer.from(
    `${credentials.username}:${credentials.password}`,
    'utf8',
  ).toString('base64');
  return `Basic ${token}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string when the value is a string, else `undefined`. */
function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A number when the value is a finite number, else `undefined`. */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The string elements of an array value; `[]` for any other shape. */
function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === 'string');
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return 'unknown error';
}

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
