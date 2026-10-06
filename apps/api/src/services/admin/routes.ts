/**
 * Admin Panel routes and navigation shell.
 *
 * Validates: Requirements 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
 */

import type { FastifyPluginAsync, FastifyReply, preHandlerHookHandler } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { errorCodeToHttpStatus, PINS } from '@dwt/shared';
import type { AppConfig } from '../../config.js';
import { escapeHtml, flagged, renderPage, table, explainerBanner, progressBar } from './html.js';
import {
  type AdminRepo,
  SAMPLING_HEALTH_STALE_MINUTES,
  NEON_FREE_TIER_BYTES,
  UPSTASH_FREE_TIER_DAILY_COMMANDS,
} from './repo.js';
import type { CatalogRepo } from '../catalog/repo.js';
import type { IntelligenceRepo } from '../intelligence/IntelligenceRepo.js';
import type { PinRepo } from '../pins/repo.js';

export interface RateLimiterBucketSnapshot {
  readonly currentRps: number;
  readonly maxRps: number;
  readonly currentConcurrency: number;
  readonly maxConcurrency: number;
}

export interface RateLimiterSnapshot {
  readonly syncGateway: RateLimiterBucketSnapshot;
  readonly web: RateLimiterBucketSnapshot;
}

export interface DirectorySnapshot {
  readonly builtAtMs: number | null;
  readonly entryCount: number;
  readonly ttlMs: number;
}

export interface AdminRoutesOptions {
  readonly repo: AdminRepo;
  readonly catalogRepo?: CatalogRepo;
  readonly intelligenceRepo?: IntelligenceRepo;
  readonly pinRepo?: PinRepo;
  readonly config?: AppConfig;
  readonly runCatalogSync?: () => Promise<void>;
  readonly isSyncInProgress?: () => Promise<boolean>;
  readonly getRateLimiterSnapshot?: () => Promise<RateLimiterSnapshot>;
  readonly getDirectorySnapshot?: () => Promise<DirectorySnapshot>;
  readonly basicAuth: preHandlerHookHandler;
}

export interface AdminSectionLink {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly icon: string;
  readonly badge: string;
}

export const ADMIN_SECTIONS: readonly AdminSectionLink[] = [
  {
    path: '/admin/catalog',
    title: 'Catalog & Disney Sync',
    description: 'Catalog sync history, cache staleness, data quality checks, and manual sync trigger.',
    category: 'Data Ingestion & External Sync',
    icon: '🔄',
    badge: 'Disney Facilities & Menus',
  },
  {
    path: '/admin/disney-transport',
    title: 'Disney Transport & Rate Limiter',
    description: 'Disney egress budget, dispatch/concurrency counters, and ThemeParks directory cache.',
    category: 'Data Ingestion & External Sync',
    icon: '⚡',
    badge: 'Egress & Entity Cache',
  },
  {
    path: '/admin/intelligence/sampling',
    title: 'Sampling Pass Health',
    description: 'Sampling run history, recent execution status, and unmapped entities sample.',
    category: 'Data Ingestion & External Sync',
    icon: '⏱️',
    badge: '10m Live Poller',
  },
  {
    path: '/admin/intelligence/accuracy',
    title: 'Forecast Accuracy',
    description: 'Park and Experience-level wait time forecast MAE, bias, and historical logs.',
    category: 'Predictive Intelligence & Models',
    icon: '🎯',
    badge: 'MAE & Model Bias',
  },
  {
    path: '/admin/intelligence/model',
    title: 'Intelligence Model Internals',
    description: 'Park crowd index history, ride baseline coverage, weather sensitivities, cascades, and show patterns.',
    category: 'Predictive Intelligence & Models',
    icon: '🧠',
    badge: 'Baselines & Cascades',
  },
  {
    path: '/admin/intelligence/derived-stats',
    title: 'Derived Stats Health',
    description: 'Derived statistics calculation job status, last error, and consecutive failure counts.',
    category: 'Predictive Intelligence & Models',
    icon: '📊',
    badge: 'Nightly Batch Jobs',
  },
  {
    path: '/admin/infra',
    title: 'Infrastructure Budget',
    description: 'Postgres database storage consumption and Upstash Redis daily command budget.',
    category: 'Infrastructure & System Health',
    icon: '💾',
    badge: 'Neon & Upstash Caps',
  },
  {
    path: '/admin/notifications',
    title: 'Push Delivery Visibility',
    description: 'Recent Expo push notification deliveries, breakdown by status, and 24h summary.',
    category: 'Infrastructure & System Health',
    icon: '🔔',
    badge: 'Expo Notifications',
  },
  {
    path: '/admin/config',
    title: 'Configuration',
    description: 'Resolved non-secret system and Disney transport configuration values.',
    category: 'Infrastructure & System Health',
    icon: '⚙️',
    badge: 'System Parameters',
  },
  {
    path: '/admin/users',
    title: 'User & Support Lookup',
    description: 'Case-insensitive user search by email, activity totals, and session revocation.',
    category: 'User Operations & Security',
    icon: '👤',
    badge: 'Customer Support',
  },
  {
    path: '/admin/accounts/lockouts',
    title: 'Account Lockouts',
    description: 'Active login lockout states and manual operator unlock trigger.',
    category: 'User Operations & Security',
    icon: '🔒',
    badge: 'Security & Brute-Force',
  },
  {
    path: '/admin/growth',
    title: 'Growth & Activity',
    description: 'High-level activity totals and trailing 7-day daily activity trends.',
    category: 'User Operations & Security',
    icon: '📈',
    badge: 'Platform Trends',
  },
];

/**
 * Renders an admin page with section-aware error handling.
 * Catches unhandled errors and renders generic HTML error page,
 * ensuring no raw stack traces or database errors leak (Requirement 2.3).
 */
export async function renderAdminSection(
  reply: FastifyReply,
  sectionTitle: string,
  generateHtml: () => Promise<string> | string,
): Promise<void> {
  try {
    const bodyHtml = await generateHtml();
    const currentPath = (reply as unknown as { request?: { url?: string } }).request?.url?.split('?')[0];
    const html = renderPage(sectionTitle, bodyHtml, currentPath);
    reply.type('text/html; charset=utf-8').status(200).send(html);
  } catch (err: unknown) {
    // Requirement 2.3 hides the raw error from the browser, but the Operator
    // still needs to find it — without this, a 500 produces no diagnostic
    // trail anywhere (confirmed: these errors were previously logged nowhere,
    // not even at warn/error level, leaving only the bare status code in the
    // latency log).
    reply.log.error({ err, section: sectionTitle }, 'admin section render failed');
    if (err instanceof AppError) {
      const status = errorCodeToHttpStatus[err.code] ?? 500;
      const html = renderPage(
        `Error - ${sectionTitle}`,
        `<div class="error-box">
          <h2>Error: ${escapeHtml(sectionTitle)}</h2>
          <p><strong>Code:</strong> <code>${escapeHtml(err.code)}</code></p>
          <p>${escapeHtml(err.message)}</p>
          <p><a href="/admin">&larr; Back to Admin Overview</a></p>
        </div>`,
      );
      reply.type('text/html; charset=utf-8').status(status).send(html);
      return;
    }

    const html = renderPage(
      `Error - ${sectionTitle}`,
      `<div class="error-box">
        <h2>Error: ${escapeHtml(sectionTitle)}</h2>
        <p>An unexpected error occurred while rendering this section.</p>
        <p><a href="/admin">&larr; Back to Admin Overview</a></p>
      </div>`,
    );
    reply.type('text/html; charset=utf-8').status(500).send(html);
  }
}

