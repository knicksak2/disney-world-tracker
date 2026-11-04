import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const LOG_ENTRY_ID = '33333333-3333-3333-3333-333333333333';

function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  const explode =
    (name: string) =>
    (): never => {
      throw new Error(`repo.${name} must not be called in this test`);
    };
  return {
    deleteLogEntry: explode('deleteLogEntry'),
    ...overrides,
  } as unknown as TripRepo;
}

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
  repo: TripRepo,
  role: 'organizer' | 'member' | null = 'member',
  authenticate = true,
): Promise<FastifyInstance> {
  const requireSession: preHandlerHookHandler = async (request) => {
    if (!authenticate) {
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = CALLER_ID;
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(tripRoutes({ repo, requireSession, pool: makePool(role) }));
  await app.ready();
  return app;
}

describe('DELETE /trips/:id/log-entries/:logEntryId', () => {
  it('returns 204 on successful delete (Requirements 20.10, 20.11)', async () => {
    const deleteLogEntry = vi.fn().mockResolvedValue(true);
    const app = await buildApp(makeRepo({ deleteLogEntry }), 'member', true);

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/log-entries/${LOG_ENTRY_ID}`,
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(deleteLogEntry).toHaveBeenCalledWith(
      TRIP_ID,
      LOG_ENTRY_ID,
      CALLER_ID,
      'member',
    );
  });

  it('returns 404 trip_not_found when the log entry does not exist', async () => {
    const deleteLogEntry = vi.fn().mockResolvedValue(false);
    const app = await buildApp(makeRepo({ deleteLogEntry }), 'member', true);

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/log-entries/${LOG_ENTRY_ID}`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('trip_not_found');
    expect(body.error.message).toBe('Log entry not found.');
  });

  it('returns 403 trip_forbidden when caller is neither the log author nor a trip organizer', async () => {
    const deleteLogEntry = vi.fn().mockRejectedValue(
      new AppError(
        'trip_forbidden',
        'Only the logging member or a trip organizer may delete this log entry.',
      ),
    );
    const app = await buildApp(makeRepo({ deleteLogEntry }), 'member', true);

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/log-entries/${LOG_ENTRY_ID}`,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error.code).toBe('trip_forbidden');
    expect(body.error.message).toBe(
      'Only the logging member or a trip organizer may delete this log entry.',
    );
  });

  it('returns 401 unauthenticated when no session is present', async () => {
    const deleteLogEntry = vi.fn();
    const app = await buildApp(makeRepo({ deleteLogEntry }), 'member', false);

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/log-entries/${LOG_ENTRY_ID}`,
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error.code).toBe('unauthorized');
    expect(deleteLogEntry).not.toHaveBeenCalled();
  });
});