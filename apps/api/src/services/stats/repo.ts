/**
 * Stats_Service repository (task 11.1).
 *
 * Owns the single transaction snapshot the design's Stats_Service section
 * specifies: one read against `experiences` (denominators) and one read
 * against `completions JOIN experiences` (numerators), inside a
 * `REPEATABLE READ READ ONLY` transaction so both queries observe the
 * same point-in-time view of the catalog and the User's completions.
 *
 * The snapshot is returned as a list of `(park, category, completed,
 * total)` cells covering every `(Park, Experience_Category)` pair that
 * appears in the active catalog or in the User's completions. The route
 * layer rolls these cells up into the four response dimensions:
 *   - overall                           (R3.1)
 *   - byPark[park]                      (R3.2)
 *   - byCategory[category]              (R3.3)
 *   - byParkAndCategory[park][category] (R3.7 per-Park-per-Category cell)
 *
 * Why a single transaction:
 *
 *   - R3.5 requires that recomputed percentages match the latest catalog
 *     and completion state. Reading denominators and numerators in two
 *     separate, non-snapshot queries could observe a Catalog_Sync that
 *     soft-deleted an Experience between the reads, producing
 *     `numerator > denominator` for that slice and a percentage capped
 *     at 100 by `computePercent` rather than reflecting reality.
 *     `REPEATABLE READ` pins both queries to the same snapshot.
 *
 *   - R3.4 is a 2-second wall-clock SLA. Two grouped count queries on
 *     indexed columns (`experiences(active, park, category)` and
 *     `completions(user_id)` per `migrations/0001_init.sql`) are well
 *     under that budget, so we do not need to cache anything.
 *
 *   - `READ ONLY` is a sentinel: even if a future caller accidentally
 *     wires a write helper into this code path, Postgres will refuse it
 *     and the bug surfaces immediately rather than mutating data inside
 *     a stats request.
 *
 * Soft-deleted (`active = FALSE`) Experiences are excluded from BOTH the
 * numerator and the denominator. This matches R1.15 (preserve underlying
 * Completion rows) while keeping the percentages aligned to what the
 * User can currently see in the catalog.
 *
 * Validates: Requirements R3.1, R3.2, R3.3, R3.4, R3.5, R3.6, R3.7, R3.8.
 */

import type { AreaType, ExperienceCategory, Park } from '@dwt/shared';
import { AREA_TYPES, EXPERIENCE_CATEGORIES, PARKS } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One cell of the snapshot grid: counts for a single
 * `(Park, Experience_Category)` intersection.
 *
 * `total` is the count of currently-active Experiences with this
 * `(park, category)`; `completed` is the count of those Experiences that
 * the User has a Completion row for.
 *
 * The route layer never sees an unbounded set of cells because the
 * `(Park, Experience_Category)` cross product is bounded
 * (`PARKS.length * EXPERIENCE_CATEGORIES.length`).
 */
export interface StatsCell {
  /**
   * The owning Park, or `null` for Park-less rows (resort-area Experiences
   * and resort-representing rows). Park-less rows are retained in the
   * snapshot and simply do not contribute to the Park dimensions.
   */
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  /**
   * The kind of place the Experience belongs to, from the closed `AREA_TYPES`
   * set. Feeds the per-Area_Type roll-up.
   */
  readonly areaType: AreaType;
  /**
   * `true` when this cell counts resort-representing rows
   * (`represents_resort_id IS NOT NULL`) — the hotels-visited rows that back
   * the Resort_Statistic. Such rows are excluded from the Category and
   * Area_Type roll-ups and are the sole source of the Resort_Statistic.
   */
  readonly isResortRepresentation: boolean;
  readonly completed: number;
  readonly total: number;
}

/**
 * The full snapshot result: one cell per `(park, category)` pair that
 * appears in either the denominator or numerator query. Pairs that
 * appear in neither are omitted; the route layer treats absent pairs as
 * `{ completed: 0, total: 0 }` which `computePercent` turns into a `0.0`
 * percentage (R3.6, R3.7).
 */
export interface StatsSnapshot {
  readonly cells: readonly StatsCell[];
}

/**
 * Persistence surface exposed by the Stats_Service to its route layer.
 * A single method is enough because every Stats endpoint serves a
 * point-in-time snapshot for one User.
 */
