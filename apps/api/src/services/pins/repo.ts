/**
 * Pin_Service — persistence + snapshot assembly.
 *
 * The repo is the only I/O layer of the Pin_Service: it reads a User's raw
 * activity from Postgres, folds it into the pure `PinActivitySnapshot` the
 * evaluator consumes, projects the Pin Board, and performs the idempotent award
 * insert. All rule logic stays in `evaluator.ts` (pure); this module owns SQL
 * and the two predicate definitions that must live next to the data
 * (`isRealRestaurant`, `isDisneyOwnedResort`).
 *
 * Predicate definitions (verified against the live catalog):
 *   - **Real restaurant** (R10.1): a `Restaurant` carrying a genuine dining
 *     service-type facet — a table-service meal (`casual-dining`,
 *     `fine-signature-dining`, `character-dining`, `buffet`, `family-style`,
 *     `pre-fixe-menu`) or a real quick-service (`counter-service`,
 *     `fast-casual`, `food-court`, `quick-service`). Festival kiosks, snack
 *     carts, pool bars, coffee, and lounge-only rows are NOT real restaurants;
 *     the evaluator buckets them (festival booth vs. the snack/lounge residual)
 *     from the flattened facet names. Matches the design's ~193 real / 28
 *     festival / ~229 residual split.
 *   - **Disney-owned resort** (R16.1): a `Resort` whose name is Disney-branded
 *     (`Disney's …`, `… at Disney's …`, or Fort Wilderness). Excludes Good
 *     Neighbor / third-party hotels and the Marriott-operated Swan / Dolphin /
 *     Swan Reserve. Matches the design's ~30 Disney-owned set.
 *
 * The `grouped_facets` JSONB is read raw and flattened in JS (each group's
 * `{ id, name }[]` → its `name`s) rather than via `jsonb_array_elements`, so the
 * repo runs unchanged against both Postgres and the pg-mem test harness.
 *
 * Validates: Requirements 2.4, 3.1, 3.2, 10.1, 16.1
 */

import type { PinBoardDTO, PinTier, PinTierSummaryDTO } from '@dwt/shared';
import { PINS, PIN_TIERS } from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import {
  evaluateBoard,
  newlyAwardedPinIds,
  type AwardState,
  type EvalExperience,
  type DaySnapshot,
  type PinActivitySnapshot,
} from './evaluator.js';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** The outcome of a manual claim (Requirement 20.3, 20.4). */
export type ClaimResult =
  | { readonly status: 'not_awarded' }
  | { readonly status: 'already_claimed'; readonly claimedAt: string }
  | { readonly status: 'claimed'; readonly claimedAt: string };

export interface PinRepo {
  /**
   * Read and project the full Pin Board for a User: every Series 1 Pin with its
   * unlocked/locked progress, plus the whole-collection tier summary and totals
   * (R3.1, R3.2). Filtering by tier/track/unlocked is applied by the route.
   */
  getBoard(userId: string): Promise<PinBoardDTO>;
  /**
   * Synchronously evaluate the User's challenges and insert any newly-earned
   * Pins into `user_pins` (idempotent via `ON CONFLICT (user_id, pin_id) DO
   * NOTHING`). Returns the ids actually inserted by THIS call — an empty array
   * when nothing new was earned — so a concurrent double-award never
   * double-reports a Pin (R2.1, R2.4, Property 1).
   */
  awardNewly(userId: string): Promise<string[]>;
  /**
   * Claim one already-awarded Pin for a User (Requirement 20.3, 20.4).
   * Idempotent: claiming an unawarded Pin returns `not_awarded` and creates
   * nothing; claiming an already-claimed Pin returns `already_claimed` with
   * the existing timestamp rather than erroring or re-firing a celebration;
   * otherwise sets `claimed_at = now()` and returns `claimed` (Property 13).
   */
  claimPin(userId: string, pinId: string): Promise<ClaimResult>;
  /**
   * Reconciliation (Requirement 21.2): runs `awardNewly` for every User, so
   * historical Completions recorded before the award-wiring fix (or before
   * this feature existed) self-heal into ready-to-claim Pins. Reuses
   * `awardNewly`'s own idempotent insert, so running it repeatedly — or
   * concurrently with a synchronous award — never duplicates an award
   * (Property 1, Property 15).
   */
  reconcileAll(): Promise<{ usersProcessed: number; pinsAwarded: number }>;
}

