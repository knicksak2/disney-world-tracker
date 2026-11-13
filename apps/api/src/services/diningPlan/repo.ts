/**
 * Dining Plan repository (dining-plan-calculator Requirements 4.1 to 4.4, 5.4 to 5.7, 6.3, 6.5, 16.5, 16.7, 17.1,
 * 17.5, 17.6; design.md "Request flows" and "Planned-restaurant import").
 *
 * Reads are fixed in number whatever the entry count: `loadLocations` and `loadGlobals` run their two statements
 * unconditionally (Property 22). Every write runs in one transaction that first locks the Trip row
 * (`SELECT id FROM trips WHERE id = $1 FOR UPDATE`), so the 120-entry cap and slot uniqueness hold under concurrent
 * requests (Requirement 16.7).
 *
 * This file never reads `trip_memberships`, `users` or `profiles`; the Party comes through the party port.
 */

import {
  DINING_CONFIG_DEFAULTS,
  DINING_EXCLUDED_KEYS_MAX,
  DINING_MEAL_PERIODS,
  DINING_PLAN_ENTRIES_MAX,
  diningConfigSchema,
  diningPlanSettingsSchema,
  type DiningConfig,
  type DiningCreditCostByPeriod,
  type DiningMealPeriod,
  type DiningPlanSettings,
  type MenuDTO,
} from '@dwt/shared';
import type { PoolClient } from 'pg';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import type { PlannedDiningItemRow } from './engine/reservations.js';
import type { EnginePriceRow, LocationRuleRow } from './engine/types.js';
import type {
  DiningEntryWrite,
  DiningGlobals,
  DiningImportCounts,
  DiningImportItem,
  DiningLocationRecord,
  DiningPlanLogger,
  DiningPlanRepo,
  DiningProfileRow,
  DiningScenarioRecord,
  DiningTripCore,
  StoredDiningEntry,
} from './types.js';

// ---------------------------------------------------------------------------
// Driver-safe conversions (node-pg returns DATE as a Date or a string, BIGINT and COUNT() as strings)
// ---------------------------------------------------------------------------

/** A DATE column as `YYYY-MM-DD`, read in UTC so the server's zone never shifts it. */
export function toCalendarDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/u.test(s)) return s.slice(0, 10);
  throw new Error(`not a calendar date: ${s}`);
}

export function toNullableCalendarDate(value: unknown): string | null {
  return value === null || value === undefined ? null : toCalendarDate(value);
}

/** A TIMESTAMPTZ column as an ISO instant. */
function toIsoInstant(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A COUNT()/BIGINT/INTEGER column as a safe integer. */
export function toCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(n)) throw new Error(`not an integer count: ${String(value)}`);
  return n;
}

export function toNullableInt(value: unknown): number | null {
  return value === null || value === undefined ? null : toCount(value);
}

export function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  const parsed = jsonValue(value);
  return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
}

// ---------------------------------------------------------------------------
// Stored JSON parsed key by key (an invalid key is logged and defaulted; the rest are kept)
// ---------------------------------------------------------------------------

/**
 * Stored settings through `diningPlanSettingsSchema` (Requirement 6.5). A key that fails validation is dropped, so its
 * default applies, and the drop is logged with the key names only.
 */
export function parseStoredSettings(raw: unknown, logger?: DiningPlanLogger, tripId?: string): DiningPlanSettings {
  const parsed = jsonValue(raw);
  let candidate: Record<string, unknown> =
    parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  const dropped: string[] = [];
  for (let guard = 0; guard < 32; guard += 1) {
    const result = diningPlanSettingsSchema.safeParse(candidate);
    if (result.success) {
      if (dropped.length > 0) logger?.warn({ tripId, droppedKeys: dropped }, 'invalid stored dining plan settings defaulted');
      return result.data;
    }
    const keys = new Set(result.error.issues.map((i) => String(i.path[0] ?? '')));
    // An unknown key (strict schema) is reported on the object itself; drop every key the schema does not name.
    const known = new Set(Object.keys(diningPlanSettingsSchema.shape));
    for (const k of Object.keys(candidate)) if (!known.has(k)) keys.add(k);
    const next = Object.fromEntries(Object.entries(candidate).filter(([k]) => !keys.has(k)));
    if (Object.keys(next).length === Object.keys(candidate).length) break;
    dropped.push(...Object.keys(candidate).filter((k) => keys.has(k)));
    candidate = next;
  }
  logger?.warn({ tripId }, 'stored dining plan settings unreadable; defaults used');
  return diningPlanSettingsSchema.parse({});
}

