/**
 * Unit tests for the Catalog_Sync orchestrator (`sync.ts`), Disney sources.
 *
 * Each test wires `runSync` against three injected fakes — a fake Redis with a
 * working `SET key value PX ttl NX` semantic and an `eval` for the
 * compare-and-delete release script, a fake `FacilitiesClient` whose
 * `listChannelDocumentIds` / `bulkGetDocuments` / `getMenus` return canned
 * Disney documents, and a stub `CatalogRepo` that captures the calls the
 * orchestrator makes and lets the test rig their outcomes.
 *
 * The behaviors under test:
 *
 *   1. Lock acquisition succeeds; sync enumerates the Facilities_Channel,
 *      bulk-fetches documents, normalizes (drops tombstones / blank names),
 *      splits into Experiences + Resorts, classifies + resolves area,
 *      reconciles against the cache snapshot, applies the combined diff,
 *      records a success run, and releases the lock (R2-R7, R11).
 *
 *   2. When the lock is already held, the orchestrator returns
 *      `{ status: 'skipped' }` and touches no other dependency.
 *
 *   3. When the upstream client throws, the orchestrator records a failed
 *      run, leaves the cache untouched (no `applyReconciliation` call),
 *      releases the lock, and returns `{ status: 'failed' }` (R12.3, R12.4).
 *
 *   4. Reconcile drives upserts and soft-deletes / reactivations against the
 *      cache snapshot (R11.1, R11.2, R11.5).
 */

import { describe, expect, it } from 'vitest';
import type { ExperienceCategory, Park } from '@dwt/shared';

import { assignInternalId } from '../disney/bridge.js';
import type { FacilityDocument } from '../disney/facilityDoc.js';
import {
  FACILITIES_CHANNEL,
  type FacilitiesClient,
} from '../disney/facilitiesClient.js';
import type { RawMenu } from '../disney/menu.js';
import {
  CATALOG_SYNC_LOCK_KEY,
  CATALOG_SYNC_LOCK_TTL_MS,
  runSync,
  type RunSyncOptions,
} from '../sync.js';
import type {
  CacheAgeInfo,
  CatalogRepo,
  RecordedSyncRun,
  RecordSyncRunInput,
} from '../repo.js';
import type {
  ApplyDeltaInput,
  DocumentStore,
  StoredFacilityDocument,
} from '../documentStore.js';
import { UpstreamError } from '../themeparks.js';
import type {
  CatalogCacheRow,
  CatalogDiff,
  ResortCacheRow,
} from '../types.js';

const EMPTY_BRIDGE: ReadonlyMap<string, string> = new Map();

/** The Internal_Id the orchestrator assigns for an Enterprise_Id (empty bridge). */
function idOf(enterpriseId: string): string {
  return assignInternalId(enterpriseId, EMPTY_BRIDGE);
}

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

type FakeRedis = NonNullable<RunSyncOptions['redis']>;

// ---------------------------------------------------------------------------
// Fake Document_Store
// ---------------------------------------------------------------------------

/**
 * In-memory `DocumentStore` mirroring the real store's semantics: an
 * Enterprise_Id-keyed map of stored documents, a singleton checkpoint, and an
 * atomic `applyDelta`. The extra `docs` / `applyDeltaCalls` / `checkpoint`
 * handles let a test assert the Bootstrap_Sync vs Delta_Sync decision, the
 * fetched-set → upsert mapping, and the checkpoint persistence.
 */
interface FakeDocumentStore extends DocumentStore {
  readonly docs: Map<string, StoredFacilityDocument>;
  readonly applyDeltaCalls: ApplyDeltaInput[];
  readonly checkpoint: string | null;
}

