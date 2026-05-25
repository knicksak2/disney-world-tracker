/**
 * Catalog_Sync orchestrator.
 *
 * `runSync(options)` is the single entry point that drives one full
 * synchronization pass against the ThemeParks.wiki API, reconciles the
 * result against the local cache, and records the outcome in
 * `catalog_sync_runs` / `catalog_cache_metadata`.
 *
 * The orchestrator is the meeting point of the pure functions implemented
 * earlier in Wave 5 — `classify` (task 4.1), `reconcile` (task 4.2),
 * `internalId` (task 4.3) — the typed upstream HTTP client (task 9.1),
 * the catalog repo (task 9.2), and the Redis coordination lock. It is
 * deliberately the only place where those pieces are wired together so
 * that the BullMQ scheduler (task 9.5) and the opportunistic 5-second
 * race on read (task 9.4) can both call it without duplicating logic.
 *
 * Behavior, anchored to the design and requirements:
 *
 *   1. **Single in-flight sync per cluster (R1.10).** A Redis `SET ... NX PX`
 *      against `catalog:sync:lock` with a 10-minute TTL guards every run.
 *      A concurrent caller (e.g., the scheduled job firing while an
 *      opportunistic on-read sync is still running) gets back
 *      `{ status: 'skipped', reason: 'lock_held' }` and proceeds with the
 *      existing cache. The 10-minute TTL is a hard ceiling on lock
 *      lifetime so a crashed worker cannot wedge syncs forever; a healthy
 *      run completes in seconds and releases the lock explicitly.
 *
 *   2. **Atomic lock release.** Release uses a small Lua script that only
 *      DELs the key when the stored token matches our token. This avoids
 *      the classic "lock TTL elapsed, key was reissued by another worker,
 *      I delete their lock on my way out" race.
 *
 *   3. **Upstream walk (R1.1, R1.2).** We resolve the Walt Disney World
 *      Resort destination from `/destinations`, build a `parkId -> Park`
 *      map from its `parks` array, then call `/entity/{wdwId}/children`
 *      to fetch the entire entity tree. For every entity whose
 *      `entityType` is in the include set `{ATTRACTION, SHOW, RESTAURANT}`,
 *      we walk the `parentId` chain up to a known park root and emit
 *      one `UpstreamExperience` per resolution. Entities outside the
 *      include set, and entities whose parent chain does not land in a
 *      known park, are dropped from the upstream set; `reconcile` will
 *      soft-delete any such row that previously existed in the cache
 *      (R1.15).
 *
 *   4. **Transactional cache write (R1.14, R1.15, R1.16).** The diff
 *      produced by `reconcile` is applied via `repo.applyReconciliation`,
 *      which runs every upsert and soft-delete inside a single Postgres
 *      transaction — a partial failure rolls back to leave the cache
 *      untouched. The success run row is then recorded in its own
 *      transaction together with the metadata pointer update so an
 *      observer can never see a `last_successful_sync_at` that points to
 *      a missing run row.
 *
 *   5. **Failure handling (R1.13).** Any thrown error during the upstream
 *      walk, classification, reconcile, or apply phase is caught,
 *      translated into a `failed` row in `catalog_sync_runs`, and the
 *      cache is left unchanged. The metadata pointer is not updated, so
 *      the read path's cache age continues to count from the previous
 *      successful sync.
 *
 * Validates: Requirements 1.10, 1.13, 1.14, 1.15, 1.16
 */

import { randomUUID } from 'node:crypto';

import type { ExperienceCategory, Park } from '@dwt/shared';

import type { RedisClient } from '../../redis/client.js';
import { classify } from './classify.js';
import { internalId } from './internalId.js';
import { reconcile } from './reconcile.js';
import type { CatalogRepo } from './repo.js';
import {
  UpstreamError,
  type ThemeParksClient,
  type ThemeParksDestinationEntry,
  type ThemeParksDestinationParkEntry,
  type ThemeParksEntityChild,
} from './themeparks.js';
import type { UpstreamExperience } from './types.js';

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/** Redis key for the cluster-wide sync coordination lock. */
export const CATALOG_SYNC_LOCK_KEY = 'catalog:sync:lock';

