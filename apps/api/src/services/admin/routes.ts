/**
 * Admin Panel routes and navigation shell.
 *
 * Validates: Requirements 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
 */

import type { FastifyPluginAsync, FastifyReply, preHandlerHookHandler } from 'fastify';
import { AppError } from '../../errors/AppError.js';
import { errorCodeToHttpStatus, PINS } from '@dwt/shared';
import type { AppConfig } from '../../config.js';
import { escapeHtml, flagged, renderPage, table } from './html.js';
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
}

export const ADMIN_SECTIONS: readonly AdminSectionLink[] = [
  {
    path: '/admin/catalog',
    title: 'Catalog & Disney Sync',
    description: 'Catalog sync history, cache staleness, data quality checks, and manual sync trigger.',
  },
  {
    path: '/admin/disney-transport',
    title: 'Disney Transport & Rate Limiter',
    description: 'Disney egress budget, dispatch/concurrency counters, and ThemeParks directory cache.',
  },
  {
    path: '/admin/intelligence/accuracy',
    title: 'Forecast Accuracy',
    description: 'Park and Experience-level wait time forecast MAE, bias, and historical logs.',
  },
  {
    path: '/admin/intelligence/model',
    title: 'Intelligence Model Internals',
    description: 'Park crowd index history, ride baseline coverage, weather sensitivities, cascades, and show patterns.',
  },
  {
    path: '/admin/intelligence/sampling',
    title: 'Sampling Pass Health',
    description: 'Sampling run history, recent execution status, and unmapped entities sample.',
  },
  {
    path: '/admin/intelligence/derived-stats',
    title: 'Derived Stats Health',
    description: 'Derived statistics calculation job status, last error, and consecutive failure counts.',
  },
  {
    path: '/admin/infra',
    title: 'Infrastructure Budget',
    description: 'Postgres database storage consumption and Upstash Redis daily command budget.',
  },
  {
    path: '/admin/accounts/lockouts',
    title: 'Account Lockouts',
    description: 'Active login lockout states and manual operator unlock trigger.',
  },
  {
    path: '/admin/notifications',
    title: 'Push Delivery Visibility',
    description: 'Recent Expo push notification deliveries, breakdown by status, and 24h summary.',
  },
  {
    path: '/admin/users',
    title: 'User & Support Lookup',
    description: 'Case-insensitive user search by email, activity totals, and session revocation.',
  },
  {
    path: '/admin/growth',
    title: 'Growth & Activity',
    description: 'High-level activity totals and trailing 7-day daily activity trends.',
  },
  {
    path: '/admin/config',
    title: 'Configuration',
    description: 'Resolved non-secret system and Disney transport configuration values.',
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
    reply.type('text/html; charset=utf-8').status(200).send(bodyHtml);
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
          const linksHtml = ADMIN_SECTIONS.map(
            (sec) => `
            <div class="card" style="margin-bottom: 1rem;">
              <h3 style="margin-top: 0; margin-bottom: 0.5rem;">
                <a href="${escapeHtml(sec.path)}">${escapeHtml(sec.title)}</a>
              </h3>
              <p style="margin: 0; color: #94a3b8;">${escapeHtml(sec.description)}</p>
            </div>`,
          ).join('\n');

          return `
            <h1>Admin Panel</h1>
            <p style="color: #94a3b8; margin-bottom: 2rem;">
              Operational observability, infrastructure health, and administrative controls.
            </p>
            <div class="grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem;">
              ${linksHtml}
            </div>
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

          const parkTable = table(parkAcc, [
            { header: 'Park', cell: (r) => escapeHtml(r.park) },
            { header: 'Lead Days', cell: (r) => escapeHtml(r.leadDays) },
            { header: 'MAE', cell: (r) => (r.mae !== null ? r.mae.toFixed(2) : '-') },
            { header: 'Bias', cell: (r) => (r.bias !== null ? r.bias.toFixed(2) : '-') },
            { header: 'Sample Count', cell: (r) => escapeHtml(r.sampleCount) },
          ]);

          const waitTable = table(waitAcc, [
            {
              header: 'Experience',
              cell: (r) =>
                `<a href="/admin/intelligence/accuracy/${escapeHtml(r.experienceId)}">${escapeHtml(r.name)}</a>`,
            },
            { header: 'Park', cell: (r) => escapeHtml(r.park) },
            { header: 'Lead Days', cell: (r) => escapeHtml(r.leadDays) },
            { header: 'MAE', cell: (r) => (r.mae !== null ? r.mae.toFixed(2) : '-') },
            { header: 'Bias', cell: (r) => (r.bias !== null ? r.bias.toFixed(2) : '-') },
            { header: 'Samples', cell: (r) => escapeHtml(r.sampleCount) },
            {
              header: 'Challenger MAE',
              cell: (r) => (r.challengerMae !== undefined && r.challengerMae !== null ? r.challengerMae.toFixed(2) : '-'),
            },
            {
              header: 'Challenger Bias',
              cell: (r) => (r.challengerBias !== undefined && r.challengerBias !== null ? r.challengerBias.toFixed(2) : '-'),
            },
            {
              header: 'Challenger Samples',
              cell: (r) => escapeHtml(r.challengerSampleCount ?? '-'),
            },
          ]);

          return `
            <div class="card">
              <h2>Park-Level Forecast Accuracy</h2>
              ${parkTable}
            </div>
            <div class="card">
              <h2>Top Experience Forecast Accuracy (Highest Sample Count)</h2>
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

          const logsTable = table(logs, [
            { header: 'Date', cell: (r) => `<span class="mono">${escapeHtml(r.targetDate)}</span>` },
            { header: 'Hour', cell: (r) => `${escapeHtml(r.targetHour)}:00` },
            {
              header: 'Predicted (min)',
              cell: (r) => (r.predictedWaitMinutes !== null ? escapeHtml(r.predictedWaitMinutes) : '-'),
            },
            {
              header: 'Observed (min)',
              cell: (r) => (r.actualWaitMinutes !== null ? escapeHtml(r.actualWaitMinutes) : '-'),
            },
            {
              header: 'Error (min)',
              cell: (r) => (r.errorMinutes !== null ? escapeHtml(r.errorMinutes) : '-'),
            },
          ]);

          return `
            <div class="card">
              <h2>${escapeHtml(exp.name)} (${escapeHtml(experienceId)})</h2>
              <p class="text-muted" style="margin-bottom: 1rem;">
                Historical forecast log comparisons (predicted vs observed standby wait times).
              </p>
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
                    </div>
                  </div>
                  <p class="text-muted" style="font-size: 0.85rem;">
                    Derived from Redis <code>INFO commandstats</code> calls since last restart/reset.
                  </p>
                </div>
              `;

          return `
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
