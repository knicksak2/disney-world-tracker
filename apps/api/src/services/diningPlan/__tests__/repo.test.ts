/**
 * Dining Plan repo over pg-mem with every migration applied (`buildMigratedDb()`), reading the persisted rows back.
 *
 * Validates: dining-plan-calculator Requirements 4.1 to 4.4, 5.4 to 5.7, 6.3, 6.5, 8.8, 16.7, 17.1, 17.2, 17.6;
 * Properties 21 and 28 (stored settings).
 */

import { randomUUID } from 'node:crypto';

import fc from 'fast-check';
import type { IMemoryDb } from 'pg-mem';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DINING_CONFIG_DEFAULTS, DINING_PLAN_ENTRIES_MAX, diningPlanSettingsSchema, type DiningPlanSettingsInput } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { buildMigratedDb, createSeeder, createTestPool, type Seeder } from '../../accountDeletion/__tests__/helpers.js';
import { createDiningPlanRepo, mergeStoredConfig, parseStoredSettings } from '../repo.js';
import type { DiningImportItem, DiningPlanRepo } from '../types.js';

const ORGANIZER = '10000000-0000-4000-8000-000000000001';

let db: IMemoryDb;
let snapshot: { restore(): void };
let pool: DbPool;
let seeder: Seeder;
let repo: DiningPlanRepo;
let warnings: { obj: object; msg?: string }[];
let tripId: string;

beforeAll(() => {
  db = buildMigratedDb();
  snapshot = db.backup();
});

beforeEach(async () => {
  snapshot.restore();
  pool = createTestPool(db).pool;
  seeder = createSeeder(pool, { fallbackUserId: ORGANIZER });
  await seeder.insertRow('users', { id: ORGANIZER, email: 'org@example.com', password_hash: 'hash' });
  warnings = [];
  repo = createDiningPlanRepo({ pool, logger: { warn: (obj, msg) => warnings.push({ obj, ...(msg === undefined ? {} : { msg }) }) } });
  tripId = String((await seeder.insertRow('trips', { creator_id: ORGANIZER, start_date: '2027-03-01', end_date: '2027-03-06' })).id);
});

const TS_FACETS = { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] };

async function experience(overrides: Record<string, unknown> = {}): Promise<string> {
  const row = await seeder.insertRow('experiences', { name: 'Liberty Tree Tavern', category: 'Restaurant', active: true, grouped_facets: TS_FACETS, ...overrides });
  return String(row.id);
}

async function plannedItem(overrides: Record<string, unknown>): Promise<string> {
  const row = await seeder.insertRow('planned_items', { trip_id: tripId, added_by: ORGANIZER, ...overrides });
  return String(row.id);
}

async function entryRows(): Promise<Record<string, unknown>[]> {
  const res = await pool.query(
    `SELECT entry_date, meal_period, kind, experience_id, placeholder_kind, planned_item_id, excluded_keys FROM trip_dining_plan_entries WHERE trip_id = $1`,
    [tripId],
  );
  return (res.rows as Record<string, unknown>[])
    .map((r): Record<string, unknown> => ({ ...r, entry_date: r.entry_date instanceof Date ? r.entry_date.toISOString().slice(0, 10) : r.entry_date }))
    .sort((a, b) => `${String(a.entry_date)}${String(a.meal_period)}`.localeCompare(`${String(b.entry_date)}${String(b.meal_period)}`));
}

describe('loadTripCore', () => {
  it('returns the Trip dates, and null for an unknown Trip', async () => {
    expect(await repo.loadTripCore(tripId)).toEqual({ startDate: '2027-03-01', endDate: '2027-03-06' });
    expect(await repo.loadTripCore(randomUUID())).toBeNull();
  });
});

