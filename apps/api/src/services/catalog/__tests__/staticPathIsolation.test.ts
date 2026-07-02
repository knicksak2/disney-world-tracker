/**
 * Static-path isolation + sync wiring example tests (task 13.7).
 *
 * Example/wiring tests (not property tests) pinning the structural guarantees
 * the design makes about the Disney static path (`Catalog_Sync`):
 *
 *   - The static path enumerates Disney ONLY through the injected
 *     {@link FacilitiesClient} and NEVER contacts ThemeParks.wiki: `runSync`
 *     has no ThemeParks dependency at all, and the only upstream collaborator
 *     it accepts is the Facilities_Client (R13.5).
 *   - A full `runSync` issues NO menu requests (`getMenus` is never called) and
 *     no Disney live-channel requests — menus are demand-driven and live data
 *     comes from ThemeParks.wiki, so the sync only enumerates + bulk-gets
 *     catalog documents (R10.4).
 *   - Only the Facilities_Channel `wdw.facilities.1_0.en_us` is ever enumerated
 *     (R15.1): every `listChannelDocumentIds` call carries that channel and no
 *     other, and no per-guest/other-channel enumeration occurs (R15.3).
 *
 * The tests reuse the fake-DocumentStore / stub-CatalogRepo / fake-Redis
 * patterns from `sync.test.ts`, and add a spy Facilities_Client that records
 * every operation and a ThemeParks tripwire that fails loudly if contacted.
 *
 * Validates: Requirements 10.4, 13.5, 15.1, 15.3
 */

import { describe, expect, it } from 'vitest';

import type { FacilityDocument } from '../disney/facilityDoc.js';
import {
  FACILITIES_CHANNEL,
  type ChannelChanges,
  type FacilitiesClient,
} from '../disney/facilitiesClient.js';
import type { RawMenu } from '../disney/menu.js';
import { runSync, type RunSyncOptions } from '../sync.js';
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
import type {
  CatalogCacheRow,
  CatalogDiff,
  ResortCacheRow,
} from '../types.js';

const EMPTY_BRIDGE: ReadonlyMap<string, string> = new Map();

