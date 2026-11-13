/**
 * The Admin_Panel's Dining Plan store over pg-mem with every migration applied, reading the rows back, and checking
 * that every save is what the next calculation reads (`createDiningPlanRepo`).
 *
 * Validates: dining-plan-calculator Requirements 2.6, 8.2, 8.3, 8.8 to 8.10, 18.2 to 18.5, 18.8 to 18.10;
 * Properties 24 and 40 (database halves).
 */

import type { IMemoryDb } from 'pg-mem';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DINING_CONFIG_DEFAULTS, type DiningConfig } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { buildMigratedDb, createSeeder, createTestPool, type Seeder } from '../../accountDeletion/__tests__/helpers.js';
import { createDiningPlanAdminRepo } from '../adminRepo.js';
import type { AdminDiningPlanPort, AdminPriceInput, AdminRuleInput } from '../adminPort.js';
import { createDiningPlanRepo } from '../repo.js';

const ORGANIZER = '10000000-0000-4000-8000-000000000001';
const TS = { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] };
const QS = { quickService: [{ id: 'counter-service', name: 'Counter Service' }] };
const LOUNGE = { tableService: [{ id: 'lounges', name: 'Lounges' }] };

let db: IMemoryDb;
let snapshot: { restore(): void };
let pool: DbPool;
let seeder: Seeder;

beforeAll(() => {
  db = buildMigratedDb();
  snapshot = db.backup();
});

beforeEach(async () => {
  snapshot.restore();
  pool = createTestPool(db).pool;
  seeder = createSeeder(pool, { fallbackUserId: ORGANIZER });
});

async function restaurant(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const row = await seeder.insertRow('experiences', { name, category: 'Restaurant', active: true, grouped_facets: TS, price_tier: '$$$', ...extra });
  return String(row.id);
}

async function rows(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await pool.query(sql, params)).rows as Record<string, unknown>[];
}

function price(overrides: Partial<AdminPriceInput> = {}): AdminPriceInput {
  return {
    id: null,
    planCode: 'deluxe',
    displayName: 'Deluxe Dining Plan 2028',
    validFrom: '2028-01-01',
    validTo: '2028-12-31',
    adultCents: 17_000,
    childCents: 5_000,
    childPromoCents: null,
    promoLabel: null,
    sourceNote: 'Disney booking flow 2027-11-01',
    verifiedAt: '2027-11-01',
    ...overrides,
  };
}

function rule(overrides: Partial<AdminRuleInput> = {}): AdminRuleInput {
  return {
    serviceType: 'table_service',
    creditCost: 2,
    creditCostByPeriod: null,
    gratuityIncluded: false,
    passDiscountEligible: null,
    overrideAdultCents: null,
    overrideChildCents: null,
    ruleStatus: 'verified',
    verifiedAt: '2026-07-20',
    sourceNote: 'planDisney 2026-07-20',
    ...overrides,
  };
}

describe('readState (Requirements 18.2, 18.3, 18.5)', () => {
  it('lists the seeded price periods, the stored and effective config, and the coverage of active Restaurants', async () => {
    const withMenu = await restaurant('Liberty Tree Tavern');
    await seeder.insertRow('experience_menus', { experience_id: withMenu, menus: [{ menuType: 'Dinner', groups: [] }] });
    const emptyMenu = await restaurant('Empty Menu Cafe', { grouped_facets: QS, price_tier: null });
    await seeder.insertRow('experience_menus', { experience_id: emptyMenu, menus: [] });
    await restaurant('Tambu Lounge', { grouped_facets: LOUNGE, price_tier: null });
    const verified = await restaurant("Cinderella's Royal Table");
    await restaurant('Closed Inn', { active: false });
    await seeder.insertRow('experiences', { name: 'Space Mountain', category: 'Ride', active: true });
    const admin = createDiningPlanAdminRepo({ pool });
    expect(await admin.saveRule(verified, rule())).toEqual({ ok: true });

    const state = await admin.readState();
    expect(state.prices.map((p) => [p.planCode, p.validFrom, p.verifiedAt])).toEqual([
      ['quick_service', '2026-01-01', null],
      ['quick_service', '2027-01-01', null],
      ['table_service', '2026-01-01', null],
      ['table_service', '2027-01-01', null],
      ['deluxe', '2027-01-01', null],
    ]);
    expect(state.storedConfig).toEqual({});
    expect(state.effectiveConfig).toEqual(DINING_CONFIG_DEFAULTS);
    expect(state.coverage).toEqual({
      activeRestaurants: 4,
      byDerivedServiceType: { table_service: 2, quick_service: 1, snack_only: 0, not_eligible: 1 },
      withRule: 1,
      verified: 1,
      withMenu: 1,
      // The empty-menu cafe and the lounge have neither a usable menu nor a price tier.
      withNeitherMenuNorTier: 2,
    });
  });
});