export interface StatsRepo {
  /**
   * Read the four denominators and four numerators for `userId` inside a
   * `REPEATABLE READ READ ONLY` transaction.
   *
   * @throws The underlying `pg` error on connection failure or query
   *   error. Callers translate domain-level meaning at the route layer
   *   (e.g. unauthorized session ⇒ `unauthorized` envelope), but a raw
   *   DB error is allowed to propagate so the global error hook can
   *   produce the uniform `internal_error` envelope.
   */
  getStatsSnapshot(userId: string): Promise<StatsSnapshot>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Row shape returned by the denominator query. `total` is a `bigint` in
 * Postgres (because `COUNT(*)::bigint`) and `pg` represents that as a
 * decimal string — we parse it explicitly in `parseCount`.
 */
interface DenominatorRow {
  readonly park: string | null;
  readonly category: string;
  readonly area_type: string;
  readonly is_resort_representation: boolean;
  readonly total: string;
}

/** Row shape returned by the numerator query. `completed` is a `bigint`. */
interface NumeratorRow {
  readonly park: string | null;
  readonly category: string;
  readonly area_type: string;
  readonly is_resort_representation: boolean;
  readonly completed: string;
}

/**
 * Set of valid Park values for an O(1) drop-rogue-row check on the
 * grouped query results. The DB has CHECK constraints that match the
 * shared enum (`migrations/0001_init.sql`), but defending in depth here
 * means a future enum drift surfaces as a missing cell rather than a
 * type error at the wire boundary.
 */
const PARK_SET = new Set<string>(PARKS);

/** Set of valid ExperienceCategory values; mirror of `PARK_SET`. */
const CATEGORY_SET = new Set<string>(EXPERIENCE_CATEGORIES);

/**
 * Set of valid Area_Type values. A row is retained in the snapshot when its
 * `area_type` is a member of this closed set; unlike Park, an Area_Type is
 * always required (every active Experience carries one). Rows whose
 * `area_type` drifts out of the shared enum are dropped for the same
 * defence-in-depth reason as rogue Park/Category values.
 */
const AREA_TYPE_SET = new Set<string>(AREA_TYPES);

/**
 * Build a `StatsRepo` against the supplied pool. The repo holds no state;
 * each `getStatsSnapshot` call leases a dedicated client from the pool so
 * the `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` is scoped to one
 * caller.
 */
export function createStatsRepo(pool: DbPool): StatsRepo {
  return {
    async getStatsSnapshot(userId: string): Promise<StatsSnapshot> {
      const client = await pool.connect();
      try {
        // The two queries that follow MUST observe the same snapshot.
        // `REPEATABLE READ READ ONLY` pins the snapshot to BEGIN time; a
        // concurrent Catalog_Sync soft-delete or a concurrent Completion
        // mutation will not be visible to either query. `READ ONLY` is a
        // belt-and-suspenders sentinel against accidental writes inside
        // a stats request.
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

        const denominators = await client.query<DenominatorRow>(
          `SELECT park,
                  category,
                  area_type,
                  (represents_resort_id IS NOT NULL) AS is_resort_representation,
                  COUNT(*)::bigint AS total
             FROM experiences
            WHERE active = TRUE
            GROUP BY park, category, area_type, is_resort_representation`,
        );

        const numerators = await client.query<NumeratorRow>(
          `SELECT e.park      AS park,
                  e.category  AS category,
                  e.area_type AS area_type,
                  (e.represents_resort_id IS NOT NULL) AS is_resort_representation,
                  COUNT(*)::bigint AS completed
             FROM completions c
             JOIN experiences e ON e.id = c.experience_id
            WHERE c.user_id = $1
              AND e.active  = TRUE
            GROUP BY e.park, e.category, e.area_type, is_resort_representation`,
          [userId],
        );

        await client.query('COMMIT');

        return mergeRows(denominators.rows, numerators.rows);
      } catch (err) {
        // Best-effort rollback. We swallow any rollback error so the
        // original cause surfaces to the caller; if the original error
        // is itself a connection-level failure, ROLLBACK will fail
        // harmlessly and that failure has nothing useful to tell the
        // caller.
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
 * Merge the denominator and numerator grouped query results into a flat
 * list of `(park, category, area_type, is_resort_representation, completed,
 * total)` cells.
 *
 * A row is retained when its `category ∈ EXPERIENCE_CATEGORIES` and its
 * `area_type ∈ AREA_TYPES`. A Park is NO LONGER required: Park-less rows
 * (resort-area Experiences and resort-representing rows, where
 * `row.park === null`) are kept in the snapshot and simply do not contribute
 * to the Park dimensions at the route layer (R1.1, R1.3, R2.2). Any row whose
 * `category` or `area_type` is not part of the closed enum — or whose non-null
 * `park` is not a valid Park — is dropped silently, since it would have no
 * place in the typed `StatsResponse` (defence-in-depth against a DB CHECK
 * constraint drifting from the application enum).
 *
 * Cells are keyed by their full grouping tuple
 * `(park, category, area_type, is_resort_representation)`. The key MUST include
 * every grouping column because `park` can be `null` and multiple distinct
 * Park-less cells coexist (e.g. a resort-area Restaurant vs. a resort-
 * representing `Other` row) — keying on `(park, category)` alone would collide
 * them.
 *
 * Exported for direct unit testing of the merge logic without a live DB.
 */
export function mergeRows(
  denominatorRows: readonly DenominatorRow[],
  numeratorRows: readonly NumeratorRow[],
): StatsSnapshot {
  // Map keyed by the full grouping tuple so we can fold the two query
  // result sets into a single pass without quadratic lookups.
  type CellAccumulator = {
    park: Park | null;
    category: ExperienceCategory;
    areaType: AreaType;
    isResortRepresentation: boolean;
    completed: number;
    total: number;
  };
  const cellMap = new Map<string, CellAccumulator>();

  // `park` may be null; a literal string sentinel keeps null distinct from any
  // real Park name. The full tuple is required so Park-less cells that share a
  // (park, category) pair but differ by area_type or representation flag do not
  // collide.
  const keyOf = (
    park: string | null,
    category: string,
    areaType: string,
    isResortRepresentation: boolean,
  ): string =>
    `${park ?? '\u0000null'}|${category}|${areaType}|${isResortRepresentation ? '1' : '0'}`;

  const isRetained = (park: string | null, category: string, areaType: string): boolean =>
    (park === null || PARK_SET.has(park)) &&
    CATEGORY_SET.has(category) &&
    AREA_TYPE_SET.has(areaType);

  for (const row of denominatorRows) {
    if (!isRetained(row.park, row.category, row.area_type)) {
      continue;
    }
    const total = parseCount(row.total);
    const key = keyOf(
      row.park,
      row.category,
      row.area_type,
      row.is_resort_representation,
    );
    const existing = cellMap.get(key);
    if (existing) {
      existing.total = total;
    } else {
      cellMap.set(key, {
        park: row.park as Park | null,
        category: row.category as ExperienceCategory,
        areaType: row.area_type as AreaType,
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
    const completed = parseCount(row.completed);
    const key = keyOf(
      row.park,
      row.category,
      row.area_type,
      row.is_resort_representation,
    );
    const existing = cellMap.get(key);
    if (existing) {
      existing.completed = completed;
    } else {
      // A user can have a Completion against an Experience whose row
      // disappeared from the active set between sync runs, but the
      // numerator query already filters on `e.active = TRUE`. So this
      // branch normally only fires when an Experience exists and is
      // active but never produced a denominator row — which is
      // structurally impossible (every active row contributes to its
      // own grouping cell). Defending against it costs nothing and keeps
      // the helper total over its inputs.
      cellMap.set(key, {
        park: row.park as Park | null,
        category: row.category as ExperienceCategory,
        areaType: row.area_type as AreaType,
        isResortRepresentation: row.is_resort_representation,
        completed,
        total: 0,
      });
    }
  }

  return { cells: Array.from(cellMap.values()) };
}

/**
 * Parse a Postgres `bigint` column representation (a decimal string) into
 * a JavaScript number. Disney World has at most a few hundred active
 * Experiences per Park, so the count fits well inside `Number.MAX_SAFE_INTEGER`.
 */
function parseCount(value: string): number {
  return Number.parseInt(value, 10);
}
