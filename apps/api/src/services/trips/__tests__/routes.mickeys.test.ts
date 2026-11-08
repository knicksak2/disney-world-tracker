/**
 * Integration / route tests for GET /trips/:id/mickeys (hidden-mickeys Task 4.2, 4.3).
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4; Property 16
 */

import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { tripRoutes } from '../routes.js';
import type { TripRepo } from '../repo.js';
import type { TripMickeysDTO } from '@dwt/shared';

const USER_MEMBER = '11111111-1111-4111-8111-111111111111';
const USER_NON_MEMBER = '22222222-2222-4222-8222-222222222222';
const TRIP_ID = '33333333-3333-4333-8333-333333333333';
const NON_EXISTENT_TRIP_ID = '44444444-4444-4444-8444-444444444444';

function makeFakePool(): DbPool {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM trip_memberships')) {
        const [tripId, userId] = params;
        if (tripId === TRIP_ID && userId === USER_MEMBER) {
          return { rows: [{ role: 'member' }], rowCount: 1 } as any;
        }
        return { rows: [], rowCount: 0 } as any;
      }
      return { rows: [], rowCount: 0 } as any;
    },
    connect: async () => {
      throw new Error('Not implemented');
    },
  } as unknown as DbPool;
}

function buildTestApp(callerId?: string, getTripMickeys?: (tripId: string) => Promise<TripMickeysDTO>): FastifyInstance {
  const app = Fastify();
  registerErrorHandler(app);

  const requireSession: preHandlerHookHandler = async (request) => {
    if (!callerId) {
      throw new AppError('unauthorized', 'Authentication required.');
    }
    request.userId = callerId;
  };

  void app.register(
    tripRoutes({
      repo: {} as TripRepo,
      requireSession,
      pool: makeFakePool(),
      getTripMickeys,
    }),
  );

  return app;
}

describe('Trip Hidden Mickeys Route: GET /trips/:id/mickeys', () => {
  it('rejects unauthenticated request with 401', async () => {
    const app = buildTestApp(undefined);
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/mickeys`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects non-member with 403 trip_forbidden', async () => {
    const app = buildTestApp(USER_NON_MEMBER);
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/mickeys`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('trip_forbidden');
  });

  it('rejects non-existent trip with identical 403 trip_forbidden (Property 16)', async () => {
    const app = buildTestApp(USER_MEMBER);
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${NON_EXISTENT_TRIP_ID}/mickeys`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error?.code).toBe('trip_forbidden');
  });

  it('returns 200 and TripMickeysDTO when caller is a member', async () => {
    const expectedTally: TripMickeysDTO = {
      members: [
        {
          userId: USER_MEMBER,
          displayName: 'Alice',
          avatarPreset: 'mickey',
          count: 2,
        },
      ],
      mickeys: [
        {
          mickeyId: randomUUID(),
          clue1: 'Look at the gear pattern',
          official: true,
          experienceName: 'Big Thunder Mountain Railroad',
          foundByCount: 1,
        },
      ],
    };

    const app = buildTestApp(USER_MEMBER, async () => expectedTally);
    const res = await app.inject({
      method: 'GET',
      url: `/trips/${TRIP_ID}/mickeys`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as TripMickeysDTO;
    expect(body).toEqual(expectedTally);
    expect((body.mickeys[0] as any).clue2).toBeUndefined();
    expect((body.mickeys[0] as any).reveal).toBeUndefined();
  });
});
