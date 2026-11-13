/**
 * Admin_Panel form parsing and validation for the Dining Plan section (dining-plan-calculator Requirements 2.6, 8.3,
 * 8.7, 8.8, 18.2, 18.3, 18.7; Property 24). Pure: a form arrives as strings and leaves as a typed input or a list of
 * messages to show on the page; nothing is written on a failure.
 *
 * Money is typed in dollars ("98.59") and stored in integer cents; rates and basis points are typed as integers.
 */

import {
  DINING_CONFIG_DEFAULTS,
  DINING_PLAN_CODES,
  DINING_RULE_STATUSES,
  DINING_SERVICE_TYPES,
  DINING_SOURCE_NOTE_MAX,
  diningConfigSchema,
  type DiningConfig,
  type DiningCreditCostByPeriod,
  type DiningPlanCode,
  type DiningRuleStatus,
  type DiningServiceType,
} from '@dwt/shared';

import type { AdminPriceInput, AdminPriceRow, AdminRuleInput } from '../adminPort.js';

export type FormFields = Readonly<Record<string, string | undefined>>;
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: string[] };

const PRICE_CENTS_MAX = 100_000;
export const DISPLAY_NAME_MAX = 80;
export const PROMO_LABEL_MAX = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function text(form: FormFields, key: string): string {
  return (form[key] ?? '').trim();
}

/** A real calendar date `YYYY-MM-DD`, or null. */
export function calendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/** "98.59", "$98.59", "98" or "98.5" as integer cents; null for anything else (negative, three decimals, text). */
export function dollarsToCents(value: string): number | null {
  const m = /^\$?(\d{1,7})(?:\.(\d{1,2}))?$/u.exec(value.replace(/,/gu, ''));
  if (m === null) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

export function centsToDollars(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

function integer(value: string): number | null {
  return /^-?\d{1,9}$/u.test(value) ? Number(value) : null;
}

// ---------------------------------------------------------------------------
// Plan price periods (Requirement 2.6)
// ---------------------------------------------------------------------------

export function parsePriceForm(form: FormFields): Parsed<AdminPriceInput> {
  const errors: string[] = [];
  const idText = text(form, 'id');
  const id = idText === '' ? null : UUID.test(idText) ? idText : (errors.push('The price period id is not valid.'), null);

  const planText = text(form, 'plan_code');
  const planCode = (DINING_PLAN_CODES as readonly string[]).includes(planText) ? (planText as DiningPlanCode) : null;
  if (planCode === null) errors.push('Choose a plan.');

  const displayName = text(form, 'display_name');
  if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX) errors.push(`The display name must be 1 to ${DISPLAY_NAME_MAX} characters.`);

  const validFrom = calendarDate(text(form, 'valid_from'));
  const validTo = calendarDate(text(form, 'valid_to'));
  if (validFrom === null) errors.push('"Valid from" must be a date (YYYY-MM-DD).');
  if (validTo === null) errors.push('"Valid to" must be a date (YYYY-MM-DD).');
  if (validFrom !== null && validTo !== null && validTo < validFrom) errors.push('"Valid to" is before "Valid from".');

  const money = (key: string, label: string, min: number, optional: boolean): number | null => {
    const raw = text(form, key);
    if (raw === '' && optional) return null;
    const cents = dollarsToCents(raw);
    if (cents === null || cents < min || cents > PRICE_CENTS_MAX) {
      errors.push(`${label} must be a dollar amount from ${centsToDollars(min)} to ${centsToDollars(PRICE_CENTS_MAX)}.`);
      return null;
    }
    return cents;
  };
  const adultCents = money('adult', 'The adult price', 1, false);
  const childCents = money('child', 'The child price', 0, false);
  const childPromoCents = money('child_promo', 'The child promotion price', 0, true);

  const promoLabel = text(form, 'promo_label');
  if (promoLabel.length > PROMO_LABEL_MAX) errors.push(`The promotion label must be at most ${PROMO_LABEL_MAX} characters.`);
  if (childPromoCents !== null && promoLabel.length === 0) errors.push('A promotion price needs a promotion label.');

  const sourceNote = text(form, 'source_note');
  if (sourceNote.length > DINING_SOURCE_NOTE_MAX) errors.push(`The source note must be at most ${DINING_SOURCE_NOTE_MAX} characters.`);

  const verifiedText = text(form, 'verified_at');
  const verifiedAt = verifiedText === '' ? null : calendarDate(verifiedText);
  if (verifiedText !== '' && verifiedAt === null) errors.push('"Verified on" must be a date (YYYY-MM-DD).');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id,
      planCode: planCode!,
      displayName,
      validFrom: validFrom!,
      validTo: validTo!,
      adultCents: adultCents!,
      childCents: childCents!,
      childPromoCents,
      promoLabel: promoLabel === '' ? null : promoLabel,
      sourceNote: sourceNote === '' ? null : sourceNote,
      verifiedAt,
    },
  };
}

