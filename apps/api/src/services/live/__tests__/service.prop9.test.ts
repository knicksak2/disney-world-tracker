// Feature: experience-live-details, Property 9: Any failed retrieval with a cache present serves stale and never overwrites
/**
 * Property-based test for the `Live_Service` orchestrator — Property 9
 * (one-property-per-file).
 *
 * ---------------------------------------------------------------------------
 * Property 9: Any failed retrieval with a cache present serves stale and
 *             never overwrites.
 *
 * Validates: Requirements 1.8, 2.6, 2.7, 3.1
 *
 * For any failed retrieval where a cached entry is present, the orchestrator:
 *
 *   - serves the most recent cached `Live_Detail` (the seeded entry), and
 *   - marks the result `stale: true`, and
 *   - leaves the cached entry UNCHANGED — `cache.set` is never invoked and the
 *     stored entry remains byte-for-byte the seeded value.
 *
 * The failure is generated across every distinct failure mode the orchestrator
 * treats as a failed retrieval (design.md "Failure"):
 *
 *   - an upstream `UpstreamError` with kind `http_status`, `network`, or
 *     `invalid_response` (R1.8),
 *   - an aborted / deadline timeout surfacing as `UpstreamError('aborted')`
 *     (R2.6),
 *   - an unparseable / empty body that yields no projectable `liveData` entry
 *     (the orchestrator's `pickEntry` throws), and
 *   - an unresolved upstream id (the repo returns `null`), which never
 *     contacts upstream at all (R1.9).
 *
 * The cache is pre-seeded with an entry whose `retrievedAt` is OLDER than the
 * `Live_Cache_TTL`, so the freshness check misses and a fresh retrieval is
 * attempted for the upstream failure modes — driving the failure path rather
 * than a fresh-cache serve. The orchestrator is driven entirely with in-memory
 * fakes and an explicit request instant (`now`); no Redis, database, or
 * network is involved.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { LiveDetailDTO, OperatingStatus } from '@dwt/shared';

import { createLiveService } from '../service.js';
import { LIVE_CACHE_TTL_SECONDS, type CachedLiveDetail, type LiveCache } from '../cache.js';
import type { LiveRepo } from '../repo.js';
import type { ThemeParksLiveClient, ThemeParksLiveResponse } from '../themeparksLive.js';
import { UpstreamError } from '../../catalog/themeparks.js';

const NUM_RUNS = 200;

const EXPERIENCE_ID = 'exp-prop9';
const UPSTREAM_ID = 'upstream-prop9';

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

/** Repo resolving every Experience to a fixed upstream id, or to `null`. */
function repoResolving(upstreamId: string | null): LiveRepo {
  return {
    async resolveUpstreamEntityId(): Promise<string | null> {
      return upstreamId;
    },
  };
}

/**
 * Map-backed `LiveCache` pre-seeded with one entry. Records every `set` so the
 * test can assert the cached entry is never overwritten on a failed retrieval.
 */
class MapCache implements LiveCache {
  readonly store = new Map<string, CachedLiveDetail>();
  readonly setCalls: Array<{ key: string; entry: CachedLiveDetail }> = [];

  constructor(seed: CachedLiveDetail) {
    this.store.set(EXPERIENCE_ID, seed);
  }

  async get(experienceId: string): Promise<CachedLiveDetail | null> {
    return this.store.get(experienceId) ?? null;
  }

  async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
    this.store.set(experienceId, entry);
    this.setCalls.push({ key: experienceId, entry });
  }
}

/** A client whose `getEntityLive` always throws the supplied error. */
function throwingClient(error: unknown): ThemeParksLiveClient {
  return {
    async getEntityLive(): Promise<ThemeParksLiveResponse> {
      throw error;
    },
  };
}