function createFakeDocumentStore(
  initialCheckpoint: string | null = null,
): FakeDocumentStore {
  const docs = new Map<string, StoredFacilityDocument>();
  const applyDeltaCalls: ApplyDeltaInput[] = [];
  let checkpoint = initialCheckpoint;

  return {
    docs,
    applyDeltaCalls,
    get checkpoint() {
      return checkpoint;
    },
    async getCheckpoint(): Promise<string | null> {
      return checkpoint;
    },
    async setCheckpoint(seq: string): Promise<void> {
      checkpoint = seq;
    },
    async upsertDocuments(
      list: readonly StoredFacilityDocument[],
    ): Promise<void> {
      for (const d of list) {
        docs.set(d.enterpriseId, { ...d, deleted: false });
      }
    },
    async markDeleted(ids: readonly string[], seq: string): Promise<void> {
      for (const id of ids) {
        const cur = docs.get(id);
        if (cur) docs.set(id, { ...cur, deleted: true, changeSeq: seq });
      }
      checkpoint = seq;
    },
    async getActiveDocuments(): Promise<readonly FacilityDocument[]> {
      return [...docs.values()].filter((d) => !d.deleted).map((d) => d.body);
    },
    async applyDelta(input: ApplyDeltaInput): Promise<void> {
      applyDeltaCalls.push(input);
      for (const d of input.upserts) {
        docs.set(d.enterpriseId, { ...d, deleted: false });
      }
      for (const id of input.deletes) {
        const cur = docs.get(id);
        if (cur) {
          docs.set(id, { ...cur, deleted: true, changeSeq: input.lastSeq });
        }
      }
      checkpoint = input.lastSeq;
    },
  };
}

// ---------------------------------------------------------------------------
// Stub repo
// ---------------------------------------------------------------------------

interface StubRepoOptions {
  readonly snapshot?: readonly CatalogCacheRow[];
  readonly resortSnapshot?: readonly ResortCacheRow[];
  readonly applyShouldThrow?: Error;
  readonly recordSyncRunIdSequence?: readonly string[];
  /** Override the `getCacheAge` result (drives the scheduled freshness guard). */
  readonly cacheAge?: CacheAgeInfo;
}

interface StubRepo extends CatalogRepo {
  readonly applyCalls: CatalogDiff[];
  readonly recordCalls: RecordSyncRunInput[];
  readonly snapshotCalls: number;
}