/** The first other period of the same plan whose inclusive range meets `input`'s, or null (Requirement 2.6). */
export function findPriceOverlap(existing: readonly AdminPriceRow[], input: AdminPriceInput): AdminPriceRow | null {
  return (
    existing.find((p) => p.planCode === input.planCode && p.id !== input.id && p.validFrom <= input.validTo && input.validFrom <= p.validTo) ?? null
  );
}

// ---------------------------------------------------------------------------
// Default assumptions (Requirement 18.3)
// ---------------------------------------------------------------------------

/** Every scalar config key in form order; `tierEstimates` is edited as eight `tier.<service>.<n>` fields. */
export const CONFIG_SCALAR_KEYS = (Object.keys(DINING_CONFIG_DEFAULTS) as (keyof DiningConfig)[]).filter((k) => k !== 'tierEstimates');
export const TIER_SERVICES = ['table_service', 'quick_service'] as const;
export const TIER_LEVELS = ['1', '2', '3', '4'] as const;

export function parseConfigForm(form: FormFields): Parsed<DiningConfig> {
  const errors: string[] = [];
  const candidate: Record<string, unknown> = {};
  for (const key of CONFIG_SCALAR_KEYS) {
    const raw = text(form, key);
    if (typeof DINING_CONFIG_DEFAULTS[key] === 'boolean') {
      if (raw !== 'true' && raw !== 'false') errors.push(`${key} must be yes or no.`);
      candidate[key] = raw === 'true';
      continue;
    }
    const n = integer(raw);
    if (n === null) errors.push(`${key} must be a whole number.`);
    candidate[key] = n;
  }
  const tiers: Record<string, Record<string, number | null>> = {};
  for (const service of TIER_SERVICES) {
    tiers[service] = {};
    for (const level of TIER_LEVELS) {
      const n = integer(text(form, `tier.${service}.${level}`));
      if (n === null) errors.push(`The ${service} tier ${level} estimate must be a whole number of cents.`);
      tiers[service][level] = n;
    }
  }
  candidate.tierEstimates = tiers;
  if (errors.length > 0) return { ok: false, errors };
  const parsed = diningConfigSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  return { ok: true, value: parsed.data };
}

