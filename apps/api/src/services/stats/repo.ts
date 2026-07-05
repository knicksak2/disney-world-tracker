/**
 * Stats_Service snapshot repository (expanded-stats task 6.1).
 *
 * Owns the single point-in-time transaction the design's Stats_Service section
 * mandates. Every per-user statistic the expanded Stats_Page surfaces —
 * Coverage_Statistics, Rating_Statistics, and the opt-in Percentile_Rank — is
 * derived from raw material read INSIDE ONE
 * `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` block, so all numerators and
 * denominators observe the same catalog / completion / rating state pinned at
 * `BEGIN` (R8.1, R8.3). A `Catalog_Sync`, `Completion`, or `Rating` mutation
 * committed after `BEGIN` is invisible to the request.
 *
 * The repository is deliberately "dumb": it reads rows and folds nothing. The
 * pure roll-up layer owns every reported statistic:
 *
 *   - `coverage`        → `coverage.ts::rollUpCoverage`   (Requirements 1, 2)
 *   - `facetExperiences`→ `facets.ts::rollUpFacets`       (Requirement 3)
 *   - `userRatings`     → `ratingStats.ts::rollUpRatings` (Requirements 4, 5, 6)
 *   - `percentile`      → `percentile.ts::computePercentileRank` (Requirement 7)
 *
 * Keeping the raw `land` / `resort_area` values un-normalized and the
 * `grouped_facets` JSONB un-flattened lets the pure layer apply the trim +
 * case-insensitive Land/Resort_Area normalization (R1.6–R1.9) and the exact-key
 * facet grouping (R3.4, R3.7) in exactly one, independently-testable place.
 *
 * Why the single transaction (design "Live vs. cached boundary", R8):
 *
 *   - R8.1 / R8.3 require every numerator and denominator to observe one
 *     snapshot. Reading them in separate, non-snapshot statements could observe
 *     a Catalog_Sync soft-delete between reads and yield `numerator > denominator`
 *     for a slice. `REPEATABLE READ` pins the snapshot to `BEGIN`.
 *   - `READ ONLY` is a sentinel: if a write helper is ever wired into this path,
 *     Postgres refuses it and the bug surfaces immediately rather than mutating
 *     data inside a stats request.
 *   - R8.6: if the transaction fails to begin, commit, or is aborted before the
 *     values are read, the underlying error PROPAGATES. The route maps it to
 *     `stats_unavailable`; no partial or precomputed per-user statistic is
 *     returned. Nothing here reads a per-user statistic from a cache (R8.2); the
 *     Global_Aggregate ratings and the highest-rated leaderboard keep their own
 *     read paths and are untouched by this repository (R8.4, R8.5).
 *
 * Soft-deleted (`active = FALSE`) Experiences are excluded from every read, so
 * they contribute to neither the numerator nor the denominator of any statistic
 * (R1.10, R3.x, R4.5, R5.4, R6.5).
 *
 * Validates: Requirements 1.2, 1.6, 1.7, 1.8, 1.9, 1.10, 3.1, 4.5, 5.4, 6.5,
 * 7.1, 7.2, 8.1, 8.2, 8.3, 8.6.
 */

