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
      credentials: { username: 'u', password: 'p' },
      requestBudget: { maxRequestsPerSecond: 5, maxConcurrency: 4 },
      backoff: {
        baseDelayMs: 500,
        factor: 2,
        maxRetries: 5,
        maxDelayMs: 5000,
        jitter: false,
      },
    },
    admin: {
      username: 'admin',
      password: 'password',
    },
  } as unknown as AppConfig;
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