/** The keys to store: those that differ from `DINING_CONFIG_DEFAULTS` (`tierEstimates` as a whole). */
export function configToStore(config: DiningConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DINING_CONFIG_DEFAULTS) as (keyof DiningConfig)[]) {
    if (JSON.stringify(config[key]) !== JSON.stringify(DINING_CONFIG_DEFAULTS[key])) out[key] = config[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Location rules (Requirements 8.2, 8.3, 8.7, 8.8, 18.4, 18.10)
// ---------------------------------------------------------------------------

export const RULE_PERIODS = ['breakfast', 'lunch', 'dinner'] as const;

export function parseRuleForm(form: FormFields): Parsed<AdminRuleInput> {
  const errors: string[] = [];
  const serviceText = text(form, 'service_type');
  let serviceType: DiningServiceType | null = null;
  if (serviceText !== '') {
    if ((DINING_SERVICE_TYPES as readonly string[]).includes(serviceText)) serviceType = serviceText as DiningServiceType;
    else errors.push('Choose a service type.');
  }

  const costText = text(form, 'credit_cost');
  const creditCost = costText === '2' ? 2 : costText === '1' ? 1 : null;
  if (creditCost === null) errors.push('The credit cost must be 1 or 2.');

  const periods: { breakfast?: 1 | 2; lunch?: 1 | 2; dinner?: 1 | 2 } = {};
  for (const period of RULE_PERIODS) {
    const raw = text(form, `period_${period}`);
    if (raw === '') continue;
    if (raw === '1' || raw === '2') periods[period] = raw === '2' ? 2 : 1;
    else errors.push(`The ${period} credit cost must be 1, 2 or blank.`);
  }
  const creditCostByPeriod: DiningCreditCostByPeriod | null = Object.keys(periods).length > 0 ? periods : null;

  const gratuityIncluded = text(form, 'gratuity_included') !== '';
  const passText = text(form, 'pass_discount_eligible');
  const passDiscountEligible = passText === 'yes' ? true : passText === 'no' ? false : null;
  if (passText !== '' && passText !== 'yes' && passText !== 'no') errors.push('The pass discount setting is not valid.');

  const override = (key: string, label: string): number | null => {
    const raw = text(form, key);
    if (raw === '') return null;
    const cents = dollarsToCents(raw);
    if (cents === null || cents < 1 || cents > PRICE_CENTS_MAX) {
      errors.push(`${label} must be a dollar amount from 0.01 to ${centsToDollars(PRICE_CENTS_MAX)}, or blank.`);
      return null;
    }
    return cents;
  };
  const overrideAdultCents = override('override_adult', 'The adult price override');
  const overrideChildCents = override('override_child', 'The child price override');

  const statusText = text(form, 'rule_status');
  const ruleStatus = (DINING_RULE_STATUSES as readonly string[]).includes(statusText) ? (statusText as DiningRuleStatus) : null;
  if (ruleStatus === null) errors.push('Choose verified or unverified.');

  const verifiedText = text(form, 'verified_at');
  const verifiedAt = verifiedText === '' ? null : calendarDate(verifiedText);
  if (verifiedText !== '' && verifiedAt === null) errors.push('"Verified on" must be a date (YYYY-MM-DD).');

  const sourceNote = text(form, 'source_note');
  if (sourceNote.length > DINING_SOURCE_NOTE_MAX) errors.push(`The source note must be at most ${DINING_SOURCE_NOTE_MAX} characters.`);

  // The CHECK constraints of dining_plan_location_rules, as page messages (Requirement 8.3).
  const tableService = serviceType === 'table_service';
  if (creditCost === 2 && !tableService) errors.push('A credit cost of 2 needs the service type "table_service".');
  if (creditCostByPeriod !== null && !tableService) errors.push('A credit cost by meal period needs the service type "table_service".');
  if (gratuityIncluded && !tableService) errors.push('Included gratuity needs the service type "table_service".');
  if (ruleStatus === 'verified' && verifiedAt === null && verifiedText === '') errors.push('A verified rule needs the date it was verified.');

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      serviceType,
      creditCost: creditCost!,
      creditCostByPeriod,
      gratuityIncluded,
      passDiscountEligible,
      overrideAdultCents,
      overrideChildCents,
      ruleStatus: ruleStatus!,
      verifiedAt,
      sourceNote: sourceNote === '' ? null : sourceNote,
    },
  };
}

/** The same constraints, for an input that did not come through the form (the repo checks before writing). */
export function ruleProblems(input: AdminRuleInput): string[] {
  const out: string[] = [];
  const tableService = input.serviceType === 'table_service';
  if (input.creditCost === 2 && !tableService) out.push('A credit cost of 2 needs the service type "table_service".');
  if (input.creditCostByPeriod !== null && !tableService) out.push('A credit cost by meal period needs the service type "table_service".');
  if (input.gratuityIncluded && !tableService) out.push('Included gratuity needs the service type "table_service".');
  if (input.ruleStatus === 'verified' && input.verifiedAt === null) out.push('A verified rule needs the date it was verified.');
  if (input.sourceNote !== null && input.sourceNote.length > DINING_SOURCE_NOTE_MAX) out.push(`The source note must be at most ${DINING_SOURCE_NOTE_MAX} characters.`);
  return out;
}
