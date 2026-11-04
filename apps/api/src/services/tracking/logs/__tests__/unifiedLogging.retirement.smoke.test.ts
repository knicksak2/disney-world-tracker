/**
 * Smoke test for tripLog port wiring in composeServices.ts and retirement of
 * repo.addLog's trip branch (Requirement 5.5, 13.6, Task 4.7).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../../../errors/handler.js';
import { experienceLogRoutes } from '../routes.js';
import type { TripLogPort } from '../tripLogPort.js';
import type { CreateLogInput, ExperienceLogRepo } from '../repo.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = '33333333-3333-4333-8333-333333333333';
const LOG_ID = '44444444-4444-4444-8444-444444444444';

describe('Unified logging retirement smoke test', () => {
  it('composeServices.ts source contains the tripLog wiring for experienceLogRoutes (R13.6)', () => {
    // Resolve composeServices.ts relative to current test file location
    const here = dirname(fileURLToPath(import.meta.url));
    const composePath = resolve(here, '../../../../composeServices.ts');
    const source = readFileSync(composePath, 'utf8');

    // Structural assertions
    expect(source).toContain('tripLog: tripLogPort');
    expect(source).toContain('onRodeWithTagCreated: emitRodeWithTagCreated');
    expect(source).toContain('logs: {');
  });

  it('with tripLog port present, repo.addLog is never called with a non-null tripId (R5.5, R13.6)', async () => {
    const addCalls: CreateLogInput[] = [];
    const fakeRepo = {
      async addLog(input: CreateLogInput) {
        addCalls.push(input);
        return {
          id: LOG_ID,
          userId: input.userId,
          experienceId: input.experienceId,
          visitedOn: input.visitedOn,
          userTz: input.userTz,
          loggedAt: new Date().toISOString(),
          rating: input.rating,
          note: input.note,
        };
      },
    } as unknown as ExperienceLogRepo;

    const fakeTripLog: TripLogPort = {
      async logToTrip() {
        return {
          logId: LOG_ID,
          loggedAt: new Date().toISOString(),
          logEntryId: 'entry-1',
          pendingTags: [],
        };
      },
      async purgeFeedForLog() {},
    };

    const app: FastifyInstance = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.register(
      experienceLogRoutes({
        repo: fakeRepo,
        requireSession: async (req) => {
          req.userId = USER_ID;
        },
        tripLog: fakeTripLog,
      }),
    );
    await app.ready();

    try {
      // 1. Post a Trip-linked log: port handles it, repo.addLog is NOT called
      const tripRes = await app.inject({
        method: 'POST',
        url: `/me/experiences/${EXPERIENCE_ID}/logs`,
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
          tripId: TRIP_ID,
        },
      });
      expect(tripRes.statusCode).toBe(201);
      expect(addCalls).toHaveLength(0);

      // 2. Post a non-Trip log: repo.addLog is called with tripId: null
      const personalRes = await app.inject({
        method: 'POST',
        url: `/me/experiences/${EXPERIENCE_ID}/logs`,
        payload: {
          visitedOn: '2026-06-15',
          userTz: 'America/New_York',
        },
      });
      expect(personalRes.statusCode).toBe(201);
      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]?.tripId).toBeNull();

      // Assert repo.addLog was NEVER called with a non-null tripId
      for (const call of addCalls) {
        expect(call.tripId).toBeNull();
      }
    } finally {
      await app.close();
    }
  });
});
