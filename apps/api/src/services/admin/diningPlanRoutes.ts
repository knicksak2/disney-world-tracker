/**
 * Admin_Panel section for the Dining Plan calculator (dining-plan-calculator Requirements 2.6, 8.2 to 8.4, 8.8 to 8.10,
 * 18; design.md "Admin_Panel"; Property 24). Follows `ticketPriceRoutes.ts`: Basic Auth on every route, the same-origin
 * check on every POST, `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store` on every response,
 * every value through `escapeHtml`, pages through `renderPage`, and a flash redirect after a successful POST.
 *
 * A validation failure re-renders the form with the messages (status 400) and writes nothing. Any other error renders
 * a generic in-page message; the details go to the server log only (Requirement 18.7).
 *
 * The routes run in their own child scope, which parses `application/x-www-form-urlencoded` bodies (an HTML form's
 * POST); the other admin routes are not affected.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  DINING_CONFIG_DEFAULTS,
  DINING_PLAN_CODES,
  DINING_RULE_STATUSES,
  DINING_SERVICE_TYPES,
  DINING_SOURCE_NOTE_MAX,
  type DiningConfig,
  type DiningCreditCostByPeriod,
} from '@dwt/shared';

import {
  CONFIG_SCALAR_KEYS,
  DISPLAY_NAME_MAX,
  PROMO_LABEL_MAX,
  RULE_PERIODS,
  TIER_LEVELS,
  TIER_SERVICES,
  centsToDollars,
  parseConfigForm,
  parsePriceForm,
  parseRuleForm,
  type FormFields,
} from '../diningPlan/admin/forms.js';
import {
  ADMIN_LOCATION_FILTERS,
  type AdminDiningPlanPort,
  type AdminDiningPlanState,
  type AdminLocationDetail,
  type AdminLocationFilter,
  type AdminLocationRow,
  type AdminPriceRow,
  type AdminRuleInput,
} from '../diningPlan/adminPort.js';
import type { SeedEntryResult } from '../diningPlan/seed/seedRules.js';
import { wdwToday } from '../trips/wdwClock.js';
import { escapeHtml, explainerBanner, progressBar, renderPage, table } from './html.js';
import type { AdminRoutesOptions } from './routes.js';
import { isSameOriginRequest } from './sameOrigin.js';

const BASE = '/admin/dining-plan';
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const FILTER_LABELS: Readonly<Record<AdminLocationFilter, string>> = {
  all: 'All restaurants',
  needs_review: 'Needs review (auto + unverified)',
  has_rule: 'Custom rules only',
  seeded_unverified: 'Seeded & unverified',
};

const PLAN_LABELS: Readonly<Record<(typeof DINING_PLAN_CODES)[number], string>> = {
  quick_service: 'Quick-Service Plan',
  table_service: 'Table-Service Plan',
  deluxe: 'Deluxe Table-Service Plan',
};

const SERVICE_TYPE_LABELS: Readonly<Record<(typeof DINING_SERVICE_TYPES)[number], string>> = {
  table_service: 'Table Service',
  quick_service: 'Quick Service',
  snack_only: 'Snack Only',
  not_eligible: 'Not Eligible',
};

const TIER_LABELS: Readonly<Record<(typeof TIER_LEVELS)[number], string>> = {
  '1': '$ (Budget)',
  '2': '$$ (Moderate)',
  '3': '$$$ (Upscale)',
  '4': '$$$$ (Signature)',
};

type ConfigScalarKey = Exclude<keyof DiningConfig, 'tierEstimates'>;

interface ConfigFieldMeta {
  readonly group: 'rates' | 'prices';
  readonly unit: 'bps' | 'cents' | 'bool';
  readonly label: string;
  readonly help: string;
}

const CONFIG_META: Readonly<Record<ConfigScalarKey, ConfigFieldMeta>> = {
  taxBps: {
    group: 'rates',
    unit: 'bps',
    label: 'Sales tax rate',
    help: 'Added to out-of-pocket meals, snacks, and mugs (basis points: 650 = 6.5%).',
  },
  tipBps: {
    group: 'rates',
    unit: 'bps',
    label: 'Table-service tip rate',
    help: 'Added to table-service meals unless gratuity is included (1800 = 18%).',
  },
  planPricesIncludeTax: {
    group: 'rates',
    unit: 'bool',
    label: 'Plan prices already include tax',
    help: 'Yes for Disney’s published Dining Plan prices; No adds tax on top of plan cost.',
  },
  passDiningDiscountBps: {
    group: 'rates',
    unit: 'bps',
    label: 'Annual Pass / DVC dining discount',
    help: 'Applied to eligible out-of-pocket meals when party includes a passholder (1000 = 10%).',
  },
  childFallbackBps: {
    group: 'rates',
    unit: 'bps',
    label: 'Child meal fallback (% of adult)',
    help: 'Used when a menu has no children’s section (6000 = 60% of adult price).',
  },
  mugCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Refillable resort mug',
    help: 'Out-of-pocket mug value (one mug is included per guest on every plan).',
  },
  snackCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Typical snack',
    help: 'Used to value snack credits and out-of-pocket snack demand.',
  },
  softDrinkCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Soft drink',
    help: 'Added per menu-item meal when the user selects soft drinks.',
  },
  specialtyBeverageCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Specialty non-alcoholic drink',
    help: 'Fallback price for specialty drinks (milkshakes, mocktails) if missing from menu.',
  },
  alcoholBeverageCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Alcoholic drink fallback',
    help: 'Used when a guest orders alcohol at a restaurant with no priced alcohol menu section.',
  },
  dessertCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Table-service dessert fallback',
    help: 'Used if a table-service menu has no priced dessert section.',
  },
  appetizerCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Table-service appetizer fallback',
    help: 'Used if a table-service menu has no priced appetizer section.',
  },
  placeholderQsCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Generic Quick-Service meal',
    help: 'Adult estimate when the user adds an unchosen Quick-Service slot.',
  },
  placeholderTsCents: {
    group: 'prices',
    unit: 'cents',
    label: 'Generic Table-Service meal',
    help: 'Adult estimate when the user adds an unchosen Table-Service slot.',
  },
};

function setSecurityHeaders(reply: FastifyReply): void {
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Cache-Control', 'private, no-store');
}

function formOf(request: FastifyRequest): FormFields {
  const body = request.body;
  if (body === null || typeof body !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) if (typeof v === 'string') out[k] = v;
  return out;
}

function flashBox(flash: string | undefined): string {
  return flash === undefined || flash === ''
    ? ''
    : `<div class="flash flash-success"><strong>Done:</strong> ${escapeHtml(flash)}</div>`;
}

function errorBox(errors: readonly string[]): string {
  if (errors.length === 0) return '';
  return `<div class="flash flash-error" role="alert">
    <strong>Nothing was saved:</strong><ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`;
}

function send(reply: FastifyReply, title: string, html: string, status = 200): FastifyReply {
  return reply.type('text/html; charset=utf-8').status(status).send(renderPage(title, html, BASE));
}

function redirect(reply: FastifyReply, path: string, flash: string): FastifyReply {
  return reply.redirect(`${path}?flash=${encodeURIComponent(flash)}`);
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function periodText(map: DiningCreditCostByPeriod | null): string {
  if (map === null) return '';
  return RULE_PERIODS.filter((p) => map[p] !== undefined).map((p) => `${p} ${map[p]}`).join(', ');
}

function formatCentsPreview(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatBpsPreview(bps: number): string {
  const pct = (bps / 100).toFixed(2).replace(/\.?0+$/u, '');
  return `${pct}%`;
}

function formatConfigUnit(unit: ConfigFieldMeta['unit'], val: number | boolean): string {
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  return unit === 'bps' ? formatBpsPreview(val) : formatCentsPreview(val);
}

function ruleBasisBadge(basis: 'verified' | 'unverified' | 'derived'): string {
  if (basis === 'verified') return '<span class="badge badge-success">✓ Verified</span>';
  if (basis === 'unverified') return '<span class="badge badge-warning">Unverified rule</span>';
  return '<span class="badge badge-neutral">Auto (derived)</span>';
}

function serviceTypeBadge(type: (typeof DINING_SERVICE_TYPES)[number]): string {
  if (type === 'table_service') return '<span class="badge badge-info">Table Service</span>';
  if (type === 'quick_service') return '<span class="badge badge-success">Quick Service</span>';
  if (type === 'snack_only') return '<span class="badge badge-warning">Snack Only</span>';
  return '<span class="badge badge-neutral">Not Eligible</span>';
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

interface PriceFormValues {
  readonly id: string;
  readonly plan_code: string;
  readonly display_name: string;
  readonly valid_from: string;
  readonly valid_to: string;
  readonly adult: string;
  readonly child: string;
  readonly child_promo: string;
  readonly promo_label: string;
  readonly source_note: string;
  readonly verified_at: string;
}

function priceValuesOf(p: AdminPriceRow | null): PriceFormValues {
  return {
    id: p?.id ?? '',
    plan_code: p?.planCode ?? 'table_service',
    display_name: p?.displayName ?? '',
    valid_from: p?.validFrom ?? '',
    valid_to: p?.validTo ?? '',
    adult: p === null ? '' : centsToDollars(p.adultCents),
    child: p === null ? '' : centsToDollars(p.childCents),
    child_promo: p === null ? '' : centsToDollars(p.childPromoCents),
    promo_label: p?.promoLabel ?? '',
    source_note: p?.sourceNote ?? '',
    verified_at: p?.verifiedAt ?? '',
  };
}

function priceForm(v: PriceFormValues): string {
  const isEditing = v.id !== '';
  const field = (name: keyof PriceFormValues, label: string, help: string, attrs = '', type = 'text') => `
    <div>
      <label class="form-label" for="pf_${name}">${escapeHtml(label)}</label>
      <input id="pf_${name}" type="${type}" name="${name}" value="${escapeHtml(v[name])}" class="form-input" ${attrs}/>
      <span class="form-help">${escapeHtml(help)}</span>
    </div>`;

  return `<div id="price-form" class="card-nested${isEditing ? ' editing' : ''}">
    <div class="section-header-row">
      <h3>${isEditing ? 'Edit price period' : 'Add a price period'}</h3>
      ${isEditing ? `<a href="${BASE}#plan-prices" class="btn btn-sm btn-secondary">Cancel editing</a>` : ''}
    </div>
    ${
      isEditing && v.verified_at === ''
        ? '<p class="text-sm text-amber" style="margin-bottom: 1rem;">Tip: Confirm the Adult, Child, and Promo rates on DisneyWorld.com, set <strong>Verified on</strong> to today, and click <strong>Save period</strong>.</p>'
        : ''
    }
    <form method="POST" action="${BASE}/prices">
      <input type="hidden" name="id" value="${escapeHtml(v.id)}"/>
      <div class="form-grid">
        <div>
          <label class="form-label" for="pf_plan_code">Plan</label>
          <select id="pf_plan_code" name="plan_code" class="form-input">${DINING_PLAN_CODES.map((c) => option(c, PLAN_LABELS[c], c === v.plan_code)).join('')}</select>
          <span class="form-help">Which Dining Plan tier this price period covers.</span>
        </div>
        ${field('display_name', 'Display name', 'Name shown to users in the mobile app (e.g. Disney Dining Plan).', `maxlength="${DISPLAY_NAME_MAX}" placeholder="e.g. Disney Dining Plan" required`)}
        ${field('valid_from', 'Valid from', 'First check-in night this rate applies (inclusive).', 'required', 'date')}
        ${field('valid_to', 'Valid to', 'Last night this rate applies (inclusive). Cannot overlap another period for the same plan.', 'required', 'date')}
        ${field('adult', 'Adult price per night ($)', 'Nightly rate for guests age 10+ (tax included).', 'placeholder="e.g. 98.59" required')}
        ${field('child', 'Child price per night ($)', 'Standard nightly rate for guests age 3–9.', 'placeholder="e.g. 31.94" required')}
        ${field('child_promo', 'Child promo price ($)', 'Optional — e.g. 0.00 for Kids Eat Free. Leave blank if no promo.', 'placeholder="e.g. 0.00"')}
        ${field('promo_label', 'Promotion label', 'Required if a child promo price is entered.', `maxlength="${PROMO_LABEL_MAX}" placeholder="e.g. Kids Eat Free 2026"`)}
        ${field('verified_at', 'Verified on', 'Date you confirmed these rates on Disney’s booking site. Leave blank if unverified.', '', 'date')}
        ${field('source_note', 'Source note', 'Optional reference (e.g. Disney booking flow 2026-11-09).', `maxlength="${DINING_SOURCE_NOTE_MAX}" placeholder="Where you confirmed these rates"`)}
      </div>
      <div class="action-row">
        <button type="submit" class="btn">Save period</button>
        ${isEditing ? `<a href="${BASE}#plan-prices" class="btn btn-secondary">Cancel</a>` : ''}
      </div>
    </form>
  </div>`;
}

function configForm(config: DiningConfig): string {
  const renderScalarRow = (key: ConfigScalarKey) => {
    const meta = CONFIG_META[key];
    const value = config[key];
    const def = DINING_CONFIG_DEFAULTS[key];
    const isCustom = value !== def;
    // Note: `name` immediately precedes `value` on <input> so automated form scrapers read every field cleanly.
    const control =
      typeof def === 'boolean'
        ? `<select name="${key}" class="form-input form-input-sm">${option('true', 'yes', value === true)}${option('false', 'no', value === false)}</select>`
        : `<div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <input name="${key}" value="${escapeHtml(value)}" class="form-input form-input-sm" inputmode="numeric"/>
            <span class="text-xs text-muted">= ${escapeHtml(formatConfigUnit(meta.unit, value))}</span>
            ${isCustom ? '<span class="badge badge-info">Custom</span>' : ''}
          </div>`;
    return `<tr>
      <td>
        <div class="font-semibold">${escapeHtml(meta.label)} <code class="text-xs">${escapeHtml(key)}</code></div>
        <div class="text-xs text-muted">${escapeHtml(meta.help)}</div>
      </td>
      <td class="mono">${escapeHtml(formatConfigUnit(meta.unit, def))} <span class="text-xs text-muted">(${escapeHtml(String(def))})</span></td>
      <td>${control}</td>
    </tr>`;
  };

  const rateRows = CONFIG_SCALAR_KEYS.filter((k) => CONFIG_META[k].group === 'rates').map((k) => renderScalarRow(k as ConfigScalarKey));
  const priceRows = CONFIG_SCALAR_KEYS.filter((k) => CONFIG_META[k].group === 'prices').map((k) => renderScalarRow(k as ConfigScalarKey));
  const tierRows = TIER_SERVICES.flatMap((service) =>
    TIER_LEVELS.map((level) => {
      const value = config.tierEstimates[service][level];
      const def = DINING_CONFIG_DEFAULTS.tierEstimates[service][level];
      const isCustom = value !== def;
      return `<tr>
        <td>
          <div class="font-semibold">${escapeHtml(SERVICE_TYPE_LABELS[service])} — ${escapeHtml(TIER_LABELS[level])}</div>
          <div class="text-xs text-muted">Used only when a restaurant has no cached menu. <code class="text-xs">tierEstimates.${escapeHtml(service)}.${escapeHtml(level)}</code></div>
        </td>
        <td class="mono">${escapeHtml(formatCentsPreview(def))} <span class="text-xs text-muted">(${escapeHtml(def)})</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <input name="tier.${service}.${level}" value="${escapeHtml(value)}" class="form-input form-input-sm" inputmode="numeric"/>
            <span class="text-xs text-muted">= ${escapeHtml(formatCentsPreview(value))}</span>
            ${isCustom ? '<span class="badge badge-info">Custom</span>' : ''}
          </div>
        </td>
      </tr>`;
    }),
  );

  const subtable = (heading: string, rows: string[]) => `
    <h3 style="margin: 1.25rem 0 0.5rem;">${escapeHtml(heading)}</h3>
    <div class="table-wrapper">
      <table class="admin-table">
        <thead><tr><th>Assumption</th><th>Default</th><th>Value (raw cents / basis points)</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;

  return `<form method="POST" action="${BASE}/config">
    ${subtable('Taxes, Tips & Discounts', rateRows)}
    ${subtable('Fallback Food & Drink Prices (cents)', priceRows)}
    ${subtable('Price-Tier Fallback Estimates (cents)', tierRows)}
    <p class="text-xs text-muted" style="margin-bottom: 1rem;">Enter whole integers only: money in cents (e.g. <code>2299</code> = $22.99) and rates in basis points (e.g. <code>650</code> = 6.5%).</p>
    <div class="action-row">
      <button type="submit" class="btn">Save assumptions</button>
    </div>
  </form>
  <form method="POST" action="${BASE}/config" style="margin-top: 0.75rem;">
    <input type="hidden" name="reset" value="1"/>
    <button type="submit" class="btn btn-secondary">Reset to defaults</button>
  </form>`;
}

function dashboard(
  state: AdminDiningPlanState,
  opts: { flash?: string; errors?: readonly string[]; priceValues?: PriceFormValues; configValues?: DiningConfig; openConfig?: boolean },
): string {
  const c = state.coverage;
  const totalPrices = state.prices.length;
  const verifiedPrices = state.prices.filter((p) => p.verifiedAt !== null).length;
  const unverifiedPrices = totalPrices - verifiedPrices;
  const autoRules = Math.max(0, c.activeRestaurants - c.withRule);
  const unverifiedRules = Math.max(0, c.withRule - c.verified);
  const withMenuOrTier = Math.max(0, c.activeRestaurants - c.withNeitherMenuNorTier);
  const customizedCount = Object.keys(state.storedConfig).length;
  const cfg = opts.configValues ?? state.effectiveConfig;
  const pricePct = totalPrices > 0 ? (verifiedPrices / totalPrices) * 100 : 100;
  const menuPct = c.activeRestaurants > 0 ? (withMenuOrTier / c.activeRestaurants) * 100 : 100;

  let html = flashBox(opts.flash) + errorBox(opts.errors ?? []);

  html += explainerBanner(
    '🍽️',
    'How the Dining Plan Calculator Uses This Page',
    'Most restaurants work automatically from Disney’s catalog and cached menus. Use this page only to: (1) confirm official Dining Plan prices, (2) flag special restaurants like 2-credit signature dining or excluded lounges, and (3) optionally adjust fallback tax, tip, or estimate prices.',
  );

  html += `<div class="metric-grid">
    <div class="metric-card">
      <div>
        <div class="metric-label">1. Plan Prices</div>
        <div class="metric-val">${verifiedPrices} / ${totalPrices} verified</div>
        ${progressBar(pricePct, unverifiedPrices > 0 ? 'warning' : 'normal')}
        <div class="metric-sub">${
          unverifiedPrices > 0
            ? `${unverifiedPrices} period(s) need confirmation against DisneyWorld.com.`
            : 'All configured price periods are verified.'
        }</div>
      </div>
      <div style="margin-top: 0.75rem;"><a href="#plan-prices" class="text-sm font-semibold">Manage plan prices &rarr;</a></div>
    </div>
    <div class="metric-card">
      <div>
        <div class="metric-label">2. Restaurant Rules</div>
        <div class="metric-val">${unverifiedRules} to review</div>
        <div class="metric-sub">${c.verified} verified exceptions &middot; ${autoRules} auto-detected (no action needed)</div>
      </div>
      <div style="margin-top: 0.75rem;">${
        unverifiedRules > 0
          ? `<a href="${BASE}/locations?filter=has_rule" class="text-sm font-semibold">Review ${unverifiedRules} unverified &rarr;</a>`
          : `<a href="${BASE}/locations?filter=has_rule" class="text-sm font-semibold">View ${c.withRule} custom rules &rarr;</a>`
      }</div>
    </div>
    <div class="metric-card">
      <div>
        <div class="metric-label">Menu &amp; Tier Coverage</div>
        <div class="metric-val">${withMenuOrTier} / ${c.activeRestaurants}</div>
        ${progressBar(menuPct, c.withNeitherMenuNorTier > 0 ? 'warning' : 'normal')}
        <div class="metric-sub">${c.withMenu} with cached menus &middot; ${c.withNeitherMenuNorTier} default estimate only</div>
      </div>
      <div style="margin-top: 0.75rem;"><a href="#location-rules" class="text-sm font-semibold">Catalog breakdown &darr;</a></div>
    </div>
    <div class="metric-card">
      <div>
        <div class="metric-label">3. Default Assumptions</div>
        <div class="metric-val">${customizedCount === 0 ? 'All defaults' : `${customizedCount} custom`}</div>
        <div class="metric-sub">Tax ${escapeHtml(formatBpsPreview(cfg.taxBps))} &middot; Tip ${escapeHtml(formatBpsPreview(cfg.tipBps))} &middot; Mug ${escapeHtml(formatCentsPreview(cfg.mugCents))}</div>
      </div>
      <div style="margin-top: 0.75rem;"><a href="#default-assumptions" class="text-sm font-semibold">View / edit defaults &darr;</a></div>
    </div>
  </div>`;

  // Section 1: Plan Prices
  html += `<section id="plan-prices" class="card">
    <div class="section-header-row">
      <div>
        <h2>1. Dining Plan Prices (per night)</h2>
        <p class="text-sm text-muted">Nightly plan rates per person. Click <strong>Edit</strong> on any row to confirm its prices against Disney’s booking site and set a verification date.</p>
      </div>
    </div>`;
  html += table(state.prices, [
    { header: 'Plan', cell: (p) => `<strong>${escapeHtml(PLAN_LABELS[p.planCode])}</strong><div class="text-xs text-muted mono">${escapeHtml(p.planCode)}</div>` },
    { header: 'Display name', cell: (p) => escapeHtml(p.displayName) },
    { header: 'Valid dates', cell: (p) => `<span class="mono">${escapeHtml(p.validFrom)}</span> to <span class="mono">${escapeHtml(p.validTo)}</span>` },
    { header: 'Nightly rate', cell: (p) => `<div>Adult: <strong>$${escapeHtml(centsToDollars(p.adultCents))}</strong></div><div class="text-xs text-muted">Child: $${escapeHtml(centsToDollars(p.childCents))}</div>` },
    { header: 'Kids promo', cell: (p) => (p.childPromoCents === null ? '<span class="text-muted">None</span>' : `<span class="badge badge-info">$${escapeHtml(centsToDollars(p.childPromoCents))} &middot; ${escapeHtml(p.promoLabel)}</span>`) },
    { header: 'Verified', cell: (p) => (p.verifiedAt === null ? '<span class="badge badge-warning">price not yet verified</span>' : `<span class="badge badge-success">✓ ${escapeHtml(p.verifiedAt)}</span>`) },
    { header: 'Source note', cell: (p) => `<span class="text-xs text-muted">${escapeHtml(p.sourceNote ?? '-')}</span>` },
    {
      header: 'Actions',
      cell: (p) =>
        `<div class="action-row">
          <a href="${BASE}?edit=${escapeHtml(p.id)}#price-form" class="btn btn-sm btn-secondary">Edit</a>
          <form method="POST" action="${BASE}/prices/${escapeHtml(p.id)}/delete" style="display:inline"><button type="submit" class="btn btn-sm btn-danger">Delete</button></form>
        </div>`,
    },
  ]);
  html += priceForm(opts.priceValues ?? priceValuesOf(null));
  html += '</section>';

  // Section 2: Restaurant Credit Rules & Coverage
  html += `<section id="location-rules" class="card">
    <h2>2. Restaurant Credit Rules</h2>
    <p class="text-sm text-muted" style="margin-bottom: 0.9rem;">
      You do <strong>not</strong> need to add a rule for every restaurant. By default, the calculator reads Disney’s catalog facets and treats Table-Service restaurants as 1 TS credit and Quick-Service restaurants as 1 QS credit.
      Only add custom rules for exceptions: <strong>2-credit signature/character dining</strong>, <strong>gratuity-included shows</strong>, <strong>snack-only spots</strong>, or <strong>locations that don’t accept the Dining Plan</strong>.
    </p>
    <div class="action-row" style="margin-bottom: 1.25rem;">
      <a href="${BASE}/locations?filter=has_rule" class="btn">Custom rules (${escapeHtml(c.withRule)} &middot; ${escapeHtml(unverifiedRules)} unverified)</a>
      <a href="${BASE}/locations?filter=seeded_unverified" class="btn btn-secondary">Seeded &amp; unverified</a>
      <a href="${BASE}/locations" class="btn btn-secondary">Search all restaurants (${escapeHtml(c.activeRestaurants)})</a>
      <a href="${BASE}/locations?filter=needs_review" class="btn btn-secondary">Needs review (auto + unverified)</a>
    </div>
    <div class="card-nested" style="margin-top: 0;">
      <div class="section-header-row" style="margin-bottom: 0.5rem;">
        <div>
          <h3>Seed Known Exceptions</h3>
          <p class="text-xs text-muted">Loads the bundled <code>locationRules.seed.json</code> list of known 2-credit, dinner-show, and excluded restaurants. Safe to re-run: a rule you already marked <strong>Verified</strong> is never overwritten by an unverified one.</p>
        </div>
        <form method="POST" action="${BASE}/seed"><button type="submit" class="btn btn-secondary">Apply seed rules</button></form>
      </div>
    </div>
    <h3 style="margin: 1.25rem 0 0.5rem;">Catalog Breakdown (${escapeHtml(c.activeRestaurants)} active restaurants)</h3>`;
  html += table(
    [
      { label: 'Active Restaurant Experiences', value: c.activeRestaurants, note: 'Total active restaurants in catalog' },
      ...DINING_SERVICE_TYPES.map((t) => ({
        label: `Auto-detected as ${SERVICE_TYPE_LABELS[t]} (${t})`,
        value: c.byDerivedServiceType[t],
        note: t === 'not_eligible' ? 'Includes lounges without meal service' : 'Derived automatically from catalog facets',
      })),
      { label: 'With a custom location rule', value: c.withRule, note: `${c.verified} verified, ${unverifiedRules} unverified` },
      { label: 'With a verified rule', value: c.verified, note: 'Confirmed against Disney sources' },
      { label: 'With a cached menu', value: c.withMenu, note: 'Priced from real menu items' },
      { label: 'Neither menu nor price tier', value: c.withNeitherMenuNorTier, note: 'Uses default placeholder estimate only' },
    ],
    [
      { header: 'Measure', cell: (r) => escapeHtml(r.label) },
      { header: 'Count', cell: (r) => `<strong>${escapeHtml(r.value)}</strong>` },
      { header: 'What it means', cell: (r) => `<span class="text-xs text-muted">${escapeHtml(r.note)}</span>` },
    ],
  );
  html += '</section>';

  // Section 3: Default Assumptions (collapsed by default unless errors)
  const storedKeys = Object.keys(state.storedConfig);
  html += `<section id="default-assumptions" class="card">
    <details class="card-details"${opts.openConfig ? ' open' : ''}>
      <summary>
        <h2><span class="details-chevron"></span>3. Default Calculator Assumptions</h2>
        <div class="action-row">
          ${
            storedKeys.length === 0
              ? '<span class="badge badge-neutral">All using built-in defaults</span>'
              : `<span class="badge badge-info">${escapeHtml(storedKeys.length)} custom override(s)</span>`
          }
          <span class="text-xs text-muted">Click to expand (advanced — usually no changes needed)</span>
        </div>
      </summary>
      <p class="text-sm text-muted" style="margin-bottom: 0.75rem;">
        These fallback numbers are used when a trip hasn’t customized tax/tip or when a restaurant has no menu prices cached.
      </p>
      <p class="text-xs text-muted" style="margin-bottom: 0.5rem;">
        Customized keys stored in DB: ${escapeHtml(storedKeys.length === 0 ? 'none (every value is the default)' : storedKeys.join(', '))}
      </p>
      ${configForm(cfg)}
    </details>
  </section>`;

  return html;
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

function locationsTable(rows: readonly AdminLocationRow[]): string {
  return table(rows, [
    {
      header: 'Restaurant',
      cell: (r) =>
        `<a href="${BASE}/locations/${escapeHtml(r.experienceId)}" class="font-semibold">${escapeHtml(r.name)}</a>${
          r.active ? '' : ' <span class="badge badge-danger">Inactive</span>'
        }`,
    },
    { header: 'Park', cell: (r) => escapeHtml(r.park ?? 'Resort / other') },
    { header: 'Derived type', cell: (r) => escapeHtml(r.derivedServiceType) },
    { header: 'Effective type', cell: (r) => serviceTypeBadge(r.effectiveServiceType) },
    { header: 'Rule', cell: (r) => ruleBasisBadge(r.ruleBasis) },
    {
      header: 'Credits',
      cell: (r) =>
        r.effectiveServiceType === 'not_eligible' || r.effectiveServiceType === 'snack_only'
          ? '<span class="text-muted">-</span>'
          : escapeHtml(r.creditCostByPeriod === null ? String(r.creditCost) : `${r.creditCost} (${periodText(r.creditCostByPeriod)})`),
    },
    { header: 'Gratuity incl.', cell: (r) => (r.gratuityIncluded ? '<span class="badge badge-success">Yes</span>' : '<span class="text-muted">No</span>') },
    {
      header: 'Pricing source',
      cell: (r) => `${escapeHtml(r.priceTier ?? 'No tier')} &middot; ${r.hasMenu ? '<span class="text-emerald">Menu cached</span>' : '<span class="text-muted">No menu</span>'}`,
    },
    { header: 'Note', cell: (r) => `<span class="text-xs text-muted">${escapeHtml(r.sourceNote ?? '')}</span>` },
  ]);
}

interface RuleFormValues {
  readonly service_type: string;
  readonly credit_cost: string;
  readonly period_breakfast: string;
  readonly period_lunch: string;
  readonly period_dinner: string;
  readonly gratuity_included: boolean;
  readonly pass_discount_eligible: string;
  readonly override_adult: string;
  readonly override_child: string;
  readonly rule_status: string;
  readonly verified_at: string;
  readonly source_note: string;
}

function ruleValuesOf(rule: AdminRuleInput | null): RuleFormValues {
  return {
    service_type: rule?.serviceType ?? '',
    credit_cost: String(rule?.creditCost ?? 1),
    period_breakfast: String(rule?.creditCostByPeriod?.breakfast ?? ''),
    period_lunch: String(rule?.creditCostByPeriod?.lunch ?? ''),
    period_dinner: String(rule?.creditCostByPeriod?.dinner ?? ''),
    gratuity_included: rule?.gratuityIncluded ?? false,
    pass_discount_eligible: rule?.passDiscountEligible === true ? 'yes' : rule?.passDiscountEligible === false ? 'no' : '',
    override_adult: rule === null ? '' : centsToDollars(rule.overrideAdultCents),
    override_child: rule === null ? '' : centsToDollars(rule.overrideChildCents),
    rule_status: rule?.ruleStatus ?? 'unverified',
    verified_at: rule?.verifiedAt ?? '',
    source_note: rule?.sourceNote ?? '',
  };
}

function ruleValuesFromForm(form: FormFields): RuleFormValues {
  const s = (k: string) => form[k] ?? '';
  return {
    service_type: s('service_type'),
    credit_cost: s('credit_cost'),
    period_breakfast: s('period_breakfast'),
    period_lunch: s('period_lunch'),
    period_dinner: s('period_dinner'),
    gratuity_included: s('gratuity_included') !== '',
    pass_discount_eligible: s('pass_discount_eligible'),
    override_adult: s('override_adult'),
    override_child: s('override_child'),
    rule_status: s('rule_status'),
    verified_at: s('verified_at'),
    source_note: s('source_note'),
  };
}

function locationPage(detail: AdminLocationDetail, v: RuleFormValues, opts: { flash?: string; errors?: readonly string[] }): string {
  const loc = detail.location;
  const action = `${BASE}/locations/${escapeHtml(loc.experienceId)}`;
  const periodSelect = (period: (typeof RULE_PERIODS)[number]) => {
    const key = `period_${period}` as const;
    return `<div>
      <label class="form-label" for="rf_${key}" style="text-transform: capitalize;">${escapeHtml(period)}</label>
      <select id="rf_${key}" name="${key}" class="form-input">${option('', 'same as credit cost', v[key] === '')}${option('1', '1', v[key] === '1')}${option('2', '2', v[key] === '2')}</select>
    </div>`;
  };
  let html = `<p style="margin-bottom: 1rem;"><a href="${BASE}/locations" class="btn btn-sm btn-secondary">&larr; Back to locations</a></p>`;
  html += flashBox(opts.flash) + errorBox(opts.errors ?? []);
  if (v.rule_status === 'unverified' && v.verified_at !== '') {
    html += `<div class="flash" style="background: var(--warning-bg); border: 1px solid var(--warning-border);">
      <strong>Still marked unverified:</strong> You entered a "Verified on" date (<code>${escapeHtml(v.verified_at)}</code>), but <strong>Rule status</strong> is still <strong>unverified</strong>. Change <strong>Rule status</strong> to <strong>verified</strong> or click <strong>Save &amp; mark verified</strong> below.
    </div>`;
  }
  html += `<div class="card">
    <div class="section-header-row">
      <h2>${escapeHtml(loc.name)}</h2>
      <div class="action-row">
        ${ruleBasisBadge(loc.ruleBasis)}
        ${serviceTypeBadge(loc.effectiveServiceType)}
        ${loc.active ? '' : '<span class="badge badge-danger">Inactive in catalog</span>'}
      </div>
    </div>
    <p class="text-sm" style="margin-bottom: 0.4rem;">
      Derived service type: <strong>${escapeHtml(loc.derivedServiceType)}</strong> &middot;
      Effective: <strong>${escapeHtml(loc.effectiveServiceType)}</strong> &middot;
      Park: <strong>${escapeHtml(loc.park ?? 'Resort / other')}</strong>
    </p>
    <p class="text-sm text-muted">
      Price tier: ${escapeHtml(loc.priceTier ?? 'none')} &middot;
      ${loc.hasMenu ? 'Has a cached menu' : 'No cached menu (uses price tier or default estimate)'}.
    </p>
  </div>`;

  html += `<form method="POST" action="${action}" class="card">
    <h3 style="margin-bottom: 0.75rem;">1. Credit &amp; Service Rules</h3>
    <div class="form-grid">
      <div>
        <label class="form-label" for="rf_service_type">Service type</label>
        <select id="rf_service_type" name="service_type" class="form-input">${option('', `Use catalog default (${loc.derivedServiceType})`, v.service_type === '')}${DINING_SERVICE_TYPES.map((t) => option(t, `${SERVICE_TYPE_LABELS[t]} (${t})`, v.service_type === t)).join('')}</select>
        <span class="form-help">Important: Pick <strong>Table Service</strong> explicitly if you set 2 credits, per-meal credits, or gratuity included.</span>
      </div>
      <div>
        <label class="form-label" for="rf_credit_cost">Standard credit cost</label>
        <select id="rf_credit_cost" name="credit_cost" class="form-input">${option('1', '1 credit per person', v.credit_cost === '1')}${option('2', '2 credits per person', v.credit_cost === '2')}</select>
        <span class="form-help">2 credits is only allowed when Service type is Table Service.</span>
      </div>
      <div>
        <label class="form-label" for="rf_pass_discount">Annual Pass / DVC discount</label>
        <select id="rf_pass_discount" name="pass_discount_eligible" class="form-input">${option('', 'Default (eligible for 10% discount)', v.pass_discount_eligible === '')}${option('yes', 'Eligible', v.pass_discount_eligible === 'yes')}${option('no', 'Not eligible', v.pass_discount_eligible === 'no')}</select>
        <span class="form-help">Whether passholders get the dining discount here when paying out of pocket.</span>
      </div>
    </div>

    <div class="form-group">
      <div class="form-label">Credit cost by meal period (optional — Table Service only)</div>
      <div class="form-grid" style="margin-bottom: 0.35rem;">${RULE_PERIODS.map(periodSelect).join('')}</div>
      <span class="form-help">Only set this if breakfast, lunch, and dinner cost different credits (e.g. Akershus is 1 at breakfast, 2 at lunch/dinner).</span>
    </div>

    <div class="form-group">
      <label class="checkbox-row">
        <input type="checkbox" name="gratuity_included" value="1"${v.gratuity_included ? ' checked' : ''}/>
        <span><strong>Gratuity included</strong> (Table Service only) — Check only for locations like Cinderella’s Royal Table or dinner shows where Disney includes tip with the plan.</span>
      </label>
    </div>

    <h3 style="margin: 1.5rem 0 0.5rem; padding-top: 1rem; border-top: 1px solid var(--border);">2. Fixed-Price Overrides (Optional)</h3>
    <p class="text-xs text-muted" style="margin-bottom: 0.75rem;">Leave blank for normal a-la-carte restaurants. Fill in only for buffets, character meals, or shows whose per-person price is missing or wrong in the menu cache.</p>
    <div class="form-grid">
      <div>
        <label class="form-label" for="rf_override_adult">Adult price override ($ per person)</label>
        <input id="rf_override_adult" name="override_adult" value="${escapeHtml(v.override_adult)}" class="form-input" placeholder="e.g. 65.00"/>
      </div>
      <div>
        <label class="form-label" for="rf_override_child">Child price override ($ per person)</label>
        <input id="rf_override_child" name="override_child" value="${escapeHtml(v.override_child)}" class="form-input" placeholder="e.g. 42.00"/>
      </div>
    </div>

    <h3 style="margin: 1.5rem 0 0.5rem; padding-top: 1rem; border-top: 1px solid var(--border);">3. Verification &amp; Source</h3>
    <div class="form-grid">
      <div>
        <label class="form-label" for="rf_rule_status">Rule status</label>
        <select id="rf_rule_status" name="rule_status" class="form-input">${DINING_RULE_STATUSES.map((s) => option(s, s === 'verified' ? 'verified (confirmed on Disney site)' : 'unverified (assumed / third-party)', v.rule_status === s)).join('')}</select>
      </div>
      <div>
        <label class="form-label" for="rf_verified_at">Verified on</label>
        <input id="rf_verified_at" type="date" name="verified_at" value="${escapeHtml(v.verified_at)}" class="form-input"/>
        <span class="form-help">Required whenever Status is <strong>verified</strong>.</span>
      </div>
      <div style="grid-column: 1 / -1;">
        <label class="form-label" for="rf_source_note">Source note</label>
        <input id="rf_source_note" name="source_note" value="${escapeHtml(v.source_note)}" maxlength="${DINING_SOURCE_NOTE_MAX}" class="form-input" style="max-width: 100%;" placeholder="e.g. Disney Dining Plans page 2026-11-09"/>
      </div>
    </div>

    <div class="action-row" style="margin-top: 0.5rem;">
      <button type="submit" class="btn btn-secondary">Save rule</button>
      <button type="submit" name="mark_verified" value="1" class="btn">Save &amp; mark verified</button>
      <a href="${BASE}/locations" class="btn btn-secondary">Cancel</a>
    </div>
  </form>`;

  if (detail.rule !== null) {
    html += `<div class="card">
      <div class="section-header-row" style="margin-bottom: 0;">
        <div>
          <h3>Revert to Automatic Rule</h3>
          <p class="text-xs text-muted">Removes this custom rule so the restaurant falls back to its catalog-derived behavior (${escapeHtml(loc.derivedServiceType)}, 1 credit).</p>
        </div>
        <form method="POST" action="${action}/delete"><button type="submit" class="btn btn-danger">Delete rule (use the derived one)</button></form>
      </div>
    </div>`;
  }
  return html;
}

function seedOutcomeBadge(outcome: SeedEntryResult['outcome']): string {
  switch (outcome) {
    case 'inserted':
      return '<span class="badge badge-success">inserted</span>';
    case 'updated':
      return '<span class="badge badge-info">updated</span>';
    case 'kept':
      return '<span class="badge badge-neutral">kept</span>';
    case 'unmatched':
      return '<span class="badge badge-warning">unmatched</span>';
    case 'ambiguous':
      return '<span class="badge badge-danger">ambiguous</span>';
  }
}

function seedPage(results: readonly SeedEntryResult[], counts: Readonly<Record<string, number>>): string {
  let html = `<div class="action-row" style="margin-bottom: 1rem;">
    <a href="${BASE}" class="btn btn-sm btn-secondary">&larr; Back to Dining Plan</a>
    <a href="${BASE}/locations?filter=seeded_unverified" class="btn btn-sm">Review seeded &amp; unverified rules &rarr;</a>
  </div>`;
  html += explainerBanner(
    '🌱',
    'Seed Rules Applied',
    'Inserted/updated rows come from locationRules.seed.json. Any rule you already marked Verified was kept untouched. Unmatched or ambiguous entries need a catalog name check.',
  );
  html += `<div class="card">
    <h2>Summary</h2>
    <p style="margin-bottom: 1rem;">${Object.entries(counts).map(([k, n]) => `${escapeHtml(k)}: <strong>${escapeHtml(n)}</strong>`).join(' &middot; ')}</p>`;
  html += table(results, [
    { header: 'Seed entry', cell: (r) => `<strong>${escapeHtml(r.name)}</strong>` },
    { header: 'Outcome', cell: (r) => seedOutcomeBadge(r.outcome) },
    { header: 'Restaurant', cell: (r) => (r.experienceId === null ? '<span class="text-muted">-</span>' : `<a href="${BASE}/locations/${escapeHtml(r.experienceId)}">${escapeHtml(r.experienceName)}</a>`) },
    { header: 'Reason', cell: (r) => `<span class="text-xs text-muted">${escapeHtml(r.reason ?? '')}</span>` },
    { header: 'Source note', cell: (r) => `<span class="text-xs text-muted">${escapeHtml(r.sourceNote)}</span>` },
  ]);
  html += '</div>';
  return html;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerDiningPlanRoutes(fastify: FastifyInstance, options: AdminRoutesOptions): Promise<void> {
  if (!options.diningPlan) return;
  const port: AdminDiningPlanPort = options.diningPlan;

  await fastify.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8'))));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    const requireSameOrigin = async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isSameOriginRequest(request.headers)) {
        setSecurityHeaders(reply);
        return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request refused' });
      }
    };
    const post = { preHandler: [options.basicAuth, requireSameOrigin] };
    const get = { preHandler: options.basicAuth };

    /** Requirement 18.7: an unexpected error is an in-page message; the details are logged only. */
    async function safely(reply: FastifyReply, title: string, fn: () => Promise<FastifyReply>): Promise<FastifyReply> {
      setSecurityHeaders(reply);
      try {
        return await fn();
      } catch (err) {
        reply.log.error({ err, section: title }, 'admin dining plan action failed');
        return send(reply, `Error - ${title}`, `<div class="error-box"><h2>${escapeHtml(title)}</h2><p>Something went wrong; nothing more was changed. The details are in the server log.</p><p><a href="${BASE}">&larr; Back to Dining Plan</a></p></div>`, 500);
      }
    }

    scope.get(BASE, get, async (request, reply) =>
      safely(reply, 'Dining Plan Calculator', async () => {
        const query = request.query as { flash?: string; edit?: string };
        const state = await port.readState();
        const editing = query.edit === undefined ? null : (state.prices.find((p) => p.id === query.edit) ?? null);
        return send(reply, 'Dining Plan Calculator', dashboard(state, { ...(query.flash === undefined ? {} : { flash: query.flash }), priceValues: priceValuesOf(editing) }));
      }),
    );

    scope.post(`${BASE}/prices`, post, async (request, reply) =>
      safely(reply, 'Dining Plan prices', async () => {
        const form = formOf(request);
        const parsed = parsePriceForm(form);
        const result = parsed.ok ? await port.savePrice(parsed.value) : parsed;
        if (result.ok) return redirect(reply, BASE, 'Price period saved.');
        const values = Object.fromEntries(Object.keys(priceValuesOf(null)).map((k) => [k, form[k] ?? ''])) as unknown as PriceFormValues;
        return send(reply, 'Dining Plan Calculator', dashboard(await port.readState(), { errors: result.errors, priceValues: values }), 400);
      }),
    );

    scope.post(`${BASE}/prices/:id/delete`, post, async (request, reply) =>
      safely(reply, 'Dining Plan prices', async () => {
        const { id } = request.params as { id: string };
        const deleted = UUID.test(id) && (await port.deletePrice(id));
        return redirect(reply, BASE, deleted ? 'Price period deleted.' : 'That price period no longer exists.');
      }),
    );

    scope.post(`${BASE}/config`, post, async (request, reply) =>
      safely(reply, 'Dining Plan assumptions', async () => {
        const form = formOf(request);
        if (form.reset === '1') {
          await port.resetConfig();
          return redirect(reply, BASE, 'Assumptions reset to the defaults.');
        }
        const parsed = parseConfigForm(form);
        if (parsed.ok) {
          await port.saveConfig(parsed.value);
          return redirect(reply, BASE, 'Assumptions saved.');
        }
        return send(reply, 'Dining Plan Calculator', dashboard(await port.readState(), { errors: parsed.errors, openConfig: true }), 400);
      }),
    );

    scope.post(`${BASE}/seed`, post, async (_request, reply) =>
      safely(reply, 'Dining Plan seed rules', async () => {
        const result = await port.applySeed();
        if (!result.ok) return send(reply, 'Dining Plan seed rules', `<p><a href="${BASE}" class="btn btn-sm btn-secondary">&larr; Back</a></p>${errorBox([result.error])}`, 400);
        return send(reply, 'Dining Plan seed rules', seedPage(result.results, result.counts));
      }),
    );

    scope.get(`${BASE}/locations`, get, async (request, reply) =>
      safely(reply, 'Dining Plan locations', async () => {
        const query = request.query as { q?: string; filter?: string; page?: string };
        const q = (query.q ?? '').slice(0, 120);
        const filter: AdminLocationFilter = (ADMIN_LOCATION_FILTERS as readonly string[]).includes(query.filter ?? '') ? (query.filter as AdminLocationFilter) : 'all';
        const pageNo = Math.max(1, Math.min(1000, Number.parseInt(query.page ?? '1', 10) || 1));
        const page = await port.listLocations({ q, filter, limit: PAGE_SIZE, offset: (pageNo - 1) * PAGE_SIZE });
        const link = (p: number) => `${BASE}/locations?q=${encodeURIComponent(q)}&filter=${filter}&page=${p}`;
        const filterLink = (f: AdminLocationFilter) => `${BASE}/locations?q=${encodeURIComponent(q)}&filter=${f}`;
        let html = `<p style="margin-bottom: 1rem;"><a href="${BASE}" class="btn btn-sm btn-secondary">&larr; Back to Dining Plan</a></p>`;
        html += explainerBanner(
          '🔍',
          'Restaurant Credit Rules',
          'Click any restaurant name to edit its rule. Most restaurants use their automatic catalog rule (derived) and do not need manual edits — focus on 2-credit signature spots, dinner shows, or excluded lounges.',
        );
        html += `<div class="card">
          <div class="filter-pills">
            ${ADMIN_LOCATION_FILTERS.map((f) => `<a href="${escapeHtml(filterLink(f))}" class="filter-pill${f === filter ? ' active' : ''}">${escapeHtml(FILTER_LABELS[f])}</a>`).join('')}
          </div>
          <form method="GET" action="${BASE}/locations" class="action-row" style="margin-bottom: 1rem;">
            <input name="q" value="${escapeHtml(q)}" placeholder="Search restaurant name..." maxlength="120" class="form-input" style="max-width: 320px;"/>
            <select name="filter" class="form-input" style="max-width: 260px;">${ADMIN_LOCATION_FILTERS.map((f) => option(f, FILTER_LABELS[f], f === filter)).join('')}</select>
            <button type="submit" class="btn">Search</button>
            ${q !== '' || filter !== 'all' ? `<a href="${BASE}/locations" class="btn btn-secondary">Clear</a>` : ''}
          </form>
          ${
            filter === 'needs_review'
              ? '<div class="flash flash-info" style="margin-bottom: 0.9rem;"><strong>You do not need to verify all of these:</strong> Rows labeled <strong>Auto (derived)</strong> already work automatically (1 credit, or excluded for lounges) and do not show as unverified in the app. Click <a href="' +
                BASE +
                '/locations?filter=seeded_unverified">Seeded &amp; unverified</a> or <a href="' +
                BASE +
                '/locations?filter=has_rule">Custom rules only</a> to see only restaurants with custom rules.</div>'
              : ''
          }
          <p class="text-sm text-muted">${escapeHtml(page.total)} restaurant(s); page ${pageNo} of ${Math.max(1, Math.ceil(page.total / PAGE_SIZE))}.</p>`;
        html += locationsTable(page.rows);
        html += '<div class="action-row" style="margin-top: 0.75rem;">';
        if (pageNo > 1) html += `<a href="${escapeHtml(link(pageNo - 1))}" class="btn btn-sm btn-secondary">&larr; Previous</a>`;
        if (page.offset + page.rows.length < page.total) html += `<a href="${escapeHtml(link(pageNo + 1))}" class="btn btn-sm btn-secondary">Next &rarr;</a>`;
        html += '</div></div>';
        return send(reply, 'Dining Plan locations', html);
      }),
    );

    const notFound = (reply: FastifyReply) =>
      send(reply, 'Dining Plan locations', `<p><a href="${BASE}/locations">&larr; Back to locations</a></p><p>That restaurant is not in the catalog.</p>`, 404);

    scope.get(`${BASE}/locations/:experienceId`, get, async (request, reply) =>
      safely(reply, 'Dining Plan location rule', async () => {
        const { experienceId } = request.params as { experienceId: string };
        const detail = UUID.test(experienceId) ? await port.getLocation(experienceId) : null;
        if (detail === null) return notFound(reply);
        const flash = (request.query as { flash?: string }).flash;
        return send(reply, 'Dining Plan location rule', locationPage(detail, ruleValuesOf(detail.rule), flash === undefined ? {} : { flash }));
      }),
    );

    scope.post(`${BASE}/locations/:experienceId`, post, async (request, reply) =>
      safely(reply, 'Dining Plan location rule', async () => {
        const { experienceId } = request.params as { experienceId: string };
        const detail = UUID.test(experienceId) ? await port.getLocation(experienceId) : null;
        if (detail === null) return notFound(reply);
        const rawForm = formOf(request);
        const form =
          rawForm.mark_verified === '1'
            ? {
                ...rawForm,
                rule_status: 'verified',
                verified_at: (rawForm.verified_at ?? '').trim() === '' ? wdwToday() : rawForm.verified_at,
              }
            : rawForm;
        const parsed = parseRuleForm(form);
        const result = parsed.ok ? await port.saveRule(experienceId, parsed.value) : parsed;
        if (result.ok) return redirect(reply, `${BASE}/locations/${experienceId}`, 'Rule saved.');
        return send(reply, 'Dining Plan location rule', locationPage(detail, ruleValuesFromForm(form), { errors: result.errors }), 400);
      }),
    );

    scope.post(`${BASE}/locations/:experienceId/delete`, post, async (request, reply) =>
      safely(reply, 'Dining Plan location rule', async () => {
        const { experienceId } = request.params as { experienceId: string };
        if (!UUID.test(experienceId)) return notFound(reply);
        const deleted = await port.deleteRule(experienceId);
        return redirect(reply, `${BASE}/locations/${experienceId}`, deleted ? 'Rule deleted; the derived rule applies.' : 'There was no rule to delete.');
      }),
    );
  });
}
