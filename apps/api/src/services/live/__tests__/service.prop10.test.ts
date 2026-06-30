// Feature: experience-live-details, Property 10: A failed retrieval with no cache yields live_unavailable and stores nothing
/**
 * Property-based test for the `Live_Service` orchestrator — Property 10
 * (one-property-per-file).
 *
 * ---------------------------------------------------------------------------
 * Property 10: A failed retrieval with no cache yields live_unavailable and
 * stores nothing.
 *
 * Validates: Requirements 2.8
 *
 * For any failed retrieval with NO cached entry, the orchestrator:
 *
 *   - rejects with an `AppError` whose `code` is `'live_unavailable'`
 *     (R2.8 / R3.2), and
 *   - stores nothing — `cache.set` is never called and the Live_Cache remains
 *     empty (R2.8).
 *
 * The four failure modes a fresh retrieval can take are all exercised:
 *
 *   1. **Upstream error** — `client.getEntityLive` throws an `UpstreamError`
 *      in each of its discriminated variants (`http_status`, `network`,
 *      `invalid_response`, `aborted`).
 *   2. **Abort / timeout** — the `aborted` `UpstreamError` variant models the
 *      5-second deadline tripping mid-flight.
 *   3. **Unparseable body** — the `invalid_response` `UpstreamError` variant
 *      models a non-JSON / wrong-shape upstream body.
 *   4. **Unresolved upstream id** — the repo returns `null`, so the
 *      orchestrator never contacts upstream (R1.9) and falls straight through
 *      to the failure path.
 *
 * The orchestrator is driven entirely with in-memory fakes and an EMPTY
 * Map-backed `LiveCache`; no Redis, database, or network is involved. The
 * request instant is supplied explicitly via the `now` override so the runs
 * are deterministic.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { AppError } from '../../../errors/index.js';
import { UpstreamError, type UpstreamErrorKind } from '../../catalog/themeparks.js';
import { createLiveService } from '../service.js';
import { WDW_TIME_ZONE } from '../parkTime.js';
import type { CachedLiveDetail, LiveCache } from '../cache.js';
import type { LiveRepo } from '../repo.js';
import type {
  ThemeParksLiveClient,
  ThemeParksLiveResponse,
} from '../themeparksLive.js';

const NUM_RUNS = 200;

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------

/** Repo that resolves a fixed upstream id (resolution succeeds). */
function fixedRepo(upstreamId: string): LiveRepo {
  return {
    async resolveUpstreamEntityId() {
      return upstreamId;
    },
  };
}

/** Repo that never resolves an id (R1.9 — never contacts upstream). */
function unresolvedRepo(): LiveRepo {
  return {
    async resolveUpstreamEntityId() {
      return null;
    },
  };
}

/**
 * An EMPTY Map-backed `LiveCache`. Records every `set` so the test can assert
 * the orchestrator stored nothing on a no-cache failure (R2.8).
 */
class EmptyMapCache implements LiveCache {
  readonly store = new Map<string, CachedLiveDetail>();
  readonly setCalls: Array<{ key: string; entry: CachedLiveDetail }> = [];

  async get(): Promise<CachedLiveDetail | null> {
    // Always a miss — this property covers the no-cache case exclusively.
    return null;
  }

  async set(experienceId: string, entry: CachedLiveDetail): Promise<void> {
    this.store.set(experienceId, entry);
    this.setCalls.push({ key: experienceId, entry });
  }
}

/** Client that throws the given `UpstreamError` variant on every call. */
function throwingClient(kind: UpstreamErrorKind): ThemeParksLiveClient & { calls: number } {
  const client = {
    calls: 0,
    async getEntityLive(): Promise<ThemeParksLiveResponse> {
      client.calls += 1;
      throw new UpstreamError(kind, `Simulated upstream failure (${kind}).`);
    },
  };
  return client;
}

/**
 * Client that returns a gross-shape-valid response whose `liveData` is empty.
 * The orchestrator's `pickEntry` finds no entry to project and throws, which
 * the orchestrator treats as a failed retrieval.
 */
function emptyLiveDataClient(): ThemeParksLiveClient & { calls: number } {
  const client = {
    calls: 0,
    async getEntityLive(): Promise<ThemeParksLiveResponse> {
      client.calls += 1;
      return { liveData: [] };
    },
  };
  return client;
}

/** A client that must never be contacted (used for the unresolved-id case). */
function neverCalledClient(): ThemeParksLiveClient & { calls: number } {
  const client = {
    calls: 0,
    async getEntityLive(): Promise<ThemeParksLiveResponse> {
      client.calls += 1;
      throw new Error('client.getEntityLive must not be called for an unresolved id.');
    },
  };
  return client;
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

/** Every UpstreamError variant — covers upstream error, abort/timeout, unparseable. */
const upstreamErrorKindArb: fc.Arbitrary<UpstreamErrorKind> = fc.constantFrom(
  'http_status',
  'network',
  'invalid_response',
  'aborted',
);

type Failure =
  | { readonly kind: 'upstream-error'; readonly errorKind: UpstreamErrorKind }
  | { readonly kind: 'empty-livedata' }
  | { readonly kind: 'unresolved-id' };

const failureArb: fc.Arbitrary<Failure> = fc.oneof(
  upstreamErrorKindArb.map((errorKind) => ({ kind: 'upstream-error' as const, errorKind })),
  fc.constant({ kind: 'empty-livedata' as const }),
  fc.constant({ kind: 'unresolved-id' as const }),
);

interface Scenario {
  readonly experienceId: string;
  readonly upstreamId: string;
  readonly now: Date;
  readonly failure: Failure;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .tuple(idArb, idArb, nowArb, failureArb)
  .map(([experienceId, upstreamId, now, failure]) => ({
    experienceId,
    upstreamId,
    now,
    failure,
  }));

// ---------------------------------------------------------------------------
// Property 10
// ---------------------------------------------------------------------------

describe('Live_Service — Property 10: failed retrieval with no cache yields live_unavailable & stores nothing', () => {
  it('rejects with AppError live_unavailable and never writes the cache', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const cache = new EmptyMapCache();

        const { repo, client } = ((): {
          repo: LiveRepo;
          client: ThemeParksLiveClient & { calls: number };
        } => {
          switch (scenario.failure.kind) {
            case 'upstream-error':
              return {
                repo: fixedRepo(scenario.upstreamId),
                client: throwingClient(scenario.failure.errorKind),
              };
            case 'empty-livedata':
              return {
                repo: fixedRepo(scenario.upstreamId),
                client: emptyLiveDataClient(),
              };
            case 'unresolved-id':
              return {
                repo: unresolvedRepo(),
                client: neverCalledClient(),
              };
          }
        })();

        const service = createLiveService({
          repo,
          cache,
          client,
          parkTimeZone: WDW_TIME_ZONE,
        });

        // The orchestrator must reject with AppError('live_unavailable') (R2.8).
        let thrown: unknown;
        try {
          await service.getLiveDetail(scenario.experienceId, scenario.now);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(AppError);
        expect((thrown as AppError).code).toBe('live_unavailable');

        // Nothing was stored: cache.set was never called and the store is empty (R2.8).
        expect(cache.setCalls).toHaveLength(0);
        expect(cache.store.size).toBe(0);

        // An unresolved id must never contact upstream (R1.9).
        if (scenario.failure.kind === 'unresolved-id') {
          expect(client.calls).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
