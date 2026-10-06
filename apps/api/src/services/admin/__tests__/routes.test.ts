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
      getParkCrowdIndexHistory: async (park) => [
        { park, date: '2026-10-01', crowdIndex: 6.5, dailyAvgWait: 35.0, sampleCount: 120 },
      ],
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
});
