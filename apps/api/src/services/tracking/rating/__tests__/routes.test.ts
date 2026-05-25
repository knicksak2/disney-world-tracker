/**
 * Unit tests for the Rating routes plugin (task 10.2).
 *
 * The plugin is registered against an in-process Fastify instance with
 * a fake `RatingRepo` and a stubbed `requireSession` pre-handler. We
 * never connect to a real database, Redis, or session middleware so
 * each test is hermetic and deterministic.
 *
 * Coverage focuses on the requirements scoped to this task:
 *
 *   - R4.1, R4.7  PUT body validates `value` as integer 1..10. Invalid
 *                 values surface as 400 `rating_out_of_range`.
 *   - R4.2, R4.3  PUT translates a path id + body value into a
 *                 `repo.setRating(...)` call; replacement (200) vs
 *                 first creation (201) is signalled by the
 *                 `previousValue` returned by the repo.
 *   - R4.4, R4.8  DELETE returns 204 on success; the repo's
 *                 `rating_not_found` AppError surfaces as 404 via the
 *                 global error hook.
 *   - Auth        Both routes are gated by the injected
 *                 `requireSession` pre-handler; a 401 from the pre-
 *                 handler short-circuits the route without invoking
 *                 the repo.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../../errors/AppError.js';
import { registerErrorHandler } from '../../../../errors/handler.js';
import {
  ratingRoutes,
  type RatingRoutesOptions,
} from '../routes.js';
import type {
  RatingRepo,
  RemoveRatingResult,
  SetRatingResult,
} from '../repo.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface RepoCalls {
  readonly setRating: Array<{
    userId: string;
    experienceId: string;
    value: number;
  }>;
  readonly removeRating: Array<{
    userId: string;
    experienceId: string;
  }>;
}

interface RepoStubs {
  setRating?: (
    userId: string,
    experienceId: string,
    value: number,
  ) => Promise<SetRatingResult>;
  removeRating?: (
    userId: string,
    experienceId: string,
  ) => Promise<RemoveRatingResult>;
}

function makeRepo(stubs: RepoStubs = {}): {
  repo: RatingRepo;
  calls: RepoCalls;
} {
  const calls: RepoCalls = { setRating: [], removeRating: [] };
  return {
    calls,
    repo: {
      async setRating(userId, experienceId, value) {
        calls.setRating.push({ userId, experienceId, value });
        if (stubs.setRating) {
          return stubs.setRating(userId, experienceId, value);
        }
        return {
          experienceId,
          value,
          previousValue: null,
          updatedAt: new Date('2024-01-15T12:34:56.000Z'),
        };
      },
      async removeRating(userId, experienceId) {
        calls.removeRating.push({ userId, experienceId });
        if (stubs.removeRating) {
          return stubs.removeRating(userId, experienceId);
        }
        return { experienceId, previousValue: 5 };
      },
    },
  };
}

/**
 * Build a `requireSession` stub. By default sets `request.userId` to
 * the supplied id (or `'user-1'`); pass `unauthorized: true` to make
 * the stub reject with `AppError('unauthorized', ...)` so we can
 * exercise the gating path.
 */