/** A client returning a fixed response (used for the empty-`liveData` body). */
function respondingClient(response: ThemeParksLiveResponse): ThemeParksLiveClient {
  return {
    async getEntityLive(): Promise<ThemeParksLiveResponse> {
      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Request instant as whole-millisecond epoch values for exact ISO round-trips. */
const nowArb: fc.Arbitrary<Date> = fc
  .integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms));

/** The `OperatingStatus` literal union, typed so the generator yields the union (not `string`). */
const OPERATING_STATUSES: readonly OperatingStatus[] = [
  'Operating',
  'Closed',
  'Down',
  'Refurbishment',
  'Unknown',
];

/** A varied, schema-valid seeded `Live_Detail` so the served value is non-trivial. */
const seededLiveDetailArb: fc.Arbitrary<LiveDetailDTO> = fc
  .record({
    status: fc.constantFrom(...OPERATING_STATUSES),
    waitTime: fc.option(fc.integer({ min: 0, max: 600 }), { nil: undefined }),
  })
  .map(({ status, waitTime }): LiveDetailDTO => {
    return {
      status,
      showtimes: [],
      operatingHours: [],
      diningAvailability: [],
      ...(waitTime !== undefined ? { waitMinutes: waitTime } : {}),
    };
  });

/**
 * Cache age in seconds, ALWAYS strictly older than the TTL so the freshness
 * check misses and a fresh retrieval is attempted (driving the failure path).
 */
const staleAgeSecondsArb: fc.Arbitrary<number> = fc.integer({
  min: LIVE_CACHE_TTL_SECONDS + 1,
  max: 7 * 24 * 60 * 60,
});

/**
 * The failure mode injected into the orchestrator. Each variant carries enough
 * to build the collaborator that triggers it.
 */
type FailureMode =
  | { readonly kind: 'upstream-error'; readonly errorKind: 'http_status' | 'network' | 'invalid_response' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'unparseable-body' }
  | { readonly kind: 'unresolved-id' };

const failureModeArb: fc.Arbitrary<FailureMode> = fc.oneof(
  fc
    .constantFrom('http_status' as const, 'network' as const, 'invalid_response' as const)
    .map((errorKind) => ({ kind: 'upstream-error' as const, errorKind })),
  fc.constant({ kind: 'aborted' as const }),
  fc.constant({ kind: 'unparseable-body' as const }),
  fc.constant({ kind: 'unresolved-id' as const }),
);

interface Scenario {
  readonly now: Date;
  readonly ageSeconds: number;
  readonly seeded: LiveDetailDTO;
  readonly failure: FailureMode;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  now: nowArb,
  ageSeconds: staleAgeSecondsArb,
  seeded: seededLiveDetailArb,
  failure: failureModeArb,
});

/** Build repo + client collaborators that realize the given failure mode. */
function collaboratorsFor(failure: FailureMode): {
  repo: LiveRepo;
  client: ThemeParksLiveClient;
} {
  switch (failure.kind) {
    case 'upstream-error':
      return {
        repo: repoResolving(UPSTREAM_ID),
        client: throwingClient(
          new UpstreamError(failure.errorKind, `injected ${failure.errorKind} failure`),
        ),
      };
    case 'aborted':
      return {
        repo: repoResolving(UPSTREAM_ID),
        client: throwingClient(new UpstreamError('aborted', 'injected aborted/timeout failure')),
      };
    case 'unparseable-body':
      // An empty `liveData` array has no projectable entry; `pickEntry` throws,
      // which the orchestrator treats as a failed retrieval.
      return {
        repo: repoResolving(UPSTREAM_ID),
        client: respondingClient({ liveData: [] }),
      };
    case 'unresolved-id':
      // Repo returns null: upstream is never contacted (R1.9). The client would
      // throw if (incorrectly) called, surfacing any such regression.
      return {
        repo: repoResolving(null),
        client: throwingClient(new Error('client should not be called for an unresolved id')),
      };
  }
}

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe('Live_Service — Property 9: failed retrieval with a cache present serves stale & never overwrites', () => {
  it('serves the most recent cached Live_Detail stale and leaves the cache entry unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const retrievedAt = new Date(
          scenario.now.getTime() - scenario.ageSeconds * 1000,
        ).toISOString();
        const seededEntry: CachedLiveDetail = {
          liveDetail: scenario.seeded,
          retrievedAt,
        };

        const cache = new MapCache(seededEntry);
        const { repo, client } = collaboratorsFor(scenario.failure);

        const service = createLiveService({ repo, cache, client });

        const result = await service.getLiveDetail(EXPERIENCE_ID, scenario.now);

        // --- Serves the most recent cached Live_Detail, marked stale (R2.6, R2.7, R3.1) ---
        expect(result.stale).toBe(true);
        expect(result.liveDetail).toEqual(scenario.seeded);
        expect(result.retrievedAt).toBe(retrievedAt);

        // --- The cache entry was NEVER overwritten (R1.8) ---
        expect(cache.setCalls).toHaveLength(0);
        const stored = await cache.get(EXPERIENCE_ID);
        expect(stored).toBe(seededEntry); // same reference: byte-for-byte unchanged
        expect(stored!.liveDetail).toEqual(scenario.seeded);
        expect(stored!.retrievedAt).toBe(retrievedAt);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
