// Feature: experience-live-details, Property 7: Cache freshness decision is keyed on age versus the 5-minute TTL
/**
 * Property-based test for the Live_Service orchestrator — Property 7
 * (one-property-per-file).
 *
 * ---------------------------------------------------------------------------
 * Property 7: Cache freshness decision is keyed on age versus the 5-minute TTL.
 *
 * Validates: Requirements 2.1, 2.2
 *
 * For any cached entry and request instant, the orchestrator:
 *
 *   - serves the cached `Live_Detail` WITHOUT contacting upstream
 *     (`client.getEntityLive` is never called) when the cached entry exists
 *     and its age is AT MOST `LIVE_CACHE_TTL_SECONDS` (300s) (R2.2); and
 *   - performs a fresh retrieval (`client.getEntityLive` is called exactly
 *     once) BEFORE serving when there is no cached entry, or the cached age
 *     STRICTLY EXCEEDS the TTL (R2.1).
 *
 * The orchestrator is driven entirely with in-memory fakes and an explicit
 * request instant (`now`), so the freshness decision is exercised
 * deterministically across the below / at / above the TTL boundary.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { LiveDetailDTO } from '@dwt/shared';

import { createLiveService } from '../service.js';
import { LIVE_CACHE_TTL_SECONDS, type CachedLiveDetail, type LiveCache } from '../cache.js';
import type { LiveRepo } from '../repo.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveResponse,
} from '../themeparksLive.js';

const NUM_RUNS = 200;

const EXPERIENCE_ID = 'exp-prop7';
const UPSTREAM_ID = 'upstream-prop7';

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

/** A repo that resolves every Experience to a single fixed upstream id (R1.1). */
function fixedRepo(): LiveRepo {
  return {
    async resolveUpstreamEntityId(): Promise<string | null> {
      return UPSTREAM_ID;
    },
  };
}

/** A Map-backed LiveCache, optionally pre-seeded with one entry. */
function mapCache(seed?: CachedLiveDetail): LiveCache {
  const store = new Map<string, CachedLiveDetail>();
  if (seed !== undefined) {
    store.set(EXPERIENCE_ID, seed);
  }
  return {
    async get(experienceId: string): Promise<CachedLiveDetail | null> {
      return store.get(experienceId) ?? null;
    },
    async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
      store.set(experienceId, entry);
    },
  };
}

/** A spy client that counts `getEntityLive` calls and returns a fresh payload. */
function spyClient(): ThemeParksLiveClient & { calls: number } {
  const spy = {
    calls: 0,
    async getEntityLive(): Promise<ThemeParksLiveResponse> {
      spy.calls += 1;
      // A minimal but valid live payload that projects successfully — the
      // matching entry is selected by id and projected to a Live_Detail.
      return { liveData: [{ id: UPSTREAM_ID, status: 'OPERATING' }] };
    },
  };
  return spy;
}

// The cached Live_Detail used for the freshness decision. Its `status` is
// deliberately distinct from the fresh payload's projection so a cache-serve
// is distinguishable from a fresh-serve.
const CACHED_LIVE_DETAIL: LiveDetailDTO = {
  status: 'Closed',
  showtimes: [],
  operatingHours: [],
  diningAvailability: [],
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Request instant as whole-millisecond epoch values for exact ISO round-trips. */
const nowArb: fc.Arbitrary<Date> = fc
  .integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2030, 0, 1) })
  .map((ms) => new Date(ms));

/**
 * Cached-entry age in seconds, spanning below / at / above the 300s boundary.
 * A small negative range covers a future-stamped entry (age ≤ TTL too).
 */
const ageSecondsArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: -5, max: LIVE_CACHE_TTL_SECONDS }), // ≤ TTL → serve cached
  fc.constant(LIVE_CACHE_TTL_SECONDS), // exactly at the boundary → serve cached
  fc.integer({ min: LIVE_CACHE_TTL_SECONDS + 1, max: 24 * 60 * 60 }), // > TTL → fetch
);

type Scenario =
  | { readonly kind: 'cached'; readonly now: Date; readonly ageSeconds: number }
  | { readonly kind: 'no-cache'; readonly now: Date };

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  fc.record({
    kind: fc.constant('cached' as const),
    now: nowArb,
    ageSeconds: ageSecondsArb,
  }),
  fc.record({
    kind: fc.constant('no-cache' as const),
    now: nowArb,
  }),
);

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe('Live_Service — Property 7: cache freshness decision keyed on age vs the 5-minute TTL', () => {
  it('serves cache without upstream when age ≤ TTL; fetches when missing or age > TTL', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const client = spyClient();

        if (scenario.kind === 'cached') {
          const retrievedAt = new Date(
            scenario.now.getTime() - scenario.ageSeconds * 1000,
          ).toISOString();
          const cachedEntry: CachedLiveDetail = {
            liveDetail: CACHED_LIVE_DETAIL,
            retrievedAt,
          };
          const service = createLiveService({
            repo: fixedRepo(),
            cache: mapCache(cachedEntry),
            client,
          });

          const result = await service.getLiveDetail(EXPERIENCE_ID, scenario.now);

          if (scenario.ageSeconds <= LIVE_CACHE_TTL_SECONDS) {
            // Fresh-enough cache: served without contacting upstream (R2.2).
            expect(client.calls).toBe(0);
            expect(result.stale).toBe(false);
            expect(result.liveDetail).toEqual(CACHED_LIVE_DETAIL);
            expect(result.retrievedAt).toBe(retrievedAt);
          } else {
            // Stale cache: a fresh retrieval happens before serving (R2.1).
            expect(client.calls).toBe(1);
            expect(result.stale).toBe(false);
            expect(result.retrievedAt).toBe(scenario.now.toISOString());
          }
        } else {
          // No cached entry: a fresh retrieval happens before serving (R2.1).
          const service = createLiveService({
            repo: fixedRepo(),
            cache: mapCache(),
            client,
          });

          const result = await service.getLiveDetail(EXPERIENCE_ID, scenario.now);

          expect(client.calls).toBe(1);
          expect(result.stale).toBe(false);
          expect(result.retrievedAt).toBe(scenario.now.toISOString());
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