function makeRequireSession(opts: {
  userId?: string;
  unauthorized?: boolean;
} = {}): RatingRoutesOptions['requireSession'] {
  return async (request, _reply) => {
    if (opts.unauthorized === true) {
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = opts.userId ?? 'user-1';
  };
}

async function buildApp(
  overrides: Partial<RatingRoutesOptions> & { repo?: RatingRepo } = {},
): Promise<{ app: FastifyInstance; repoCalls: RepoCalls }> {
  const fallback = makeRepo();
  const repo = overrides.repo ?? fallback.repo;
  const repoCalls = overrides.repo ? { setRating: [], removeRating: [] } : fallback.calls;

  const app = Fastify();
  registerErrorHandler(app);
  await app.register(
    ratingRoutes({
      repo,
      requireSession: overrides.requireSession ?? makeRequireSession(),
    }),
  );
  await app.ready();
  return { app, repoCalls };
}

// ---------------------------------------------------------------------------
// PUT /me/experiences/:id/rating
// ---------------------------------------------------------------------------

const EXPERIENCE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('PUT /me/experiences/:id/rating', () => {
  it('returns 201 with the new rating when no prior rating existed (UPSERT)', async () => {
    const { app, repoCalls } = await buildApp({
      requireSession: makeRequireSession({ userId: USER_ID }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/rating`,
      payload: { value: 7 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { experienceId: string; value: number; updatedAt: string };
    expect(body.experienceId).toBe(EXPERIENCE_ID);
    expect(body.value).toBe(7);
    expect(typeof body.updatedAt).toBe('string');

    expect(repoCalls.setRating).toEqual([
      { userId: USER_ID, experienceId: EXPERIENCE_ID, value: 7 },
    ]);

    await app.close();
  });

  it('returns 200 when replacing an existing rating (R4.3)', async () => {
    const { repo } = makeRepo({
      async setRating(_userId, experienceId, value) {
        return {
          experienceId,
          value,
          previousValue: 4,
          updatedAt: new Date('2024-02-01T00:00:00.000Z'),
        };
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/rating`,
      payload: { value: 9 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { value: number };
    expect(body.value).toBe(9);

    await app.close();
  });

  it.each([
    ['below range', 0],
    ['above range', 11],
    ['negative', -3],
    ['non-integer', 5.5],
  ])(
    'rejects %s with 400 rating_out_of_range and does not call the repo',
    async (_label, value) => {
      const { app, repoCalls } = await buildApp();

      const res = await app.inject({
        method: 'PUT',
        url: `/me/experiences/${EXPERIENCE_ID}/rating`,
        payload: { value },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: { code: string; field?: string } };
      expect(body.error.code).toBe('rating_out_of_range');
      expect(body.error.field).toBe('value');
      expect(repoCalls.setRating).toEqual([]);

      await app.close();
    },
  );

  it('rejects a malformed body (missing value) with 400 validation_failed', async () => {
    const { app, repoCalls } = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/rating`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(repoCalls.setRating).toEqual([]);

    await app.close();
  });

  it('rejects a non-UUID :id path param with 400 validation_failed', async () => {
    const { app, repoCalls } = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: '/me/experiences/not-a-uuid/rating',
      payload: { value: 5 },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.field).toBe('id');
    expect(repoCalls.setRating).toEqual([]);

    await app.close();
  });

  it('returns 401 unauthorized when the session middleware rejects, without invoking the repo', async () => {
    const { app, repoCalls } = await buildApp({
      requireSession: makeRequireSession({ unauthorized: true }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/me/experiences/${EXPERIENCE_ID}/rating`,
      payload: { value: 5 },
    });

    expect(res.statusCode).toBe(401);
    expect(repoCalls.setRating).toEqual([]);

    await app.close();
  });
});

// ---------------------------------------------------------------------------
// DELETE /me/experiences/:id/rating
// ---------------------------------------------------------------------------

describe('DELETE /me/experiences/:id/rating', () => {
  it('returns 204 No Content on a successful delete (R4.4)', async () => {
    const { app, repoCalls } = await buildApp({
      requireSession: makeRequireSession({ userId: USER_ID }),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/rating`,
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    expect(repoCalls.removeRating).toEqual([
      { userId: USER_ID, experienceId: EXPERIENCE_ID },
    ]);

    await app.close();
  });

  it('returns 404 rating_not_found when the repo throws (R4.8)', async () => {
    const { repo } = makeRepo({
      async removeRating() {
        throw new AppError(
          'rating_not_found',
          'No rating exists for this user and experience.',
        );
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/rating`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe('rating_not_found');

    await app.close();
  });

  it('rejects a non-UUID :id with 400 validation_failed and does not call the repo', async () => {
    const { app, repoCalls } = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/me/experiences/not-a-uuid/rating',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.field).toBe('id');
    expect(repoCalls.removeRating).toEqual([]);

    await app.close();
  });

  it('returns 401 when unauthorized, without invoking the repo', async () => {
    const { app, repoCalls } = await buildApp({
      requireSession: makeRequireSession({ unauthorized: true }),
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/me/experiences/${EXPERIENCE_ID}/rating`,
    });

    expect(res.statusCode).toBe(401);
    expect(repoCalls.removeRating).toEqual([]);

    await app.close();
  });
});