describe('price periods (Property 24, Requirement 2.6)', () => {
  // Feature: dining-plan-calculator, Property 24: Admin edits are validated
  it('Property 24: a valid period is stored and the next calculation reads it; an overlap stores nothing', async () => {
    const admin = createDiningPlanAdminRepo({ pool });
    expect(await admin.savePrice(price())).toEqual({ ok: true });
    const globals = await createDiningPlanRepo({ pool }).loadGlobals();
    expect(globals.priceRows.find((p) => p.validFrom === '2028-01-01')).toEqual({
      planCode: 'deluxe', displayName: 'Deluxe Dining Plan 2028', validFrom: '2028-01-01', validTo: '2028-12-31',
      adultCents: 17_000, childCents: 5_000, childPromoCents: null, promoLabel: null, verifiedAt: '2027-11-01',
    });

    const before = await rows('SELECT id FROM dining_plan_prices');
    const overlap = await admin.savePrice(price({ validFrom: '2028-06-01', validTo: '2029-05-31', displayName: 'Overlapping' }));
    expect(overlap).toEqual({ ok: false, errors: ['This period overlaps "Deluxe Dining Plan 2028" (2028-01-01 to 2028-12-31) of the same plan.'] });
    // The seeded 2027 deluxe period ends on 2027-12-31, so a period starting that day overlaps it too.
    expect((await admin.savePrice(price({ validFrom: '2027-12-31', validTo: '2027-12-31' }))).ok).toBe(false);
    expect(await rows('SELECT id FROM dining_plan_prices')).toHaveLength(before.length);
    // Another plan's dates never conflict.
    expect(await admin.savePrice(price({ planCode: 'quick_service', displayName: 'QS 2028' }))).toEqual({ ok: true });
  });

  it('rejects valid_to before valid_from and a promotion without a label, writing nothing', async () => {
    const admin = createDiningPlanAdminRepo({ pool });
    const before = (await rows('SELECT id FROM dining_plan_prices')).length;
    expect(await admin.savePrice(price({ validFrom: '2028-12-31', validTo: '2028-01-01' }))).toEqual({ ok: false, errors: ['"Valid to" is before "Valid from".'] });
    expect(await admin.savePrice(price({ childPromoCents: 0 }))).toEqual({ ok: false, errors: ['A promotion price needs a promotion label.'] });
    expect((await rows('SELECT id FROM dining_plan_prices')).length).toBe(before);
  });

  it('edits a period in place (its own range is not an overlap), refuses a missing id, and deletes', async () => {
    const admin = createDiningPlanAdminRepo({ pool });
    const [seeded] = await rows(`SELECT id FROM dining_plan_prices WHERE plan_code = 'table_service' AND valid_from = '2027-01-01'`);
    const id = String(seeded!.id);
    expect(await admin.savePrice(price({ id, planCode: 'table_service', displayName: 'Table-Service Dining Plan', validFrom: '2027-01-01', validTo: '2027-12-31', adultCents: 10_100 }))).toEqual({ ok: true });
    expect(await rows('SELECT adult_cents, verified_at FROM dining_plan_prices WHERE id = $1', [id])).toEqual([{ adult_cents: 10_100, verified_at: expect.anything() }]);
    expect(await admin.savePrice(price({ id: '99999999-9999-4999-8999-999999999999' }))).toEqual({ ok: false, errors: ['That price period no longer exists.'] });
    expect(await admin.deletePrice(id)).toBe(true);
    expect(await admin.deletePrice(id)).toBe(false);
    expect(await rows('SELECT id FROM dining_plan_prices WHERE id = $1', [id])).toEqual([]);
  });
});

