/**
 * Disney_Transport — the single shared egress point for *all* Disney HTTP
 * (design.md → "1. Disney_Transport" and Requirements 1–5).
 *
 * Every Disney request (`Facilities_Client` Sync Gateway calls, Menu_Service
 * calls, Public_Token acquisition) funnels through {@link createDisneyTransport}
 * so that rate limiting, User-Agent injection, retry/backoff, and WAF-vs-auth
 * classification live in exactly one place. A client physically cannot reach a
 * Disney source except through `request(spec)`.
 *
 * `request(spec)` performs, for every dispatch (R1.4):
 *
 *   1. **Acquire a Rate_Limiter lease** for the target's bucket *before* the
 *      dispatch; capacity acquisition waits, never rejects (R2.1, R2.6). The
 *      lease is always released in a `finally`.
 *   2. **Inject the target-appropriate `User-Agent`** — `Couchbase_User_Agent`
 *      for `sync_gateway`, `Web_User_Agent` for `web` (R5.1, R5.2). The header
 *      is owned by the transport and always overrides any caller-supplied
 *      value; client-supplied Basic/Bearer auth in `spec.headers` is passed
 *      through untouched (R5.3, R15.2).
 *   3. **Dispatch via the injected `fetch`** and read the status, headers, and
 *      raw body text.
 *   4. **Classify** the outcome via {@link classifyDisneyResponse}: a `2xx`
 *      returns a {@link DisneyResponse}; any other status becomes a
 *      {@link DisneyClassification}; a transport throw becomes `network` (or
 *      `aborted` on caller cancellation) (R4).
 *   5. **Retry retriable failures** per the {@link BackoffConfig} — exponential
 *      backoff with jitter, honoring `Retry-After` as a floor and stopping at
 *      the retry-count and cumulative-delay caps (R3.1–R3.6). Non-retriable
 *      failures raise immediately with no retry (R3.5, R4.4).
 *   6. **Raise exactly one {@link DisneyTransportError}** whose `kind` is a
 *      member of the closed set `{http_status, waf_block, auth_failure,
 *      network, invalid_response, aborted}` (R1.5, R4.5).
 *
 * Every time-, randomness-, and I/O-dependent input (`fetch`, the limiter, the
 * backoff config, `now()`, `sleep`, and the jitter source) is injected so the
 * transport is deterministically testable without real timers or a network
 * (Properties 1 and 4).
 *
 * Validates: Requirements 1.1, 1.4, 1.5, 2.1, 3.1, 3.3, 3.5, 5.1, 5.2, 5.3, 15.2
 */

import type {
  BackoffConfig,
  DisneyClassification,
  DisneyFailureKind,
  DisneyRequestSpec,
  DisneyResponse,
  DisneyTarget,
} from '@dwt/shared';

import { computeBackoffDelay, parseRetryAfter } from './backoff.js';
import { classifyDisneyResponse } from './classify.js';
import {
  DISNEY_SYNC_GATEWAY_USER_AGENT,
  DISNEY_WEB_USER_AGENT,
  type FetchLike,
} from './facilitiesClient.js';
import type { RateLimiter } from './rateLimiter.js';

// ---------------------------------------------------------------------------
// DisneyTransportError (design.md → "1c. DisneyTransportError")
// ---------------------------------------------------------------------------

/** Optional diagnostics attached to a {@link DisneyTransportError}. */
export interface DisneyTransportErrorOptions {
  /** HTTP status code, when the failure carried a response. */
  readonly status?: number;
  /** Absolute URL the request was made against, for diagnostics. */
  readonly url?: string;
  /** Underlying error preserved for log context. */
  readonly cause?: unknown;
  /** How many dispatches were made before this error was raised (R1.5). */
  readonly attempts: number;
}

/**
 * The single typed error the `Disney_Transport` raises (R1.5). Its {@link kind}
 * is the discriminator over the closed {@link DisneyFailureKind} set;
 * `waf_block` and `auth_failure` are distinct values so callers and
 * `Sync_Run_History` can tell an Akamai edge block apart from a credential
 * failure (R4.5, R12.4, R12.5).
 */
export class DisneyTransportError extends Error {
  public readonly kind: DisneyFailureKind;
  public readonly status?: number;
  public readonly url?: string;
  public readonly attempts: number;