export function adminRoutes(options: AdminRoutesOptions): FastifyPluginAsync {
  return async function adminPlugin(fastify) {
    // Requirement 2.4: Ensure X-Robots-Tag: noindex, nofollow is attached to every response in this plugin
    fastify.addHook('onSend', async (_request, reply) => {
      void reply.header('X-Robots-Tag', 'noindex, nofollow');
    });

    // Requirement 2.3: Catch unhandled errors escaping route handlers and render generic HTML
    fastify.setErrorHandler((error, request, reply) => {
      void reply.header('X-Robots-Tag', 'noindex, nofollow');
      request.log.error({ err: error, route: request.url }, 'admin route error');
      if (error instanceof AppError) {
        const status = errorCodeToHttpStatus[error.code] ?? 500;
        const html = renderPage(
          'Error',
          `<div class="error-box">
            <h2>Error</h2>
            <p><strong>Code:</strong> <code>${escapeHtml(error.code)}</code></p>
            <p>${escapeHtml(error.message)}</p>
            <p><a href="/admin">&larr; Back to Admin Overview</a></p>
          </div>`,
        );
        reply.type('text/html; charset=utf-8').status(status).send(html);
        return;
      }

      const html = renderPage(
        'Error',
        `<div class="error-box">
          <h2>Error</h2>
          <p>An unexpected error occurred while processing your request.</p>
          <p><a href="/admin">&larr; Back to Admin Overview</a></p>
        </div>`,
      );
      reply.type('text/html; charset=utf-8').status(500).send(html);
    });

    // -------------------------------------------------------------------------
    // GET /admin — Requirement 2.1 (Navigation Landing Page)
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Admin Overview', () => {
          const categories = [
            {
              name: 'Data Ingestion & External Sync',
              icon: '🔄',
              desc: 'Disney static facility synchronization, rate limit budgets, and 10-minute live polling health.',
            },
            {
              name: 'Predictive Intelligence & Models',
              icon: '🧠',
              desc: 'Machine learning wait time accuracy, ride baselines, weather adjustments, and nightly batch stats.',
            },
            {
              name: 'Infrastructure & System Health',
              icon: '⚡',
              desc: 'Resource consumption against free-tier storage/command caps, push notification delivery, and configs.',
            },
            {
              name: 'User Operations & Security',
              icon: '👥',
              desc: 'Customer support lookup, account lockouts, session revocation, and engagement activity trends.',
            },
          ];

          const categorySectionsHtml = categories.map((cat) => {
            const sections = ADMIN_SECTIONS.filter((s) => s.category === cat.name);
            const cardsHtml = sections.map((sec) => `
              <div class="section-card">
                <div class="section-card-top">
                  <div class="section-card-header">
                    <span class="section-card-icon">${sec.icon}</span>
                    <h3 class="section-card-title">
                      <a href="${escapeHtml(sec.path)}">${escapeHtml(sec.title)}</a>
                    </h3>
                  </div>
                  <p class="section-card-desc">${escapeHtml(sec.description)}</p>
                </div>
                <div class="section-card-footer">
                  <span class="section-card-badge">${escapeHtml(sec.badge)}</span>
                  <a href="${escapeHtml(sec.path)}" class="section-card-cta">Open Console &rarr;</a>
                </div>
              </div>
            `).join('\n');

            return `
              <section class="category-section">
                <div class="category-header">
                  <span class="category-icon">${cat.icon}</span>
                  <span class="category-title">${escapeHtml(cat.name)}</span>
                  <span class="category-desc">${escapeHtml(cat.desc)}</span>
                </div>
                <div class="sections-grid">
                  ${cardsHtml}
                </div>
              </section>
            `;
          }).join('\n');

          return `
            <div class="dashboard-hero">
              <h1>Admin Panel</h1>
              <p>Operational observability, infrastructure health, and administrative controls.</p>
              <div class="hero-stats-row">
                <div class="hero-stat">
                  <span class="hero-stat-icon">🔄</span>
                  <div class="hero-stat-text">
                    <span class="hero-stat-title">Data Ingestion</span>
                    <span class="hero-stat-desc">Disney Sync & Live Sampling</span>
                  </div>
                </div>
                <div class="hero-stat">
                  <span class="hero-stat-icon">🧠</span>
                  <div class="hero-stat-text">
                    <span class="hero-stat-title">Predictive AI</span>
                    <span class="hero-stat-desc">Forecasts & Ride Baselines</span>
                  </div>
                </div>
                <div class="hero-stat">
                  <span class="hero-stat-icon">⚡</span>
                  <div class="hero-stat-text">
                    <span class="hero-stat-title">Infrastructure</span>
                    <span class="hero-stat-desc">Neon & Upstash Budget Quotas</span>
                  </div>
                </div>
                <div class="hero-stat">
                  <span class="hero-stat-icon">👥</span>
                  <div class="hero-stat-text">
                    <span class="hero-stat-title">User Operations</span>
                    <span class="hero-stat-desc">Security, Support & Growth</span>
                  </div>
                </div>
              </div>
            </div>
            ${categorySectionsHtml}
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 3: Catalog & Disney Sync Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/catalog',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Catalog & Disney Sync', async () => {
          const cacheInfo = options.catalogRepo ? await options.catalogRepo.getCacheAge() : null;
          const cacheAgeDisplay =
            cacheInfo === null || cacheInfo.hours === null
              ? 'No cache recorded'
              : `${cacheInfo.hours.toFixed(2)} hours ago (last synced ${cacheInfo.lastSuccessfulSyncAt ? new Date(cacheInfo.lastSuccessfulSyncAt).toISOString() : '-'})`;

          const syncRuns = await options.repo.getRecentSyncRuns(20);
          const dataQuality = await options.repo.getCatalogDataQuality();

          const syncConfig = options.config?.disney;
          const configHtml = `
            <div class="card">
              <h2>Sync Configuration</h2>
              <div class="metric-grid">
                <div class="metric-card">
                  <div class="metric-label">Sync Interval</div>
                  <div class="metric-val" style="font-size: 1.1rem;">${syncConfig?.syncIntervalMs ?? 86400000} ms</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Menu Freshness</div>
                  <div class="metric-val" style="font-size: 1.1rem;">${syncConfig?.menuFreshnessMs ?? 86400000} ms</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Max Outbound RPS</div>
                  <div class="metric-val" style="font-size: 1.1rem;">${syncConfig?.requestBudget.maxRequestsPerSecond ?? 5} req/s</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Max Concurrency</div>
                  <div class="metric-val" style="font-size: 1.1rem;">${syncConfig?.requestBudget.maxConcurrency ?? 4}</div>
                </div>
              </div>
              <p class="text-muted" style="font-size: 0.85rem; margin-top: 0.5rem;">
                Backoff Policy: Base ${syncConfig?.backoff.baseDelayMs ?? 500}ms, factor ${syncConfig?.backoff.factor ?? 2},
                max delay ${syncConfig?.backoff.maxDelayMs ?? 30000}ms, max retries ${syncConfig?.backoff.maxRetries ?? 5}.
              </p>
            </div>
          `;

          const qualityHtml = `
            <div class="card">
              <h2>Data Quality Checks</h2>
              <div class="metric-grid">
                <div class="metric-card">
                  <div class="metric-label">Missing Image URL</div>
                  <div class="metric-val">${dataQuality.missingImageUrlCount}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Missing Lat/Long</div>
                  <div class="metric-val">${dataQuality.missingCoordinatesCount}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Unresolved Entity ID</div>
                  <div class="metric-val">${dataQuality.unresolvedEntityCount}</div>
                </div>
              </div>
            </div>
          `;

          const triggerHtml = `
            <div class="card" style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <h3 style="margin-bottom: 0.25rem;">Manual Catalog Sync</h3>
                <p class="text-muted" style="font-size: 0.85rem;">Initiates asynchronous static facility and dining catalog synchronization.</p>
              </div>
              <form method="POST" action="/admin/catalog/sync">
                <button type="submit" class="btn">Trigger Manual Sync</button>
              </form>
            </div>
          `;

          const runsTable = table(syncRuns, [
            { header: 'Status', cell: (r) => escapeHtml(r.status) },
            {
              header: 'Outcome',
              cell: (r) => {
                const isFlagged = r.outcome === 'waf_block' || r.outcome === 'auth_failure';
                const badge = flagged(isFlagged, r.outcome ?? 'unknown');
                return badge || escapeHtml(r.outcome ?? '-');
              },
            },
            {
              header: 'Started At',
              cell: (r) => `<span class="mono">${escapeHtml(String(r.started_at))}</span>`,
            },
            {
              header: 'Completed At',
              cell: (r) => (r.completed_at ? `<span class="mono">${escapeHtml(String(r.completed_at))}</span>` : '-'),
            },
            {
              header: 'Entities',
              cell: (r) => escapeHtml(r.entities_processed ?? '-'),
            },
            {
              header: 'Error Message',
              cell: (r) => (r.error_message ? `<span class="mono text-muted">${escapeHtml(r.error_message)}</span>` : '-'),
            },
          ]);

          return `
            ${explainerBanner(
              '🔄',
              'Catalog & Disney Sync Overview',
              'Monitors synchronization of static Walt Disney World facilities, dining menus, and operational entities into PostgreSQL. Disney provides official facility structures; ThemeParks.wiki powers real-time wait times.',
            )}
            <h2>Catalog & Sync Health</h2>
            <div class="metric-card" style="margin-bottom: 1.5rem;">
              <div class="metric-label">Current Catalog Cache Age</div>
              <div class="metric-val" style="font-size: 1.25rem;">${escapeHtml(cacheAgeDisplay)}</div>
            </div>
            ${triggerHtml}
            ${qualityHtml}
            ${configHtml}
            <div class="card">
              <h2>Recent Sync Runs (Last 20)</h2>
              ${runsTable}
            </div>
          `;
        });
      },
    );

    fastify.post(
      '/admin/catalog/sync',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        const inProgress = options.isSyncInProgress ? await options.isSyncInProgress() : false;
        if (inProgress) {
          throw new AppError(
            'admin_sync_already_running',
            'A catalog sync is currently running. Second sync request rejected.',
          );
        }

        if (options.runCatalogSync) {
          void options.runCatalogSync().catch(() => {});
        }

        const html = renderPage(
          'Sync Triggered',
          `<div class="card">
            <h2>Catalog Sync Initiated</h2>
            <p>A manual catalog sync pass has been dispatched in the background.</p>
            <p style="margin-top: 1rem;"><a href="/admin/catalog">&larr; Return to Catalog & Sync</a></p>
          </div>`,
        );
        reply.type('text/html; charset=utf-8').status(202).send(html);
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 4: Disney Transport & Rate Limiter Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/disney-transport',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Disney Transport & Rate Limiter', async () => {
          let rlHtml: string;
          try {
            if (options.getRateLimiterSnapshot) {
              const snap = await options.getRateLimiterSnapshot();
              rlHtml = `
                <div class="metric-grid">
                  <div class="metric-card">
                    <div class="metric-label">Sync Gateway RPS</div>
                    <div class="metric-val">${snap.syncGateway.currentRps} / ${snap.syncGateway.maxRps}</div>
                  </div>
                  <div class="metric-card">
                    <div class="metric-label">Sync Gateway Concurrency</div>
                    <div class="metric-val">${snap.syncGateway.currentConcurrency} / ${snap.syncGateway.maxConcurrency}</div>
                  </div>
                  <div class="metric-card">
                    <div class="metric-label">Web Bucket RPS</div>
                    <div class="metric-val">${snap.web.currentRps} / ${snap.web.maxRps}</div>
                  </div>
                  <div class="metric-card">
                    <div class="metric-label">Web Bucket Concurrency</div>
                    <div class="metric-val">${snap.web.currentConcurrency} / ${snap.web.maxConcurrency}</div>
                  </div>
                </div>
              `;
            } else {
              rlHtml = `<p class="badge badge-warning">Unavailable: rate limiter snapshot function not supplied</p>`;
            }
          } catch {
            rlHtml = `<p class="badge badge-warning">Unavailable: Redis-backed rate-limiter counters unreachable</p>`;
          }

          let dirHtml: string;
          try {
            if (options.getDirectorySnapshot) {
              const dir = await options.getDirectorySnapshot();
              const builtAt = dir.builtAtMs ? new Date(dir.builtAtMs).toISOString() : 'Not built';
              const ageMinutes = dir.builtAtMs ? Math.round((Date.now() - dir.builtAtMs) / 60000) : '-';
              dirHtml = `
                <div class="metric-grid">
                  <div class="metric-card">
                    <div class="metric-label">Built At</div>
                    <div class="metric-val" style="font-size: 1.1rem;"><span class="mono">${escapeHtml(builtAt)}</span></div>
                  </div>
                  <div class="metric-card">
                    <div class="metric-label">Directory Age</div>
                    <div class="metric-val" style="font-size: 1.1rem;">${ageMinutes} min (TTL: ${Math.round(dir.ttlMs / 3600000)}h)</div>
                  </div>
                  <div class="metric-card">
                    <div class="metric-label">Resolved Entities</div>
                    <div class="metric-val">${dir.entryCount}</div>
                  </div>
                </div>
              `;
            } else {
              dirHtml = `<p class="badge badge-warning">Unavailable: directory snapshot function not supplied</p>`;
            }
          } catch {
            dirHtml = `<p class="badge badge-warning">Unavailable: failed to read directory state</p>`;
          }

          return `
            ${explainerBanner(
              '⚡',
              'Disney Egress & Directory Cache',
              'Monitors outbound HTTP request budgets and rate limits enforced on Disney API calls to prevent Akamai WAF blocks, along with the ThemeParks.wiki entity cache.',
            )}
            <div class="card">
              <h2>Disney Egress Rate Limiter (Redis)</h2>
              ${rlHtml}
            </div>
            <div class="card">
              <h2>ThemeParks.wiki Entity Directory Cache</h2>
              ${dirHtml}
            </div>
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 5: Forecast Accuracy Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/intelligence/accuracy',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Forecast Accuracy', async () => {
          const parkAcc = await options.repo.getParkForecastAccuracies();
          const waitAcc = await options.repo.getTopWaitForecastAccuracies(50);

          // Summary KPI Calculations
          const validRideMaes = waitAcc.filter((w) => w.mae !== null);
          const avgRideMae =
            validRideMaes.length > 0
              ? validRideMaes.reduce((acc, w) => acc + (w.mae ?? 0), 0) / validRideMaes.length
              : null;

          const validRideBiases = waitAcc.filter((w) => w.bias !== null);
          const avgRideBias =
            validRideBiases.length > 0
              ? validRideBiases.reduce((acc, w) => acc + (w.bias ?? 0), 0) / validRideBiases.length
              : null;

          const oneDayParks = parkAcc.filter((p) => p.leadDays === 1 && p.mae !== null);
          const avgParkMae =
            oneDayParks.length > 0
              ? oneDayParks.reduce((acc, p) => acc + (p.mae ?? 0), 0) / oneDayParks.length
              : null;

          const challengerEvals = waitAcc.filter(
            (w) =>
              w.challengerSampleCount !== undefined &&
              w.challengerSampleCount !== null &&
              w.challengerSampleCount > 0,
          );

          const kpisHtml = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
              <div class="metric-card">
                <div class="metric-label">Avg Attraction Error (MAE)</div>
                <div class="metric-val">${avgRideMae !== null ? `${avgRideMae.toFixed(1)} min` : '-'}</div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">Average standby wait error across top rides</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Attraction Bias (Direction)</div>
                <div class="metric-val" style="display: flex; align-items: baseline; gap: 0.4rem;">
                  ${avgRideBias !== null ? `${avgRideBias > 0 ? '+' : ''}${avgRideBias.toFixed(1)} min` : '-'}
                  ${avgRideBias !== null ? (
                    avgRideBias < -1.0
                      ? '<span class="badge badge-warning text-xs">Underpredicting</span>'
                      : avgRideBias > 1.0
                      ? '<span class="badge badge-info text-xs">Overpredicting</span>'
                      : '<span class="badge badge-success text-xs">Well-Calibrated</span>'
                  ) : ''}
                </div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">
                  ${avgRideBias !== null && avgRideBias < -0.5
                    ? 'Actual lines run slightly longer than predicted'
                    : avgRideBias !== null && avgRideBias > 0.5
                    ? 'Actual lines run slightly shorter than predicted'
                    : 'Balanced between over and under predictions'}
                </div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Park Crowd Error (1-Day MAE)</div>
                <div class="metric-val">${avgParkMae !== null ? `&plusmn;${avgParkMae.toFixed(2)} pts` : '-'}</div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">On 1.0 crowd multiplier scale (~1–10 crowd levels)</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Challenger Shadow Status</div>
                <div class="metric-val" style="font-size: 1.15rem;">
                  ${challengerEvals.length > 0 ? `${challengerEvals.length} Rides Monitored` : 'Awaiting Shadow Logs'}
                </div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">
                  ${challengerEvals.length > 0 ? 'Evaluating alongside production engine' : 'No active challenger evaluations logged'}
                </div>
              </div>
            </div>
          `;

          const guideHtml = `
            <div class="guide-card">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;">
                <h3 style="margin: 0; display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem;">
                  <span>📖</span> Metric Interpretation Reference Guide
                </h3>
                <span class="text-xs text-muted">Plain-English definitions & benchmarks</span>
              </div>
              <div class="guide-grid">
                <div class="guide-item">
                  <div class="guide-item-title">
                    <span>🎯</span> MAE (Mean Absolute Error)
                  </div>
                  <div class="guide-item-desc">
                    <strong>How far off predictions are on average</strong>, ignoring whether they were too high or too low. Lower is better.
                    <div style="margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06);">
                      &bull; <strong>Attractions:</strong> Standby minutes (&lt;7m tight, 7–14m typical).<br/>
                      &bull; <strong>Parks:</strong> Crowd index points (&lt;0.20 is high accuracy).
                    </div>
                  </div>
                </div>

                <div class="guide-item">
                  <div class="guide-item-title">
                    <span>⚖️</span> Bias (Systematic Skew)
                  </div>
                  <div class="guide-item-desc">
                    <strong>Directional tendency</strong> over many predictions. Shows if the model systematically misses in one direction:
                    <div style="margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06);">
                      &bull; <span class="text-amber font-semibold">&minus; Negative Bias:</span> <strong>Underpredicting</strong> (Actual lines/crowds were longer than predicted).<br/>
                      &bull; <span class="text-cyan font-semibold">+ Positive Bias:</span> <strong>Overpredicting</strong> (Actual lines/crowds were shorter than predicted).<br/>
                      &bull; <span class="text-emerald font-semibold">&plusmn;0 Neutral:</span> <strong>Balanced</strong> (Equally centered around reality).
                    </div>
                  </div>
                </div>

                <div class="guide-item">
                  <div class="guide-item-title">
                    <span>📅</span> Lead Days (Horizon)
                  </div>
                  <div class="guide-item-desc">
                    <strong>How far in advance</strong> the prediction was locked in (1 day vs. 30 days ahead).
                    <div style="margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06);">
                      Error naturally widens as lead days increase because weather, crowd swings, and ride outages cannot be known weeks in advance.
                    </div>
                  </div>
                </div>

                <div class="guide-item">
                  <div class="guide-item-title">
                    <span>⚔️</span> Challenger Model
                  </div>
                  <div class="guide-item-desc">
                    <strong>Experimental shadow candidate</strong> running silently in parallel with production.
                    <div style="margin-top: 0.4rem; padding-top: 0.4rem; border-top: 1px solid rgba(255,255,255,0.06);">
                      Allows data science to evaluate new machine learning algorithms against real outcomes before promoting them to production.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;

          const parkTable = table(parkAcc, [
            {
              header: 'Park',
              cell: (r) => `<strong>${escapeHtml(r.park)}</strong>`,
            },
            {
              header: 'Lead Horizon',
              cell: (r) => {
                const horizonLabel =
                  r.leadDays === 1
                    ? '1 day out'
                    : r.leadDays === 3
                    ? '3 days out'
                    : r.leadDays === 7
                    ? '1 week out'
                    : r.leadDays === 14
                    ? '2 weeks out'
                    : r.leadDays === 30
                    ? '1 month out'
                    : `${r.leadDays} days out`;
                return `<span class="mono" style="font-weight: 600;">${escapeHtml(r.leadDays)}</span> <span class="text-xs text-muted">(${horizonLabel})</span>`;
              },
            },
            {
              header: 'MAE (Crowd Index)',
              cell: (r) => {
                if (r.mae === null) return '-';
                const maeVal = r.mae.toFixed(2);
                const badgeClass =
                  r.mae < 0.20 ? 'badge-success' : r.mae < 0.35 ? 'badge-info' : 'badge-warning';
                const ratingLabel =
                  r.mae < 0.20 ? 'High' : r.mae < 0.35 ? 'Standard' : 'Volatile';
                return `<div style="display: flex; align-items: center; gap: 0.5rem;"><span class="mono" style="font-weight: 600;">${maeVal}</span> <span class="badge ${badgeClass} text-xs">${ratingLabel}</span></div><span class="text-xs text-muted">index pts</span>`;
              },
            },
            {
              header: 'Bias (Direction)',
              cell: (r) => {
                if (r.bias === null) return '-';
                const biasVal = (r.bias > 0 ? '+' : '') + r.bias.toFixed(2);
                let labelHtml = '';
                if (r.bias < -0.05) {
                  labelHtml = `<div class="text-xs text-amber font-semibold">&#x25BC; Underpredicts by ${Math.abs(r.bias).toFixed(2)} pts</div>`;
                } else if (r.bias > 0.05) {
                  labelHtml = `<div class="text-xs text-cyan font-semibold">&#x25B2; Overpredicts by ${r.bias.toFixed(2)} pts</div>`;
                } else {
                  labelHtml = `<div class="text-xs text-emerald font-semibold">&#x2714; Well balanced</div>`;
                }
                return `<span class="mono" style="font-weight: 600;">${biasVal}</span>${labelHtml}`;
              },
            },
            {
              header: 'Sample Days',
              cell: (r) => `<span class="mono">${escapeHtml(r.sampleCount)}</span> <span class="text-xs text-muted">days</span>`,
            },
          ]);

          const waitTable = table(waitAcc, [
            {
              header: 'Experience',
              cell: (r) =>
                `<div><a href="/admin/intelligence/accuracy/${escapeHtml(r.experienceId)}"><strong>${escapeHtml(r.name)}</strong></a></div><div class="text-xs text-muted">ID: ${escapeHtml(r.experienceId)} &bull; <a href="/admin/intelligence/accuracy/${escapeHtml(r.experienceId)}">View hourly logs &rarr;</a></div>`,
            },
            {
              header: 'Park',
              cell: (r) => `<span class="badge badge-neutral">${escapeHtml(r.park)}</span>`,
            },
            {
              header: 'Lead Horizon',
              cell: (r) => `<span class="mono" style="font-weight: 600;">${escapeHtml(r.leadDays)}</span> <span class="text-xs text-muted">${r.leadDays === 1 ? 'day out' : 'days out'}</span>`,
            },
            {
              header: 'MAE (Avg Min Error)',
              cell: (r) => {
                if (r.mae === null) return '-';
                const maeVal = r.mae.toFixed(2);
                const badge =
                  r.mae < 7.0
                    ? '<span class="badge badge-success text-xs">&plusmn;tight</span>'
                    : r.mae < 14.0
                    ? '<span class="badge badge-info text-xs">&plusmn;typical</span>'
                    : '<span class="badge badge-warning text-xs">&plusmn;volatile</span>';
                return `<div style="display: flex; align-items: center; gap: 0.4rem;"><span class="mono" style="font-weight: 600; font-size: 0.95rem;">${maeVal} min</span> ${badge}</div><span class="text-xs text-muted">avg off by &plusmn;${Math.round(r.mae)}m</span>`;
              },
            },
            {
              header: 'Bias (Directional Skew)',
              cell: (r) => {
                if (r.bias === null) return '-';
                const biasVal = (r.bias > 0 ? '+' : '') + r.bias.toFixed(2);
                let skewExplainer = '';
                if (r.bias < -1.0) {
                  skewExplainer = `<div class="text-xs text-amber font-semibold">&#x25BC; Under by ~${Math.abs(Math.round(r.bias))}m (lines run longer)</div>`;
                } else if (r.bias > 1.0) {
                  skewExplainer = `<div class="text-xs text-cyan font-semibold">&#x25B2; Over by ~${Math.round(r.bias)}m (lines run shorter)</div>`;
                } else {
                  skewExplainer = `<div class="text-xs text-emerald font-semibold">&#x2714; Well balanced (&plusmn;1m)</div>`;
                }
                return `<span class="mono" style="font-weight: 600;">${biasVal} min</span>${skewExplainer}`;
              },
            },
            {
              header: 'Evaluations',
              cell: (r) => `<span class="mono">${escapeHtml(r.sampleCount)}</span> <span class="text-xs text-muted">logs</span>`,
            },
            {
              header: 'Challenger MAE',
              cell: (r) => {
                if (r.challengerMae === undefined || r.challengerMae === null) {
                  return '<span class="text-muted">-</span>';
                }
                const maeStr = r.challengerMae.toFixed(2);
                return `<span class="mono" style="font-weight: 600;">${maeStr}</span> <span class="text-xs text-muted">min</span>`;
              },
            },
            {
              header: 'Challenger Bias',
              cell: (r) => {
                if (r.challengerBias === undefined || r.challengerBias === null) {
                  return '<span class="text-muted">-</span>';
                }
                const biasStr = (r.challengerBias > 0 ? '+' : '') + r.challengerBias.toFixed(2);
                return `<span class="mono">${biasStr}</span> <span class="text-xs text-muted">min</span>`;
              },
            },
            {
              header: 'Challenger Status',
              cell: (r) => {
                const sampleCount = r.challengerSampleCount ?? 0;
                if (sampleCount === 0 || r.challengerMae === null || r.challengerMae === undefined) {
                  return '<span class="text-muted text-xs">No shadow data</span>';
                }
                if (r.mae !== null) {
                  const delta = r.mae - r.challengerMae;
                  if (delta > 0.5) {
                    return `<span class="badge badge-success text-xs">&#x2197; +${delta.toFixed(1)}m better</span><div class="text-xs text-muted">${escapeHtml(sampleCount)} evals</div>`;
                  }
                  if (delta < -0.5) {
                    return `<span class="badge badge-danger text-xs">&#x2198; ${Math.abs(delta).toFixed(1)}m worse</span><div class="text-xs text-muted">${escapeHtml(sampleCount)} evals</div>`;
                  }
                  return `<span class="badge badge-info text-xs">&#x2248; Similar accuracy</span><div class="text-xs text-muted">${escapeHtml(sampleCount)} evals</div>`;
                }
                return `<span class="text-xs text-muted">${escapeHtml(sampleCount)} evals</span>`;
              },
            },
          ]);

          return `
            ${explainerBanner(
              '🎯',
              'Forecast Accuracy Evaluation',
              'Measures prediction accuracy against actual observed standby wait times and crowd densities. All metrics preserve underlying raw data, with plain-English directional indicators and units below.',
            )}
            ${kpisHtml}
            ${guideHtml}
            <div class="card">
              <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                <h2>Park-Level Crowd Index Forecast Accuracy</h2>
                <span class="text-xs text-muted">Evaluated across 1 to 30 day forecast horizons (1.0 = typical crowd)</span>
              </div>
              <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 1rem;">
                Measures how accurately the 1–10 crowd calendar models total park density. Metrics are expressed in crowd multiplier index points.
              </p>
              ${parkTable}
            </div>
            <div class="card">
              <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
                <h2>Top Experience Forecast Accuracy (Highest Sample Count)</h2>
                <span class="text-xs text-muted">Evaluated against actual ThemeParks.wiki posted wait times</span>
              </div>
              <p class="text-muted" style="font-size: 0.85rem; margin-bottom: 1rem;">
                Standby wait time predictions for individual attractions. MAE and Bias are measured in minutes. Click an attraction name to inspect hourly historical comparisons.
              </p>
              ${waitTable}
            </div>
          `;
        });
      },
    );

    fastify.get<{ Params: { experienceId: string } }>(
      '/admin/intelligence/accuracy/:experienceId',
      { preHandler: options.basicAuth },
      async (request, reply) => {
        const { experienceId } = request.params;
        await renderAdminSection(reply, `Forecast Logs: ${experienceId}`, async () => {
          const exp = await options.repo.getExperience(experienceId);
          if (!exp) {
            throw new AppError(
              'admin_experience_not_found',
              `Experience with ID '${experienceId}' not found.`,
            );
          }

          const logs = await options.repo.getWaitForecastHistory(experienceId, 200);

          const validLogs = logs.filter((l) => l.predictedWaitMinutes !== null && l.actualWaitMinutes !== null);
          const avgActual =
            validLogs.length > 0
              ? Math.round(validLogs.reduce((acc, l) => acc + (l.actualWaitMinutes ?? 0), 0) / validLogs.length)
              : null;
          const avgPred =
            validLogs.length > 0
              ? Math.round(validLogs.reduce((acc, l) => acc + (l.predictedWaitMinutes ?? 0), 0) / validLogs.length)
              : null;
          const avgAbsErr =
            validLogs.length > 0
              ? (validLogs.reduce((acc, l) => acc + Math.abs(l.errorMinutes ?? 0), 0) / validLogs.length).toFixed(1)
              : null;

          const statsCardHtml = `
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
              <div class="metric-card">
                <div class="metric-label">Historical Logs</div>
                <div class="metric-val">${logs.length}</div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">Total hourly snapshots evaluated</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Avg Observed Wait</div>
                <div class="metric-val">${avgActual !== null ? `${avgActual} min` : '-'}</div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">Actual standby wait time posted</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Avg Predicted Wait</div>
                <div class="metric-val">${avgPred !== null ? `${avgPred} min` : '-'}</div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">Standby wait time forecasted</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Mean Absolute Error</div>
                <div class="metric-val">${avgAbsErr !== null ? `&plusmn;${avgAbsErr} min` : '-'}</div>
                <div class="text-xs text-muted" style="margin-top: 0.25rem;">Average error across all hourly logs</div>
              </div>
            </div>
          `;

          const logsTable = table(logs, [
            { header: 'Date', cell: (r) => `<span class="mono">${escapeHtml(r.targetDate)}</span>` },
            { header: 'Hour', cell: (r) => `<span class="mono">${escapeHtml(r.targetHour)}:00</span>` },
            {
              header: 'Predicted Wait',
              cell: (r) =>
                r.predictedWaitMinutes !== null
                  ? `<span class="mono" style="font-weight: 600;">${escapeHtml(r.predictedWaitMinutes)}</span> <span class="text-xs text-muted">min</span>`
                  : '<span class="text-muted">-</span>',
            },
            {
              header: 'Observed Wait',
              cell: (r) =>
                r.actualWaitMinutes !== null
                  ? `<span class="mono" style="font-weight: 600;">${escapeHtml(r.actualWaitMinutes)}</span> <span class="text-xs text-muted">min</span>`
                  : '<span class="text-muted">-</span>',
            },
            {
              header: 'Prediction Error',
              cell: (r) => {
                if (r.errorMinutes === null) return '<span class="text-muted">-</span>';
                const err = r.errorMinutes;
                const absErr = Math.abs(err);
                const badgeClass = absErr <= 5 ? 'badge-success' : absErr <= 15 ? 'badge-info' : 'badge-warning';
                const sign = err > 0 ? `+${err}` : `${err}`;
                const dir = err > 0 ? 'overpredicted' : err < 0 ? 'underpredicted' : 'exact';
                return `<div style="display: flex; align-items: center; gap: 0.4rem;"><span class="mono font-semibold">${sign} min</span> <span class="badge ${badgeClass} text-xs">${dir}</span></div>`;
              },
            },
          ]);

          return `
            ${explainerBanner(
              '📈',
              'Attraction Forecast Comparison History',
              'Hourly breakdown of predicted vs actual standby wait times and prediction error delta for this specific attraction.',
            )}
            <div class="card">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
                <h2>${escapeHtml(exp.name)} (${escapeHtml(experienceId)})</h2>
                <a href="/admin/intelligence/accuracy" class="btn btn-secondary text-xs">&larr; Back to Forecast Accuracy</a>
              </div>
              ${statsCardHtml}
              <h3 style="margin-top: 1.25rem; margin-bottom: 0.75rem;">Hourly Historical Logs</h3>
              ${logsTable}
              <p style="margin-top: 1rem;"><a href="/admin/intelligence/accuracy">&larr; Back to Forecast Accuracy</a></p>
            </div>
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 6: Intelligence Model Internals Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/intelligence/model',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Intelligence Model Internals', async () => {
          const baseline = await options.repo.getRideBaselineCoverage();
          const weather = await options.repo.getTopWeatherSensitivities(50);
          const cascades = await options.repo.getTopRideCascades(50);
          const showtimes = await options.repo.getShowTimePatterns();

          const parks = ['MK', 'EPCOT', 'HS', 'AK'] as const;
          const parkHistories = await Promise.all(
            parks.map(async (p) => ({ park: p, history: await options.repo.getParkCrowdIndexHistory(p, 14) })),
          );

          const baselineHtml = `
            <div class="card">
              <h2>Ride Baseline Coverage</h2>
              <div class="metric-grid">
                <div class="metric-card">
                  <div class="metric-label">Total Experiences</div>
                  <div class="metric-val">${baseline.totalExperiences}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Established Baselines</div>
                  <div class="metric-val">${baseline.establishedCount}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Cold Starting (Null)</div>
                  <div class="metric-val">${baseline.coldStartCount}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Coverage Percent</div>
                  <div class="metric-val">${baseline.coveragePercent.toFixed(1)}%</div>
                  ${progressBar(baseline.coveragePercent)}
                </div>
              </div>
              <h3 style="margin-top: 1rem; margin-bottom: 0.5rem;">Top 20 by Bucket Density</h3>
              ${table(baseline.topDensityExperiences, [
                { header: 'Experience', cell: (r) => escapeHtml(r.name) },
                { header: 'Populated Buckets (Day/Hour)', cell: (r) => escapeHtml(r.populatedBuckets) },
              ])}
            </div>
          `;

          const crowdHtml = parkHistories
            .map((p) => {
              const t = table(p.history, [
                { header: 'Date', cell: (r) => `<span class="mono">${escapeHtml(r.date)}</span>` },
                { header: 'Crowd Index', cell: (r) => r.crowdIndex.toFixed(2) },
                {
                  header: 'Daily Avg Wait',
                  cell: (r) => (r.dailyAvgWait !== undefined ? `${r.dailyAvgWait.toFixed(1)} min` : '-'),
                },
                { header: 'Samples', cell: (r) => escapeHtml(r.sampleCount ?? '-') },
              ]);
              return `
                <div class="card">
                  <h3>${escapeHtml(p.park)} - 14 Day Crowd Index History</h3>
                  ${t}
                </div>
              `;
            })
            .join('\n');

          const weatherTable = table(weather, [
            { header: 'Experience', cell: (r) => escapeHtml(r.name) },
            { header: 'Condition', cell: (r) => escapeHtml(r.condition) },
            { header: 'Wait Multiplier', cell: (r) => r.waitMultiplier.toFixed(2) },
            { header: 'Samples', cell: (r) => escapeHtml(r.sampleCount) },
          ]);

          const cascadesTable = table(cascades, [
            { header: 'Down Experience', cell: (r) => escapeHtml(r.downExperienceName) },
            { header: 'Affected Experience', cell: (r) => escapeHtml(r.affectedExperienceName) },
            { header: 'Wait Delta', cell: (r) => `${r.waitDelta > 0 ? '+' : ''}${r.waitDelta.toFixed(1)} min` },
            { header: 'Wait % Delta', cell: (r) => `${(r.waitPctDelta * 100).toFixed(1)}%` },
            { header: 'Baseline Wait', cell: (r) => `${r.baselineWait.toFixed(1)} min` },
            { header: 'Samples', cell: (r) => escapeHtml(r.sampleCount) },
          ]);

          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const showtimesTable = table(showtimes, [
            { header: 'Show / Entertainment', cell: (r) => escapeHtml(r.name) },
            { header: 'Day of Week', cell: (r) => days[r.dayOfWeek] ?? String(r.dayOfWeek) },
            {
              header: 'Start Time',
              cell: (r) => {
                const hours = Math.floor(r.startMinutes / 60);
                const mins = r.startMinutes % 60;
                return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
              },
            },
            { header: 'Frequency', cell: (r) => r.frequency.toFixed(2) },
            { header: 'Samples', cell: (r) => escapeHtml(r.sampleCount) },
          ]);

          return `
            ${explainerBanner(
              '🧠',
              'Intelligence Model Internals & Heuristics',
              'Inspects the learned components of the prediction engine: attraction baseline wait curves (~500-sample memory), park crowd index history, weather sensitivity multipliers, ride breakdown cascading impacts, and entertainment showtime schedules.',
            )}
            ${baselineHtml}
            <h2>Park Crowd Index History</h2>
            ${crowdHtml}
            <div class="card">
              <h2>Learned Weather Sensitivities (Top 50)</h2>
              ${weatherTable}
            </div>
            <div class="card">
              <h2>Learned Ride Cascades (Top 50)</h2>
              ${cascadesTable}
            </div>
            <div class="card">
              <h2>Show Time Patterns</h2>
              ${showtimesTable}
            </div>
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 7: Sampling & Derived-Stats Health
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/intelligence/sampling',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Sampling Pass Health', async () => {
          const runs = await options.repo.getRecentSamplingRuns(20);

          const lastSuccess = runs.find((r) => r.outcome === 'success');
          const lastRun = runs[0];
          const nowMs = Date.now();
          const minutesSinceSuccess = lastSuccess
            ? Math.round((nowMs - new Date(lastSuccess.completed_at).getTime()) / 60000)
            : null;

          const isDegraded =
            (lastRun && lastRun.outcome === 'failed') ||
            minutesSinceSuccess === null ||
            minutesSinceSuccess > SAMPLING_HEALTH_STALE_MINUTES;

          const healthBadge = isDegraded
            ? flagged(true, `Degraded: ${lastRun?.outcome === 'failed' ? 'Latest pass failed' : `No successful pass in ${minutesSinceSuccess ?? '>30'} min`}`)
            : `<span class="badge badge-success">Healthy: last success ${minutesSinceSuccess ?? 0}m ago</span>`;

          const runsTable = table(runs, [
            {
              header: 'Outcome',
              cell: (r) => (r.outcome === 'failed' ? flagged(true, 'failed') : '<span class="badge badge-success">success</span>'),
            },
            { header: 'Started At', cell: (r) => `<span class="mono">${escapeHtml(String(r.started_at))}</span>` },
            { header: 'Completed At', cell: (r) => `<span class="mono">${escapeHtml(String(r.completed_at))}</span>` },
            { header: 'Parks', cell: (r) => escapeHtml(r.parks_sampled_count) },
            { header: 'Mapped Exps', cell: (r) => escapeHtml(r.experiences_mapped_count) },
            { header: 'Wait Samples', cell: (r) => escapeHtml(r.wait_samples_recorded_count) },
            { header: 'Unmapped', cell: (r) => escapeHtml(r.unmapped_with_wait_count) },
            { header: 'Error', cell: (r) => (r.error_message ? `<span class="mono text-muted">${escapeHtml(r.error_message)}</span>` : '-') },
          ]);

          const unmappedRun = runs.find(
            (r) => r.unmapped_sample && Array.isArray(r.unmapped_sample) && r.unmapped_sample.length > 0,
          );
          const unmappedList =
            unmappedRun && Array.isArray(unmappedRun.unmapped_sample)
              ? (unmappedRun.unmapped_sample as readonly { name: string; id: string }[])
                  .map((u) => `<li><strong>${escapeHtml(u.name)}</strong> (ID: <code>${escapeHtml(u.id)}</code>)</li>`)
                  .join('')
              : '<li>No unmapped entities detected in recent passes.</li>';

          return `
            ${explainerBanner(
              '⏱️',
              'Sampling Pass Observability',
              'Live wait times and operating statuses are polled from ThemeParks.wiki on a ~10-minute cadence via external keep-alive cron. If no successful pass occurs in 30 minutes, status is marked Degraded.',
            )}
            <div class="card">
              <h2>Sampling Pass Status</h2>
              <div style="margin-bottom: 1rem;">${healthBadge}</div>
              <p class="text-muted">
                Executed every ~10 minutes via keep-alive cron. Pruned after 30 days.
              </p>
            </div>
            <div class="card">
              <h2>Recent Sampling Passes (Last 20)</h2>
              ${runsTable}
            </div>
            <div class="card">
              <h2>Unmapped Live Entities Sample (Latest Available)</h2>
              <ul style="padding-left: 1.5rem; font-size: 0.875rem;">
                ${unmappedList}
              </ul>
            </div>
          `;
        });
      },
    );

    fastify.get(
      '/admin/intelligence/derived-stats',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Derived Stats Job Health', async () => {
          const statRuns = options.intelligenceRepo ? await options.intelligenceRepo.getDerivedStatRuns() : [];

          const statTable = table(statRuns, [
            { header: 'Leg', cell: (r) => escapeHtml(r.leg) },
            {
              header: 'Health',
              cell: (r) =>
                r.consecutive_failures > 0
                  ? flagged(true, `${r.consecutive_failures} failures`)
                  : '<span class="badge badge-success">OK</span>',
            },
            {
              header: 'Last Success',
              cell: (r) => (r.last_success_at ? `<span class="mono">${escapeHtml(String(r.last_success_at))}</span>` : '-'),
            },
            {
              header: 'Last Error At',
              cell: (r) => (r.last_error_at ? `<span class="mono">${escapeHtml(String(r.last_error_at))}</span>` : '-'),
            },
            {
              header: 'Last Error',
              cell: (r) => (r.last_error ? `<span class="mono text-muted">${escapeHtml(r.last_error)}</span>` : '-'),
            },
          ]);

          return `
            ${explainerBanner(
              '📊',
              'Nightly Derived Statistics Jobs',
              'Heavy analytics batch computations calculating weather sensitivity multipliers, attraction cascade relationships, and baseline wait distributions. Jobs that fail consecutively are flagged for review.',
            )}
            <div class="card">
              <h2>Derived Statistics Background Jobs</h2>
              <p class="text-muted" style="margin-bottom: 1rem;">
                Nightly batch jobs computing weather sensitivity, ride cascades, and baseline waits.
              </p>
              ${statTable}
            </div>
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 8: Infrastructure Budget Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/infra',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Infrastructure Budget', async () => {
          const dbSize = await options.repo.getDatabaseSizeSnapshot();
          const redisBudget = await options.repo.getRedisCommandBudget();

          const dbTable = table(dbSize.topTables, [
            { header: 'Table Name', cell: (r) => `<code>${escapeHtml(r.tableName)}</code>` },
            { header: 'Total Size', cell: (r) => escapeHtml(r.prettySize) },
            {
              header: '% of Neon Limit',
              cell: (r) => `${((r.sizeBytes / NEON_FREE_TIER_BYTES) * 100).toFixed(2)}%`,
            },
          ]);

          const redisHtml =
            redisBudget === null
              ? `<div class="card"><p class="badge badge-warning">Unavailable: Redis INFO commandstats not exposed</p></div>`
              : `
                <div class="card">
                  <h2>Upstash Redis Daily Command Budget</h2>
                  <div class="metric-grid">
                    <div class="metric-card">
                      <div class="metric-label">Commands (Estimated)</div>
                      <div class="metric-val">${redisBudget.totalCommands.toLocaleString()}</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Cap (${UPSTASH_FREE_TIER_DAILY_COMMANDS.toLocaleString()} / day)</div>
                      <div class="metric-val">${redisBudget.percentOfBudget.toFixed(1)}%</div>
                      ${progressBar(redisBudget.percentOfBudget, redisBudget.percentOfBudget > 80 ? 'danger' : redisBudget.percentOfBudget > 60 ? 'warning' : 'normal')}
                    </div>
                  </div>
                  <p class="text-muted" style="font-size: 0.85rem;">
                    Derived from Redis <code>INFO commandstats</code> calls since last restart/reset.
                  </p>
                </div>
              `;

          return `
            ${explainerBanner(
              '💾',
              'Infrastructure Free-Tier Quota Monitoring',
              'Observes real-time storage and command consumption against free-tier infrastructure limits: Neon PostgreSQL (0.5 GB capacity) and Upstash Redis (10,000 commands/day).',
            )}
            <div class="card">
              <h2>Neon Postgres Database Storage</h2>
              <div class="metric-grid">
                <div class="metric-card">
                  <div class="metric-label">Total Storage Used</div>
                  <div class="metric-val">${escapeHtml(dbSize.prettyTotalSize)}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Neon Free Tier (0.5 GB)</div>
                  <div class="metric-val">${dbSize.percentOfBudget.toFixed(1)}%</div>
                  ${progressBar(dbSize.percentOfBudget, dbSize.percentOfBudget > 80 ? 'danger' : dbSize.percentOfBudget > 60 ? 'warning' : 'normal')}
                </div>
              </div>
              <h3 style="margin-top: 1rem; margin-bottom: 0.5rem;">Top 10 Tables by Size</h3>
              ${dbTable}
            </div>
            ${redisHtml}
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 9: Authentication & Abuse Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/accounts/lockouts',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Account Lockouts', async () => {
          const lockouts = await options.repo.getActiveLockouts();

          const lockoutsTable = table(lockouts, [
            { header: 'User ID', cell: (r) => `<code>${escapeHtml(r.userId)}</code>` },
            { header: 'Email', cell: (r) => escapeHtml(r.email ?? '-') },
            { header: 'Failed Attempts', cell: (r) => escapeHtml(r.failedAttempts) },
            {
              header: 'Type',
              cell: (r) => (r.isPermanent ? flagged(true, 'permanent') : 'temporary'),
            },
            {
              header: 'Remaining TTL',
              cell: (r) => {
                if (r.lockedUntilMs === null) return '-';
                const remaining = Math.max(0, Math.round((r.lockedUntilMs - Date.now()) / 1000));
                return `${remaining}s`;
              },
            },
            {
              header: 'Action',
              cell: (r) => `
                <form method="POST" action="/admin/accounts/${escapeHtml(r.userId)}/unlock" style="display:inline;">
                  <button type="submit" class="btn btn-danger" style="padding: 0.25rem 0.5rem; font-size: 0.75rem;">Unlock</button>
                </form>
              `,
            },
          ]);

          return `
            ${explainerBanner(
              '🔒',
              'Account Lockout Defense & Security',
              'Users temporarily or permanently locked after repeated failed login attempts. Operators can review remaining lockout time or trigger an instant manual unlock.',
            )}
            <div class="card">
              <h2>Active Account Lockouts</h2>
              <p class="text-muted" style="margin-bottom: 1rem;">
                Users temporarily locked out due to repeated failed login attempts.
              </p>
              ${lockoutsTable}
            </div>
          `;
        });
      },
    );

    fastify.post<{ Params: { userId: string } }>(
      '/admin/accounts/:userId/unlock',
      { preHandler: options.basicAuth },
      async (request, reply) => {
        const { userId } = request.params;
        const cleared = await options.repo.clearLockout(userId);

        const html = renderPage(
          'Unlock Account',
          `<div class="card">
            <h2>Account Unlock Result</h2>
            <p style="margin-bottom: 1rem;">
              ${
                cleared
                  ? `<span class="badge badge-success">Unlocked</span> Successfully deleted lockout keys for User <code>${escapeHtml(userId)}</code>.`
                  : `<span class="badge badge-warning">No Lockout</span> No active lockout found for User <code>${escapeHtml(userId)}</code>. No changes made.`
              }
            </p>
            <p><a href="/admin/accounts/lockouts">&larr; Return to Account Lockouts</a></p>
          </div>`,
        );
        reply.type('text/html; charset=utf-8').status(200).send(html);
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 10: Push Notification Delivery Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/notifications',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        // Opportunistic 30-day retention prune (Requirement 10, Task 16.3)
        void options.repo.prunePushDeliveryLog().catch(() => {});

        await renderAdminSection(reply, 'Push Notifications Visibility', async () => {
          const counts = await options.repo.getPushDeliveryCounts(24);
          const deliveries = await options.repo.getRecentPushDeliveries(100);

          const isDegraded = counts.error > counts.ok;
          const statusBadge = isDegraded
            ? flagged(true, `Degraded: Errors (${counts.error}) exceed Successful deliveries (${counts.ok}) in last 24h`)
            : `<span class="badge badge-success">Healthy: ${counts.ok} successful / ${counts.error} errors in 24h</span>`;

          const deliveriesTable = table(deliveries, [
            { header: 'Occurred At', cell: (r) => `<span class="mono">${escapeHtml(r.occurredAt)}</span>` },
            { header: 'User ID', cell: (r) => `<code>${escapeHtml(r.userId)}</code>` },
            { header: 'Kind', cell: (r) => escapeHtml(r.notificationKind) },
            {
              header: 'Status',
              cell: (r) => {
                if (r.status === 'ok') return '<span class="badge badge-success">ok</span>';
                if (r.status === 'device_unregistered') return '<span class="badge badge-warning">unregistered</span>';
                return flagged(true, 'error');
              },
            },
          ]);

          return `
            ${explainerBanner(
              '🔔',
              'Push Delivery Visibility',
              'Trailing 24-hour delivery tracking for Expo Push Notifications. Evaluates delivery success rate, unregistered device tokens, and downstream gateway errors.',
            )}
            <div class="card">
              <h2>Push Delivery Health (Trailing 24 Hours)</h2>
              <div style="margin-bottom: 1rem;">${statusBadge}</div>
              <div class="metric-grid">
                <div class="metric-card">
                  <div class="metric-label">Total Attempts</div>
                  <div class="metric-val">${counts.total}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Delivered (OK)</div>
                  <div class="metric-val">${counts.ok}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Unregistered Tokens</div>
                  <div class="metric-val">${counts.deviceUnregistered}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Errors</div>
                  <div class="metric-val">${counts.error}</div>
                </div>
              </div>
            </div>
            <div class="card">
              <h2>Recent Delivery Log (Last 100 Attempts)</h2>
              ${deliveriesTable}
            </div>
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 11: User & Support Lookup
    // -------------------------------------------------------------------------
    fastify.get<{ Querystring: { email?: string } }>(
      '/admin/users',
      { preHandler: options.basicAuth },
      async (request, reply) => {
        const email = request.query.email?.trim();
        await renderAdminSection(reply, 'User Lookup & Support', async () => {
          let userDetailsHtml = '';

          if (email) {
            const user = await options.repo.findUserByEmail(email);
            if (!user) {
              userDetailsHtml = `
                <div class="card">
                  <p class="badge badge-warning">No matching account was found.</p>
                </div>
              `;
            } else {
              const pushTable = table(user.recentPushRegistrations, [
                { header: 'Registration ID', cell: (r) => `<code>${escapeHtml(r.id)}</code>` },
                { header: 'Status', cell: (r) => escapeHtml(r.status) },
                { header: 'Updated At', cell: (r) => `<span class="mono">${escapeHtml(r.updatedAt)}</span>` },
              ]);

              userDetailsHtml = `
                <div class="card">
                  <h2>Account Details: ${escapeHtml(user.email)}</h2>
                  <div class="metric-grid">
                    <div class="metric-card">
                      <div class="metric-label">User ID</div>
                      <div class="metric-val" style="font-size: 1rem;"><span class="mono">${escapeHtml(user.id)}</span></div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Display Name</div>
                      <div class="metric-val" style="font-size: 1.1rem;">${escapeHtml(user.displayName ?? '-')}</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Created At</div>
                      <div class="metric-val" style="font-size: 1rem;"><span class="mono">${escapeHtml(user.createdAt)}</span></div>
                    </div>
                  </div>

                  <h3 style="margin-top: 1rem; margin-bottom: 0.5rem;">Engagement & Activity Counts</h3>
                  <div class="metric-grid">
                    <div class="metric-card">
                      <div class="metric-label">Completions</div>
                      <div class="metric-val">${user.completionCount}</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Ratings</div>
                      <div class="metric-val">${user.ratingCount}</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Notes</div>
                      <div class="metric-val">${user.noteCount}</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Friends</div>
                      <div class="metric-val">${user.friendCount}</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Trips</div>
                      <div class="metric-val">${user.tripCount}</div>
                    </div>
                    <div class="metric-card">
                      <div class="metric-label">Active Sessions</div>
                      <div class="metric-val">${user.activeSessionCount}</div>
                    </div>
                  </div>

                  <div style="display: flex; gap: 1rem; margin-top: 1.5rem; margin-bottom: 1.5rem;">
                    <a class="btn" href="/admin/accounts/lockouts">Check Lockout Status</a>
                    <a class="btn" href="/admin/users/${escapeHtml(user.id)}/pins">Pin Diagnostic</a>
                    <form method="POST" action="/admin/users/${escapeHtml(user.id)}/revoke-sessions" style="display:inline;">
                      <button type="submit" class="btn btn-danger">Revoke All Sessions</button>
                    </form>
                  </div>

                  <h3 style="margin-top: 1rem; margin-bottom: 0.5rem;">Recent Push Registrations (Up to 5)</h3>
                  ${pushTable}
                </div>
              `;
            }
          }

          return `
            ${explainerBanner(
              '👤',
              'User Support & Account Lookup',
              'Case-insensitive search by user email. Surfaces engagement statistics (completions, ratings, notes, trips), active device push tokens, and instant session revocation.',
            )}
            <div class="card">
              <h2>Lookup User by Email</h2>
              <form method="GET" action="/admin/users" style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem;">
                <input type="email" name="email" value="${escapeHtml(email ?? '')}" placeholder="guest@example.com" class="form-input" required />
                <button type="submit" class="btn">Search</button>
              </form>
            </div>
            ${userDetailsHtml}
          `;
        });
      },
    );

    fastify.post<{ Params: { userId: string } }>(
      '/admin/users/:userId/revoke-sessions',
      { preHandler: options.basicAuth },
      async (request, reply) => {
        const { userId } = request.params;
        const count = await options.repo.revokeAllSessions(userId);

        const html = renderPage(
          'Sessions Revoked',
          `<div class="card">
            <h2>Session Revocation Complete</h2>
            <p>Revoked <strong>${count}</strong> active session(s) for user <code>${escapeHtml(userId)}</code>.</p>
            <p style="margin-top: 1rem;"><a href="/admin/users">&larr; Return to User Search</a></p>
          </div>`,
        );
        reply.type('text/html; charset=utf-8').status(200).send(html);
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 12: Pin Collection Diagnostic
    // -------------------------------------------------------------------------
    fastify.get<{ Params: { userId: string } }>(
      '/admin/users/:userId/pins',
      { preHandler: options.basicAuth },
      async (request, reply) => {
        const { userId } = request.params;
        await renderAdminSection(reply, `User Pins: ${userId}`, async () => {
          const userExists = await options.repo.userExists(userId);
          if (!userExists) {
            throw new AppError('admin_user_not_found', `User with ID '${userId}' not found.`);
          }

          const board = options.pinRepo ? await options.pinRepo.getBoard(userId) : null;
          const pinsList = board?.pins ?? [];
          const pinDefMap = new Map(PINS.map((def) => [def.id, def]));

          const pinsTable = table(pinsList, [
            { header: 'Pin ID', cell: (p) => `<code>${escapeHtml(p.pinId)}</code>` },
            { header: 'Name', cell: (p) => escapeHtml(pinDefMap.get(p.pinId)?.name ?? p.pinId) },
            { header: 'Tier', cell: (p) => escapeHtml(pinDefMap.get(p.pinId)?.tier ?? '-') },
            { header: 'Track', cell: (p) => escapeHtml(pinDefMap.get(p.pinId)?.track ?? '-') },
            {
              header: 'Unlocked At',
              cell: (p) => (p.awardedAt ? `<span class="mono">${escapeHtml(p.awardedAt)}</span>` : '<span class="text-muted">Locked</span>'),
            },
            {
              header: 'Claimed At',
              cell: (p) => (p.claimedAt ? `<span class="mono">${escapeHtml(p.claimedAt)}</span>` : '-'),
            },
          ]);

          return `
            ${explainerBanner(
              '🏅',
              'User Pin Collection Diagnostic',
              'Detailed achievement and pin unlock status for this user account. The operator can trigger a global pin reconciliation batch to evaluate all accounts.',
            )}
            <div class="card">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                <h2>Pin Board Diagnostic: ${escapeHtml(userId)}</h2>
                <form method="POST" action="/admin/users/${escapeHtml(userId)}/pins/reconcile">
                  <button type="submit" class="btn">Trigger Pin Reconciliation</button>
                </form>
              </div>
              <p class="text-muted" style="margin-bottom: 1rem;">
                Total Pins: ${pinsList.length} | Unlocked: ${pinsList.filter((p) => p.awardedAt).length}
              </p>
              ${pinsTable}
            </div>
          `;
        });
      },
    );

    fastify.post<{ Params: { userId: string } }>(
      '/admin/users/:userId/pins/reconcile',
      { preHandler: options.basicAuth },
      async (request, reply) => {
        const { userId } = request.params;
        const userExists = await options.repo.userExists(userId);
        if (!userExists) {
          throw new AppError('admin_user_not_found', `User with ID '${userId}' not found.`);
        }

        const result = options.pinRepo ? await options.pinRepo.reconcileAll() : { usersProcessed: 0, pinsAwarded: 0 };

        const html = renderPage(
          'Pins Reconciled',
          `<div class="card">
            <h2>Pin Reconciliation Complete</h2>
            <p>
              Reconciled across all users (global batch): <strong>${result.pinsAwarded}</strong> newly awarded pin(s)
              for <strong>${result.usersProcessed}</strong> evaluated user accounts.
            </p>
            <p style="margin-top: 1rem;"><a href="/admin/users/${escapeHtml(userId)}/pins">&larr; Return to Pin Diagnostic</a></p>
          </div>`,
        );
        reply.type('text/html; charset=utf-8').status(200).send(html);
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 13: Growth & Engagement Counts
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/growth',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Growth & Activity', async () => {
          const totals = await options.repo.getGrowthTotals();
          const daily = await options.repo.getDailyGrowth(7);

          const dailyTable = table(daily, [
            { header: 'Date (UTC)', cell: (r) => `<span class="mono">${escapeHtml(r.date)}</span>` },
            { header: 'New Users', cell: (r) => escapeHtml(r.newUsers) },
            { header: 'Completions (by visit date)', cell: (r) => escapeHtml(r.newCompletions) },
            { header: 'Ratings*', cell: (r) => escapeHtml(r.newRatings) },
            { header: 'Notes*', cell: (r) => escapeHtml(r.newNotes) },
            { header: 'Trips*', cell: (r) => escapeHtml(r.newTrips) },
            { header: 'Food Logs*', cell: (r) => escapeHtml(r.newFoodLogs) },
          ]);

          return `
            ${explainerBanner(
              '📈',
              'Platform Growth & Activity Analytics',
              'High-level activity milestones and trailing 7-day daily trends across registrations, completed experiences, ratings, notes, and trips.',
            )}
            <div class="card">
              <p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.75rem;">
                "Completions" are counted by their user-entered visit date (<code>completed_on</code>),
                not when the row was logged — the schema has no insertion timestamp for completions.
                Columns marked * are not yet wired to a real per-day count and always read 0.
              </p>
              <h2>System-Wide Activity Totals</h2>
              <div class="metric-grid">
                <div class="metric-card">
                  <div class="metric-label">Users</div>
                  <div class="metric-val">${totals.totalUsers.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Trips</div>
                  <div class="metric-val">${totals.totalTrips.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Completions</div>
                  <div class="metric-val">${totals.totalCompletions.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Ratings</div>
                  <div class="metric-val">${totals.totalRatings.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Friendships</div>
                  <div class="metric-val">${totals.totalFriendships.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Experience Notes</div>
                  <div class="metric-val">${totals.totalNotes.toLocaleString()}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Food Logs</div>
                  <div class="metric-val">${totals.totalFoodLogs.toLocaleString()}</div>
                </div>
              </div>
            </div>
            <div class="card">
              <h2>Trailing 7-Day Daily Activity</h2>
              ${dailyTable}
            </div>
          `;
        });
      },
    );

    // -------------------------------------------------------------------------
    // Requirement 14: Configuration Visibility
    // -------------------------------------------------------------------------
    fastify.get(
      '/admin/config',
      { preHandler: options.basicAuth },
      async (_request, reply) => {
        await renderAdminSection(reply, 'Resolved Configuration', () => {
          const cfg = options.config;
          const configItems: readonly { label: string; value: string }[] = [
            { label: 'Environment (NODE_ENV)', value: String(cfg?.env ?? '-') },
            { label: 'Server Host', value: String(cfg?.server.host ?? '-') },
            { label: 'Server Port', value: String(cfg?.server.port ?? '-') },
            { label: 'Log Level', value: String(cfg?.server.logLevel ?? '-') },
            { label: 'ThemeParks Base URL', value: String(cfg?.themeparks.baseUrl ?? '-') },
            { label: 'Disney Sync Gateway URL', value: String(cfg?.disney.syncGateway.baseUrl ?? '-') },
            { label: 'Disney Dining Menu Base URL', value: String(cfg?.disney.diningMenuBaseUrl ?? '-') },
            {
              label: 'Disney Request Budget',
              value: `Max RPS: ${cfg?.disney.requestBudget.maxRequestsPerSecond ?? '-'}, Max Concurrency: ${cfg?.disney.requestBudget.maxConcurrency ?? '-'}`,
            },
            {
              label: 'Disney Backoff Policy',
              value: `Base ${cfg?.disney.backoff.baseDelayMs ?? '-'}ms, Factor ${cfg?.disney.backoff.factor ?? '-'}, Max Retries ${cfg?.disney.backoff.maxRetries ?? '-'}, Max Delay ${cfg?.disney.backoff.maxDelayMs ?? '-'}ms, Max Total ${cfg?.disney.backoff.maxTotalDelayMs ?? '-'}ms`,
            },
            { label: 'Menu Freshness (ms)', value: String(cfg?.disney.menuFreshnessMs ?? '-') },
            { label: 'Catalog Sync Interval (ms)', value: String(cfg?.disney.syncIntervalMs ?? '-') },
            { label: 'Intelligence Crowd Seed Dir', value: String(cfg?.intelligence.crowdSeedDir ?? '-') },
          ];

          const cfgTable = table(configItems, [
            { header: 'Configuration Parameter', cell: (r) => `<strong>${escapeHtml(r.label)}</strong>` },
            { header: 'Resolved Value', cell: (r) => `<span class="mono">${escapeHtml(r.value)}</span>` },
          ]);

          return `
            ${explainerBanner(
              '⚙️',
              'Resolved System Configuration',
              'Runtime system configuration values resolved by the running API server. Sensitive secrets, passwords, and tokens are strictly omitted.',
            )}
            <div class="card">
              <h2>Resolved App Configuration</h2>
              <p class="text-muted" style="margin-bottom: 1rem;">
                Non-secret configuration parameters resolved by the running API server.
                Secrets (database credentials, Redis credentials, Disney credentials, HMAC keys, and Admin credentials) are strictly omitted.
              </p>
              ${cfgTable}
            </div>
          `;
        });
      },
    );
  };
}
