/**
 * Catalog_Sync orchestrator (Disney sources).
 *
 * `runSync(options)` is the single entry point that drives one full
 * synchronization pass against the Disney sources — the `Disney_Sync_Gateway`
 * facilities channel and the `Menu_Service` — reconciles the result against
 * the local cache, and records the outcome in `catalog_sync_runs` /
 * `catalog_cache_metadata`.
 *
 * The orchestrator is the meeting point of the pure Disney transformation
 * cores (`classifyFacility`, `resolveArea`, `extractEnrichment`,
 * `selectImageUrl`, `projectMenus`), the identity Bridge_Map
 * (`assignInternalId`), the combined `reconcileCatalog` diff, the typed
 * `Facilities_Client`, the catalog repo, and the Redis coordination lock. It
 * is deliberately the only place where those pieces are wired together so that
 * the BullMQ scheduler and the opportunistic on-read sync can both call it
 * without duplicating logic.
 *
 * Behavior, anchored to the design and requirements:
 *
 *   1. **Single in-flight sync per cluster.** A Redis `SET ... NX PX` against
 *      `catalog:sync:lock` with a 10-minute TTL guards every run. A concurrent
 *      caller gets `{ status: 'skipped', reason: 'lock_held' }`.
 *
 *   2. **Atomic lock release.** Release uses a small Lua script that only DELs
 *      the key when the stored token matches our token.
 *
 *   3. **Checkpoint-driven upstream walk (R6, R7).** The run reads the
 *      persisted `Changes_Checkpoint` from the `Document_Store`: absent ⇒
 *      `Bootstrap_Sync` (full channel enumeration with no `since`, R6.1);
 *      present ⇒ `Delta_Sync` (`_changes?since=<seq>`, R6.2). Only the
 *      non-deleted changed ids are bulk-fetched (R6.4); deleted ids become
 *      tombstones (R7.3). The document upserts, tombstones, and the new
 *      `last_seq` checkpoint are persisted atomically via `applyDelta` — and
 *      only on a successful enumeration+fetch (R6.3, R6.5, R7.5).
 *
 *   4. **Reconcile from the store (R7.4).** The upstream entity set is derived
 *      from `documentStore.getActiveDocuments()` (the non-tombstoned bodies),
 *      not a fresh full enumeration, then normalized: blank/whitespace-name
 *      documents are excluded (R3.7).
 *
 *   5. **No menu fetch during sync (R8.1, R10.4).** Menus are demand-driven at
 *      read time now; the sync issues no `Menu_Service` requests.
 *
 *   6. **Identity continuity (R10).** Both Experiences and Resorts derive their
 *      Internal_Id via `assignInternalId(enterpriseId, bridge)`: the bridged id
 *      when the Enterprise_Id has a continuity entry (R10.3), else UUIDv5 of the
 *      Enterprise_Id (R10.1, R10.4).
 *
 *   7. **Transactional cache write (R11.6, R11.7).** The combined diff produced
 *      by `reconcileCatalog` (Experiences + Resorts) plus the per-restaurant
 *      menu writes is applied via `repo.applyReconciliation` inside a single
 *      Postgres transaction — a partial failure rolls back to leave the cache
 *      untouched.
 *
 *   8. **Failure handling + outcome discriminator (R12.3, R12.4, R12.5).** Any
 *      thrown error is caught, translated into a `failed` row, and the cache is
 *      left unchanged. Every run records an `outcome` discriminator from the
 *      closed set `{ success, http_status, network, invalid_response, aborted }`:
 *      a successful run records `success`; an `UpstreamError` records its
 *      `kind` (so a Sync Gateway auth rejection surfaces as `http_status` with
 *      the prior cache unchanged, R12.3). A non-upstream failure (e.g. a DB
 *      error during apply) records `invalid_response` — the run could not
 *      produce a valid, applied result.
 *
 * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 6.1, 6.2, 6.3, 6.4, 6.5, 8.1,
 *            8.3, 8.4, 12.3, 12.4, 12.5
 */

import { randomUUID } from 'node:crypto';

import type { ExperienceCategory } from '@dwt/shared';

