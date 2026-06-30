// Feature: experience-live-details, Property 8: A successful retrieval is stored and reflected with a Retrieved_At
/**
 * Property-based test for the `Live_Service` orchestrator — Property 8.
 *
 * Kept in its own dedicated file (one property per file) so concurrent
 * authoring of the sibling orchestrator properties never clobbers a shared
 * file.
 *
 *   - Property 8: A successful retrieval is stored and reflected with a Retrieved_At
 *
 * Validates: Requirements 2.4, 2.5
 *
 * For any successful upstream retrieval, the orchestrator:
 *   - stores the projected Live_Detail in the cache together with a
 *     Retrieved_At time (R2.4), and
 *   - serves a non-stale result (`stale: false`) whose `retrievedAt` equals
 *     both the cached entry's `retrievedAt` and the request `now` (R2.5).
 *
 * The orchestrator is driven entirely with in-memory fakes:
 *   - a `LiveRepo` that resolves a fixed upstream id (so resolution always
 *     succeeds and a fetch can occur),
 *   - a `Map`-backed `LiveCache` that starts empty (so the cache miss forces a
 *     fresh upstream retrieval), and
 *   - a fake `ThemeParksLiveClient` returning a generated, gross-shape-valid
 *     `ThemeParksLiveResponse` whose `liveData` contains an entry matching the
 *     resolved upstream id.
 *
 * No Redis, database, or network is involved; the request instant is supplied
 * explicitly via the `now` override so the assertions are deterministic.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createLiveService } from '../service.js';
import { WDW_TIME_ZONE } from '../parkTime.js';
import type { CachedLiveDetail, LiveCache } from '../cache.js';
import type { LiveRepo } from '../repo.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveEntry,
  ThemeParksLiveResponse,
} from '../themeparksLive.js';

const NUM_RUNS = 200;
const MAX_MINUTES = 1440;

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

/** Repo that always resolves to a fixed upstream id (resolution succeeds). */
function fixedRepo(upstreamId: string): LiveRepo {
  return {
    async resolveUpstreamEntityId() {
      return upstreamId;
    },
  };
}

/**
 * Map-backed `LiveCache`. Starts empty so the orchestrator's freshness check
 * misses and a fresh upstream retrieval occurs. Records every `set` so the
 * test can assert the projected detail was written with its Retrieved_At.
 */
class MapCache implements LiveCache {
  readonly store = new Map<string, CachedLiveDetail>();
  readonly setCalls: Array<{ key: string; entry: CachedLiveDetail }> = [];

  async get(experienceId: string): Promise<CachedLiveDetail | null> {
    return this.store.get(experienceId) ?? null;
  }

  async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
    this.store.set(experienceId, entry);
    this.setCalls.push({ key: experienceId, entry });
  }
}

/** Client that returns a fixed, generated successful live response. */
function successClient(response: ThemeParksLiveResponse): ThemeParksLiveClient {
  return {
    async getEntityLive() {
      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Non-empty identifier-ish strings for ids. */
const idArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/** A request instant — any real Date with a finite time. */
const nowArb: fc.Arbitrary<Date> = fc
  .integer({ min: Date.UTC(2023, 0, 1), max: Date.UTC(2030, 11, 31) })
  .map((ms) => new Date(ms));

/**
 * A gross-shape-valid upstream live entry. Every field is optional and the
 * projection is total, so any combination projects without throwing. We vary a
 * handful of fields so the stored projection is non-trivial across runs.
 */
function entryArb(matchId: string): fc.Arbitrary<ThemeParksLiveEntry> {
  return fc.record({
    status: fc.constantFrom('OPERATING', 'CLOSED', 'DOWN', 'REFURBISHMENT', 'WEIRD', undefined),
    waitTime: fc.option(fc.integer({ min: 0, max: MAX_MINUTES }), { nil: undefined }),
    lastUpdated: fc.option(
      nowArb.map((d) => d.toISOString()),
      { nil: undefined },
    ),
  }).map(({ status, waitTime, lastUpdated }) => {
    const entry: {
      id: string;
      status?: string;
      lastUpdated?: string;
      queue?: { STANDBY?: { waitTime?: number } };
    } = { id: matchId };
    if (status !== undefined) entry.status = status;
    if (lastUpdated !== undefined) entry.lastUpdated = lastUpdated;
    if (waitTime !== undefined) entry.queue = { STANDBY: { waitTime } };
    return entry as ThemeParksLiveEntry;
  });
}

interface Scenario {
  readonly experienceId: string;
  readonly upstreamId: string;
  readonly now: Date;
  readonly response: ThemeParksLiveResponse;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .tuple(idArb, idArb, nowArb)
  .chain(([experienceId, upstreamId, now]) =>
    // Optionally surround the matching entry with non-matching entries so the
    // orchestrator's id-matching `pickEntry` is exercised, not just "first".
    fc
      .tuple(
        entryArb(upstreamId),
        fc.array(entryArb(`${upstreamId}-other`), { maxLength: 2 }),
      )
      .map(([matching, others]) => {
        const response: ThemeParksLiveResponse = {
          id: upstreamId,
          liveData: [...others, matching],
        };
        return { experienceId, upstreamId, now, response } satisfies Scenario;
      }),
  );

// ===========================================================================
// Property 8
// ===========================================================================

describe('Live_Service — Property 8: successful retrieval stored & reflected with Retrieved_At', () => {
  it('stores the projected detail with a Retrieved_At and serves it non-stale with the same Retrieved_At equal to now', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const cache = new MapCache();
        const service = createLiveService({
          repo: fixedRepo(scenario.upstreamId),
          cache,
          client: successClient(scenario.response),
          parkTimeZone: WDW_TIME_ZONE,
        });

        const result = await service.getLiveDetail(scenario.experienceId, scenario.now);

        const expectedRetrievedAt = scenario.now.toISOString();

        // --- The result is a non-stale, freshly-retrieved serve (R2.5) ---
        expect(result.stale).toBe(false);
        expect(result.retrievedAt).toBe(expectedRetrievedAt);

        // --- The cache was written exactly once with the projected detail (R2.4) ---
        expect(cache.setCalls).toHaveLength(1);
        const cached = await cache.get(scenario.experienceId);
        expect(cached).not.toBeNull();
        expect(cached!.retrievedAt).toBe(expectedRetrievedAt);

        // --- The served detail and Retrieved_At match what was cached ---
        expect(result.retrievedAt).toBe(cached!.retrievedAt);
        expect(result.liveDetail).toEqual(cached!.liveDetail);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