describe('default assumptions (Requirement 18.3)', () => {
  it('stores only the values that differ from the defaults, the calculation reads them, and reset clears them', async () => {
    const admin = createDiningPlanAdminRepo({ pool });
    const changed: DiningConfig = { ...DINING_CONFIG_DEFAULTS, snackCents: 700, planPricesIncludeTax: false, tierEstimates: { ...DINING_CONFIG_DEFAULTS.tierEstimates, quick_service: { '1': 1500, '2': 1700, '3': 2000, '4': 2400 } } };
    await admin.saveConfig(changed);
    const [stored] = await rows('SELECT config FROM dining_plan_config WHERE id = 1');
    expect(stored!.config).toEqual({ snackCents: 700, planPricesIncludeTax: false, tierEstimates: changed.tierEstimates });
    expect((await createDiningPlanRepo({ pool }).loadGlobals()).config).toEqual(changed);
    expect((await admin.readState()).storedConfig).toEqual({ snackCents: 700, planPricesIncludeTax: false, tierEstimates: changed.tierEstimates });
    await admin.resetConfig();
    expect((await rows('SELECT config FROM dining_plan_config WHERE id = 1'))[0]!.config).toEqual({});
    expect((await createDiningPlanRepo({ pool }).loadGlobals()).config).toEqual(DINING_CONFIG_DEFAULTS);
  });
});

describe('locations (Requirements 18.4, 18.10)', () => {
  let ids: Record<string, string>;
  let admin: AdminDiningPlanPort;
  const seed = [
    { name: 'Cape Town Lounge and Wine Bar', serviceType: 'table_service', creditCost: 2, gratuityIncluded: false, ruleStatus: 'unverified', sourceNote: 'The Magic For Less 2026-11 (third party only)' },
  ];

  beforeEach(async () => {
    ids = {
      citricos: await restaurant('Cítricos'),
      capeTown: await restaurant('Cape Town Lounge and Wine Bar'),
      pecos: await restaurant('Pecos Bill Tall Tale Inn and Cafe', { grouped_facets: QS }),
      edited: await restaurant('Sanaa'),
      lounge: await restaurant('Tambu Lounge', { grouped_facets: LOUNGE }),
    };
    admin = createDiningPlanAdminRepo({ pool, seed });
    expect((await admin.applySeed()).ok).toBe(true);
    expect(await admin.saveRule(ids.citricos!, rule())).toEqual({ ok: true });
    expect(await admin.saveRule(ids.edited!, rule({ creditCost: 1, ruleStatus: 'unverified', verifiedAt: null, sourceNote: 'Operator note' }))).toEqual({ ok: true });
  });

  const names = (page: { rows: readonly { name: string }[] }) => page.rows.map((r) => r.name);

  it('searches without regard to accents or punctuation and filters by review state', async () => {
    expect(names(await admin.listLocations({ q: 'citricos', filter: 'all', limit: 50, offset: 0 }))).toEqual(['Cítricos']);
    expect(names(await admin.listLocations({ q: '', filter: 'needs_review', limit: 50, offset: 0 }))).toEqual(['Cape Town Lounge and Wine Bar', 'Pecos Bill Tall Tale Inn and Cafe', 'Sanaa', 'Tambu Lounge']);
    expect(names(await admin.listLocations({ q: '', filter: 'has_rule', limit: 50, offset: 0 }))).toEqual(['Cape Town Lounge and Wine Bar', 'Cítricos', 'Sanaa']);
    // Only the unverified rule the seed wrote, not the operator's own unverified rule.
    expect(names(await admin.listLocations({ q: '', filter: 'seeded_unverified', limit: 50, offset: 0 }))).toEqual(['Cape Town Lounge and Wine Bar']);
  });

  it('pages the list and reports the total', async () => {
    const page = await admin.listLocations({ q: '', filter: 'all', limit: 2, offset: 2 });
    expect([page.total, page.limit, page.offset]).toEqual([5, 2, 2]);
    expect(names(page)).toEqual(['Pecos Bill Tall Tale Inn and Cafe', 'Sanaa']);
  });

  it('shows the derived service type of a location with no rule, and returns null for a ride or an unknown id', async () => {
    const lounge = await admin.getLocation(ids.lounge!);
    expect(lounge).toMatchObject({ rule: null, location: { derivedServiceType: 'not_eligible', effectiveServiceType: 'not_eligible', ruleBasis: 'derived' } });
    const citricos = await admin.getLocation(ids.citricos!);
    expect(citricos).toMatchObject({ rule: rule(), location: { derivedServiceType: 'table_service', creditCost: 2, ruleBasis: 'verified' } });
    const ride = String((await seeder.insertRow('experiences', { name: 'Space Mountain', category: 'Ride' })).id);
    expect(await admin.getLocation(ride)).toBeNull();
    expect(await admin.getLocation('99999999-9999-4999-8999-999999999999')).toBeNull();
  });
});

