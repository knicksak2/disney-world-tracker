/**
 * Catalog_Service repository.
 *
 * The repo is the single point of contact between the Catalog_Service and
 * the Postgres tables that back the catalog (`experiences`, `resorts`,
 * `experience_menus`, `catalog_sync_runs`, `catalog_cache_metadata`). It
 * exposes:
 *
 *   - `getCacheAge`            — read the singleton metadata row and report
 *                                how long ago the most recent successful
 *                                sync completed; also feeds the read-path
 *                                staleness indicator (R1.11, R1.12, R12.1).
 *   - `getCacheSnapshot` /
 *     `getResortSnapshot`      — materialize the Experience and Resort diff
 *                                inputs `reconcileCatalog()` consumes.
 *   - `applyReconciliation`    — apply the combined `CatalogDiff` (Experiences
 *                                + Resorts) plus the orchestrator's menu
 *                                writes against the live cache, all in a
 *                                single transaction (R11.6, R11.7). Writes
 *                                each item's Disney-provided `image_url` from
 *                                the diff, making Catalog_Sync the sole writer
 *                                of `image_url` (R7.1, R14.9).
 *   - `recordSyncRun`          — insert a row in `catalog_sync_runs` with
 *                                the run outcome and (on success) update
 *                                `catalog_cache_metadata.last_successful_
 *                                sync_at` so the next read knows the cache
 *                                is fresh (R1.9, R1.13).
 *   - `listActiveExperiences`  — read the catalog with optional `park`,
 *                                `category`, `areaType` (R16.3), and
 *                                case-insensitive substring `q` filters;
 *                                returns rows ordered by Park then
 *                                `lower(name)`, carrying the enrichment fields
 *                                (coordinates, accessibility, price tier, meal
 *                                periods, area type, resort id) each present
 *                                only when persisted (R5.6, R5.7).
 *   - `listActiveResorts`      — read all active Resorts as DTOs (R6.8).
 *   - `getExperience`          — fetch a single Experience by id, regardless
 *                                of `active`, so the detail view can still
 *                                render a soft-deleted Experience the user
 *                                has a Completion/Rating/Note for.
 *   - `getMenusFor`            — read a restaurant Experience's persisted
 *                                menus for the detail view (R8.5).
 *
 * Soft-delete is applied by flipping `active = false` on the row; the row
 * itself is never deleted, so all foreign-key references from
 * `completions`, `ratings`, and `notes` remain valid (R11.5). Reactivation
 * (a previously soft-deleted upstream id reappearing) flows through the
 * same upsert path as a brand-new row, with `active` set back to `true`
 * (R11.2, R6.10). Resorts are reconciled with the same rules and persisted so
 * they remain retrievable across restarts and subsequent syncs (R6.7).
 *
 * Description text arrives already sanitized to plain text from `reconcile`
 * (the `ReconcileUpsert.description` contract, R11.8), so the repo persists it
 * verbatim.
 *
 * Validates: Requirements 5.6, 5.7, 6.7, 6.8, 8.5, 11.6, 11.7, 16.3, 7.1, 14.9
 */

import type { QueryResultRow } from 'pg';
import { PARKS } from '@dwt/shared';
import type {
  AreaType,
  ExperienceCategory,
  ExperienceDTO,
  GroupedFacetsDTO,
  HeightRequirementDTO,
  MealPeriodDTO,
  MenuDTO,
  Park,
  ResortDTO,
  SyncRunOutcome,
  WhyThisDTO,
} from '@dwt/shared';

import { deriveFacetViews } from './disney/enrich.js';
import type { DbPool } from '../../db/pool.js';
import type {
  CatalogCacheRow,
  CatalogDiff,
  ResortCacheRow,
} from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Outcome of a Catalog_Sync run as it lands in `catalog_sync_runs.status`.
 *
 * - `running` is reserved for the orchestrator's start row when it splits
 *   the lifecycle into begin/finish; the repo accepts it for completeness.
 * - `success` flips `last_successful_sync_at` on the singleton metadata row.
 * - `failed` leaves the metadata row unchanged; the existing cache continues
 *   to serve traffic with `staleCache: true` per R1.13.
 */
export type SyncRunStatus = 'running' | 'success' | 'failed';

/**
 * The run-outcome discriminator persisted in `catalog_sync_runs.outcome`
 * (R12.6), re-exported from the `@dwt/shared` closed set so it stays the single
 * source of truth across the transport, the `outcomeFromError` mapper, and this
 * repo. The set is `success | waf_block | auth_failure | network |
 * invalid_response | aborted`: a successful run records `success`; a Disney
 * failure is classified by the transport into `waf_block` (an Akamai edge block,
 * R12.4) or `auth_failure` (a credential rejection, R12.5) or another transport
 * kind. `http_status` is retired from the set (folded into `invalid_response`).
 * The migration leaves the column nullable so historical rows predating it stay
 * valid, and a legacy `http_status` value is read back as `auth_failure` for
 * display continuity; the orchestrator writes one of these values on every new
 * run.
 */
export type { SyncRunOutcome };

/**
 * Input record for `recordSyncRun`. The optional fields are only populated
 * when the sync has finished — in particular `errorClass` and `errorMessage`
 * are only meaningful when `status === 'failed'`.
 */
export interface RecordSyncRunInput {
  readonly status: SyncRunStatus;
  readonly startedAt: Date;
  readonly finishedAt?: Date;
  readonly errorClass?: string;
  readonly errorMessage?: string;
  readonly entitiesProcessed?: number;
  /**
   * Run-outcome discriminator recorded on every run (R12.5). Optional at the
   * type level for backwards compatibility with callers that predate the
   * column, but the Catalog_Sync orchestrator always supplies it.
   */
  readonly outcome?: SyncRunOutcome;
}

/** Row returned from `recordSyncRun`. Carries the generated run id. */
export interface RecordedSyncRun {
  readonly id: string;
}