function createStubRepo(opts: StubRepoOptions = {}): StubRepo {
  const applyCalls: CatalogDiff[] = [];
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
      return opts.cacheAge ?? { hours: null, lastSuccessfulSyncAt: null };
    },
    async getCacheSnapshot(): Promise<readonly CatalogCacheRow[]> {
      snapshotCalls++;
      return opts.snapshot ?? [];
    },
    async getResortSnapshot(): Promise<readonly ResortCacheRow[]> {
      return opts.resortSnapshot ?? [];
    },
    async getBridgeMap(): Promise<ReadonlyMap<string, string>> {
      return EMPTY_BRIDGE;
    },
    async applyReconciliation(diff: CatalogDiff): Promise<void> {
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
    async listActiveResorts() {
      return [];
    },
    async getExperience() {
      return null;
    },
    async listDestinationCounts() {
      return [];
    },
    async getMenusFor() {
      return [];
    },
    async getMenuFetchState() {
      return null;
    },
    async upsertMenus() {
      return;
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// Fake Facilities_Client
// ---------------------------------------------------------------------------

const MK_ANCESTOR = {
  id: '80007944;entityType=theme-park',
  type: 'theme-park',
  name: 'Magic Kingdom Park',
} as const;

const EPCOT_ANCESTOR = {
  id: '80007838;entityType=theme-park',
  type: 'theme-park',
  name: 'EPCOT',
} as const;

/**
 * The canonical WDW document set: two attractions (a ride and a parade) under
 * Magic Kingdom, one restaurant under EPCOT, one resort, plus documents that
 * normalization / the type split must drop (a transportation facility, a
 * tombstone, and a blank-name document).
 */
const SPACE_MOUNTAIN: FacilityDocument = {
  id: '80010177;entityType=Attraction',
  name: 'Space Mountain',
  type: 'attraction',
  ancestors: [MK_ANCESTOR],
};

const FESTIVAL_PARADE: FacilityDocument = {
  id: '80010200;entityType=Attraction',
  name: 'Festival of Fantasy Parade',
  type: 'attraction',
  ancestors: [MK_ANCESTOR],
};

const LE_CELLIER: FacilityDocument = {
  id: '90001111;entityType=Restaurant',
  name: 'Le Cellier Steakhouse',
  type: 'restaurant',
  ancestors: [EPCOT_ANCESTOR],
};

const GRAND_FLORIDIAN: FacilityDocument = {
  id: '80010407;entityType=Resort',
  name: "Disney's Grand Floridian Resort & Spa",
  type: 'resort',
};

const BUS_STOP: FacilityDocument = {
  id: '70000001;entityType=Transportation',
  name: 'TTC Bus Stop',
  type: 'transportation',
};

const TOMBSTONE: FacilityDocument = {
  id: '80009999;entityType=Attraction',
  type: 'attraction',
  softDeleted: true,
};

const BLANK_NAME: FacilityDocument = {
  id: '80008888;entityType=Attraction',
  name: '   ',
  type: 'attraction',
  ancestors: [MK_ANCESTOR],
};

const DEFAULT_DOCS: readonly FacilityDocument[] = [
  SPACE_MOUNTAIN,
  FESTIVAL_PARADE,
  LE_CELLIER,
  GRAND_FLORIDIAN,
  BUS_STOP,
  TOMBSTONE,
  BLANK_NAME,
];

interface FakeClientOptions {
  readonly docs?: readonly FacilityDocument[];
  /** Throw from `listChannelDocumentIds`. */
  readonly listError?: Error;
  /** Throw from `bulkGetDocuments`. */
  readonly bulkError?: Error;
  /** Menus returned per Enterprise_Id (defaults to none). */
  readonly menusByEnterpriseId?: ReadonlyMap<string, readonly RawMenu[]>;
}

function makeFacilitiesClient(opts: FakeClientOptions = {}): FacilitiesClient {
  const docs = opts.docs ?? DEFAULT_DOCS;
  return {
    async listChannelDocumentIds(channel: string) {
      if (opts.listError) throw opts.listError;
      expect(channel).toBe(FACILITIES_CHANNEL);
      return { changes: docs.map((d) => ({ id: d.id, deleted: false })), lastSeq: '1' };
    },
    async bulkGetDocuments(
      ids: readonly string[],
    ): Promise<readonly FacilityDocument[]> {
      if (opts.bulkError) throw opts.bulkError;
      // Mirror the real client: return exactly the requested (changed) ids.
      const wanted = new Set(ids);
      return docs.filter((d) => wanted.has(d.id));
    },
    async getMenus(enterpriseId: string): Promise<readonly RawMenu[]> {
      return opts.menusByEnterpriseId?.get(enterpriseId) ?? [];
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runSync — happy path', () => {
  it('acquires the lock, syncs, applies the diff, and records a success run', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo({ snapshot: [], resortSnapshot: [] });
    const documentStore = createFakeDocumentStore();
    const client = makeFacilitiesClient();

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore,
      client,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return; // narrowing for TS

    // Three experiences (space mountain, parade, le cellier) + one resort
    // survive normalization + the type split.
    expect(result.entitiesProcessed).toBe(4);
    expect(result.upserts).toBe(3);
    expect(result.softDeletes).toBe(0);
    expect(result.resortUpserts).toBe(1);
    expect(result.resortSoftDeletes).toBe(0);
    // Menus are no longer fetched during sync (lazy retrieval, R8.1).
    expect(result.menusWritten).toBe(0);

    // Bootstrap_Sync: with no prior checkpoint, the enumeration's lastSeq is
    // persisted atomically via applyDelta, and every fetched doc was upserted.
    expect(documentStore.applyDeltaCalls).toHaveLength(1);
    expect(documentStore.checkpoint).toBe('1');
    expect(documentStore.applyDeltaCalls[0]?.deletes).toEqual([]);

    // Snapshot was queried once.
    expect(repo.snapshotCalls).toBe(1);

    // applyReconciliation was called with a combined diff.
    expect(repo.applyCalls).toHaveLength(1);
    const diff = repo.applyCalls[0]!;
    const byUpstreamId = new Map<
      string,
      (typeof diff.experiences.upserts)[number]
    >();
    for (const u of diff.experiences.upserts) {
      byUpstreamId.set(u.upstreamEntityId, u);
    }

    expect(byUpstreamId.get(SPACE_MOUNTAIN.id)?.park).toBe(
      'Magic Kingdom' satisfies Park,
    );
    expect(byUpstreamId.get(SPACE_MOUNTAIN.id)?.category).toBe(
      'Ride' satisfies ExperienceCategory,
    );
    expect(byUpstreamId.get(SPACE_MOUNTAIN.id)?.id).toBe(idOf(SPACE_MOUNTAIN.id));

    expect(byUpstreamId.get(FESTIVAL_PARADE.id)?.category).toBe(
      'Parade' satisfies ExperienceCategory,
    );

    expect(byUpstreamId.get(LE_CELLIER.id)?.park).toBe(
      'EPCOT' satisfies Park,
    );
    expect(byUpstreamId.get(LE_CELLIER.id)?.category).toBe(
      'Restaurant' satisfies ExperienceCategory,
    );

    // The resort is split out and carries its own internal id.
    expect(diff.resorts.upserts).toHaveLength(1);
    expect(diff.resorts.upserts[0]?.upstreamEntityId).toBe(GRAND_FLORIDIAN.id);
    expect(diff.resorts.upserts[0]?.id).toBe(idOf(GRAND_FLORIDIAN.id));

    // No spurious entries from the excluded / dropped documents.
    expect(byUpstreamId.has(BUS_STOP.id)).toBe(false);
    expect(byUpstreamId.has(TOMBSTONE.id)).toBe(false);
    expect(byUpstreamId.has(BLANK_NAME.id)).toBe(false);

    // Success was recorded with entitiesProcessed populated.
    expect(repo.recordCalls).toEqual([
      expect.objectContaining({
        status: 'success',
        outcome: 'success',
        entitiesProcessed: 4,
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

  it('does not fetch any menus during sync (menus are lazy, R8.1)', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    const documentStore = createFakeDocumentStore();

    let getMenusCalls = 0;
    const base = makeFacilitiesClient();
    const client: FacilitiesClient = {
      listChannelDocumentIds: base.listChannelDocumentIds,
      bulkGetDocuments: base.bulkGetDocuments,
      async getMenus(id: string): Promise<readonly RawMenu[]> {
        getMenusCalls++;
        return base.getMenus(id);
      },
    };

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore,
      client,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    // The sync issues no Menu_Service requests and writes no menus.
    expect(getMenusCalls).toBe(0);
    expect(result.menusWritten).toBe(0);
    expect(repo.applyCalls[0]?.menus ?? []).toHaveLength(0);
  });

  it('runs a Delta_Sync from the stored checkpoint: enumerates with `since`, fetches only changed ids, and applies tombstones (R6.2, R6.4, R7.3)', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();

    // Pre-seed the store with two previously-synced documents + a checkpoint.
    const documentStore = createFakeDocumentStore('seq-100');
    documentStore.docs.set(SPACE_MOUNTAIN.id, {
      enterpriseId: SPACE_MOUNTAIN.id,
      body: SPACE_MOUNTAIN,
      deleted: false,
      changeSeq: 'seq-100',
    });
    documentStore.docs.set(GRAND_FLORIDIAN.id, {
      enterpriseId: GRAND_FLORIDIAN.id,
      body: GRAND_FLORIDIAN,
      deleted: false,
      changeSeq: 'seq-100',
    });

    // The delta feed: LE_CELLIER changed (new), SPACE_MOUNTAIN tombstoned.
    let sinceSeen: string | undefined = 'UNSET';
    const bulkIds: string[][] = [];
    const client: FacilitiesClient = {
      async listChannelDocumentIds(channel: string, since?: string) {
        expect(channel).toBe(FACILITIES_CHANNEL);
        sinceSeen = since;
        return {
          changes: [
            { id: LE_CELLIER.id, deleted: false },
            { id: SPACE_MOUNTAIN.id, deleted: true },
          ],
          lastSeq: 'seq-200',
        };
      },
      async bulkGetDocuments(
        ids: readonly string[],
      ): Promise<readonly FacilityDocument[]> {
        bulkIds.push([...ids]);
        const wanted = new Set(ids);
        return [LE_CELLIER, GRAND_FLORIDIAN, SPACE_MOUNTAIN].filter((d) =>
          wanted.has(d.id),
        );
      },
      async getMenus(): Promise<readonly RawMenu[]> {
        return [];
      },
    };

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore,
      client,
    });

    expect(result.status).toBe('success');

    // Delta_Sync: enumeration carried the stored checkpoint as `since`.
    expect(sinceSeen).toBe('seq-100');
    // Only the non-deleted changed id was bulk-fetched — no tombstone, no
    // unchanged document.
    expect(bulkIds).toEqual([[LE_CELLIER.id]]);
    // The tombstone was applied and the checkpoint advanced atomically.
    expect(documentStore.applyDeltaCalls).toHaveLength(1);
    expect(documentStore.applyDeltaCalls[0]?.deletes).toEqual([
      SPACE_MOUNTAIN.id,
    ]);
    expect(documentStore.checkpoint).toBe('seq-200');

    // The reconcile derives from the store's active set: LE_CELLIER stays, the
    // tombstoned SPACE_MOUNTAIN is gone.
    const diff = repo.applyCalls[0]!;
    const upstreamIds = new Set(
      diff.experiences.upserts.map((u) => u.upstreamEntityId),
    );
    expect(upstreamIds.has(LE_CELLIER.id)).toBe(true);
    expect(upstreamIds.has(SPACE_MOUNTAIN.id)).toBe(false);
    expect(diff.resorts.upserts[0]?.upstreamEntityId).toBe(GRAND_FLORIDIAN.id);
  });
});

describe('runSync — lock contention', () => {
  it('returns skipped/lock_held without invoking client or repo when lock is held', async () => {
    const redis = createFakeRedis();
    redis.store.set(CATALOG_SYNC_LOCK_KEY, 'pre-existing-token');

    const repo = createStubRepo();
    let clientCalls = 0;
    const client: FacilitiesClient = {
      async listChannelDocumentIds() {
        clientCalls++;
        return { changes: [], lastSeq: '1' };
      },
      async bulkGetDocuments() {
        clientCalls++;
        return [];
      },
      async getMenus() {
        clientCalls++;
        return [];
      },
    };

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'lock_held' });
    expect(clientCalls).toBe(0);
    expect(repo.snapshotCalls).toBe(0);
    expect(repo.applyCalls).toHaveLength(0);
    expect(repo.recordCalls).toHaveLength(0);

    // The orchestrator must NOT delete the lock it failed to acquire.
    expect(redis.store.get(CATALOG_SYNC_LOCK_KEY)).toBe('pre-existing-token');
  });
});

describe('runSync — scheduled freshness guard (R9.2)', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const INTERVAL_MS = 24 * HOUR_MS;

  it('a scheduled run is a no-op while the last successful sync is within the freshness interval', async () => {
    const redis = createFakeRedis();
    const now = new Date('2024-01-02T00:00:00.000Z');
    // Last success 1h ago — well inside the 24h freshness window.
    const repo = createStubRepo({
      cacheAge: {
        hours: 1,
        lastSuccessfulSyncAt: new Date(now.getTime() - HOUR_MS),
      },
    });
    let clientCalls = 0;
    const client: FacilitiesClient = {
      async listChannelDocumentIds() {
        clientCalls++;
        return { changes: [], lastSeq: '1' };
      },
      async bulkGetDocuments() {
        clientCalls++;
        return [];
      },
      async getMenus() {
        clientCalls++;
        return [];
      },
    };

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client,
      trigger: 'scheduled',
      freshnessIntervalMs: INTERVAL_MS,
      now: () => now,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'fresh' });
    // The guard short-circuits before acquiring the lock or touching upstream.
    expect(clientCalls).toBe(0);
    expect(repo.snapshotCalls).toBe(0);
    expect(repo.applyCalls).toHaveLength(0);
    expect(repo.recordCalls).toHaveLength(0);
    expect(redis.store.has(CATALOG_SYNC_LOCK_KEY)).toBe(false);
  });

  it('a scheduled run proceeds when the last successful sync is older than the freshness interval', async () => {
    const redis = createFakeRedis();
    const now = new Date('2024-01-02T00:00:00.000Z');
    // Last success 25h ago — past the 24h freshness window.
    const repo = createStubRepo({
      cacheAge: {
        hours: 25,
        lastSuccessfulSyncAt: new Date(now.getTime() - 25 * HOUR_MS),
      },
    });

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client: makeFacilitiesClient(),
      trigger: 'scheduled',
      freshnessIntervalMs: INTERVAL_MS,
      now: () => now,
    });

    expect(result.status).toBe('success');
    expect(repo.recordCalls).toHaveLength(1);
    expect(repo.recordCalls[0]?.status).toBe('success');
  });

  it('a scheduled run proceeds when no successful sync has ever completed', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo({
      cacheAge: { hours: null, lastSuccessfulSyncAt: null },
    });

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client: makeFacilitiesClient(),
      trigger: 'scheduled',
      freshnessIntervalMs: INTERVAL_MS,
    });

    expect(result.status).toBe('success');
  });

  it('an on-read (opportunistic) run bypasses the freshness guard even when the cache is fresh', async () => {
    const redis = createFakeRedis();
    const now = new Date('2024-01-02T00:00:00.000Z');
    // Fresh cache (1h ago) — a scheduled run would skip, on-read must not.
    const repo = createStubRepo({
      cacheAge: {
        hours: 1,
        lastSuccessfulSyncAt: new Date(now.getTime() - HOUR_MS),
      },
    });

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client: makeFacilitiesClient(),
      trigger: 'on_read',
      freshnessIntervalMs: INTERVAL_MS,
      now: () => now,
    });

    expect(result.status).toBe('success');
  });

  it('a manual run (default trigger) bypasses the freshness guard even when the cache is fresh', async () => {
    const redis = createFakeRedis();
    const now = new Date('2024-01-02T00:00:00.000Z');
    const repo = createStubRepo({
      cacheAge: {
        hours: 1,
        lastSuccessfulSyncAt: new Date(now.getTime() - HOUR_MS),
      },
    });

    // No `trigger` => defaults to 'manual'; no `freshnessIntervalMs` needed.
    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client: makeFacilitiesClient(),
      now: () => now,
    });

    expect(result.status).toBe('success');
  });
});

