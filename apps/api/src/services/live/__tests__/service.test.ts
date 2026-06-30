/**
 * Resolution-wiring unit tests for the Live_Service orchestrator (task 7.6).
 *
 * These example-based tests pin the orchestrator's *resolution wiring* — the
 * single piece of relational state the live path touches (R1.1) and the
 * unresolved-id short-circuit (R1.9) — using in-memory fakes only:
 *
 *   - a fake `LiveRepo` that returns either a fixed upstream id or `null`;
 *   - a Map-backed fake `LiveCache` (empty unless explicitly seeded);
 *   - a spy `ThemeParksLiveClient` recording every `getEntityLive` call.
 *
 * The two behaviors asserted:
 *
 *   1. When the repo resolves an id, `client.getEntityLive` is invoked with
 *      *exactly* that resolved upstream id (R1.1) — the resolved id, not the
 *      internal Experience id, is what reaches upstream.
 *   2. When the repo returns `null`, `client.getEntityLive` is NEVER called
 *      (R1.9); with an empty cache the orchestrator throws
 *      `AppError('live_unavailable')` (R2.8) without contacting upstream.
 *
 * Validates: Requirements 1.1, 1.9
 */

import { describe, expect, it } from 'vitest';
import type { LiveDetailDTO } from '@dwt/shared';

import { AppError } from '../../../errors/index.js';
import type { CachedLiveDetail, LiveCache } from '../cache.js';
import type { LiveRepo } from '../repo.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveResponse,
} from '../themeparksLive.js';
import { createLiveService } from '../service.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A `LiveRepo` that always resolves to a fixed upstream id (or `null`). */
function fakeRepo(upstreamId: string | null): LiveRepo {
  return {
    resolveUpstreamEntityId: async () => upstreamId,
  };
}

/**
 * Map-backed `LiveCache`. Records `set` calls so a test can assert nothing
 * was written on the unresolved-id path (R2.8 "store nothing").
 */
class FakeCache implements LiveCache {
  private readonly store = new Map<string, CachedLiveDetail>();
  readonly setCalls: Array<{ experienceId: string; entry: CachedLiveDetail }> = [];

  seed(experienceId: string, entry: CachedLiveDetail): void {
    this.store.set(experienceId, entry);
  }

  async get(experienceId: string): Promise<CachedLiveDetail | null> {
    return this.store.get(experienceId) ?? null;
  }

  async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
    this.store.set(experienceId, entry);
    this.setCalls.push({ experienceId, entry });
  }
}

/**
 * Spy `ThemeParksLiveClient` that records every `getEntityLive(upstreamId)`
 * call and returns a canned response whose single `liveData` entry matches the
 * requested id (so the orchestrator's `pickEntry` projects it cleanly).
 */
class SpyClient implements ThemeParksLiveClient {
  readonly calls: string[] = [];

  async getEntityLive(upstreamId: string): Promise<ThemeParksLiveResponse> {
    this.calls.push(upstreamId);
    return {
      liveData: [{ id: upstreamId, status: 'OPERATING' }],
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = '11111111-1111-1111-1111-111111111111';
const UPSTREAM_ID = 'upstream-abc-123';
const NOW = new Date('2024-05-01T13:00:00Z');

const MINIMAL_LIVE_DETAIL: LiveDetailDTO = {
  status: 'Unknown',
  showtimes: [],
  operatingHours: [],
  diningAvailability: [],
};

// ---------------------------------------------------------------------------
// R1.1 — the resolved upstream id is what reaches upstream
// ---------------------------------------------------------------------------

describe('Live_Service resolution wiring — resolved id reaches upstream (R1.1)', () => {
  it('calls client.getEntityLive with exactly the resolved upstream id', async () => {
    const cache = new FakeCache();
    const client = new SpyClient();
    const service = createLiveService({
      repo: fakeRepo(UPSTREAM_ID),
      cache,
      client,
    });

    await service.getLiveDetail(EXPERIENCE_ID, NOW);

    expect(client.calls).toEqual([UPSTREAM_ID]);
    // The internal Experience id must NOT be what gets sent upstream.
    expect(client.calls).not.toContain(EXPERIENCE_ID);
  });

  it('does not contact upstream when a fresh cached entry already satisfies the request', async () => {
    const cache = new FakeCache();
    // A cache entry retrieved "now" is within the freshness window, so the
    // orchestrator serves it without resolving through to the upstream call.
    cache.seed(EXPERIENCE_ID, {
      liveDetail: MINIMAL_LIVE_DETAIL,
      retrievedAt: NOW.toISOString(),
    });
    const client = new SpyClient();
    const service = createLiveService({
      repo: fakeRepo(UPSTREAM_ID),
      cache,
      client,
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID, NOW);

    expect(result.stale).toBe(false);
    expect(client.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R1.9 — an unresolved id never contacts upstream
// ---------------------------------------------------------------------------

describe('Live_Service resolution wiring — unresolved id never contacts upstream (R1.9)', () => {
  it('never calls client.getEntityLive and throws live_unavailable with an empty cache', async () => {
    const cache = new FakeCache();
    const client = new SpyClient();
    const service = createLiveService({
      repo: fakeRepo(null),
      cache,
      client,
    });

    await expect(service.getLiveDetail(EXPERIENCE_ID, NOW)).rejects.toMatchObject({
      code: 'live_unavailable',
    });
    await expect(service.getLiveDetail(EXPERIENCE_ID, NOW)).rejects.toBeInstanceOf(
      AppError,
    );

    // Upstream was never contacted (R1.9) and nothing was written (R2.8).
    expect(client.calls).toEqual([]);
    expect(cache.setCalls).toEqual([]);
  });

  it('serves the cached value stale without contacting upstream when the id is unresolved but a cache entry exists', async () => {
    const cache = new FakeCache();
    cache.seed(EXPERIENCE_ID, {
      liveDetail: MINIMAL_LIVE_DETAIL,
      retrievedAt: '2020-01-01T00:00:00Z', // ancient — irrelevant on the failure path
    });
    const client = new SpyClient();
    const service = createLiveService({
      repo: fakeRepo(null),
      cache,
      client,
    });

    const result = await service.getLiveDetail(EXPERIENCE_ID, NOW);

    expect(result.stale).toBe(true);
    expect(result.liveDetail).toEqual(MINIMAL_LIVE_DETAIL);
    // Unresolved id short-circuits before any upstream contact (R1.9) and the
    // existing cache entry is not overwritten.
    expect(client.calls).toEqual([]);
    expect(cache.setCalls).toEqual([]);
  });
});