/**
 * Optional filters accepted by `listActiveExperiences`. Each filter is
 * applied conjunctively; a missing filter means "no constraint".
 *
 * - `park`     — exact-match on `experiences.park`.
 * - `category` — exact-match on `experiences.category`.
 * - `areaType` — exact-match on `experiences.area_type`, so the browse path
 *                can present each Area (`ThemePark`, `WaterPark`,
 *                `DisneySprings`, `Resort`) in its own section (R16.3).
 * - `q`        — case-insensitive substring match on `experiences.name`.
 *                Whitespace-only queries are treated as "no query"; this
 *                mirrors R1.20's "1 non-whitespace character" floor for the
 *                client-visible search behavior. The route layer is still
 *                free to do its own pre-validation; this is defense in
 *                depth.
 * - `land`     — case-sensitive exact match on `experiences.land` (R3.4). SQL
 *                `=` on `TEXT` is case-sensitive by default, so unlike `q` it
 *                needs no `lower()` wrapping; it combines conjunctively with
 *                every other filter (R3.7) and a non-matching value yields an
 *                empty list (R3.8).
 */
export interface CatalogListFilters {
  readonly park?: Park;
  readonly category?: ExperienceCategory;
  readonly areaType?: AreaType;
  readonly q?: string;
  readonly land?: string;
  /**
   * Case-sensitive exact match on `experiences.world_showcase_country` — the
   * derived EPCOT World Showcase pavilion. Combines conjunctively with every
   * other filter; a non-matching value yields an empty list.
   */
  readonly worldShowcaseCountry?: string;
}

/**
 * Identifier for one Catalog_Home Destination. It is either one of the seven
 * `Park` values (the four theme parks, the two water parks, and Disney Springs)
 * or the string literal `'Resorts'` for the single aggregate Resorts
 * Destination. `@dwt/shared` does not model this union, so it is defined here
 * as `Park | 'Resorts'` — the eight Destinations the API reports counts for.
 */
export type DestinationId = Park | 'Resorts';

/**
 * The count of active Experiences belonging to one Destination, returned by
 * {@link CatalogRepo.listDestinationCounts} (R3.6, R4.5, R4.6).
 */
export interface DestinationCount {
  /** Destination identifier; a `Park` value for the 7 park destinations, or `'Resorts'`. */
  readonly destination: DestinationId;
  /** Number of active Experiences belonging to that Destination (R3.6). */
  readonly count: number;
}

/**
 * A cached restaurant menu together with the timestamp at which it was fetched
 * from the Menu_Service. `fetchedAt` is the `experience_menus.fetched_at`
 * column added by migration `0005_disney_source_resilience.sql`; it drives the
 * lazy-retrieval freshness decision (R8.4). `null` freshness (no row) is
 * modeled by a `null` {@link MenuFetchState.cached}, not by this type.
 */
export interface MenuCacheEntry {
  /** The persisted menus for the restaurant, decoded from the JSONB column. */
  readonly menus: readonly MenuDTO[];
  /** When these menus were last fetched from the Menu_Service (R8.2, R8.4). */
  readonly fetchedAt: Date;
}

/**
 * The information the lazy menu-retrieval seam (`menuRetrieval.ts`, task 9.1)
 * needs to serve or refresh a restaurant's menu in a single repo read:
 *
 *   - `upstreamEntityId` — the Experience's Disney `Enterprise_Id`, used to
 *     fetch the menu from the Menu_Service via `Facilities_Client.getMenus`
 *     when the cache is missing or stale (R8.2).
 *   - `cached` — the current cached menu + `fetched_at`, or `null` when the
 *     restaurant has no `experience_menus` row yet (cache missing, R8.2).
 *
 * A `null` return from {@link CatalogRepo.getMenuFetchState} means no such
 * Experience exists.
 */
export interface MenuFetchState {
  readonly upstreamEntityId: string;
  readonly cached: MenuCacheEntry | null;
}

/** Information about the cache used by the read-decision logic in task 9.4. */
export interface CacheAgeInfo {
  /**
   * Age of the most recent successful sync at the moment of the call, in
   * hours. `null` when no successful sync has ever been recorded — the
   * orchestrator and route layer treat this as "no cache yet" and gate
   * R1.11/R1.24 on it accordingly.
   */
  readonly hours: number | null;
  /** Underlying timestamp from `catalog_cache_metadata.last_successful_sync_at`. */
  readonly lastSuccessfulSyncAt: Date | null;
}

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

/**
 * Shape of an `experiences` row as we read it back. Postgres returns
 * `BOOLEAN` as `boolean` through `pg`, and the CHECK constraints on `park`,
 * `category`, and `area_type` guarantee the column values are inside the
 * corresponding enums (`park` is nullable for a `Resort`-area Experience,
 * R5.7). We still narrow the types here so the public DTO mapping does not
 * need a cast.
 */
interface ExperienceRow extends QueryResultRow {
  id: string;
  upstream_entity_id: string;
  name: string;
  park: Park | null;
  category: ExperienceCategory;
  description: string;
  active: boolean;
  /** Persisted Land name, or `null` when the Experience has no Land (R2.1, R3.1). */
  land: string | null;
  /** Persisted Resort_Area zone for a `Resort`-area Experience, else `null`. */
  resort_area: string | null;
  /** Persisted EPCOT World Showcase country pavilion, or `null`. */
  world_showcase_country: string | null;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  area_type: AreaType;
  resort_id: string | null;
  /**
   * Represented Resort's Internal_Id for a resort-representing Experience, else
   * `null`. NULL for every ordinary Experience, including resort-area
   * activities (which carry `resort_id`). Requirements 3.1, 3.2.
   */
  represents_resort_id: string | null;
  accessibility: string[];
  price_tier: string | null;
  meal_periods: readonly MealPeriodDTO[];
  /** Grouped_Facets keyed by Facet_Group name; `{}` when none (R7.1, R8.2). */
  grouped_facets: GroupedFacetsDTO;
  /** Height requirement with derived numeric minimums, or `null` (R7.2, R8.1). */
  height_requirement: HeightRequirementDTO | null;
  /** Structured why-this marketing copy, or `null` (R7.3, R8.3). */
  why_this: WhyThisDTO | null;
  /** Facility_SubType finer classification, or `null` (R7.4, R8.4). */
  sub_type: string | null;
}

