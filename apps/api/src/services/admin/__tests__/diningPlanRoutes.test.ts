/**
 * Admin_Panel Dining Plan section (`/admin/dining-plan`) through `inject`, over the REAL admin repo on pg-mem with every
 * migration applied, posting real `application/x-www-form-urlencoded` forms and reading the rows back.
 *
 * Validates: dining-plan-calculator Requirements 2.6, 8.3, 8.8, 18.1 to 18.10; Property 24.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { IMemoryDb } from 'pg-mem';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { buildMigratedDb, createSeeder, createTestPool, type Seeder } from '../../accountDeletion/__tests__/helpers.js';
import { createDiningPlanAdminRepo } from '../../diningPlan/adminRepo.js';
import { createDiningPlanRepo } from '../../diningPlan/repo.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo } from '../repo.js';
import { ADMIN_SECTIONS, adminRoutes } from '../routes.js';

const AUTH = `Basic ${Buffer.from('admin:supersecretpassword').toString('base64')}`;
const SAME_ORIGIN = { authorization: AUTH, host: 'localhost:3000', origin: 'http://localhost:3000' };
const FORM = { ...SAME_ORIGIN, 'content-type': 'application/x-www-form-urlencoded' };
const TS = { tableService: [{ id: 'casual-dining', name: 'Casual Dining' }] };
const QS = { quickService: [{ id: 'counter-service', name: 'Counter Service' }] };

let db: IMemoryDb;
let snapshot: { restore(): void };
let pool: DbPool;
let seeder: Seeder;
let app: FastifyInstance;

beforeAll(() => {
  db = buildMigratedDb();
  snapshot = db.backup();
});

beforeEach(async () => {
  snapshot.restore();
  pool = createTestPool(db).pool;
  seeder = createSeeder(pool, { fallbackUserId: '10000000-0000-4000-8000-000000000001' });
  app = Fastify({ logger: false });
  await app.register(
    adminRoutes({
      repo: createAdminRepo({} as never, {} as never),
      basicAuth: createBasicAuthHook({ username: 'admin', password: 'supersecretpassword' }),
      diningPlan: createDiningPlanAdminRepo({
        pool,
        seed: [
          { name: 'Cape Town Lounge and Wine Bar', serviceType: 'table_service', creditCost: 2, gratuityIncluded: false, ruleStatus: 'unverified', sourceNote: 'The Magic For Less 2026-11 (third party only)' },
          { name: 'Missing Restaurant', serviceType: 'not_eligible', creditCost: 1, gratuityIncluded: false, ruleStatus: 'unverified', sourceNote: 'Third party 2026-11' },
        ],
      }),
    }),
  );
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

async function restaurant(name: string, facets: object = TS): Promise<string> {
  return String((await seeder.insertRow('experiences', { name, category: 'Restaurant', active: true, grouped_facets: facets, price_tier: '$$' })).id);
}
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
async function rows(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await pool.query(sql, params)).rows as Record<string, unknown>[];
}
const PRICE = {
  plan_code: 'deluxe', display_name: 'Deluxe 2028', valid_from: '2028-01-01', valid_to: '2028-12-31', adult: '170.00', child: '50.00',
  child_promo: '', promo_label: '', source_note: 'Disney booking flow 2027-11-01', verified_at: '',
};

describe('access (Requirements 18.1, 18.6)', () => {
  it('answers 401 without credentials on every route', async () => {
    for (const [method, url] of [['GET', '/admin/dining-plan'], ['GET', '/admin/dining-plan/locations'], ['POST', '/admin/dining-plan/prices'], ['POST', '/admin/dining-plan/seed']] as const) {
      expect((await app.inject({ method, url })).statusCode, url).toBe(401);
    }
  });

  it('refuses a cross-origin POST with 403 and writes nothing', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/dining-plan/prices', headers: { ...FORM, origin: 'http://evil.example.com' }, payload: form(PRICE) });
    expect(res.statusCode).toBe(403);
    expect(await rows(`SELECT id FROM dining_plan_prices WHERE valid_from = '2028-01-01'`)).toEqual([]);
  });

  it('sends noindex and no-store on pages and lists the section in the overview', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/dining-plan', headers: { authorization: AUTH } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(ADMIN_SECTIONS.find((s) => s.path === '/admin/dining-plan')).toMatchObject({ title: 'Dining Plan Calculator', category: 'Data Ingestion & External Sync' });
    const overview = await app.inject({ method: 'GET', url: '/admin', headers: { authorization: AUTH } });
    expect(overview.body).toContain('/admin/dining-plan');
    expect(overview.body).toContain('Dining Plan Calculator');
  });
});

describe('plan prices (Property 24, Requirements 2.6, 18.2)', () => {
  it('lists the seeded periods, each "price not yet verified"', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/dining-plan', headers: { authorization: AUTH } });
    expect(res.body).toContain('How the Dining Plan Calculator Uses This Page');
    expect(res.body).toContain('0 / 5 verified');
    expect(res.body).toContain('Quick-Service Plan');
    expect(res.body).toContain('Disney Quick-Service Dining Plan');
    expect(res.body).toContain('Deluxe Table-Service Dining Plan');
    expect(res.body).toContain('$98.59');
    expect(res.body.match(/price not yet verified/g)).toHaveLength(5);
    expect(res.body).toContain('<details class="card-details">');
    expect(res.body).toContain('All using built-in defaults');
  });

  it('saves a valid period with a flash redirect, and the next calculation reads it', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/dining-plan/prices', headers: FORM, payload: form(PRICE) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/admin/dining-plan?flash=Price%20period%20saved.');
    const globals = await createDiningPlanRepo({ pool }).loadGlobals();
    expect(globals.priceRows.find((p) => p.validFrom === '2028-01-01')).toMatchObject({ planCode: 'deluxe', adultCents: 17_000, childCents: 5_000, verifiedAt: null });
    const page = await app.inject({ method: 'GET', url: '/admin/dining-plan?flash=Price%20period%20saved.', headers: { authorization: AUTH } });
    expect(page.body).toContain('Price period saved.');
  });

  it('edits a period in place through the edit link, and the calculation reads the new price', async () => {
    const [row] = await rows(`SELECT id FROM dining_plan_prices WHERE plan_code = 'table_service' AND valid_from = '2027-01-01'`);
    const id = String(row!.id);
    const editPage = await app.inject({ method: 'GET', url: `/admin/dining-plan?edit=${id}`, headers: { authorization: AUTH } });
    expect(editPage.body).toContain('Edit price period');
    expect(editPage.body).toContain('Cancel editing');
    expect(editPage.body).toContain('value="99.87"');
    const res = await app.inject({
      method: 'POST', url: '/admin/dining-plan/prices', headers: FORM,
      payload: form({ ...PRICE, id, plan_code: 'table_service', display_name: 'Table-Service Dining Plan', valid_from: '2027-01-01', valid_to: '2027-12-31', adult: '101.25', child: '31.94', verified_at: '2026-11-10' }),
    });
    expect(res.statusCode).toBe(302);
    const read = (await createDiningPlanRepo({ pool }).loadGlobals()).priceRows.find((p) => p.planCode === 'table_service' && p.validFrom === '2027-01-01');
    expect(read).toMatchObject({ adultCents: 10_125, verifiedAt: '2026-11-10' });
    const after = await app.inject({ method: 'GET', url: '/admin/dining-plan', headers: { authorization: AUTH } });
    expect(after.body).toContain('1 / 5 verified');
  });

  it.each([
    ['an overlap with another period of the same plan', { valid_from: '2027-06-01', valid_to: '2028-05-31' }, 'This period overlaps &quot;Deluxe Table-Service Dining Plan&quot; (2027-01-01 to 2027-12-31) of the same plan.'],
    ['valid_to before valid_from', { valid_from: '2028-12-31', valid_to: '2028-01-01' }, '&quot;Valid to&quot; is before &quot;Valid from&quot;.'],
    ['a promotion without a label', { child_promo: '0' }, 'A promotion price needs a promotion label.'],
    ['a negative price', { adult: '-5' }, 'The adult price must be a dollar amount from 0.01 to 1000.00.'],
  ])('re-renders with the message and writes nothing for %s', async (_name, change, message) => {
    const before = (await rows('SELECT id FROM dining_plan_prices')).length;
    const res = await app.inject({ method: 'POST', url: '/admin/dining-plan/prices', headers: FORM, payload: form({ ...PRICE, ...change }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Nothing was saved');
    expect(res.body).toContain(message);
    // The submitted values stay in the form.
    expect(res.body).toContain('value="Deluxe 2028"');
    expect((await rows('SELECT id FROM dining_plan_prices')).length).toBe(before);
  });

  it('deletes a period', async () => {
    const [row] = await rows(`SELECT id FROM dining_plan_prices WHERE plan_code = 'deluxe'`);
    const res = await app.inject({ method: 'POST', url: `/admin/dining-plan/prices/${String(row!.id)}/delete`, headers: SAME_ORIGIN });
    expect(res.statusCode).toBe(302);
    expect(await rows(`SELECT id FROM dining_plan_prices WHERE plan_code = 'deluxe'`)).toEqual([]);
  });
});

describe('default assumptions (Requirement 18.3)', () => {
  async function configFields(): Promise<Record<string, string>> {
    const page = (await app.inject({ method: 'GET', url: '/admin/dining-plan', headers: { authorization: AUTH } })).body;
    const configForm = page.slice(page.indexOf('action="/admin/dining-plan/config"'));
    const fields: Record<string, string> = {};
    for (const m of configForm.slice(0, configForm.indexOf('</form>')).matchAll(/<input name="([^"]+)" value="([^"]*)"/g)) fields[m[1]!] = m[2]!;
    fields.planPricesIncludeTax = 'true';
    return fields;
  }

  it('rejects a value above its bound, writing nothing, and opens the assumptions section', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/dining-plan/config', headers: FORM, payload: form({ ...(await configFields()), taxBps: '9000' }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('taxBps');
    expect(res.body).toContain('<details class="card-details" open>');
    expect((await rows('SELECT config FROM dining_plan_config'))[0]!.config).toEqual({});
  });

  it('accepts the defaults as shown, stores a changed value with human-readable previews, and reset clears it', async () => {
    const fields = await configFields();
    // 14 scalar settings (13 number inputs and the yes/no select) and the 8 tier estimates.
    expect(Object.keys(fields)).toHaveLength(14 + 8);
    expect((await app.inject({ method: 'POST', url: '/admin/dining-plan/config', headers: FORM, payload: form(fields) })).statusCode).toBe(302);
    expect((await rows('SELECT config FROM dining_plan_config'))[0]!.config).toEqual({});
    await app.inject({ method: 'POST', url: '/admin/dining-plan/config', headers: FORM, payload: form({ ...fields, snackCents: '700', 'tier.quick_service.1': '1500' }) });
    expect((await rows('SELECT config FROM dining_plan_config'))[0]!.config).toEqual({
      snackCents: 700,
      tierEstimates: { table_service: { '1': 2800, '2': 4200, '3': 6500, '4': 9500 }, quick_service: { '1': 1500, '2': 1700, '3': 2000, '4': 2400 } },
    });
    expect((await createDiningPlanRepo({ pool }).loadGlobals()).config.snackCents).toBe(700);
    const customized = await app.inject({ method: 'GET', url: '/admin/dining-plan', headers: { authorization: AUTH } });
    expect(customized.body).toContain('2 custom');
    expect(customized.body).toContain('= $7.00');
    expect(customized.body).toContain('= $15.00');
    const reset = await app.inject({ method: 'POST', url: '/admin/dining-plan/config', headers: FORM, payload: form({ reset: '1' }) });
    expect(reset.headers.location).toBe('/admin/dining-plan?flash=Assumptions%20reset%20to%20the%20defaults.');
    expect((await rows('SELECT config FROM dining_plan_config'))[0]!.config).toEqual({});
  });
});

describe('locations and rules (Property 24, Requirements 8.3, 8.8, 18.4, 18.10)', () => {
  it('searches by name and filters, showing the derived service type of a location with no rule', async () => {
    await restaurant('Cítricos');
    await restaurant('Pecos Bill', QS);
    const search = await app.inject({ method: 'GET', url: '/admin/dining-plan/locations?q=citricos', headers: { authorization: AUTH } });
    expect(search.body).toContain('Cítricos');
    expect(search.body).not.toContain('Pecos Bill');
    expect(search.body).toContain('1 restaurant(s)');
    expect(search.body).toContain('class="filter-pills"');
    expect(search.body).toContain('q=citricos&amp;filter=needs_review');
    const review = await app.inject({ method: 'GET', url: '/admin/dining-plan/locations?filter=needs_review', headers: { authorization: AUTH } });
    expect(review.body).toContain('Pecos Bill');
    expect(review.body).toContain('<td>quick_service</td>');
    expect(review.body).toContain('class="filter-pill active"');
    expect(review.body).toContain('You do not need to verify all of these:');
    const ruled = await app.inject({ method: 'GET', url: '/admin/dining-plan/locations?filter=has_rule', headers: { authorization: AUTH } });
    expect(ruled.body).toContain('0 restaurant(s)');
  });

  it('rejects a credit cost of 2 at a quick-service rule and a verified rule without a date, with page messages and no write', async () => {
    const id = await restaurant('Pecos Bill', QS);
    const url = `/admin/dining-plan/locations/${id}`;
    const base = { service_type: 'quick_service', credit_cost: '2', rule_status: 'unverified', verified_at: '', source_note: '' };
    const two = await app.inject({ method: 'POST', url, headers: FORM, payload: form(base) });
    expect(two.statusCode).toBe(400);
    expect(two.body).toContain('A credit cost of 2 needs the service type &quot;table_service&quot;.');
    const verified = await app.inject({ method: 'POST', url, headers: FORM, payload: form({ ...base, service_type: 'table_service', rule_status: 'verified' }) });
    expect(verified.statusCode).toBe(400);
    expect(verified.body).toContain('A verified rule needs the date it was verified.');
    expect(await rows('SELECT * FROM dining_plan_location_rules')).toEqual([]);
  });

  it('saves a rule with a credit cost by meal period that the calculation reads, then deletes it', async () => {
    const id = await restaurant('Akershus Royal Banquet Hall');
    const url = `/admin/dining-plan/locations/${id}`;
    const edit = await app.inject({ method: 'GET', url, headers: { authorization: AUTH } });
    expect(edit.body).toContain('Derived service type: <strong>table_service</strong>');
    expect(edit.body).toContain('1. Credit &amp; Service Rules');
    expect(edit.body).toContain('2. Fixed-Price Overrides (Optional)');
    expect(edit.body).toContain('3. Verification &amp; Source');
    expect(edit.body).toContain('name="period_dinner"');
    const res = await app.inject({
      method: 'POST', url, headers: FORM,
      payload: form({ service_type: 'table_service', credit_cost: '1', period_lunch: '2', period_dinner: '2', gratuity_included: '', override_adult: '65.00', rule_status: 'verified', verified_at: '2026-07-20', source_note: 'planDisney 2026-07-20' }),
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${url}?flash=Rule%20saved.`);
    const rule = (await createDiningPlanRepo({ pool }).loadLocations([id])).get(id)!.rule;
    expect(rule).toMatchObject({ creditCost: 1, creditCostByPeriod: { lunch: 2, dinner: 2 }, overrideAdultCents: 6_500, ruleStatus: 'verified', verifiedAt: '2026-07-20' });
    const shown = await app.inject({ method: 'GET', url, headers: { authorization: AUTH } });
    expect(shown.body).toContain('<option value="2" selected>2</option>');
    expect(shown.body).toContain('Revert to Automatic Rule');
    expect(shown.body).toContain('Delete rule');
    const del = await app.inject({ method: 'POST', url: `${url}/delete`, headers: SAME_ORIGIN });
    expect(del.statusCode).toBe(302);
    expect(await rows('SELECT * FROM dining_plan_location_rules')).toEqual([]);
  });

  it('warns when a verified date is saved under unverified status, and marks verified in one click via mark_verified', async () => {
    const id = await restaurant('Ohana');
    const url = `/admin/dining-plan/locations/${id}`;
    await app.inject({
      method: 'POST', url, headers: FORM,
      payload: form({ service_type: '', credit_cost: '1', rule_status: 'unverified', verified_at: '2026-11-11', source_note: '' }),
    });
    const warned = await app.inject({ method: 'GET', url, headers: { authorization: AUTH } });
    expect(warned.body).toContain('Still marked unverified:');
    expect(warned.body).toContain('name="mark_verified" value="1"');

    const verified = await app.inject({
      method: 'POST', url, headers: FORM,
      payload: form({ service_type: '', credit_cost: '1', rule_status: 'unverified', verified_at: '', source_note: 'Disney site', mark_verified: '1' }),
    });
    expect(verified.statusCode).toBe(302);
    const rule = (await createDiningPlanRepo({ pool }).loadLocations([id])).get(id)!.rule;
    expect(rule).toMatchObject({ ruleStatus: 'verified', sourceNote: 'Disney site' });
    expect(rule?.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const after = await app.inject({ method: 'GET', url, headers: { authorization: AUTH } });
    expect(after.body).not.toContain('Still marked unverified:');
    expect(after.body).toContain('✓ Verified');
  });

  it('answers 404 for an id that is not a Restaurant', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/dining-plan/locations/99999999-9999-4999-8999-999999999999', headers: { authorization: AUTH } });
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('That restaurant is not in the catalog.');
  });

  it('escapes every rendered value', async () => {
    const id = await restaurant('<script>alert(1)</script> Grill');
    const list = await app.inject({ method: 'GET', url: '/admin/dining-plan/locations?q=grill', headers: { authorization: AUTH } });
    expect(list.body).not.toContain('<script>alert(1)</script>');
    expect(list.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Grill');
    const page = await app.inject({ method: 'GET', url: `/admin/dining-plan/locations/${id}`, headers: { authorization: AUTH } });
    expect(page.body).not.toContain('<script>alert(1)</script>');
  });
});

describe('seed rules (Requirements 18.8, 18.10)', () => {
  it('applies the seed and lists every entry with its outcome and source note, then the seeded-unverified filter finds it', async () => {
    await restaurant('Cape Town Lounge and Wine Bar');
    await restaurant('Regular Table Spot');
    const res = await app.inject({ method: 'POST', url: '/admin/dining-plan/seed', headers: SAME_ORIGIN });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Seed Rules Applied');
    expect(res.body).toContain('Review seeded &amp; unverified rules');
    expect(res.body).toContain('inserted: <strong>1</strong>');
    expect(res.body).toContain('unmatched: <strong>1</strong>');
    expect(res.body).toContain('Missing Restaurant');
    expect(res.body).toContain('No active restaurant has this name or its aliases.');
    expect(res.body).toContain('The Magic For Less 2026-11 (third party only)');
    const filtered = await app.inject({ method: 'GET', url: '/admin/dining-plan/locations?filter=seeded_unverified', headers: { authorization: AUTH } });
    expect(filtered.body).toContain('Cape Town Lounge and Wine Bar');
    const dash = await app.inject({ method: 'GET', url: '/admin/dining-plan', headers: { authorization: AUTH } });
    expect(dash.body).toContain('1 to review');
    expect(dash.body).toContain('1 auto-detected (no action needed)');
    expect(dash.body).toContain('Custom rules (1 &middot; 1 unverified)');
    const again = await app.inject({ method: 'POST', url: '/admin/dining-plan/seed', headers: SAME_ORIGIN });
    expect(again.body).toContain('kept: <strong>1</strong>');
  });
});