describe('location rules (Property 24, Requirements 8.3, 8.8)', () => {
  it('rejects a credit cost of 2 at a quick-service rule and a verified rule without a date, writing nothing', async () => {
    const id = await restaurant('Pecos Bill', { grouped_facets: QS });
    const admin = createDiningPlanAdminRepo({ pool });
    expect(await admin.saveRule(id, rule({ serviceType: 'quick_service' }))).toEqual({ ok: false, errors: ['A credit cost of 2 needs the service type "table_service".'] });
    // A NULL ("derive") service type is not table service either, even where the facets derive as table service.
    expect((await admin.saveRule(id, rule({ serviceType: null }))).ok).toBe(false);
    expect(await admin.saveRule(id, rule({ verifiedAt: null }))).toEqual({ ok: false, errors: ['A verified rule needs the date it was verified.'] });
    expect(await rows('SELECT * FROM dining_plan_location_rules')).toEqual([]);
  });

  it('stores a rule with a credit cost by meal period that the next calculation reads, replaces it, and deletes it', async () => {
    const id = await restaurant('Akershus Royal Banquet Hall');
    const admin = createDiningPlanAdminRepo({ pool });
    const saved = rule({ creditCost: 1, creditCostByPeriod: { lunch: 2, dinner: 2 }, overrideAdultCents: 6_500, passDiscountEligible: false });
    expect(await admin.saveRule(id, saved)).toEqual({ ok: true });
    const read = await createDiningPlanRepo({ pool }).loadLocations([id]);
    expect(read.get(id)!.rule).toEqual({
      serviceType: 'table_service', creditCost: 1, creditCostByPeriod: { lunch: 2, dinner: 2 }, gratuityIncluded: false,
      passDiscountEligible: false, overrideAdultCents: 6_500, overrideChildCents: null, ruleStatus: 'verified',
      verifiedAt: '2026-07-20', sourceNote: 'planDisney 2026-07-20',
    });
    expect(await admin.saveRule(id, rule({ creditCost: 1, ruleStatus: 'unverified', verifiedAt: null }))).toEqual({ ok: true });
    expect((await createDiningPlanRepo({ pool }).loadLocations([id])).get(id)!.rule).toMatchObject({ creditCostByPeriod: null, ruleStatus: 'unverified', overrideAdultCents: null });
    expect(await admin.deleteRule(id)).toBe(true);
    expect(await admin.deleteRule(id)).toBe(false);
    expect((await createDiningPlanRepo({ pool }).loadLocations([id])).get(id)!.rule).toBeNull();
  });

  it('refuses a rule for an Experience that is not a Restaurant', async () => {
    const ride = String((await seeder.insertRow('experiences', { name: 'Space Mountain', category: 'Ride' })).id);
    expect(await createDiningPlanAdminRepo({ pool }).saveRule(ride, rule())).toEqual({ ok: false, errors: ['That restaurant is not in the catalog.'] });
  });
});

