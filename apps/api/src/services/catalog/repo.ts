/**
 * Catalog_Service repository.
 *
 * The repo is the single point of contact between the Catalog_Service and
 * the Postgres tables that back the catalog (`experiences`,
 * `catalog_sync_runs`, `catalog_cache_metadata`). It exposes:
 *
 *   - `getCacheAge`            — read the singleton metadata row and report
 *                                how long ago the most recent successful
 *                                sync completed (R1.11, R1.12).
 *   - `applyReconciliation`    — apply the pure-function diff produced by
 *                                `reconcile()` against the live cache, in
 *                                a single transaction (R1.14, R1.15, R1.16).
 *   - `recordSyncRun`          — insert a row in `catalog_sync_runs` with
 *                                the run outcome and (on success) update
 *                                `catalog_cache_metadata.last_successful_
 *                                sync_at` so the next read knows the cache
 *                                is fresh (R1.9, R1.13).
 *   - `listActiveExperiences`  — read the catalog with optional `parkId`,
 *                                `category`, and case-insensitive substring
 *                                `q` filters; returns rows ordered by Park
 *                                then `lower(name)` so the client can
 *                                group by Park without re-sorting (the
 *                                ordering matches the route's contract;
 *                                see task 9.6).
 *   - `getExperience`          — fetch a single Experience by id, regardless
 *                                of `active`, so the detail view can still
 *                                render a soft-deleted Experience the user
 *                                has a Completion/Rating/Note for.
 *
 * Soft-delete is applied by flipping `active = false` on the row; the row
 * itself is never deleted, so all foreign-key references from
 * `completions`, `ratings`, and `notes` remain valid (R1.15). Reactivation
 * (a previously soft-deleted upstream id reappearing) flows through the
 * same upsert path as a brand-new row, with `active` set back to `true`.
 *
 * Description text is sanitized via `sanitizeDescription` before being
 * persisted (design.md Security and Privacy Notes: "strips any HTML or
 * script content from upstream description fields before persisting").
 *
 * Validates: Requirements 1.7, 1.9, 1.13, 1.14, 1.15, 1.16
 */

import type { QueryResultRow } from 'pg';
import type { ExperienceCategory, ExperienceDTO, Park } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { sanitizeDescription } from './sanitize.js';
import type { CatalogCacheRow, ReconcileResult } from './types.js';

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
 * - `q`        — case-insensitive substring match on `experiences.name`.
 *                Whitespace-only queries are treated as "no query"; this
 *                mirrors R1.20's "1 non-whitespace character" floor for the
 *                client-visible search behavior. The route layer is still
 *                free to do its own pre-validation; this is defense in
 *                depth.
 */