import type { RedisClient } from '../../redis/client.js';
import { assignInternalId } from './disney/bridge.js';
import { classifyFacility } from './disney/classifyFacility.js';
import { resolveArea } from './disney/area.js';
import { extractEnrichment } from './disney/enrich.js';
import {
  EXPERIENCE_ELIGIBLE_TYPES,
  RESORT_TYPE,
  adaptFacilityDocument,
  deriveEnterpriseId,
  type FacilityDocument,
} from './disney/facilityDoc.js';
import {
  FACILITIES_CHANNEL,
  type ChannelChange,
  type FacilitiesClient,
} from './disney/facilitiesClient.js';
import { selectImageUrl } from './disney/imagery.js';
import { resolveLand } from './disney/land.js';
import { resolveResortArea } from './disney/resortArea.js';
import type {
  DocumentStore,
  StoredFacilityDocument,
} from './documentStore.js';
import { outcomeFromError } from './outcome.js';
import { reconcileCatalog } from './reconcile.js';
import type { CatalogRepo, SyncRunOutcome } from './repo.js';
import { UpstreamError } from './themeparks.js';
import type {
  UpstreamExperience,
  UpstreamResort,
} from './types.js';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Redis key for the cluster-wide sync coordination lock. */
export const CATALOG_SYNC_LOCK_KEY = 'catalog:sync:lock';

/**
 * Default TTL for the sync coordination lock.
 *
 * 10 minutes (600000 ms) is the maximum lifetime of the lock. A healthy run
 * completes well inside this window; the TTL exists so that a crashed worker
 * eventually releases the lock without operator intervention.
 */
export const CATALOG_SYNC_LOCK_TTL_MS = 10 * 60 * 1000;

/** The Facility_Type of a restaurant, whose menus are fetched best-effort (R8.1). */
const RESTAURANT_TYPE = 'restaurant';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * What triggered a `runSync` invocation. Only a `'scheduled'` run is subject to
 * the freshness guard (R9.2): the BullMQ scheduler fires on a fixed cadence, so
 * a tick that lands while the cache is still fresh is a no-op. An `'on_read'`
 * run is the opportunistic refresh from `decideCatalogRead` — it only ever runs
 * *because* the cache age already exceeded the freshness interval (R9.3), so it
 * must never be short-circuited by the guard. A `'manual'` run (the one-off
 * `npm run sync` script / an operator trigger) likewise always proceeds.
 */
export type SyncTrigger = 'scheduled' | 'on_read' | 'manual';

/**
 * Options accepted by `runSync`. Every dependency is injectable so unit tests
 * can drive the orchestrator with fakes; production callers leave everything at
 * the default and the function wires itself up against the shared pool / Redis
 * client / config-driven Facilities_Client.
 */
export interface RunSyncOptions {
  /** Disney Facilities_Client. Defaults to one built with the global config. */
  readonly client?: FacilitiesClient;
  /** Catalog repo. Defaults to one built against the singleton DB pool. */
  readonly repo?: CatalogRepo;
  /**
   * Durable Document_Store holding the fetched Facility_Documents and the
   * Changes_Checkpoint. Defaults to one built against the singleton DB pool.
   * Injected so unit tests can drive the Bootstrap_Sync / Delta_Sync decision
   * and the atomic checkpoint persistence with an in-memory fake.
   */
  readonly documentStore?: DocumentStore;
  /** Redis client used for the coordination lock. Defaults to the singleton. */
  readonly redis?: RedisClient;
  /** Override the lock TTL. Production callers should leave this at the default. */
  readonly lockTtlMs?: number;
  /** Override the wall clock used for `started_at` / `finished_at`. */
  readonly now?: () => Date;
  /**
   * What triggered this run. Defaults to `'manual'` so existing callers (the
   * one-off script, the on-read opportunistic path) proceed unconditionally.
   * Pass `'scheduled'` from the BullMQ worker so the run is subject to the
   * freshness guard (R9.2).
   */
  readonly trigger?: SyncTrigger;
  /**
   * Freshness interval (ms) used by the scheduled-run guard. A scheduled run is
   * a no-op while the most recent successful sync completed within this window
   * (R9.2). Defaults to the configured `disney.syncIntervalMs` (≥24h). Only
   * consulted for a `'scheduled'` trigger.
   */
  readonly freshnessIntervalMs?: number;
}

/** Outcome reported by `runSync`. */
export type RunSyncResult = RunSyncSuccess | RunSyncFailure | RunSyncSkipped;

export interface RunSyncSuccess {
  readonly status: 'success';
  readonly runId: string;
  /** Number of upstream entities accepted into the upstream set (Experiences + Resorts). */
  readonly entitiesProcessed: number;
  /** Number of Experience rows the diff upserted. */
  readonly upserts: number;
  /** Number of Experience rows the diff soft-deleted. */
  readonly softDeletes: number;
  /** Number of Resort rows the diff upserted. */
  readonly resortUpserts: number;
  /** Number of Resort rows the diff soft-deleted. */
  readonly resortSoftDeletes: number;
  /** Number of restaurants whose menus were persisted this run. */
  readonly menusWritten: number;
}

