/**
 * Unit tests for the Catalog_Sync orchestrator (`sync.ts`).
 *
 * Each test wires `runSync` against three injected fakes — a fake Redis
 * with a working `SET key value PX ttl NX` semantic and an `eval` for the
 * compare-and-delete release script, a stub ThemeParks client whose
 * `getDestinations` and `getEntityChildren` return canned payloads, and
 * a stub `CatalogRepo` that captures the calls the orchestrator makes
 * and lets the test rig their outcomes.
 *
 * The behaviors under test (R1.10, R1.13, R1.14, R1.15, R1.16):
 *
 *   1. Lock acquisition succeeds; sync walks WDW → children, classifies,
 *      reconciles against the cache snapshot, applies the diff, records a
 *      success run, and releases the lock.
 *
 *   2. When the lock is already held, the orchestrator returns
 *      `{ status: 'skipped' }` and touches no other dependency.
 *
 *   3. When the upstream client throws, the orchestrator records a failed
 *      run, leaves the cache untouched (no `applyReconciliation` call),
 *      releases the lock, and returns `{ status: 'failed' }`.
 *
 *   4. Lock release uses the compare-and-delete script with the token
 *      that was set on acquire (so a successor's lock cannot be deleted).
 */

import { describe, expect, it } from 'vitest';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { internalId } from '../internalId.js';
import {
  CATALOG_SYNC_LOCK_KEY,
  CATALOG_SYNC_LOCK_TTL_MS,
  runSync,
  type RunSyncOptions,
} from '../sync.js';
import type {
  CatalogRepo,
  CacheAgeInfo,
  RecordedSyncRun,
  RecordSyncRunInput,
} from '../repo.js';
import type {
  ThemeParksClient,
  ThemeParksDestinationsResponse,
  ThemeParksEntityChildrenResponse,
} from '../themeparks.js';
import { UpstreamError } from '../themeparks.js';
import type {
  CatalogCacheRow,
  ReconcileResult,
} from '../types.js';

// ---------------------------------------------------------------------------
// Fake Redis
// ---------------------------------------------------------------------------

/**
 * Minimal Redis lookalike that implements only the two operations the
 * orchestrator uses — `SET ... NX PX` and a Lua `EVAL` that performs an
 * atomic compare-and-delete on the lock key.
 */
