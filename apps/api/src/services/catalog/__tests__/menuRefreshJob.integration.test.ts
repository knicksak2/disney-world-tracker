/**
 * Integration test for the background menu-refresh job (task 9.4, R8.3).
 *
 * Unlike the unit tests, which fake the retrieval seam, this test wires the
 * *real* pieces together end to end:
 *
 *   createMenuRefreshJob
 *     → real createMenuRetrieval        (lazy/throttled retrieval seam)
 *       → real createFacilitiesClient   (URL building, Public_Token, auth headers)
 *         → real createDisneyTransport  (User-Agent, lease-before-dispatch, retry)
 *           → real createInProcessRateLimiter (the shared Rate_Limiter budget)
 *             → recording fake `fetch`  (the only stubbed edge)
 *
 * Only two seams are faked: the network (`fetch`) and the two repos (the menu
 * fetch-state repo, whose entries are all missing so a real fetch happens, and
 * the restaurant-listing repo). Everything between the job and the socket is
 * production code.
 *
 * The two things R8.3 requires this job to guarantee — that a background
 * refresh dispatches its Menu_Service requests *through the transport* and is
 * *paced by the shared limiter* — are asserted by observing an ordered event
 * log shared across the Rate_Limiter and `fetch`:
 *
 *   1. **Through the transport.** The recording `fetch` sees the Menu_Service
 *      GETs, each carrying the transport-injected `Web_User_Agent` and the
 *      client-built `Authorization: Bearer` header. A bare `fetch` from the job
 *      or client could not have produced those headers — the transport owns the
 *      User-Agent — so their presence proves the request funnelled through
 *      `transport.request`.
 *   2. **Paced by the limiter.** Every `dispatch` event is bracketed by an
 *      `acquire` immediately before and a `release` immediately after, i.e. the
 *      events form strict `[acquire, dispatch, release]` triples. So no request
 *      is ever dispatched without first acquiring a lease from the shared
 *      Rate_Limiter (R2.1). A second example drives the real in-process limiter
 *      with a 1-rps budget and a virtual clock and asserts the limiter actually
 *      *delays* the later dispatches (it slept to pace them).
 *
 * Validates: Requirements 8.3
 */

import { describe, expect, it } from 'vitest';

import type { DisneyTarget, RateLimiterConfig } from '@dwt/shared';

import {
  DISNEY_WEB_USER_AGENT,
  createFacilitiesClient,
  type FetchLike,
} from '../disney/facilitiesClient.js';
import {
  createInProcessRateLimiter,
  type RateLimiter,
  type RateLimitLease,
} from '../disney/rateLimiter.js';
import { createDisneyTransport } from '../disney/transport.js';
import { createMenuRefreshJob, type MenuRefreshRepo } from '../menuRefreshJob.js';
import { createMenuRetrieval, type MenuRetrievalRepo } from '../menuRetrieval.js';
import type { MenuFetchState } from '../repo.js';

// ---------------------------------------------------------------------------
// Fixed test doubles for the two genuine edges (network + repos)
// ---------------------------------------------------------------------------

/** Distinguishable stand-in Disney endpoints so the recording fetch can route. */
const MENU_BASE_URL = 'https://menu.example.test/dining-menus';
const AUTH_URL = 'https://auth.example.test/token';
const SYNC_GW_BASE_URL = 'https://sync-gw.example.test/pub';

/** 24h freshness window; irrelevant here because every cache entry is missing. */
const FRESHNESS_MS = 86_400_000;

const BACKOFF = {
  baseDelayMs: 1,
  factor: 2,
  maxRetries: 0, // no retries needed; the fake fetch always returns 200
  maxTotalDelayMs: 1_000,
  maxDelayMs: 100,
} as const;

/** The restaurant Experiences the refresh job enumerates. */
const RESTAURANTS: readonly { readonly id: string; readonly entId: string }[] = [
  { id: 'exp-1', entId: '80010177;entityType=restaurant' },
  { id: 'exp-2', entId: '90002021;entityType=restaurant' },
  { id: 'exp-3', entId: '11223344;entityType=restaurant' },
];

/**
 * A single entry in the ordered log shared by the Rate_Limiter and `fetch`.
 * The relative order is what lets us assert a lease is acquired *before* every
 * dispatch and released *after* it.
 */
type TransportEvent =
  | { readonly type: 'acquire'; readonly target: DisneyTarget }
  | { readonly type: 'release'; readonly target: DisneyTarget }
  | { readonly type: 'dispatch'; readonly url: string; readonly headers: Record<string, string> };

