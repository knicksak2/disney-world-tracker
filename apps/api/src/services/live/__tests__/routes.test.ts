/**
 * Integration smoke test for the Live_Service route (task 8.3).
 *
 * Exercises `GET /catalog/:experienceId/live` end-to-end through the real
 * `buildServer` wiring, with the orchestrator (`createLiveService`) assembled
 * from production collaborators except for the upstream HTTP transport:
 *
 *   - a fake {@link LiveRepo} resolving a fixed upstream id (no Postgres),
 *   - a Map-backed {@link LiveCache} (no Redis), and
 *   - a REAL {@link createThemeParksLiveClient} wired to a STUBBED `fetch`, so
 *     the upstream is fully controlled while the client's parsing and the
 *     route's error-envelope path stay exactly as they run in production.
 *
 * No network port is opened: requests are issued with `app.inject()`.
 *
 * The three scenarios cover the route's externally-observable contract:
 *
 *   1. Success → HTTP 200 `{ liveDetail, retrievedAt, stale:false, upstreamLastUpdated? }` (R2.5).
 *   2. Stale fallback (upstream error AND upstream timeout, each with a seeded
 *      cache) → HTTP 200 with `stale:true` serving the cached value (R2.6, R3.1).
 *   3. No cache + failing upstream → HTTP 503 with the uniform error envelope
 *      `{ error: { code: 'live_unavailable' } }` (R2.8, R3.2).
 *
 * Validates: Requirements 2.5, 2.6, 2.8, 3.2
 */

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { LiveDetailDTO } from '@dwt/shared';

import type { AppConfig } from '../../../config.js';
import { buildServer } from '../../../server.js';
import { type FetchLike } from '../../catalog/themeparks.js';
import {
  createThemeParksLiveClient,
  type ThemeParksLiveResponse,
} from '../themeparksLive.js';
import { createLiveService } from '../service.js';
import {
  LIVE_CACHE_TTL_SECONDS,
  type CachedLiveDetail,
  type LiveCache,
} from '../cache.js';
import type { LiveRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = '11111111-1111-4111-8111-111111111111';
const UPSTREAM_ID = 'space-mountain';

/**
 * Minimal synthetic `AppConfig`. Values only need to satisfy the production
 * config's Zod constraints; the live route never touches the database, Redis,
 * S3, or session config, so those URLs are inert here.
 */
function buildTestConfig(): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, logLevel: 'silent' },
    database: { url: 'postgres://test/dwt' },
    redis: { url: 'redis://test:6379' },
    s3: {
      endpoint: 'https://s3.example.com',
      bucket: 'avatars',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    },
    session: { secret: 'test-session-secret-must-be-at-least-32-chars' },
    themeparks: { baseUrl: 'https://api.themeparks.example.invalid/v1' },
  };
}

/** A representative, well-formed upstream live response body for the success case. */
const SUCCESS_BODY: ThemeParksLiveResponse = {
  id: UPSTREAM_ID,
  name: 'Space Mountain',
  entityType: 'ATTRACTION',
  timezone: 'America/New_York',
  liveData: [
    {
      id: UPSTREAM_ID,
      status: 'OPERATING',
      lastUpdated: '2024-01-01T12:00:00Z',
      queue: { STANDBY: { waitTime: 45 } },
    },
  ],
};

/** A schema-valid seeded `Live_Detail` used to verify the stale-serve fallback. */
const SEEDED_DETAIL: LiveDetailDTO = {
  status: 'Closed',
  showtimes: [],
  operatingHours: [],
  diningAvailability: [],
  waitMinutes: 30,
};

// ---------------------------------------------------------------------------
// In-memory collaborators
// ---------------------------------------------------------------------------

/** Repo resolving every Experience to a fixed upstream id. */
function repoResolving(upstreamId: string | null): LiveRepo {
  return {
    async resolveUpstreamEntityId(): Promise<string | null> {
      return upstreamId;
    },
  };
}

/** Map-backed `LiveCache` that records every `set` so overwrites are observable. */
class MapCache implements LiveCache {
  readonly store = new Map<string, CachedLiveDetail>();
  readonly setCalls: Array<{ key: string; entry: CachedLiveDetail }> = [];

  constructor(seed?: { key: string; entry: CachedLiveDetail }) {
    if (seed) this.store.set(seed.key, seed.entry);
  }

  async get(experienceId: string): Promise<CachedLiveDetail | null> {
    return this.store.get(experienceId) ?? null;
  }

  async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
    this.store.set(experienceId, entry);
    this.setCalls.push({ key: experienceId, entry });
  }
}

// ---------------------------------------------------------------------------
// Stubbed `fetch` transports
// ---------------------------------------------------------------------------