describe('loadScenario and saveSettings', () => {
  it('returns the defaults and no entries when no scenario row exists', async () => {
    expect(await repo.loadScenario(tripId)).toEqual({ settings: diningPlanSettingsSchema.parse({}), entries: [] });
  });

  it('round-trips settings through the stored JSON, replacing the row on a second save', async () => {
    const first = diningPlanSettingsSchema.parse({ orderStyle: 'splurge', beverage: 'water', alcoholDrinkerKeys: ['m:abc'], taxBps: 700 });
    await repo.saveSettings(tripId, first);
    expect((await repo.loadScenario(tripId)).settings).toEqual(first);
    const second = diningPlanSettingsSchema.parse({ stayPlans: { 'stay-1': { status: 'have_plan', heldPlan: 'deluxe' } } });
    await repo.saveSettings(tripId, second);
    expect((await repo.loadScenario(tripId)).settings).toEqual(second);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM trip_dining_plan_scenarios WHERE trip_id = $1`, [tripId]);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it('defaults an invalid stored key, keeps the valid ones, and logs only the key names', async () => {
    await pool.query(`INSERT INTO trip_dining_plan_scenarios (trip_id, settings) VALUES ($1, $2::jsonb)`, [
      tripId,
      JSON.stringify({ orderStyle: 'splurge', taxBps: 99_999, mystery: 'x', beverage: 'water' }),
    ]);
    const { settings } = await repo.loadScenario(tripId);
    expect(settings).toMatchObject({ orderStyle: 'splurge', beverage: 'water', taxBps: null });
    expect(warnings).toHaveLength(1);
    expect(JSON.stringify(warnings[0])).toContain('taxBps');
    expect(JSON.stringify(warnings[0])).not.toContain('99999');
  });

  it('rejects a write to an unknown Trip with trip_forbidden', async () => {
    await expect(repo.saveSettings(randomUUID(), diningPlanSettingsSchema.parse({}))).rejects.toMatchObject({ code: 'trip_forbidden' });
  });
});

describe('upsertEntry and deleteEntry', () => {
  it('inserts, replaces a slot in place, and deletes it, with the stored columns read back', async () => {
    const liberty = await experience();
    await repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: liberty, placeholderKind: null, excludedKeys: ['m:a', 'm:a', 'g:b'] });
    expect(await entryRows()).toEqual([
      { entry_date: '2027-03-02', meal_period: 'dinner', kind: 'restaurant', experience_id: liberty, placeholder_kind: null, planned_item_id: null, excluded_keys: ['m:a', 'g:b'] },
    ]);
    await repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'placeholder', experienceId: null, placeholderKind: 'quick_service', excludedKeys: [] });
    expect(await entryRows()).toEqual([
      { entry_date: '2027-03-02', meal_period: 'dinner', kind: 'placeholder', experience_id: null, placeholder_kind: 'quick_service', planned_item_id: null, excluded_keys: [] },
    ]);
    const { entries } = await repo.loadScenario(tripId);
    expect(entries).toEqual([expect.objectContaining({ date: '2027-03-02', mealPeriod: 'dinner', kind: 'placeholder', excludedKeys: [] })]);
    expect(await repo.deleteEntry(tripId, '2027-03-02', 'dinner')).toBe(true);
    expect(await repo.deleteEntry(tripId, '2027-03-02', 'dinner')).toBe(false);
    expect(await entryRows()).toEqual([]);
  });

  it('orders loaded entries by date, then breakfast, lunch, dinner', async () => {
    for (const [date, mealPeriod] of [['2027-03-03', 'breakfast'], ['2027-03-02', 'lunch'], ['2027-03-02', 'dinner'], ['2027-03-02', 'breakfast']] as const) {
      await repo.upsertEntry(tripId, { date, mealPeriod, kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] });
    }
    expect((await repo.loadScenario(tripId)).entries.map((e) => `${e.date} ${e.mealPeriod}`)).toEqual([
      '2027-03-02 breakfast', '2027-03-02 lunch', '2027-03-02 dinner', '2027-03-03 breakfast',
    ]);
  });

  it.each([
    ['missing', async () => randomUUID()],
    ['inactive', async () => experience({ active: false })],
    ['not a Restaurant', async () => experience({ name: 'Space Mountain', category: 'Ride' })],
  ])('rejects a restaurant entry whose Experience is %s, writing nothing', async (_label, make) => {
    const id = await make();
    await expect(
      repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'restaurant', experienceId: id, placeholderKind: null, excludedKeys: [] }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'experienceId' });
    expect(await entryRows()).toEqual([]);
  });

  it('accepts the 120th entry and rejects the 121st, while a replace at the cap still works', async () => {
    const start = Date.parse('2027-01-01T00:00:00Z');
    for (let i = 0; i < DINING_PLAN_ENTRIES_MAX; i += 1) {
      const date = new Date(start + Math.floor(i / 3) * 86_400_000).toISOString().slice(0, 10);
      await pool.query(`INSERT INTO trip_dining_plan_entries (trip_id, entry_date, meal_period, kind) VALUES ($1, $2, $3, 'skip')`, [
        tripId, date, (['breakfast', 'lunch', 'dinner'] as const)[i % 3],
      ]);
    }
    await expect(
      repo.upsertEntry(tripId, { date: '2027-12-31', mealPeriod: 'dinner', kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'entries' });
    await repo.upsertEntry(tripId, { date: '2027-01-01', mealPeriod: 'breakfast', kind: 'placeholder', experienceId: null, placeholderKind: 'table_service', excludedKeys: [] });
    expect(await entryRows()).toHaveLength(DINING_PLAN_ENTRIES_MAX);
  });

  it('rejects more than 50 excluded keys', async () => {
    const keys = Array.from({ length: 51 }, (_, i) => `m:p${i}`);
    await expect(
      repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: keys }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed', field: 'excludedKeys' });
  });

  it('cascades the scenario and entries when the Trip is deleted', async () => {
    await repo.saveSettings(tripId, diningPlanSettingsSchema.parse({}));
    await repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'skip', experienceId: null, placeholderKind: null, excludedKeys: [] });
    await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);
    const entries = await pool.query(`SELECT count(*)::int AS n FROM trip_dining_plan_entries`);
    const scenarios = await pool.query(`SELECT count(*)::int AS n FROM trip_dining_plan_scenarios`);
    expect([entries.rows[0], scenarios.rows[0]]).toEqual([{ n: 0 }, { n: 0 }]);
  });
});

describe('loadPlannedDiningItems', () => {
  it('returns dining reservations and plain planned Restaurants only', async () => {
    const boG = await experience({ name: 'Be Our Guest Restaurant' });
    const pecos = await experience({ name: 'Pecos Bill Tall Tale Inn and Cafe' });
    const closed = await experience({ name: 'Closed Cafe', active: false });
    const ride = await experience({ name: 'Space Mountain', category: 'Ride' });
    const reservation = await plannedItem({ experience_id: boG, planned_date: '2027-03-02', planned_time: '2027-03-02T23:30:00Z', reservation_kind: 'dining', party_size: 2, meal_period: 'dinner' });
    const plain = await plannedItem({ experience_id: pecos, planned_date: '2027-03-03' });
    await plannedItem({ item_type: 'break', experience_id: null, planned_date: '2027-03-03', custom_title: 'Lunch break' });
    await plannedItem({ experience_id: pecos, planned_date: null });
    await plannedItem({ experience_id: closed, planned_date: '2027-03-04' });
    await plannedItem({ experience_id: ride, planned_date: '2027-03-04' });
    // Another reservation kind at a Restaurant (an activity booked there) is not a meal.
    await plannedItem({ experience_id: pecos, planned_date: '2027-03-05', planned_time: '2027-03-05T15:00:00Z', reservation_kind: 'activity' });
    const otherTrip = String((await seeder.insertRow('trips', { creator_id: ORGANIZER })).id);
    await seeder.insertRow('planned_items', { trip_id: otherTrip, added_by: ORGANIZER, experience_id: boG, planned_date: '2027-03-02' });

    const rows = [...(await repo.loadPlannedDiningItems(tripId))].sort((a, b) => a.id.localeCompare(b.id));
    expect(rows).toEqual(
      [
        {
          id: reservation, itemType: 'experience', experienceId: boG, experienceName: 'Be Our Guest Restaurant', experienceCategory: 'Restaurant', experienceActive: true,
          plannedDate: '2027-03-02', plannedTime: '2027-03-02T23:30:00.000Z', mealPeriod: 'dinner', partySize: 2, reservationKind: 'dining',
        },
        {
          id: plain, itemType: 'experience', experienceId: pecos, experienceName: 'Pecos Bill Tall Tale Inn and Cafe', experienceCategory: 'Restaurant', experienceActive: true,
          plannedDate: '2027-03-03', plannedTime: null, mealPeriod: null, partySize: null, reservationKind: null,
        },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
});

describe('loadLocations and loadGlobals', () => {
  it('returns the requested Experiences with their rule (period map round-trips), facets and menus, always in two statements', async () => {
    const akershus = await experience({ name: 'Akershus Royal Banquet Hall', price_tier: '$$$' });
    const pecos = await experience({ name: 'Pecos Bill', grouped_facets: { quickService: [{ id: 'counter-service', name: 'Counter Service' }] } });
    const notAsked = await experience({ name: 'Not Asked' });
    await pool.query(
      `INSERT INTO dining_plan_location_rules (experience_id, service_type, credit_cost, credit_cost_by_period, per_person_adult_cents, rule_status, verified_at, source_note)
       VALUES ($1, 'table_service', 1, $2::jsonb, 6500, 'verified', '2026-11-09', 'planDisney 2026-07-20')`,
      [akershus, JSON.stringify({ lunch: 2, dinner: 2 })],
    );
    const menus = [{ menuType: 'Lunch', groups: [{ name: 'Entrées', items: [{ name: 'Burger', priceCents: 1500 }] }] }];
    await pool.query(`INSERT INTO experience_menus (experience_id, menus, fetched_at) VALUES ($1, $2::jsonb, now())`, [pecos, JSON.stringify(menus)]);

    const recorder = createTestPool(db);
    const r = createDiningPlanRepo({ pool: recorder.pool });
    const locations = await r.loadLocations([akershus, pecos, randomUUID()]);
    expect(recorder.statements).toHaveLength(2);
    expect([...locations.keys()].sort()).toEqual([akershus, pecos].sort());
    expect(locations.has(notAsked)).toBe(false);
    expect(locations.get(akershus)).toEqual({
      experienceId: akershus, name: 'Akershus Royal Banquet Hall', category: 'Restaurant', active: true, priceTier: '$$$', groupedFacets: TS_FACETS, menus: null,
      rule: {
        serviceType: 'table_service', creditCost: 1, creditCostByPeriod: { lunch: 2, dinner: 2 }, gratuityIncluded: false, passDiscountEligible: null,
        overrideAdultCents: 6500, overrideChildCents: null, ruleStatus: 'verified', verifiedAt: '2026-11-09', sourceNote: 'planDisney 2026-07-20',
      },
    });
    expect(locations.get(pecos)).toMatchObject({ rule: null, menus });

    recorder.reset();
    expect((await r.loadLocations([])).size).toBe(0);
    expect(recorder.statements).toHaveLength(2);
  });

  it('returns the five seeded price periods and the defaults when no config is stored', async () => {
    const recorder = createTestPool(db);
    const g = await createDiningPlanRepo({ pool: recorder.pool }).loadGlobals();
    expect(recorder.statements).toHaveLength(2);
    expect(g.config).toEqual(DINING_CONFIG_DEFAULTS);
    expect(g.priceRows.map((p) => [p.planCode, p.validFrom, p.validTo, p.adultCents, p.childCents, p.childPromoCents, p.verifiedAt])).toEqual([
      ['deluxe', '2027-01-01', '2027-12-31', 16301, 4685, null, null],
      ['quick_service', '2026-01-01', '2026-12-31', 6047, 2616, 0, null],
      ['quick_service', '2027-01-01', '2027-12-31', 6278, 2582, null, null],
      ['table_service', '2026-01-01', '2026-12-31', 9859, 3194, 0, null],
      ['table_service', '2027-01-01', '2027-12-31', 9987, 3194, null, null],
    ]);
  });

  it('merges stored config over the defaults key by key, ignoring an out-of-range value', async () => {
    await pool.query(`UPDATE dining_plan_config SET config = $1::jsonb WHERE id = 1`, [JSON.stringify({ snackCents: 700, tipBps: 99_999, planPricesIncludeTax: false })]);
    const g = await repo.loadGlobals();
    expect(g.config).toEqual({ ...DINING_CONFIG_DEFAULTS, snackCents: 700, planPricesIncludeTax: false });
    expect(JSON.stringify(warnings)).toContain('tipBps');
  });
});

describe('importEntries', () => {
  let items: DiningImportItem[];
  let boG: string;

  beforeEach(async () => {
    boG = await experience({ name: 'Be Our Guest Restaurant' });
    const pecos = await experience({ name: 'Pecos Bill' });
    const a = await plannedItem({ experience_id: boG, planned_date: '2027-03-02', planned_time: '2027-03-02T23:30:00Z', reservation_kind: 'dining' });
    const b = await plannedItem({ experience_id: pecos, planned_date: '2027-03-03' });
    items = [
      { plannedItemId: a, experienceId: boG, date: '2027-03-02', mealPeriod: 'dinner' },
      { plannedItemId: b, experienceId: pecos, date: '2027-03-03', mealPeriod: 'lunch' },
    ];
  });

  it('creates entries linked to their planned items and is idempotent on a second call', async () => {
    expect(await repo.importEntries(tripId, items, false)).toEqual({ created: 2, skippedExisting: 0 });
    const rows = await entryRows();
    expect(rows.map((r) => [r.entry_date, r.meal_period, r.kind, r.experience_id, r.planned_item_id])).toEqual([
      ['2027-03-02', 'dinner', 'restaurant', boG, items[0]!.plannedItemId],
      ['2027-03-03', 'lunch', 'restaurant', items[1]!.experienceId, items[1]!.plannedItemId],
    ]);
    expect(await repo.importEntries(tripId, items, false)).toEqual({ created: 0, skippedExisting: 2 });
    expect(await repo.importEntries(tripId, items, true)).toEqual({ created: 0, skippedExisting: 2 });
    expect(await entryRows()).toHaveLength(2);
  });

  it('skips an occupied slot, and replaces it with overwrite', async () => {
    await repo.upsertEntry(tripId, { date: '2027-03-02', mealPeriod: 'dinner', kind: 'placeholder', experienceId: null, placeholderKind: 'table_service', excludedKeys: ['m:x'] });
    expect(await repo.importEntries(tripId, items, false)).toEqual({ created: 1, skippedExisting: 1 });
    expect((await entryRows())[0]).toMatchObject({ kind: 'placeholder', planned_item_id: null });
    expect(await repo.importEntries(tripId, items, true)).toEqual({ created: 1, skippedExisting: 1 });
    expect((await entryRows())[0]).toMatchObject({ kind: 'restaurant', experience_id: boG, placeholder_kind: null, planned_item_id: items[0]!.plannedItemId, excluded_keys: [] });
  });

  it('takes the first of two items for one slot and skips the second', async () => {
    const twin = { ...items[1]!, date: '2027-03-02', mealPeriod: 'dinner' as const };
    expect(await repo.importEntries(tripId, [items[0]!, twin], true)).toEqual({ created: 1, skippedExisting: 1 });
    expect(await entryRows()).toHaveLength(1);
  });

  // Feature: dining-plan-calculator, Property 46: An imported dining reservation keeps its Experience
  // Validates: Requirements 5.11, 4.3
  it('Property 46: imports a dessert-party reservation (category Event) that a hand-set entry may not name', async () => {
    const dessertParty = await experience({ name: 'Magic Kingdom Fireworks Dessert Parties: Seats & Sweets', category: 'Event', grouped_facets: {} });
    const reservation = await plannedItem({ experience_id: dessertParty, planned_date: '2027-03-04', planned_time: '2027-03-05T01:00:00Z', reservation_kind: 'dining' });
    expect(await repo.importEntries(tripId, [{ plannedItemId: reservation, experienceId: dessertParty, date: '2027-03-04', mealPeriod: 'dinner' }], false)).toEqual({
      created: 1,
      skippedExisting: 0,
    });
    expect(await entryRows()).toEqual([expect.objectContaining({ kind: 'restaurant', experience_id: dessertParty, planned_item_id: reservation })]);
    await expect(
      repo.upsertEntry(tripId, { date: '2027-03-05', mealPeriod: 'dinner', kind: 'restaurant', experienceId: dessertParty, placeholderKind: null, excludedKeys: [] }),
    ).rejects.toMatchObject({ code: 'trip_validation_failed' });
  });

  it('keeps the entry with planned_item_id NULL when the planned item is deleted (a snapshot)', async () => {
    await repo.importEntries(tripId, items, false);
    await pool.query(`DELETE FROM planned_items WHERE id = $1`, [items[0]!.plannedItemId]);
    expect((await entryRows())[0]).toMatchObject({ experience_id: boG, planned_item_id: null });
  });

  // Feature: dining-plan-calculator, Property 21: Import is idempotent and keeps slots unique
  // Validates: Requirements 5.4, 5.5, 5.7, 4.1
  it('Property 21: any import sequence leaves unique slots and planned items, and created + skipped equals the items processed', async () => {
    const pool6: DiningImportItem[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = await plannedItem({ experience_id: boG, planned_date: '2027-03-04', reservation_kind: 'dining', planned_time: '2027-03-04T23:00:00Z' });
      pool6.push({ plannedItemId: id, experienceId: boG, date: `2027-03-0${(i % 3) + 1}`, mealPeriod: (['breakfast', 'lunch', 'dinner'] as const)[i % 2]! });
    }
    const base = db.backup();
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.subarray(pool6), fc.boolean()), { minLength: 1, maxLength: 3 }), async (calls) => {
        base.restore();
        for (const [batch, overwrite] of calls) {
          const counts = await repo.importEntries(tripId, batch, overwrite);
          expect(counts.created + counts.skippedExisting).toBe(batch.length);
        }
        const rows = await entryRows();
        const slots = rows.map((r) => `${String(r.entry_date)}:${String(r.meal_period)}`);
        expect(new Set(slots).size).toBe(slots.length);
        const linked = rows.map((r) => r.planned_item_id).filter((x) => x !== null);
        expect(new Set(linked).size).toBe(linked.length);
        // Importing the last batch again creates nothing.
        const last = calls.at(-1)!;
        expect((await repo.importEntries(tripId, last[0], last[1])).created).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('stored JSON parsing (pure)', () => {
  // Feature: dining-plan-calculator, Property 28: Admin and shared schemas round-trip (stored settings)
  // Validates: Requirements 6.3, 6.5, 17.6
  it('Property 28: any valid settings survive storage unchanged, and any garbage stored value still yields valid settings', () => {
    const settingsArb = fc.record(
      {
        orderStyle: fc.constantFrom('budget', 'typical', 'splurge', 'max_value'),
        beverage: fc.constantFrom('water', 'soft_drink', 'specialty'),
        orderDessert: fc.boolean(),
        appetizersPerTable: fc.integer({ min: 0, max: 4 }),
        snacksPerPersonPerDay: fc.integer({ min: 0, max: 4 }),
        mugsWanted: fc.integer({ min: 0, max: 50 }),
        kidsEatFree: fc.boolean(),
        taxBps: fc.option(fc.integer({ min: 0, max: 2500 }), { nil: null }),
        tipBps: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
        alcoholDrinkerKeys: fc.array(fc.constantFrom('m:a', 'm:b', 'g:c'), { maxLength: 3 }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(settingsArb, fc.dictionary(fc.string(), fc.anything()), (valid, junk) => {
        const settings = diningPlanSettingsSchema.parse(valid as DiningPlanSettingsInput);
        expect(parseStoredSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
        const garbage = parseStoredSettings({ ...junk, ...valid, taxBps: 'lots' });
        expect(diningPlanSettingsSchema.safeParse(garbage).success).toBe(true);
        expect(garbage.taxBps).toBeNull();
        const config = mergeStoredConfig(junk);
        expect(config).toEqual(DINING_CONFIG_DEFAULTS);
      }),
      { numRuns: 200 },
    );
  });

  it('defaults a non-object stored value', () => {
    expect(parseStoredSettings('not json')).toEqual(diningPlanSettingsSchema.parse({}));
    expect(parseStoredSettings([1, 2])).toEqual(diningPlanSettingsSchema.parse({}));
    expect(mergeStoredConfig(null)).toEqual(DINING_CONFIG_DEFAULTS);
  });
});