export interface RunSyncFailure {
  readonly status: 'failed';
  readonly runId: string;
  /** Discriminator for the failure mode for log/metric routing. */
  readonly reason: 'upstream' | 'unknown';
  /** Run-outcome discriminator recorded in `catalog_sync_runs.outcome` (R12.5). */
  readonly outcome: SyncRunOutcome;
  /** Original error preserved for the caller to log. */
  readonly error: unknown;
}

export interface RunSyncSkipped {
  readonly status: 'skipped';
  /**
   * Why the run did not proceed:
   *   - `'lock_held'` — another sync holds the `catalog:sync:lock` (R11.1);
   *   - `'fresh'`     — a scheduled run found the cache still within the
   *                     freshness interval, so it was a no-op (R9.2).
   */
  readonly reason: 'lock_held' | 'fresh';
}

/**
 * Drive one full Catalog_Sync pass.
 *
 * The function is safe to call concurrently; redundant callers race for the
 * Redis lock and the loser receives `{ status: 'skipped' }`.
 */
export async function runSync(
  options: RunSyncOptions = {},
): Promise<RunSyncResult> {
  const redis = options.redis ?? (await loadDefaultRedis());
  const repo = options.repo ?? (await loadDefaultRepo());
  const now = options.now ?? (() => new Date());
  const trigger = options.trigger ?? 'manual';

  // ---- 0. Freshness guard for scheduled runs (R9.2) ----------------------
  // Only a scheduled invocation is subject to the guard. An on-read
  // opportunistic refresh (R9.3) fires *because* the cache already exceeded the
  // freshness interval, and a manual/operator trigger is always intentional —
  // both bypass the guard. A scheduled tick that lands while the most recent
  // successful sync is still within the freshness interval is a no-op, so
  // low-change-rate static data imposes minimal load on the fragile source.
  // Checked before any expensive setup (document store / Facilities_Client /
  // lock) so a fresh no-op is cheap.
  if (trigger === 'scheduled') {
    const freshnessIntervalMs =
      options.freshnessIntervalMs ?? (await loadDefaultSyncIntervalMs());
    const { lastSuccessfulSyncAt } = await repo.getCacheAge(now());
    if (isWithinFreshness(lastSuccessfulSyncAt, now(), freshnessIntervalMs)) {
      return { status: 'skipped', reason: 'fresh' };
    }
  }

  const documentStore =
    options.documentStore ?? (await loadDefaultDocumentStore());
  const client = options.client ?? (await loadDefaultClient());
  const lockTtlMs = options.lockTtlMs ?? CATALOG_SYNC_LOCK_TTL_MS;

  // ---- 1. Acquire the cluster-wide sync lock -----------------------------
  const lockToken = randomUUID();
  const acquired = await acquireLock(redis, lockToken, lockTtlMs);
  if (!acquired) {
    return { status: 'skipped', reason: 'lock_held' };
  }

  try {
    return await runSyncWithLock(client, repo, documentStore, now);
  } finally {
    // Best-effort release. If Redis is unreachable here, the TTL will expire
    // the lock; we never throw out of `finally`.
    try {
      await releaseLock(redis, lockToken);
    } catch {
      // Intentional: lock release is a hygiene operation. Failures are
      // recoverable via TTL and would only obscure the sync result.
    }
  }
}

// ---------------------------------------------------------------------------
// Freshness guard (pure, R9.2)
// ---------------------------------------------------------------------------

/**
 * Whether the most recent successful sync is still within the freshness
 * interval — the pure comparison behind the scheduled-run guard (R9.2) and the
 * seam Property 11 (task 10.2) targets.
 *
 * Returns `true` (the cache is fresh, so a scheduled run should be skipped) iff
 * a prior successful sync exists AND its age is at most `intervalMs`. This is
 * the exact complement of the on-read refresh trigger, which fires when the
 * cache age *exceeds* the interval (R9.3): a run at exactly `intervalMs` old is
 * still fresh (the boundary is strictly-greater-than, matching the read path's
 * staleness boundary). A `null` `lastSuccessfulSyncAt` (no successful sync yet)
 * is never fresh, so a first-ever scheduled run always proceeds.
 *
 * Total and side-effect-free: a negative age (writer/reader clock skew, i.e. a
 * "future" last-sync timestamp) is treated as fresh, since a sync that appears
 * to have completed in the future has certainly completed within the interval.
 */
export function isWithinFreshness(
  lastSuccessfulSyncAt: Date | null,
  now: Date,
  intervalMs: number,
): boolean {
  if (lastSuccessfulSyncAt === null) {
    return false;
  }
  const ageMs = now.getTime() - lastSuccessfulSyncAt.getTime();
  return ageMs <= intervalMs;
}

