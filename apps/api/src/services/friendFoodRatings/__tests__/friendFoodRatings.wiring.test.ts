/**
 * Wiring and registration tests for Friend Food Ratings (Task 3.6).
 *
 * Validates: Requirements 3.1, 3.3, Property 2 (registration)
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../../config.js';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { buildServer } from '../../../server.js';
import type { FriendFoodRatingsRepo } from '../repo.js';

function testConfig(): AppConfig {
  return {
    env: 'test',
    server: { host: '127.0.0.1', port: 0, logLevel: 'silent' },
    database: { url: 'postgres://test/dwt' },
    redis: { url: 'redis://test:6379' },
    session: { secret: 'test-session-secret-must-be-at-least-32-chars' },
    intelligence: { samplingCronSecret: 'test-sampling-secret', crowdSeedDir: 'seed-data/crowd/' },
    pins: { reconcileCronSecret: 'test-pin-reconcile-secret' },
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
      foodEnabled: true,
      tripEnabled: true,
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
  };
}

describe('friendFoodRatings.wiring — Property 2 (registration)', () => {
  // Feature: friend-food-ratings, Property 2: Only the Owner or an accepted Friend can read a Dish_Rating_Row
  it('Property 2 (registration): buildServer wires GET /users/:userId/food-ratings answering 401, not 404', async () => {
    const dummyPool = {
      query: async () => ({ rows: [] }),
    } as unknown as DbPool;

    const dummyRepo = {} as unknown as FriendFoodRatingsRepo;

    const rejectingSessionMiddleware = async () => {
      throw new AppError('unauthorized', 'Authentication required.');
    };

    const server = buildServer(testConfig(), {
      friendFoodRatings: {
        repo: dummyRepo,
        pool: dummyPool,
        requireSession: rejectingSessionMiddleware,
      },
    });

    await server.ready();

    const targetId = randomUUID();
    const res = await server.inject({
      method: 'GET',
      url: `/users/${targetId}/food-ratings`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.statusCode).not.toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');

    // Phase 2 batch endpoints registered and wired to requireSession
    const expId = randomUUID();
    const resExp = await server.inject({
      method: 'GET',
      url: `/experiences/${expId}/food-item-logs/friends`,
    });
    expect(resExp.statusCode).toBe(401);
    expect(resExp.statusCode).not.toBe(404);

    const locId = randomUUID();
    const resLoc = await server.inject({
      method: 'GET',
      url: `/locations/${locId}/food-item-logs/friends`,
    });
    expect(resLoc.statusCode).toBe(401);
    expect(resLoc.statusCode).not.toBe(404);

    await server.close();
  });

  it('Property 2 (registration): structural scan confirms composeServices.ts and server.ts wiring', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = resolve(here, '..', '..', '..');

    const composePath = resolve(srcDir, 'composeServices.ts');
    const serverPath = resolve(srcDir, 'server.ts');

    const composeSource = readFileSync(composePath, 'utf8');
    const serverSource = readFileSync(serverPath, 'utf8');

    // 1. composeServices.ts instantiates the repo with pool
    expect(composeSource).toContain('createFriendFoodRatingsRepo(');

    // 2. composeServices.ts supplies the service entry
    expect(composeSource).toContain('friendFoodRatings:');

    // 3. server.ts registers the service
    expect(serverSource).toContain('services.friendFoodRatings');
  });
});