describe('applySeed (Property 40, Requirements 8.10, 18.8, 18.10)', () => {
  const entry = (name: string, extra: Record<string, unknown> = {}) => ({
    name, serviceType: 'table_service', creditCost: 2, gratuityIncluded: false, ruleStatus: 'unverified', sourceNote: `Third party 2026-11: ${name}`, ...extra,
  });

  // Feature: dining-plan-calculator, Property 40: The seed is consistent, never downgrades, and reports what it skipped
  it('Property 40: inserts the matched rules, changes nothing on a second run, and never downgrades a verified rule', async () => {
    const crt = await restaurant("Cinderella's Royal Table", { upstream_entity_id: '90002464;entityType=restaurant' });
    const boathouse = await restaurant('The BOATHOUSE®: Great Food, Waterfront Dining, Dream Boats™');
    const citricos = await restaurant('Cítricos');
    await restaurant('Twin One');
    await restaurant('Twin, One!');
    const seed = [
      entry("Cinderella's Royal Table", { upstreamEntityId: '90002464;entityType=restaurant' }),
      entry('The BOATHOUSE', { aliases: ['The BOATHOUSE: Great Food, Waterfront Dining, Dream Boats'] }),
      entry('Citricos', { creditCost: 1, creditCostByPeriod: { dinner: 2 } }),
      entry('Twin One'),
      entry('Not In The Catalog'),
    ];
    const admin = createDiningPlanAdminRepo({ pool, seed });
    // The operator had already verified Cinderella's Royal Table.
    expect(await admin.saveRule(crt, rule({ gratuityIncluded: true, verifiedAt: '2026-11-09', sourceNote: 'Disney Dining Plans page 2026-11-09' }))).toEqual({ ok: true });

    const first = await admin.applySeed();
    if (!first.ok) throw new Error(first.error);
    expect(first.results.map((r) => [r.name, r.outcome, r.experienceId])).toEqual([
      ["Cinderella's Royal Table", 'kept', crt],
      ['The BOATHOUSE', 'inserted', boathouse],
      ['Citricos', 'inserted', citricos],
      ['Twin One', 'ambiguous', null],
      ['Not In The Catalog', 'unmatched', null],
    ]);
    expect(first.counts).toEqual({ inserted: 2, updated: 0, kept: 1, unmatched: 1, ambiguous: 1 });
    expect(first.results[0]!.reason).toBe('A verified rule is never replaced by an unverified one.');
    const table = await rows('SELECT * FROM dining_plan_location_rules ORDER BY experience_id');
    expect(table.map((r) => [r.experience_id, r.rule_status, r.credit_cost, r.credit_cost_by_period])).toEqual(
      [[crt, 'verified', 2, null], [boathouse, 'unverified', 2, null], [citricos, 'unverified', 1, { dinner: 2 }]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );

    const second = await admin.applySeed();
    if (!second.ok) throw new Error(second.error);
    expect(second.counts).toEqual({ inserted: 0, updated: 0, kept: 3, unmatched: 1, ambiguous: 1 });
    expect(second.results[1]!.reason).toBe('The stored rule already matches the seed.');
    // Identical to one run, `updated_at` included.
    expect(await rows('SELECT * FROM dining_plan_location_rules ORDER BY experience_id')).toEqual(table);
  });

  it('updates an unverified rule that differs from the seed, leaving the per-person overrides alone', async () => {
    const id = await restaurant('Toledo - Tapas, Steak & Seafood');
    const admin = createDiningPlanAdminRepo({ pool, seed: [entry('Toledo - Tapas, Steak & Seafood')] });
    expect(await admin.saveRule(id, rule({ creditCost: 1, ruleStatus: 'unverified', verifiedAt: null, overrideAdultCents: 5_000, sourceNote: 'old' }))).toEqual({ ok: true });
    const result = await admin.applySeed();
    expect(result.ok && result.counts.updated).toBe(1);
    expect(await rows('SELECT credit_cost, rule_status, source_note, per_person_adult_cents FROM dining_plan_location_rules WHERE experience_id = $1', [id])).toEqual([
      { credit_cost: 2, rule_status: 'unverified', source_note: 'Third party 2026-11: Toledo - Tapas, Steak & Seafood', per_person_adult_cents: 5_000 },
    ]);
  });

  it('fails the whole action before any write when an entry is malformed, and names it', async () => {
    await restaurant('Le Cellier Steakhouse');
    const admin = createDiningPlanAdminRepo({ pool, seed: [entry('Le Cellier Steakhouse'), entry('Bad Two-Credit Counter', { serviceType: 'quick_service' })] });
    expect(await admin.applySeed()).toEqual({ ok: false, error: 'Seed entry 2 "Bad Two-Credit Counter" is invalid (creditCost): A credit cost of 2 needs table_service' });
    expect(await rows('SELECT * FROM dining_plan_location_rules')).toEqual([]);
  });

  it('applies the bundled seed to the catalog rows it names, including the per-period credit costs', async () => {
    const akershus = await restaurant('Akershus Royal Banquet Hall', { upstream_entity_id: '90002066;entityType=restaurant' });
    const morimoto = await restaurant('Morimoto Asia™', { upstream_entity_id: '17936194;entityType=restaurant' });
    const topolino = await restaurant("Topolino's Terrace – Flavors of the Riviera", { upstream_entity_id: '19233597;entityType=restaurant' });
    const grill = await restaurant('California Grill', { upstream_entity_id: '90001336;entityType=restaurant' });
    const result = await createDiningPlanAdminRepo({ pool }).applySeed();
    if (!result.ok) throw new Error(result.error);
    expect(result.counts.inserted).toBe(4);
    const byId = new Map((await rows('SELECT experience_id, service_type, credit_cost, credit_cost_by_period, rule_status, verified_at FROM dining_plan_location_rules')).map((r) => [r.experience_id, r]));
    expect(byId.get(akershus)).toMatchObject({ credit_cost: 1, credit_cost_by_period: { lunch: 2, dinner: 2 }, rule_status: 'verified' });
    expect(byId.get(morimoto)).toMatchObject({ credit_cost: 1, credit_cost_by_period: { dinner: 2 }, rule_status: 'verified' });
    expect(byId.get(topolino)).toMatchObject({ credit_cost: 1, credit_cost_by_period: { dinner: 2 }, rule_status: 'verified' });
    expect(byId.get(grill)).toMatchObject({ service_type: 'not_eligible', credit_cost: 1, credit_cost_by_period: null, rule_status: 'unverified', verified_at: null });
  });
});
