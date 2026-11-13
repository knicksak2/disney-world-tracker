/**
 * Migration test for `0075_dining_plan.sql` (pg-mem, every earlier migration applied first, as `buildMigratedDb()`
 * does).
 *
 * Validates: dining-plan-calculator Requirements 2.2, 2.3, 4.1, 5.5, 5.6, 8.2, 8.3, 17.1, 17.2, 17.3, 17.5
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import { beforeEach, describe, expect, it } from 'vitest';

const FILE = '0075_dining_plan.sql';
const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'migrations');

function jsonbTypeof(val: unknown): string {
  if (val === null || val === undefined) return 'null';
  let parsed = val;
  if (typeof val === 'string') {
    try {
      parsed = JSON.parse(val);
    } catch {
      return 'string';
    }
  }
  if (parsed === null) return 'null';
  if (Array.isArray(parsed)) return 'array';
  return typeof parsed === 'object' ? 'object' : typeof parsed;
}

/** Exactly the functions accountDeletion/__tests__/helpers.ts registers: 0075 must need nothing more. */
function buildPgMemDatabase(): IMemoryDb {
  const db = newDb({ noAstCoverageCheck: true });
  db.registerExtension('citext', () => {});
  db.registerExtension('pg_trgm', () => {});
  db.registerExtension('pgcrypto', (schema) => {
    schema.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: () => randomUUID(), impure: true });
  });
  const text1 = (name: string, fn: (s: string) => string | number, returns: DataType): void => {
    db.public.registerFunction({ name, args: [DataType.text], returns, implementation: (s: unknown) => fn(typeof s === 'string' ? s : '') });
  };
  text1('char_length', (s) => s.length, DataType.integer);
  text1('length', (s) => s.length, DataType.integer);
  text1('lower', (s) => s.toLowerCase(), DataType.text);
  text1('trim', (s) => s.trim(), DataType.text);
  text1('btrim', (s) => s.trim(), DataType.text);
  db.public.registerFunction({ name: 'jsonb_typeof', args: [DataType.jsonb], returns: DataType.text, implementation: jsonbTypeof });
  return db;
}

function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((n) => /^\d{4}_.*\.sql$/u.test(n))
    .sort((a, b) => a.localeCompare(b));
}