/**
 * A recording {@link RateLimiter} that wraps the *real* in-process limiter:
 * every `acquire`/`release` is appended to `events` while the underlying real
 * limiter still enforces the budget (so pacing is genuine, not simulated).
 */
function recordingLimiter(inner: RateLimiter, events: TransportEvent[]): RateLimiter {
  return {
    async acquire(bucket: DisneyTarget): Promise<RateLimitLease> {
      const lease = await inner.acquire(bucket);
      events.push({ type: 'acquire', target: bucket });
      let released = false;
      return {
        release(): void {
          if (released) {
            return;
          }
          released = true;
          events.push({ type: 'release', target: bucket });
          lease.release();
        },
      };
    },
  };
}

/**
 * A recording `fetch` that appends a `dispatch` entry (capturing the exact
 * outgoing headers) and routes by URL: the authorization endpoint issues a
 * Public_Token, the Menu_Service base returns a one-menu payload, anything else
 * is an empty `200`.
 */
function recordingFetch(events: TransportEvent[]): FetchLike {
  const impl = async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = typeof url === 'string' ? url : String(url);
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    events.push({ type: 'dispatch', url: urlStr, headers });

    if (urlStr === AUTH_URL) {
      return new Response(
        JSON.stringify({ access_token: 'public-token-abc', expires_in: 3600 }),
        { status: 200 },
      );
    }
    if (urlStr.startsWith(MENU_BASE_URL)) {
      return new Response(
        JSON.stringify([
          {
            menuType: 'Dinner',
            cuisineType: 'American',
            groups: [{ name: 'Mains', items: [{ name: 'Steak', price: '$40' }] }],
          },
        ]),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 200 });
  };
  return impl as unknown as FetchLike;
}

/** Menu fetch-state repo: every restaurant's cache is missing ⇒ a real fetch. */
function menuStateRepo(upserts: { experienceId: string }[]): MenuRetrievalRepo {
  const byId = new Map(RESTAURANTS.map((r) => [r.id, r.entId]));
  return {
    async getMenuFetchState(experienceId: string): Promise<MenuFetchState | null> {
      const entId = byId.get(experienceId);
      if (entId === undefined) {
        return null;
      }
      return { upstreamEntityId: entId, cached: null };
    },
    async upsertMenus(experienceId): Promise<void> {
      upserts.push({ experienceId });
    },
  };
}

/** Restaurant-listing repo: returns the fixed restaurant set. */
function listingRepo(): MenuRefreshRepo {
  return {
    async listActiveExperiences() {
      return RESTAURANTS.map((r) => ({ id: r.id }));
    },
  };
}

