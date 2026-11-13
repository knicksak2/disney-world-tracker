/**
 * The Admin_Panel's Dining Plan store (dining-plan-calculator Requirements 2.6, 8.2, 8.3, 8.8 to 8.10, 18; design.md
 * "Admin_Panel" and "Seed application"; Properties 24 and 40). Implements `AdminDiningPlanPort`.
 *
 * The calculation reads these tables on every request (`repo.ts` `loadGlobals` and `loadLocations`), so a save here is
 * visible to the next calculation without a restart (Requirement 18.9). Each validation failure returns messages and
 * writes nothing. The location list reads the active Restaurant Experiences in one statement and filters, searches
 * and pages in memory (a few hundred rows), so search is accent- and punctuation-insensitive.
 */

import { DINING_PLAN_CODES, diningSeedRuleSchema, type DiningConfig } from '@dwt/shared';
import type { PoolClient } from 'pg';

import type { DbPool } from '../../db/pool.js';
import { configToStore, findPriceOverlap, ruleProblems } from './admin/forms.js';
import { coverageOf, locationRowOf, type CatalogLocation } from './admin/views.js';
import type {
  AdminDiningPlanPort,
  AdminLocationDetail,
  AdminPriceInput,
  AdminPriceRow,
  AdminRuleInput,
  AdminWriteResult,
} from './adminPort.js';
import { jsonValue, locationRuleRowOf, mergeStoredConfig, RULE_SELECT, toCalendarDate, toCount, toNullableCalendarDate, toNullableInt, type RuleColumns } from './repo.js';
import { BUNDLED_SEED } from './seed/bundledSeed.js';
import { normalizeSeedName, parseSeedFile, planSeed, seedCounts, type SeedRuleFields } from './seed/seedRules.js';
import type { DiningPlanLogger } from './types.js';

export interface DiningPlanAdminRepoDeps {
  readonly pool: DbPool;
  readonly logger?: DiningPlanLogger;
  /** The seed file contents; the bundled file by default. */
  readonly seed?: unknown;
}

type CatalogRow = {
  id: string;
  name: string;
  park: string | null;
  price_tier: string | null;
  active: boolean;
  grouped_facets: unknown;
  has_menu: boolean | null;
} & RuleColumns;

/** The catalog columns plus the rule (LEFT JOIN) and whether a non-empty cached menu exists. */
const CATALOG_SELECT = `SELECT e.id, e.name, e.park, e.price_tier, e.active, e.grouped_facets,
                (m.experience_id IS NOT NULL AND m.menus::text <> '[]') AS has_menu,
                ${RULE_SELECT}
           FROM experiences e
           LEFT JOIN dining_plan_location_rules r ON r.experience_id = e.id
           LEFT JOIN experience_menus m ON m.experience_id = e.id`;

function catalogLocationOf(r: CatalogRow): CatalogLocation {
  return {
    experienceId: r.id,
    name: r.name,
    park: r.park,
    priceTier: r.price_tier,
    active: r.active === true,
    groupedFacets: jsonValue(r.grouped_facets),
    hasMenu: r.has_menu === true,
    rule: locationRuleRowOf(r),
  };
}

function priceRowOf(r: Record<string, unknown>): AdminPriceRow {
  return {
    id: String(r.id),
    planCode: r.plan_code as AdminPriceRow['planCode'],
    displayName: String(r.display_name),
    validFrom: toCalendarDate(r.valid_from),
    validTo: toCalendarDate(r.valid_to),
    adultCents: toCount(r.adult_cents),
    childCents: toCount(r.child_cents),
    childPromoCents: toNullableInt(r.child_promo_cents),
    promoLabel: (r.promo_label as string | null) ?? null,
    sourceNote: (r.source_note as string | null) ?? null,
    verifiedAt: toNullableCalendarDate(r.verified_at),
  };
}

const PLAN_ORDER = new Map<string, number>(DINING_PLAN_CODES.map((c, i) => [c, i]));

