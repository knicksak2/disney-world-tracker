/**
 * Architectural Enforcers: No Worker, Timers, Queues, or Redis in Trip Booking Reminder Runner
 * Composition Test for Trip Booking Endpoints
 *
 * Validates: Requirements 8.3, 8.8, 8.11, 9.5, 15.5
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildServer } from '../../../server.js';
import { AppError } from '../../../errors/AppError.js';
import type { AppConfig } from '../../../config.js';
import type { ReminderRunner } from '../runner.js';

function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
  const files = readdirSync(dir);
  for (const file of files) {
    const filePath = join(dir, file);
    if (statSync(filePath).isDirectory()) {
      getFilesRecursively(filePath, fileList);
    } else if (filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

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
    admin: { username: 'admin', password: 'password' },
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

describe('Trip Booking Timeline — No Worker / No Timer Architecture Enforcer', () => {
  const tripBookingDir = resolve(__dirname, '..');
  const srcDir = resolve(__dirname, '../../..');

  it('enforces that every .ts under tripBooking/ (excluding __tests__) contains NO timers, workers, queues, or Redis dependencies', () => {
    const allFiles = getFilesRecursively(tripBookingDir);
    const sourceFiles = allFiles.filter((f) => !f.includes('__tests__'));

    const forbiddenPatterns = [
      /import\s+.*from\s+['"]bullmq['"]/i,
      /import\s+.*from\s+['"]ioredis['"]/i,
      /import\s+.*from\s+['"]redis['"]/i,
      /import\s+.*from\s+['"]node-cron['"]/i,
      /\bsetInterval\b/,
      /\bsetTimeout\b/,
      /\bsetImmediate\b/,
      /\bnew\s+Worker\b/,
      /\bnew\s+Queue\b/,
    ];

    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(content),
          `File ${file} MUST NOT contain forbidden pattern: ${pattern.toString()}`,
        ).toBe(false);
      }
    }
  });

  it('enforces that no source file outside tripBooking/routes.ts references /internal/trip-booking-reminders/run', () => {
    const allApiFiles = getFilesRecursively(srcDir);
    const sourceFiles = allApiFiles.filter((f) => !f.includes('__tests__'));

    const internalRoutePath = '/internal/trip-booking-reminders/run';
    for (const file of sourceFiles) {
      if (file.endsWith('tripBooking\\routes.ts') || file.endsWith('tripBooking/routes.ts')) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      expect(
        content.includes(internalRoutePath),
        `Source file ${file} MUST NOT reference ${internalRoutePath} (R8.11, keep-alive must never call it)`,
      ).toBe(false);
    }
  });

  it('composed server answers GET timeline with unauthorized when unauthenticated, and HEAD cron with unauthorized / 202', async () => {
    const runner: ReminderRunner = {
      tryStart: () => ({ started: true }),
      runPass: async () => ({ tripsEvaluated: 0, remindersClaimed: 0, remindersDispatched: 0 }),
    };

    const requireSession = async () => {
      throw new AppError('unauthorized', 'Authentication is required.');
    };

    const server = buildServer(testConfig(), {
      tripBooking: {
        repo: {} as any,
        pool: {} as any,
        requireSession,
        reminderRunner: runner,
      },
    });

    // 1. Unauthenticated timeline request -> unauthorized
    const resTimeline = await server.inject({
      method: 'GET',
      url: '/trips/00000000-0000-0000-0000-000000000000/booking-timeline',
    });
    expect(resTimeline.statusCode).toBe(401);

    // 2. HEAD cron without secret -> unauthorized
    const resHeadNoSecret = await server.inject({
      method: 'HEAD',
      url: '/internal/trip-booking-reminders/run',
    });
    expect(resHeadNoSecret.statusCode).toBe(401);

    // 3. HEAD cron with correct secret -> 202
    const resHeadWithSecret = await server.inject({
      method: 'HEAD',
      url: '/internal/trip-booking-reminders/run',
      headers: {
        'x-cron-secret': 'test-trip-booking-cron-secret-12345',
      },
    });
    expect(resHeadWithSecret.statusCode).toBe(202);
    expect(resHeadWithSecret.body).toBe('');
  });
});
