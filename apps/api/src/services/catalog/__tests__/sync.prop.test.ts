// Feature: disney-source-resilience, Property 15 (sync-run outcome discriminator, end-to-end)
/**
 * Property-based tests for the Catalog_Sync orchestrator's run-outcome
 * recording, exercised end-to-end through `runSync` (`sync.ts`).
 *
 * Since the incremental refactor (task 8.3) the sync is checkpoint-driven and no
 * longer fetches menus during a run (menus are demand-driven, R8.1). The
 * menu-failure-isolation property that previously lived here is therefore void
 * and has been removed; what remains is the invariant that every run which
 * reaches the sync body records an outcome drawn from the closed `SyncRunOutcome`
 * set, with the discriminator the design prescribes for each termination point.
 *
 *   Every `Catalog_Sync` run that reaches the sync body (acquired the lock and
 *   did not skip) records an outcome in `Sync_Run_History` whose discriminator
 *   is exactly one of the closed set
 *   `{ success, waf_block, auth_failure, network, invalid_response, aborted }`,
 *   no matter where or how the run succeeds or fails. `http_status` is retired
 *   from the set and folded into `invalid_response`.
 *
 * Validates: Requirements 12.4, 12.5, 12.6
 *
 * The suite drives `runSync` end-to-end through a fake Redis (whose lock is
 * always free, so no run is skipped), an in-memory `DocumentStore`, and a
 * capturing repo + Facilities_Client that randomize *where* a run terminates:
 *
 *   - a clean run (no injected failure)                   → `success`
 *   - the channel enumeration throws an `UpstreamError`   → mapped kind
 *   - the bulk-get fetch throws an `UpstreamError`        → mapped kind
 *   - the transactional apply throws an `UpstreamError`   → mapped kind
 *   - the transactional apply throws a non-upstream error → `invalid_response`
 *
 * `numRuns: 100` per the spec convention.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SYNC_RUN_OUTCOMES, type SyncRunOutcome } from '@dwt/shared';

import type { FacilityDocument } from '../disney/facilityDoc.js';
import { type FacilitiesClient } from '../disney/facilitiesClient.js';
import type { RawMenu } from '../disney/menu.js';
import { runSync, type RunSyncOptions } from '../sync.js';
import { UpstreamError, type UpstreamErrorKind } from '../themeparks.js';
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
import type { CatalogDiff } from '../types.js';

const NUM_RUNS = 100;
const EMPTY_BRIDGE: ReadonlyMap<string, string> = new Map();

// ---------------------------------------------------------------------------
// Fake Redis — SET ... NX PX + compare-and-delete EVAL (mirrors sync.test.ts)
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
// Fake Document_Store — in-memory map + singleton checkpoint
// ---------------------------------------------------------------------------

function createFakeDocumentStore(): DocumentStore {
  const docs = new Map<string, StoredFacilityDocument>();
  let checkpoint: string | null = null;
  return {
    async getCheckpoint() {
      return checkpoint;
    },
    async setCheckpoint(seq: string) {
      checkpoint = seq;
    },
    async upsertDocuments(list: readonly StoredFacilityDocument[]) {
      for (const d of list) docs.set(d.enterpriseId, { ...d, deleted: false });
    },
    async markDeleted(ids: readonly string[], seq: string) {
      for (const id of ids) {
        const cur = docs.get(id);
        if (cur) docs.set(id, { ...cur, deleted: true, changeSeq: seq });
      }
      checkpoint = seq;
    },
    async getActiveDocuments(): Promise<readonly FacilityDocument[]> {
      return [...docs.values()].filter((d) => !d.deleted).map((d) => d.body);
    },
    async applyDelta(input: ApplyDeltaInput) {
      for (const d of input.upserts) {
        docs.set(d.enterpriseId, { ...d, deleted: false });
      }
      for (const id of input.deletes) {
        const cur = docs.get(id);
        if (cur) docs.set(id, { ...cur, deleted: true, changeSeq: input.lastSeq });
      }
      checkpoint = input.lastSeq;
    },
  };
}

// ---------------------------------------------------------------------------
// The closed outcome set + the transport failure kinds
// ---------------------------------------------------------------------------

/**
 * The closed set of run-outcome discriminators the design permits in
 * `catalog_sync_runs.outcome` (R12.6), sourced from `@dwt/shared` so the test
 * can never drift from the single source of truth.
 */
const OUTCOME_SET: ReadonlySet<SyncRunOutcome> = new Set<SyncRunOutcome>(
  SYNC_RUN_OUTCOMES,
);

/** The four upstream-failure discriminators an `UpstreamError` can carry. */
const UPSTREAM_KINDS: readonly UpstreamErrorKind[] = [
  'http_status',
  'network',
  'invalid_response',
  'aborted',
];

/**
 * The outcome `outcomeFromError` maps a given `UpstreamError.kind` to. Mirrors
 * the design table: `http_status` is retired (folded into `invalid_response`);
 * `network` / `invalid_response` / `aborted` pass through.
 */