function applyMigration(db: IMemoryDb, name: string): void {
  // The pure data backfills 0070 and 0071 need correlated subqueries pg-mem cannot evaluate (buildMigratedDb skips 0070).
  if (/^00(70|71)_backfill/u.test(name)) return;
  let sql = readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8');
  sql = sql.replace(/CREATE INDEX[^;]+USING gin[^;]+;/gms, '');
  sql = sql.replace(/\s+AT\s+TIME\s+ZONE\s+('[^']*'|[A-Za-z_][\w.]*)/gimu, '');
  db.public.none(sql);
}

interface Pool {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

describe('migration 0075_dining_plan (pg-mem)', () => {
  let db: IMemoryDb;
  let pool: Pool;
  let userId: string;
  let tripId: string;
  let restaurantId: string;

  const count = async (sql: string, params: unknown[] = []): Promise<number> =>
    Number((await pool.query(sql, params)).rows[0]?.['n']);

  async function insert(table: string, row: Record<string, unknown>): Promise<void> {
    const cols = Object.keys(row);
    await pool.query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => row[c]),
    );
  }

  async function seedExperience(name = 'Space 220'): Promise<string> {
    const id = randomUUID();
    await pool.query(`INSERT INTO experiences (id, upstream_entity_id, name, park, category) VALUES ($1, $2, $3, 'EPCOT', 'Restaurant')`, [
      id,
      `ent-${id}`,
      name,
    ]);
    return id;
  }

  async function seedPlannedItem(): Promise<string> {
    const id = randomUUID();
    await pool.query(`INSERT INTO planned_items (id, trip_id, experience_id, added_by) VALUES ($1, $2, $3, $4)`, [
      id,
      tripId,
      await seedExperience(`Planned ${id.slice(0, 8)}`),
      userId,
    ]);
    return id;
  }

  const price = (o: Record<string, unknown> = {}) => ({
    plan_code: 'quick_service',
    display_name: 'Test plan',
    valid_from: '2028-01-01',
    valid_to: '2028-12-31',
    adult_cents: 5000,
    child_cents: 2000,
    ...o,
  });
  const rule = (o: Record<string, unknown> = {}) => ({ experience_id: restaurantId, service_type: 'table_service', ...o });
  const entry = (o: Record<string, unknown> = {}) => ({
    trip_id: tripId,
    entry_date: '2027-03-11',
    meal_period: 'dinner',
    kind: 'placeholder',
    placeholder_kind: 'table_service',
    ...o,
  });

  beforeEach(async () => {
    db = buildPgMemDatabase();
    pool = new (db.adapters.createPg().Pool)() as unknown as Pool;
    for (const name of migrationNames().filter((n) => n <= FILE)) applyMigration(db, name);

    userId = randomUUID();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'dining@example.com', 'hash')`, [userId]);
    tripId = randomUUID();
    await pool.query(
      `INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES ($1, $2, 'Trip', '', '2027-03-10', '2027-03-17')`,
      [tripId, userId],
    );
    restaurantId = await seedExperience();
  });

  describe('tables and seed data', () => {
    it('creates the five tables with their columns', async () => {
      const cols = async (t: string) =>
        (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [t])).rows.map((r) => r['column_name']);
      expect(await cols('dining_plan_prices')).toEqual(
        expect.arrayContaining(['id', 'plan_code', 'display_name', 'valid_from', 'valid_to', 'adult_cents', 'child_cents', 'child_promo_cents', 'promo_label', 'source_note', 'verified_at', 'updated_at']),
      );
      expect(await cols('dining_plan_location_rules')).toEqual(
        expect.arrayContaining(['experience_id', 'service_type', 'credit_cost', 'credit_cost_by_period', 'gratuity_included', 'pass_discount_eligible', 'per_person_adult_cents', 'per_person_child_cents', 'rule_status', 'verified_at', 'source_note', 'updated_at']),
      );
      expect(await cols('dining_plan_config')).toEqual(expect.arrayContaining(['id', 'config', 'updated_at']));
      expect(await cols('trip_dining_plan_scenarios')).toEqual(expect.arrayContaining(['trip_id', 'settings', 'updated_at']));
      expect(await cols('trip_dining_plan_entries')).toEqual(
        expect.arrayContaining(['id', 'trip_id', 'entry_date', 'meal_period', 'kind', 'experience_id', 'placeholder_kind', 'planned_item_id', 'excluded_keys', 'created_at', 'updated_at']),
      );
    });

    it('seeds the five price periods exactly once, all unverified, with the design prices', async () => {
      const rows = (
        await pool.query(`SELECT plan_code, valid_from, adult_cents, child_cents, child_promo_cents, promo_label, verified_at FROM dining_plan_prices ORDER BY valid_from, plan_code`)
      ).rows.map((r) => [
        r['plan_code'],
        (r['valid_from'] as Date).toISOString().slice(0, 10),
        r['adult_cents'],
        r['child_cents'],
        r['child_promo_cents'],
        r['promo_label'],
        r['verified_at'],
      ]);
      expect(rows).toEqual([
        ['quick_service', '2026-01-01', 6047, 2616, 0, 'Kids Eat Free 2026', null],
        ['table_service', '2026-01-01', 9859, 3194, 0, 'Kids Eat Free 2026', null],
        ['deluxe', '2027-01-01', 16301, 4685, null, null, null],
        ['quick_service', '2027-01-01', 6278, 2582, null, null, null],
        ['table_service', '2027-01-01', 9987, 3194, null, null, null],
      ]);
    });

    it('creates the config singleton exactly once, empty', async () => {
      const rows = (await pool.query(`SELECT id, config FROM dining_plan_config`)).rows;
      expect(rows).toEqual([{ id: 1, config: {} }]);
    });

    it('re-applying the file changes no row count', async () => {
      await insert('dining_plan_location_rules', rule());
      await insert('trip_dining_plan_entries', entry());
      const counts = async () =>
        Promise.all(
          ['dining_plan_prices', 'dining_plan_location_rules', 'dining_plan_config', 'trip_dining_plan_scenarios', 'trip_dining_plan_entries'].map((t) =>
            count(`SELECT count(*) AS n FROM ${t}`),
          ),
        );
      const before = await counts();
      applyMigration(db, FILE);
      expect(await counts()).toEqual(before);
      expect(before).toEqual([5, 1, 1, 0, 1]);
    });

    it('the file references no users table (account deletion needs no disposition)', () => {
      const sql = readFileSync(resolve(MIGRATIONS_DIR, FILE), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');
      expect(sql).not.toMatch(/REFERENCES\s+users\b/iu);
      expect(sql).not.toMatch(/jsonb_array_length|NULLS\s+(FIRST|LAST)/iu);
    });
  });

  describe('dining_plan_prices constraints', () => {
    it.each([
      ['an unknown plan code', { plan_code: 'premium' }],
      ['valid_to before valid_from', { valid_from: '2028-02-01', valid_to: '2028-01-31' }],
      ['a promotion without a label', { child_promo_cents: 0 }],
      ['adult_cents 0', { adult_cents: 0 }],
      ['a blank display name', { display_name: '   ' }],
    ])('rejects %s', async (_name, o) => {
      await expect(insert('dining_plan_prices', price(o))).rejects.toThrow();
    });

    it('accepts a valid period and rejects a duplicate (plan_code, valid_from)', async () => {
      await insert('dining_plan_prices', price());
      await expect(insert('dining_plan_prices', price({ display_name: 'Again' }))).rejects.toThrow();
      await insert('dining_plan_prices', price({ plan_code: 'deluxe' }));
    });
  });

  describe('dining_plan_location_rules constraints', () => {
    it('accepts a table-service rule with two credits, a period map, gratuity and a verified date', async () => {
      await insert('dining_plan_location_rules', rule({
        credit_cost: 1,
        credit_cost_by_period: JSON.stringify({ lunch: 2, dinner: 2 }),
        gratuity_included: true,
        rule_status: 'verified',
        verified_at: '2026-07-20',
      }));
      const row = (await pool.query(`SELECT credit_cost, rule_status, credit_cost_by_period FROM dining_plan_location_rules`)).rows[0];
      expect(row).toMatchObject({ credit_cost: 1, rule_status: 'verified', credit_cost_by_period: { lunch: 2, dinner: 2 } });
    });

    it('defaults to credit cost 1, no gratuity and unverified, with service type NULL meaning derive', async () => {
      await insert('dining_plan_location_rules', { experience_id: restaurantId });
      const row = (await pool.query(`SELECT service_type, credit_cost, gratuity_included, rule_status FROM dining_plan_location_rules`)).rows[0];
      expect(row).toEqual({ service_type: null, credit_cost: 1, gratuity_included: false, rule_status: 'unverified' });
    });

    it.each([
      ['credit cost 3', { credit_cost: 3 }],
      ['credit cost 2 with quick_service', { service_type: 'quick_service', credit_cost: 2 }],
      ['credit cost 2 with a derived service type', { service_type: null, credit_cost: 2 }],
      ['gratuity with a derived service type', { service_type: null, gratuity_included: true }],
      ['a period map with a derived service type', { service_type: null, credit_cost_by_period: JSON.stringify({ dinner: 2 }) }],
      ['a period map with quick_service', { service_type: 'quick_service', credit_cost_by_period: JSON.stringify({ dinner: 2 }) }],
      ['a period map that is not an object', { credit_cost_by_period: JSON.stringify([2]) }],
      ['gratuity with quick_service', { service_type: 'quick_service', gratuity_included: true }],
      ['verified without verified_at', { rule_status: 'verified' }],
      ['an unknown rule status', { rule_status: 'derived' }],
      ['an unknown service type', { service_type: 'buffet' }],
      ['a zero price override', { per_person_adult_cents: 0 }],
    ])('rejects %s', async (_name, o) => {
      await expect(insert('dining_plan_location_rules', rule(o))).rejects.toThrow();
    });

    it('deleting the Experience deletes its rule', async () => {
      await insert('dining_plan_location_rules', rule());
      await pool.query(`DELETE FROM experiences WHERE id = $1`, [restaurantId]);
      expect(await count(`SELECT count(*) AS n FROM dining_plan_location_rules`)).toBe(0);
    });
  });

  describe('dining_plan_config constraints', () => {
    it('rejects a second row and a non-object config', async () => {
      await expect(insert('dining_plan_config', { id: 2 })).rejects.toThrow();
      await expect(pool.query(`UPDATE dining_plan_config SET config = $1 WHERE id = 1`, [JSON.stringify([1])])).rejects.toThrow();
    });
  });

  describe('trip tables', () => {
    it('accepts one entry per kind in its shape, with excluded keys defaulting to []', async () => {
      await insert('trip_dining_plan_entries', entry({ meal_period: 'breakfast', kind: 'restaurant', experience_id: restaurantId, placeholder_kind: null }));
      await insert('trip_dining_plan_entries', entry({ meal_period: 'lunch' }));
      await insert('trip_dining_plan_entries', entry({ meal_period: 'dinner', kind: 'skip', placeholder_kind: null }));
      const rows = (await pool.query(`SELECT kind, excluded_keys FROM trip_dining_plan_entries ORDER BY kind`)).rows;
      expect(rows).toEqual([
        { kind: 'placeholder', excluded_keys: [] },
        { kind: 'restaurant', excluded_keys: [] },
        { kind: 'skip', excluded_keys: [] },
      ]);
    });

    it.each([
      ['a restaurant without an experience', { kind: 'restaurant', placeholder_kind: null }],
      ['a restaurant with a placeholder kind', { kind: 'restaurant', experience_id: 'EXP' }],
      ['a placeholder without its kind', { placeholder_kind: null }],
      ['a placeholder with an experience', { experience_id: 'EXP' }],
      ['a skip with a placeholder kind', { kind: 'skip' }],
      ['a skip with an experience', { kind: 'skip', placeholder_kind: null, experience_id: 'EXP' }],
      ['a snack meal period', { meal_period: 'snack' }],
      ['an unknown kind', { kind: 'other' }],
      ['an unknown placeholder kind', { placeholder_kind: 'buffet' }],
      ['excluded keys that are not an array', { excluded_keys: JSON.stringify({ a: 1 }) }],
    ])('rejects %s', async (_name, o) => {
      const resolved = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === 'EXP' ? restaurantId : v]));
      await expect(insert('trip_dining_plan_entries', entry(resolved))).rejects.toThrow();
    });

    it('rejects a second entry in the same slot (uq_dpe_slot)', async () => {
      await insert('trip_dining_plan_entries', entry());
      await expect(insert('trip_dining_plan_entries', entry({ kind: 'skip', placeholder_kind: null }))).rejects.toThrow();
    });

    it('one entry per planned item (uq_dpe_planned_item), while many entries may have none', async () => {
      const planned = await seedPlannedItem();
      await insert('trip_dining_plan_entries', entry({ planned_item_id: planned }));
      await expect(insert('trip_dining_plan_entries', entry({ meal_period: 'lunch', planned_item_id: planned }))).rejects.toThrow();
      await insert('trip_dining_plan_entries', entry({ meal_period: 'lunch' }));
      await insert('trip_dining_plan_entries', entry({ meal_period: 'breakfast' }));
      expect(await count(`SELECT count(*) AS n FROM trip_dining_plan_entries WHERE planned_item_id IS NULL`)).toBe(2);
    });

    it('an unpredicated SELECT returns the rows whose planned_item_id is NULL (guards the partial-index bug)', async () => {
      const planned = await seedPlannedItem();
      await insert('trip_dining_plan_entries', entry({ planned_item_id: planned }));
      await insert('trip_dining_plan_entries', entry({ meal_period: 'lunch' }));
      const all = (await pool.query(`SELECT * FROM trip_dining_plan_entries`)).rows;
      expect(all).toHaveLength(2);
      expect(all.filter((r) => r['planned_item_id'] === null)).toHaveLength(1);
    });

    it('deleting a planned item keeps the entry with planned_item_id NULL', async () => {
      const planned = await seedPlannedItem();
      await insert('trip_dining_plan_entries', entry({ planned_item_id: planned }));
      await pool.query(`DELETE FROM planned_items WHERE id = $1`, [planned]);
      const rows = (await pool.query(`SELECT planned_item_id FROM trip_dining_plan_entries`)).rows;
      expect(rows).toEqual([{ planned_item_id: null }]);
    });

    it('deleting the Trip cascades its scenario and entries, leaving another Trip untouched', async () => {
      const other = randomUUID();
      await pool.query(
        `INSERT INTO trips (id, creator_id, name, description, start_date, end_date) VALUES ($1, $2, 'Other', '', '2027-03-10', '2027-03-17')`,
        [other, userId],
      );
      await insert('trip_dining_plan_scenarios', { trip_id: tripId, settings: JSON.stringify({ orderStyle: 'splurge' }) });
      await insert('trip_dining_plan_scenarios', { trip_id: other });
      await insert('trip_dining_plan_entries', entry());
      await insert('trip_dining_plan_entries', entry({ trip_id: other }));

      await pool.query(`DELETE FROM trips WHERE id = $1`, [tripId]);

      expect(await count(`SELECT count(*) AS n FROM trip_dining_plan_scenarios WHERE trip_id = $1`, [tripId])).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM trip_dining_plan_entries WHERE trip_id = $1`, [tripId])).toBe(0);
      expect(await count(`SELECT count(*) AS n FROM trip_dining_plan_scenarios`)).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM trip_dining_plan_entries`)).toBe(1);
    });

    it('rejects scenario settings that are not an object', async () => {
      await expect(insert('trip_dining_plan_scenarios', { trip_id: tripId, settings: JSON.stringify([1]) })).rejects.toThrow();
    });
  });
});
