// Feature: disney-source-resilience, Property 1: Transport dispatch discipline
/**
 * Property tests for the `Disney_Transport` (`createDisneyTransport`).
 *
 * This file hosts the transport's dispatch-time correctness properties. Two
 * properties live here:
 *
 *   - **Property 1: Transport dispatch discipline** (below) — every dispatch is
 *     preceded by an acquired Rate_Limiter lease (released afterwards), carries
 *     the target-appropriate `User-Agent`, passes client-supplied Basic/Bearer
 *     auth through untouched, and adds *nothing* beyond `User-Agent` + `Accept`
 *     + the caller's own headers (no per-guest credential) — R1.4, R2.1, R2.6,
 *     R5.1, R5.2, R5.3, R15.2.
 *   - **Property 4: Retry loop honors classification and bounds** — appended by
 *     task 4.3; see the marked section at the end of this file.
 *
 * Shared test helpers (the recording fake limiter, the recording fake fetch,
 * and the request-spec generators) live in the "Shared test helpers" section so
 * both properties can reuse them.
 *
 * **Validates: Requirements 1.4, 2.1, 2.6, 5.1, 5.2, 5.3, 15.2**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DISNEY_FAILURE_KINDS, DISNEY_TARGETS } from '@dwt/shared';
import type {
  BackoffConfig,
  DisneyFailureKind,
  DisneyRequestSpec,
  DisneyTarget,
} from '@dwt/shared';

import { DISNEY_WAF_BODY_MARKERS } from '../classify.js';
import {
  DISNEY_SYNC_GATEWAY_USER_AGENT,
  DISNEY_WEB_USER_AGENT,
  type FetchLike,
} from '../facilitiesClient.js';
import type { RateLimiter, RateLimitLease } from '../rateLimiter.js';
import { createDisneyTransport, DisneyTransportError } from '../transport.js';

/** Spec convention: every `fc.assert` runs with at least 100 iterations. */
const NUM_RUNS = 200;

// ===========================================================================
// Shared test helpers (reused by Property 1 and Property 4)
// ===========================================================================

/**
 * A single entry in the ordered event log recorded across the fake limiter and
 * the fake fetch. The relative order of these entries is what lets a property
 * assert that a lease is always acquired *before* a dispatch and released
 * *after* it.
 */
type TransportEvent =
  | { readonly type: 'acquire'; readonly target: DisneyTarget }
  | { readonly type: 'release'; readonly target: DisneyTarget }
  | {
      readonly type: 'dispatch';
      readonly target: DisneyTarget;
      readonly url: string;
      readonly headers: Record<string, string>;
    };

/** The target-appropriate production `User-Agent` (R5.1, R5.2). */
const EXPECTED_USER_AGENT: Record<DisneyTarget, string> = {
  sync_gateway: DISNEY_SYNC_GATEWAY_USER_AGENT,
  web: DISNEY_WEB_USER_AGENT,
};

/** A recording {@link RateLimiter} that appends acquire/release to `events`. */
function makeRecordingLimiter(events: TransportEvent[]): RateLimiter {
  return {
    acquire(bucket: DisneyTarget): Promise<RateLimitLease> {
      events.push({ type: 'acquire', target: bucket });
      let released = false;
      const lease: RateLimitLease = {
        release(): void {
          // Idempotent, matching the runtime lease contract.
          if (released) {
            return;
          }
          released = true;
          events.push({ type: 'release', target: bucket });
        },
      };
      return Promise.resolve(lease);
    },
  };
}

/**
 * A recording `fetch` that appends a `dispatch` entry (capturing the exact
 * outgoing header record) and returns the supplied `status`/`body`. Defaults to
 * a `200`/`{}` success so, absent a retry scenario, `request` performs exactly
 * one dispatch and resolves.
 */
function makeRecordingFetch(
  events: TransportEvent[],
  target: DisneyTarget,
  status = 200,
  body = '{}',
): FetchLike {
  const impl = async (
    _url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    events.push({
      type: 'dispatch',
      target,
      url: typeof _url === 'string' ? _url : String(_url),
      // Snapshot so later mutation (there is none) cannot affect assertions.
      headers: { ...headers },
    });
    return new Response(body, { status });
  };
  return impl as unknown as FetchLike;
}