/**
 * Stored config merged over `DINING_CONFIG_DEFAULTS` one key at a time (Requirement 17.6): each stored key is kept only
 * if the merged config still parses, so one bad value never resets the others.
 */
export function mergeStoredConfig(raw: unknown, logger?: DiningPlanLogger): DiningConfig {
  const parsed = jsonValue(raw);
  const stored = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  let config: DiningConfig = DINING_CONFIG_DEFAULTS;
  const rejected: string[] = [];
  for (const key of Object.keys(diningConfigSchema.shape)) {
    if (!(key in stored)) continue;
    const next = diningConfigSchema.safeParse({ ...config, [key]: stored[key] });
    if (next.success) config = next.data;
    else rejected.push(key);
  }
  if (rejected.length > 0) logger?.warn({ rejectedKeys: rejected }, 'invalid stored dining plan config values ignored');
  return config;
}

function costByPeriod(value: unknown): DiningCreditCostByPeriod | null {
  const parsed = jsonValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const out: { breakfast?: 1 | 2; lunch?: 1 | 2; dinner?: 1 | 2 } = {};
  for (const period of DINING_MEAL_PERIODS) {
    const v = (parsed as Record<string, unknown>)[period];
    if (v === 1 || v === 2) out[period] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** The columns of a `dining_plan_location_rules` row as a LEFT JOIN returns them (`rule_experience_id` null: no row). */
export interface RuleColumns {
  readonly rule_experience_id: string | null;
  readonly service_type: LocationRuleRow['serviceType'];
  readonly credit_cost: unknown;
  readonly credit_cost_by_period: unknown;
  readonly gratuity_included: boolean | null;
  readonly pass_discount_eligible: boolean | null;
  readonly per_person_adult_cents: unknown;
  readonly per_person_child_cents: unknown;
  readonly rule_status: LocationRuleRow['ruleStatus'] | null;
  readonly verified_at: unknown;
  readonly source_note: string | null;
}

/** The SELECT list of `RuleColumns`, for a query that joins `dining_plan_location_rules r`. */
export const RULE_SELECT = `r.experience_id AS rule_experience_id, r.service_type, r.credit_cost, r.credit_cost_by_period,
                r.gratuity_included, r.pass_discount_eligible, r.per_person_adult_cents, r.per_person_child_cents,
                r.rule_status, r.verified_at, r.source_note`;

export function locationRuleRowOf(r: RuleColumns): LocationRuleRow | null {
  return r.rule_experience_id === null
    ? null
    : {
        serviceType: r.service_type,
        creditCost: toCount(r.credit_cost) === 2 ? 2 : 1,
        creditCostByPeriod: costByPeriod(r.credit_cost_by_period),
        gratuityIncluded: r.gratuity_included === true,
        passDiscountEligible: r.pass_discount_eligible,
        overrideAdultCents: toNullableInt(r.per_person_adult_cents),
        overrideChildCents: toNullableInt(r.per_person_child_cents),
        ruleStatus: r.rule_status ?? 'unverified',
        verifiedAt: toNullableCalendarDate(r.verified_at),
        sourceNote: r.source_note,
      };
}

function menusOf(value: unknown): MenuDTO[] | null {
  const parsed = jsonValue(value);
  return Array.isArray(parsed) ? (parsed as MenuDTO[]) : null;
}

const PERIOD_RANK = new Map<string, number>(DINING_MEAL_PERIODS.map((p, i) => [p, i]));

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

async function inTripTransaction<T>(pool: DbPool, tripId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query<{ id: string }>(`SELECT id FROM trips WHERE id = $1 FOR UPDATE`, [tripId]);
    if (lock.rows.length === 0) throw new AppError('trip_forbidden', 'You may not perform this action on this trip.');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The original error is the one to surface.
    }
    throw err;
  } finally {
    client.release();
  }
}

async function countEntries(client: PoolClient, tripId: string): Promise<number> {
  const res = await client.query<{ n: unknown }>(`SELECT count(*)::int AS n FROM trip_dining_plan_entries WHERE trip_id = $1`, [tripId]);
  return toCount(res.rows[0]?.n ?? 0);
}