/**
 * Inner orchestration body. Separated from the lock dance so the lock's
 * try/finally is unambiguous.
 */
async function runSyncWithLock(
  client: FacilitiesClient,
  repo: CatalogRepo,
  documentStore: DocumentStore,
  now: () => Date,
): Promise<RunSyncSuccess | RunSyncFailure> {
  const startedAt = now();
  let entitiesProcessed = 0;

  try {
    // ---- 2. Read the checkpoint + decide the sync mode (R6.1, R6.2) ------
    // Absent checkpoint ⇒ Bootstrap_Sync (full enumeration, no `since`);
    // present ⇒ Delta_Sync (enumerate `_changes?since=<checkpoint>`). The pure
    // `decideSyncMode` seam makes this decision property-testable (task 8.4).
    const checkpoint = await documentStore.getCheckpoint();
    const { since } = decideSyncMode(checkpoint);

    // ---- 3. Enumerate the Facilities_Channel (R6.2, R6.4, R7.3) ----------
    // `listChannelDocumentIds` returns the per-document change records (each
    // carrying a tombstone flag) plus the enumeration's `last_seq`. The pure
    // `partitionChanges` seam splits the feed into the non-deleted changed ids
    // to fetch and the deleted ids to tombstone (task 8.5).
    const { changes, lastSeq } = await client.listChannelDocumentIds(
      FACILITIES_CHANNEL,
      since,
    );
    const { changedIds, deletedIds } = partitionChanges(changes);

    // ---- 4. Fetch only the non-deleted changed documents (R6.4, R6.6) ----
    // A Delta_Sync fetches exactly the changed ids; a Bootstrap_Sync fetches
    // every live id. Both are paced within the Request_Budget by the transport.
    const fetched = await client.bulkGetDocuments(changedIds);
    const upserts: readonly StoredFacilityDocument[] = fetched.map((doc) => ({
      enterpriseId: doc.id,
      body: doc,
      deleted: false,
      changeSeq: lastSeq,
    }));

    // ---- 5. Persist the delta + checkpoint atomically (R6.3, R6.5, R7.5) -
    // `applyDelta` writes the document upserts, the tombstones, and the new
    // checkpoint in ONE transaction, so a failure anywhere before this leaves
    // the prior checkpoint and stored documents intact (the run resumes from
    // the last good sequence).
    //
    // The `_changes` feed keys documents by the raw Couchbase `_id` (a
    // channel-prefixed form such as
    // `wdw.facilities.1_0.en_us.restaurant.412260665;entityType=restaurant`),
    // so `changedIds` are fetched verbatim above. The Document_Store, however,
    // is keyed by the clean Enterprise_Id (the normalized `doc.id` used for the
    // upserts). Normalize each deleted id to that same clean Enterprise_Id so a
    // tombstone matches the row it should remove; an id carrying no
    // Enterprise_Id token falls back to its raw value (a harmless no-op key).
    const deletes = deletedIds.map((id) => deriveEnterpriseId(id) ?? id);
    await documentStore.applyDelta({ upserts, deletes, lastSeq });

    // ---- 6. Reconcile from the Document_Store, not a re-enumeration (R7.4) 
    // The upstream entity set is the store's active (non-tombstoned) documents;
    // each raw stored document is adapted into the shape the pure transformation
    // cores expect (lowercase `type`, synthesized `ancestors`, numeric coords,
    // grouped `facets`), then normalization drops blank-name documents (R3.7).
    const upstreamDocs = await documentStore.getActiveDocuments();
    const normalized = upstreamDocs
      .map((doc) => adaptFacilityDocument(doc as unknown as Record<string, unknown>))
      .filter(isIncludedDocument)
      // Drop park-reservation / park-pass placeholders that Disney types as
      // `Attraction` — they would otherwise become bogus "Ride" catalog cards.
      .filter((doc) => !isPlaceholderDocument(doc))
      // Drop Cast-Member-only "Working Cast Dining" restaurant variants — they
      // are back-of-house locations no guest can visit.
      .filter((doc) => !isWorkingCastDocument(doc));

    // ---- 7. Bridge map for identity continuity (R10.1, R10.3, R10.4) -----
    const bridge = await repo.getBridgeMap();

    // ---- 8. Split + transform (R4, R5, R6, R7) ---------------------------
    // NOTE: no per-restaurant menu fetch happens here — menus are demand-driven
    // now (R8.1 / R10.4). The sync issues no Menu_Service requests.
    const { experiences, resorts } = buildUpstreamCatalog(normalized, bridge);
    entitiesProcessed = experiences.length + resorts.length;

    // ---- 9. Reconcile + transactional apply (R11.6, R11.7) ---------------
    const snapshot = {
      experiences: await repo.getCacheSnapshot(),
      resorts: await repo.getResortSnapshot(),
    };
    const diff = reconcileCatalog(snapshot, { experiences, resorts });
    await repo.applyReconciliation(diff);

    // ---- 10. Record success (R12.6) --------------------------------------
    const finishedAt = now();
    const run = await repo.recordSyncRun({
      status: 'success',
      outcome: 'success',
      startedAt,
      finishedAt,
      entitiesProcessed,
    });

    return {
      status: 'success',
      runId: run.id,
      entitiesProcessed,
      upserts: diff.experiences.upserts.length,
      softDeletes: diff.experiences.softDeletes.length,
      resortUpserts: diff.resorts.upserts.length,
      resortSoftDeletes: diff.resorts.softDeletes.length,
      // Menus are no longer written during sync (lazy retrieval, R8.1).
      menusWritten: 0,
    };
  } catch (err) {
    // ---- 11. Record failure (R6.5, R12.1, R12.4, R12.5, R12.6) -----------
    // The checkpoint and cache are intentionally left unchanged: `applyDelta`
    // only persists the new checkpoint on a successful enumeration+fetch, and
    // `applyReconciliation` runs its diff transactionally, so an un-applied
    // diff was rolled back. A Disney WAF block or credential rejection surfaces
    // here classified into `waf_block` / `auth_failure`, so the prior cache is
    // preserved and served slightly stale (R12.1).
    const finishedAt = now();
    const outcome = outcomeFromError(err);
    const reason: RunSyncFailure['reason'] =
      err instanceof UpstreamError ? 'upstream' : 'unknown';

    const errorClass = err instanceof Error ? err.name : 'NonError';
    const errorMessage =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'unknown error';

    let runId = '';
    try {
      const run = await repo.recordSyncRun({
        status: 'failed',
        outcome,
        startedAt,
        finishedAt,
        errorClass,
        errorMessage,
        entitiesProcessed,
      });
      runId = run.id;
    } catch {
      // If we cannot even record the failure (DB outage), surface the original
      // cause rather than the secondary failure. `runId` stays empty so callers
      // can detect the partial failure.
    }

    return { status: 'failed', runId, reason, outcome, error: err };
  }
}