/** A backoff config; irrelevant to Property 1 since dispatches always succeed. */
const BACKOFF: BackoffConfig = {
  baseDelayMs: 1,
  factor: 2,
  maxRetries: 3,
  maxDelayMs: 100,
  maxTotalDelayMs: 1_000,
};

/** Any Disney request target. */
const targetArb: fc.Arbitrary<DisneyTarget> = fc.constantFrom(...DISNEY_TARGETS);

/** A client-supplied Basic or Bearer authorization value (R5.3). */
const authValueArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .string({ minLength: 1, maxLength: 24 })
    .map((s) => `Basic ${Buffer.from(s).toString('base64')}`),
  fc
    .stringMatching(/^[A-Za-z0-9._-]{8,40}$/)
    .map((token) => `Bearer ${token}`),
);

/**
 * Additional benign client headers, drawn from a fixed pool of header names
 * that never collide (case-insensitively) with the transport-owned `Accept` or
 * `User-Agent`. This lets a property assert the transport passes them through
 * and adds nothing else.
 */
const extraHeadersArb: fc.Arbitrary<Record<string, string>> = fc
  .array(
    fc.tuple(
      fc.constantFrom(
        'X-Request-Id',
        'If-None-Match',
        'Content-Type',
        'X-Correlation-Id',
      ),
      fc.string({ minLength: 1, maxLength: 16 }),
    ),
    { minLength: 0, maxLength: 4 },
  )
  .map((pairs) => Object.fromEntries(pairs) as Record<string, string>);

/** Reserved header keys the transport owns; clients must not shadow them here. */
const RESERVED = new Set(['accept', 'user-agent']);

/**
 * A {@link DisneyRequestSpec} carrying a client-supplied `Authorization` header
 * plus optional benign extras. The generated `headers` never include a key that
 * collides (case-insensitively) with `Accept`/`User-Agent`, so the expected
 * outgoing header set is exactly `clientKeys ∪ {Accept, User-Agent}`.
 */
const specArb: fc.Arbitrary<DisneyRequestSpec> = fc
  .record({
    target: targetArb,
    url: fc
      .webUrl()
      .map((u) => u)
      .filter((u) => u.length > 0),
    method: fc.constantFrom<'GET' | 'POST'>('GET', 'POST'),
    accept: fc.constantFrom('application/json', 'multipart/related'),
    auth: authValueArb,
    extras: extraHeadersArb,
  })
  .map(({ target, url, method, accept, auth, extras }) => {
    const filteredExtras = Object.fromEntries(
      Object.entries(extras).filter(([k]) => !RESERVED.has(k.toLowerCase())),
    );
    const headers: Record<string, string> = {
      ...filteredExtras,
      Authorization: auth,
    };
    return { target, url, method, accept, headers } satisfies DisneyRequestSpec;
  });

// ===========================================================================
// Property 1: Transport dispatch discipline
// ===========================================================================

