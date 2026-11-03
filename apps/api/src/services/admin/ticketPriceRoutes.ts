/**
 * Admin Panel routes for Disney Ticket Prices management and diagnosis.
 *
 * Implements: Task 10.1
 * Validates: Requirements 11.14, 13.2, 13.10, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 21.1, 21.2, 21.8
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { escapeHtml, explainerBanner, localTime, renderPage, table } from './html.js';
import type { AdminRoutesOptions } from './routes.js';
import { isSameOriginRequest } from './sameOrigin.js';
import type { AdminDiagnoseResult } from '../ticketPrices/adminPort.js';

export async function registerTicketPriceRoutes(
  fastify: FastifyInstance,
  options: AdminRoutesOptions,
): Promise<void> {
  if (!options.ticketPrices) {
    return;
  }

  const ticketPrices = options.ticketPrices;

  const requireSameOrigin = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (!isSameOriginRequest(request.headers)) {
      reply.header('X-Robots-Tag', 'noindex, nofollow');
      return reply.status(403).send({
        error: 'Forbidden',
        message: 'Cross-origin request refused',
      });
    }
  };

  function setSecurityHeaders(reply: FastifyReply): void {
    reply.header('X-Robots-Tag', 'noindex, nofollow');
    reply.header('Cache-Control', 'private, no-store');
  }

  // ---------------------------------------------------------------------------
  // GET /admin/ticket-prices: Dashboard, cache sets, control row, actions
  // ---------------------------------------------------------------------------
  fastify.get(
    '/admin/ticket-prices',
    { preHandler: options.basicAuth },
    async (request, reply) => {
      setSecurityHeaders(reply);

      const state = await ticketPrices.readState();
      const flash = (request.query as { flash?: string }).flash;

      let html = '';

      if (flash) {
        html += `<div class="flash flash-info" style="margin-bottom: 20px; padding: 12px; background: #e0f2fe; border: 1px solid #7dd3fc; border-radius: 6px;">
          <strong>Action result:</strong> ${escapeHtml(flash)}
        </div>`;
      }

      // 1. Kill Switch & Launch Gate
      html += '<section class="admin-section" style="margin-bottom: 24px;">';
      html += '<h2>Kill Switch & Operator Gate</h2>';
      html += `<p>Status: <span class="badge ${state.enabled ? 'badge-success' : 'badge-danger'}" style="padding: 4px 8px; border-radius: 4px; font-weight: bold; background: ${state.enabled ? '#dcfce7' : '#fee2e2'}; color: ${state.enabled ? '#166534' : '#991b1b'};">${state.enabled ? 'ENABLED' : 'DISABLED'}</span></p>`;

      if (!state.enabled) {
        html += explainerBanner(
          '🔒',
          'Operator launch gate',
          'Operator launch gate: The kill switch is currently disabled. Run the Diagnose action three times at different times of day (including once after 20:00 ET) before setting TICKET_PRICES_ENABLED=true in production.',
        );
      }

      html += `<div class="decision-box" style="margin-top: 16px; padding: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
        <p><strong>Terms of Use Decision:</strong> &ldquo;lets go with optiion 1. just make the spec ill have antigravity implement it&rdquo; (2026-10-25)</p>
        <p><strong>Launch Gate:</strong> owner&#39;s written confirmation pending</p>
        <p><strong>Revisit notice:</strong> Ticket price collection was approved under option 1. If Disney alters anti-scraping controls or requests discontinuation, collection must be halted immediately.</p>
      </div>`;
      html += '</section>';

      // 2. Action Controls
      html += '<section class="admin-section" style="margin-bottom: 24px;">';
      html += '<h2>Actions</h2>';
      html += '<div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">';
      html += `<form method="POST" action="/admin/ticket-prices/refresh">
        <button type="submit" class="btn btn-primary" style="padding: 8px 16px; cursor: pointer;">Refresh now</button>
      </form>`;
      html += `<form method="POST" action="/admin/ticket-prices/diagnose">
        <button type="submit" class="btn btn-secondary" style="padding: 8px 16px; cursor: pointer;">Diagnose</button>
      </form>`;
      html += `<form method="POST" action="/admin/ticket-prices/block">
        <button type="submit" class="btn btn-danger" style="padding: 8px 16px; cursor: pointer; background: #dc2626; color: white; border: none; border-radius: 4px;">Block now</button>
      </form>`;
      html += '</div>';
      html += '</section>';

      // 3. Database & Storage Summary
      html += '<section class="admin-section" style="margin-bottom: 24px;">';
      html += '<h2>Database Storage</h2>';
      html += `<p>Total cached price rows: <strong>${escapeHtml(state.totalRows)}</strong></p>`;
      html += `<p>Table size (pg_total_relation_size): <strong>${escapeHtml(state.tableSize)}</strong></p>`;
      html += '</section>';

      // 4. Control Row
      html += '<section class="admin-section" style="margin-bottom: 24px;">';
      html += '<h2>Ticket Price Control Row</h2>';
      const controlRows = [state.control];
      html += table(controlRows, [
        { header: 'Last Attempt At', cell: (c) => localTime(c.lastAttemptAt) },
        { header: 'Last Probe At', cell: (c) => localTime(c.lastProbeAt) },
        { header: 'Blocked Until', cell: (c) => localTime(c.blockedUntil) },
        { header: 'In Progress Since', cell: (c) => localTime(c.inProgressSince) },
        { header: 'Observed Horizon', cell: (c) => escapeHtml(c.observedHorizonDate ?? '-') },
        { header: 'Last Diagnose At', cell: (c) => localTime(c.lastDiagnoseAt) },
        { header: 'Last Status', cell: (c) => escapeHtml(c.lastStatus ?? '-') },
        { header: 'Last Error', cell: (c) => escapeHtml(c.lastError ?? '-') },
      ]);
      html += '</section>';

      // 5. Ticket Price Sets
      html += '<section class="admin-section" style="margin-bottom: 24px;">';
      html += '<h2>Ticket Price Sets</h2>';
      html += table(state.sets, [
        { header: 'Group', cell: (s) => escapeHtml(s.discountGroup) },
        { header: 'Days', cell: (s) => escapeHtml(s.numDays) },
        { header: 'As Of', cell: (s) => localTime(s.asOf) },
        { header: 'Horizon Date', cell: (s) => escapeHtml(s.horizonDate ?? '-') },
        { header: 'Row Count', cell: (s) => escapeHtml(s.rowCount) },
        { header: 'Window Days', cell: (s) => escapeHtml(s.windowDays ?? '-') },
        { header: 'Last Error', cell: (s) => escapeHtml(s.lastError ?? '-') },
      ]);
      html += '</section>';

      // 6. Configuration
      html += '<section class="admin-section" style="margin-bottom: 24px;">';
      html += '<h2>Resolved Configuration</h2>';
      const configRows = Object.entries(state.config).map(([key, value]) => ({ key, value: String(value) }));
      html += table(configRows, [
        { header: 'Parameter', cell: (r) => escapeHtml(r.key) },
        { header: 'Value', cell: (r) => escapeHtml(r.value) },
      ]);
      html += '</section>';

      return reply.type('text/html; charset=utf-8').send(renderPage('Disney Ticket Prices', html, '/admin/ticket-prices'));
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/ticket-prices/refresh: Run refresh now (bypass attempt cooldown)
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/ticket-prices/refresh',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (_request, reply) => {
      setSecurityHeaders(reply);
      const res = await ticketPrices.runNow();
      const flashMsg = res.outcome === 'blocked' ? `blocked until ${res.blockedUntil ?? ''}` : res.outcome;
      return reply.redirect(`/admin/ticket-prices?flash=${encodeURIComponent(flashMsg)}`);
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/ticket-prices/diagnose: Run diagnostic probe without writing rows
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/ticket-prices/diagnose',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (_request, reply) => {
      setSecurityHeaders(reply);
      const res = await ticketPrices.diagnose();

      let html = '<div style="margin-bottom: 20px;"><a href="/admin/ticket-prices">&larr; Back to Ticket Prices</a></div>';

      if ('refused' in res) {
        let msg = `Diagnostic refused: ${res.refused}`;
        if (res.refused === 'blocked') {
          msg += ` (blocked until ${res.blockedUntil ?? ''})`;
        } else if (res.refused === 'too_soon') {
          msg += ' (must wait 60s between diagnose runs)';
        } else if (res.refused === 'already_running') {
          msg += ' (a refresh run is already in progress)';
        }
        html += `<div class="flash flash-error" style="padding: 16px; background: #fee2e2; border: 1px solid #f87171; border-radius: 6px;">
          <h3>Refused</h3>
          <p>${escapeHtml(msg)}</p>
        </div>`;
      } else {
        html += '<h2>Diagnostic Results</h2>';
        const diagResult = res as AdminDiagnoseResult;
        if (diagResult.failure) {
          html += `<div class="flash flash-error" style="margin-bottom: 16px; padding: 12px; background: #fee2e2; border: 1px solid #f87171; border-radius: 6px;">
            <strong>Diagnostic Error:</strong> Call ${escapeHtml(diagResult.failure.call)} failed with error code ${escapeHtml(diagResult.failure.code)}.
          </div>`;
        }
        const resultRows = [
          { item: 'Token Status', detail: String(diagResult.token.status) },
          { item: 'Token Latency', detail: `${diagResult.token.ms}ms` },
          { item: 'Token Body Bytes', detail: `${diagResult.token.bytes} bytes` },
          { item: 'Prices Status', detail: String(diagResult.prices.status) },
          { item: 'Prices Latency', detail: `${diagResult.prices.ms}ms` },
          { item: 'Prices Body Bytes', detail: `${diagResult.prices.bytes} bytes` },
          { item: 'Start Date Sent', detail: diagResult.prices.startDateSent },
          { item: 'Start Date Retried', detail: String(diagResult.prices.retried) },
          { item: 'WAF Marker Detected', detail: String(diagResult.prices.wafMarker) },
          { item: 'Max Pricing Calendar Date', detail: diagResult.maxPricingCalendarDate ?? '-' },
          { item: 'Adult MK 1-Day Price', detail: diagResult.adultMk1DayPriceCents ? `$${(diagResult.adultMk1DayPriceCents / 100).toFixed(2)}` : '-' },
          { item: 'Diagnostic Failure', detail: diagResult.failure ? `${diagResult.failure.call} (${diagResult.failure.code})` : 'none' },
        ];
        html += table(resultRows, [
          { header: 'Diagnostic Item', cell: (r) => escapeHtml(r.item) },
          { header: 'Value', cell: (r) => escapeHtml(r.detail) },
        ]);
      }

      return reply.type('text/html; charset=utf-8').send(renderPage('Ticket Prices Diagnose', html, '/admin/ticket-prices'));
    },
  );

  // ---------------------------------------------------------------------------
  // POST /admin/ticket-prices/block: Instant circuit breaker
  // ---------------------------------------------------------------------------
  fastify.post(
    '/admin/ticket-prices/block',
    { preHandler: [options.basicAuth, requireSameOrigin] },
    async (_request, reply) => {
      setSecurityHeaders(reply);
      const res = await ticketPrices.blockNow();
      return reply.redirect(`/admin/ticket-prices?flash=${encodeURIComponent(`blocked until ${res.blockedUntil}`)}`);
    },
  );
}