function capReached(): AppError {
  return new AppError('trip_validation_failed', `A Trip can hold at most ${DINING_PLAN_ENTRIES_MAX} dining entries.`, {
    field: 'entries',
  });
}

/** Requirement 4.2, 4.3: a restaurant entry names an active catalog Experience of category Restaurant. */
async function assertRestaurant(client: PoolClient, experienceId: string): Promise<void> {
  const res = await client.query<{ category: string; active: boolean }>(
    `SELECT category, active FROM experiences WHERE id = $1`,
    [experienceId],
  );
  const row = res.rows[0];
  if (row === undefined || row.active !== true || row.category !== 'Restaurant') {
    throw new AppError('trip_validation_failed', 'Choose an open restaurant from the catalog.', { field: 'experienceId' });
  }
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

export interface DiningPlanRepoDeps {
  readonly pool: DbPool;
  readonly logger?: DiningPlanLogger;
}

export function createDiningPlanRepo({ pool, logger }: DiningPlanRepoDeps): DiningPlanRepo {
  return {
    async loadTripCore(tripId): Promise<DiningTripCore | null> {
      const res = await pool.query<{ start_date: unknown; end_date: unknown }>(
        `SELECT start_date, end_date FROM trips WHERE id = $1`,
        [tripId],
      );
      const row = res.rows[0];
      return row === undefined ? null : { startDate: toCalendarDate(row.start_date), endDate: toCalendarDate(row.end_date) };
    },

    async loadScenario(tripId): Promise<DiningScenarioRecord> {
      const settingsRes = await pool.query<{ settings: unknown }>(
        `SELECT settings FROM trip_dining_plan_scenarios WHERE trip_id = $1`,
        [tripId],
      );
      const entriesRes = await pool.query<{
        id: string;
        entry_date: unknown;
        meal_period: DiningMealPeriod;
        kind: StoredDiningEntry['kind'];
        experience_id: string | null;
        placeholder_kind: StoredDiningEntry['placeholderKind'];
        planned_item_id: string | null;
        excluded_keys: unknown;
      }>(
        `SELECT id, entry_date, meal_period, kind, experience_id, placeholder_kind, planned_item_id, excluded_keys
           FROM trip_dining_plan_entries
          WHERE trip_id = $1`,
        [tripId],
      );
      const entries: StoredDiningEntry[] = entriesRes.rows.map((r) => ({
        id: r.id,
        date: toCalendarDate(r.entry_date),
        mealPeriod: r.meal_period,
        kind: r.kind,
        experienceId: r.experience_id,
        placeholderKind: r.placeholder_kind,
        plannedItemId: r.planned_item_id,
        excludedKeys: stringArray(r.excluded_keys),
      }));
      // Ordered in memory: meal periods sort by the day, not alphabetically.
      entries.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : PERIOD_RANK.get(a.mealPeriod)! - PERIOD_RANK.get(b.mealPeriod)!));
      const settings = settingsRes.rows[0] === undefined ? diningPlanSettingsSchema.parse({}) : parseStoredSettings(settingsRes.rows[0].settings, logger, tripId);
      return { settings, entries };
    },

    async loadProfiles(tripId): Promise<readonly DiningProfileRow[]> {
      const res = await pool.query<{ member_id: string | null; guest_id: string | null; age_bracket: DiningProfileRow['ageBracket']; pass_type: DiningProfileRow['passType'] }>(
        `SELECT member_id, guest_id, age_bracket, pass_type FROM trip_traveler_profiles WHERE trip_id = $1`,
        [tripId],
      );
      return res.rows.map((r) => ({ memberId: r.member_id, guestId: r.guest_id, ageBracket: r.age_bracket, passType: r.pass_type }));
    },

    async loadPlannedDiningItems(tripId): Promise<readonly PlannedDiningItemRow[]> {
      // One statement (design.md "Planned-restaurant import"); item_type, category and active are also selected so the
      // pure `isSuggestible` can apply the same rule.
      const res = await pool.query<{
        id: string;
        item_type: string;
        experience_id: string;
        experience_name: string;
        experience_category: string;
        experience_active: boolean;
        planned_date: unknown;
        planned_time: unknown;
        meal_period: string | null;
        party_size: unknown;
        reservation_kind: string | null;
      }>(
        `SELECT pi.id, pi.item_type, pi.experience_id, e.name AS experience_name, e.category AS experience_category,
                e.active AS experience_active, pi.planned_date, pi.planned_time, pi.meal_period, pi.party_size,
                pi.reservation_kind
           FROM planned_items pi
           JOIN experiences e ON e.id = pi.experience_id
          WHERE pi.trip_id = $1
            AND pi.planned_date IS NOT NULL
            AND pi.item_type = 'experience'
            AND (pi.reservation_kind = 'dining'
                 OR (pi.reservation_kind IS NULL AND e.category = 'Restaurant' AND e.active = TRUE))`,
        [tripId],
      );
      return res.rows.map((r) => ({
        id: r.id,
        itemType: r.item_type,
        experienceId: r.experience_id,
        experienceName: r.experience_name,
        experienceCategory: r.experience_category,
        experienceActive: r.experience_active,
        plannedDate: toNullableCalendarDate(r.planned_date),
        plannedTime: toIsoInstant(r.planned_time),
        mealPeriod: r.meal_period,
        partySize: toNullableInt(r.party_size),
        reservationKind: r.reservation_kind,
      }));
    },

    async loadLocations(experienceIds): Promise<ReadonlyMap<string, DiningLocationRecord>> {
      const ids = [...new Set(experienceIds)];
      const expRes = await pool.query<
        { id: string; name: string; category: string; active: boolean; price_tier: string | null; grouped_facets: unknown } & RuleColumns
      >(
        `SELECT e.id, e.name, e.category, e.active, e.price_tier, e.grouped_facets,
                ${RULE_SELECT}
           FROM experiences e
           LEFT JOIN dining_plan_location_rules r ON r.experience_id = e.id
          WHERE e.id = ANY($1::uuid[])`,
        [ids],
      );
      const menuRes = await pool.query<{ experience_id: string; menus: unknown }>(
        `SELECT experience_id, menus FROM experience_menus WHERE experience_id = ANY($1::uuid[])`,
        [ids],
      );
      const menusById = new Map(menuRes.rows.map((r) => [r.experience_id, menusOf(r.menus)]));
      const out = new Map<string, DiningLocationRecord>();
      for (const r of expRes.rows) {
        const rule = locationRuleRowOf(r);
        out.set(r.id, {
          experienceId: r.id,
          name: r.name,
          category: r.category,
          active: r.active === true,
          priceTier: r.price_tier,
          groupedFacets: jsonValue(r.grouped_facets),
          menus: menusById.get(r.id) ?? null,
          rule,
        });
      }
      return out;
    },

    async loadGlobals(): Promise<DiningGlobals> {
      const priceRes = await pool.query<{
        plan_code: EnginePriceRow['planCode'];
        display_name: string;
        valid_from: unknown;
        valid_to: unknown;
        adult_cents: unknown;
        child_cents: unknown;
        child_promo_cents: unknown;
        promo_label: string | null;
        verified_at: unknown;
      }>(
        `SELECT plan_code, display_name, valid_from, valid_to, adult_cents, child_cents, child_promo_cents, promo_label, verified_at
           FROM dining_plan_prices`,
      );
      const configRes = await pool.query<{ config: unknown }>(`SELECT config FROM dining_plan_config WHERE id = 1`);
      const priceRows: EnginePriceRow[] = priceRes.rows
        .map((r) => ({
          planCode: r.plan_code,
          displayName: r.display_name,
          validFrom: toCalendarDate(r.valid_from),
          validTo: toCalendarDate(r.valid_to),
          adultCents: toCount(r.adult_cents),
          childCents: toCount(r.child_cents),
          childPromoCents: toNullableInt(r.child_promo_cents),
          promoLabel: r.promo_label,
          verifiedAt: toNullableCalendarDate(r.verified_at),
        }))
        .sort((a, b) => (a.planCode !== b.planCode ? (a.planCode < b.planCode ? -1 : 1) : a.validFrom < b.validFrom ? -1 : 1));
      return { priceRows, config: mergeStoredConfig(configRes.rows[0]?.config, logger) };
    },

    async saveSettings(tripId, settings) {
      await inTripTransaction(pool, tripId, async (client) => {
        await client.query(
          `INSERT INTO trip_dining_plan_scenarios (trip_id, settings, updated_at)
           VALUES ($1, $2::jsonb, now())
           ON CONFLICT (trip_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`,
          [tripId, JSON.stringify(settings)],
        );
      });
    },

    async upsertEntry(tripId, entry: DiningEntryWrite) {
      if (entry.excludedKeys.length > DINING_EXCLUDED_KEYS_MAX) {
        throw new AppError('trip_validation_failed', `At most ${DINING_EXCLUDED_KEYS_MAX} people can be left out of a meal.`, { field: 'excludedKeys' });
      }
      await inTripTransaction(pool, tripId, async (client) => {
        if (entry.kind === 'restaurant') await assertRestaurant(client, entry.experienceId ?? '');
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM trip_dining_plan_entries WHERE trip_id = $1 AND entry_date = $2 AND meal_period = $3`,
          [tripId, entry.date, entry.mealPeriod],
        );
        const params = [entry.kind, entry.experienceId, entry.placeholderKind, JSON.stringify([...new Set(entry.excludedKeys)])];
        if (existing.rows[0] !== undefined) {
          // A replaced slot keeps its planned-item link, so an imported reservation is not suggested again.
          await client.query(
            `UPDATE trip_dining_plan_entries
                SET kind = $1, experience_id = $2, placeholder_kind = $3, excluded_keys = $4::jsonb, updated_at = now()
              WHERE id = $5`,
            [...params, existing.rows[0].id],
          );
          return;
        }
        if ((await countEntries(client, tripId)) >= DINING_PLAN_ENTRIES_MAX) throw capReached();
        await client.query(
          `INSERT INTO trip_dining_plan_entries (trip_id, entry_date, meal_period, kind, experience_id, placeholder_kind, excluded_keys)
           VALUES ($5, $6, $7, $1, $2, $3, $4::jsonb)`,
          [...params, tripId, entry.date, entry.mealPeriod],
        );
      });
    },

    async deleteEntry(tripId, date, mealPeriod) {
      return inTripTransaction(pool, tripId, async (client) => {
        const res = await client.query(
          `DELETE FROM trip_dining_plan_entries WHERE trip_id = $1 AND entry_date = $2 AND meal_period = $3`,
          [tripId, date, mealPeriod],
        );
        return (res.rowCount ?? 0) > 0;
      });
    },

    async importEntries(tripId, items: readonly DiningImportItem[], overwrite): Promise<DiningImportCounts> {
      return inTripTransaction(pool, tripId, async (client) => {
        // Re-read inside the lock: an earlier import or edit may have filled a slot or linked an item (Req 5.5).
        const existing = await client.query<{ id: string; entry_date: unknown; meal_period: string; planned_item_id: string | null }>(
          `SELECT id, entry_date, meal_period, planned_item_id FROM trip_dining_plan_entries WHERE trip_id = $1`,
          [tripId],
        );
        const linked = new Set(existing.rows.map((r) => r.planned_item_id).filter((id): id is string => id !== null));
        const slotEntry = new Map(existing.rows.map((r) => [`${toCalendarDate(r.entry_date)}:${r.meal_period}`, r.id]));
        const createdSlots = new Set<string>();
        let count = existing.rows.length;
        let created = 0;
        let skippedExisting = 0;
        for (const item of items) {
          const slot = `${item.date}:${item.mealPeriod}`;
          if (linked.has(item.plannedItemId) || createdSlots.has(slot)) {
            skippedExisting += 1;
            continue;
          }
          const occupant = slotEntry.get(slot);
          if (occupant !== undefined) {
            if (!overwrite) {
              skippedExisting += 1;
              continue;
            }
            await client.query(
              `UPDATE trip_dining_plan_entries
                  SET kind = 'restaurant', experience_id = $1, placeholder_kind = NULL, planned_item_id = $2,
                      excluded_keys = '[]'::jsonb, updated_at = now()
                WHERE id = $3`,
              [item.experienceId, item.plannedItemId, occupant],
            );
          } else {
            if (count >= DINING_PLAN_ENTRIES_MAX) throw capReached();
            await client.query(
              `INSERT INTO trip_dining_plan_entries (trip_id, entry_date, meal_period, kind, experience_id, planned_item_id)
               VALUES ($1, $2, $3, 'restaurant', $4, $5)`,
              [tripId, item.date, item.mealPeriod, item.experienceId, item.plannedItemId],
            );
            count += 1;
          }
          linked.add(item.plannedItemId);
          createdSlots.add(slot);
          created += 1;
        }
        return { created, skippedExisting };
      });
    },
  };
}
