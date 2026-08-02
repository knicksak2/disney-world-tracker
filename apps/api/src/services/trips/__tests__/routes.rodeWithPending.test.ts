/**
 * Example/integration tests for the Notification_Center rode-with pending read
 * route (task 3.2):
 *
 *   GET /me/rode-with-tags?state=pending
 *
 * Validates: Requirements 3.4, 3.5, 3.6
 *
 * These tests pin the route wiring for the pending read — the strict `state`
 * query contract, the `requireSession` gate, the success/empty status codes,
 * and the route-registration ordering that keeps `?state=pending` on the
 * collection path from being captured by the parametric `/me/rode-with-tags/
 * :tagId` route. The repo's own scope/filter/order/projection behaviour is
 * covered by the pending-read property test (`repo.pendingRodeWith.prop.test`);
 * here the repo is a controllable fake so the route can be exercised in
 * isolation.
 *
 * Two repo methods are spied so the routing assertions can be made precise:
 *
 *   - `listPendingRodeWithTags` — the collection/pending read handler's repo
 *     call. Reaching it proves the request landed on the pending route.
 *   - `getRodeWithTag` — the parametric `/me/rode-with-tags/:tagId` read
 *     handler's repo call. It must NEVER run for `?state=pending`, proving the
 *     query form on the collection path wins over `:tagId` (route ordering).
 */

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PendingRodeWithTagDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Build a `TripRepo` where every method throws unless the test overrides it, so
 * an unexpected repo call surfaces as a test failure. Mirrors the fake used by
 * the membership route tests.
 */
function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  const explode =
    (name: string) =>
    (): never => {
      throw new Error(`repo.${name} must not be called in this test`);
    };
  return {
    listPendingRodeWithTags: explode('listPendingRodeWithTags'),
    getRodeWithTag: explode('getRodeWithTag'),
    confirmRodeWithTag: explode('confirmRodeWithTag'),
    declineRodeWithTag: explode('declineRodeWithTag'),
    ...overrides,
  } as unknown as TripRepo;
}

/** A pool that is never queried by the pending read (no membership gate). */
function makePool(): DbPool {
  return {
    async query(): Promise<{ rows: unknown[]; rowCount: number }> {
      throw new Error('pool.query must not be called by the pending read');
    },
  } as unknown as DbPool;
}

/**
 * Build a Fastify instance with the real Trip routes plugin. `authenticate`
 * toggles the fake `requireSession`: when `false` it throws `unauthorized`
 * before assigning a `userId` (no valid session); when `true` it assigns the
 * caller id so the request proceeds into the handler.
 */
async function buildApp(
  repo: TripRepo,
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
  await app.register(tripRoutes({ repo, requireSession, pool: makePool() }));
  await app.ready();
  return app;
}

let app: FastifyInstance | undefined;

beforeEach(() => {
  app = undefined;
});

describe('GET /me/rode-with-tags?state=pending', () => {
  it('returns the caller\'s pending tags (as produced by the repo) with 200', async () => {
    // The repo owns scope/filter/order; the route returns its list verbatim.
    // The fixture is already ordered created_at DESC to mirror the repo.
    const tags: PendingRodeWithTagDTO[] = [
      {
        tagId: '44444444-4444-4444-4444-444444444444',
        tripLogEntryId: '55555555-5555-5555-5555-555555555555',
        experienceName: 'Space Mountain',
        taggingMemberDisplayName: 'Ariel',
        createdAt: '2024-05-02T10:00:00.000Z',
      },
      {
        tagId: '66666666-6666-6666-6666-666666666666',
        tripLogEntryId: '77777777-7777-7777-7777-777777777777',
        experienceName: 'Haunted Mansion',
        taggingMemberDisplayName: 'Eric',
        createdAt: '2024-05-01T09:00:00.000Z',
      },
    ];
    const listPendingRodeWithTags = vi.fn().mockResolvedValue(tags);
    app = await buildApp(makeRepo({ listPendingRodeWithTags }));

    const res = await app.inject({
      method: 'GET',
      url: '/me/rode-with-tags?state=pending',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(tags);
    // Scoped to the authenticated caller.
    expect(listPendingRodeWithTags).toHaveBeenCalledWith(CALLER_ID);
  });

  it('returns 200 with an empty list when the caller has no pending tags (R3.4)', async () => {
    const listPendingRodeWithTags = vi.fn().mockResolvedValue([]);
    app = await buildApp(makeRepo({ listPendingRodeWithTags }));

    const res = await app.inject({
      method: 'GET',
      url: '/me/rode-with-tags?state=pending',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(listPendingRodeWithTags).toHaveBeenCalledWith(CALLER_ID);
  });

  it('rejects a missing `state` query with validation_failed (400) and reads no tags (R3.6)', async () => {
    const listPendingRodeWithTags = vi.fn();
    app = await buildApp(makeRepo({ listPendingRodeWithTags }));

    const res = await app.inject({ method: 'GET', url: '/me/rode-with-tags' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect(listPendingRodeWithTags).not.toHaveBeenCalled();
  });

  it('rejects a `state` value other than `pending` with validation_failed (400) and reads no tags (R3.6)', async () => {
    const listPendingRodeWithTags = vi.fn();
    app = await buildApp(makeRepo({ listPendingRodeWithTags }));

    const res = await app.inject({
      method: 'GET',
      url: '/me/rode-with-tags?state=confirmed',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect(listPendingRodeWithTags).not.toHaveBeenCalled();
  });

  it('rejects an extra query key alongside a valid `state` with validation_failed (400) and reads no tags (R3.6)', async () => {
    const listPendingRodeWithTags = vi.fn();
    app = await buildApp(makeRepo({ listPendingRodeWithTags }));

    const res = await app.inject({
      method: 'GET',
      url: '/me/rode-with-tags?state=pending&limit=5',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'validation_failed' } });
    expect(listPendingRodeWithTags).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller with unauthorized (401) before any repo call (R3.5)', async () => {
    const listPendingRodeWithTags = vi.fn();
    app = await buildApp(makeRepo({ listPendingRodeWithTags }), false);

    const res = await app.inject({
      method: 'GET',
      url: '/me/rode-with-tags?state=pending',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'unauthorized' } });
    expect(listPendingRodeWithTags).not.toHaveBeenCalled();
  });

  it('routes `?state=pending` to the pending read, not the parametric :tagId read (route ordering)', async () => {
    const listPendingRodeWithTags = vi.fn().mockResolvedValue([]);
    // If the collection query were mis-captured as `:tagId`, this deep-link
    // read handler would run instead. It must never be touched.
    const getRodeWithTag = vi.fn();
    app = await buildApp(makeRepo({ listPendingRodeWithTags, getRodeWithTag }));

    const res = await app.inject({
      method: 'GET',
      url: '/me/rode-with-tags?state=pending',
    });

    expect(res.statusCode).toBe(200);
    expect(listPendingRodeWithTags).toHaveBeenCalledWith(CALLER_ID);
    expect(getRodeWithTag).not.toHaveBeenCalled();
  });
});
