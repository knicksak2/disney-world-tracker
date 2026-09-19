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
  } as AppConfig;
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