describe('runSync — upstream failure (R12.3, R12.4)', () => {
  it('records a failed run, does not apply any diff, and releases the lock', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    const client = makeFacilitiesClient({
      listError: new UpstreamError(
        'http_status',
        'Sync Gateway returned HTTP 503.',
        { status: 503 },
      ),
    });

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client,
    });

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('upstream');
    // `http_status` is retired from the outcome closed set: the transport now
    // classifies Disney failures, and a generic non-2xx maps to
    // `invalid_response` (R12.6).
    expect(result.outcome).toBe('invalid_response');
    expect(result.error).toBeInstanceOf(UpstreamError);

    // No reconciliation occurred (R12.4: prior cache left unchanged).
    expect(repo.applyCalls).toHaveLength(0);

    // A failed run row was recorded with the upstream error class /
    // message preserved for diagnostics.
    expect(repo.recordCalls).toEqual([
      expect.objectContaining({
        status: 'failed',
        outcome: 'invalid_response',
        errorClass: 'UpstreamError',
        errorMessage: expect.stringContaining('503'),
      }),
    ]);

    // Lock is released even on failure.
    expect(redis.store.has(CATALOG_SYNC_LOCK_KEY)).toBe(false);
  });

  it('records a failed run when the bulk-get fetch throws after enumeration succeeds', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    const client = makeFacilitiesClient({
      bulkError: new UpstreamError('network', 'transport error'),
    });

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client,
    });

    expect(result.status).toBe('failed');
    expect(repo.applyCalls).toHaveLength(0);
    expect(repo.recordCalls[0]?.status).toBe('failed');
    expect(repo.recordCalls[0]?.outcome).toBe('network');
  });
});