/** A `fetch` returning a JSON body with the given HTTP status. */
function jsonFetch(body: unknown, status = 200): FetchLike {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as FetchLike;
}

/**
 * A `fetch` that never resolves on its own but rejects with an `AbortError`
 * when the orchestrator's deadline aborts the request — simulating a timeout.
 */
function hangingFetch(): FetchLike {
  return ((_url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined) return;
      const onAbort = (): void => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    })) as FetchLike;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  readonly app: FastifyInstance;
  readonly cache: MapCache;
}

/**
 * Build a full server with the live service wired from a fixed-resolving repo,
 * a Map-backed cache, and the real live client over the supplied stub `fetch`.
 */
function buildHarness(opts: {
  fetch: FetchLike;
  upstreamId?: string | null;
  seed?: { key: string; entry: CachedLiveDetail };
  deadlineMs?: number;
}): Harness {
  const repo = repoResolving(opts.upstreamId ?? UPSTREAM_ID);
  const cache = new MapCache(opts.seed);
  const client = createThemeParksLiveClient({
    baseUrl: 'https://api.themeparks.example.invalid/v1',
    fetch: opts.fetch,
  });
  const live = createLiveService({
    repo,
    cache,
    client,
    ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
  });
  const app = buildServer(buildTestConfig(), { live });
  return { app, cache };
}

/** Build a cache seed entry whose `retrievedAt` is older than the freshness TTL. */
function staleSeed(now: Date): { key: string; entry: CachedLiveDetail } {
  const retrievedAt = new Date(
    now.getTime() - (LIVE_CACHE_TTL_SECONDS + 60) * 1000,
  ).toISOString();
  return { key: EXPERIENCE_ID, entry: { liveDetail: SEEDED_DETAIL, retrievedAt } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /catalog/:experienceId/live — integration smoke', () => {
  let current: FastifyInstance | undefined;

  afterEach(async () => {
    if (current) {
      await current.close();
      current = undefined;
    }
  });

  it('returns 200 with a fresh, non-stale Live_Detail on a successful upstream fetch (R2.5)', async () => {
    const { app, cache } = buildHarness({ fetch: jsonFetch(SUCCESS_BODY) });
    current = app;

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${EXPERIENCE_ID}/live`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      liveDetail: LiveDetailDTO;
      retrievedAt: string;
      stale: boolean;
      upstreamLastUpdated?: string;
    };

    expect(body.stale).toBe(false);
    expect(body.liveDetail.status).toBe('Operating');
    expect(body.liveDetail.waitMinutes).toBe(45);
    expect(typeof body.retrievedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.retrievedAt))).toBe(false);
    expect(body.upstreamLastUpdated).toBeDefined();
    expect(Date.parse(body.upstreamLastUpdated as string)).toBe(
      Date.parse('2024-01-01T12:00:00Z'),
    );

    // The fresh retrieval was stored in the cache with its Retrieved_At.
    expect(cache.setCalls).toHaveLength(1);
  });

  it('returns 200 with stale:true serving the cached value when the upstream errors (R2.6, R3.1)', async () => {
    const now = new Date();
    const seed = staleSeed(now);
    const { app, cache } = buildHarness({
      fetch: jsonFetch({}, 500),
      seed,
    });
    current = app;

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${EXPERIENCE_ID}/live`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      liveDetail: LiveDetailDTO;
      retrievedAt: string;
      stale: boolean;
    };
    expect(body.stale).toBe(true);
    expect(body.liveDetail).toEqual(SEEDED_DETAIL);
    expect(body.retrievedAt).toBe(seed.entry.retrievedAt);

    // The cached entry must NOT be overwritten on a failed retrieval.
    expect(cache.setCalls).toHaveLength(0);
  });

  it('returns 200 with stale:true serving the cached value when the upstream times out (R2.6)', async () => {
    const now = new Date();
    const seed = staleSeed(now);
    const { app, cache } = buildHarness({
      fetch: hangingFetch(),
      seed,
      deadlineMs: 20,
    });
    current = app;

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${EXPERIENCE_ID}/live`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { liveDetail: LiveDetailDTO; stale: boolean };
    expect(body.stale).toBe(true);
    expect(body.liveDetail).toEqual(SEEDED_DETAIL);
    expect(cache.setCalls).toHaveLength(0);
  });

  it('returns 503 live_unavailable when the upstream fails and no cache exists (R2.8, R3.2)', async () => {
    const { app, cache } = buildHarness({ fetch: jsonFetch({}, 500) });
    current = app;

    const res = await app.inject({
      method: 'GET',
      url: `/catalog/${EXPERIENCE_ID}/live`,
    });

    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('live_unavailable');

    // Nothing was stored on a failed retrieval with no cache (R2.8).
    expect(cache.setCalls).toHaveLength(0);
  });
});