/**
 * Shape of a `resorts` row as we read it back. Every descriptive field is
 * nullable per the migration (`0004_disney_sources.sql`): the upstream
 * Facility_Document may omit any of `description`, `image_url`, coordinates,
 * `address`, or `phone` (R6.4, R6.5). The CHECK constraint on `name` keeps it
 * 1..200 characters, and `active` drives the soft-delete / reactivation
 * lifecycle (R6.9, R6.10).
 */
interface ResortRow extends QueryResultRow {
  id: string;
  upstream_entity_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  phone: string | null;
  active: boolean;
  /**
   * Id of the active resort-representing Experience standing in for this
   * Resort, joined in by {@link listActiveResorts} (Option A). Absent on reads
   * that do not join `experiences` (e.g. the sync snapshot); `null` when the
   * Resort has no active representing Experience.
   */
  representing_experience_id?: string | null;
}

/**
 * Shape of an `experience_menus` row. `menus` is a JSONB column; the `pg`
 * jsonb parser returns the already-decoded `MenuDTO[]` value directly (the
 * same round-trip the sharing repo relies on for `payload_snapshot`).
 */
interface MenuRow extends QueryResultRow {
  menus: readonly MenuDTO[];
}

/**
 * Shape of the joined `experiences` + `experience_menus` row read by
 * {@link getMenuFetchState}. `upstream_entity_id` is always present (the
 * Experience row); `menus`/`fetched_at` are `null` when the LEFT JOIN found no
 * `experience_menus` row (cache missing).
 */
