/**
 * Production wiring and registration test for Trip Budget (Task 15.2 / 15.3).
 *
 * Validates:
 * - The composed app registers the Trip Budget plugin
 * - Unauthenticated GET /trips/:id/budget returns 401, not 404
 * - All budget endpoints are registered and return 401 when called without a session
 * - composeServices.ts imports no Disney live module (retirement.smoke.test.ts / Property 36)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../config.js';
import { AppError } from '../../../errors/AppError.js';
import { buildServer } from '../../../server.js';
import type { TripBudgetRepo } from '../repo.js';

function testConfig(): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, logLevel: 'silent' },
    database: { url: 'postgres://test/dwt' },
    redis: { url: 'redis://test:6379' },
    session: { secret: 'test-session-secret-must-be-at-least-32-chars' },
    intelligence: { samplingCronSecret: 'test-sampling-secret', crowdSeedDir: 'seed-data/crowd/' },
    pins: { reconcileCronSecret: 'test-pin-reconcile-secret' },
    accountDeletion: {
      graceDays: 30,
      cronSecret: 'test-account-deletion-cron-secret-12345',
      purgeBatch: 10,
      purgeTimeBudgetMs: 25000,
      reauthWindowSeconds: 300,
      chunkRows: 500,
    },
    support: { email: 'support@example.com' },
    themeparks: { baseUrl: 'https://themeparks.invalid/v1' },
    disney: {
      syncGateway: { baseUrl: 'https://disney.invalid' },
      diningMenuBaseUrl: 'https://disney.invalid/menu',
      menuFreshnessMs: 86400000,
      syncIntervalMs: 86400000,
      credentials: { username: 'u', password: 'p' },
      requestBudget: { maxRequestsPerSecond: 5, maxConcurrency: 4 },
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 5000,
        maxTotalDelayMs: 30000,
      },
    },
    tripBooking: {
      cronSecret: 'test-trip-booking-cron-secret-12345',
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
      username: 'admin',
      password: 'password',
    },
    photos: {
      enabled: false,
      foodEnabled: false,
      tripEnabled: false,
      cronSecret: 'test-photos-cron-secret',
      recapHighlightMax: 6,
      experienceStripMax: 8,
      store: {
        endpoint: 'https://test.r2.cloudflarestorage.com',
        bucket: 'test-bucket',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        region: 'auto',
      },
      harm: {
        apiKey: 'test-harm-key',
        baseUrl: 'https://api.openai.com',
        model: 'omni-moderation-latest',
        timeoutMs: 15000,
        invalidImageCodes: [],
        badRequestAlertCount: 5,
        scoreThreshold: 0.5,
        checkThumb: true,
      },
      vision: {
        apiKey: 'test-vision-key',
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
    } as unknown as AppConfig['photos'],
  };
}

describe('Trip Budget wiring and registration', () => {
  it('registers the Trip Budget plugin and returns 401 for unauthenticated requests', async () => {
    const fakeRepo = {} as TripBudgetRepo;
    const fakePool = {} as any;

    const server = buildServer(testConfig(), {
      tripBudget: {
        pool: fakePool,
        repo: fakeRepo,
        requireSession: async () => {
          throw new AppError('unauthorized', 'Session required');
        },
      },
    });

    await server.ready();

    const sampleUuid = randomUUID();
    const routesToCheck = [
      { method: 'GET', url: `/trips/${sampleUuid}/budget` },
      { method: 'GET', url: `/trips/${sampleUuid}/budget/suggestions` },
      { method: 'POST', url: `/trips/${sampleUuid}/budget/lines` },
      { method: 'PATCH', url: `/trips/${sampleUuid}/budget/lines/${sampleUuid}` },
      { method: 'DELETE', url: `/trips/${sampleUuid}/budget/lines/${sampleUuid}` },
      { method: 'PUT', url: `/trips/${sampleUuid}/budget/travelers` },
      { method: 'DELETE', url: `/trips/${sampleUuid}/budget/travelers/${sampleUuid}` },
      { method: 'PATCH', url: `/trips/${sampleUuid}/budget/settings` },
      { method: 'POST', url: `/trips/${sampleUuid}/budget/suggestions/dismiss` },
      { method: 'POST', url: `/trips/${sampleUuid}/budget/quotes` },
    ] as const;

    for (const route of routesToCheck) {
      const res = await server.inject({
        method: route.method,
        url: route.url,
      });
      expect(
        res.statusCode,
        `Route ${route.method} ${route.url} should be registered (returns 401, not 404)`,
      ).toBe(401);
    }

    await server.close();
  });

  it('composeServices.ts contains no import of Disney live modules', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const composePath = resolve(here, '..', '..', '..', 'composeServices.ts');
    const content = readFileSync(composePath, 'utf8');

    expect(content).not.toMatch(/catalog\/disney\/liveClient/);
    expect(content).not.toMatch(/catalog\/disney\/liveService/);
  });
});