// ---------------------------------------------------------------------------
// Sync-mode decision + delta fetch set (pure, R6.1, R6.2, R6.4, R7.3)
// ---------------------------------------------------------------------------

/**
 * The Bootstrap_Sync / Delta_Sync decision derived from the persisted
 * Changes_Checkpoint. `since === undefined` drives a full channel enumeration
 * (Bootstrap_Sync, R6.1); a defined `since` drives an incremental enumeration
 * whose `_changes?since=` equals the stored checkpoint (Delta_Sync, R6.2).
 */
export interface SyncModeDecision {
  readonly mode: 'bootstrap' | 'delta';
  /**
   * The `since` sequence to enumerate from: `undefined` for a Bootstrap_Sync
   * (no `since`, full enumeration), the stored checkpoint for a Delta_Sync.
   */
  readonly since: string | undefined;
}

/**
 * Decide the sync mode from the persisted checkpoint (pure, total).
 *
 * A `null` checkpoint (first boot, R6.1) ⇒ `Bootstrap_Sync` with no `since`; a
 * present checkpoint (R6.2) ⇒ `Delta_Sync` whose `since` is exactly that
 * checkpoint. This is the seam Property 6 (task 8.4) targets.
 */
export function decideSyncMode(checkpoint: string | null): SyncModeDecision {
  if (checkpoint === null) {
    return { mode: 'bootstrap', since: undefined };
  }
  return { mode: 'delta', since: checkpoint };
}

/** The changed (to fetch) and deleted (to tombstone) id sets of a `_changes` feed. */
export interface PartitionedChanges {
  /** Non-deleted changed ids — exactly the set fetched via `_bulk_get` (R6.4). */
  readonly changedIds: readonly string[];
  /** Deleted/tombstoned ids — propagated to the Document_Store (R7.3). */
  readonly deletedIds: readonly string[];
}

/**
 * Partition a `_changes` feed into the non-deleted changed ids (to fetch) and
 * the deleted ids (to tombstone) — pure and total (task 8.5 / Property 7).
 *
 * The `changedIds` are exactly the ids whose change is not a tombstone, so an
 * unchanged document (absent from the feed) is never fetched, and a tombstoned
 * document is never fetched but is propagated as a delete.
 */