/** Build a `PinRepo` bound to the supplied pool. Holds no state. */
export function createPinRepo(pool: DbPool): PinRepo {
  return {
    getBoard: (userId) => getBoard(pool, userId),
    awardNewly: (userId) => awardNewly(pool, userId),
    claimPin: (userId, pinId) => claimPin(pool, userId, pinId),
    reconcileAll: () => reconcileAll(pool),
  };
}

// ---------------------------------------------------------------------------
// Predicate constants
// ---------------------------------------------------------------------------

/** table-service facet ids that make a Restaurant a "real" sit-down restaurant. */
const REAL_TABLE_SERVICE_IDS: ReadonlySet<string> = new Set([
  'casual-dining',
  'fine-signature-dining',
  'character-dining',
  'buffet',
  'family-style',
  'pre-fixe-menu',
]);

/** quick-service facet ids that make a Restaurant a "real" counter restaurant. */
const REAL_QUICK_SERVICE_IDS: ReadonlySet<string> = new Set([
  'counter-service',
  'fast-casual',
  'food-court',
  'quick-service',
]);

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** A `{ id, name }` facet entry as stored in `grouped_facets`. */
interface RawFacet {
  readonly id?: unknown;
  readonly name?: unknown;
}

/** One experience row read for the catalog / per-day projections. */
interface ExperienceRow {
  readonly upstream_id: string | null;
  readonly category: string;
  readonly park: string | null;
  readonly land: string | null;
  readonly world_showcase_country: string | null;
  readonly grouped_facets: unknown;
  readonly name: string | null;
}