interface MenuFetchRow extends QueryResultRow {
  upstream_entity_id: string;
  menus: readonly MenuDTO[] | null;
  fetched_at: Date | null;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/**
 * Catalog_Service repository surface. Returned by {@link createCatalogRepo}.
 */
export interface CatalogRepo {
  getCacheAge(now?: Date): Promise<CacheAgeInfo>;
  getCacheSnapshot(): Promise<readonly CatalogCacheRow[]>;
  getResortSnapshot(): Promise<readonly ResortCacheRow[]>;
  getBridgeMap(): Promise<ReadonlyMap<string, string>>;
  applyReconciliation(diff: CatalogDiff): Promise<void>;
  recordSyncRun(input: RecordSyncRunInput): Promise<RecordedSyncRun>;
  listActiveExperiences(
    filters?: CatalogListFilters,
  ): Promise<readonly ExperienceDTO[]>;
  listActiveResorts(): Promise<readonly ResortDTO[]>;
  getExperience(id: string): Promise<ExperienceDTO | null>;
  /**
   * Return the count of active Experiences for each of the eight Destinations —
   * the seven `Park` Destinations counted by `park`, and the aggregate
   * `'Resorts'` Destination counting every active `Resort`-area Experience
   * (R3.6, R4.5). Every Destination is always present in the result, including
   * those with zero active Experiences (R4.6). Entries are returned in the
   * canonical grid order (the seven `PARKS` values, then `'Resorts'`).
   */
  listDestinationCounts(): Promise<readonly DestinationCount[]>;
  getMenusFor(experienceId: string): Promise<readonly MenuDTO[]>;
  /**
   * Read the lazy-menu-retrieval state for an Experience in a single query: its
   * `Enterprise_Id` (`upstream_entity_id`) plus any cached menu and its
   * `fetched_at` (R8.2, R8.4). Returns `null` when no Experience matches the
   * id, and `{ upstreamEntityId, cached: null }` when the Experience exists but
   * has no cached menu yet.
   */
  getMenuFetchState(experienceId: string): Promise<MenuFetchState | null>;
  /**
   * Cache a freshly-fetched restaurant menu, stamping `fetched_at` with the
   * supplied instant so the freshness window restarts (R8.2). Upserts the
   * `experience_menus` row, replacing any prior menu.
   */
  upsertMenus(
    experienceId: string,
    menus: readonly MenuDTO[],
    fetchedAt: Date,
  ): Promise<void>;
  /**
   * Set the special-hours participation flags (`operates_during_early_entry`,
   * `operates_during_extended_evening`, `operates_during_ticketed_event`) for
   * the given Experiences, keyed by `upstream_entity_id` (= Disney
   * Enterprise_Id), from the Disney Schedule channel capture
   * (disney-facilities-catalog-source R5.8). Deduped by id; Experiences not
   * listed are left unchanged (their prior value or `NULL`). No-op for empty.
   */
  updateSpecialHoursParticipation(
    entries: readonly {
      upstreamEntityId: string;
      earlyEntry: boolean;
      extendedEvening: boolean;
      ticketedEvent: boolean;
    }[],
  ): Promise<void>;
}

/**
 * Build a `CatalogRepo` bound to the supplied pool.
 *
 * Constructor injection (rather than reaching for `getPool()` at the
 * top-level) keeps the repo testable: integration tests can pass a pool
 * connected to a sandbox database, and unit tests can pass a fake whose
 * `query` method records or rewrites SQL.
 */
export function createCatalogRepo(pool: DbPool): CatalogRepo {
  return {
    getCacheAge: (now) => getCacheAge(pool, now ?? new Date()),
    getCacheSnapshot: () => getCacheSnapshot(pool),
    getResortSnapshot: () => getResortSnapshot(pool),
    getBridgeMap: () => getBridgeMap(pool),
    applyReconciliation: (diff) => applyReconciliation(pool, diff),
    recordSyncRun: (input) => recordSyncRun(pool, input),
    listActiveExperiences: (filters) =>
      listActiveExperiences(pool, filters ?? {}),
    listActiveResorts: () => listActiveResorts(pool),
    getExperience: (id) => getExperience(pool, id),
    listDestinationCounts: () => listDestinationCounts(pool),
    getMenusFor: (experienceId) => getMenusFor(pool, experienceId),
    getMenuFetchState: (experienceId) => getMenuFetchState(pool, experienceId),
    upsertMenus: (experienceId, menus, fetchedAt) =>
      upsertMenus(pool, experienceId, menus, fetchedAt),
    updateSpecialHoursParticipation: (entries) =>
      updateSpecialHoursParticipation(pool, entries),
  };
}

// ---------------------------------------------------------------------------
// updateSpecialHoursParticipation
// ---------------------------------------------------------------------------

interface SpecialHoursEntry {
  readonly upstreamEntityId: string;
  readonly earlyEntry: boolean;
  readonly extendedEvening: boolean;
  readonly ticketedEvent: boolean;
}

/**
 * Bulk-set the three special-hours flags keyed by `upstream_entity_id`. Deduped
 * by id (last value wins) so the single UPDATE never touches a row twice, and a
 * no-op for an empty list. Ids not matching any Experience are silently ignored.
 */
async function updateSpecialHoursParticipation(
  pool: DbPool,
  entries: readonly SpecialHoursEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const deduped = new Map<string, SpecialHoursEntry>();
  for (const e of entries) {
    deduped.set(e.upstreamEntityId, e);
  }
  // Deduped, per-row updates in one transaction. The catalog sync runs
  // occasionally over ~O(100) rides, so a keyed loop is ample and avoids
  // multi-array `unnest` (which not every Postgres-compatible engine supports).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const e of deduped.values()) {
      await client.query(
        `UPDATE experiences
            SET operates_during_early_entry = $1,
                operates_during_extended_evening = $2,
                operates_during_ticketed_event = $3
          WHERE upstream_entity_id = $4`,
        [e.earlyEntry, e.extendedEvening, e.ticketedEvent, e.upstreamEntityId],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Surface the original cause.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// getCacheAge
// ---------------------------------------------------------------------------

/**
 * Read the singleton `catalog_cache_metadata` row (`id = 1`) and compute
 * the cache age in hours.
 *
 * The migration creates the table but does not seed the singleton row, so
 * a fresh database returns no rows here. We translate that into
 * `{ hours: null, lastSuccessfulSyncAt: null }` rather than throwing,
 * because "no sync has ever succeeded" is a normal first-boot state.
 */
async function getCacheAge(pool: DbPool, now: Date): Promise<CacheAgeInfo> {
  const result = await pool.query<{ last_successful_sync_at: Date | null }>(
    `SELECT last_successful_sync_at
       FROM catalog_cache_metadata
      WHERE id = 1`,
  );

  const row = result.rows[0];
  const last = row?.last_successful_sync_at ?? null;

  if (last === null) {
    return { hours: null, lastSuccessfulSyncAt: null };
  }

  const ageMs = now.getTime() - last.getTime();
  // Clamp negative ages (clock-skew between writer and reader) to zero
  // rather than leaking a negative value into the read-decision logic.
  const hours = Math.max(0, ageMs / (60 * 60 * 1000));
  return { hours, lastSuccessfulSyncAt: last };
}

// ---------------------------------------------------------------------------
// getCacheSnapshot
// ---------------------------------------------------------------------------

/**
 * Read every row in the `experiences` cache, regardless of `active`, in the
 * shape `reconcile(currentCache, upstreamSet)` consumes.
 *
 * The sync orchestrator (`runSync`) calls this to materialize the diff
 * input. Soft-deleted rows are included because `reconcile` flips them
 * back to active when the upstream id reappears (R1.15 reactivation).
 *
 * `description` is intentionally NOT projected: `reconcile`'s diff rules
 * (R1.16) only consider `name`, `park`, `category`, `land`, `area_type`,
 * `resort_id`, and `represents_resort_id` as material change signals, and
 * reading description would only inflate the snapshot.
 */
async function getCacheSnapshot(
  pool: DbPool,
): Promise<readonly CatalogCacheRow[]> {
  const result = await pool.query<ExperienceRow>(
    `SELECT id, upstream_entity_id, name, park, category, description, active, land,
            area_type, resort_id, resort_area, world_showcase_country, represents_resort_id
       FROM experiences`,
  );
  return result.rows.map(rowToCacheSnapshot);
}

/** Project an `ExperienceRow` down to the {@link CatalogCacheRow} shape. */
function rowToCacheSnapshot(row: ExperienceRow): CatalogCacheRow {
  return {
    id: row.id,
    active: row.active,
    name: row.name,
    park: row.park,
    category: row.category,
    land: row.land,
    areaType: row.area_type,
    resortId: row.resort_id,
    resortArea: row.resort_area,
    worldShowcaseCountry: row.world_showcase_country,
    representsResortId: row.represents_resort_id,
  };
}

// ---------------------------------------------------------------------------
// getResortSnapshot
// ---------------------------------------------------------------------------

/**
 * Read every row in the `resorts` cache, regardless of `active`, in the shape
 * `reconcileResorts(currentResorts, upstreamResorts)` consumes.
 *
 * The sync orchestrator calls this to materialize the Resort diff input.
 * Soft-deleted rows are included because `reconcileResorts` flips them back to
 * active when the upstream id reappears (R6.10 reactivation). Every persisted
 * descriptive field is projected because any of them drifting from upstream
 * triggers an upsert (R6.3, R6.4, R6.5).
 */
async function getResortSnapshot(
  pool: DbPool,
): Promise<readonly ResortCacheRow[]> {
  const result = await pool.query<ResortRow>(
    `SELECT id, name, description, image_url, latitude, longitude,
            address, phone, active
       FROM resorts`,
  );
  return result.rows.map(rowToResortCache);
}

/** Project a `ResortRow` down to the {@link ResortCacheRow} shape. */
function rowToResortCache(row: ResortRow): ResortCacheRow {
  return {
    id: row.id,
    active: row.active,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    phone: row.phone,
  };
}

// ---------------------------------------------------------------------------
// getBridgeMap
// ---------------------------------------------------------------------------

/**
 * Read the one-time `catalog_id_bridge` mapping (`enterprise_id ->
 * internal_id`) built by the migration's Bridge_Map step (R10.2).
 *
 * Catalog_Sync calls this once per run and passes the resulting map to
 * `assignInternalId` so every catalog item that has a continuity entry keeps
 * the Internal_Id its Completions/Ratings/Notes already reference (R10.3). A
 * fresh database with no bridge rows returns an empty map, in which case every
 * id is derived fresh via UUIDv5 (R10.4).
 */
async function getBridgeMap(
  pool: DbPool,
): Promise<ReadonlyMap<string, string>> {
  const result = await pool.query<{
    enterprise_id: string;
    internal_id: string;
  }>(
    `SELECT enterprise_id, internal_id
       FROM catalog_id_bridge`,
  );
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(row.enterprise_id, row.internal_id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// applyReconciliation
// ---------------------------------------------------------------------------

/**
 * Apply the combined `CatalogDiff` — Resort upserts, Experience upserts,
 * per-restaurant menu writes, and Experience/Resort soft-deletes — against the
 * live cache inside a single transaction (R11.6, R11.7).
 *
 * Ordering preserves referential integrity: Resorts are written before
 * Experiences so an Experience's `resort_id` foreign key resolves, and menus
 * are written after Experiences so `experience_menus.experience_id` resolves;
 * soft-deletes run last. A single `BEGIN`/`COMMIT` wraps every write (R11.7).
 * If any statement fails, the whole run is rolled back so the cache is
 * byte-for-byte identical to its pre-run state with no partial changes
 * persisted (R11.6). Each item's Disney-provided `image_url` from the diff is
 * written here, making Catalog_Sync the sole writer of `image_url` (R7.1,
 * R14.9).
 *
 * An empty diff is a no-op that skips acquiring a connection entirely.
 */
async function applyReconciliation(
  pool: DbPool,
  diff: CatalogDiff,
): Promise<void> {
  const menuWrites = diff.menus ?? [];

  // Skip the connection round-trip when there is nothing to do — common when
  // the upstream set has not changed between syncs.
  if (
    diff.experiences.upserts.length === 0 &&
    diff.experiences.softDeletes.length === 0 &&
    diff.resorts.upserts.length === 0 &&
    diff.resorts.softDeletes.length === 0 &&
    menuWrites.length === 0
  ) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // (1) Resort upserts — before Experiences so resort_id FKs resolve.
    for (const upsert of diff.resorts.upserts) {
      await client.query(
        `INSERT INTO resorts (
           id, upstream_entity_id, name, description, image_url,
           latitude, longitude, address, phone, active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, now())
         ON CONFLICT (id) DO UPDATE SET
           upstream_entity_id = EXCLUDED.upstream_entity_id,
           name               = EXCLUDED.name,
           description        = EXCLUDED.description,
           image_url          = EXCLUDED.image_url,
           latitude           = EXCLUDED.latitude,
           longitude          = EXCLUDED.longitude,
           address            = EXCLUDED.address,
           phone              = EXCLUDED.phone,
           active             = TRUE,
           updated_at         = now()`,
        [
          upsert.id,
          upsert.upstreamEntityId,
          upsert.name,
          upsert.description,
          upsert.imageUrl,
          upsert.latitude,
          upsert.longitude,
          upsert.address,
          upsert.phone,
        ],
      );
    }

    // (2) Experience upserts.
    for (const upsert of diff.experiences.upserts) {
      await client.query(
        `INSERT INTO experiences (
           id, upstream_entity_id, name, park, category, description, active,
           image_url, latitude, longitude, area_type, resort_id,
           accessibility, price_tier, meal_periods, land, resort_area,
           grouped_facets, height_requirement, why_this, sub_type,
           represents_resort_id, world_showcase_country, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22, now())
         ON CONFLICT (id) DO UPDATE SET
           upstream_entity_id   = EXCLUDED.upstream_entity_id,
           name                 = EXCLUDED.name,
           park                 = EXCLUDED.park,
           category             = EXCLUDED.category,
           description          = EXCLUDED.description,
           active               = TRUE,
           image_url            = EXCLUDED.image_url,
           latitude             = EXCLUDED.latitude,
           longitude            = EXCLUDED.longitude,
           area_type            = EXCLUDED.area_type,
           resort_id            = EXCLUDED.resort_id,
           accessibility        = EXCLUDED.accessibility,
           price_tier           = EXCLUDED.price_tier,
           meal_periods         = EXCLUDED.meal_periods,
           land                 = EXCLUDED.land,
           resort_area          = EXCLUDED.resort_area,
           grouped_facets       = EXCLUDED.grouped_facets,
           height_requirement   = EXCLUDED.height_requirement,
           why_this             = EXCLUDED.why_this,
           sub_type             = EXCLUDED.sub_type,
           represents_resort_id = EXCLUDED.represents_resort_id,
           world_showcase_country = EXCLUDED.world_showcase_country,
           updated_at           = now()`,
        [
          upsert.id,
          upsert.upstreamEntityId,
          upsert.name,
          upsert.park,
          upsert.category,
          upsert.description,
          upsert.imageUrl,
          upsert.latitude,
          upsert.longitude,
          upsert.areaType,
          upsert.resortId,
          upsert.accessibility,
          upsert.priceTier,
          JSON.stringify(upsert.mealPeriods),
          upsert.land,
          upsert.resortArea,
          JSON.stringify(upsert.groupedFacets),
          // Nullable JSONB: pass SQL NULL through as null rather than the JSON
          // string 'null', so an absent field is stored as NULL not JSON null.
          upsert.heightRequirement === null
            ? null
            : JSON.stringify(upsert.heightRequirement),
          upsert.whyThis === null ? null : JSON.stringify(upsert.whyThis),
          upsert.subType,
          upsert.representsResortId,
          upsert.worldShowcaseCountry,
        ],
      );
    }

    // (3) Menu upserts — after Experiences so experience_id FKs resolve.
    for (const menu of menuWrites) {
      await client.query(
        `INSERT INTO experience_menus (experience_id, menus, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (experience_id) DO UPDATE SET
           menus      = EXCLUDED.menus,
           updated_at = now()`,
        [menu.experienceId, JSON.stringify(menu.menus)],
      );
    }

    // (4) Soft-deletes: Experiences then Resorts.
    for (const soft of diff.experiences.softDeletes) {
      await client.query(
        `UPDATE experiences
            SET active = FALSE,
                updated_at = now()
          WHERE id = $1`,
        [soft.id],
      );
    }

    for (const soft of diff.resorts.softDeletes) {
      await client.query(
        `UPDATE resorts
            SET active = FALSE,
                updated_at = now()
          WHERE id = $1`,
        [soft.id],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Surface the original cause; rollback failures are logged by the
      // pool layer and do not change the user-visible error.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// recordSyncRun
// ---------------------------------------------------------------------------

/**
 * Insert a `catalog_sync_runs` row and, on a successful run, point the
 * singleton `catalog_cache_metadata` at it.
 *
 * Both writes happen inside a single transaction so an observer can never
 * see a metadata pointer that references a sync run that hasn't been
 * recorded yet.
 *
 * For `status === 'success'`, `last_successful_sync_at` is set to the
 * provided `finishedAt` (falling back to `now()` when omitted, though
 * production callers always supply it). The migration's CHECK
 * (`id = 1`) makes the metadata row a true singleton; we use
 * `INSERT ... ON CONFLICT (id) DO UPDATE` to insert it on first success
 * and update it thereafter.
 *
 * For `status === 'failed'` and `status === 'running'`, only the run row
 * is inserted; the metadata pointer is not touched (R1.13).
 */
async function recordSyncRun(
  pool: DbPool,
  input: RecordSyncRunInput,
): Promise<RecordedSyncRun> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO catalog_sync_runs (
         status, started_at, finished_at, error_class, error_message, entities_processed, outcome
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.status,
        input.startedAt,
        input.finishedAt ?? null,
        input.errorClass ?? null,
        input.errorMessage ?? null,
        input.entitiesProcessed ?? null,
        input.outcome ?? null,
      ],
    );

    const row = inserted.rows[0];
    if (!row) {
      throw new Error(
        'recordSyncRun: INSERT...RETURNING produced no row (driver fault).',
      );
    }

    if (input.status === 'success') {
      const successAt = input.finishedAt ?? new Date();
      await client.query(
        `INSERT INTO catalog_cache_metadata (id, last_successful_sync_at, last_sync_run_id)
         VALUES (1, $1, $2)
         ON CONFLICT (id) DO UPDATE SET
           last_successful_sync_at = EXCLUDED.last_successful_sync_at,
           last_sync_run_id        = EXCLUDED.last_sync_run_id`,
        [successAt, row.id],
      );
    }

    await client.query('COMMIT');
    return { id: row.id };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original cause for the caller to surface.
    }
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// listActiveExperiences
// ---------------------------------------------------------------------------

/**
 * Read all active Experiences, optionally filtered by Park and/or category
 * and/or a case-insensitive substring on the name.
 *
 * Ordering: `park ASC, lower(name) ASC`. Park ordering uses the column's
 * raw value so the result has stable Park groupings (the client orders
 * Parks by a fixed display sequence; this stable backend order makes the
 * client-side grouping a single linear scan).
 *
 * Filter handling:
 *
 *   - `park` and `category` translate directly to equality predicates.
 *   - `q` is matched with `name ILIKE '%' || $n || '%'`. We escape the
 *     SQL-LIKE metacharacters `%`, `_`, and `\` in the user-supplied
 *     value so `q = "100%"` does not become a wildcard match.
 *   - A `q` value that is empty or whitespace-only is treated as "no
 *     filter" — see {@link CatalogListFilters} for the rationale.
 */
async function listActiveExperiences(
  pool: DbPool,
  filters: CatalogListFilters,
): Promise<readonly ExperienceDTO[]> {
  const where: string[] = ['active = TRUE'];
  const params: unknown[] = [];

  if (filters.park !== undefined) {
    params.push(filters.park);
    where.push(`park = $${params.length}`);
  }

  if (filters.category !== undefined) {
    params.push(filters.category);
    where.push(`category = $${params.length}`);
  }

  if (filters.areaType !== undefined) {
    params.push(filters.areaType);
    where.push(`area_type = $${params.length}`);
  }

  if (filters.land !== undefined) {
    // Case-sensitive exact match (R3.4): SQL `=` on TEXT is case-sensitive by
    // default, so this is a literal equality, contrasting the `q` ILIKE below.
    params.push(filters.land);
    where.push(`land = $${params.length}`);
  }

  if (filters.worldShowcaseCountry !== undefined) {
    // Case-sensitive exact match on the derived EPCOT pavilion, mirroring the
    // `land` filter and combining conjunctively with every other filter.
    params.push(filters.worldShowcaseCountry);
    where.push(`world_showcase_country = $${params.length}`);
  }

  const trimmedQuery =
    filters.q !== undefined && filters.q.trim().length > 0
      ? filters.q.trim()
      : null;

  if (trimmedQuery !== null) {
    params.push(`%${escapeLikePattern(trimmedQuery)}%`);
    // ESCAPE '\\' makes the escapes inserted by escapeLikePattern effective
    // even though Postgres's default for LIKE is already '\'; spelling it
    // out keeps the behavior portable across `standard_conforming_strings`
    // settings.
    where.push(`name ILIKE $${params.length} ESCAPE '\\'`);
  }

  const sql = `
    SELECT id, upstream_entity_id, name, park, category, description, active,
           land, resort_area, world_showcase_country, image_url, latitude, longitude, area_type, resort_id,
           accessibility, price_tier, meal_periods,
           grouped_facets, height_requirement, why_this, sub_type
      FROM experiences
     WHERE ${where.join(' AND ')}
     ORDER BY park ASC, lower(name) ASC, id ASC`;

  const result = await pool.query<ExperienceRow>(sql, params);
  return result.rows.map(rowToDto);
}

// ---------------------------------------------------------------------------
// listActiveResorts
// ---------------------------------------------------------------------------

/**
 * Read all active Resorts as wire DTOs (R6.8). Soft-deleted Resorts are
 * excluded — only rows with `active = TRUE` are browsable. Ordered by
 * `lower(name) ASC` so the App can render a stable alphabetical list without
 * re-sorting.
 */
async function listActiveResorts(
  pool: DbPool,
): Promise<readonly ResortDTO[]> {
  // LEFT JOIN the active resort-representing Experience (Option A) so each
  // Resort carries the `experienceId` the client PUT/DELETEs a Completion
  // against. The join filters on `e.active = TRUE`, so an inactive Resort's
  // (soft-deleted) representing row yields `representing_experience_id = NULL`,
  // making the Resort uncompletable exactly as a missing/inactive Experience is
  // (R3.1, R3.3, R3.4). The partial UNIQUE index on `represents_resort_id`
  // guarantees at most one representing row per Resort, so the join cannot fan
  // a Resort into multiple rows.
  const result = await pool.query<ResortRow>(
    `SELECT r.id, r.name, r.description, r.image_url, r.latitude, r.longitude,
            r.address, r.phone,
            e.id AS representing_experience_id
       FROM resorts r
       LEFT JOIN experiences e
         ON e.represents_resort_id = r.id AND e.active = TRUE
      WHERE r.active = TRUE
      ORDER BY lower(r.name) ASC, r.id ASC`,
  );
  return result.rows.map(rowToResortDto);
}

// ---------------------------------------------------------------------------
// getExperience
// ---------------------------------------------------------------------------

/**
 * Fetch a single Experience by stable internal id, regardless of `active`.
 *
 * Returns `null` when no row matches. The detail view path may receive a
 * request for a soft-deleted Experience (e.g. the user has a Completion
 * for a row that has since been retired upstream); per R1.15 those rows
 * still exist on disk, so the repo returns them. The route layer is the
 * place where R1.18-R1.21 "active only" rules are enforced for the
 * browse path; this function exists for the detail path and downstream
 * services (Stats, Sharing) that need to read by id.
 */
async function getExperience(
  pool: DbPool,
  id: string,
): Promise<ExperienceDTO | null> {
  const result = await pool.query<ExperienceRow>(
    `SELECT id, upstream_entity_id, name, park, category, description, active,
            land, resort_area, world_showcase_country, image_url, latitude, longitude, area_type, resort_id,
            accessibility, price_tier, meal_periods,
            grouped_facets, height_requirement, why_this, sub_type
       FROM experiences
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? rowToDto(row) : null;
}

// ---------------------------------------------------------------------------
// listDestinationCounts
// ---------------------------------------------------------------------------

/**
 * Count active Experiences per Catalog_Home Destination in a single grouped
 * query (R3.6, R4.5, R4.6).
 *
 * The query groups active Experiences by `park` and `area_type`. From those
 * grouped rows two independent tallies are produced:
 *
 *   - Each of the seven `Park` Destinations sums the counts of active
 *     Experiences whose `park` equals that Destination (R3.6). `Resort`-area
 *     Experiences carry a `null` `park`, so they never contribute to a park
 *     Destination.
 *   - The aggregate `'Resorts'` Destination sums the counts of every active
 *     Experience whose `area_type` is `'Resort'` (R4.5), regardless of `park`.
 *
 * The result is seeded with all eight Destinations at `0` before folding in the
 * grouped rows, so a Destination with no active Experiences is returned with a
 * count of `0` (R4.6). Entries are emitted in the canonical grid order — the
 * seven `PARKS` values in order, then `'Resorts'`.
 */
async function listDestinationCounts(
  pool: DbPool,
): Promise<readonly DestinationCount[]> {
  const result = await pool.query<{
    park: Park | null;
    area_type: AreaType;
    count: number;
  }>(
    `SELECT park, area_type, count(*)::int AS count
       FROM experiences
      WHERE active = TRUE
      GROUP BY park, area_type`,
  );

  // Seed every Destination at zero so absent Destinations return 0 (R4.6).
  const counts = new Map<DestinationId, number>();
  for (const park of PARKS) {
    counts.set(park, 0);
  }
  counts.set('Resorts', 0);

  for (const row of result.rows) {
    if (row.area_type === 'Resort') {
      // Resorts Destination aggregates every active Resort-area Experience
      // (R4.5), independent of the (null) park value.
      counts.set('Resorts', (counts.get('Resorts') ?? 0) + row.count);
    } else if (row.park !== null) {
      // Park Destinations count by park (R3.6).
      counts.set(row.park, (counts.get(row.park) ?? 0) + row.count);
    }
  }

  const destinations: DestinationId[] = [...PARKS, 'Resorts'];
  return destinations.map((destination) => ({
    destination,
    count: counts.get(destination) ?? 0,
  }));
}

// ---------------------------------------------------------------------------
// getMenusFor
// ---------------------------------------------------------------------------

/**
 * Read the persisted menus for a restaurant Experience (R8.5). Returns an
 * empty array when the Experience has no `experience_menus` row — a
 * non-restaurant, or a restaurant whose menu fetch returned nothing / failed
 * (R8.3, R8.4). The `menus` JSONB column is decoded by the `pg` jsonb parser
 * straight into `MenuDTO[]`.
 */
async function getMenusFor(
  pool: DbPool,
  experienceId: string,
): Promise<readonly MenuDTO[]> {
  const result = await pool.query<MenuRow>(
    `SELECT menus
       FROM experience_menus
      WHERE experience_id = $1`,
    [experienceId],
  );
  const row = result.rows[0];
  return row ? row.menus : [];
}

// ---------------------------------------------------------------------------
// getMenuFetchState
// ---------------------------------------------------------------------------

/**
 * Read the lazy-retrieval state for a restaurant Experience in one query: the
 * Experience's `Enterprise_Id` and any cached menu with its `fetched_at`
 * (R8.2, R8.4).
 *
 * A LEFT JOIN is used so a restaurant that exists but has never had its menu
 * fetched still returns its `upstream_entity_id` (with `cached: null`), letting
 * the menu-retrieval seam decide to fetch. `null` is returned only when no
 * Experience matches the id at all. Because `experience_menus.fetched_at` is
 * `NOT NULL`, a present menu row always carries a `fetched_at`; the row is
 * treated as "no cache" only when the JOIN produced no menu row.
 */
async function getMenuFetchState(
  pool: DbPool,
  experienceId: string,
): Promise<MenuFetchState | null> {
  const result = await pool.query<MenuFetchRow>(
    `SELECT e.upstream_entity_id, m.menus, m.fetched_at
       FROM experiences e
       LEFT JOIN experience_menus m ON m.experience_id = e.id
      WHERE e.id = $1`,
    [experienceId],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const cached: MenuCacheEntry | null =
    row.fetched_at !== null && row.menus !== null
      ? { menus: row.menus, fetchedAt: row.fetched_at }
      : null;

  return { upstreamEntityId: row.upstream_entity_id, cached };
}

// ---------------------------------------------------------------------------
// upsertMenus
// ---------------------------------------------------------------------------

/**
 * Cache a freshly-fetched restaurant menu, stamping `fetched_at` with the
 * supplied instant so the freshness window restarts (R8.2). A conflict on the
 * `experience_id` primary key replaces the prior menu and its `fetched_at`. The
 * `menus` array is encoded as JSONB, matching {@link getMenusFor}'s round-trip.
 */
async function upsertMenus(
  pool: DbPool,
  experienceId: string,
  menus: readonly MenuDTO[],
  fetchedAt: Date,
): Promise<void> {
  await pool.query(
    `INSERT INTO experience_menus (experience_id, menus, fetched_at, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (experience_id) DO UPDATE SET
       menus      = EXCLUDED.menus,
       fetched_at = EXCLUDED.fetched_at,
       updated_at = now()`,
    [experienceId, JSON.stringify(menus), fetchedAt],
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Translate an `experiences` row into the wire DTO. Core fields (`id`, `name`,
 * `park`, `category`, `description`, `active`, `imageUrl`, `areaType`) are
 * always present; `imageUrl` and `park` may be `null`. The enrichment fields
 * are attached only when persisted (R5.6, R5.7): coordinates and `priceTier`
 * when non-null, `resortId` when the Experience references a Resort,
 * `accessibility` and `mealPeriods` when non-empty. `menus` is not attached
 * here — it is a detail-view concern served via {@link getMenusFor} and the
 * detail route (R8.5).
 */
function rowToDto(row: ExperienceRow): ExperienceDTO {
  const grouped = row.grouped_facets ?? {};
  const hasGrouped = Object.keys(grouped).length > 0;
  const { physicalConsiderations, interestFacets } = deriveFacetViews(grouped);
  return {
    id: row.id,
    name: row.name,
    park: row.park,
    category: row.category,
    description: row.description,
    active: row.active,
    imageUrl: row.image_url,
    areaType: row.area_type,
    ...(row.land !== null ? { land: row.land } : {}),
    ...(row.resort_area !== null ? { resortArea: row.resort_area } : {}),
    ...(row.world_showcase_country !== null
      ? { worldShowcaseCountry: row.world_showcase_country }
      : {}),
    ...(row.resort_id !== null ? { resortId: row.resort_id } : {}),
    ...(row.latitude !== null ? { latitude: row.latitude } : {}),
    ...(row.longitude !== null ? { longitude: row.longitude } : {}),
    ...(row.accessibility.length > 0
      ? { accessibility: row.accessibility }
      : {}),
    ...(row.price_tier !== null ? { priceTier: row.price_tier } : {}),
    ...(row.meal_periods.length > 0 ? { mealPeriods: row.meal_periods } : {}),
    ...(row.height_requirement !== null
      ? { heightRequirement: row.height_requirement }
      : {}),
    ...(hasGrouped ? { groupedFacets: grouped } : {}),
    ...(physicalConsiderations.length > 0 ? { physicalConsiderations } : {}),
    ...(Object.keys(interestFacets).length > 0 ? { interestFacets } : {}),
    ...(row.why_this !== null ? { whyThis: row.why_this } : {}),
    ...(row.sub_type !== null ? { subType: row.sub_type } : {}),
  };
}

/** Translate a `resorts` row into the wire {@link ResortDTO} (R6.8). */
function rowToResortDto(row: ResortRow): ResortDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    phone: row.phone,
    representingExperienceId: row.representing_experience_id ?? null,
  };
}

/**
 * Escape SQL-LIKE metacharacters so a user-supplied substring search
 * matches the literal characters rather than acting as a wildcard.
 *
 * Order matters: the backslash must be escaped first so subsequent
 * replacements do not double-escape it.
 */
function escapeLikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
