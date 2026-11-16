/**
 * Admin_Panel "Pins & Achievements" console, global reconcile action, and
 * read-only Series 1 Visual Catalogue serving (`/admin/pins`,
 * `/admin/pins/reconcile`, `/admin/pins/catalog`).
 *
 * Validates: Requirements 1, 2, 21.1, 21.2, 21.3, 21.4; Property 12
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PINS } from '@dwt/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import {
  formatCriteriaSummary,
  type PinSetHealthRow,
  type PinSetHealthStatus,
} from '../pins/evaluator.js';
import { escapeHtml, explainerBanner, renderPage, table } from './html.js';
import type { PinSystemSummary } from './repo.js';
import { renderAdminSection, type AdminRoutesOptions } from './routes.js';
import { isSameOriginRequest } from './sameOrigin.js';

export const PIN_ADMIN_BASE = '/admin/pins';

const COMPANION_SCRIPTS = [
  'motifs/motif-paths.js',
  'pins-v2-transcription.js',
  'pin-descriptions.js',
] as const;

const DEFAULT_PIN_CATALOG_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  '..',
  '.kiro',
  'specs',
  'pin-collection',
);

const CATALOG_BACK_BAR = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 20px;background:#111827;border-bottom:1px solid #1f293d;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;font-size:13px;">
  <div>
    <a href="/admin/pins" style="color:#93c5fd;text-decoration:none;font-weight:600;">&larr; Back to Pins &amp; Achievements Console</a>
    <span style="margin-left:12px;color:#94a3b8;">Series 1 Visual Catalogue (Read-Only Spec Mockup)</span>
  </div>
  <a href="/admin" style="color:#94a3b8;text-decoration:none;">Admin Overview</a>
</div>`.trim();

function setSecurityHeaders(reply: FastifyReply): void {
  reply.header('X-Robots-Tag', 'noindex, nofollow');
  reply.header('Cache-Control', 'private, no-store');
}

function renderSetStatusBadge(status: PinSetHealthStatus): string {
  switch (status) {
    case 'ok':
      return '<span class="badge badge-success">OK</span>';
    case 'partial':
      return '<span class="badge badge-warning">Partial</span>';
    case 'empty':
      return '<span class="badge badge-danger">Empty</span>';
  }
}

function formatBreakdown(record: Readonly<Record<string, number>>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return '-';
  return entries.map(([k, v]) => `${escapeHtml(k)}: ${v}`).join(' · ');
}

function renderSummaryCards(summary: PinSystemSummary): string {
  const okCount = summary.setHealth.filter((s) => s.status === 'ok').length;
  const partialCount = summary.setHealth.filter((s) => s.status === 'partial').length;
  const emptyCount = summary.setHealth.filter((s) => s.status === 'empty').length;
  const claimedPct =
    summary.totalUnlocked > 0 ? Math.round((summary.totalClaimed / summary.totalUnlocked) * 100) : 0;

  return `
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Series 1 Catalog</div>
        <div class="metric-val">${summary.catalogTotal} Pins</div>
        <div class="metric-sub">${formatBreakdown(summary.byTier)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Track Distribution</div>
        <div class="metric-val">${Object.keys(summary.byTrack).length} Tracks</div>
        <div class="metric-sub">${formatBreakdown(summary.byTrack)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Named Set Health</div>
        <div class="metric-val">${summary.setTotal} Sets</div>
        <div class="metric-sub">${okCount} OK · ${partialCount} Partial · ${emptyCount} Empty</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Active Users</div>
        <div class="metric-val">${summary.activeUsers}</div>
        <div class="metric-sub">${summary.usersWithUnlockedPins} with &ge;1 unlocked pin</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Live Pin Awards</div>
        <div class="metric-val">${summary.totalUnlocked} Unlocked</div>
        <div class="metric-sub">${summary.totalClaimed} claimed (${claimedPct}%)</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Pin Showcases</div>
        <div class="metric-val">${summary.showcasePlacements} Placements</div>
        <div class="metric-sub">${summary.showcaseUsers} active user boards</div>
      </div>
    </div>
  `;
}

function renderPinsConsoleHtml(summary: PinSystemSummary, hasPinRepo: boolean): string {
  const awardMap = new Map(summary.awardsByPin.map((row) => [row.pinId, row]));

  const setHealthTable = table<PinSetHealthRow>(summary.setHealth, [
    { header: 'Set ID', cell: (row) => `<code>${escapeHtml(row.setId)}</code>` },
    { header: 'Kind', cell: (row) => `<span class="badge badge-info">${escapeHtml(row.kind)}</span>` },
    { header: 'Status', cell: (row) => renderSetStatusBadge(row.status) },
    {
      header: 'Matched',
      cell: (row) =>
        row.expectedCount !== null
          ? `${row.matchedCount} / ${row.expectedCount}`
          : String(row.matchedCount),
    },
    {
      header: 'Missing Curated IDs',
      cell: (row) =>
        row.missingIds.length === 0
          ? '-'
          : row.missingIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(', '),
    },
    {
      header: 'Sample Experiences',
      cell: (row) =>
        row.sampleNames.length === 0
          ? '-'
          : row.sampleNames.map((n) => escapeHtml(n)).join(', '),
    },
    {
      header: 'Referencing Pins',
      cell: (row) =>
        row.referencingPinIds.length === 0
          ? '-'
          : row.referencingPinIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(', '),
    },
  ]);

  const pinCatalogTable = table(PINS, [
    { header: 'Pin ID', cell: (pin) => `<code>${escapeHtml(pin.id)}</code>` },
    { header: 'Name', cell: (pin) => `<strong>${escapeHtml(pin.name)}</strong>` },
    { header: 'Track', cell: (pin) => escapeHtml(pin.track) },
    { header: 'Tier', cell: (pin) => escapeHtml(pin.tier) },
    { header: 'Criteria', cell: (pin) => escapeHtml(formatCriteriaSummary(pin.criteria)) },
    { header: 'Description', cell: (pin) => escapeHtml(pin.description) },
    {
      header: 'Unlocked',
      cell: (pin) => String(awardMap.get(pin.id)?.unlockedCount ?? 0),
    },
    {
      header: 'Claimed',
      cell: (pin) => String(awardMap.get(pin.id)?.claimedCount ?? 0),
    },
  ]);

  const reconcileButton = hasPinRepo
    ? `<form method="POST" action="/admin/pins/reconcile" style="margin: 0;">
         <button type="submit" class="btn btn-secondary">Trigger Global Pin Reconciliation</button>
       </form>`
    : `<span class="badge badge-neutral">Reconcile disabled (PinRepo not configured)</span>`;

  return `
    ${explainerBanner(
      '🏅',
      'Pins & Achievements Console',
      'Inspect Series 1 pin definitions, live unlock/claim/showcase adoption across active accounts, and curated/facet set resolution against active catalog experiences.',
    )}
    <div class="card">
      <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <a href="/admin/pins/catalog" class="btn">🎨 Browse Visual Catalogue</a>
          <span class="text-muted">Read-only Series 1 SVG artwork &amp; pin specification preview</span>
        </div>
        ${reconcileButton}
      </div>
    </div>
    ${renderSummaryCards(summary)}
    <div class="card">
      <h2>Named Set Resolution Health (${summary.setHealth.length} Sets)</h2>
      <p class="text-muted" style="margin-bottom: 1rem;">
        Checks each named set in <code>PIN_SETS</code> against active catalog experiences. Partial or empty sets indicate inactive or missing upstream experiences.
      </p>
      ${setHealthTable}
    </div>
    <div class="card">
      <h2>Series 1 Pin Catalog &amp; Live Awards (${PINS.length} Pins)</h2>
      <p class="text-muted" style="margin-bottom: 1rem;">
        Full Series 1 pin roster paired with live unlock and claim counts across active accounts.
      </p>
      ${pinCatalogTable}
    </div>
  `;
}

function injectCatalogBackBar(rawHtml: string): string {
  if (/<body([^>]*)>/i.test(rawHtml)) {
    return rawHtml.replace(
      /<body([^>]*)>/i,
      (_match, attrs: string) => `<body${attrs}>\n${CATALOG_BACK_BAR}`,
    );
  }
  return `${CATALOG_BACK_BAR}\n${rawHtml}`;
}

export async function registerPinRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): Promise<void> {
  const catalogDir = options.pinCatalogDir ?? DEFAULT_PIN_CATALOG_DIR;

  await fastify.register(async (scope) => {
    scope.addHook('preHandler', options.basicAuth);

    scope.get(PIN_ADMIN_BASE, async (_request, reply) => {
      setSecurityHeaders(reply);
      await renderAdminSection(reply, 'Pins & Achievements', async () => {
        const summary = await options.repo.getPinSystemSummary();
        return renderPinsConsoleHtml(summary, Boolean(options.pinRepo));
      });
      return reply;
    });

    scope.post(`${PIN_ADMIN_BASE}/reconcile`, async (request, reply) => {
      setSecurityHeaders(reply);
      if (!isSameOriginRequest(request.headers)) {
        const html = renderPage(
          'Forbidden - Pin Reconciliation',
          `<div class="error-box">
            <h2>Cross-origin request rejected</h2>
            <p>Global pin reconciliation requires a same-origin POST request.</p>
            <p><a href="${PIN_ADMIN_BASE}">&larr; Back to Pins &amp; Achievements</a></p>
          </div>`,
          PIN_ADMIN_BASE,
        );
        return reply.type('text/html; charset=utf-8').status(403).send(html);
      }

      await renderAdminSection(reply, 'Pin Reconciliation', async () => {
        if (!options.pinRepo) {
          return `
            <div class="card">
              <h2>Global Pin Reconciliation Unavailable</h2>
              <p class="text-muted">The Pin repository is not configured in this environment, so reconciliation could not run.</p>
              <p style="margin-top: 1rem;"><a href="${PIN_ADMIN_BASE}" class="btn">&larr; Back to Pins &amp; Achievements</a></p>
            </div>
          `;
        }
        const res = await options.pinRepo.reconcileAll();
        return `
          ${explainerBanner(
            '✅',
            'Global Pin Reconciliation Complete',
            'Historical completions across accounts have been re-evaluated against Series 1 challenges.',
          )}
          <div class="card">
            <h2>Reconciliation Summary</h2>
            <p>Processed <strong>${res.usersProcessed}</strong> user(s) and awarded <strong>${res.pinsAwarded}</strong> new pin(s).</p>
            <p style="margin-top: 1rem;"><a href="${PIN_ADMIN_BASE}" class="btn">&larr; Back to Pins &amp; Achievements</a></p>
          </div>
        `;
      });
      return reply;
    });

    async function serveCatalog(_request: unknown, reply: FastifyReply): Promise<FastifyReply> {
      setSecurityHeaders(reply);
      const htmlPath = join(catalogDir, 'pin-catalog-mockup.html');
      try {
        const rawHtml = await readFile(htmlPath, 'utf8');
        return reply
          .type('text/html; charset=utf-8')
          .status(200)
          .send(injectCatalogBackBar(rawHtml));
      } catch {
        const html = renderPage(
          'Visual Catalogue Not Found',
          `<div class="error-box">
            <h2>Visual Catalogue Unavailable</h2>
            <p>The read-only Series 1 visual catalogue file could not be read on disk.</p>
            <p><a href="${PIN_ADMIN_BASE}">&larr; Back to Pins &amp; Achievements</a></p>
          </div>`,
          PIN_ADMIN_BASE,
        );
        return reply.type('text/html; charset=utf-8').status(404).send(html);
      }
    }

    scope.get(`${PIN_ADMIN_BASE}/catalog`, serveCatalog);
    scope.get(`${PIN_ADMIN_BASE}/catalog/`, serveCatalog);

    for (const scriptPath of COMPANION_SCRIPTS) {
      const handler = async (_request: unknown, reply: FastifyReply): Promise<FastifyReply> => {
        setSecurityHeaders(reply);
        const fullPath = join(catalogDir, scriptPath);
        try {
          const js = await readFile(fullPath, 'utf8');
          return reply.type('application/javascript; charset=utf-8').status(200).send(js);
        } catch {
          return reply.type('text/plain; charset=utf-8').status(404).send('Not found');
        }
      };

      scope.get(`${PIN_ADMIN_BASE}/${scriptPath}`, handler);
      scope.get(`${PIN_ADMIN_BASE}/catalog/${scriptPath}`, handler);
    }
  });
}