/**
 * Default TTL for the sync coordination lock.
 *
 * Per the task brief, 10 minutes (600 seconds = 600000 ms) is the
 * maximum lifetime of the lock. A healthy run completes well inside
 * this window; the TTL exists so that a crashed worker eventually
 * releases the lock without operator intervention.
 */
export const CATALOG_SYNC_LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Upstream `entityType` values that map to an Experience per the design's
 * mapping table (R1.2). Every other entityType is excluded from the
 * Experience set — `classify` handles them as `Other` defensively, but
 * the orchestrator never feeds them to `reconcile` because they would
 * never be associated with a Park root and would soft-delete spuriously.
 */
const INCLUDE_SET: ReadonlySet<string> = new Set([
  'ATTRACTION',
  'SHOW',
  'RESTAURANT',
]);

/**
 * Match a Walt Disney World destination by name or slug. The TP wiki API
 * has historically returned this as `"Walt Disney World Resort"` with
 * slug `"waltdisneyworldresort"`; we accept either signal so a small
 * upstream rename does not break the sync.
 */
const WDW_NAME_PATTERN = /walt\s*disney\s*world/i;
const WDW_SLUG_PATTERN = /waltdisneyworld/i;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Options accepted by `runSync`. Every dependency is injectable so unit
 * tests can drive the orchestrator with fakes; production callers leave
 * everything at the default and the function wires itself up against the
 * shared pool / Redis client / config-driven HTTP client.
 */
export interface RunSyncOptions {
  /** ThemeParks.wiki HTTP client. Defaults to one built with the global config. */
  readonly client?: ThemeParksClient;
  /** Catalog repo. Defaults to one built against the singleton DB pool. */
  readonly repo?: CatalogRepo;
  /** Redis client used for the coordination lock. Defaults to the singleton. */
  readonly redis?: RedisClient;
  /** Override the lock TTL. Production callers should leave this at the default. */
  readonly lockTtlMs?: number;
  /** Override the wall clock used for `started_at` / `finished_at`. */
  readonly now?: () => Date;
}

/** Outcome reported by `runSync`. */
export type RunSyncResult =
  | RunSyncSuccess
  | RunSyncFailure
  | RunSyncSkipped;

export interface RunSyncSuccess {
  readonly status: 'success';
  readonly runId: string;
  /** Number of upstream entities accepted into the upstream set. */
  readonly entitiesProcessed: number;
  /** Number of rows the diff upserted. */
  readonly upserts: number;
  /** Number of rows the diff soft-deleted. */
  readonly softDeletes: number;
}

export interface RunSyncFailure {
  readonly status: 'failed';
  readonly runId: string;
  /** Discriminator for the failure mode for log/metric routing. */
  readonly reason: 'upstream' | 'unknown';
  /** Original error preserved for the caller to log. */
  readonly error: unknown;
}

export interface RunSyncSkipped {
  readonly status: 'skipped';
  readonly reason: 'lock_held';
}

/**
 * Drive one full Catalog_Sync pass.
 *
 * The function is safe to call concurrently; redundant callers race for
 * the Redis lock and the loser receives `{ status: 'skipped' }`.
 */
export async function runSync(
  options: RunSyncOptions = {},
): Promise<RunSyncResult> {
  const redis = options.redis ?? (await loadDefaultRedis());
  const repo = options.repo ?? (await loadDefaultRepo());
  const client = options.client ?? (await loadDefaultClient());
  const lockTtlMs = options.lockTtlMs ?? CATALOG_SYNC_LOCK_TTL_MS;
  const now = options.now ?? (() => new Date());

  // ---- 1. Acquire the cluster-wide sync lock -----------------------------
  const lockToken = randomUUID();
  const acquired = await acquireLock(redis, lockToken, lockTtlMs);
  if (!acquired) {
    return { status: 'skipped', reason: 'lock_held' };
  }

  try {
    return await runSyncWithLock(client, repo, now);
  } finally {
    // Best-effort release. If Redis is unreachable here, the TTL will
    // expire the lock; we never throw out of `finally` because the
    // function's contract is to surface the sync outcome, not lock
    // hygiene.
    try {
      await releaseLock(redis, lockToken);
    } catch {
      // Intentional: lock release is a hygiene operation. Failures are
      // recoverable via TTL and would only obscure the sync result.
    }
  }
}