export function partitionChanges(
  changes: readonly ChannelChange[],
): PartitionedChanges {
  const changedIds: string[] = [];
  const deletedIds: string[] = [];
  for (const change of changes) {
    if (change.deleted) {
      deletedIds.push(change.id);
    } else {
      changedIds.push(change.id);
    }
  }
  return { changedIds, deletedIds };
}

// ---------------------------------------------------------------------------
// Normalization (R3.4, R3.7)
// ---------------------------------------------------------------------------

/**
 * Whether a Facility_Document survives normalization into the upstream entity
 * set. A tombstone (`softDeleted === true`, R3.4) or a document with no `name`
 * / a whitespace-only `name` (R3.7) is excluded; every other document is kept
 * regardless of its type (the type split happens downstream).
 */
export function isIncludedDocument(doc: FacilityDocument): boolean {
  if (doc.softDeleted === true) {
    return false;
  }
  if (doc.name === undefined || doc.name.trim().length === 0) {
    return false;
  }
  return true;
}

/**
 * Names of Disney park-reservation / park-pass placeholder documents that must
 * never surface as catalog Experiences.
 *
 * Walt Disney World publishes its park-reservation and park-pass system as
 * `Attraction`-typed Facility_Documents (one per park, plus cast variants) —
 * e.g. `"Theme Park Reservation"` (one per theme park) and
 * `"Disney Park Pass - Cast Afternoon"`. They carry no description, imagery, or
 * real location, and are not something a guest visits, yet their
 * `attraction` type makes `classifyFacility` map them to `Ride`, so dozens of
 * identical bogus "Ride" cards leak into the catalogue.
 *
 * These are not distinguishable by Facility_Type (which is the only signal the
 * type-based split and `classifyFacility` use), so they are excluded here by
 * name. The pattern is anchored at the start and matched case-insensitively
 * against the trimmed name so future `"Disney Park Pass - …"` variants are
 * caught too. No real attraction name begins with either phrase.
 */
const PLACEHOLDER_NAME_PATTERN =
  /^(?:theme park reservation|disney park pass)\b/i;

/**
 * Whether a Facility_Document is a park-reservation / park-pass placeholder
 * identified by its {@link PLACEHOLDER_NAME_PATTERN name} rather than its
 * Facility_Type. Pure and total; kept separate from {@link isIncludedDocument}
 * (whose R3.4/R3.7 contract stays intact) so this data-quality exclusion is
 * independently testable.
 */
export function isPlaceholderDocument(doc: FacilityDocument): boolean {
  return (
    doc.name !== undefined && PLACEHOLDER_NAME_PATTERN.test(doc.name.trim())
  );
}

/**
 * Names of Cast-Member-only dining locations that must never surface as guest
 * catalog Experiences.
 *
 * Walt Disney World publishes a Cast-Member ("working cast") variant of many
 * quick-service restaurants as its own `restaurant`-typed Facility_Document —
 * the guest-facing venue name with a `" - Working Cast Dining"` suffix (e.g.
 * `"Backlot Express - Working Cast Dining"`, `"Satu'li Canteen - Working Cast
 * Dining"`). These are back-of-house locations only Cast Members can visit, so
 * they should not appear in a guest catalog, yet their `restaurant` type makes
 * `classifyFacility` map them to `Restaurant` alongside the real venues.
 *
 * Like the park-pass placeholders, they are not distinguishable by
 * Facility_Type, so they are excluded here by name. The pattern matches the
 * `"Working Cast Dining"` marker case-insensitively anywhere in the trimmed
 * name; no guest-facing venue carries this phrase.
 */
const WORKING_CAST_NAME_PATTERN = /working cast dining/i;

/**
 * Whether a Facility_Document is a Cast-Member-only "working cast" dining
 * location identified by its {@link WORKING_CAST_NAME_PATTERN name} rather than
 * its Facility_Type. Pure and total; kept separate from
 * {@link isIncludedDocument} so this data-quality exclusion is independently
 * testable.
 */
export function isWorkingCastDocument(doc: FacilityDocument): boolean {
  return (
    doc.name !== undefined && WORKING_CAST_NAME_PATTERN.test(doc.name.trim())
  );
}

// ---------------------------------------------------------------------------
// Split + transform (R4, R5, R6, R7)
// ---------------------------------------------------------------------------

/** A restaurant Experience and the Enterprise_Id its menus are fetched by. */
interface RestaurantRef {
  readonly experienceId: string;
  readonly enterpriseId: string;
}