function sortPrices(rows: AdminPriceRow[]): AdminPriceRow[] {
  return rows.sort((a, b) => PLAN_ORDER.get(a.planCode)! - PLAN_ORDER.get(b.planCode)! || (a.validFrom < b.validFrom ? -1 : 1));
}

async function inTransaction<T>(pool: DbPool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

/** The seed notes of the bundled file, which mark a stored unverified rule as one the seed wrote. */
function seedNotesOf(seed: unknown): ReadonlySet<string> {
  const parsed = parseSeedFile(seed);
  if (parsed.ok) return new Set(parsed.entries.map((e) => e.sourceNote));
  // A malformed file still marks the valid entries' notes.
  const notes = new Set<string>();
  if (Array.isArray(seed)) for (const item of seed) {
    const one = diningSeedRuleSchema.safeParse(item);
    if (one.success) notes.add(one.data.sourceNote);
  }
  return notes;
}

const UPSERT_SEEDED = `INSERT INTO dining_plan_location_rules
     (experience_id, service_type, credit_cost, credit_cost_by_period, gratuity_included, rule_status, verified_at, source_note, updated_at)
   VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
   ON CONFLICT (experience_id) DO UPDATE SET
     service_type = EXCLUDED.service_type, credit_cost = EXCLUDED.credit_cost,
     credit_cost_by_period = EXCLUDED.credit_cost_by_period, gratuity_included = EXCLUDED.gratuity_included,
     rule_status = EXCLUDED.rule_status, verified_at = EXCLUDED.verified_at, source_note = EXCLUDED.source_note,
     updated_at = now()`;

export function createDiningPlanAdminRepo(deps: DiningPlanAdminRepoDeps): AdminDiningPlanPort {
  const { pool, logger } = deps;
  const seed = deps.seed ?? BUNDLED_SEED;
  const seedNotes = seedNotesOf(seed);

  async function activeRestaurants(): Promise<CatalogLocation[]> {
    const res = await pool.query<CatalogRow>(`${CATALOG_SELECT} WHERE e.category = 'Restaurant' AND e.active = TRUE`);
    return res.rows.map(catalogLocationOf).sort((a, b) => a.name.localeCompare(b.name) || (a.experienceId < b.experienceId ? -1 : 1));
  }

  return {
    async readState() {
      const prices = await pool.query<Record<string, unknown>>(
        `SELECT id, plan_code, display_name, valid_from, valid_to, adult_cents, child_cents, child_promo_cents, promo_label,
                source_note, verified_at
           FROM dining_plan_prices`,
      );
      const configRes = await pool.query<{ config: unknown }>(`SELECT config FROM dining_plan_config WHERE id = 1`);
      const raw = jsonValue(configRes.rows[0]?.config);
      const storedConfig = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      return {
        prices: sortPrices(prices.rows.map(priceRowOf)),
        storedConfig,
        effectiveConfig: mergeStoredConfig(raw, logger),
        coverage: coverageOf(await activeRestaurants()),
      };
    },

    async listLocations({ q, filter, limit, offset }) {
      const needle = normalizeSeedName(q);
      const rows = (await activeRestaurants())
        .filter((loc) => needle === '' || normalizeSeedName(loc.name).includes(needle))
        .filter((loc) => {
          switch (filter) {
            case 'needs_review':
              return loc.rule === null || loc.rule.ruleStatus === 'unverified';
            case 'has_rule':
              return loc.rule !== null;
            case 'seeded_unverified':
              return loc.rule !== null && loc.rule.ruleStatus === 'unverified' && loc.rule.sourceNote !== null && seedNotes.has(loc.rule.sourceNote);
            default:
              return true;
          }
        });
      return { rows: rows.slice(offset, offset + limit).map(locationRowOf), total: rows.length, limit, offset };
    },

    async getLocation(experienceId): Promise<AdminLocationDetail | null> {
      const res = await pool.query<CatalogRow>(`${CATALOG_SELECT} WHERE e.id = $1 AND e.category = 'Restaurant'`, [experienceId]);
      const row = res.rows[0];
      if (row === undefined) return null;
      const loc = catalogLocationOf(row);
      const rule: AdminRuleInput | null =
        loc.rule === null
          ? null
          : {
              serviceType: loc.rule.serviceType,
              creditCost: loc.rule.creditCost,
              creditCostByPeriod: loc.rule.creditCostByPeriod,
              gratuityIncluded: loc.rule.gratuityIncluded,
              passDiscountEligible: loc.rule.passDiscountEligible,
              overrideAdultCents: loc.rule.overrideAdultCents,
              overrideChildCents: loc.rule.overrideChildCents,
              ruleStatus: loc.rule.ruleStatus,
              verifiedAt: loc.rule.verifiedAt,
              sourceNote: loc.rule.sourceNote,
            };
      return { location: locationRowOf(loc), rule };
    },

    async savePrice(input: AdminPriceInput): Promise<AdminWriteResult> {
      if (input.validTo < input.validFrom) return { ok: false, errors: ['"Valid to" is before "Valid from".'] };
      if (input.childPromoCents !== null && input.promoLabel === null) return { ok: false, errors: ['A promotion price needs a promotion label.'] };
      return inTransaction(pool, async (client) => {
        // The plan's periods, locked, so the overlap check and the write see the same rows.
        const res = await client.query<Record<string, unknown>>(
          `SELECT id, plan_code, display_name, valid_from, valid_to, adult_cents, child_cents, child_promo_cents, promo_label,
                  source_note, verified_at
             FROM dining_plan_prices WHERE plan_code = $1 FOR UPDATE`,
          [input.planCode],
        );
        const existing = res.rows.map(priceRowOf);
        if (input.id !== null) {
          const own = await client.query<{ id: string }>(`SELECT id FROM dining_plan_prices WHERE id = $1`, [input.id]);
          if (own.rows.length === 0) return { ok: false, errors: ['That price period no longer exists.'] };
        }
        const overlap = findPriceOverlap(existing, input);
        if (overlap !== null) {
          return {
            ok: false,
            errors: [`This period overlaps "${overlap.displayName}" (${overlap.validFrom} to ${overlap.validTo}) of the same plan.`],
          };
        }
        const values = [
          input.planCode,
          input.displayName,
          input.validFrom,
          input.validTo,
          input.adultCents,
          input.childCents,
          input.childPromoCents,
          input.promoLabel,
          input.sourceNote,
          input.verifiedAt,
        ];
        if (input.id === null) {
          await client.query(
            `INSERT INTO dining_plan_prices
               (plan_code, display_name, valid_from, valid_to, adult_cents, child_cents, child_promo_cents, promo_label, source_note, verified_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
            values,
          );
        } else {
          await client.query(
            `UPDATE dining_plan_prices
                SET plan_code = $1, display_name = $2, valid_from = $3, valid_to = $4, adult_cents = $5, child_cents = $6,
                    child_promo_cents = $7, promo_label = $8, source_note = $9, verified_at = $10, updated_at = now()
              WHERE id = $11`,
            [...values, input.id],
          );
        }
        return { ok: true };
      });
    },

    async deletePrice(id) {
      const res = await pool.query<{ id: string }>(`DELETE FROM dining_plan_prices WHERE id = $1 RETURNING id`, [id]);
      return res.rows.length > 0;
    },

    async saveConfig(config: DiningConfig) {
      await pool.query(
        `INSERT INTO dining_plan_config (id, config, updated_at) VALUES (1, $1::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
        [JSON.stringify(configToStore(config))],
      );
    },

    async resetConfig() {
      await pool.query(
        `INSERT INTO dining_plan_config (id, config, updated_at) VALUES (1, '{}'::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
      );
    },

    async saveRule(experienceId, input): Promise<AdminWriteResult> {
      const problems = ruleProblems(input);
      if (problems.length > 0) return { ok: false, errors: problems };
      const exp = await pool.query<{ id: string }>(`SELECT id FROM experiences WHERE id = $1 AND category = 'Restaurant'`, [experienceId]);
      if (exp.rows.length === 0) return { ok: false, errors: ['That restaurant is not in the catalog.'] };
      await pool.query(
        `INSERT INTO dining_plan_location_rules
           (experience_id, service_type, credit_cost, credit_cost_by_period, gratuity_included, pass_discount_eligible,
            per_person_adult_cents, per_person_child_cents, rule_status, verified_at, source_note, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (experience_id) DO UPDATE SET
           service_type = EXCLUDED.service_type, credit_cost = EXCLUDED.credit_cost,
           credit_cost_by_period = EXCLUDED.credit_cost_by_period, gratuity_included = EXCLUDED.gratuity_included,
           pass_discount_eligible = EXCLUDED.pass_discount_eligible, per_person_adult_cents = EXCLUDED.per_person_adult_cents,
           per_person_child_cents = EXCLUDED.per_person_child_cents, rule_status = EXCLUDED.rule_status,
           verified_at = EXCLUDED.verified_at, source_note = EXCLUDED.source_note, updated_at = now()`,
        [
          experienceId,
          input.serviceType,
          input.creditCost,
          input.creditCostByPeriod === null ? null : JSON.stringify(input.creditCostByPeriod),
          input.gratuityIncluded,
          input.passDiscountEligible,
          input.overrideAdultCents,
          input.overrideChildCents,
          input.ruleStatus,
          input.verifiedAt,
          input.sourceNote,
        ],
      );
      return { ok: true };
    },

    async deleteRule(experienceId) {
      const res = await pool.query<{ experience_id: string }>(
        `DELETE FROM dining_plan_location_rules WHERE experience_id = $1 RETURNING experience_id`,
        [experienceId],
      );
      return res.rows.length > 0;
    },

    async applySeed() {
      const parsed = parseSeedFile(seed);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      return inTransaction(pool, async (client) => {
        const catalog = await client.query<{ id: string; name: string; upstream_entity_id: string | null }>(
          `SELECT id, name, upstream_entity_id FROM experiences WHERE category = 'Restaurant' AND active = TRUE`,
        );
        // Every stored rule, locked: the no-downgrade decision and the write see the same rows.
        const storedRes = await client.query<RuleColumns>(`SELECT ${RULE_SELECT} FROM dining_plan_location_rules r FOR UPDATE`);
        const stored = new Map<string, SeedRuleFields>();
        for (const r of storedRes.rows) {
          const rule = locationRuleRowOf(r);
          if (rule === null || r.rule_experience_id === null) continue;
          stored.set(r.rule_experience_id, {
            serviceType: rule.serviceType,
            creditCost: rule.creditCost,
            creditCostByPeriod: rule.creditCostByPeriod,
            gratuityIncluded: rule.gratuityIncluded,
            ruleStatus: rule.ruleStatus,
            verifiedAt: rule.verifiedAt,
            sourceNote: rule.sourceNote,
          });
        }
        const plan = planSeed({
          entries: parsed.entries,
          catalog: catalog.rows.map((r) => ({ id: r.id, name: r.name, upstreamEntityId: r.upstream_entity_id })),
          stored,
        });
        // `planSeed` writes at most one row per Experience, so no statement touches a row twice.
        for (const w of plan.writes) {
          await client.query(UPSERT_SEEDED, [
            w.experienceId,
            w.fields.serviceType,
            w.fields.creditCost,
            w.fields.creditCostByPeriod === null ? null : JSON.stringify(w.fields.creditCostByPeriod),
            w.fields.gratuityIncluded,
            w.fields.ruleStatus,
            w.fields.verifiedAt,
            w.fields.sourceNote,
          ]);
        }
        return { ok: true, results: plan.results, counts: seedCounts(plan.results) };
      });
    },
  };
}