describe('runSync — reconcile drives upserts and soft-deletes', () => {
  it('soft-deletes a cached row whose upstream id is no longer returned (R11.5)', async () => {
    const redis = createFakeRedis();
    // Cache contains one extra row that upstream no longer surfaces.
    const goneId = idOf('80005555;entityType=Attraction');
    const snapshot: readonly CatalogCacheRow[] = [
      {
        id: goneId,
        active: true,
        name: 'Extinct Ride',
        park: 'Magic Kingdom',
        category: 'Ride',
        land: null,
        areaType: 'ThemePark',
        resortId: null,
        resortArea: null,
      },
    ];
    const repo = createStubRepo({ snapshot });
    const client = makeFacilitiesClient();

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    expect(result.softDeletes).toBe(1);
    const diff = repo.applyCalls[0]!;
    expect(diff.experiences.softDeletes).toEqual([{ id: goneId }]);
  });

  it('reactivates a soft-deleted cache row when its upstream id reappears (R11.2)', async () => {
    const redis = createFakeRedis();
    const reactivatedInternalId = idOf(SPACE_MOUNTAIN.id);

    const snapshot: readonly CatalogCacheRow[] = [
      {
        id: reactivatedInternalId,
        active: false,
        name: 'Space Mountain',
        park: 'Magic Kingdom',
        category: 'Ride',
        land: null,
        areaType: 'ThemePark',
        resortId: null,
        resortArea: null,
      },
    ];
    const repo = createStubRepo({ snapshot });
    const client = makeFacilitiesClient();

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore: createFakeDocumentStore(),
      client,
    });

    expect(result.status).toBe('success');
    const diff = repo.applyCalls[0]!;
    const reactivated = diff.experiences.upserts.find(
      (u) => u.id === reactivatedInternalId,
    );
    expect(reactivated).toBeDefined();
    expect(reactivated?.active).toBe(true);
    expect(diff.experiences.softDeletes).toHaveLength(0);
  });
});