/** The result of splitting the normalized documents into the upstream catalog. */
interface UpstreamCatalogBuild {
  readonly experiences: readonly UpstreamExperience[];
  readonly resorts: readonly UpstreamResort[];
  readonly restaurantRefs: readonly RestaurantRef[];
}

/**
 * Split the normalized Facility_Documents into the upstream Experience and
 * Resort sets, resolving each item's Internal_Id via the Bridge_Map and
 * running the pure transformation cores.
 *
 * A `resort` document produces exactly one Resort record (R6.1); the structural
 * `resort-area` type is not `resort` and so is never produced as a Resort
 * (R6.2). An `Experience_Eligible_Type` produces one Experience once
 * `classifyFacility` yields a category (R4). Every other type is dropped.
 */
function buildUpstreamCatalog(
  documents: readonly FacilityDocument[],
  bridge: ReadonlyMap<string, string>,
): UpstreamCatalogBuild {
  const experiences: UpstreamExperience[] = [];
  const resorts: UpstreamResort[] = [];
  const restaurantRefs: RestaurantRef[] = [];

  for (const doc of documents) {
    const type = doc.type;

    if (type === RESORT_TYPE) {
      resorts.push(toUpstreamResort(doc, bridge));
      continue;
    }

    if (type !== undefined && EXPERIENCE_ELIGIBLE_TYPES.has(type)) {
      const category = classifyFacility(doc);
      if (category === null) {
        // Defensive: an eligible type always classifies, but never emit an
        // Experience without a category.
        continue;
      }
      const experience = toUpstreamExperience(doc, category, bridge);
      experiences.push(experience);
      if (type === RESTAURANT_TYPE) {
        restaurantRefs.push({
          experienceId: experience.id,
          enterpriseId: doc.id,
        });
      }
      continue;
    }

    // Non_Experience_Type (other than `resort`), absent, or unrecognized type
    // -> dropped from both sets.
  }

  return { experiences, resorts, restaurantRefs };
}

/**
 * Build a single `UpstreamExperience` from a classified Facility_Document.
 *
 * The Internal_Id is bridged for continuity (R10.3) else derived (R10.1); the
 * owning Area/Area_Type comes from `resolveArea` (R4.11–R4.15) with a
 * `Resort`-area's specific resort resolved to its Internal_Id via the same
 * Bridge_Map (R4.14); enrichment (R5) and imagery (R7) come from their pure
 * cores. `description` is carried raw — reconcile sanitizes it (R11.8).
 */
function toUpstreamExperience(
  doc: FacilityDocument,
  category: ExperienceCategory,
  bridge: ReadonlyMap<string, string>,
): UpstreamExperience {
  const area = resolveArea(doc);
  const enrichment = extractEnrichment(doc);

  // A `Resort`-area Experience references its owning resort's Internal_Id,
  // derived from the resort ancestor's Enterprise_Id the same way as any other
  // catalog id (R4.14). The catch-all resort area (no specific resort) and all
  // non-`Resort` areas carry no resort reference.
  const resortId =
    area.areaType === 'Resort' && area.resortEnterpriseId !== undefined
      ? assignInternalId(area.resortEnterpriseId, bridge)
      : null;

  return {
    id: assignInternalId(doc.id, bridge),
    upstreamEntityId: doc.id,
    // `name` is guaranteed present + non-blank by normalization (R3.7).
    name: (doc.name as string).trim(),
    park: area.park ?? null,
    category,
    description: doc.description ?? '',
    imageUrl: selectImageUrl(doc),
    areaType: area.areaType,
    land: resolveLand(doc, area),
    resortArea: resolveResortArea(doc, area),
    resortId,
    latitude: enrichment.latitude,
    longitude: enrichment.longitude,
    accessibility: enrichment.accessibility,
    priceTier: enrichment.priceTier,
    mealPeriods: enrichment.mealPeriods,
  };
}

/**
 * Build a single `UpstreamResort` from a `resort` Facility_Document (R6.1).
 *
 * Every descriptive field is copied from the document (R6.3); an omitted
 * `description`, `latitude`, `longitude`, `address`, or `phone` becomes `null`
 * per-field (R6.4). Unlike Experience coordinates (R5.2, which null both when
 * either is missing), a Resort keeps whichever coordinate is present. Imagery
 * follows the shared precedence via `selectImageUrl` (R6.5). The Internal_Id is
 * bridged for continuity else derived (R6.6, R10).
 */