/**
 * Inner orchestration body. Separated from the lock dance so the lock's
 * try/finally is unambiguous.
 *
 * Note on `recordSyncRun` calls: success and failure each append a single
 * row to `catalog_sync_runs`. We do not write a `running` row at the start
 * because the design's read path keys off `last_successful_sync_at`, not
 * "is a run in progress?". A `running` row would only buy diagnostics, at
 * the cost of an extra round-trip on the happy path.
 */
async function runSyncWithLock(
  client: ThemeParksClient,
  repo: CatalogRepo,
  now: () => Date,
): Promise<RunSyncSuccess | RunSyncFailure> {
  const startedAt = now();
  let entitiesProcessed = 0;

  try {
    // ---- 2. Upstream walk -------------------------------------------------
    const destinations = await client.getDestinations();
    const wdw = findWdwDestination(destinations.destinations);
    const parkMap = buildParkMap(wdw);

    const childrenResp = await client.getEntityChildren(wdw.id);
    const entityMap = buildEntityMap(childrenResp.children);

    const upstreamSet = buildUpstreamSet(
      childrenResp.children,
      entityMap,
      parkMap,
    );
    entitiesProcessed = upstreamSet.length;

    // ---- 3. Reconcile + transactional apply ------------------------------
    const cache = await repo.getCacheSnapshot();
    const diff = reconcile(cache, upstreamSet);
    await repo.applyReconciliation(diff);

    // ---- 4. Record success ----------------------------------------------
    const finishedAt = now();
    const run = await repo.recordSyncRun({
      status: 'success',
      startedAt,
      finishedAt,
      entitiesProcessed,
    });

    return {
      status: 'success',
      runId: run.id,
      entitiesProcessed,
      upserts: diff.upserts.length,
      softDeletes: diff.softDeletes.length,
    };
  } catch (err) {
    // ---- 5. Record failure (R1.13) --------------------------------------
    // The cache is intentionally left unchanged: `applyReconciliation`
    // either ran to completion before the throw (in which case the
    // diff was applied transactionally) or threw before any write
    // landed. Both paths are consistent with R1.13's "retain the prior
    // cache contents unchanged" because applied diffs are durable and
    // un-applied diffs were rolled back by the repo's transaction.
    const finishedAt = now();
    const reason: RunSyncFailure['reason'] =
      err instanceof UpstreamError ? 'upstream' : 'unknown';

    const errorClass =
      err instanceof Error ? err.name : 'NonError';
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
        startedAt,
        finishedAt,
        errorClass,
        errorMessage,
        entitiesProcessed,
      });
      runId = run.id;
    } catch {
      // If we cannot even record the failure (DB outage), surface the
      // original cause rather than the secondary failure: the original
      // is the actionable signal for operators. `runId` stays empty so
      // callers can detect the partial failure.
    }

    return { status: 'failed', runId, reason, error: err };
  }
}

// ---------------------------------------------------------------------------
// Default-dependency lazy loaders
// ---------------------------------------------------------------------------
//
// The orchestrator imports its production dependencies (`getRedisClient`,
// `getPool`/`createCatalogRepo`, `createThemeParksClient`) lazily so that
// unit tests injecting fakes through `RunSyncOptions` never trigger a
// load of the real `pg` or `ioredis` modules. This keeps the test
// environment hermetic on machines where those packages are not present
// (CI sandboxes, locked-down workstations) and matches the pattern
// `repo.ts` uses with type-only imports of the pool.

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

async function loadDefaultClient(): Promise<ThemeParksClient> {
  const mod = await import('./themeparks.js');
  return mod.createThemeParksClient();
}

// ---------------------------------------------------------------------------
// Redis lock helpers
// ---------------------------------------------------------------------------

/**
 * Try to acquire the sync lock. Returns `true` iff this call won the race.
 *
 * Uses `SET key value NX PX <ttl>` which is the canonical Redis lock
 * primitive: atomic, expiring, and only succeeds when the key is unset.
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
 * Release the lock iff the stored token matches `token`. Implemented with
 * a small Lua script to keep the read-then-delete atomic; without this,
 * an over-running worker could delete a lock issued to a successor after
 * the TTL elapsed.
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

// ---------------------------------------------------------------------------
// Upstream walk helpers
// ---------------------------------------------------------------------------

/**
 * Pick the Walt Disney World Resort entry out of the destinations list.
 *
 * The TP wiki API returns destinations for every world-wide Disney resort;
 * we identify ours by name pattern and slug pattern (defense in depth in
 * case the upstream renames one). Throwing on absence is correct: if the
 * destination is gone, every subsequent step is undefined.
 */
