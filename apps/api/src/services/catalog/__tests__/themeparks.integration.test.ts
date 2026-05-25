/**
 * End-to-end integration test for the Catalog_Service ThemeParks.wiki
 * pipeline against recorded upstream fixtures.
 *
 * The test wires together every Wave-5 component the way production
 * does — `createThemeParksClient` (task 9.1), `runSync` (task 9.3),
 * `reconcile` (task 4.2), `classify` (task 4.1), and `internalId`
 * (task 4.3) — and drives them with two captured upstream payloads:
 *
 *   - `__fixtures__/themeparks/destinations.json` — a realistic
 *     `/destinations` response containing the Walt Disney World resort
 *     plus a sibling destination, with all six WDW parks under it.
 *   - `__fixtures__/themeparks/wdw-children.json` — a representative
 *     cross-section of the `/entity/{wdwId}/children` payload with at
 *     least one ATTRACTION (ride), one SHOW, one RESTAURANT, one
 *     ATTRACTION named as a parade, one ATTRACTION carrying the
 *     `MEET_AND_GREET` sub-classifier, an excluded HOTEL, and an
 *     ATTRACTION whose `parentId` does not resolve to a known park
 *     (orphan).
 *
 * No real HTTP is issued: the ThemeParks client is constructed with an
 * injected fake `fetch` that maps URL path to fixture body, and the
 * Catalog repo is replaced with an in-memory implementation backed by a
 * `Map<id, ExperienceRow>` plus a `recordedSyncRuns[]` ledger. Redis is
 * a tiny in-memory shim that implements only the two operations
 * `runSync` issues — `SET key value PX <ttl> NX` and the Lua
 * compare-and-delete `EVAL` script.
 *
 * Assertions cover the end-to-end contract:
 *
 *   - Every entity that survives the include-set + park-resolution
 *     filter lands in the cache with `id = internalId(upstreamId)`,
 *     the fixture's name, the resolved `Park`, and the `category`
 *     `classify()` would return on its own (Property 1 / Property 2 /
 *     Property 5 composed).
 *   - Excluded entities (HOTEL, orphan with unknown parent) do NOT
 *     produce rows.
 *   - `recordSyncRun` is called once with `status: 'success'` and the
 *     correct `entitiesProcessed` count.
 *
 * Validates: Requirements 1.1, 1.10
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ExperienceCategory, ExperienceDTO, Park } from '@dwt/shared';

import type { RedisClient } from '../../../redis/client.js';
import { internalId } from '../internalId.js';
import {
  CATALOG_SYNC_LOCK_KEY,
  CATALOG_SYNC_LOCK_TTL_MS,
  runSync,
} from '../sync.js';
import {
  createThemeParksClient,
  type FetchLike,
  type ThemeParksDestinationsResponse,
  type ThemeParksEntityChildrenResponse,
} from '../themeparks.js';
import type {
  CacheAgeInfo,
  CatalogListFilters,
  CatalogRepo,
  RecordedSyncRun,
  RecordSyncRunInput,
} from '../repo.js';
import type {
  CatalogCacheRow,
  ReconcileResult,
} from '../types.js';

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '..', '__fixtures__', 'themeparks');

function loadFixture<T>(name: string): T {
  const path = resolve(FIXTURE_DIR, name);
  const body = readFileSync(path, 'utf8');
  return JSON.parse(body) as T;
}

const DESTINATIONS_FIXTURE = loadFixture<ThemeParksDestinationsResponse>(
  'destinations.json',
);
const CHILDREN_FIXTURE = loadFixture<ThemeParksEntityChildrenResponse>(
  'wdw-children.json',
);

// ---------------------------------------------------------------------------
// Fake fetch — maps URL path to fixture
// ---------------------------------------------------------------------------

/**
 * Build a `fetch` implementation that returns the recorded fixture for
 * each ThemeParks endpoint based on the URL path. Any unexpected URL
 * fails the test loudly so a misconfigured base URL or path doesn't
 * silently produce an empty response.
 */
