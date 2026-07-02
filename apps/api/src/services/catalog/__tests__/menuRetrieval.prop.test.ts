/**
 * Property-based test for lazy, throttled restaurant-menu retrieval
 * (design.md → "Property 10: Lazy menu retrieval").
 *
 * The lazy menu seam (`menuRetrieval.ts`) serves a restaurant Experience's
 * menu against the demand-driven freshness policy encoded by the pure
 * `decideMenuFetch(fetchedAt, now, interval)`:
 *
 *   - FRESH cache (`fetchedAt` present and `now - fetchedAt <= interval`):
 *     `getMenuForRestaurant` serves the cached menus and NEVER contacts the
 *     Menu_Service (`client.getMenus` is never called) (R8.4).
 *
 *   - MISSING (`fetchedAt === null`) or STALE (`now - fetchedAt > interval`):
 *     the seam fetches through `Facilities_Client.getMenus`, projects the raw
 *     payload via `projectMenus`, caches it via `repo.upsertMenus` with a fresh
 *     `fetched_at` equal to the read instant, and serves the projection (R8.2).
 *
 *   - A fetch FAILURE (`client.getMenus` throws): the seam serves any prior
 *     cached menus unchanged, records the failure (`logger.warn`), and does NOT
 *     raise (R8.5).
 *
 * The seam's every collaborator — repo, Facilities_Client, freshness interval,
 * clock, logger — is injected, so the property runs entirely in-memory across
 * the whole cache-state space (missing / fresh / stale) with no timers,
 * network, or database. A second property sweeps the pure `decideMenuFetch`
 * boundary directly (missing ⇒ fetch, fresh incl. inclusive boundary and clock
 * skew ⇒ serve, stale ⇒ fetch).
 *
 * The unit tests in `menuRetrieval.test.ts` pin concrete examples; this file is
 * the property sweep and intentionally does not duplicate them.
 *
 * // Feature: disney-source-resilience, Property 10: Lazy menu retrieval
 * Validates: Requirements 8.2, 8.4, 8.5
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { MenuDTO } from '@dwt/shared';

import type { RawMenu } from '../disney/menu.js';
import { projectMenus } from '../disney/menu.js';
import {
  createMenuRetrieval,
  decideMenuFetch,
  type MenuFetchClient,
  type MenuRetrievalLogger,
  type MenuRetrievalRepo,
} from '../menuRetrieval.js';
import type { MenuFetchState } from '../repo.js';

// ---------------------------------------------------------------------------
// Fakes: repo, client, logger — each records how it was called
// ---------------------------------------------------------------------------

interface UpsertCall {
  readonly experienceId: string;
  readonly menus: readonly MenuDTO[];
  readonly fetchedAt: Date;
}

function makeRepo(
  state: MenuFetchState | null,
  upserts: UpsertCall[],
): MenuRetrievalRepo {
  return {
    async getMenuFetchState() {
      return state;
    },
    async upsertMenus(experienceId, menus, fetchedAt) {
      upserts.push({ experienceId, menus, fetchedAt });
    },
  };
}

/** A client that either returns raw menus or throws, recording each call arg. */
function makeClient(
  raw: readonly RawMenu[],
  shouldThrow: boolean,
  calls: string[],
): MenuFetchClient {
  return {
    async getMenus(enterpriseId: string) {
      calls.push(enterpriseId);
      if (shouldThrow) {
        throw new Error('Menu_Service fetch failed');
      }
      return raw;
    },
  };
}

function makeLogger(warnings: string[]): MenuRetrievalLogger {
  return { warn: (_obj, msg) => warnings.push(msg) };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const idArb: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 40 });

/** Freshness window in milliseconds, spanning zero up to ~2.7h. */
const intervalArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: 10_000_000,
});

/** An epoch-ms base instant for the cached `fetched_at`. */
const baseMsArb: fc.Arbitrary<number> = fc.integer({
  min: 0,
  max: 4_000_000_000_000,
});

/** A well-formed cached `MenuDTO`. */
const menuDtoArb: fc.Arbitrary<MenuDTO> = fc.record({
  menuType: fc.string(),
  cuisineType: fc.option(fc.string(), { nil: null }),
  groups: fc.array(
    fc.record({
      name: fc.string(),
      items: fc.array(
        fc.record({
          name: fc.string(),
          price: fc.option(fc.string(), { nil: null }),
        }),
      ),
    }),
  ),
});

const cachedMenusArb: fc.Arbitrary<readonly MenuDTO[]> = fc.array(menuDtoArb, {
  maxLength: 4,
});

/**
 * A raw Menu_Service payload (tolerant, every field optional). Each field is
 * declared `?: string | null` on `RawMenu`/`RawMenuGroup`/`RawMenuItem`, so the
 * generator emits `string | null` (`{ nil: null }`) — never `undefined`, which
 * `exactOptionalPropertyTypes` forbids assigning to an optional field.
 */
const rawMenuArb: fc.Arbitrary<readonly RawMenu[]> = fc.array(
  fc.record({
    menuType: fc.option(fc.string(), { nil: null }),
    cuisineType: fc.option(fc.string(), { nil: null }),
    groups: fc.array(
      fc.record({
        name: fc.option(fc.string(), { nil: null }),
        items: fc.array(
          fc.record({
            name: fc.option(fc.string(), { nil: null }),
            price: fc.option(fc.string(), { nil: null }),
          }),
        ),
      }),
    ),
  }),
  { maxLength: 4 },
);