export interface CatalogListFilters {
  readonly park?: Park;
  readonly category?: ExperienceCategory;
  readonly q?: string;
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
 * `BOOLEAN` as `boolean` through `pg`, and the CHECK constraints on `park`
 * and `category` guarantee the column values are inside the corresponding
 * enums. We still narrow the types here so the public DTO mapping does not
 * need a cast.
 */
interface ExperienceRow extends QueryResultRow {
  id: string;
  upstream_entity_id: string;
  name: string;
  park: Park;
  category: ExperienceCategory;
  description: string;
  active: boolean;
  image_url: string | null;
  image_attribution: string | null;
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
  applyReconciliation(diff: ReconcileResult): Promise<void>;
  recordSyncRun(input: RecordSyncRunInput): Promise<RecordedSyncRun>;
  listActiveExperiences(
    filters?: CatalogListFilters,
  ): Promise<readonly ExperienceDTO[]>;
  getExperience(id: string): Promise<ExperienceDTO | null>;
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
    applyReconciliation: (diff) => applyReconciliation(pool, diff),
    recordSyncRun: (input) => recordSyncRun(pool, input),
    listActiveExperiences: (filters) =>
      listActiveExperiences(pool, filters ?? {}),
    getExperience: (id) => getExperience(pool, id),
  };
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
 * (R1.16) only consider `name`, `park`, and `category` as material change
 * signals, and reading description would only inflate the snapshot.
 */
async function getCacheSnapshot(
  pool: DbPool,
): Promise<readonly CatalogCacheRow[]> {
  const result = await pool.query<ExperienceRow>(
    `SELECT id, upstream_entity_id, name, park, category, description, active
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
  };
}

// ---------------------------------------------------------------------------
// applyReconciliation
// ---------------------------------------------------------------------------

/**
 * Apply the diff produced by `reconcile(...)`. Runs inside a single
 * transaction so a partial failure leaves the cache untouched (R1.13's
 * "retain the prior cache contents unchanged" requirement, applied at the
 * write boundary).
 *
 * For each upsert, we:
 *
 *   - INSERT the row with the supplied id, upstream_entity_id, name, park,
 *     category, description (sanitized), and active = TRUE; or, on
 *     conflict on the primary key id, UPDATE name/park/category/description
 *     and flip active back to TRUE. Reactivation (rule (b) in
 *     `reconcile.ts`) and metadata drift (rule (c)) flow through the same
 *     statement, which keeps the SQL surface minimal.
 *
 *   - The `upstream_entity_id` column also has a UNIQUE constraint
 *     (migration `0001_init.sql`). The `id` is a deterministic UUIDv5 of
 *     the upstream id, so the upstream_entity_id column tracks the id
 *     1:1; we still set it on every upsert because the reconcile contract
 *     guarantees the values match. We do not specify ON CONFLICT
 *     (upstream_entity_id) because conflict on the primary key is the
 *     primary path; reaching the unique upstream_entity_id constraint
 *     while not conflicting on id would imply a bug in `internalId`.
 *
 * For each soft-delete, we flip `active = false` on the matching row,
 * preserving every other field so historical data is undisturbed (R1.15).
 *
 * The `updated_at` column is bumped to `now()` on every writing path so
 * the metadata row's `last_successful_sync_at` and `experiences.updated_at`
 * stay coherent.
 */
async function applyReconciliation(
  pool: DbPool,
  diff: ReconcileResult,
): Promise<void> {
  // Skip the connection round-trip when there is nothing to do — this is
  // common when the upstream set has not changed between syncs.
  if (diff.upserts.length === 0 && diff.softDeletes.length === 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const upsert of diff.upserts) {
      await client.query(
        `INSERT INTO experiences (
           id, upstream_entity_id, name, park, category, description, active, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, now())
         ON CONFLICT (id) DO UPDATE SET
           upstream_entity_id = EXCLUDED.upstream_entity_id,
           name               = EXCLUDED.name,
           park               = EXCLUDED.park,
           category           = EXCLUDED.category,
           description        = EXCLUDED.description,
           active             = TRUE,
           updated_at         = now()`,
        [
          upsert.id,
          upsert.upstreamEntityId,
          upsert.name,
          upsert.park,
          upsert.category,
          sanitizeDescription(upsert.description),
        ],
      );
    }

    for (const soft of diff.softDeletes) {
      await client.query(
        `UPDATE experiences
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
         status, started_at, finished_at, error_class, error_message, entities_processed
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.status,
        input.startedAt,
        input.finishedAt ?? null,
        input.errorClass ?? null,
        input.errorMessage ?? null,
        input.entitiesProcessed ?? null,
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
           image_url, image_attribution
      FROM experiences
     WHERE ${where.join(' AND ')}
     ORDER BY park ASC, lower(name) ASC, id ASC`;

  const result = await pool.query<ExperienceRow>(sql, params);
  return result.rows.map(rowToDto);
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
            image_url, image_attribution
       FROM experiences
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? rowToDto(row) : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Translate an `experiences` row into the wire DTO. The mapping is total
 * because the migration's CHECK constraints guarantee the input shape.
 */
function rowToDto(row: ExperienceRow): ExperienceDTO {
  return {
    id: row.id,
    name: row.name,
    park: row.park,
    category: row.category,
    description: row.description,
    active: row.active,
    imageUrl: row.image_url,
    imageAttribution: row.image_attribution,
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