import type {
  ExperienceCategory,
  GroupedFacetsDTO,
  Park,
} from '@dwt/shared';
import {
  AREA_TYPES,
  EXPERIENCE_CATEGORIES,
  PARKS,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import type { RawCoverageCell } from './coverage.js';
import type { RawFacetExperienceRow } from './facets.js';
import type { RawUserRatingRow } from './ratingStats.js';
import type { RawResortCoverageRow } from './resorts.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Input to `getStatsSnapshot`: the Target_User whose statistics are read, and
 * whether the (expensive, all-tracker) Percentile_Rank material should be read.
 *
 * `includePercentile` gates the only read that scans beyond the Target_User's
 * own rows (R7.2): when `false`, no percentile query is issued and
 * `StatsSnapshot.percentile` is `null`.
 */
export interface StatsSnapshotInput {
  readonly targetUserId: string;
  readonly includePercentile: boolean;
  /**
   * Optional per-request statement timeout (milliseconds) applied inside the
   * snapshot transaction via a transaction-local `statement_timeout`. When
   * set, a statement that exceeds it is cancelled by Postgres (SQLSTATE
   * `57014`), the transaction rolls back, and the error propagates so the
   * route maps it to `stats_timeout` with no partial statistics (R7.8, R11.3).
   * When omitted, no per-request timeout is set (the server default applies).
   */
  readonly statementTimeoutMs?: number;
}

/**
 * Percentile ranking material read only when `includePercentile` is `true`.
 *
 * `targetTotal` is the Target_User's active-completion count; `otherTotals` is
 * one entry per OTHER tracker with at least one active completion. The pure
 * `percentile.ts` layer turns these into the Percentile_Rank; it is never
 * persisted or cached (R7.1, R7.7).
 */
export interface PercentileInput {
  readonly targetTotal: number;
  readonly otherTotals: readonly number[];
}

/**
 * The full raw material read for one stats request inside the single
 * `REPEATABLE READ READ ONLY` transaction. Each field feeds exactly one pure
 * roll-up module; nothing here is pre-aggregated across dimensions.
 */
export interface StatsSnapshot {
  /** Pre-grouped coverage cells over active experiences (→ `rollUpCoverage`). */
  readonly coverage: readonly RawCoverageCell[];
  /** One row per active experience with its facets (→ `rollUpFacets`). */
  readonly facetExperiences: readonly RawFacetExperienceRow[];
  /** The Target_User's ratings on active experiences (→ `rollUpRatings`). */
  readonly userRatings: readonly RawUserRatingRow[];
  /**
   * Merged per-resort activity-completion counts, one row per resort that owns
   * at least one active, non-representing resort-linked Experience
   * (→ `rollUpResortCoverage`). Empty when no such experiences exist.
   */
  readonly resortCoverage: readonly RawResortCoverageRow[];
  /** Percentile material, or `null` when not requested (→ `computePercentileRank`). */
  readonly percentile: PercentileInput | null;
}

/**
 * Persistence surface exposed by the Stats_Service to its route layer. A single
 * method is enough because every Stats endpoint serves one point-in-time
 * snapshot for one Target_User.
 */
export interface StatsRepo {
  /**
   * Read all raw statistic material for `input.targetUserId` inside one
   * `REPEATABLE READ READ ONLY` transaction.
   *
   * @throws The underlying `pg` error on connection failure, a failed
   *   `BEGIN`/`COMMIT`, or an aborted transaction. The error is allowed to
   *   propagate so the route maps it to `stats_unavailable` and returns no
   *   partial or precomputed per-user statistics (R8.6).
   */
  getStatsSnapshot(input: StatsSnapshotInput): Promise<StatsSnapshot>;
}

// Re-export the pure-module input types so consumers (routes, tests) can import
// the whole snapshot contract from one place.
export type { RawCoverageCell } from './coverage.js';
export type { RawFacetExperienceRow } from './facets.js';
export type { RawUserRatingRow } from './ratingStats.js';
export type { RawResortCoverageRow } from './resorts.js';

// ---------------------------------------------------------------------------
// Row shapes returned by the SQL
// ---------------------------------------------------------------------------

/** Denominator query row. `total` is a `bigint` (decimal string from `pg`). */
interface DenominatorRow {
  readonly park: string | null;
  readonly category: string;
  readonly area_type: string;
  readonly land: string | null;
  readonly resort_area: string | null;
  readonly is_resort_representation: boolean;
  readonly total: string;
}

/** Numerator query row. `completed` is a `bigint`. */
interface NumeratorRow {
  readonly park: string | null;
  readonly category: string;
  readonly area_type: string;
  readonly land: string | null;
  readonly resort_area: string | null;
  readonly is_resort_representation: boolean;
  readonly completed: string;
}

/** Facet query row: one per active experience. */
interface FacetRow {
  readonly experience_id: string;
  readonly completed_by_user: boolean;
  readonly grouped_facets: unknown;
}

/** Rating query row: one per active rating held by the Target_User. */
interface RatingRow {
  readonly experience_id: string;
  readonly experience_name: string;
  readonly value: number;
  readonly park: string | null;
  readonly category: string;
}

/** Percentile query row: one per tracker with >= 1 active completion. */
interface PercentileRow {
  readonly user_id: string;
  readonly total: string;
}

/**
 * Per-resort denominator row: one per resort that owns >= 1 active,
 * non-representing resort-linked experience. `total` is a `bigint`.
 */
interface ResortDenominatorRow {
  readonly resort_id: string;
  readonly resort_name: string;
  readonly total: string;
}

/**
 * Per-resort numerator row: the Target_User's completions among a resort's
 * active, non-representing resort-linked experiences. `completed` is a `bigint`.
 */
interface ResortNumeratorRow {
  readonly resort_id: string;
  readonly completed: string;
}

// ---------------------------------------------------------------------------
// Defence-in-depth enum guards
// ---------------------------------------------------------------------------

/**
 * The DB has CHECK constraints matching the shared enums, but guarding here
 * means a future enum drift surfaces as a dropped cell rather than an invalid
 * value crossing the wire boundary.
 */
const PARK_SET = new Set<string>(PARKS);
const CATEGORY_SET = new Set<string>(EXPERIENCE_CATEGORIES);
const AREA_TYPE_SET = new Set<string>(AREA_TYPES);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build a `StatsRepo` against the supplied pool. The repo holds no state; each
 * `getStatsSnapshot` call leases a dedicated client so the
 * `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` is scoped to one caller.
 */
export function createStatsRepo(pool: DbPool): StatsRepo {
  return {
    async getStatsSnapshot(input: StatsSnapshotInput): Promise<StatsSnapshot> {
      const { targetUserId, includePercentile, statementTimeoutMs } = input;
      const client = await pool.connect();
      try {
        // Every read below MUST observe the same snapshot. REPEATABLE READ
        // pins it to BEGIN time; READ ONLY refuses accidental writes (R8.1,
        // R8.3). A failure to BEGIN propagates to the caller (R8.6).
        await client.query(
          'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
        );

        // Per-request statement timeout, sized to the SLA by the route (R7.8,
        // R11.3). `set_config(..., is_local => true)` scopes it to THIS
        // transaction so a leased client can never leak the setting to the
        // next borrower. A statement that overruns is cancelled (SQLSTATE
        // 57014), the transaction rolls back, and the error propagates — no
        // partial statistics escape.
        if (statementTimeoutMs !== undefined) {
          await client.query(
            "SELECT set_config('statement_timeout', $1, true)",
            [String(statementTimeoutMs)],
          );
        }

        // 1. Coverage denominators — active experiences grouped by the full
        //    coverage tuple, keeping raw land / resort_area (R1.2, R1.6–R1.9).
        const denominators = await client.query<DenominatorRow>(
          `SELECT park,
                  category,
                  area_type,
                  land,
                  resort_area,
                  (represents_resort_id IS NOT NULL) AS is_resort_representation,
                  COUNT(*)::bigint AS total
             FROM experiences
            WHERE active = TRUE
            GROUP BY park, category, area_type, land, resort_area, is_resort_representation`,
        );

        // 2. Coverage numerators — the same grouping restricted to the
        //    Target_User's completions of active experiences (R1.2, R1.10).
        const numerators = await client.query<NumeratorRow>(
          `SELECT e.park       AS park,
                  e.category   AS category,
                  e.area_type  AS area_type,
                  e.land       AS land,
                  e.resort_area AS resort_area,
                  (e.represents_resort_id IS NOT NULL) AS is_resort_representation,
                  COUNT(*)::bigint AS completed
             FROM completions c
             JOIN experiences e ON e.id = c.experience_id
            WHERE c.user_id = $1
              AND e.active  = TRUE
            GROUP BY e.park, e.category, e.area_type, e.land, e.resort_area, is_resort_representation`,
          [targetUserId],
        );

        // 3. Facet rows — one per active experience: its id, whether the
        //    Target_User completed it, and its grouped_facets JSONB (which
        //    contains both Grouped_Facets and, as a derived subset,
        //    Interest_Facets). Unnest/dedup happens in facets.ts (R3.1).
        const facets = await client.query<FacetRow>(
          `SELECT e.id AS experience_id,
                  (c.user_id IS NOT NULL) AS completed_by_user,
                  e.grouped_facets AS grouped_facets
             FROM experiences e
             LEFT JOIN completions c
               ON c.experience_id = e.id
              AND c.user_id = $1
            WHERE e.active = TRUE`,
          [targetUserId],
        );

        // 4. Rating rows — the Target_User's ratings on active experiences
        //    only (R4.5, R5.4, R6.5). Gating/averages happen in ratingStats.ts.
        const ratings = await client.query<RatingRow>(
          `SELECT e.id       AS experience_id,
                  e.name     AS experience_name,
                  r.value    AS value,
                  e.park     AS park,
                  e.category AS category
             FROM ratings r
             JOIN experiences e ON e.id = r.experience_id
            WHERE r.user_id = $1
              AND e.active  = TRUE`,
          [targetUserId],
        );

        // 5. Percentile material — only when requested (R7.2). Per-user active
        //    completion totals; every returned row has total >= 1 because
        //    COUNT over a GROUP BY only yields groups with >= 1 row (R7.1).
        let percentile: PercentileInput | null = null;
        if (includePercentile) {
          const percentileRows = await client.query<PercentileRow>(
            `SELECT c.user_id AS user_id,
                    COUNT(*)::bigint AS total
               FROM completions c
               JOIN experiences e ON e.id = c.experience_id
              WHERE e.active = TRUE
              GROUP BY c.user_id`,
          );
          percentile = buildPercentileInput(percentileRows.rows, targetUserId);
        }

        // 6. Per-resort activity-completion denominators — active experiences
        //    grouped by resort_id, joined to `resorts` for the display name,
        //    excluding inactive resorts/experiences and resort-representing
        //    stand-in rows so `byResort` stays independent of the hotels-visited
        //    `coverage.resort` stat (R7.1, R7.2, R7.3, R7.4).
        const resortDenominators = await client.query<ResortDenominatorRow>(
          `SELECT e.resort_id      AS resort_id,
                  r.name           AS resort_name,
                  COUNT(*)::bigint AS total
             FROM experiences e
             JOIN resorts r ON r.id = e.resort_id AND r.active = TRUE
            WHERE e.active = TRUE
              AND e.resort_id IS NOT NULL
              AND e.represents_resort_id IS NULL
            GROUP BY e.resort_id, r.name`,
        );

        // 7. Per-resort activity-completion numerators — the same grouping
        //    restricted to the Target_User's completions of those active
        //    resort-linked experiences (R7.1, R7.3).
        const resortNumerators = await client.query<ResortNumeratorRow>(
          `SELECT e.resort_id      AS resort_id,
                  COUNT(*)::bigint AS completed
             FROM completions c
             JOIN experiences e ON e.id = c.experience_id
            WHERE c.user_id = $1
              AND e.active = TRUE
              AND e.resort_id IS NOT NULL
              AND e.represents_resort_id IS NULL
            GROUP BY e.resort_id`,
          [targetUserId],
        );

        await client.query('COMMIT');

        return {
          coverage: mergeCoverageRows(denominators.rows, numerators.rows),
          facetExperiences: mapFacetRows(facets.rows),
          userRatings: mapRatingRows(ratings.rows),
          resortCoverage: mergeResortCoverageRows(
            resortDenominators.rows,
            resortNumerators.rows,
          ),
          percentile,
        };
      } catch (err) {
        // Best-effort rollback; swallow any rollback error so the original
        // cause surfaces to the caller (R8.6). A connection-level failure makes
        // ROLLBACK fail harmlessly and it has nothing useful to add.
        try {
          await client.query('ROLLBACK');
        } catch {
          // intentionally ignored
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Merge the denominator and numerator grouped result sets into a flat list of
 * `RawCoverageCell`, keyed by the full coverage tuple
 * `(park, category, area_type, land, resort_area, is_resort_representation)`.
 *
 * A row is retained when its `category ∈ EXPERIENCE_CATEGORIES` and its
 * `area_type ∈ AREA_TYPES`, and its `park` is either `null` (Park-less
 * resort-area / resort-representing rows) or a valid Park. Rows drifting outside
 * the closed enums are dropped (defence-in-depth). Raw `land` / `resort_area`
 * are preserved untrimmed and original-case so `coverage.ts` owns the
 * normalization (R1.6–R1.9).
 *
 * The key MUST include every grouping column because `park`, `land`, and
 * `resort_area` can each be `null` and multiple distinct cells can share a
 * subset of columns; keying on fewer columns would collide them.
 *
 * Exported for direct unit testing of the merge without a live DB.
 */
export function mergeCoverageRows(
  denominatorRows: readonly DenominatorRow[],
  numeratorRows: readonly NumeratorRow[],
): RawCoverageCell[] {
  type CellAccumulator = {
    park: Park | null;
    category: ExperienceCategory;
    areaType: RawCoverageCell['areaType'];
    land: string | null;
    resortArea: string | null;
    isResortRepresentation: boolean;
    completed: number;
    total: number;
  };
  const cellMap = new Map<string, CellAccumulator>();

  // `\u0000null` is a sentinel that keeps a null column distinct from any real
  // value; `\u0001` separates columns so values cannot run together.
  const NULL = '\u0000null';
  const SEP = '\u0001';
  const keyOf = (
    park: string | null,
    category: string,
    areaType: string,
    land: string | null,
    resortArea: string | null,
    isResortRepresentation: boolean,
  ): string =>
    [
      park ?? NULL,
      category,
      areaType,
      land ?? NULL,
      resortArea ?? NULL,
      isResortRepresentation ? '1' : '0',
    ].join(SEP);

  const isRetained = (
    park: string | null,
    category: string,
    areaType: string,
  ): boolean =>
    (park === null || PARK_SET.has(park)) &&
    CATEGORY_SET.has(category) &&
    AREA_TYPE_SET.has(areaType);

  for (const row of denominatorRows) {
    if (!isRetained(row.park, row.category, row.area_type)) {
      continue;
    }
    const key = keyOf(
      row.park,
      row.category,
      row.area_type,
      row.land,
      row.resort_area,
      row.is_resort_representation,
    );
    const total = parseCount(row.total);
    const existing = cellMap.get(key);
    if (existing) {
      existing.total = total;
    } else {
      cellMap.set(key, {
        park: row.park as Park | null,
        category: row.category as ExperienceCategory,
        areaType: row.area_type as RawCoverageCell['areaType'],
        land: row.land,
        resortArea: row.resort_area,
        isResortRepresentation: row.is_resort_representation,
        completed: 0,
        total,
      });
    }
  }

  for (const row of numeratorRows) {
    if (!isRetained(row.park, row.category, row.area_type)) {
      continue;
    }
    const key = keyOf(
      row.park,
      row.category,
      row.area_type,
      row.land,
      row.resort_area,
      row.is_resort_representation,
    );
    const completed = parseCount(row.completed);
    const existing = cellMap.get(key);
    if (existing) {
      existing.completed = completed;
    } else {
      // Structurally rare: every active row that produces a numerator also
      // produces a denominator, so this branch normally never fires. Handling
      // it keeps the merge total over its inputs.
      cellMap.set(key, {
        park: row.park as Park | null,
        category: row.category as ExperienceCategory,
        areaType: row.area_type as RawCoverageCell['areaType'],
        land: row.land,
        resortArea: row.resort_area,
        isResortRepresentation: row.is_resort_representation,
        completed,
        total: 0,
      });
    }
  }

  return Array.from(cellMap.values());
}

/**
 * Merge the per-resort denominator and numerator grouped result sets into a
 * flat list of `RawResortCoverageRow`, keyed by `resort_id`.
 *
 * The denominator read is authoritative for the resort set: it yields exactly
 * the resorts that own >= 1 active, non-representing resort-linked experience,
 * carrying the resort's `name` as the label and guaranteeing `total >= 1`
 * (R7.4, R7.5). Numerator rows only attach the Target_User's completion count
 * to a resort already present in the denominators; a numerator with no matching
 * denominator cannot occur (every completed experience is also counted in the
 * denominator's active set), so such rows are ignored defensively.
 *
 * Grouping by `resort_id` in SQL guarantees one row per resort in each result
 * set, so the merged output carries no duplicate `resortId` (R7.10). The repo
 * folds nothing beyond the numerator/denominator join; `rollUpResortCoverage`
 * owns the cell laws and ordering.
 *
 * Exported for direct unit testing of the merge without a live DB.
 */
export function mergeResortCoverageRows(
  denominatorRows: readonly ResortDenominatorRow[],
  numeratorRows: readonly ResortNumeratorRow[],
): RawResortCoverageRow[] {
  const completedByResort = new Map<string, number>();
  for (const row of numeratorRows) {
    completedByResort.set(row.resort_id, parseCount(row.completed));
  }

  return denominatorRows.map((row) => ({
    resortId: row.resort_id,
    label: row.resort_name,
    completed: completedByResort.get(row.resort_id) ?? 0,
    total: parseCount(row.total),
  }));
}

/**
 * Map facet query rows into `RawFacetExperienceRow`. The `grouped_facets`
 * column is JSONB, which `pg` parses into a JS object; a non-object value
 * (defensively) becomes an empty `{}` so the pure layer sees a well-typed map.
 */
function mapFacetRows(rows: readonly FacetRow[]): RawFacetExperienceRow[] {
  return rows.map((row) => ({
    experienceId: row.experience_id,
    completedByUser: row.completed_by_user,
    groupedFacets: normalizeGroupedFacets(row.grouped_facets),
  }));
}

/**
 * Narrow the JSONB `grouped_facets` value to a `GroupedFacetsDTO`. `pg` already
 * parses JSONB, so this is a plain object in the common case; a null or
 * non-object value is coerced to `{}`. Per-group / per-entry shape validation
 * is `facets.ts`'s responsibility (it skips malformed groups and entries).
 */
function normalizeGroupedFacets(value: unknown): GroupedFacetsDTO {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as GroupedFacetsDTO;
  }
  return {} as GroupedFacetsDTO;
}

/**
 * Map rating query rows into `RawUserRatingRow`. `park` is retained as-is
 * (nullable for resort-area experiences); the pure layer skips null-Park rows
 * for the per-Park average (R4.2). Category is passed through untyped-narrowed
 * because the DB CHECK guarantees membership in the closed set.
 */
function mapRatingRows(rows: readonly RatingRow[]): RawUserRatingRow[] {
  return rows.map((row) => ({
    experienceId: row.experience_id,
    experienceName: row.experience_name,
    value: row.value,
    park: row.park as Park | null,
    category: row.category as ExperienceCategory,
  }));
}

/**
 * Fold per-user completion totals into `PercentileInput`: the Target_User's own
 * total (0 when absent, i.e. the Target_User has zero active completions,
 * R7.6), and every OTHER tracker's total (each >= 1). Ordering is irrelevant to
 * the pure percentile computation.
 */
export function buildPercentileInput(
  rows: readonly PercentileRow[],
  targetUserId: string,
): PercentileInput {
  let targetTotal = 0;
  const otherTotals: number[] = [];
  for (const row of rows) {
    const total = parseCount(row.total);
    if (row.user_id === targetUserId) {
      targetTotal = total;
    } else {
      otherTotals.push(total);
    }
  }
  return { targetTotal, otherTotals };
}

/**
 * Parse a Postgres `bigint` (a decimal string from `pg`) into a JS number.
 * Completion / experience counts fit well inside `Number.MAX_SAFE_INTEGER`.
 */
function parseCount(value: string): number {
  return Number.parseInt(value, 10);
}
