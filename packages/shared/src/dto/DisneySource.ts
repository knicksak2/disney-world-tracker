/**
 * Disney source-resilience transport-facing types.
 *
 * This module is the single source of truth for the type surface shared by the
 * `Disney_Transport`, the `Rate_Limiter`, the `Backoff_Policy`, the
 * `Document_Store`, and `Catalog_Sync` across `apps/api`. Keeping these
 * definitions in `@dwt/shared` prevents the downstream modules from drifting
 * apart on the shape of a request spec, a failure classification, a backoff or
 * rate-limiter config, a stored document, or a sync-run outcome.
 *
 * These are pure structural types with no runtime payload (except the closed-set
 * value tuples, which are useful for iteration in property tests). Validation of
 * on-the-wire live data lives in `packages/shared/src/schemas/`.
 *
 * Validates: Requirements 11.6, 11.7, 11.8, 12.6
 */

// ---------------------------------------------------------------------------
// Sync_Run_History outcome (R12.6)
// ---------------------------------------------------------------------------

/**
 * The closed set of Catalog_Sync run outcomes recorded in Sync_Run_History
 * (R12.6). `waf_block` and `auth_failure` are distinct so an operator can tell
 * an Akamai edge block (transient) apart from a credential failure (fatal)
 * (R12.4, R12.5). The legacy `http_status` outcome is retired from the closed
 * set — a Disney failure is now always classified into `waf_block`,
 * `auth_failure`, or a transport kind.
 */
export const SYNC_RUN_OUTCOMES = [
  'success',
  'waf_block',
  'auth_failure',
  'network',
  'invalid_response',
  'aborted',
] as const;

export type SyncRunOutcome = (typeof SYNC_RUN_OUTCOMES)[number];

// ---------------------------------------------------------------------------
// Disney_Transport request/response surface
// ---------------------------------------------------------------------------

/**
 * The closed set of Disney request targets. The target selects the
 * target-appropriate `User-Agent` and the Request_Budget bucket:
 *   - `sync_gateway` — the Disney_Sync_Gateway (Couchbase_User_Agent, HTTP Basic)
 *   - `web`          — Disney's authorization service + the Menu_Service
 *                      (Web_User_Agent, Bearer Public_Token)
 */
export const DISNEY_TARGETS = ['sync_gateway', 'web'] as const;

export type DisneyTarget = (typeof DISNEY_TARGETS)[number];

/**
 * A single Disney request to dispatch through the `Disney_Transport`. Auth
 * headers are supplied by the client in `headers`; the transport owns the
 * `User-Agent`, rate limiting, backoff, and classification (R1.4, R5.1, R5.2).
 */
export interface DisneyRequestSpec {
  /** Selects the User-Agent and the Request_Budget bucket. */
  readonly target: DisneyTarget;
  readonly url: string;
  readonly method: 'GET' | 'POST';
  /** Client-supplied headers (e.g. Basic/Bearer auth); User-Agent is added by the transport. */
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Accept header, e.g. `application/json` | `multipart/related`. */
  readonly accept: string;
  /** Caller deadline / cancellation signal. */
  readonly signal?: AbortSignal;
}

/** The raw response the `Disney_Transport` returns; the client parses the body. */
export interface DisneyResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Raw body; the client parses JSON/multipart. */
  readonly text: string;
}

// ---------------------------------------------------------------------------
// Failure classification (R4)
// ---------------------------------------------------------------------------

/**
 * The closed set of Disney failure kinds carried by the transport's typed
 * error and mapped to a {@link SyncRunOutcome}:
 *   - `http_status`      generic non-2xx that is neither WAF nor auth
 *   - `waf_block`        Akamai "Access Denied" / edge rate denial (403/429) — retriable (R4.1, R4.2)
 *   - `auth_failure`     401, or a 403 not classified as WAF — fatal (R4.3, R4.4)
 *   - `network`          transport failure before a response
 *   - `invalid_response` body unparseable into the agreed shape
 *   - `aborted`          caller cancellation / deadline
 */
export const DISNEY_FAILURE_KINDS = [
  'http_status',
  'waf_block',
  'auth_failure',
  'network',
  'invalid_response',
  'aborted',
] as const;

export type DisneyFailureKind = (typeof DISNEY_FAILURE_KINDS)[number];

/** The pure classification of a Disney response into a failure kind (R4). */
export interface DisneyClassification {
  readonly kind: DisneyFailureKind;
  readonly retriable: boolean;
  readonly status?: number;
}

// ---------------------------------------------------------------------------
// Backoff_Policy config (R3)
// ---------------------------------------------------------------------------

/** Bounded exponential-backoff-with-jitter configuration (R3.2, R3.3, R3.6). */
export interface BackoffConfig {
  /** First-retry base delay in milliseconds. */
  readonly baseDelayMs: number;
  /** Exponential growth factor (e.g. 2). */
  readonly factor: number;
  /** Maximum number of retries before the typed error is raised (R3.3). */
  readonly maxRetries: number;
  /** Cap on the cumulative retry delay for a single request (R3.6). */
  readonly maxTotalDelayMs: number;
  /** Per-attempt delay ceiling before jitter is applied (R3.2). */
  readonly maxDelayMs: number;
}

// ---------------------------------------------------------------------------
// Rate_Limiter config (R2)
// ---------------------------------------------------------------------------

/** The Request_Budget limits enforced by the Rate_Limiter (R2.2, R2.3). */
export interface RateLimiterConfig {
  /** Maximum outbound requests per second to a Disney_Source (R2.2). */
  readonly maxRequestsPerSecond: number;
  /** Maximum concurrent in-flight requests to a Disney_Source (R2.3). */
  readonly maxConcurrency: number;
}

// ---------------------------------------------------------------------------
// Document_Store (R7)
// ---------------------------------------------------------------------------

/**
 * A Facility_Document persisted durably in the `Document_Store`, keyed by its
 * Enterprise_Id (R7.1, R7.2). `deleted` is the tombstone marker (R7.3) and
 * `changeSeq` records the `_changes` sequence this version came from.
 *
 * The parsed document body is generic so `@dwt/shared` does not depend on the
 * tolerant `FacilityDocument` shape that lives in `apps/api`; downstream code
 * parameterizes it (e.g. `StoredDocument<FacilityDocument>`).
 */
export interface StoredDocument<TBody = unknown> {
  /** Disney Enterprise_Id / document id (the store key). */
  readonly enterpriseId: string;
  /** Parsed document body. */
  readonly body: TBody;
  /** Tombstone marker (R7.3). */
  readonly deleted: boolean;
  /** The `_changes` sequence this version came from. */
  readonly changeSeq: string;
}