const silentLogger = { warn() {}, debug() {} };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('menu refresh job — integration (task 9.4, R8.3)', () => {
  it('dispatches Menu_Service requests through the transport, each preceded by a limiter lease', async () => {
    const events: TransportEvent[] = [];
    const upserts: { experienceId: string }[] = [];

    // Real in-process Rate_Limiter with generous budget (pacing exercised in
    // the next example); wrapped only to record acquire/release ordering.
    const cfg: RateLimiterConfig = { maxRequestsPerSecond: 100, maxConcurrency: 4 };
    const limiter = recordingLimiter(createInProcessRateLimiter(cfg), events);

    // Real transport on the recording fetch + recording limiter.
    const transport = createDisneyTransport({
      limiter,
      backoff: BACKOFF,
      fetch: recordingFetch(events),
    });

    // Real Facilities_Client on the real transport.
    const client = createFacilitiesClient({
      transport,
      baseUrl: SYNC_GW_BASE_URL,
      credentials: { username: 'u', password: 'p' },
      menuService: { baseUrl: MENU_BASE_URL, authorizationUrl: AUTH_URL },
    });

    // Real lazy menu retrieval on the real client.
    const menuRetrieval = createMenuRetrieval({
      repo: menuStateRepo(upserts),
      client,
      freshnessMs: FRESHNESS_MS,
      logger: { warn() {} },
    });

    // Real background refresh job on the real retrieval seam.
    const job = createMenuRefreshJob({
      repo: listingRepo(),
      menuRetrieval,
      logger: silentLogger,
    });

    const result = await job.refreshStaleMenus(new Date(0));

    // The pass enumerated and processed all restaurants without error.
    expect(result).toEqual({
      listed: RESTAURANTS.length,
      processed: RESTAURANTS.length,
      errored: 0,
      listingFailed: false,
    });
    // Each restaurant's freshly-fetched menu was cached.
    expect(upserts.map((u) => u.experienceId).sort()).toEqual(['exp-1', 'exp-2', 'exp-3']);

    const dispatches = events.filter(
      (e): e is Extract<TransportEvent, { type: 'dispatch' }> => e.type === 'dispatch',
    );

    // (1) The Menu_Service GETs went THROUGH the transport — one per restaurant,
    // each carrying the transport-injected Web_User_Agent and the client-built
    // Bearer auth. A bare fetch could not have set the User-Agent.
    const menuDispatches = dispatches.filter((d) => d.url.startsWith(MENU_BASE_URL));
    expect(menuDispatches).toHaveLength(RESTAURANTS.length);
    for (const d of menuDispatches) {
      expect(d.headers['User-Agent']).toBe(DISNEY_WEB_USER_AGENT);
      expect(d.headers['Authorization']).toMatch(/^Bearer /u);
    }
    // The Public_Token was acquired exactly once through the transport and
    // reused for the remaining restaurants.
    expect(dispatches.filter((d) => d.url === AUTH_URL)).toHaveLength(1);
    // No request ever hit a bare fetch outside the two Disney endpoints.
    for (const d of dispatches) {
      expect(d.url === AUTH_URL || d.url.startsWith(MENU_BASE_URL)).toBe(true);
    }

    // (2) Paced by the shared limiter: the events form strict
    // [acquire, dispatch, release] triples, so every dispatch was preceded by a
    // Rate_Limiter lease acquisition and followed by its release (R2.1).
    expect(events.length).toBe(dispatches.length * 3);
    for (let i = 0; i < events.length; i += 3) {
      expect(events[i]?.type).toBe('acquire');
      expect(events[i + 1]?.type).toBe('dispatch');
      expect(events[i + 2]?.type).toBe('release');
    }
    // Every dispatch consulted the 'web' bucket of the shared limiter.
    const acquires = events.filter((e) => e.type === 'acquire');
    expect(acquires).toHaveLength(dispatches.length);
    for (const a of acquires) {
      expect((a as Extract<TransportEvent, { type: 'acquire' }>).target).toBe('web');
    }
  });

  it('is paced by the shared Rate_Limiter: a 1-rps budget delays later dispatches', async () => {
    const events: TransportEvent[] = [];
    const upserts: { experienceId: string }[] = [];

    // A virtual clock + recording sleep drive the REAL in-process limiter so we
    // can observe it actively pacing without real wall-clock time.
    let clock = 0;
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      clock += ms;
      sleeps.push(ms);
      return Promise.resolve();
    };

    // Budget of one request per second, one at a time — the tightest pacing.
    const cfg: RateLimiterConfig = { maxRequestsPerSecond: 1, maxConcurrency: 1 };
    const realLimiter = createInProcessRateLimiter(cfg, { now: () => clock, sleep });
    const limiter = recordingLimiter(realLimiter, events);

    const transport = createDisneyTransport({
      limiter,
      backoff: BACKOFF,
      fetch: recordingFetch(events),
      now: () => clock,
      sleep,
    });

    const client = createFacilitiesClient({
      transport,
      baseUrl: SYNC_GW_BASE_URL,
      credentials: { username: 'u', password: 'p' },
      menuService: { baseUrl: MENU_BASE_URL, authorizationUrl: AUTH_URL },
    });

    const menuRetrieval = createMenuRetrieval({
      repo: menuStateRepo(upserts),
      client,
      freshnessMs: FRESHNESS_MS,
      logger: { warn() {} },
    });

    const job = createMenuRefreshJob({
      repo: listingRepo(),
      menuRetrieval,
      logger: silentLogger,
    });

    const result = await job.refreshStaleMenus(new Date(0));
    expect(result.processed).toBe(RESTAURANTS.length);

    const dispatchCount = events.filter((e) => e.type === 'dispatch').length;
    // token (1) + one menu per restaurant (3) = 4 dispatches.
    expect(dispatchCount).toBe(RESTAURANTS.length + 1);

    // With a 1-rps budget the limiter cannot dispatch all four back to back in
    // the same second: it must sleep to pace them. Each rate-gated wait is one
    // full window, and the number of pacing sleeps is (dispatches - 1) because
    // only the very first dispatch in a fresh window is admitted immediately.
    const rateSleeps = sleeps.filter((ms) => ms > 0);
    expect(rateSleeps.length).toBeGreaterThanOrEqual(dispatchCount - 1);
    expect(rateSleeps.every((ms) => ms <= 1000)).toBe(true);
    // The virtual clock advanced by the paced waits, confirming real pacing.
    expect(clock).toBeGreaterThanOrEqual((dispatchCount - 1) * 1000);
  });
});