function findWdwDestination(
  destinations: readonly ThemeParksDestinationEntry[],
): ThemeParksDestinationEntry {
  for (const dest of destinations) {
    if (
      WDW_NAME_PATTERN.test(dest.name) ||
      (dest.slug !== undefined && WDW_SLUG_PATTERN.test(dest.slug))
    ) {
      return dest;
    }
  }
  throw new UpstreamError(
    'invalid_response',
    'Walt Disney World destination not present in /destinations response.',
  );
}

/**
 * Build the upstream-park-id -> Park enum lookup from the destination's
 * `parks` array.
 *
 * Parks whose names cannot be matched to one of the seven Park enum
 * values are dropped from the map. This is intentional: an unrecognized
 * park (e.g., a future addition to the resort) should not silently be
 * mapped to one of the existing enum values. Entities under unmatched
 * parks will fall out of the upstream set and any cached rows for them
 * will be soft-deleted on the next sync.
 */
function buildParkMap(
  destination: ThemeParksDestinationEntry,
): ReadonlyMap<string, Park> {
  const map = new Map<string, Park>();
  const parks = destination.parks ?? [];
  for (const park of parks) {
    const enumValue = matchParkName(park.name);
    if (enumValue !== null) {
      map.set(park.id, enumValue);
    }
  }
  // Disney Springs does not always appear under `destination.parks` because
  // upstream classifies it as a separate entity type. The orchestrator's
  // park resolution falls back to name-matching the parent entity below
  // when the strict id lookup fails.
  return map;
}

/**
 * Map an upstream park name to one of the seven `Park` enum values.
 *
 * Patterns are deliberately permissive: TP wiki uses "Disney's Hollywood
 * Studios" and "Disney's Animal Kingdom Theme Park" rather than the bare
 * names in the Park enum. The first match wins; ordering matters only
 * for disambiguation between "Magic Kingdom" and the catch-all.
 */
function matchParkName(name: string): Park | null {
  const normalized = name.toLowerCase();
  if (/magic\s*kingdom/.test(normalized)) return 'Magic Kingdom';
  if (/epcot/.test(normalized)) return 'EPCOT';
  if (/hollywood\s*studios/.test(normalized)) return 'Hollywood Studios';
  if (/animal\s*kingdom/.test(normalized)) return 'Animal Kingdom';
  if (/typhoon\s*lagoon/.test(normalized)) return 'Typhoon Lagoon';
  if (/blizzard\s*beach/.test(normalized)) return 'Blizzard Beach';
  if (/disney\s*springs/.test(normalized)) return 'Disney Springs';
  return null;
}

/**
 * Build an id -> entity lookup from the flat children array. Used to walk
 * `parentId` chains without an O(n) scan per entity.
 *
 * Duplicates are silently overwritten; the upstream API does not produce
 * them in practice, but the assignment is deterministic.
 */
function buildEntityMap(
  children: readonly ThemeParksEntityChild[],
): ReadonlyMap<string, ThemeParksEntityChild> {
  const map = new Map<string, ThemeParksEntityChild>();
  for (const child of children) {
    map.set(child.id, child);
  }
  return map;
}

/**
 * Maximum hops the parent-chain walker takes before declaring the chain
 * unresolvable. The TP wiki entity tree under WDW is at most a handful
 * of levels deep (destination -> park -> land -> attraction); 32 is a
 * generous ceiling that also bounds the walker's work in the presence
 * of an accidental upstream cycle.
 */
const MAX_PARENT_CHAIN_HOPS = 32;

/**
 * Resolve which Park (if any) an entity belongs to by walking its
 * `parentId` chain in `entityMap` until either:
 *
 *   - a parent's id matches an entry in `parkMap` (return that Park), or
 *   - a parent's name matches a known Park (return that Park) — fallback
 *     for the case where the destination's `parks` array does not list
 *     the entity (e.g. Disney Springs sometimes appears as a top-level
 *     entity rather than a park entry), or
 *   - the chain runs out / hits the hop ceiling (return `null`).
 */
