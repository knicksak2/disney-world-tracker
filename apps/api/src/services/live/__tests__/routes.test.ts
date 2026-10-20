/**
 * Route integration tests for GET /parks/:park/live.
 *
 * Driven through buildServer + server.inject. Exercises:
 * - 200 with a well-formed ParkLiveSnapshotDTO
 * - 400 validation_failed on invalid :park
 * - 503 live_unavailable when service throws on failure with no cache
 * - 401 unauthorized when request has no session
 */

import type { preHandlerHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { Park, ParkLiveSnapshotDTO } from '@dwt/shared';

import type { AppConfig } from '../../../config.js';
import { AppError } from '../../../errors/AppError.js';
import { buildServer } from '../../../server.js';
import type { ParkLiveService } from '../parkLive.js';

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
      credentials: { username: 'u', password: 'p' },
      requestBudget: { maxRequestsPerSecond: 5, maxConcurrency: 4 },
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 30_000,
        maxTotalDelayMs: 120_000,
      },
      diningMenuBaseUrl: 'https://disney.invalid/menu',
      menuFreshnessMs: 86_400_000,
      syncIntervalMs: 86_400_000,
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

function sessionStub(): preHandlerHookHandler {
  return async (request, reply) => {
    const uid = request.headers['x-user-id'];
    if (typeof uid === 'string' && uid.length > 0) {
      request.userId = uid;
      return;
    }
    await reply
      .code(401)
      .send({ error: { code: 'unauthorized', message: 'No session.' } });
  };
}

describe('GET /parks/:park/live', () => {
  it('returns 200 with a well-formed ParkLiveSnapshotDTO when authenticated', async () => {
    const mockSnapshot: ParkLiveSnapshotDTO = {
      park: 'Magic Kingdom',
      entries: [
        {
          experienceId: 'exp-space-mountain',
          name: 'Space Mountain',
          status: 'OPERATING',
          waitMinutes: 45,
        },
        {
          experienceId: 'exp-buzz',
          name: 'Buzz Lightyear Space Ranger Spin',
          status: 'DOWN',
          waitMinutes: null,
        },
      ],
      retrievedAt: '2026-09-17T12:00:00.000Z',
      stale: false,
    };

    const mockService: ParkLiveService = {
      getParkLive: async (park: Park): Promise<ParkLiveSnapshotDTO> => {
        expect(park).toBe('Magic Kingdom');
        return mockSnapshot;
      },
    };

    const app = buildServer(testConfig(), {
      parkLive: {
        service: mockService,
        requireSession: sessionStub(),
      },
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/parks/Magic%20Kingdom/live',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual(mockSnapshot);
    await app.close();
  });

  it('accepts park name with alternative casing/formatting matching canonical Park enum', async () => {
    const mockService: ParkLiveService = {
      getParkLive: async (park: Park): Promise<ParkLiveSnapshotDTO> => ({
        park,
        entries: [],
        retrievedAt: '2026-09-17T12:00:00.000Z',
        stale: false,
      }),
    };

    const app = buildServer(testConfig(), {
      parkLive: {
        service: mockService,
        requireSession: sessionStub(),
      },
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/parks/EPCOT/live',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().park).toBe('EPCOT');
    await app.close();
  });

  it('returns 400 validation_failed on invalid :park parameter', async () => {
    const mockService: ParkLiveService = {
      getParkLive: async () => {
        throw new Error('should not be called');
      },
    };

    const app = buildServer(testConfig(), {
      parkLive: {
        service: mockService,
        requireSession: sessionStub(),
      },
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/parks/UniversalStudios/live',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error?.code).toBe('validation_failed');
    await app.close();
  });

  it('returns 503 live_unavailable when service throws live_unavailable on failure with no cache', async () => {
    const mockService: ParkLiveService = {
      getParkLive: async () => {
        throw new AppError(
          'live_unavailable',
          'ThemeParks.wiki unavailable and no cached snapshot exists',
        );
      },
    };

    const app = buildServer(testConfig(), {
      parkLive: {
        service: mockService,
        requireSession: sessionStub(),
      },
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/parks/Magic%20Kingdom/live',
      headers: {
        'x-user-id': 'user-123',
      },
    });

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error?.code).toBe('live_unavailable');
    await app.close();
  });

  it('returns 401 unauthorized when request has no session header', async () => {
    const mockService: ParkLiveService = {
      getParkLive: async () => {
        throw new Error('should not be called');
      },
    };

    const app = buildServer(testConfig(), {
      parkLive: {
        service: mockService,
        requireSession: sessionStub(),
      },
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/parks/Magic%20Kingdom/live',
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error?.code).toBe('unauthorized');
    await app.close();
  });
});
