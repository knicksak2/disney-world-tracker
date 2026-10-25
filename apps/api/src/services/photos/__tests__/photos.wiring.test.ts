/**
 * Production wiring and registration tests for Photo Uploads (Task 9.4).
 *
 * Validates: Requirements 6.6, 10.8, 20.2, 25.1
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '../../../config.js';
import { AppError } from '../../../errors/AppError.js';
import { buildServer } from '../../../server.js';
import type { PhotoService } from '../service.js';
import type { SweepRunner } from '../sweep.js';
import type { FoodItemLogRepo } from '../../foodLog/repo.js';

function testConfig(enabled = true): AppConfig {
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
      enabled,
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

describe('photos.wiring — Task 9.4', () => {
  it('registers all 17 photos routes when photos are enabled (answering non-404)', async () => {
    const dummyPhotoService = {
      enabled: true,
      getClientConfig: async () => ({
        enabled: true,
        foodEnabled: true,
        tripEnabled: true,
        maxPerFoodLog: 4,
        maxPerTrip: 300,
        maxFeedPostPhotos: 4,
        maxBatch: 10,
        maxBytes: 1048576,
        maxThumbBytes: 65536,
        dailyCap: 20,
        remainingToday: 20,
        experienceStripMax: 8,
      }),
    } as unknown as PhotoService;

    const dummySweepRunner: SweepRunner = {
      tryStart: () => ({ started: true }),
      runOnce: async () => ({
        resumed: 0,
        expiredUploading: 0,
        expiredRejected: 0,
        expiredNeedsReview: 0,
        reapedOrphans: 0,
        deletedObjects: 0,
        deletedRows: 0,
        cleanedUploads: 0,
        budgetExhausted: false,
      }),
    };

    const rejectingSessionMiddleware = async () => {
      throw new AppError('unauthorized', 'Authentication required.');
    };

    const server = buildServer(testConfig(true), {
      photos: {
        photoService: dummyPhotoService,
        requireSession: rejectingSessionMiddleware,
        enabled: true,
        sweepRunner: dummySweepRunner,
        cronSecret: 'test-photos-cron-secret',
      },
    });

    await server.ready();

    const sampleUuid = randomUUID();

    // 1. Core routes
    const routesToCheck: Array<{ method: 'GET' | 'POST' | 'DELETE' | 'HEAD'; url: string }> = [
      { method: 'GET', url: '/photos/config' },
      { method: 'POST', url: '/photos/uploads' },
      { method: 'POST', url: '/photos/confirm' },
      { method: 'GET', url: `/photos/${sampleUuid}` },
      { method: 'GET', url: `/me/photos/status?ids=${sampleUuid}` },
      { method: 'GET', url: '/me/photos' },
      { method: 'GET', url: '/me/photos/all' },
      { method: 'DELETE', url: `/photos/${sampleUuid}` },
      { method: 'POST', url: `/photos/${sampleUuid}/report` },
      { method: 'POST', url: '/me/blocks' },
      { method: 'DELETE', url: `/me/blocks/${sampleUuid}` },
      { method: 'GET', url: '/me/blocks' },
      // 2. Food read routes
      { method: 'GET', url: `/food-items/${sampleUuid}/photos` },
      { method: 'GET', url: `/experiences/${sampleUuid}/food-photos` },
      { method: 'GET', url: `/locations/${sampleUuid}/food-photos` },
      // 3. Sweep cron route
      { method: 'POST', url: '/internal/photos/sweep/run' },
      { method: 'HEAD', url: '/internal/photos/sweep/run' },
    ];

    for (const route of routesToCheck) {
      const res = await server.inject({
        method: route.method,
        url: route.url,
      });
      expect(res.statusCode, `Route ${route.method} ${route.url} should be registered (not 404)`).not.toBe(404);
    }

    await server.close();
  });

  it('when photos are disabled, only GET /photos/config is registered and reports enabled: false', async () => {
    const server = buildServer(testConfig(false), {
      photos: {
        requireSession: async () => {},
        enabled: false,
      },
    });

    await server.ready();

    // GET /photos/config returns 200 with enabled: false
    const configRes = await server.inject({
      method: 'GET',
      url: '/photos/config',
    });
    expect(configRes.statusCode).toBe(200);
    const body = configRes.json();
    expect(body.enabled).toBe(false);
    expect(body.remainingToday).toBe(0);

    // Other photo routes are 404
    const sampleUuid = randomUUID();
    const otherRoutes: Array<{ method: 'GET' | 'POST' | 'DELETE' | 'HEAD'; url: string }> = [
      { method: 'POST', url: '/photos/uploads' },
      { method: 'POST', url: '/photos/confirm' },
      { method: 'GET', url: `/photos/${sampleUuid}` },
      { method: 'GET', url: '/me/photos/all' },
      { method: 'GET', url: `/food-items/${sampleUuid}/photos` },
      { method: 'GET', url: `/experiences/${sampleUuid}/food-photos` },
      { method: 'GET', url: `/locations/${sampleUuid}/food-photos` },
      { method: 'POST', url: '/internal/photos/sweep/run' },
      { method: 'HEAD', url: '/internal/photos/sweep/run' },
    ];

    for (const route of otherRoutes) {
      const res = await server.inject({
        method: route.method,
        url: route.url,
      });
      expect(res.statusCode, `Route ${route.method} ${route.url} must be 404 when disabled`).toBe(404);
    }

    await server.close();
  });

  it('deleting a food log invokes photoLifecycle.softDeleteForTarget("food_log", logId)', async () => {
    const softDeleteMock = vi.fn().mockResolvedValue(1);
    const dummyPhotoLifecycle = {
      softDeleteForTarget: softDeleteMock,
    };

    const deleteLogMock = vi.fn().mockResolvedValue(true);
    const dummyLogRepo: Partial<FoodItemLogRepo> = {
      deleteLog: deleteLogMock,
    };

    const dummySessionMiddleware = async (req: { userId?: string }) => {
      req.userId = randomUUID();
    };

    const server = buildServer(testConfig(true), {
      foodLog: {
        logs: {
          repo: dummyLogRepo as FoodItemLogRepo,
          requireSession: dummySessionMiddleware as never,
          photoLifecycle: dummyPhotoLifecycle,
        },
      },
    });

    await server.ready();

    const foodItemId = randomUUID();
    const logId = randomUUID();

    const res = await server.inject({
      method: 'DELETE',
      url: `/me/food-items/${foodItemId}/logs/${logId}`,
    });

    expect(res.statusCode).toBe(204);
    expect(deleteLogMock).toHaveBeenCalledWith(expect.any(String), foodItemId, logId);
    expect(softDeleteMock).toHaveBeenCalledWith('food_log', logId);

    await server.close();
  });

  it('with photos disabled, deleting a food log behaves exactly as before (204, no photoLifecycle)', async () => {
    const deleteLogMock = vi.fn().mockResolvedValue(true);
    const dummyLogRepo: Partial<FoodItemLogRepo> = {
      deleteLog: deleteLogMock,
    };

    const dummySessionMiddleware = async (req: { userId?: string }) => {
      req.userId = randomUUID();
    };

    const server = buildServer(testConfig(false), {
      foodLog: {
        logs: {
          repo: dummyLogRepo as FoodItemLogRepo,
          requireSession: dummySessionMiddleware as never,
          // photoLifecycle is undefined when photos are disabled
        },
      },
    });

    await server.ready();

    const foodItemId = randomUUID();
    const logId = randomUUID();

    const res = await server.inject({
      method: 'DELETE',
      url: `/me/food-items/${foodItemId}/logs/${logId}`,
    });

    expect(res.statusCode).toBe(204);
    expect(deleteLogMock).toHaveBeenCalledWith(expect.any(String), foodItemId, logId);

    await server.close();
  });

  it('structural scan verifies composeServices.ts and server.ts wiring', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = resolve(here, '..', '..', '..');

    const composePath = resolve(srcDir, 'composeServices.ts');
    const serverPath = resolve(srcDir, 'server.ts');

    const composeSource = readFileSync(composePath, 'utf8');
    const serverSource = readFileSync(serverPath, 'utf8');

    // 1. composeServices.ts constructs photo infrastructure when enabled
    expect(composeSource).toContain('createPhotosRepo(pool)');
    expect(composeSource).toContain('createReportsRepo(pool)');
    expect(composeSource).toContain('new FoodLogTarget(');
    expect(composeSource).toContain('new R2ObjectStore(');
    expect(composeSource).toContain('new OpenAIHarmModerator(');
    expect(composeSource).toContain('new GeminiVisionChecker(');
    expect(composeSource).toContain('new ModerationRunner(');
    expect(composeSource).toContain('new PhotoService(');
    expect(composeSource).toContain('createSweepRunner(');

    // 2. composeServices.ts wires photoLifecycle into foodLog.logs
    expect(composeSource).toContain('photoLifecycle: photoService');

    // 3. composeServices.ts passes photos to buildServer
    expect(composeSource).toContain('photos: {');

    // 4. server.ts declares PhotosRoutesOptions and registers photo routes
    expect(serverSource).toContain('PhotosRoutesOptions');
    expect(serverSource).toContain('services.photos');
    expect(serverSource).toContain('app.register(photoRoutes');
    expect(serverSource).toContain('app.register(foodReadRoutes');
    expect(serverSource).toContain('app.register(sweepCronRoute');

    // 5. Task 10.2: composeServices.ts configures adminPhotos and passes to admin
    expect(composeSource).toContain('adminPhotos =');
    expect(composeSource).toContain('photos: adminPhotos');
  });

  it('Task 10.2: buildServer with photos enabled registers admin photo review queue with thumbnails', async () => {
    const sampleId = randomUUID();
    const dummyAdminRepo: any = {
      listPhotoQueue: vi.fn().mockResolvedValue([
        {
          id: sampleId,
          targetKind: 'food_log',
          status: 'hidden',
          ownerId: randomUUID(),
          uploaderName: 'Alice',
          avatarPreset: 'castle',
          createdAt: new Date(),
          objectKey: `p/${sampleId}/full.jpg`,
          thumbKey: `p/${sampleId}/thumb.jpg`,
          visionFields: null,
          reportCount: 1,
          reportReasons: ['spam'],
        },
      ]),
      getPhotoUsage: vi.fn().mockResolvedValue([]),
    };

    const presignMock = vi.fn().mockResolvedValue(`https://cdn.example.com/p/${sampleId}/thumb.jpg`);
    const approveMock = vi.fn().mockResolvedValue({ success: true });

    const dummyPhotoPort = {
      presignGet: presignMock,
      operatorApprove: approveMock,
    };

    const server = buildServer(testConfig(true), {
      admin: {
        repo: dummyAdminRepo,
        basicAuth: async () => {},
        photos: dummyPhotoPort,
      },
    });

    await server.ready();

    const res = await server.inject({
      method: 'GET',
      url: '/admin/photos',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Photos are disabled; thumbnails unavailable');
    expect(presignMock).toHaveBeenCalled();
    expect(res.body).toContain(`https://cdn.example.com/p/${sampleId}/thumb.jpg`);

    await server.close();
  });

  it('Task 10.2: buildServer with photos disabled leaves admin.photos undefined and renders disabled notice', async () => {
    const dummyAdminRepo: any = {
      listPhotoQueue: vi.fn().mockResolvedValue([]),
      getPhotoUsage: vi.fn().mockResolvedValue([]),
    };

    const server = buildServer(testConfig(false), {
      admin: {
        repo: dummyAdminRepo,
        basicAuth: async () => {},
        photos: undefined,
      },
    });

    await server.ready();

    const res = await server.inject({
      method: 'GET',
      url: '/admin/photos',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Photos are disabled; thumbnails unavailable');

    await server.close();
  });
});