  constructor(
    kind: DisneyFailureKind,
    message: string,
    options: DisneyTransportErrorOptions,
  ) {
    super(
      message,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'DisneyTransportError';
    this.kind = kind;
    this.attempts = options.attempts;
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
// Transport surface
// ---------------------------------------------------------------------------

/**
 * The `Disney_Transport` (design.md §1). Exposes a single operation; every
 * Disney HTTP request in the codebase flows through it.
 */
export interface DisneyTransport {
  /**
   * Acquire budget, inject the User-Agent, dispatch, classify, and retry per
   * the backoff policy. Resolves a {@link DisneyResponse} on a `2xx`; otherwise
   * raises exactly one {@link DisneyTransportError}.
   */
  request(spec: DisneyRequestSpec): Promise<DisneyResponse>;
}

/**
 * The target-appropriate `User-Agent` strings (R5.1, R5.2). Injectable so tests
 * can assert the exact header carried per target without depending on the
 * production constants; defaults come from the `Facilities_Client` so there is
 * a single source of truth for the values.
 */
export interface DisneyUserAgents {
  /** Sent for `target: 'sync_gateway'` — the Couchbase_User_Agent (R5.1). */
  readonly sync_gateway?: string;
  /** Sent for `target: 'web'` — the Web_User_Agent (R5.2). */
  readonly web?: string;
}

/**
 * Injected dependencies for {@link createDisneyTransport}. The limiter and the
 * backoff config are required (wired from `AppConfig.disney` at the composition
 * root); everything else has a production default and is overridden only by
 * tests so the transport runs deterministically without real time or network.
 */
export interface DisneyTransportDeps {
  /** The shared Rate_Limiter enforcing the Request_Budget (R2.1). */
  readonly limiter: RateLimiter;
  /** Bounded exponential-backoff configuration (R3). */
  readonly backoff: BackoffConfig;
  /** HTTP transport. Defaults to `globalThis.fetch`. */
  readonly fetch?: FetchLike;
  /** Current epoch-milliseconds clock. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Resolve after `ms` milliseconds. Defaults to a `setTimeout` sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source in `[0, 1)`. Defaults to `Math.random`. */
  readonly jitter?: () => number;
  /** Target-appropriate User-Agent strings (R5.1, R5.2). */
  readonly userAgents?: DisneyUserAgents;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A normalized failure derived either from a classified non-2xx response or
 * from a transport-level throw, carrying everything the retry loop needs.
 */
interface TransportFailure {
  readonly kind: DisneyFailureKind;
  readonly retriable: boolean;
  readonly status?: number;
  /** Parsed `Retry-After` floor in milliseconds, when the response supplied one. */
  readonly retryAfterMs?: number;
  /** Underlying thrown value, for a transport-level failure. */
  readonly cause?: unknown;
}

/**
 * Construct the shared {@link DisneyTransport}. Returns a plain object (matching
 * the `createFacilitiesClient` / `createThemeParksClient` precedent) so the
 * surface stays narrow.
 */
export function createDisneyTransport(deps: DisneyTransportDeps): DisneyTransport {
  const fetchImpl: FetchLike = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const jitter = deps.jitter ?? Math.random;
  const cfg = deps.backoff;

  const userAgents: Record<DisneyTarget, string> = {
    sync_gateway: deps.userAgents?.sync_gateway ?? DISNEY_SYNC_GATEWAY_USER_AGENT,
    web: deps.userAgents?.web ?? DISNEY_WEB_USER_AGENT,
  };

  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'createDisneyTransport: no fetch implementation available; ' +
        'pass `deps.fetch` or run on a runtime with a global `fetch`.',
    );
  }

  /** Build the outgoing headers, injecting the transport-owned User-Agent last. */
  const buildHeaders = (spec: DisneyRequestSpec): Record<string, string> => {
    const headers: Record<string, string> = {
      ...(spec.headers ?? {}),
      Accept: spec.accept,
    };
    // The transport owns the User-Agent (R5.1, R5.2); it always overrides any
    // caller-supplied value.
    headers['User-Agent'] = userAgents[spec.target];
    return headers;
  };

  /** Dispatch once. Returns either a success response or a normalized failure. */
  const dispatchOnce = async (
    spec: DisneyRequestSpec,
  ): Promise<
    | { readonly ok: true; readonly response: DisneyResponse }
    | { readonly ok: false; readonly failure: TransportFailure }
  > => {
    const init: RequestInit = {
      method: spec.method,
      headers: buildHeaders(spec),
    };
    if (spec.body !== undefined) {
      init.body = spec.body;
    }
    if (spec.signal !== undefined) {
      init.signal = spec.signal;
    }

    let status: number;
    let headers: Record<string, string>;
    let text: string;
    try {
      const res = await fetchImpl(spec.url, init);
      status = res.status;
      headers = collectHeaders(res.headers);
      text = await res.text();
    } catch (cause) {
      // A transport-level failure before (or while reading) a response: caller
      // cancellation maps to `aborted` (non-retriable); everything else to
      // `network` (retriable) — as required by the task and R4.
      if (isAbortError(cause)) {
        return { ok: false, failure: { kind: 'aborted', retriable: false, cause } };
      }
      return { ok: false, failure: { kind: 'network', retriable: true, cause } };
    }

    const classification: DisneyClassification | null = classifyDisneyResponse({
      target: spec.target,
      status,
      body: text,
    });

    // 2xx — not a failure; the caller proceeds.
    if (classification === null) {
      return { ok: true, response: { status, headers, text } };
    }

    // A classified non-2xx failure. Parse any `Retry-After` floor (R3.4).
    const retryAfterMs = parseRetryAfter(headers['retry-after'], now());
    const failure: TransportFailure =
      retryAfterMs !== undefined
        ? {
            kind: classification.kind,
            retriable: classification.retriable,
            ...(classification.status !== undefined ? { status: classification.status } : {}),
            retryAfterMs,
          }
        : {
            kind: classification.kind,
            retriable: classification.retriable,
            ...(classification.status !== undefined ? { status: classification.status } : {}),
          };
    return { ok: false, failure };
  };

  return {
    async request(spec: DisneyRequestSpec): Promise<DisneyResponse> {
      let dispatches = 0;
      let cumulativeDelayMs = 0;

      for (;;) {
        // Honor a caller deadline/cancellation before spending budget (R4).
        if (spec.signal?.aborted === true) {
          throw new DisneyTransportError(
            'aborted',
            `Request to ${spec.url} was aborted before dispatch.`,
            { url: spec.url, attempts: dispatches },
          );
        }

        // Acquire a Rate_Limiter lease before every dispatch; always release it
        // (R2.1, R2.6, R1.4).
        const lease = await deps.limiter.acquire(spec.target);
        let outcome: Awaited<ReturnType<typeof dispatchOnce>>;
        try {
          outcome = await dispatchOnce(spec);
        } finally {
          lease.release();
        }
        dispatches += 1;

        if (outcome.ok) {
          return outcome.response;
        }

        const { failure } = outcome;

        // Non-retriable classifications raise immediately with no retry
        // (R3.5, R4.4).
        if (!failure.retriable) {
          throw toTransportError(failure, spec, dispatches);
        }

        // Retriable: stop once the retry-count cap is reached (R3.3). We have
        // made `dispatches` dispatches; a further retry is only allowed while
        // that stays within `maxRetries + 1` total dispatches.
        if (dispatches > cfg.maxRetries) {
          throw toTransportError(failure, spec, dispatches);
        }

        // Compute the delay before the next dispatch. `attempt` is 1-based: the
        // first retry (after the first dispatch) is attempt 1.
        const delay = computeBackoffDelay(
          cfg,
          failure.retryAfterMs !== undefined
            ? { attempt: dispatches, jitter: jitter(), retryAfterMs: failure.retryAfterMs }
            : { attempt: dispatches, jitter: jitter() },
        );

        // Stop before a delay that would push the cumulative wait past the cap
        // (R3.6), rethrowing the last failure.
        if (cumulativeDelayMs + delay > cfg.maxTotalDelayMs) {
          throw toTransportError(failure, spec, dispatches);
        }

        await sleep(delay);
        cumulativeDelayMs += delay;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build the single typed error from a normalized failure (R1.5). */
function toTransportError(
  failure: TransportFailure,
  spec: DisneyRequestSpec,
  attempts: number,
): DisneyTransportError {
  const statusPart = failure.status !== undefined ? ` (HTTP ${failure.status})` : '';
  const options: DisneyTransportErrorOptions = {
    url: spec.url,
    attempts,
    ...(failure.status !== undefined ? { status: failure.status } : {}),
    ...(failure.cause !== undefined ? { cause: failure.cause } : {}),
  };
  return new DisneyTransportError(
    failure.kind,
    `Disney request to ${spec.url} failed as \`${failure.kind}\`${statusPart} ` +
      `after ${attempts} dispatch(es).`,
    options,
  );
}

/** Collect a `fetch` `Headers` into a lowercase-keyed plain record. */
function collectHeaders(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

/**
 * Recognize a thrown `AbortError` from any of the common shapes:
 *   - `DOMException`/`Error` whose `name` is `'AbortError'`;
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