/** A per-day log row: an experience joined to its `visited_on` date. */
interface DayExperienceRow extends ExperienceRow {
  readonly visited_on: Date | string;
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

/**
 * Read one User's full activity and fold it into a `PinActivitySnapshot`.
 *
 * The reads are independent, so they run concurrently. No snapshot-isolation
 * transaction is used: Pin awards are monotonic and idempotent (Property 1), so
 * a mutation racing between reads can at worst defer a Pin to the next
 * evaluation — it can never revoke one or double-award.
 */
export async function buildSnapshot(
  pool: DbPool,
  userId: string,
): Promise<PinActivitySnapshot> {
  const [catalogRes, completedRes, dayRes, friendRes, ratingRes, noteRes, tripRes, festivalTaggedRes] =
    await Promise.all([
      pool.query<ExperienceRow>(
        `SELECT upstream_entity_id AS upstream_id, category, park, land,
                world_showcase_country, grouped_facets, name
           FROM experiences
          WHERE active = TRUE`,
      ),
      pool.query<{ upstream_id: string | null }>(
        `SELECT e.upstream_entity_id AS upstream_id
           FROM completions c
           JOIN experiences e ON e.id = c.experience_id
          WHERE c.user_id = $1 AND e.active = TRUE`,
        [userId],
      ),
      pool.query<DayExperienceRow>(
        `SELECT l.visited_on AS visited_on,
                e.upstream_entity_id AS upstream_id, e.category, e.park, e.land,
                e.world_showcase_country, e.grouped_facets, e.name
           FROM experience_logs l
           JOIN experiences e ON e.id = l.experience_id
          WHERE l.user_id = $1 AND e.active = TRUE
          ORDER BY l.visited_on`,
        [userId],
      ),
      pool.query<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM rode_with_tags
          WHERE tagged_member_id = $1 AND state = 'confirmed'`,
        [userId],
      ),
      pool.query<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM ratings WHERE user_id = $1`,
        [userId],
      ),
      pool.query<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM notes WHERE user_id = $1`,
        [userId],
      ),
      pool.query<{ n: string | number }>(
        `SELECT COUNT(*) AS n FROM trip_memberships WHERE user_id = $1`,
        [userId],
      ),
      pool.query<{ upstream_id: string | null }>(
        `SELECT DISTINCT e.upstream_entity_id AS upstream_id
           FROM completions c
           JOIN experience_festival_tags t ON t.experience_id = c.experience_id
           JOIN experiences e ON e.id = c.experience_id
          WHERE c.user_id = $1 AND e.upstream_entity_id IS NOT NULL`,
        [userId],
      ),
    ]);

  const catalog = catalogRes.rows
    .filter((r): r is ExperienceRow & { upstream_id: string } => r.upstream_id !== null)
    .map(toEvalExperience);

  const completed = new Set<string>();
  for (const r of completedRes.rows) {
    if (r.upstream_id !== null) completed.add(r.upstream_id);
  }

  const festivalTaggedCompletedIds = new Set<string>();
  for (const r of festivalTaggedRes.rows) {
    if (r.upstream_id !== null) festivalTaggedCompletedIds.add(r.upstream_id);
  }

  return {
    catalog,
    completed,
    days: groupDays(dayRes.rows),
    friendRides: toCount(friendRes.rows[0]?.n),
    ratings: toCount(ratingRes.rows[0]?.n),
    notes: toCount(noteRes.rows[0]?.n),
    trips: toCount(tripRes.rows[0]?.n),
    festivalTaggedCompletedIds,
  };
}

/**
 * Group per-day log rows into `DaySnapshot[]` keyed by `visited_on`. Each log
 * row contributes one experience entry (repeat rides on the same day count
 * once per log, which is what the ride-marathon feats measure). Rows with a
 * null `upstream_entity_id` are skipped.
 */
function groupDays(rows: readonly DayExperienceRow[]): DaySnapshot[] {
  const byDate = new Map<string, EvalExperience[]>();
  for (const row of rows) {
    if (row.upstream_id === null) continue;
    const date = toIsoDate(row.visited_on);
    const list = byDate.get(date);
    const evalExp = toEvalExperience(row);
    if (list) list.push(evalExp);
    else byDate.set(date, [evalExp]);
  }
  return Array.from(byDate.entries()).map(([date, experiences]) => ({ date, experiences }));
}

/** Map an experience row to the flat `EvalExperience` the evaluator reads. */
function toEvalExperience(row: ExperienceRow): EvalExperience {
  return {
    upstreamId: row.upstream_id as string,
    category: row.category as EvalExperience['category'],
    park: (row.park as EvalExperience['park']) ?? null,
    land: row.land ?? null,
    worldShowcaseCountry: row.world_showcase_country ?? null,
    facets: flattenFacets(row.grouped_facets),
    isDisneyResort: isDisneyOwnedResort(row.category, row.name),
    isRealRestaurant: isRealRestaurant(row.category, row.grouped_facets),
  };
}

// ---------------------------------------------------------------------------
// Facet + predicate helpers
// ---------------------------------------------------------------------------

/**
 * Flatten `grouped_facets` (`{ group: { id, name }[] }`) to `{ group: name[] }`.
 * Only well-formed string names are kept; a malformed group/entry is skipped so
 * catalog drift cannot corrupt evaluation (mirrors `stats/facets.ts`).
 */
function flattenFacets(value: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [group, arr] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const names: string[] = [];
    for (const entry of arr) {
      const name = (entry as RawFacet | null)?.name;
      if (typeof name === 'string') names.push(name);
    }
    if (names.length > 0) out[group] = names;
  }
  return out;
}

/** Extract the facet `id`s for one group of a raw `grouped_facets` value. */
function facetIds(value: unknown, group: string): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const arr = (value as Record<string, unknown>)[group];
  if (!Array.isArray(arr)) return [];
  const ids: string[] = [];
  for (const entry of arr) {
    const id = (entry as RawFacet | null)?.id;
    if (typeof id === 'string') ids.push(id);
  }
  return ids;
}

/** See module docstring — R10.1 real-restaurant predicate. */
function isRealRestaurant(category: string, groupedFacets: unknown): boolean {
  if (category !== 'Restaurant') return false;
  const ts = facetIds(groupedFacets, 'tableService');
  if (ts.some((id) => REAL_TABLE_SERVICE_IDS.has(id))) return true;
  const qs = facetIds(groupedFacets, 'quickService');
  return qs.some((id) => REAL_QUICK_SERVICE_IDS.has(id));
}

/** See module docstring — R16.1 Disney-owned-resort predicate. */
function isDisneyOwnedResort(category: string, name: string | null): boolean {
  if (category !== 'Resort') return false;
  const n = (name ?? '').toLowerCase();
  return n.startsWith("disney's ") || n.includes(" at disney's ") || n.includes('fort wilderness');
}

// ---------------------------------------------------------------------------
// Board projection
// ---------------------------------------------------------------------------

async function getBoard(pool: DbPool, userId: string): Promise<PinBoardDTO> {
  const [snapshot, awarded] = await Promise.all([
    buildSnapshot(pool, userId),
    readAwarded(pool, userId),
  ]);

  const pins = evaluateBoard(snapshot, awarded);

  // Whole-collection tier summary (independent of any route filter, R3.2).
  const unlockedByTier = new Map<PinTier, number>();
  const totalByTier = new Map<PinTier, number>();
  const unlockedIds = new Set(pins.filter((p) => p.unlocked).map((p) => p.pinId));
  for (const pin of PINS) {
    totalByTier.set(pin.tier, (totalByTier.get(pin.tier) ?? 0) + 1);
    if (unlockedIds.has(pin.id)) {
      unlockedByTier.set(pin.tier, (unlockedByTier.get(pin.tier) ?? 0) + 1);
    }
  }
  const tierSummary: PinTierSummaryDTO[] = PIN_TIERS.map((tier) => ({
    tier,
    unlocked: unlockedByTier.get(tier) ?? 0,
    total: totalByTier.get(tier) ?? 0,
  }));

  const totalPins = PINS.length;
  const totalUnlocked = unlockedIds.size;
  const overallPercent = totalPins === 0 ? 0 : Math.floor((totalUnlocked / totalPins) * 100);

  return { pins, tierSummary, totalUnlocked, totalPins, overallPercent };
}

/** Read the User's awarded Pins as a `pinId -> AwardState` map. */
async function readAwarded(pool: DbPool, userId: string): Promise<Map<string, AwardState>> {
  const res = await pool.query<{ pin_id: string; awarded_at: Date | string; claimed_at: Date | string | null }>(
    `SELECT pin_id, awarded_at, claimed_at FROM user_pins WHERE user_id = $1`,
    [userId],
  );
  const map = new Map<string, AwardState>();
  for (const row of res.rows) {
    map.set(row.pin_id, {
      awardedAt: toIsoTimestamp(row.awarded_at),
      claimedAt: row.claimed_at === null ? null : toIsoTimestamp(row.claimed_at),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Award insert
// ---------------------------------------------------------------------------

async function awardNewly(pool: DbPool, userId: string): Promise<string[]> {
  const res = await pool.query<{ pin_id: string }>(
    `SELECT pin_id FROM user_pins WHERE user_id = $1`,
    [userId],
  );
  const alreadyAwarded = new Set(res.rows.map((r) => r.pin_id));

  const snapshot = await buildSnapshot(pool, userId);
  const toAward = newlyAwardedPinIds(snapshot, alreadyAwarded);
  if (toAward.length === 0) return [];

  // Multi-row VALUES (no unnest) keeps this pg-mem-compatible. `ON CONFLICT DO
  // NOTHING` makes the insert idempotent under a concurrent award; `RETURNING`
  // then yields ONLY the rows this statement actually inserted, so the caller
  // never double-reports a Pin another request awarded first (Property 1).
  const valuesClause = toAward.map((_, i) => `($1, $${i + 2})`).join(', ');
  const inserted = await pool.query<{ pin_id: string }>(
    `INSERT INTO user_pins (user_id, pin_id)
     VALUES ${valuesClause}
     ON CONFLICT (user_id, pin_id) DO NOTHING
     RETURNING pin_id`,
    [userId, ...toAward],
  );
  return inserted.rows.map((r) => r.pin_id);
}

// ---------------------------------------------------------------------------
// Claim (Requirement 20)
// ---------------------------------------------------------------------------

/**
 * Claim one Pin. A single `UPDATE ... WHERE claimed_at IS NULL RETURNING
 * claimed_at` is the whole mutation: it can only ever win once under a
 * concurrent double-claim (Property 14), and it touches no row for a Pin
 * that has not been awarded, so an unawarded claim never creates a
 * `user_pins` row (Property 13).
 */
async function claimPin(pool: DbPool, userId: string, pinId: string): Promise<ClaimResult> {
  const updated = await pool.query<{ claimed_at: Date | string }>(
    `UPDATE user_pins
        SET claimed_at = now()
      WHERE user_id = $1 AND pin_id = $2 AND claimed_at IS NULL
    RETURNING claimed_at`,
    [userId, pinId],
  );
  const updatedRow = updated.rows[0];
  if (updatedRow) {
    return { status: 'claimed', claimedAt: toIsoTimestamp(updatedRow.claimed_at) };
  }

  // Nothing updated: either no award row exists, or it exists and is already
  // claimed. One more read distinguishes the two without a second UPDATE.
  const existing = await pool.query<{ claimed_at: Date | string | null }>(
    `SELECT claimed_at FROM user_pins WHERE user_id = $1 AND pin_id = $2`,
    [userId, pinId],
  );
  const existingRow = existing.rows[0];
  if (!existingRow) return { status: 'not_awarded' };
  // `existingRow.claimed_at` cannot be null here: the UPDATE above would have
  // matched and claimed it if it were.
  return { status: 'already_claimed', claimedAt: toIsoTimestamp(existingRow.claimed_at as Date | string) };
}

// ---------------------------------------------------------------------------
// Reconciliation (Requirement 21.2)
// ---------------------------------------------------------------------------

/**
 * Run `awardNewly` for every User. Historical Completions recorded before the
 * award-wiring fix (or before this feature existed) self-heal into
 * ready-to-claim Pins via the same idempotent insert `awardNewly` already
 * uses, so running this any number of times — or concurrently with a
 * synchronous award for the same user — never duplicates a `user_pins` row
 * (Property 1, Property 15). Not invoked by any read path (Requirement
 * 21.3); reached only via the dedicated internal reconcile endpoint.
 */
async function reconcileAll(pool: DbPool): Promise<{ usersProcessed: number; pinsAwarded: number }> {
  const users = await pool.query<{ id: string }>(`SELECT id FROM users`);
  let pinsAwarded = 0;
  for (const { id } of users.rows) {
    const awarded = await awardNewly(pool, id);
    pinsAwarded += awarded.length;
  }
  return { usersProcessed: users.rows.length, pinsAwarded };
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/** Coerce a `COUNT(*)` result (bigint decimal string or number) to a number. */
function toCount(value: string | number | undefined): number {
  if (value === undefined) return 0;
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

/** Normalize a DATE column to `YYYY-MM-DD` (UTC components for a `Date`). */
function toIsoDate(value: Date | string): string {
  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Normalize a TIMESTAMPTZ column to an ISO-8601 UTC string. */
function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