function toUpstreamResort(
  doc: FacilityDocument,
  bridge: ReadonlyMap<string, string>,
): UpstreamResort {
  return {
    id: assignInternalId(doc.id, bridge),
    upstreamEntityId: doc.id,
    name: (doc.name as string).trim(),
    description: doc.description ?? null,
    imageUrl: selectImageUrl(doc),
    latitude: Number.isFinite(doc.latitude) ? (doc.latitude as number) : null,
    longitude: Number.isFinite(doc.longitude)
      ? (doc.longitude as number)
      : null,
    address: doc.address ?? null,
    phone: doc.phone ?? null,
  };
}

// ---------------------------------------------------------------------------
// Default-dependency lazy loaders
// ---------------------------------------------------------------------------
//
// The orchestrator imports its production dependencies lazily so that unit
// tests injecting fakes through `RunSyncOptions` never trigger a load of the
// real `pg` / `ioredis` / config modules. This keeps the test environment
// hermetic and matches the pattern `repo.ts` uses with type-only imports.

async function loadDefaultRedis(): Promise<RedisClient> {
  const mod = await import('../../redis/client.js');
  return mod.getRedisClient();
}

async function loadDefaultRepo(): Promise<CatalogRepo> {
  const [poolMod, repoMod] = await Promise.all([
    import('../../db/pool.js'),
    import('./repo.js'),
  ]);
  return repoMod.createCatalogRepo(poolMod.getPool());
}

async function loadDefaultDocumentStore(): Promise<DocumentStore> {
  const [poolMod, storeMod] = await Promise.all([
    import('../../db/pool.js'),
    import('./documentStore.js'),
  ]);
  return storeMod.createDocumentStore(poolMod.getPool());
}

/**
 * Resolve the freshness interval for the scheduled-run guard from the global
 * config (`disney.syncIntervalMs`, ≥24h). Loaded lazily so unit tests that pass
 * an explicit `freshnessIntervalMs` never trigger a real config parse.
 */
async function loadDefaultSyncIntervalMs(): Promise<number> {
  const configMod = await import('../../config.js');
  return configMod.loadConfig().disney.syncIntervalMs;
}

async function loadDefaultClient(): Promise<FacilitiesClient> {
  const [configMod, clientMod, transportMod, limiterMod] = await Promise.all([
    import('../../config.js'),
    import('./disney/facilitiesClient.js'),
    import('./disney/transport.js'),
    import('./disney/rateLimiter.js'),
  ]);
  const config = configMod.loadConfig();
  // Build the shared Disney_Transport with an in-process Rate_Limiter so all
  // Disney HTTP is paced and retried in one place (task 6.1). The composition
  // root wires the authoritative (Redis-backed) limiter in task 13.6; this
  // default keeps standalone/script invocations self-contained.
  const limiter = limiterMod.createInProcessRateLimiter(config.disney.requestBudget);
  const transport = transportMod.createDisneyTransport({
    limiter,
    backoff: config.disney.backoff,
  });
  return clientMod.createFacilitiesClient({
    transport,
    baseUrl: config.disney.syncGateway.baseUrl,
    credentials: config.disney.credentials,
  });
}

// ---------------------------------------------------------------------------
// Redis lock helpers
// ---------------------------------------------------------------------------

/**
 * Try to acquire the sync lock. Returns `true` iff this call won the race.
 *
 * Uses `SET key value NX PX <ttl>` which is the canonical Redis lock primitive:
 * atomic, expiring, and only succeeds when the key is unset.
 */
async function acquireLock(
  redis: RedisClient,
  token: string,
  ttlMs: number,
): Promise<boolean> {
  const result = await redis.set(
    CATALOG_SYNC_LOCK_KEY,
    token,
    'PX',
    ttlMs,
    'NX',
  );
  return result === 'OK';
}

/**
 * Release the lock iff the stored token matches `token`. Implemented with a
 * small Lua script to keep the read-then-delete atomic; without this, an
 * over-running worker could delete a lock issued to a successor after the TTL
 * elapsed.
 */
async function releaseLock(
  redis: RedisClient,
  token: string,
): Promise<void> {
  const script =
    'if redis.call("get", KEYS[1]) == ARGV[1] then ' +
    'return redis.call("del", KEYS[1]) ' +
    'else return 0 end';
  await redis.eval(script, 1, CATALOG_SYNC_LOCK_KEY, token);
}

// Re-export the internal seam the test suite drives without re-implementing.
export const __internal = {
  buildUpstreamCatalog,
  decideSyncMode,
  isIncludedDocument,
  isPlaceholderDocument,
  isWorkingCastDocument,
  isWithinFreshness,
  outcomeFromError,
  partitionChanges,
  toUpstreamExperience,
  toUpstreamResort,
};