function createFakeRedis() {
  const store = new Map<string, string>();
  const calls: Array<{ readonly op: string; readonly args: readonly unknown[] }> = [];

  return {
    store,
    calls,
    async set(
      key: string,
      value: string,
      _pxFlag: string,
      _ttlMs: number,
      nxFlag: string,
    ): Promise<'OK' | null> {
      calls.push({ op: 'set', args: [key, value, _pxFlag, _ttlMs, nxFlag] });
      if (nxFlag === 'NX' && store.has(key)) {
        return null;
      }
      store.set(key, value);
      return 'OK';
    },
    async eval(
      script: string,
      _numKeys: number,
      key: string,
      token: string,
    ): Promise<number> {
      calls.push({ op: 'eval', args: [script, _numKeys, key, token] });
      const current = store.get(key);
      if (current === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Stub repo
// ---------------------------------------------------------------------------

interface StubRepoOptions {
  readonly snapshot?: readonly CatalogCacheRow[];
  readonly applyShouldThrow?: Error;
  readonly recordSyncRunIdSequence?: readonly string[];
}

interface StubRepo extends CatalogRepo {
  readonly applyCalls: ReconcileResult[];
  readonly recordCalls: RecordSyncRunInput[];
  readonly snapshotCalls: number;
}

function createStubRepo(opts: StubRepoOptions = {}): StubRepo {
  const applyCalls: ReconcileResult[] = [];
  const recordCalls: RecordSyncRunInput[] = [];
  let snapshotCalls = 0;
  const ids = [...(opts.recordSyncRunIdSequence ?? ['run-1', 'run-2'])];

  const repo: StubRepo = {
    applyCalls,
    recordCalls,
    get snapshotCalls() {
      return snapshotCalls;
    },
    async getCacheAge(): Promise<CacheAgeInfo> {
      return { hours: null, lastSuccessfulSyncAt: null };
    },
    async getCacheSnapshot(): Promise<readonly CatalogCacheRow[]> {
      snapshotCalls++;
      return opts.snapshot ?? [];
    },
    async applyReconciliation(diff: ReconcileResult): Promise<void> {
      applyCalls.push(diff);
      if (opts.applyShouldThrow) {
        throw opts.applyShouldThrow;
      }
    },
    async recordSyncRun(input: RecordSyncRunInput): Promise<RecordedSyncRun> {
      recordCalls.push(input);
      return { id: ids.shift() ?? 'run-x' };
    },
    async listActiveExperiences() {
      return [];
    },
    async getExperience() {
      return null;
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// Stub upstream client
// ---------------------------------------------------------------------------

const WDW_DESTINATION_ID = 'wdw-destination-id';
const MK_PARK_ID = 'park-mk';
const EPCOT_PARK_ID = 'park-epcot';

const VALID_DESTINATIONS: ThemeParksDestinationsResponse = {
  destinations: [
    {
      id: 'disneyland-paris',
      name: 'Disneyland Paris',
      slug: 'disneylandparis',
      parks: [],
    },
    {
      id: WDW_DESTINATION_ID,
      name: 'Walt Disney World Resort',
      slug: 'waltdisneyworldresort',
      parks: [
        { id: MK_PARK_ID, name: 'Magic Kingdom Park' },
        { id: EPCOT_PARK_ID, name: 'EPCOT' },
      ],
    },
  ],
};

const VALID_CHILDREN: ThemeParksEntityChildrenResponse = {
  id: WDW_DESTINATION_ID,
  name: 'Walt Disney World Resort',
  entityType: 'DESTINATION',
  children: [
    // Two valid attractions under Magic Kingdom (one ride, one parade).
    {
      id: 'attr-space-mountain',
      name: 'Space Mountain',
      entityType: 'ATTRACTION',
      parentId: MK_PARK_ID,
    },
    {
      id: 'attr-festival-of-fantasy',
      name: 'Festival of Fantasy Parade',
      entityType: 'ATTRACTION',
      parentId: MK_PARK_ID,
    },
    // One restaurant under EPCOT.
    {
      id: 'rest-le-cellier',
      name: 'Le Cellier Steakhouse',
      entityType: 'RESTAURANT',
      parentId: EPCOT_PARK_ID,
    },
    // Excluded by include set rule (HOTEL is not in the include set).
    {
      id: 'hotel-grand-floridian',
      name: 'Grand Floridian',
      entityType: 'HOTEL',
      parentId: WDW_DESTINATION_ID,
    },
    // Excluded because parent chain does not land in a known Park.
    {
      id: 'attr-orphan',
      name: 'Orphan Ride',
      entityType: 'ATTRACTION',
      parentId: 'unknown-parent-id',
    },
  ],
};

function makeUpstreamClient(
  destinations: ThemeParksDestinationsResponse | Error = VALID_DESTINATIONS,
  children: ThemeParksEntityChildrenResponse | Error = VALID_CHILDREN,
): ThemeParksClient {
  return {
    async getDestinations() {
      if (destinations instanceof Error) throw destinations;
      return destinations;
    },
    async getEntityChildren(_id: string) {
      if (children instanceof Error) throw children;
      return children;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSync — happy path', () => {
  it('acquires the lock, syncs, applies the diff, and records a success run', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo({ snapshot: [] });
    const client = makeUpstreamClient();

    const result = await runSync({
      redis: redis as unknown as NonNullable<RunSyncOptions['redis']>,
      repo,
      client,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return; // narrowing for TS

    // Three children survive the include-set + park-resolution filter.
    expect(result.entitiesProcessed).toBe(3);
    expect(result.upserts).toBe(3);
    expect(result.softDeletes).toBe(0);

    // Snapshot was queried once.
    expect(repo.snapshotCalls).toBe(1);

    // applyReconciliation was called with a diff containing the three
    // surviving entities, each with a stable internal id and Park.
    expect(repo.applyCalls).toHaveLength(1);
    const upserts = repo.applyCalls[0]!.upserts;
    const byUpstreamId = new Map<string, (typeof upserts)[number]>();
    for (const u of upserts) byUpstreamId.set(u.upstreamEntityId, u);

    expect(byUpstreamId.get('attr-space-mountain')?.park).toBe(
      'Magic Kingdom' satisfies Park,
    );
    expect(byUpstreamId.get('attr-space-mountain')?.category).toBe(
      'Ride' satisfies ExperienceCategory,
    );
    expect(byUpstreamId.get('attr-space-mountain')?.id).toBe(
      internalId('attr-space-mountain'),
    );

    expect(byUpstreamId.get('attr-festival-of-fantasy')?.category).toBe(
      'Parade' satisfies ExperienceCategory,
    );

    expect(byUpstreamId.get('rest-le-cellier')?.park).toBe(
      'EPCOT' satisfies Park,
    );
    expect(byUpstreamId.get('rest-le-cellier')?.category).toBe(
      'Restaurant' satisfies ExperienceCategory,
    );

    // No spurious entries from the excluded entityType or unresolved park.
    expect(byUpstreamId.has('hotel-grand-floridian')).toBe(false);
    expect(byUpstreamId.has('attr-orphan')).toBe(false);

    // Success was recorded with entitiesProcessed populated.
    expect(repo.recordCalls).toEqual([
      expect.objectContaining({
        status: 'success',
        entitiesProcessed: 3,
      }),
    ]);

    // The sync lock was acquired with NX and the configured TTL.
    const setCall = redis.calls.find((c) => c.op === 'set');
    expect(setCall?.args[0]).toBe(CATALOG_SYNC_LOCK_KEY);
    expect(setCall?.args[2]).toBe('PX');
    expect(setCall?.args[3]).toBe(CATALOG_SYNC_LOCK_TTL_MS);
    expect(setCall?.args[4]).toBe('NX');

    // The lock was released via EVAL on the way out.
    expect(redis.calls.some((c) => c.op === 'eval')).toBe(true);
    expect(redis.store.has(CATALOG_SYNC_LOCK_KEY)).toBe(false);
  });
});

describe('runSync — lock contention', () => {
  it('returns skipped/lock_held without invoking client or repo when lock is held', async () => {
    const redis = createFakeRedis();
    redis.store.set(CATALOG_SYNC_LOCK_KEY, 'pre-existing-token');

    const repo = createStubRepo();
    let clientCalls = 0;
    const client: ThemeParksClient = {
      async getDestinations() {
        clientCalls++;
        return VALID_DESTINATIONS;
      },
      async getEntityChildren() {
        clientCalls++;
        return VALID_CHILDREN;
      },
    };

    const result = await runSync({
      redis: redis as unknown as NonNullable<RunSyncOptions['redis']>,
      repo,
      client,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'lock_held' });
    expect(clientCalls).toBe(0);
    expect(repo.snapshotCalls).toBe(0);
    expect(repo.applyCalls).toHaveLength(0);
    expect(repo.recordCalls).toHaveLength(0);

    // Importantly, the orchestrator must NOT delete the lock it failed
    // to acquire — the eval would not match because we never set a
    // token, but to be safe we assert the existing lock is intact.
    expect(redis.store.get(CATALOG_SYNC_LOCK_KEY)).toBe('pre-existing-token');
  });
});

describe('runSync — upstream failure (R1.13)', () => {
  it('records a failed run, does not apply any diff, and releases the lock', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    const client = makeUpstreamClient(
      new UpstreamError('http_status', 'Upstream returned HTTP 503.', {
        status: 503,
      }),
    );

    const result = await runSync({
      redis: redis as unknown as NonNullable<RunSyncOptions['redis']>,
      repo,
      client,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('upstream');
    expect(result.error).toBeInstanceOf(UpstreamError);

    // No reconciliation occurred (R1.13: "retain the prior cache contents
    // unchanged").
    expect(repo.applyCalls).toHaveLength(0);

    // A failed run row was recorded with the upstream error class /
    // message preserved for diagnostics.
    expect(repo.recordCalls).toEqual([
      expect.objectContaining({
        status: 'failed',
        errorClass: 'UpstreamError',
        errorMessage: expect.stringContaining('503'),
      }),
    ]);

    // Lock is released even on failure.
    expect(redis.store.has(CATALOG_SYNC_LOCK_KEY)).toBe(false);
  });

  it('records a failed run when the children call throws after destinations succeed', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    const client = makeUpstreamClient(
      VALID_DESTINATIONS,
      new UpstreamError('network', 'transport error'),
    );

    const result = await runSync({
      redis: redis as unknown as NonNullable<RunSyncOptions['redis']>,
      repo,
      client,
    });

    expect(result.status).toBe('failed');
    expect(repo.applyCalls).toHaveLength(0);
    expect(repo.recordCalls[0]?.status).toBe('failed');
  });

  it('records a failed run when the WDW destination is missing from /destinations', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    // Destinations payload that does not contain WDW.
    const onlyParis: ThemeParksDestinationsResponse = {
      destinations: [
        {
          id: 'disneyland-paris',
          name: 'Disneyland Paris',
          slug: 'disneylandparis',
          parks: [],
        },
      ],
    };
    const client = makeUpstreamClient(onlyParis);

    const result = await runSync({
      redis: redis as unknown as NonNullable<RunSyncOptions['redis']>,
      repo,
      client,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('upstream');
    expect(repo.applyCalls).toHaveLength(0);
    expect(repo.recordCalls[0]?.status).toBe('failed');
  });
});

describe('runSync — reconcile drives upserts and soft-deletes', () => {
  it('soft-deletes a cached row whose upstream id is no longer returned (R1.15)', async () => {
    const redis = createFakeRedis();
    // Cache contains one extra row that upstream no longer surfaces.
    const goneId = internalId('attr-extinct');
    const snapshot: readonly CatalogCacheRow[] = [
      {
        id: goneId,
        active: true,
        name: 'Extinct Ride',
        park: 'Magic Kingdom',
        category: 'Ride',
      },
    ];
    const repo = createStubRepo({ snapshot });
    const client = makeUpstreamClient();

    const result = await runSync({
      redis: redis as unknown as NonNullable<RunSyncOptions['redis']>,
      repo,
      client,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.softDeletes).toBe(1);
    const diff = repo.applyCalls[0]!;
    expect(diff.softDeletes).toEqual([{ id: goneId }]);
  });

  it('reactivates a soft-deleted cache row when its upstream id reappears (R1.15)', async () => {
    const redis = createFakeRedis();
    const reactivatedUpstreamId = 'attr-space-mountain';
    const reactivatedInternalId = internalId(reactivatedUpstreamId);

    const snapshot: readonly CatalogCacheRow[] = [
      {
        id: reactivatedInternalId,
        active: false,
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
      },
    ];
    const repo = createStubRepo({ snapshot });
    const client = makeUpstreamClient();

    const result = await runSync({
      redis: redis as unknown as NonNullable<RunSyncOptions['redis']>,
      repo,
      client,
    });

    expect(result.status).toBe('success');
    const diff = repo.applyCalls[0]!;
    const reactivated = diff.upserts.find(
      (u) => u.id === reactivatedInternalId,
    );
    expect(reactivated).toBeDefined();
    expect(reactivated?.active).toBe(true);
    expect(diff.softDeletes).toHaveLength(0);
  });
});