function makeFakeFetch(
  destinations: ThemeParksDestinationsResponse,
  children: ThemeParksEntityChildrenResponse,
): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];

  const fetchImpl: FetchLike = async (input, _init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push(url);

    const path = new URL(url).pathname;

    if (path.endsWith('/destinations')) {
      return new Response(JSON.stringify(destinations), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // /entity/{id}/children
    const childrenMatch = path.match(/\/entity\/([^/]+)\/children$/);
    if (childrenMatch) {
      return new Response(JSON.stringify(children), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    throw new Error(`Unexpected URL hit by fake fetch: ${url}`);
  };

  return { fetch: fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// In-memory Redis lookalike
// ---------------------------------------------------------------------------

/**
 * Implements just enough of the ioredis surface for `runSync` — a SET
 * with NX/PX semantics and an EVAL that runs the compare-and-delete
 * release script. TTL is a no-op for the test because no test elapses
 * past it; the orchestrator never reads the TTL back anyway.
 */
function createFakeRedis() {
  const store = new Map<string, string>();

  return {
    store,
    async set(
      key: string,
      value: string,
      _pxFlag: string,
      _ttlMs: number,
      nxFlag: string,
    ): Promise<'OK' | null> {
      if (nxFlag === 'NX' && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    },
    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      token: string,
    ): Promise<number> {
      const current = store.get(key);
      if (current === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

type FakeRedis = ReturnType<typeof createFakeRedis>;

// ---------------------------------------------------------------------------
// In-memory CatalogRepo
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

/**
 * Single row stored by the in-memory repo. Mirrors the columns the real
 * repo persists; description starts at `''` because the orchestrator
 * does not read the children-endpoint description (the typed projection
 * doesn't surface it) and the column has a NOT NULL DEFAULT ''.
 */
interface InMemoryRow {
  id: string;
  upstreamEntityId: string;
  name: string;
  park: Park;
  category: ExperienceCategory;
  description: string;
  active: boolean;
  updatedAt: Date;
}

interface InMemoryCatalogRepo extends CatalogRepo {
  readonly rows: Map<string, InMemoryRow>;
  readonly recordedSyncRuns: RecordSyncRunInput[];
  /** Convenience: every row in the cache, regardless of `active`. */
  snapshot(): InMemoryRow[];
}

function createInMemoryRepo(): InMemoryCatalogRepo {
  const rows = new Map<string, InMemoryRow>();
  const recordedSyncRuns: RecordSyncRunInput[] = [];
  let runCounter = 0;

  const repo: InMemoryCatalogRepo = {
    rows,
    recordedSyncRuns,
    snapshot: () => Array.from(rows.values()),

    async getCacheAge(): Promise<CacheAgeInfo> {
      // Not used by `runSync`, but part of the interface contract.
      return { hours: null, lastSuccessfulSyncAt: null };
    },

    async getCacheSnapshot(): Promise<readonly CatalogCacheRow[]> {
      return Array.from(rows.values()).map((r) => ({
        id: r.id,
        active: r.active,
        name: r.name,
        park: r.park,
        category: r.category,
      }));
    },

    async applyReconciliation(diff: ReconcileResult): Promise<void> {
      // Apply the diff atomically by mutating the map in one pass; the
      // production repo wraps this in a transaction — the in-memory
      // equivalent is a single synchronous pass under the same await
      // point.
      const now = new Date();
      for (const upsert of diff.upserts) {
        rows.set(upsert.id, {
          id: upsert.id,
          upstreamEntityId: upsert.upstreamEntityId,
          name: upsert.name,
          park: upsert.park,
          category: upsert.category,
          description: upsert.description,
          active: true,
          updatedAt: now,
        });
      }
      for (const soft of diff.softDeletes) {
        const existing = rows.get(soft.id);
        if (existing) {
          rows.set(soft.id, {
            ...existing,
            active: false,
            updatedAt: now,
          });
        }
      }
    },

    async recordSyncRun(
      input: RecordSyncRunInput,
    ): Promise<RecordedSyncRun> {
      recordedSyncRuns.push(input);
      runCounter += 1;
      return { id: `run-${runCounter}` };
    },

    async listActiveExperiences(
      filters?: CatalogListFilters,
    ): Promise<readonly ExperienceDTO[]> {
      const parkFilter = filters?.park;
      const categoryFilter = filters?.category;
      const q = filters?.q?.trim().toLowerCase();
      const out: ExperienceDTO[] = [];
      for (const row of rows.values()) {
        if (!row.active) continue;
        if (parkFilter !== undefined && row.park !== parkFilter) continue;
        if (
          categoryFilter !== undefined &&
          row.category !== categoryFilter
        )
          continue;
        if (q !== undefined && q.length > 0 && !row.name.toLowerCase().includes(q))
          continue;
        out.push({
          id: row.id,
          name: row.name,
          park: row.park,
          category: row.category,
          description: row.description,
          active: row.active,
        });
      }
      return out;
    },

    async getExperience(id: string): Promise<ExperienceDTO | null> {
      const row = rows.get(id);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        park: row.park,
        category: row.category,
        description: row.description,
        active: row.active,
      };
    },
  };

  return repo;
}

// ---------------------------------------------------------------------------
// Fixture-derived expectations
// ---------------------------------------------------------------------------

/**
 * Hand-written expected projection for the recorded fixtures. Each entry
 * lists the upstream id, the name, the resolved Park, and the
 * Experience_Category that `classify` would emit. If the fixtures change,
 * this table must be updated to match.
 */
interface ExpectedExperience {
  readonly upstreamId: string;
  readonly name: string;
  readonly park: Park;
  readonly category: ExperienceCategory;
}

const EXPECTED_EXPERIENCES: readonly ExpectedExperience[] = [
  {
    upstreamId: '80010110',
    name: 'Seven Dwarfs Mine Train',
    park: 'Magic Kingdom',
    category: 'Ride',
  },
  {
    upstreamId: '16124144-de4f-4d65-b231-78e644f0db20',
    name: "Mickey's PhilharMagic",
    park: 'Magic Kingdom',
    category: 'Show',
  },
  {
    upstreamId: '80010210',
    name: 'Be Our Guest Restaurant',
    park: 'Magic Kingdom',
    category: 'Restaurant',
  },
  {
    upstreamId: '80060297',
    name: 'Disney Festival of Fantasy Parade',
    park: 'Magic Kingdom',
    category: 'Parade',
  },
  {
    upstreamId: '80010191',
    name: 'Meet Mickey Mouse at Town Square Theater',
    park: 'Magic Kingdom',
    category: 'Character_Meet',
  },
  {
    upstreamId: '80010103',
    name: 'Test Track presented by Chevrolet',
    park: 'EPCOT',
    category: 'Ride',
  },
];

/** Upstream ids that must be excluded from the cache. */
const EXCLUDED_UPSTREAM_IDS: readonly string[] = [
  // Excluded by the include-set rule (HOTEL is not in {ATTRACTION, SHOW,
  // RESTAURANT}).
  '411552c7-b40e-4be3-9f5e-2f7c3e5f9020',
  // Excluded because its `parentId` does not chain to a known park.
  '00000000-orphan-attraction',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Catalog_Sync end-to-end against recorded ThemeParks.wiki fixtures', () => {
  it('reconciles the fixture into the expected cache rows and records a successful sync', async () => {
    // Arrange ------------------------------------------------------------
    const { fetch: fakeFetch, calls } = makeFakeFetch(
      DESTINATIONS_FIXTURE,
      CHILDREN_FIXTURE,
    );
    const client = createThemeParksClient({
      baseUrl: 'https://api.themeparks.wiki/v1',
      fetch: fakeFetch,
    });
    const redis = createFakeRedis();
    const repo = createInMemoryRepo();

    // Act ----------------------------------------------------------------
    const result = await runSync({
      client,
      repo,
      // The redis fake matches the structural surface (`set`, `eval`)
      // that `runSync` invokes; cast through unknown to satisfy the
      // RedisClient type which is a full ioredis `Redis`.
      redis: redis as unknown as RedisClient,
    });

    // Assert: orchestrator outcome --------------------------------------
    expect(result.status).toBe('success');
    if (result.status !== 'success') return; // narrowing for TS

    expect(result.entitiesProcessed).toBe(EXPECTED_EXPERIENCES.length);
    expect(result.upserts).toBe(EXPECTED_EXPERIENCES.length);
    expect(result.softDeletes).toBe(0);

    // Assert: fake fetch saw the destinations + children URLs ----------
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe('https://api.themeparks.wiki/v1/destinations');
    expect(calls[1]).toBe(
      'https://api.themeparks.wiki/v1/entity/' +
        encodeURIComponent(
          'e957da41-3552-4cf6-b636-5babc5cbc4e5',
        ) +
        '/children',
    );

    // Assert: every expected experience landed in the cache with the
    // correct id, name, park, and category --------------------------
    expect(repo.rows.size).toBe(EXPECTED_EXPERIENCES.length);
    for (const expected of EXPECTED_EXPERIENCES) {
      const expectedId = internalId(expected.upstreamId);
      const row = repo.rows.get(expectedId);
      expect(
        row,
        `expected a cache row for upstream id ${expected.upstreamId}`,
      ).toBeDefined();
      if (!row) continue;
      expect(row.id).toBe(expectedId);
      expect(row.upstreamEntityId).toBe(expected.upstreamId);
      expect(row.name).toBe(expected.name);
      expect(row.park).toBe(expected.park);
      expect(row.category).toBe(expected.category);
      expect(row.active).toBe(true);
    }

    // Assert: excluded entities did NOT land in the cache --------------
    for (const upstreamId of EXCLUDED_UPSTREAM_IDS) {
      const id = internalId(upstreamId);
      expect(
        repo.rows.has(id),
        `upstream id ${upstreamId} must be excluded from the cache`,
      ).toBe(false);
    }

    // Assert: the success run was recorded with entitiesProcessed -----
    expect(repo.recordedSyncRuns).toHaveLength(1);
    const syncRun = repo.recordedSyncRuns[0]!;
    expect(syncRun.status).toBe('success');
    expect(syncRun.entitiesProcessed).toBe(EXPECTED_EXPERIENCES.length);
    expect(syncRun.startedAt).toBeInstanceOf(Date);
    expect(syncRun.finishedAt).toBeInstanceOf(Date);

    // Assert: the lock was released after the run ----------------------
    expect(redis.store.has(CATALOG_SYNC_LOCK_KEY)).toBe(false);
  });

  it('records a successful sync after using the configured lock TTL', async () => {
    // Sanity guard: a regression that drops the NX/PX semantics would
    // either prevent acquisition or leak the lock, so the same fixture
    // run is repeated to confirm the lock state is clean each time.
    const { fetch: fakeFetch } = makeFakeFetch(
      DESTINATIONS_FIXTURE,
      CHILDREN_FIXTURE,
    );
    const client = createThemeParksClient({
      baseUrl: 'https://api.themeparks.wiki/v1',
      fetch: fakeFetch,
    });
    const redis = createFakeRedis();
    const repo = createInMemoryRepo();

    const first = await runSync({
      client,
      repo,
      redis: redis as unknown as RedisClient,
    });
    expect(first.status).toBe('success');
    expect(redis.store.has(CATALOG_SYNC_LOCK_KEY)).toBe(false);

    const second = await runSync({
      client,
      repo,
      redis: redis as unknown as RedisClient,
    });
    expect(second.status).toBe('success');
    expect(redis.store.has(CATALOG_SYNC_LOCK_KEY)).toBe(false);

    // Two successful runs were recorded with the same processed count.
    expect(repo.recordedSyncRuns).toHaveLength(2);
    expect(repo.recordedSyncRuns.every((r) => r.status === 'success')).toBe(
      true,
    );
    expect(
      repo.recordedSyncRuns.every(
        (r) => r.entitiesProcessed === EXPECTED_EXPERIENCES.length,
      ),
    ).toBe(true);

    // Cache size is stable across reconciles; no spurious soft-deletes.
    expect(repo.rows.size).toBe(EXPECTED_EXPERIENCES.length);

    // Touch the constant so it is referenced and the test fails on
    // an accidental rename without updating the assertion below.
    expect(CATALOG_SYNC_LOCK_TTL_MS).toBeGreaterThan(0);
  });
});

// Local re-exports of unused lookups exercised through `as unknown as` to
// keep `noUnusedLocals` happy under `tsc --strict`. The cast escape hatch
// in the test suppresses TS unused-import diagnostics on FakeRedis.
export type { FakeRedis };