function outcomeOfKind(kind: UpstreamErrorKind): SyncRunOutcome {
  switch (kind) {
    case 'http_status':
      return 'invalid_response';
    case 'network':
      return 'network';
    case 'invalid_response':
      return 'invalid_response';
    case 'aborted':
      return 'aborted';
  }
}

/** Where a run terminates (drives the recorded outcome). */
type OutcomeScenario =
  | { readonly kind: 'success' }
  | { readonly kind: 'list_fails'; readonly errKind: UpstreamErrorKind }
  | { readonly kind: 'bulk_fails'; readonly errKind: UpstreamErrorKind }
  | { readonly kind: 'apply_upstream_fails'; readonly errKind: UpstreamErrorKind }
  | { readonly kind: 'apply_generic_fails' };

/** The outcome discriminator the design prescribes for a given scenario. */
function expectedOutcome(sc: OutcomeScenario): SyncRunOutcome {
  switch (sc.kind) {
    case 'success':
      return 'success';
    case 'list_fails':
    case 'bulk_fails':
    case 'apply_upstream_fails':
      return outcomeOfKind(sc.errKind);
    case 'apply_generic_fails':
      // A non-upstream failure (e.g. a DB error mid-apply) cannot produce a
      // valid applied result; the closed set admits no generic code, so it is
      // recorded as `invalid_response`.
      return 'invalid_response';
  }
}

function makeUpstreamError(kind: UpstreamErrorKind): UpstreamError {
  return new UpstreamError(
    kind,
    `injected ${kind} failure`,
    kind === 'http_status' ? { status: 503 } : {},
  );
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function createOutcomeClient(
  sc: OutcomeScenario,
  docs: readonly FacilityDocument[],
): FacilitiesClient {
  return {
    async listChannelDocumentIds() {
      if (sc.kind === 'list_fails') throw makeUpstreamError(sc.errKind);
      return {
        changes: docs.map((doc) => ({ id: doc.id, deleted: false })),
        lastSeq: '1',
      };
    },
    async bulkGetDocuments(
      ids: readonly string[],
    ): Promise<readonly FacilityDocument[]> {
      if (sc.kind === 'bulk_fails') throw makeUpstreamError(sc.errKind);
      const wanted = new Set(ids);
      return docs.filter((d) => wanted.has(d.id));
    },
    async getMenus(): Promise<readonly RawMenu[]> {
      // The sync no longer fetches menus; included only to satisfy the
      // FacilitiesClient surface.
      return [];
    },
  };
}

interface OutcomeRepo extends CatalogRepo {
  readonly recorded: RecordSyncRunInput[];
}

function createOutcomeRepo(sc: OutcomeScenario): OutcomeRepo {
  const recorded: RecordSyncRunInput[] = [];
  const repo: OutcomeRepo = {
    recorded,
    async getCacheAge(): Promise<CacheAgeInfo> {
      return { hours: null, lastSuccessfulSyncAt: null };
    },
    async getCacheSnapshot() {
      return [];
    },
    async getResortSnapshot() {
      return [];
    },
    async getBridgeMap(): Promise<ReadonlyMap<string, string>> {
      return EMPTY_BRIDGE;
    },
    async applyReconciliation(_diff: CatalogDiff): Promise<void> {
      if (sc.kind === 'apply_upstream_fails') throw makeUpstreamError(sc.errKind);
      if (sc.kind === 'apply_generic_fails') {
        throw new Error('injected non-upstream apply failure (DB down)');
      }
    },
    async recordSyncRun(input: RecordSyncRunInput): Promise<RecordedSyncRun> {
      recorded.push(input);
      return { id: `run-${recorded.length}` };
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
    async updateSpecialHoursParticipation() {
      return;
    },
  };
  return repo;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const outcomeUpstreamKind: fc.Arbitrary<UpstreamErrorKind> = fc.constantFrom(
  ...UPSTREAM_KINDS,
);

const outcomeScenario: fc.Arbitrary<OutcomeScenario> = fc.oneof(
  fc.constant<OutcomeScenario>({ kind: 'success' }),
  outcomeUpstreamKind.map<OutcomeScenario>((errKind) => ({
    kind: 'list_fails',
    errKind,
  })),
  outcomeUpstreamKind.map<OutcomeScenario>((errKind) => ({
    kind: 'bulk_fails',
    errKind,
  })),
  outcomeUpstreamKind.map<OutcomeScenario>((errKind) => ({
    kind: 'apply_upstream_fails',
    errKind,
  })),
  fc.constant<OutcomeScenario>({ kind: 'apply_generic_fails' }),
);

const outcomeEnterpriseId: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 1, max: 99_999_999 }),
    fc.constantFrom('Attraction', 'Restaurant', 'Resort', 'Entertainment'),
  )
  .map(([numericId, entityType]) => `${numericId};entityType=${entityType}`);

const outcomeFacilityType: fc.Arbitrary<string | undefined> = fc.constantFrom(
  'attraction',
  'entertainment',
  'restaurant',
  'resort',
  'resort-area',
  'transportation',
  undefined,
);