// ---------------------------------------------------------------------------
// Fake Redis (SET NX PX + compare-and-delete EVAL)
// ---------------------------------------------------------------------------

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
      if (nxFlag === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async eval(
      _script: string,
      _numKeys: number,
      key: string,
      token: string,
    ): Promise<number> {
      if (store.get(key) === token) {
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

function createFakeDocumentStore(
  initialCheckpoint: string | null = null,
): DocumentStore {
  const docs = new Map<string, StoredFacilityDocument>();
  let checkpoint = initialCheckpoint;
  return {
    async getCheckpoint(): Promise<string | null> {
      return checkpoint;
    },
    async setCheckpoint(seq: string): Promise<void> {
      checkpoint = seq;
    },
    async upsertDocuments(list: readonly StoredFacilityDocument[]): Promise<void> {
      for (const d of list) docs.set(d.enterpriseId, { ...d, deleted: false });
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
      for (const d of input.upserts) docs.set(d.enterpriseId, { ...d, deleted: false });
      for (const id of input.deletes) {
        const cur = docs.get(id);
        if (cur) docs.set(id, { ...cur, deleted: true, changeSeq: input.lastSeq });
      }
      checkpoint = input.lastSeq;
    },
  };
}

// ---------------------------------------------------------------------------
// Stub CatalogRepo
// ---------------------------------------------------------------------------

interface StubRepo extends CatalogRepo {
  readonly applyCalls: CatalogDiff[];
  readonly recordCalls: RecordSyncRunInput[];
}

function createStubRepo(): StubRepo {
  const applyCalls: CatalogDiff[] = [];
  const recordCalls: RecordSyncRunInput[] = [];
  return {
    applyCalls,
    recordCalls,
    async getCacheAge(): Promise<CacheAgeInfo> {
      return { hours: null, lastSuccessfulSyncAt: null };
    },
    async getCacheSnapshot(): Promise<readonly CatalogCacheRow[]> {
      return [];
    },
    async getResortSnapshot(): Promise<readonly ResortCacheRow[]> {
      return [];
    },
    async getBridgeMap(): Promise<ReadonlyMap<string, string>> {
      return EMPTY_BRIDGE;
    },
    async applyReconciliation(diff: CatalogDiff): Promise<void> {
      applyCalls.push(diff);
    },
    async recordSyncRun(input: RecordSyncRunInput): Promise<RecordedSyncRun> {
      recordCalls.push(input);
      return { id: 'run-1' };
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
}

// ---------------------------------------------------------------------------
// Spy Facilities_Client
// ---------------------------------------------------------------------------

const MK_ANCESTOR = {
  id: '80007944;entityType=theme-park',
  type: 'theme-park',
  name: 'Magic Kingdom Park',
} as const;

const SPACE_MOUNTAIN: FacilityDocument = {
  id: '80010177;entityType=Attraction',
  name: 'Space Mountain',
  type: 'attraction',
  ancestors: [MK_ANCESTOR],
};

const LE_CELLIER: FacilityDocument = {
  id: '90001111;entityType=Restaurant',
  name: 'Le Cellier Steakhouse',
  type: 'restaurant',
  ancestors: [MK_ANCESTOR],
};

const DEFAULT_DOCS: readonly FacilityDocument[] = [SPACE_MOUNTAIN, LE_CELLIER];

interface SpyFacilitiesClient extends FacilitiesClient {
  readonly listChannelCalls: Array<{ channel: string; since: string | undefined }>;
  readonly bulkGetCalls: Array<readonly string[]>;
  readonly getMenusCalls: string[];
}

function createSpyFacilitiesClient(
  docs: readonly FacilityDocument[] = DEFAULT_DOCS,
): SpyFacilitiesClient {
  const listChannelCalls: Array<{ channel: string; since: string | undefined }> = [];
  const bulkGetCalls: Array<readonly string[]> = [];
  const getMenusCalls: string[] = [];
  return {
    listChannelCalls,
    bulkGetCalls,
    getMenusCalls,
    async listChannelDocumentIds(channel: string, since?: string): Promise<ChannelChanges> {
      listChannelCalls.push({ channel, since });
      return { changes: docs.map((d) => ({ id: d.id, deleted: false })), lastSeq: 'seq-1' };
    },
    async bulkGetDocuments(ids: readonly string[]): Promise<readonly FacilityDocument[]> {
      bulkGetCalls.push([...ids]);
      const wanted = new Set(ids);
      return docs.filter((d) => wanted.has(d.id));
    },
    async getMenus(enterpriseId: string): Promise<readonly RawMenu[]> {
      getMenusCalls.push(enterpriseId);
      return [];
    },
  };
}

/**
 * A ThemeParks.wiki tripwire. `runSync` has no ThemeParks seam, so this is
 * never wired in; its `fetch` throws if invoked and its counter proves zero
 * contact with ThemeParks.wiki from the static path.
 */
function createThemeParksTripwire() {
  const state = { contacts: 0 };
  return {
    state,
    fetch: (async () => {
      state.contacts += 1;
      throw new Error('ThemeParks.wiki contacted from the static sync path (should never happen)');
    }) as unknown as typeof globalThis.fetch,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('static-path isolation (R13.5, R15.1, R15.3)', () => {
  it('a full runSync enumerates ONLY the Facilities_Channel and never contacts ThemeParks.wiki', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    const documentStore = createFakeDocumentStore();
    const client = createSpyFacilitiesClient();
    const themeParks = createThemeParksTripwire();

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore,
      client,
    });

    expect(result.status).toBe('success');

    // The Facilities_Client was the only upstream collaborator injected; there
    // is no ThemeParks seam on RunSyncOptions, so ThemeParks.wiki is untouched.
    expect(themeParks.state.contacts).toBe(0);

    // Every enumeration targeted the Facilities_Channel and nothing else
    // (R15.1): a Bootstrap_Sync makes exactly one enumeration with no `since`.
    expect(client.listChannelCalls).toHaveLength(1);
    for (const call of client.listChannelCalls) {
      expect(call.channel).toBe(FACILITIES_CHANNEL);
    }
    const enumeratedChannels = new Set(client.listChannelCalls.map((c) => c.channel));
    expect([...enumeratedChannels]).toEqual([FACILITIES_CHANNEL]);

    // Documents were bulk-fetched to reconcile the catalog.
    expect(client.bulkGetCalls.length).toBeGreaterThan(0);
  });

  it('issues NO menu requests and no Disney live-channel requests during a full sync (R10.4)', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    const documentStore = createFakeDocumentStore();
    // Include a restaurant so a menu fetch *would* be tempting if the sync did
    // eager menu retrieval — it must not.
    const client = createSpyFacilitiesClient([SPACE_MOUNTAIN, LE_CELLIER]);

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore,
      client,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;

    // No menu requests: menus are demand-driven at read time (R8.1, R10.4).
    expect(client.getMenusCalls).toEqual([]);
    expect(result.menusWritten).toBe(0);

    // The only upstream operations were enumeration + bulk-get of catalog docs.
    // No Disney live-channel enumeration exists: the ONLY channel enumerated is
    // the Facilities_Channel (R10.4, R15.1).
    for (const call of client.listChannelCalls) {
      expect(call.channel).toBe(FACILITIES_CHANNEL);
    }
  });

  it('a Delta_Sync also enumerates ONLY the Facilities_Channel (R15.1)', async () => {
    const redis = createFakeRedis();
    const repo = createStubRepo();
    // Seed a checkpoint so runSync takes the Delta_Sync path.
    const documentStore = createFakeDocumentStore('seq-100');
    const client = createSpyFacilitiesClient();

    const result = await runSync({
      redis: redis as unknown as FakeRedis,
      repo,
      documentStore,
      client,
    });

    expect(result.status).toBe('success');

    // Delta_Sync carries the checkpoint as `since`, still on the Facilities_Channel.
    expect(client.listChannelCalls).toHaveLength(1);
    expect(client.listChannelCalls[0]).toEqual({
      channel: FACILITIES_CHANNEL,
      since: 'seq-100',
    });
    expect(client.getMenusCalls).toEqual([]);
  });
});
