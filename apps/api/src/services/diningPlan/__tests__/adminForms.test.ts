/**
 * Admin_Panel form parsing and validation (pure).
 *
 * Validates: dining-plan-calculator Requirements 2.6, 8.3, 8.7, 8.8, 18.2, 18.3, 18.7; Property 24.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DINING_CONFIG_DEFAULTS, diningConfigSchema } from '@dwt/shared';

import {
  configToStore,
  dollarsToCents,
  findPriceOverlap,
  parseConfigForm,
  parsePriceForm,
  parseRuleForm,
  ruleProblems,
  CONFIG_SCALAR_KEYS,
  TIER_LEVELS,
  TIER_SERVICES,
} from '../admin/forms.js';
import type { AdminPriceRow } from '../adminPort.js';

const PRICE = {
  plan_code: 'deluxe', display_name: 'Deluxe 2028', valid_from: '2028-01-01', valid_to: '2028-12-31', adult: '170.00', child: '50',
  child_promo: '', promo_label: '', source_note: '', verified_at: '',
};

function configFields(config = DINING_CONFIG_DEFAULTS): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of CONFIG_SCALAR_KEYS) out[key] = String(config[key]);
  for (const s of TIER_SERVICES) for (const l of TIER_LEVELS) out[`tier.${s}.${l}`] = String(config.tierEstimates[s][l]);
  return out;
}

describe('dollarsToCents', () => {
  it.each([
    ['98.59', 9859], ['$98.59', 9859], ['98', 9800], ['98.5', 9850], ['1,234.00', 123_400], ['0', 0],
  ])('reads %s as %d cents', (text, cents) => expect(dollarsToCents(text)).toBe(cents));

  it.each(['-5', '98.599', 'abc', '', '1e3'])('refuses %s', (text) => expect(dollarsToCents(text)).toBeNull());
});

describe('parsePriceForm', () => {
  it('parses a full form into cents and dates', () => {
    expect(parsePriceForm({ ...PRICE, child_promo: '0', promo_label: 'Kids Eat Free 2028', verified_at: '2027-11-01', source_note: ' Disney ' })).toEqual({
      ok: true,
      value: {
        id: null, planCode: 'deluxe', displayName: 'Deluxe 2028', validFrom: '2028-01-01', validTo: '2028-12-31', adultCents: 17_000,
        childCents: 5_000, childPromoCents: 0, promoLabel: 'Kids Eat Free 2028', sourceNote: 'Disney', verifiedAt: '2027-11-01',
      },
    });
  });

  it.each([
    ['an unknown plan', { plan_code: 'mega' }, 'Choose a plan.'],
    ['a missing display name', { display_name: ' ' }, 'The display name must be 1 to 80 characters.'],
    ['a display name over 80 characters', { display_name: 'x'.repeat(81) }, 'The display name must be 1 to 80 characters.'],
    ['an impossible date', { valid_from: '2028-02-30' }, '"Valid from" must be a date (YYYY-MM-DD).'],
    ['valid_to before valid_from', { valid_to: '2027-12-31' }, '"Valid to" is before "Valid from".'],
    ['a zero adult price', { adult: '0' }, 'The adult price must be a dollar amount from 0.01 to 1000.00.'],
    ['a price over the column limit', { child: '1000.01' }, 'The child price must be a dollar amount from 0.00 to 1000.00.'],
    ['a promotion without a label', { child_promo: '0' }, 'A promotion price needs a promotion label.'],
    ['a note over 200 characters', { source_note: 'n'.repeat(201) }, 'The source note must be at most 200 characters.'],
    ['a malformed id', { id: 'nope' }, 'The price period id is not valid.'],
  ])('rejects %s', (_name, change, message) => {
    const parsed = parsePriceForm({ ...PRICE, ...change });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors).toContain(message);
  });
});

describe('findPriceOverlap (Property 24)', () => {
  const day = (n: number) => new Date(Date.UTC(2028, 0, 1 + n)).toISOString().slice(0, 10);
  const periodArb = fc.record({ plan: fc.constantFrom('quick_service', 'table_service') as fc.Arbitrary<'quick_service' | 'table_service'>, from: fc.integer({ min: 0, max: 60 }), len: fc.integer({ min: 0, max: 20 }) });
  const row = (p: { plan: 'quick_service' | 'table_service'; from: number; len: number }, id: string): AdminPriceRow => ({
    id, planCode: p.plan, displayName: id, validFrom: day(p.from), validTo: day(p.from + p.len), adultCents: 1, childCents: 0, childPromoCents: null, promoLabel: null, sourceNote: null, verifiedAt: null,
  });

  // Feature: dining-plan-calculator, Property 24: Admin edits are validated
  it('Property 24: a period overlaps exactly when another period of the same plan shares a night, and never itself', () => {
    fc.assert(
      fc.property(fc.array(periodArb, { maxLength: 6 }), periodArb, fc.boolean(), (others, candidate, editFirst) => {
        const existing = others.map((p, i) => row(p, `id-${i}`));
        const id = editFirst && existing.length > 0 ? existing[0]!.id : null;
        const input = { ...row(candidate, 'new'), id };
        const shares = (a: { plan: string; from: number; len: number }) => a.plan === candidate.plan && a.from <= candidate.from + candidate.len && candidate.from <= a.from + a.len;
        const expected = others.map((p, i) => ({ p, id: `id-${i}` })).find(({ p, id: rid }) => rid !== id && shares(p));
        expect(findPriceOverlap(existing, input)?.id ?? null).toBe(expected?.id ?? null);
      }),
      { numRuns: 200 },
    );
  });
});

describe('parseConfigForm (Requirement 18.3)', () => {
  it('accepts the defaults exactly and stores nothing for them', () => {
    expect(parseConfigForm(configFields())).toEqual({ ok: true, value: DINING_CONFIG_DEFAULTS });
    expect(configToStore(DINING_CONFIG_DEFAULTS)).toEqual({});
  });

  it('rejects a value just above its bound and a non-number', () => {
    const above = parseConfigForm({ ...configFields(), tipBps: '5001' });
    expect(above.ok).toBe(false);
    if (!above.ok) expect(above.errors.join(' ')).toContain('tipBps');
    const text = parseConfigForm({ ...configFields(), snackCents: '6.50' });
    expect(text).toEqual({ ok: false, errors: ['snackCents must be a whole number.'] });
    const tier = parseConfigForm({ ...configFields(), 'tier.table_service.4': '30001' });
    expect(tier.ok).toBe(false);
  });

  // Feature: dining-plan-calculator, Property 24: Admin edits are validated
  it('Property 24: a config form is accepted exactly when diningConfigSchema accepts its values', () => {
    const keyArb = fc.constantFrom(...CONFIG_SCALAR_KEYS.filter((k) => k !== 'planPricesIncludeTax'));
    fc.assert(
      fc.property(keyArb, fc.integer({ min: -100, max: 40_000 }), (key, value) => {
        const fields = { ...configFields(), [key]: String(value) };
        const expected = diningConfigSchema.safeParse({ ...DINING_CONFIG_DEFAULTS, [key]: value }).success;
        const parsed = parseConfigForm(fields);
        expect(parsed.ok).toBe(expected);
        if (parsed.ok) expect(configToStore(parsed.value)).toEqual(value === DINING_CONFIG_DEFAULTS[key] ? {} : { [key]: value });
      }),
      { numRuns: 200 },
    );
  });
});

describe('parseRuleForm (Requirements 8.3, 8.7, 8.8)', () => {
  const base = { service_type: 'table_service', credit_cost: '2', rule_status: 'verified', verified_at: '2026-07-20', source_note: 'planDisney 2026-07-20' };

  it('parses a rule with a credit cost by meal period, overrides in dollars and the pass-discount choice', () => {
    expect(parseRuleForm({ ...base, credit_cost: '1', period_lunch: '2', period_dinner: '2', gratuity_included: '1', pass_discount_eligible: 'no', override_adult: '79', override_child: '47.00' })).toEqual({
      ok: true,
      value: {
        serviceType: 'table_service', creditCost: 1, creditCostByPeriod: { lunch: 2, dinner: 2 }, gratuityIncluded: true, passDiscountEligible: false,
        overrideAdultCents: 7_900, overrideChildCents: 4_700, ruleStatus: 'verified', verifiedAt: '2026-07-20', sourceNote: 'planDisney 2026-07-20',
      },
    });
    expect(parseRuleForm({ ...base, service_type: '', credit_cost: '1', rule_status: 'unverified', verified_at: '', source_note: '' })).toMatchObject({
      ok: true, value: { serviceType: null, creditCostByPeriod: null, gratuityIncluded: false, passDiscountEligible: null, sourceNote: null, verifiedAt: null },
    });
  });

  it.each([
    ['a credit cost of 2 at quick service', { service_type: 'quick_service' }, 'A credit cost of 2 needs the service type "table_service".'],
    ['a credit cost of 2 with a derived type', { service_type: '' }, 'A credit cost of 2 needs the service type "table_service".'],
    ['a period map at quick service', { service_type: 'quick_service', credit_cost: '1', period_dinner: '2' }, 'A credit cost by meal period needs the service type "table_service".'],
    ['included gratuity at a snack location', { service_type: 'snack_only', credit_cost: '1', gratuity_included: 'on' }, 'Included gratuity needs the service type "table_service".'],
    ['verified without a date', { verified_at: '' }, 'A verified rule needs the date it was verified.'],
    ['a credit cost of 3', { credit_cost: '3' }, 'The credit cost must be 1 or 2.'],
    ['a period cost of 3', { period_dinner: '3' }, 'The dinner credit cost must be 1, 2 or blank.'],
    ['a zero override', { override_adult: '0' }, 'The adult price override must be a dollar amount from 0.01 to 1000.00, or blank.'],
  ])('rejects %s', (_name, change, message) => {
    const parsed = parseRuleForm({ ...base, ...change });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors).toContain(message);
  });

  // Feature: dining-plan-calculator, Property 24: Admin edits are validated
  it('Property 24: a rule form is accepted exactly when it meets the CHECK constraints, and ruleProblems agrees', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('', 'table_service', 'quick_service', 'snack_only', 'not_eligible'),
        fc.constantFrom('1', '2'),
        fc.constantFrom('', '1', '2'),
        fc.boolean(),
        fc.constantFrom('verified', 'unverified'),
        fc.boolean(),
        (service, cost, dinner, gratuity, status, dated) => {
          const parsed = parseRuleForm({ service_type: service, credit_cost: cost, period_dinner: dinner, gratuity_included: gratuity ? '1' : '', rule_status: status, verified_at: dated ? '2026-07-20' : '' });
          const ts = service === 'table_service';
          const valid = (cost === '1' || ts) && (dinner === '' || ts) && (!gratuity || ts) && (status === 'unverified' || dated);
          expect(parsed.ok).toBe(valid);
          if (parsed.ok) expect(ruleProblems(parsed.value)).toEqual([]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