/**
 * A cache state spanning the whole input space the seam must handle:
 *
 *   - `missing` — the Experience exists but has no cached menu (`fetchedAt`
 *     null) ⇒ `decideMenuFetch` is always `true` (fetch).
 *   - `fresh`   — a cached menu whose age is within the interval (including the
 *     inclusive boundary `age === interval` and negative ages from clock skew)
 *     ⇒ `decideMenuFetch` is `false` (serve).
 *   - `stale`   — a cached menu whose age exceeds the interval ⇒
 *     `decideMenuFetch` is `true` (fetch).
 *
 * Each carries the cached menus, the read instant, and the freshness interval.
 */
interface CacheState {
  readonly cachedMenus: readonly MenuDTO[];
  readonly fetchedAt: Date | null;
  readonly now: Date;
  readonly interval: number;
}

const missingStateArb: fc.Arbitrary<CacheState> = fc
  .record({ interval: intervalArb, base: baseMsArb, menus: cachedMenusArb })
  .map(({ interval, base, menus }) => ({
    cachedMenus: menus,
    fetchedAt: null,
    now: new Date(base),
    interval,
  }));

const freshStateArb: fc.Arbitrary<CacheState> = intervalArb.chain((interval) =>
  fc
    .record({
      base: baseMsArb,
      // age within [-1_000_000, interval]: negative (clock skew) and the
      // inclusive `age === interval` boundary both count as fresh.
      age: fc.integer({ min: -1_000_000, max: interval }),
      menus: cachedMenusArb,
    })
    .map(({ base, age, menus }) => ({
      cachedMenus: menus,
      fetchedAt: new Date(base),
      now: new Date(base + age),
      interval,
    })),
);

const staleStateArb: fc.Arbitrary<CacheState> = intervalArb.chain((interval) =>
  fc
    .record({
      base: baseMsArb,
      // age strictly greater than the interval ⇒ stale.
      age: fc.integer({ min: interval + 1, max: interval + 10_000_000 }),
      menus: cachedMenusArb,
    })
    .map(({ base, age, menus }) => ({
      cachedMenus: menus,
      fetchedAt: new Date(base),
      now: new Date(base + age),
      interval,
    })),
);

const cacheStateArb: fc.Arbitrary<CacheState> = fc.oneof(
  missingStateArb,
  freshStateArb,
  staleStateArb,
);

// ---------------------------------------------------------------------------
// Property 10: Lazy menu retrieval (the seam)
// ---------------------------------------------------------------------------

describe('createMenuRetrieval.getMenuForRestaurant (Property 10: Lazy menu retrieval)', () => {
  it('serves a fresh cache without a Menu_Service call, fetches+caches when missing/stale, and serves the prior cache on failure without raising', async () => {
    await fc.assert(
      fc.asyncProperty(
        idArb,
        idArb,
        cacheStateArb,
        rawMenuArb,
        fc.boolean(),
        async (experienceId, upstreamEntityId, cache, raw, fetchFails) => {
          const cached =
            cache.fetchedAt === null
              ? null
              : { menus: cache.cachedMenus, fetchedAt: cache.fetchedAt };
          const state: MenuFetchState = { upstreamEntityId, cached };

          const clientCalls: string[] = [];
          const upserts: UpsertCall[] = [];
          const warnings: string[] = [];

          const retrieval = createMenuRetrieval({
            repo: makeRepo(state, upserts),
            client: makeClient(raw, fetchFails, clientCalls),
            freshnessMs: cache.interval,
            now: () => cache.now,
            logger: makeLogger(warnings),
          });

          // The read never raises, regardless of cache state or fetch outcome.
          const served = await retrieval.getMenuForRestaurant(experienceId);

          const shouldFetch = decideMenuFetch(
            cache.fetchedAt,
            cache.now,
            cache.interval,
          );
          const priorCached = cached?.menus ?? [];

          if (!shouldFetch) {
            // (R8.4) Fresh ⇒ serve the cache, never contact the Menu_Service.
            expect(clientCalls).toHaveLength(0);
            expect(upserts).toHaveLength(0);
            expect(warnings).toHaveLength(0);
            expect(served).toEqual(priorCached);
            return;
          }

          // Missing or stale ⇒ a single fetch against the Experience's
          // Enterprise_Id is attempted.
          expect(clientCalls).toEqual([upstreamEntityId]);

          if (fetchFails) {
            // (R8.5) On failure: serve the prior cache unchanged, record the
            // failure, cache nothing, and do not raise.
            expect(served).toEqual(priorCached);
            expect(upserts).toHaveLength(0);
            expect(warnings).toHaveLength(1);
          } else {
            // (R8.2) On success: project, cache with a fresh fetched_at equal
            // to the read instant, and serve the projection.
            const expectedMenus = projectMenus(raw);
            expect(served).toEqual(expectedMenus);
            expect(upserts).toHaveLength(1);
            expect(upserts[0]).toEqual({
              experienceId,
              menus: expectedMenus,
              fetchedAt: cache.now,
            });
            expect(warnings).toHaveLength(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10 (pure core): decideMenuFetch boundary sweep
// ---------------------------------------------------------------------------

describe('decideMenuFetch (Property 10: freshness decision)', () => {
  it('fetches when the cache is missing (fetchedAt null), for any now/interval', () => {
    fc.assert(
      fc.property(baseMsArb, intervalArb, (nowMs, interval) => {
        expect(decideMenuFetch(null, new Date(nowMs), interval)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('serves the cache when age <= interval (fresh, inclusive boundary and clock skew)', () => {
    fc.assert(
      fc.property(freshStateArb, ({ fetchedAt, now, interval }) => {
        expect(decideMenuFetch(fetchedAt, now, interval)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('fetches when age > interval (stale)', () => {
    fc.assert(
      fc.property(staleStateArb, ({ fetchedAt, now, interval }) => {
        expect(decideMenuFetch(fetchedAt, now, interval)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
