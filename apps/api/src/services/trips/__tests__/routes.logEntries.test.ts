/**
 * Route tests for POST /trips/:id/log-entries date validation and options
 * (unified-experience-logging Task 4.7).
 *
 * Validates: Requirements 6.1, 6.2, 6.4, 6.5, 6.6
 */

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const EXPERIENCE_ID = '33333333-3333-3333-3333-333333333333';
const LOG_ENTRY_ID = '44444444-4444-4444-4444-444444444444';
const LOG_ID = '55555555-5555-4555-8555-555555555555';

function makePool(role: 'organizer' | 'member' | null): DbPool {
  return {
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      return role === null
        ? { rows: [], rowCount: 0 }
        : { rows: [{ role }], rowCount: 1 };
    },
  } as unknown as DbPool;
}

async function buildApp(
  repo: Partial<TripRepo>,
  clock?: () => Date,
): Promise<FastifyInstance> {
  const requireSession: preHandlerHookHandler = async (request) => {
    request.userId = CALLER_ID;
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    tripRoutes({
      repo: repo as TripRepo,
      requireSession,
      pool: makePool('member'),
      ...(clock ? { clock } : {}),
    }),
  );
  await app.ready();
  return app;
}

describe('POST /trips/:id/log-entries route tests (unified-experience-logging)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
  });

  it('succeeds without visitedOn and userTz and calls logCompletion with undefined completedOn', async () => {
    const logCompletion = vi.fn().mockResolvedValue({
      logEntryId: LOG_ENTRY_ID,
      feedItem: { id: 'feed-1' },
      newlyAwardedPinIds: [],
      pendingTags: [],
      logId: LOG_ID,
      loggedAt: '2026-06-15T12:00:00.000Z',
    });

    app = await buildApp({ logCompletion });

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: { experienceId: EXPERIENCE_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      logEntryId: LOG_ENTRY_ID,
    });
    expect(logCompletion).toHaveBeenCalledWith(
      TRIP_ID,
      CALLER_ID,
      {
        experienceId: EXPERIENCE_ID,
        rodeWith: [],
      },
    );
  });

  it('succeeds with visitedOn and userTz and calls logCompletion with completedOn overrides', async () => {
    const logCompletion = vi.fn().mockResolvedValue({
      entry: { id: LOG_ENTRY_ID },
      feedItem: { id: 'feed-1' },
      newlyAwardedPinIds: [],
      pendingTags: [],
      logId: LOG_ID,
      loggedAt: '2026-06-15T12:00:00.000Z',
    });

    // Pinned clock at 2026-06-15
    const clock = () => new Date('2026-06-15T12:00:00Z');
    app = await buildApp({ logCompletion }, clock);

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: {
        experienceId: EXPERIENCE_ID,
        visitedOn: '2026-06-15',
        userTz: 'America/New_York',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(logCompletion).toHaveBeenCalledWith(
      TRIP_ID,
      CALLER_ID,
      {
        experienceId: EXPERIENCE_ID,
        rodeWith: [],
        completedOn: '2026-06-15',
        visitedOn: '2026-06-15',
        userTz: 'America/New_York',
      },
    );
  });

  it('rejects with 400 log_future_date when visitedOn is in the future in userTz', async () => {
    const logCompletion = vi.fn();
    // Clock at 2026-06-15 12:00 UTC (08:00 EDT)
    const clock = () => new Date('2026-06-15T12:00:00Z');
    app = await buildApp({ logCompletion }, clock);

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: {
        experienceId: EXPERIENCE_ID,
        visitedOn: '2026-06-16',
        userTz: 'America/New_York',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('log_future_date');
    expect(logCompletion).not.toHaveBeenCalled();
  });

  it('rejects with 400 log_outside_trip_dates when repo throws log_outside_trip_dates', async () => {
    const logCompletion = vi.fn().mockRejectedValue(
      new AppError(
        'log_outside_trip_dates',
        "The visit date is outside this trip's dates.",
        { field: 'visitedOn' },
      ),
    );

    const clock = () => new Date('2026-06-15T12:00:00Z');
    app = await buildApp({ logCompletion }, clock);

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/log-entries`,
      payload: {
        experienceId: EXPERIENCE_ID,
        visitedOn: '2026-05-01',
        userTz: 'America/New_York',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('log_outside_trip_dates');
  });
});
