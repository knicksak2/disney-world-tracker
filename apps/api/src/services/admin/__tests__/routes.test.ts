/**
 * Integration tests for Admin Panel routes.
 *
 * Validates: Requirements 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14
 */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { adminRoutes, ADMIN_SECTIONS } from '../routes.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo, type AdminRepo } from '../repo.js';

describe('Admin Panel Routes - Comprehensive Integration Suite', () => {
  const username = 'admin';
  const password = 'supersecretpassword';

  const basicAuth = createBasicAuthHook({ username, password });
  const validAuthHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  function createMockRepo(overrides: Partial<AdminRepo> = {}): AdminRepo {
    const base = createAdminRepo({} as never, {} as never);
    return {
      ...base,
      getRecentSyncRuns: async () => [
        {
          id: 'sync-1',
          status: 'success',
          outcome: 'success',
          started_at: new Date('2026-10-01T00:00:00Z'),
          completed_at: new Date('2026-10-01T00:05:00Z'),
          error_message: null,
          entities_processed: 350,
        },
        {
          id: 'sync-2',
          status: 'failed',
          outcome: 'waf_block',
          started_at: new Date('2026-09-30T00:00:00Z'),
          completed_at: new Date('2026-09-30T00:01:00Z'),
          error_message: 'Blocked by Akamai WAF',
          entities_processed: 0,
        },
      ],
      getCatalogDataQuality: async () => ({
        missingImageUrlCount: 5,
        missingCoordinatesCount: 2,
        unresolvedEntityCount: 1,
      }),
      getParkForecastAccuracies: async () => [
        { park: 'MK', leadDays: 0, mae: 5.2, bias: 0.1, sampleCount: 100 },
      ],
      getTopWaitForecastAccuracies: async () => [
        {
          experienceId: 'exp-1',
          name: 'Space Mountain',
          park: 'MK',
          leadDays: 0,
          mae: 6.0,
          bias: -0.5,
          sampleCount: 50,
          challengerMae: 5.5,
          challengerBias: -0.2,
          challengerSampleCount: 50,
        },
        {
          experienceId: 'exp-2',
          name: 'Big Thunder',
          park: 'MK',
          leadDays: 0,
          mae: 7.0,
          bias: 0.8,
          sampleCount: 40,
        },
      ],
      getWaitForecastHistory: async (id) => [
        {
          experienceId: id,
          targetDate: '2026-10-02',
          targetHour: 15,
          predictedWaitMinutes: 50,
          actualWaitMinutes: 55,
          errorMinutes: 5,
        },
      ],
      getExperience: async (id) =>
        id === 'exp-1' ? { id: 'exp-1', name: 'Space Mountain' } : null,
      getRideBaselineCoverage: async () => ({
        totalExperiences: 10,
        establishedCount: 8,
        coldStartCount: 2,
        coveragePercent: 80,
        topDensityExperiences: [{ experienceId: 'exp-1', name: 'Space Mountain', populatedBuckets: 25 }],
      }),
      getTopWeatherSensitivities: async () => [
        { experienceId: 'exp-1', name: 'Space Mountain', condition: 'rain', waitMultiplier: 1.1, sampleCount: 20 },
      ],
      getTopRideCascades: async () => [
        {
          downExperienceId: 'exp-1',
          downExperienceName: 'Space Mountain',
          affectedExperienceId: 'exp-2',
          affectedExperienceName: 'Buzz Lightyear',
          waitDelta: 12.0,
          waitPctDelta: 0.3,
          baselineWait: 40.0,
          sampleCount: 30,
        },
      ],
      getShowTimePatterns: async () => [
        { experienceId: 'exp-show', name: 'Parade', dayOfWeek: 1, startMinutes: 840, frequency: 1.0, sampleCount: 15 },
      ],
      // Mirrors the real repo's exact `WHERE park = $1` match against the
      // canonical full park names stored in `park_crowd_index.park` (see
      // packages/shared PARKS / samplingService's CROWD_INDEX_PARKS). Only
      // returns rows for the 4 canonical theme-park names so a caller that
      // queries with an abbreviation (e.g. 'MK') gets back an empty array,
      // just like the real DB would.
      getParkCrowdIndexHistory: async (park) =>
        (['Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom'] as const).includes(
          park as 'Magic Kingdom' | 'EPCOT' | 'Hollywood Studios' | 'Animal Kingdom',
        )
          ? [{ park, date: '2026-10-01', crowdIndex: 6.5, dailyAvgWait: 35.0, sampleCount: 120 }]
          : [],
      getRecentSamplingRuns: async () => [
        {
          id: 'samp-1',
          started_at: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
          completed_at: new Date(Date.now() - 4 * 60 * 1000),
          outcome: 'success',
          error_message: null,
          parks_sampled_count: 4,
          experiences_mapped_count: 80,
          wait_samples_recorded_count: 75,
          unmapped_with_wait_count: 1,
          unmapped_sample: [{ name: 'Unknown Kiosk', id: 'unknown-tp-1' }],
        },
      ],
      getDatabaseSizeSnapshot: async () => ({
        totalSizeBytes: 50_000_000,
        prettyTotalSize: '47.68 MB',
        percentOfBudget: 9.31,
        topTables: [{ tableName: 'wait_samples', sizeBytes: 25_000_000, prettySize: '23.84 MB' }],
      }),
      getRedisCommandBudget: async () => ({
        totalCommands: 1200,
        percentOfBudget: 12.0,
      }),
      getActiveLockouts: async () => [
        {
          userId: 'user-locked-1',
          email: 'locked@example.com',
          failedAttempts: 5,
          lockedUntilMs: Date.now() + 60000,
          isPermanent: false,
        },
      ],
      clearLockout: async (userId) => userId === 'user-locked-1',
      getRecentPushDeliveries: async () => [
        {
          id: 'push-1',
          occurredAt: '2026-10-01T12:00:00Z',
          userId: 'user-1',
          status: 'ok',
          notificationKind: 'friend_request_received',
        },
      ],
      getPushDeliveryCounts: async () => ({
        total: 100,
        ok: 90,
        deviceUnregistered: 5,
        error: 5,
      }),
      prunePushDeliveryLog: async () => 0,
      findUserByEmail: async (email) =>
        email.toLowerCase() === 'found@example.com'
          ? {
              id: 'user-1234',
              email: 'found@example.com',
              createdAt: '2026-01-01T00:00:00Z',
              displayName: 'Disney Fan',
              completionCount: 15,
              ratingCount: 12,
              noteCount: 4,
              friendCount: 3,
              tripCount: 2,
              activeSessionCount: 1,
              recentPushRegistrations: [{ id: 'reg-1', status: 'active', updatedAt: '2026-01-02T00:00:00Z' }],
            }
          : null,
      revokeAllSessions: async (userId) => (userId === 'user-1234' ? 2 : 0),
      userExists: async (userId) => userId === 'user-1234',
      getGrowthTotals: async () => ({
        totalUsers: 50,
        totalTrips: 15,
        totalCompletions: 200,
        totalRatings: 180,
        totalFriendships: 25,
        totalNotes: 30,
        totalFoodLogs: 40,
      }),
      getDailyGrowth: async () => [
        {
          date: '2026-10-02',
          newUsers: 3,
          newCompletions: 12,
          newRatings: 10,
          newNotes: 2,
          newTrips: 1,
          newFoodLogs: 5,
        },
      ],
      ...overrides,
    };
  }

  function buildApp(optionsOverride: Record<string, any> = {}) {
    const app = Fastify();
    const { repo: repoOverride, ...restOverrides } = optionsOverride;
    const repo = createMockRepo(repoOverride);

    void app.register(
      adminRoutes({
        repo,
        catalogRepo: {
          getCacheAge: async () => ({ hours: 1.5, lastSuccessfulSyncAt: new Date('2026-10-01T12:00:00Z') }),
        } as never,
        intelligenceRepo: {
          getDerivedStatRuns: async () => [
            {
              leg: 'weather',
              last_success_at: new Date('2026-10-01T04:00:00Z'),
              last_error_at: null,
              last_error: null,
              consecutive_failures: 0,
            },
            {
              leg: 'cascades',
              last_success_at: null,
              last_error_at: new Date('2026-10-01T04:05:00Z'),
              last_error: 'Connection timeout',
              consecutive_failures: 2,
            },
          ],
        } as never,
        pinRepo: {
          getBoard: async () => ({
            pins: [
              { pinId: 'gold_coaster_royalty', unlocked: true, awardedAt: '2026-10-01T00:00:00Z', claimedAt: null, currentValue: 10, targetValue: 10, percentComplete: 100 },
              { pinId: 'silver_epcot_explorer', unlocked: false, awardedAt: null, claimedAt: null, currentValue: 2, targetValue: 5, percentComplete: 40 },
            ],
            tierSummary: [],
            totalUnlocked: 1,
            totalPins: 2,
            overallPercent: 50,
          }),
          reconcileAll: async () => ({ usersProcessed: 10, pinsAwarded: 3 }),
        } as never,
        runCatalogSync: async () => {},
        isSyncInProgress: async () => false,
        getRateLimiterSnapshot: async () => ({
          syncGateway: { currentRps: 2, maxRps: 5, currentConcurrency: 1, maxConcurrency: 4 },
          web: { currentRps: 1, maxRps: 5, currentConcurrency: 0, maxConcurrency: 4 },
        }),
        getDirectorySnapshot: async () => ({
          builtAtMs: Date.now() - 3600000,
          entryCount: 420,
          ttlMs: 43200000,
        }),
        basicAuth,
        ...restOverrides,
      }),
    );

    return app;
  }

  // ---------------------------------------------------------------------------
  // Shell & Auth (Requirement 1 & 2)
  // ---------------------------------------------------------------------------
  it('GET /admin - 401 without credentials, 200 with credentials', async () => {
    const app = buildApp();
    const unauth = await app.inject({ method: 'GET', url: '/admin' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['www-authenticate']).toBe('Basic realm="admin"');
    expect(unauth.headers['x-robots-tag']).toBe('noindex, nofollow');

    const auth = await app.inject({
      method: 'GET',
      url: '/admin',
      headers: { authorization: validAuthHeader },
    });
    expect(auth.statusCode).toBe(200);
    expect(auth.headers['x-robots-tag']).toBe('noindex, nofollow');
    for (const section of ADMIN_SECTIONS) {
      expect(auth.body).toContain(section.path);
    }
  });

  // ---------------------------------------------------------------------------
  // Requirement 3: Catalog & Disney Sync
  // ---------------------------------------------------------------------------
  it('GET /admin/catalog - renders cache age, sync runs, WAF flag, and data quality', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/catalog',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('1.50 hours ago');
    expect(res.body).toContain('Missing Image URL');
    expect(res.body).toContain('waf_block');
    expect(res.body).toContain('Blocked by Akamai WAF');
  });

  it('POST /admin/catalog/sync - triggers sync with 202 on happy path', async () => {
    let syncTriggered = false;
    const app = buildApp({
      isSyncInProgress: async () => false,
      runCatalogSync: async () => {
        syncTriggered = true;
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/catalog/sync',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(202);
    expect(res.body).toContain('Catalog Sync Initiated');
    expect(syncTriggered).toBe(true);
  });

  it('POST /admin/catalog/sync - returns 409 admin_sync_already_running when lock held', async () => {
    const app = buildApp({
      isSyncInProgress: async () => true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/admin/catalog/sync',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('admin_sync_already_running');
  });

  // ---------------------------------------------------------------------------
  // Requirement 4: Disney Transport & Rate Limiter
  // ---------------------------------------------------------------------------
  it('GET /admin/disney-transport - renders rate limiter and directory snapshot', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/disney-transport',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sync Gateway RPS');
    expect(res.body).toContain('2 / 5');
    expect(res.body).toContain('Resolved Entities');
    expect(res.body).toContain('420');
  });

  it('GET /admin/disney-transport - renders graceful unavailable on Redis error', async () => {
    const app = buildApp({
      getRateLimiterSnapshot: async () => {
        throw new Error('Redis connection refused');
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/disney-transport',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Redis-backed rate-limiter counters unreachable');
    expect(res.body).toContain('Resolved Entities');
  });

  // ---------------------------------------------------------------------------
  // Requirement 5: Forecast Accuracy
  // ---------------------------------------------------------------------------
  it('GET /admin/intelligence/accuracy - renders park and experience accuracies with challenger columns', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/intelligence/accuracy',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Space Mountain');
    expect(res.body).toContain('5.50'); // Challenger MAE
    expect(res.body).toContain('Big Thunder');
    expect(res.body).toContain('Metric Interpretation Reference Guide');
    expect(res.body).toContain('Avg Attraction Error (MAE)');
    expect(res.body).toContain('Attraction Bias (Direction)');
    expect(res.body).toContain('Park Crowd Error (1-Day MAE)');
    expect(res.body).toContain('Lead Horizon');
  });

  it('GET /admin/intelligence/accuracy/:experienceId - 200 on found, 404 admin_experience_not_found on miss', async () => {
    const app = buildApp();
    const hit = await app.inject({
      method: 'GET',
      url: '/admin/intelligence/accuracy/exp-1',
      headers: { authorization: validAuthHeader },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.body).toContain('Space Mountain');
    expect(hit.body).toContain('2026-10-02');
    expect(hit.body).toContain('Historical Logs');
    expect(hit.body).toContain('Avg Observed Wait');
    expect(hit.body).toContain('Prediction Error');

    const miss = await app.inject({
      method: 'GET',
      url: '/admin/intelligence/accuracy/exp-nonexistent',
      headers: { authorization: validAuthHeader },
    });
    expect(miss.statusCode).toBe(404);
    expect(miss.body).toContain('admin_experience_not_found');
  });

  // ---------------------------------------------------------------------------
  // Requirement 6: Intelligence Model Internals
  // ---------------------------------------------------------------------------
  it('GET /admin/intelligence/model - renders crowd history, baselines, weather, cascades, showtimes', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/intelligence/model',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Ride Baseline Coverage');
    expect(res.body).toContain('80.0%');
    expect(res.body).toContain('Learned Weather Sensitivities');
    expect(res.body).toContain('Learned Ride Cascades');
    expect(res.body).toContain('Show Time Patterns');
    expect(res.body).toContain('14:00'); // 840 mins rendered as clock time

    // Regression guard: the route must query getParkCrowdIndexHistory using the
    // canonical full park names ('Magic Kingdom', 'Hollywood Studios', 'Animal
    // Kingdom'), not abbreviations ('MK', 'HS', 'AK'). Querying with an
    // abbreviation against the real `park_crowd_index` table (keyed by full
    // name) silently returns zero rows, which previously rendered as empty
    // "No entries found" tables for 3 of the 4 theme parks. All four must show
    // a populated row and none may render as empty.
    expect(res.body).toContain('Magic Kingdom - 14 Day Crowd Index History');
    expect(res.body).toContain('EPCOT - 14 Day Crowd Index History');
    expect(res.body).toContain('Hollywood Studios - 14 Day Crowd Index History');
    expect(res.body).toContain('Animal Kingdom - 14 Day Crowd Index History');
    expect(res.body).not.toContain('MK - 14 Day Crowd Index History');
    expect(res.body).not.toContain('HS - 14 Day Crowd Index History');
    expect(res.body).not.toContain('AK - 14 Day Crowd Index History');
    expect(res.body).not.toContain('No entries found');
  });

  // ---------------------------------------------------------------------------
  // Requirement 7: Sampling & Derived Stats Health
  // ---------------------------------------------------------------------------
  it('GET /admin/intelligence/sampling - renders healthy or degraded badge and unmapped sample', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/intelligence/sampling',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Healthy');
    expect(res.body).toContain('Unknown Kiosk');
  });

  it('GET /admin/intelligence/derived-stats - renders legs and flags consecutive failures', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/intelligence/derived-stats',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('weather');
    expect(res.body).toContain('cascades');
    expect(res.body).toContain('2 failures');
  });

  // ---------------------------------------------------------------------------
  // Requirement 8: Infrastructure Budget
  // ---------------------------------------------------------------------------
  it('GET /admin/infra - renders database size and Redis command budget', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/infra',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('47.68 MB');
    expect(res.body).toContain('wait_samples');
    expect(res.body).toContain('1,200');
  });

  it('GET /admin/infra - renders unavailable when Redis budget is null', async () => {
    const app = buildApp({
      repo: {
        getRedisCommandBudget: async () => null,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/infra',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Unavailable: Redis INFO commandstats not exposed');
  });

  // ---------------------------------------------------------------------------
  // Requirement 9: Account Lockouts
  // ---------------------------------------------------------------------------
  it('GET /admin/accounts/lockouts - lists locked accounts', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/accounts/lockouts',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('locked@example.com');
    expect(res.body).toContain('user-locked-1');
  });

  it('POST /admin/accounts/:userId/unlock - unlocks account on hit, handles miss', async () => {
    const app = buildApp();
    const hit = await app.inject({
      method: 'POST',
      url: '/admin/accounts/user-locked-1/unlock',
      headers: { authorization: validAuthHeader },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.body).toContain('Successfully deleted lockout keys');

    const miss = await app.inject({
      method: 'POST',
      url: '/admin/accounts/user-unknown/unlock',
      headers: { authorization: validAuthHeader },
    });
    expect(miss.statusCode).toBe(200);
    expect(miss.body).toContain('No active lockout found');
  });

  // ---------------------------------------------------------------------------
  // Requirement 10: Push Deliveries
  // ---------------------------------------------------------------------------
  it('GET /admin/notifications - renders recent deliveries and 24h summary', async () => {
    let pruneCalled = false;
    const app = buildApp({
      repo: {
        prunePushDeliveryLog: async () => {
          pruneCalled = true;
          return 0;
        },
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/admin/notifications',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Healthy: 90 successful');
    expect(res.body).toContain('friend_request_received');
    expect(pruneCalled).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Requirement 11: User Lookup & Support
  // ---------------------------------------------------------------------------
  it('GET /admin/users - renders search form, user details on hit, and not-found on miss', async () => {
    const app = buildApp();
    const blank = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: validAuthHeader },
    });
    expect(blank.statusCode).toBe(200);
    expect(blank.body).toContain('Lookup User by Email');

    const hit = await app.inject({
      method: 'GET',
      url: '/admin/users?email=found@example.com',
      headers: { authorization: validAuthHeader },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.body).toContain('found@example.com');
    expect(hit.body).toContain('Disney Fan');
    expect(hit.body).toContain('Completions');

    const miss = await app.inject({
      method: 'GET',
      url: '/admin/users?email=notfound@example.com',
      headers: { authorization: validAuthHeader },
    });
    expect(miss.statusCode).toBe(200);
    expect(miss.body).toContain('No matching account was found');
  });

  it('POST /admin/users/:userId/revoke-sessions - revokes active sessions', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/user-1234/revoke-sessions',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Revoked <strong>2</strong> active session(s)');
  });

  // ---------------------------------------------------------------------------
  // Requirement 12: Pin Collection Diagnostic
  // ---------------------------------------------------------------------------
  it('GET /admin/users/:userId/pins - 200 with board on hit, 404 admin_user_not_found on miss', async () => {
    const app = buildApp();
    const hit = await app.inject({
      method: 'GET',
      url: '/admin/users/user-1234/pins',
      headers: { authorization: validAuthHeader },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.body).toContain('Pin Board Diagnostic');
    expect(hit.body).toContain('Coaster Royalty');

    const miss = await app.inject({
      method: 'GET',
      url: '/admin/users/user-nonexistent/pins',
      headers: { authorization: validAuthHeader },
    });
    expect(miss.statusCode).toBe(404);
    expect(miss.body).toContain('admin_user_not_found');
  });

  it('POST /admin/users/:userId/pins/reconcile - 200 with counts on hit, 404 on miss', async () => {
    const app = buildApp();
    const hit = await app.inject({
      method: 'POST',
      url: '/admin/users/user-1234/pins/reconcile',
      headers: { authorization: validAuthHeader },
    });
    expect(hit.statusCode).toBe(200);
    expect(hit.body).toContain('3</strong> newly awarded pin(s)');

    const miss = await app.inject({
      method: 'POST',
      url: '/admin/users/user-nonexistent/pins/reconcile',
      headers: { authorization: validAuthHeader },
    });
    expect(miss.statusCode).toBe(404);
    expect(miss.body).toContain('admin_user_not_found');
  });

  // ---------------------------------------------------------------------------
  // Requirement 13: Growth & Activity
  // ---------------------------------------------------------------------------
  it('GET /admin/growth - renders totals and trailing 7-day daily activity', async () => {
    const app = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/growth',
      headers: { authorization: validAuthHeader },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('System-Wide Activity Totals');
    expect(res.body).toContain('200'); // completions
    expect(res.body).toContain('2026-10-02');
  });

  // ---------------------------------------------------------------------------
  // Requirement 16: Viewer-local timestamps
  // ---------------------------------------------------------------------------
  describe('viewer-local timestamps (Requirement 16)', () => {
    /** The exact markup `localTime` emits for an ISO-8601 UTC instant. */
    function timeTag(iso: string): string {
      const fallback = `${iso.slice(0, 19).replace('T', ' ')} UTC`;
      return `<time class="mono" data-local-time datetime="${iso}" title="${iso}">${fallback}</time>`;
    }

    const SAMPLING_STARTED = '2026-10-01T10:00:00.000Z';
    const SAMPLING_COMPLETED = '2026-10-01T10:01:00.000Z';
    const BUILT_AT_MS = Date.parse('2026-10-01T09:30:00Z');

    const fixedOverrides = {
      repo: {
        getRecentSamplingRuns: async () => [
          {
            id: 'samp-fixed',
            started_at: new Date(SAMPLING_STARTED),
            completed_at: new Date(SAMPLING_COMPLETED),
            outcome: 'success',
            error_message: null,
            parks_sampled_count: 4,
            experiences_mapped_count: 80,
            wait_samples_recorded_count: 75,
            unmapped_with_wait_count: 0,
            unmapped_sample: [],
          },
        ],
      },
      getDirectorySnapshot: async () => ({ builtAtMs: BUILT_AT_MS, entryCount: 420, ttlMs: 43200000 }),
    };

    async function get(app: ReturnType<typeof buildApp>, url: string) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: validAuthHeader } });
      expect(res.statusCode).toBe(200);
      return res.body;
    }

    function scriptCount(body: string): number {
      return (body.match(/<script>/g) ?? []).length;
    }

    it('/admin/catalog - sync run started/completed and last-synced render as <time> elements', async () => {
      const body = await get(buildApp(), '/admin/catalog');
      expect(body).toContain(timeTag('2026-10-01T00:00:00.000Z')); // sync-1 started
      expect(body).toContain(timeTag('2026-10-01T00:05:00.000Z')); // sync-1 completed
      expect(body).toContain(timeTag('2026-09-30T00:00:00.000Z')); // sync-2 started
      expect(body).toContain(timeTag('2026-09-30T00:01:00.000Z')); // sync-2 completed
      expect(body).toContain(`1.50 hours ago (last synced ${timeTag('2026-10-01T12:00:00.000Z')})`);
      expect(scriptCount(body)).toBe(1);
      expect(body).toContain("Timestamps are shown in your browser's time zone");
    });

    it('/admin/catalog - a run with completed_at null renders "-" in the Completed cell, and no cache renders text only', async () => {
      const running = {
        id: 'sync-running',
        status: 'running',
        outcome: null,
        started_at: new Date('2026-10-02T00:00:00Z'),
        completed_at: null,
        error_message: null,
        entities_processed: null,
      };
      const body = await get(
        buildApp({ repo: { getRecentSyncRuns: async () => [running] } }),
        '/admin/catalog',
      );
      expect(body).toContain(timeTag('2026-10-02T00:00:00.000Z'));
      // started tag is followed by the completed '-' cell
      expect(body).toMatch(/<\/time><\/td><td>-<\/td>/);

      const noCache = await get(
        buildApp({ catalogRepo: { getCacheAge: async () => ({ hours: null, lastSuccessfulSyncAt: null }) } }),
        '/admin/catalog',
      );
      expect(noCache).toContain('No cache recorded');
    });

    it('/admin/catalog - a null lastSuccessfulSyncAt renders "-" in the last-synced text', async () => {
      const body = await get(
        buildApp({ catalogRepo: { getCacheAge: async () => ({ hours: 2, lastSuccessfulSyncAt: null }) } }),
        '/admin/catalog',
      );
      expect(body).toContain('2.00 hours ago (last synced -)');
    });

    it('/admin/disney-transport - directory Built At renders as a <time> element; unbuilt stays "Not built"', async () => {
      const body = await get(buildApp(fixedOverrides), '/admin/disney-transport');
      expect(body).toContain(timeTag(new Date(BUILT_AT_MS).toISOString()));
      expect(scriptCount(body)).toBe(1);

      const unbuilt = await get(
        buildApp({ getDirectorySnapshot: async () => ({ builtAtMs: null, entryCount: 0, ttlMs: 43200000 }) }),
        '/admin/disney-transport',
      );
      expect(unbuilt).toContain('Not built');
      expect(unbuilt).not.toContain('<time');
    });

    it('/admin/intelligence/sampling - Started At and Completed At render as <time> elements', async () => {
      const body = await get(buildApp(fixedOverrides), '/admin/intelligence/sampling');
      expect(body).toContain(timeTag(SAMPLING_STARTED));
      expect(body).toContain(timeTag(SAMPLING_COMPLETED));
      expect(scriptCount(body)).toBe(1);
    });

    it('/admin/intelligence/derived-stats - Last Success / Last Error At render <time> or "-" per leg', async () => {
      const body = await get(buildApp(), '/admin/intelligence/derived-stats');
      expect(body).toContain(timeTag('2026-10-01T04:00:00.000Z')); // weather last success
      expect(body).toContain(timeTag('2026-10-01T04:05:00.000Z')); // cascades last error
      // weather row: success tag then '-' for last error; cascades row: '-' for success then tag.
      expect(body).toMatch(/weather[\s\S]*?<\/time><\/td><td>-<\/td>/);
      expect(body).toMatch(/cascades[\s\S]*?<td>-<\/td><td><time [^>]*datetime="2026-10-01T04:05:00\.000Z"/);
      expect(scriptCount(body)).toBe(1);
    });

    it('/admin/notifications - Occurred At is normalized to a <time> element', async () => {
      const body = await get(buildApp(), '/admin/notifications');
      // Input had no milliseconds; the emitted instant is normalized to .000Z.
      expect(body).toContain(timeTag('2026-10-01T12:00:00.000Z'));
      expect(scriptCount(body)).toBe(1);
    });

    it('/admin/users?email= - account Created At and push registration Updated At render as <time> elements', async () => {
      const body = await get(buildApp(), '/admin/users?email=found@example.com');
      expect(body).toContain(timeTag('2026-01-01T00:00:00.000Z'));
      expect(body).toContain(timeTag('2026-01-02T00:00:00.000Z'));
      expect(scriptCount(body)).toBe(1);
    });

    it('/admin/users/:id/pins - Unlocked At and Claimed At render <time>, "Locked" and "-" otherwise', async () => {
      const claimedPinRepo = {
        getBoard: async () => ({
          pins: [
            { pinId: 'gold_coaster_royalty', unlocked: true, awardedAt: '2026-10-01T00:00:00Z', claimedAt: '2026-10-03T08:30:00Z', currentValue: 10, targetValue: 10, percentComplete: 100 },
            { pinId: 'silver_epcot_explorer', unlocked: false, awardedAt: null, claimedAt: null, currentValue: 2, targetValue: 5, percentComplete: 40 },
          ],
          tierSummary: [],
          totalUnlocked: 1,
          totalPins: 2,
          overallPercent: 50,
        }),
        reconcileAll: async () => ({ usersProcessed: 0, pinsAwarded: 0 }),
      };
      const body = await get(buildApp({ pinRepo: claimedPinRepo }), '/admin/users/user-1234/pins');
      expect(body).toContain(timeTag('2026-10-01T00:00:00.000Z')); // unlocked
      expect(body).toContain(timeTag('2026-10-03T08:30:00.000Z')); // claimed
      expect(body).toContain('<span class="text-muted">Locked</span></td><td>-</td>');

      const unclaimed = await get(buildApp(), '/admin/users/user-1234/pins');
      expect(unclaimed).toContain(timeTag('2026-10-01T00:00:00.000Z'));
      expect(unclaimed).toContain('<span class="text-muted">Locked</span></td><td>-</td>');
    });

    // Feature: admin-panel, Property 10: Calendar-date buckets are never converted
    it('/admin/growth - the "Date (UTC)" bucket keeps its header and renders the bare date, not a <time>', async () => {
      const body = await get(buildApp(), '/admin/growth');
      expect(body).toContain('<th>Date (UTC)</th>');
      expect(body).toContain('<td><span class="mono">2026-10-02</span></td>');
      expect(body).not.toContain('<time');
      expect(scriptCount(body)).toBe(1);
    });

    it('park-calendar dates and minute-of-day show times are not converted', async () => {
      const model = await get(buildApp(), '/admin/intelligence/model');
      expect(model).toContain('14:00'); // 840 minutes, park-local clock time
      expect(model).not.toContain('<time');
      const accuracy = await get(buildApp(), '/admin/intelligence/accuracy/exp-1');
      expect(accuracy).toContain('2026-10-02');
      expect(accuracy).not.toContain('<time');
    });

    it('the old raw-UTC rendering (bare ISO mono span, String(Date) output) is gone from every converted page', async () => {
      const pages = [
        '/admin/catalog',
        '/admin/disney-transport',
        '/admin/intelligence/sampling',
        '/admin/intelligence/derived-stats',
        '/admin/notifications',
        '/admin/users?email=found@example.com',
        '/admin/users/user-1234/pins',
      ];
      for (const url of pages) {
        const body = await get(buildApp(fixedOverrides), url);
        expect(body, url).not.toMatch(/<span class="mono">\d{4}-\d{2}-\d{2}T[\d:.]+Z<\/span>/);
        expect(body, url).not.toMatch(/GMT[+-]\d{4}/);
        expect(body, url).not.toContain('Coordinated Universal Time');
        expect(body, url).toContain('data-local-time');
        expect(scriptCount(body), url).toBe(1);
      }
    });

    it('a malicious timestamp value is escaped and the page still has exactly one real <script>', async () => {
      const body = await get(
        buildApp({
          repo: {
            getRecentPushDeliveries: async () => [
              {
                id: 'push-evil',
                occurredAt: '<script>alert(1)</script>',
                userId: 'user-1',
                status: 'ok',
                notificationKind: 'friend_request_received',
              },
            ],
          },
        }),
        '/admin/notifications',
      );
      expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(body).not.toContain('<script>alert(1)</script>');
      expect(scriptCount(body)).toBe(1);
    });

    it('the 401 response from basicAuth is untouched: plain, no script', async () => {
      const app = buildApp();
      const unauth = await app.inject({ method: 'GET', url: '/admin/catalog' });
      expect(unauth.statusCode).toBe(401);
      expect(unauth.body).not.toContain('<script');
      expect(unauth.body).not.toContain('data-local-time');
    });
  });
});