const outcomeDocument: fc.Arbitrary<FacilityDocument> = fc
  .record({
    id: outcomeEnterpriseId,
    name: fc.oneof(
      fc.string({ minLength: 1, maxLength: 24 }),
      fc.constant('   '),
    ),
    type: outcomeFacilityType,
    detailImageUrl: fc.option(fc.webUrl(), { nil: undefined }),
    listImageUrl: fc.option(fc.webUrl(), { nil: undefined }),
    latitude: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), {
      nil: undefined,
    }),
    longitude: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), {
      nil: undefined,
    }),
    softDeleted: fc.option(fc.boolean(), { nil: undefined }),
  })
  .map((doc): FacilityDocument => ({
    id: doc.id,
    name: doc.name,
    ...(doc.type !== undefined ? { type: doc.type } : {}),
    ...(doc.detailImageUrl !== undefined
      ? { detailImageUrl: doc.detailImageUrl }
      : {}),
    ...(doc.listImageUrl !== undefined
      ? { listImageUrl: doc.listImageUrl }
      : {}),
    ...(doc.latitude !== undefined ? { latitude: doc.latitude } : {}),
    ...(doc.longitude !== undefined ? { longitude: doc.longitude } : {}),
    ...(doc.softDeleted !== undefined ? { softDeleted: doc.softDeleted } : {}),
  }));

const outcomeDocuments: fc.Arbitrary<readonly FacilityDocument[]> = fc.array(
  outcomeDocument,
  { maxLength: 12 },
);

async function runOutcome(
  sc: OutcomeScenario,
  docs: readonly FacilityDocument[],
) {
  const redis = createFakeRedis();
  const repo = createOutcomeRepo(sc);
  const documentStore = createFakeDocumentStore();
  const client = createOutcomeClient(sc, docs);
  const result = await runSync({
    redis: redis as unknown as FakeRedis,
    repo,
    documentStore,
    client,
  });
  return { result, repo };
}

describe('runSync — every run records an outcome from the closed set (R12.6)', () => {
  it('records exactly one run whose outcome is a member of the closed set', async () => {
    await fc.assert(
      fc.asyncProperty(
        outcomeScenario,
        outcomeDocuments,
        async (sc, docs) => {
          const { result, repo } = await runOutcome(sc, docs);

          // The lock was free, so the run always reaches the sync body and is
          // never skipped.
          expect(result.status).not.toBe('skipped');

          // Exactly one sync run is recorded per invocation.
          expect(repo.recorded).toHaveLength(1);

          const outcome = repo.recorded[0]?.outcome;
          expect(outcome).toBeDefined();
          expect(OUTCOME_SET.has(outcome as SyncRunOutcome)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('records the specific discriminator the design prescribes for each termination point', async () => {
    await fc.assert(
      fc.asyncProperty(
        outcomeScenario,
        outcomeDocuments,
        async (sc, docs) => {
          const { result, repo } = await runOutcome(sc, docs);

          const expected = expectedOutcome(sc);
          expect(repo.recorded[0]?.outcome).toBe(expected);

          if (sc.kind === 'success') {
            expect(repo.recorded[0]?.status).toBe('success');
            expect(result.status).toBe('success');
          } else {
            expect(repo.recorded[0]?.status).toBe('failed');
            expect(result.status).toBe('failed');
            if (result.status === 'failed') {
              expect(result.outcome).toBe(expected);
            }
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

describe('runSync — outcome fixed examples', () => {
  const okDoc: FacilityDocument = {
    id: '80010177;entityType=Attraction',
    name: 'Space Mountain',
    type: 'attraction',
  };

  async function recordOne(sc: OutcomeScenario): Promise<RecordSyncRunInput> {
    const { repo } = await runOutcome(sc, [okDoc]);
    const input = repo.recorded[0];
    if (input === undefined) {
      throw new Error('expected exactly one recorded sync run');
    }
    return input;
  }

  it('records `success` for a clean run', async () => {
    const input = await recordOne({ kind: 'success' });
    expect(input.outcome).toBe('success');
    expect(input.status).toBe('success');
  });

  it('records `invalid_response` when enumeration rejects with a generic HTTP status (http_status retired)', async () => {
    const input = await recordOne({ kind: 'list_fails', errKind: 'http_status' });
    expect(input.outcome).toBe('invalid_response');
    expect(input.status).toBe('failed');
  });

  it('records `network` when the bulk-get fetch has a transport failure', async () => {
    const input = await recordOne({ kind: 'bulk_fails', errKind: 'network' });
    expect(input.outcome).toBe('network');
  });

  it('records `aborted` when the fetch is cancelled', async () => {
    const input = await recordOne({ kind: 'bulk_fails', errKind: 'aborted' });
    expect(input.outcome).toBe('aborted');
  });

  it('records `invalid_response` when a non-upstream error occurs mid-apply', async () => {
    const input = await recordOne({ kind: 'apply_generic_fails' });
    expect(input.outcome).toBe('invalid_response');
    expect(input.status).toBe('failed');
  });
});
