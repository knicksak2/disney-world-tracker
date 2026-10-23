/**
 * Test for Configuration Visibility & Secret Redaction (Requirement 14).
 *
 * Validates: Requirements 14.1, 14.2
 */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { adminRoutes } from '../routes.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo } from '../repo.js';
import type { AppConfig } from '../../../config.js';

describe('Admin Panel - Configuration Visibility & Secret Redaction (Requirement 14)', () => {
  const username = 'admin-user';
  const password = 'admin-password';
  const basicAuth = createBasicAuthHook({ username, password });
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  const fakeRepo = createAdminRepo({} as never, {} as never);

  const SENTINEL_DB_URL = 'postgres://sentinel_db_user:sentinel_db_secret_pass@db.example.com/dwt';
  const SENTINEL_REDIS_URL = 'rediss://sentinel_redis_token@redis.example.com:6379';
  const SENTINEL_SESSION_SECRET = 'super-secret-session-key-sentinel-12345';
  const SENTINEL_DISNEY_USER = 'sentinel_disney_api_user';
  const SENTINEL_DISNEY_PASS = 'sentinel_disney_api_password_secret';
  const SENTINEL_SAMPLING_SECRET = 'sentinel-sampling-cron-secret-xyz';
  const SENTINEL_PINS_SECRET = 'sentinel-pins-reconcile-secret-abc';
  const SENTINEL_TRIP_BOOKING_CRON_SECRET = 'sentinel-trip-booking-cron-secret-12345';
  const SENTINEL_ACCOUNT_DELETION_CRON_SECRET = 'sentinel-account-deletion-cron-secret-54321';
  const SENTINEL_ADMIN_USER = username;
  const SENTINEL_ADMIN_PASS = password;
  const SENTINEL_PHOTO_CRON_SECRET = 'sentinel-photo-cron-secret-67890';
  const SENTINEL_PHOTO_STORE_SECRET = 'sentinel-photo-store-secret-xyz';
  const SENTINEL_PHOTO_HARM_KEY = 'sentinel-photo-harm-key-123';
  const SENTINEL_PHOTO_VISION_KEY = 'sentinel-photo-vision-key-456';

  const sentinelConfig: AppConfig = {
    env: 'production',
    server: {
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
    },
    database: {
      url: SENTINEL_DB_URL,
    },
    redis: {
      url: SENTINEL_REDIS_URL,
    },
    session: {
      secret: SENTINEL_SESSION_SECRET,
    },
    intelligence: {
      samplingCronSecret: SENTINEL_SAMPLING_SECRET,
      crowdSeedDir: 'seed-data/crowd/',
    },
    pins: {
      reconcileCronSecret: SENTINEL_PINS_SECRET,
    },
    accountDeletion: {
      graceDays: 30,
      cronSecret: SENTINEL_ACCOUNT_DELETION_CRON_SECRET,
      purgeBatch: 10,
      purgeTimeBudgetMs: 25000,
      reauthWindowSeconds: 300,
      chunkRows: 500,
    },
    support: { email: 'support@example.com' },
    tripBooking: {
      cronSecret: SENTINEL_TRIP_BOOKING_CRON_SECRET,
      reminder: {
        leads: ['eve', 'open'],
        catchupMinutes: 180,
        minPassIntervalSeconds: 300,
        sendStartMinutes: 360,
        sendEndMinutes: 1380,
        retentionDays: 30,
      },
    },
    admin: {
      username: SENTINEL_ADMIN_USER,
      password: SENTINEL_ADMIN_PASS,
    },
    themeparks: {
      baseUrl: 'https://api.themeparks.wiki/v1',
    },
    photos: {
      enabled: false,
      foodEnabled: true,
      tripEnabled: true,
      cronSecret: SENTINEL_PHOTO_CRON_SECRET,
      recapHighlightMax: 6,
      experienceStripMax: 8,
      store: {
        endpoint: 'https://sentinel.r2.cloudflarestorage.com',
        bucket: 'sentinel-bucket',
        accessKeyId: 'sentinel-access-key',
        secretAccessKey: SENTINEL_PHOTO_STORE_SECRET,
        region: 'auto',
      },
      harm: {
        apiKey: SENTINEL_PHOTO_HARM_KEY,
        baseUrl: 'https://api.openai.com',
        model: 'omni-moderation-latest',
        timeoutMs: 15000,
        invalidImageCodes: [],
        badRequestAlertCount: 5,
        scoreThreshold: 0.5,
        checkThumb: true,
      },
      vision: {
        apiKey: SENTINEL_PHOTO_VISION_KEY,
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-3.5-flash-lite',
        fallbackModel: 'gemini-3.1-flash-lite',
        timeoutMs: 20000,
        minFoodConfidence: 0.6,
        maxProminentFaces: 0,
        maxTextFraction: 0.25,
      },
      limits: {
        dailyUploadCap: 20,
        globalDailyCap: 2000,
        maxPerFoodLog: 4,
        maxPerTrip: 300,
        maxFeedPostPhotos: 4,
        maxBatch: 10,
        maxBytes: 1048576,
        maxThumbBytes: 65536,
      },
      urls: {
        putTtlSeconds: 900,
        getTtlSeconds: 3600,
        adminTtlSeconds: 300,
      },
      moderation: {
        uploadExpiryMinutes: 120,
        maxAttempts: 6,
        leaseSeconds: 180,
        needsReviewMaxAgeHours: 120,
        uploadPrefixExpiryDays: 7,
        concurrency: 3,
        rejectedRetentionHours: 24,
      },
      reports: {
        autohideFood: 3,
        autohideTrip: 1,
      },
      sweep: {
        batch: 200,
        timeBudgetMs: 25000,
        visionFieldsRetentionDays: 30,
      },
      exif: {
        policy: 'log',
        scanBytes: 65536,
      },
    },
    disney: {
      syncGateway: {
        baseUrl: 'https://sync.disney.com/gateway',
      },
      credentials: {
        username: SENTINEL_DISNEY_USER,
        password: SENTINEL_DISNEY_PASS,
      },
      requestBudget: {
        maxRequestsPerSecond: 5,
        maxConcurrency: 4,
      },
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 30000,
        maxTotalDelayMs: 120000,
      },
      diningMenuBaseUrl: 'https://disneyworld.disney.go.com/dining-menu-api',
      menuFreshnessMs: 86400000,
      syncIntervalMs: 86400000,
    },
  };

  it('GET /admin/config renders non-secret fields and NEVER contains any sentinel secret values', async () => {
    const app = Fastify();
    void app.register(
      adminRoutes({
        repo: fakeRepo,
        config: sentinelConfig,
        basicAuth,
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/admin/config',
      headers: {
        authorization: authHeader,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.body;

    // 1. Must render non-secret fields (Requirement 14.1)
    expect(body).toContain('production');
    expect(body).toContain('0.0.0.0');
    expect(body).toContain('3000');
    expect(body).toContain('https://api.themeparks.wiki/v1');
    expect(body).toContain('https://sync.disney.com/gateway');
    expect(body).toContain('https://disneyworld.disney.go.com/dining-menu-api');
    expect(body).toContain('seed-data/crowd/');

    // 2. Must NEVER render any secret (Requirement 14.2)
    expect(body).not.toContain(SENTINEL_DB_URL);
    expect(body).not.toContain('sentinel_db_secret_pass');
    expect(body).not.toContain(SENTINEL_REDIS_URL);
    expect(body).not.toContain('sentinel_redis_token');
    expect(body).not.toContain(SENTINEL_SESSION_SECRET);
    expect(body).not.toContain(SENTINEL_DISNEY_USER);
    expect(body).not.toContain(SENTINEL_DISNEY_PASS);
    expect(body).not.toContain(SENTINEL_SAMPLING_SECRET);
    expect(body).not.toContain(SENTINEL_PINS_SECRET);
    expect(body).not.toContain(SENTINEL_TRIP_BOOKING_CRON_SECRET);
    expect(body).not.toContain(SENTINEL_ACCOUNT_DELETION_CRON_SECRET);
    expect(body).not.toContain(SENTINEL_ADMIN_USER);
    expect(body).not.toContain(SENTINEL_ADMIN_PASS);
    expect(body).not.toContain(SENTINEL_PHOTO_CRON_SECRET);
    expect(body).not.toContain(SENTINEL_PHOTO_STORE_SECRET);
    expect(body).not.toContain(SENTINEL_PHOTO_HARM_KEY);
    expect(body).not.toContain(SENTINEL_PHOTO_VISION_KEY);
  });
});