function resolvePark(
  entity: ThemeParksEntityChild,
  entityMap: ReadonlyMap<string, ThemeParksEntityChild>,
  parkMap: ReadonlyMap<string, Park>,
): Park | null {
  // Self check first: an entity that is itself a Park (e.g. a top-level
  // park returned in the children list) maps directly.
  const selfDirect = parkMap.get(entity.id);
  if (selfDirect !== undefined) return selfDirect;

  const visited = new Set<string>();
  let cursor: ThemeParksEntityChild | undefined = entity;
  for (let hop = 0; hop < MAX_PARENT_CHAIN_HOPS; hop++) {
    const parentId = cursor.parentId;
    if (parentId === undefined) return null;
    if (visited.has(parentId)) return null; // cycle guard
    visited.add(parentId);

    const direct = parkMap.get(parentId);
    if (direct !== undefined) return direct;

    const parent = entityMap.get(parentId);
    if (parent === undefined) return null;

    // Name fallback: catches park-shaped entities that are not in the
    // destination's `parks` array (notably Disney Springs).
    if (parent.entityType === 'PARK' || parent.entityType === 'DESTINATION') {
      const fallback = matchParkName(parent.name);
      if (fallback !== null) return fallback;
    }

    cursor = parent;
  }
  return null;
}

/**
 * Walk every child entity, filter to the include set, classify, resolve
 * its Park, and emit one `UpstreamExperience` per acceptance.
 *
 * Entities that fail any of these checks are dropped silently; the diff
 * produced by `reconcile` against the resulting set is the cache's source
 * of truth, so dropped entities will be soft-deleted next pass if they
 * were previously cached (R1.15) and never inserted otherwise.
 */
function buildUpstreamSet(
  children: readonly ThemeParksEntityChild[],
  entityMap: ReadonlyMap<string, ThemeParksEntityChild>,
  parkMap: ReadonlyMap<string, Park>,
): readonly UpstreamExperience[] {
  const out: UpstreamExperience[] = [];
  const seenIds = new Set<string>();

  for (const child of children) {
    if (!INCLUDE_SET.has(child.entityType)) continue;
    const park = resolvePark(child, entityMap, parkMap);
    if (park === null) continue;

    const category: ExperienceCategory = classify({
      entityType: child.entityType,
      name: child.name,
      ...(child.attractionType !== undefined
        ? { attractionType: child.attractionType }
        : {}),
    });

    const id = internalId(child.id);
    // Deduplicate on the derived internal id. `internalId` is one-to-one
    // by Property 2, so duplicates here imply the upstream returned two
    // entries with the same upstream id — last-write-wins matches the
    // dedupe rule in `reconcile.ts`.
    if (seenIds.has(id)) {
      // Replace earlier occurrence: find and overwrite. This is rare
      // enough (production never produces it) that an O(n) scan is
      // simpler than indexing `out` by id.
      const idx = out.findIndex((e) => e.id === id);
      if (idx >= 0) {
        out[idx] = toUpstreamExperience(id, child, park, category);
      }
      continue;
    }

    seenIds.add(id);
    out.push(toUpstreamExperience(id, child, park, category));
  }

  return out;
}

/** Build a single `UpstreamExperience` from a classified child. */
function toUpstreamExperience(
  id: string,
  child: ThemeParksEntityChild,
  park: Park,
  category: ExperienceCategory,
): UpstreamExperience {
  return {
    id,
    upstreamEntityId: child.id,
    name: child.name,
    park,
    category,
    // The children endpoint does not expose a description in the typed
    // projection. The repo's `applyReconciliation` runs description
    // through `sanitizeDescription`, which maps `''` to `''`, so this
    // is safe and column-compatible (`description NOT NULL DEFAULT ''`).
    description: '',
  };
}

// Re-export the helpers that the test suite (task 9.6+ and 9.9 integration
// fixture) needs to drive without re-implementing. They are exported as a
// stable internal seam, not part of the public API of the orchestrator.
export const __internal = {
  buildEntityMap,
  buildParkMap,
  buildUpstreamSet,
  findWdwDestination,
  matchParkName,
  resolvePark,
};

// `ThemeParksDestinationParkEntry` is unused at runtime here but is
// re-exported to satisfy any consumer that wants to type-check fixtures
// against the same shape the orchestrator consumes.
export type { ThemeParksDestinationParkEntry };