describe('createDisneyTransport — Property 1: Transport dispatch discipline', () => {
  it('acquires a lease before every dispatch and releases it after (R1.4, R2.1, R2.6)', async () => {
    await fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        const events: TransportEvent[] = [];
        const transport = createDisneyTransport({
          limiter: makeRecordingLimiter(events),
          backoff: BACKOFF,
          fetch: makeRecordingFetch(events, spec.target),
          now: () => 0,
          sleep: async () => {},
          jitter: () => 0,
        });

        await transport.request(spec);

        const dispatchCount = events.filter((e) => e.type === 'dispatch').length;
        const acquireCount = events.filter((e) => e.type === 'acquire').length;

        // A lease is acquired for (at least) every dispatch (R2.1).
        expect(dispatchCount).toBeGreaterThanOrEqual(1);
        expect(acquireCount).toBeGreaterThanOrEqual(dispatchCount);

        // Walk the log: a dispatch may only occur while a lease is held, and
        // every acquired lease is eventually released (R1.4, R2.6).
        let held = 0;
        for (const event of events) {
          if (event.type === 'acquire') {
            held += 1;
          } else if (event.type === 'dispatch') {
            expect(held).toBeGreaterThan(0);
          } else {
            held -= 1;
            expect(held).toBeGreaterThanOrEqual(0);
          }
        }
        // Every lease released by the end (balanced acquire/release).
        expect(held).toBe(0);

        // For a first-attempt success the order is exactly acquire→dispatch→release.
        expect(events.map((e) => e.type)).toEqual([
          'acquire',
          'dispatch',
          'release',
        ]);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('carries the target-appropriate User-Agent on every dispatch (R5.1, R5.2)', async () => {
    await fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        const events: TransportEvent[] = [];
        const transport = createDisneyTransport({
          limiter: makeRecordingLimiter(events),
          backoff: BACKOFF,
          fetch: makeRecordingFetch(events, spec.target),
          now: () => 0,
          sleep: async () => {},
          jitter: () => 0,
        });

        await transport.request(spec);

        const dispatches = events.filter(
          (e): e is Extract<TransportEvent, { type: 'dispatch' }> =>
            e.type === 'dispatch',
        );
        expect(dispatches.length).toBeGreaterThanOrEqual(1);
        for (const dispatch of dispatches) {
          expect(dispatch.headers['User-Agent']).toBe(
            EXPECTED_USER_AGENT[spec.target],
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('passes client-supplied Basic/Bearer auth through untouched (R5.3)', async () => {
    await fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        const events: TransportEvent[] = [];
        const transport = createDisneyTransport({
          limiter: makeRecordingLimiter(events),
          backoff: BACKOFF,
          fetch: makeRecordingFetch(events, spec.target),
          now: () => 0,
          sleep: async () => {},
          jitter: () => 0,
        });

        await transport.request(spec);

        const expectedAuth = spec.headers?.['Authorization'];
        const dispatches = events.filter(
          (e): e is Extract<TransportEvent, { type: 'dispatch' }> =>
            e.type === 'dispatch',
        );
        for (const dispatch of dispatches) {
          expect(dispatch.headers['Authorization']).toBe(expectedAuth);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('adds nothing beyond User-Agent + Accept + passed-through headers — no per-guest credential (R15.2)', async () => {
    await fc.assert(
      fc.asyncProperty(specArb, async (spec) => {
        const events: TransportEvent[] = [];
        const transport = createDisneyTransport({
          limiter: makeRecordingLimiter(events),
          backoff: BACKOFF,
          fetch: makeRecordingFetch(events, spec.target),
          now: () => 0,
          sleep: async () => {},
          jitter: () => 0,
        });

        await transport.request(spec);

        // The transport is allowed to add exactly `Accept` (from spec.accept)
        // and `User-Agent`; everything else must be a caller-supplied header.
        const expectedKeys = new Set<string>([
          ...Object.keys(spec.headers ?? {}),
          'Accept',
          'User-Agent',
        ]);

        const dispatches = events.filter(
          (e): e is Extract<TransportEvent, { type: 'dispatch' }> =>
            e.type === 'dispatch',
        );
        expect(dispatches.length).toBeGreaterThanOrEqual(1);
        for (const dispatch of dispatches) {
          const actualKeys = new Set(Object.keys(dispatch.headers));
          expect([...actualKeys].sort()).toEqual([...expectedKeys].sort());
          // Accept reflects the spec exactly (not fabricated).
          expect(dispatch.headers['Accept']).toBe(spec.accept);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ===========================================================================
// Property 4: Retry loop honors classification and bounds — added by task 4.3.
// (Reuse the Shared test helpers above; append the Property 4 describe block
//  below this marker.)
// ===========================================================================

// Feature: disney-source-resilience, Property 4: Retry loop honors classification and bounds
/**
 * **Property 4: Retry loop honors classification and bounds**
 *
 * Drives `createDisneyTransport(...).request(spec)` against a fake `fetch` that
 * returns (or throws) failing outcomes and asserts the retry loop's contract:
 *
 *   1. For a *retriable* failure that never recovers: the transport makes at
 *      most `maxRetries + 1` dispatches and raises exactly one
 *      `DisneyTransportError` whose `kind` is a member of the closed
 *      `DISNEY_FAILURE_KINDS` set (R1.5, R3.1, R3.3, R4.2).
 *   2. For a *non-retriable* classification (401, non-WAF 403, abort): exactly
 *      one dispatch and an immediate raise — no retry (R3.5, R4.4).
 *   3. Retry happens **iff** the failure is retriable: a retriable outcome
 *      yields more than one dispatch (`maxRetries + 1`) while a non-retriable
 *      outcome under the *same* config yields exactly one (R3.1, R3.5).
 *   4. A `fetch` that fails `N (< maxRetries)` times then returns `200` resolves
 *      successfully after exactly `N + 1` dispatches (R3.1).
 *
 * Classification is exercised across every retriable source (`5xx` and plain
 * `429` ⇒ `http_status`; WAF-marked `403`/`429` ⇒ `waf_block`; network throw ⇒
 * `network`) and every non-retriable source (`401`/non-WAF `403` ⇒
 * `auth_failure`; abort throw ⇒ `aborted`) so the loop's decision is checked
 * against the real `classifyDisneyResponse` (R4.2, R4.4).
 *
 * `now`/`sleep`/`jitter` are injected deterministically (sleep is a no-op, so
 * the property runs instantly) and `maxTotalDelayMs` is set generously so the
 * dispatch bound is driven purely by `maxRetries`, not the cumulative-delay cap.
 *
 * **Validates: Requirements 1.5, 3.1, 3.3, 3.5, 4.2, 4.4**
 */

// ---------------------------------------------------------------------------
// Property 4 helpers (reuse the Shared test helpers above)
// ---------------------------------------------------------------------------

/** A tiny mutable dispatch counter threaded through the fake `fetch`. */
interface DispatchCounter {
  count: number;
}

/** A failing outcome the fake `fetch` produces for a dispatch. */
type FailingOutcome =
  | { readonly kind: DisneyFailureKind; readonly retriable: boolean; readonly status: number; readonly body: string }
  | { readonly kind: DisneyFailureKind; readonly retriable: boolean; readonly throws: 'network' | 'abort' };

/** The retriable failure kinds the transport may emit (for the closed-set check). */
const RETRIABLE_KINDS: ReadonlySet<DisneyFailureKind> = new Set([
  'http_status',
  'waf_block',
  'network',
]);

/** A body that embeds an Akamai/edge WAF marker so a 403/429 classifies as `waf_block`. */
const wafBodyArb: fc.Arbitrary<string> = fc
  .constantFrom(...DISNEY_WAF_BODY_MARKERS)
  .map((marker) => `<html><head><title>Access</title></head><body>${marker} reference</body></html>`);

/**
 * A body guaranteed to contain no WAF marker, so a 403/429/401 carrying it is
 * classified by status alone (auth vs plain rate-limit) rather than as a WAF
 * block. Fixed safe strings keep the guarantee obvious.
 */
const nonWafBodyArb: fc.Arbitrary<string> = fc.constantFrom(
  '{"error":"invalid_credentials"}',
  '{"message":"unauthorized"}',
  '{"reason":"forbidden"}',
  'nope',
);

/** Any retriable failure outcome: 5xx / plain 429 / WAF 403|429 / network throw. */
const retriableOutcomeArb: fc.Arbitrary<FailingOutcome> = fc.oneof(
  // 5xx ⇒ http_status (retriable). Body is irrelevant (5xx is never WAF-eligible).
  fc
    .record({ status: fc.constantFrom(500, 502, 503, 504), body: nonWafBodyArb })
    .map(({ status, body }) => ({ kind: 'http_status' as const, retriable: true, status, body })),
  // Plain 429 (no WAF marker) ⇒ http_status (retriable).
  nonWafBodyArb.map((body) => ({ kind: 'http_status' as const, retriable: true, status: 429, body })),
  // WAF-marked 403/429 ⇒ waf_block (retriable).
  fc
    .record({ status: fc.constantFrom(403, 429), body: wafBodyArb })
    .map(({ status, body }) => ({ kind: 'waf_block' as const, retriable: true, status, body })),
  // Transport-level (non-abort) throw ⇒ network (retriable).
  fc.constant({ kind: 'network' as const, retriable: true, throws: 'network' as const }),
);

/** Any non-retriable classification: 401 / non-WAF 403 (auth_failure) or abort (aborted). */
const nonRetriableOutcomeArb: fc.Arbitrary<FailingOutcome> = fc.oneof(
  // 401 ⇒ auth_failure.
  nonWafBodyArb.map((body) => ({ kind: 'auth_failure' as const, retriable: false, status: 401, body })),
  // 403 without a WAF marker ⇒ auth_failure.
  nonWafBodyArb.map((body) => ({ kind: 'auth_failure' as const, retriable: false, status: 403, body })),
  // Caller cancellation surfaced as an AbortError throw ⇒ aborted.
  fc.constant({ kind: 'aborted' as const, retriable: false, throws: 'abort' as const }),
);

/**
 * A {@link BackoffConfig} whose `maxRetries` varies but whose cumulative-delay
 * cap is effectively unbounded, so the dispatch count is driven by `maxRetries`
 * alone (never truncated early by `maxTotalDelayMs`).
 */
const retryBackoffArb: fc.Arbitrary<BackoffConfig> = fc
  .integer({ min: 1, max: 5 })
  .map((maxRetries) => ({
    baseDelayMs: 1,
    factor: 2,
    maxRetries,
    maxDelayMs: 10,
    maxTotalDelayMs: 1_000_000_000,
  }));

/** A minimal request spec for `target`; classification is body/status-driven. */
function makeSpec(target: DisneyTarget): DisneyRequestSpec {
  return {
    target,
    url: 'https://example.test/disney',
    method: 'GET',
    accept: 'application/json',
    headers: { Authorization: 'Basic dXNlcjpwYXNz' },
  };
}

/** Produce the {@link Response} / throw for a single failing outcome. */
function applyOutcome(outcome: FailingOutcome): Response {
  if ('throws' in outcome) {
    if (outcome.throws === 'abort') {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    throw new Error('simulated network failure');
  }
  return new Response(outcome.body, { status: outcome.status });
}

/** A fake `fetch` that always produces `outcome`, counting each dispatch. */
function makeFailingFetch(outcome: FailingOutcome, counter: DispatchCounter): FetchLike {
  const impl = async (): Promise<Response> => {
    counter.count += 1;
    return applyOutcome(outcome);
  };
  return impl as unknown as FetchLike;
}

/**
 * A fake `fetch` that fails with `outcome` for the first `n` dispatches, then
 * returns a `200` on dispatch `n + 1`, counting each dispatch.
 */
function makeRecoveringFetch(
  outcome: FailingOutcome,
  n: number,
  counter: DispatchCounter,
): FetchLike {
  const impl = async (): Promise<Response> => {
    counter.count += 1;
    if (counter.count <= n) {
      return applyOutcome(outcome);
    }
    return new Response('{}', { status: 200 });
  };
  return impl as unknown as FetchLike;
}

/** Build a transport wired to the fake `fetch` with deterministic time/jitter. */
function makeTransport(cfg: BackoffConfig, fetchImpl: FetchLike) {
  return createDisneyTransport({
    limiter: makeRecordingLimiter([]),
    backoff: cfg,
    fetch: fetchImpl,
    now: () => 0,
    sleep: async () => {},
    jitter: () => 0,
  });
}

// ===========================================================================
// Property 4: Retry loop honors classification and bounds
// ===========================================================================

describe('createDisneyTransport — Property 4: Retry loop honors classification and bounds', () => {
  it('a never-recovering retriable failure raises one DisneyTransportError after ≤ maxRetries+1 dispatches (R1.5, R3.1, R3.3, R4.2)', async () => {
    await fc.assert(
      fc.asyncProperty(targetArb, retryBackoffArb, retriableOutcomeArb, async (target, cfg, outcome) => {
        const counter: DispatchCounter = { count: 0 };
        const transport = makeTransport(cfg, makeFailingFetch(outcome, counter));

        let thrown: unknown;
        try {
          await transport.request(makeSpec(target));
        } catch (e) {
          thrown = e;
        }

        // Exactly one typed error, with a kind drawn from the closed set (R1.5).
        expect(thrown).toBeInstanceOf(DisneyTransportError);
        const err = thrown as DisneyTransportError;
        expect(DISNEY_FAILURE_KINDS).toContain(err.kind);
        // Retriable outcomes only ever surface a retriable kind here.
        expect(RETRIABLE_KINDS.has(err.kind)).toBe(true);

        // At most maxRetries + 1 dispatches were made (R3.3), and at least one.
        expect(counter.count).toBeGreaterThanOrEqual(1);
        expect(counter.count).toBeLessThanOrEqual(cfg.maxRetries + 1);
        // The error's own attempt count agrees with the observed dispatches.
        expect(err.attempts).toBe(counter.count);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a non-retriable classification raises immediately after exactly one dispatch (R3.5, R4.4)', async () => {
    await fc.assert(
      fc.asyncProperty(targetArb, retryBackoffArb, nonRetriableOutcomeArb, async (target, cfg, outcome) => {
        const counter: DispatchCounter = { count: 0 };
        const transport = makeTransport(cfg, makeFailingFetch(outcome, counter));

        let thrown: unknown;
        try {
          await transport.request(makeSpec(target));
        } catch (e) {
          thrown = e;
        }

        expect(thrown).toBeInstanceOf(DisneyTransportError);
        const err = thrown as DisneyTransportError;
        expect(DISNEY_FAILURE_KINDS).toContain(err.kind);
        // The kind matches the non-retriable classification exactly.
        expect(err.kind).toBe(outcome.kind);
        // Exactly one dispatch, no retry (R3.5, R4.4).
        expect(counter.count).toBe(1);
        expect(err.attempts).toBe(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('retry happens iff the failure is retriable, under one shared config (R3.1, R3.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        targetArb,
        retryBackoffArb,
        retriableOutcomeArb,
        nonRetriableOutcomeArb,
        async (target, cfg, retriable, nonRetriable) => {
          // Retriable outcome: the loop retries up to the cap.
          const rc: DispatchCounter = { count: 0 };
          const rTransport = makeTransport(cfg, makeFailingFetch(retriable, rc));
          await rTransport.request(makeSpec(target)).catch(() => undefined);

          // Non-retriable outcome under the *same* config: no retry.
          const nc: DispatchCounter = { count: 0 };
          const nTransport = makeTransport(cfg, makeFailingFetch(nonRetriable, nc));
          await nTransport.request(makeSpec(target)).catch(() => undefined);

          // Retry happened for the retriable failure (more than one dispatch),
          // exhausting the retry budget since it never recovers.
          expect(rc.count).toBeGreaterThan(1);
          expect(rc.count).toBe(cfg.maxRetries + 1);

          // No retry for the non-retriable failure.
          expect(nc.count).toBe(1);

          // Concretely: retry iff retriable.
          expect(rc.count > 1).toBe(true);
          expect(nc.count > 1).toBe(false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('N (< maxRetries) retriable failures followed by a 200 resolve after exactly N+1 dispatches (R3.1)', async () => {
    const recoveringArb = fc
      .integer({ min: 1, max: 5 })
      .chain((maxRetries) =>
        fc.record({
          cfg: fc.constant<BackoffConfig>({
            baseDelayMs: 1,
            factor: 2,
            maxRetries,
            maxDelayMs: 10,
            maxTotalDelayMs: 1_000_000_000,
          }),
          n: fc.integer({ min: 0, max: maxRetries - 1 }),
          outcome: retriableOutcomeArb,
          target: targetArb,
        }),
      );

    await fc.assert(
      fc.asyncProperty(recoveringArb, async ({ cfg, n, outcome, target }) => {
        const counter: DispatchCounter = { count: 0 };
        const transport = makeTransport(cfg, makeRecoveringFetch(outcome, n, counter));

        const response = await transport.request(makeSpec(target));

        // Resolved successfully with the recovering 200.
        expect(response.status).toBe(200);
        // Exactly N failing dispatches + 1 succeeding dispatch.
        expect(counter.count).toBe(n + 1);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
