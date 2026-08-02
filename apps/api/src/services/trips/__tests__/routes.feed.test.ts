/**
 * Unit tests for the Trip_Feed / reaction / comment routes (task 11.3):
 *
 *   GET    /trips/:id/feed
 *   POST   /trips/:id/feed/:targetType/:targetId/reactions
 *   DELETE /trips/:id/feed/:targetType/:targetId/reactions/:type
 *   POST   /trips/:id/feed/:targetType/:targetId/comments
 *   DELETE /trips/:id/comments/:commentId
 *
 * Validates: Requirements 13.3, 13.6, 13.10, 13.12
 *
 * These tests pin the route wiring — the Member authorization gate (all feed
 * routes are Member-gated per R13.10), the success status codes (`201` for an
 * add, `204` for an idempotent remove, the created comment identity for a
 * comment), the local param/body validation (the closed `:targetType`
 * vocabulary and the reaction / comment body schemas, R13.6), and the
 * propagation of the repo's mapped `AppError`s (`trip_not_found` for a target
 * that is not on the Trip, `trip_forbidden` for a foreign comment author,
 * R13.12) through the shared error handler. The repo's own transactional
 * behaviour is covered by the reactions/comments property test; here the repo
 * is a controllable fake so each route is exercised in isolation.
 */

import Fastify, {
  type FastifyInstance,
  type preHandlerHookHandler,
} from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TripFeedItemDTO } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { TripRepo } from '../repo.js';
import { tripRoutes } from '../routes.js';

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_ID = '22222222-2222-2222-2222-222222222222';
const TARGET_ID = '33333333-3333-3333-3333-333333333333';
const COMMENT_ID = '44444444-4444-4444-4444-444444444444';

/**
 * Build a `TripRepo` where every relevant method throws unless the test
 * overrides it, so an unexpected call surfaces as a failure. Only the feed
 * methods are listed; other methods are absent (never invoked by these routes).
 */
function makeRepo(overrides: Partial<TripRepo>): TripRepo {
  const explode =
    (name: string) =>
    (): never => {
      throw new Error(`repo.${name} must not be called in this test`);
    };
  return {
    getFeed: explode('getFeed'),
    addReaction: explode('addReaction'),
    removeReaction: explode('removeReaction'),
    addComment: explode('addComment'),
    removeComment: explode('removeComment'),
    ...overrides,
  } as unknown as TripRepo;
}

/**
 * A pool whose membership lookup returns the supplied `role` (or no row when
 * `null`), driving the `assertTripMember` gate.
 */
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
  role: 'organizer' | 'member' | null,
  repo: TripRepo,
): Promise<FastifyInstance> {
  const requireSession: preHandlerHookHandler = async (request) => {
    request.userId = CALLER_ID;
  };
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    tripRoutes({ repo, requireSession, pool: makePool(role) }),
  );
  await app.ready();
  return app;
}

let app: FastifyInstance | undefined;

beforeEach(() => {
  app = undefined;
});

describe('GET /trips/:id/feed', () => {
  it('returns the ordered feed for a Member', async () => {
    const feed: TripFeedItemDTO[] = [
      {
        id: '55555555-5555-5555-5555-555555555555',
        type: 'trip_created',
        createdAt: '2025-01-02T00:00:00.000Z',
        actorDisplayName: 'Ariel',
        metadata: {},
        reactions: [],
        comments: [],
      } as unknown as TripFeedItemDTO,
    ];
    const getFeed = vi.fn().mockResolvedValue(feed);
    app = await buildApp('member', makeRepo({ getFeed }));

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/feed` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(feed);
    expect(getFeed).toHaveBeenCalledWith(TRIP_ID, CALLER_ID);
  });

  it('denies a non-member with trip_forbidden and never reads the feed', async () => {
    const getFeed = vi.fn();
    app = await buildApp(null, makeRepo({ getFeed }));

    const res = await app.inject({ method: 'GET', url: `/trips/${TRIP_ID}/feed` });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    expect(getFeed).not.toHaveBeenCalled();
  });
});

describe('POST /trips/:id/feed/:targetType/:targetId/reactions', () => {
  it('adds a reaction for a Member and returns 201', async () => {
    const addReaction = vi.fn().mockResolvedValue(undefined);
    app = await buildApp('member', makeRepo({ addReaction }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/feed/feed_item/${TARGET_ID}/reactions`,
      payload: { reaction: 'love' },
    });

    expect(res.statusCode).toBe(201);
    expect(addReaction).toHaveBeenCalledWith(
      TRIP_ID,
      'feed_item',
      TARGET_ID,
      CALLER_ID,
      'love',
    );
  });

  it('rejects an unsupported reaction value with trip_validation_failed (400)', async () => {
    const addReaction = vi.fn();
    app = await buildApp('member', makeRepo({ addReaction }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/feed/feed_item/${TARGET_ID}/reactions`,
      payload: { reaction: 'thumbsup' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
    expect(addReaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown :targetType with trip_validation_failed (400)', async () => {
    const addReaction = vi.fn();
    app = await buildApp('member', makeRepo({ addReaction }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/feed/comment/${TARGET_ID}/reactions`,
      payload: { reaction: 'like' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
    expect(addReaction).not.toHaveBeenCalled();
  });

  it('maps a target not on the Trip to trip_not_found (404)', async () => {
    const addReaction = vi
      .fn()
      .mockRejectedValue(new AppError('trip_not_found', 'Target not found.'));
    app = await buildApp('member', makeRepo({ addReaction }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/feed/log_entry/${TARGET_ID}/reactions`,
      payload: { reaction: 'wow' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'trip_not_found' } });
  });
});

describe('DELETE /trips/:id/feed/:targetType/:targetId/reactions/:type', () => {
  it('removes the caller reaction and returns 204', async () => {
    const removeReaction = vi.fn().mockResolvedValue(undefined);
    app = await buildApp('member', makeRepo({ removeReaction }));

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/feed/feed_item/${TARGET_ID}/reactions/like`,
    });

    expect(res.statusCode).toBe(204);
    expect(removeReaction).toHaveBeenCalledWith(
      TRIP_ID,
      'feed_item',
      TARGET_ID,
      CALLER_ID,
      'like',
    );
  });

  it('denies a non-member with trip_forbidden and never removes', async () => {
    const removeReaction = vi.fn();
    app = await buildApp(null, makeRepo({ removeReaction }));

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/feed/feed_item/${TARGET_ID}/reactions/like`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
    expect(removeReaction).not.toHaveBeenCalled();
  });
});

describe('POST /trips/:id/feed/:targetType/:targetId/comments', () => {
  it('adds a comment for a Member and returns 201 with the comment id', async () => {
    const addComment = vi.fn().mockResolvedValue({ commentId: COMMENT_ID });
    app = await buildApp('member', makeRepo({ addComment }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/feed/log_entry/${TARGET_ID}/comments`,
      payload: { body: '  Best day ever!  ' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ commentId: COMMENT_ID });
    expect(addComment).toHaveBeenCalledWith(
      TRIP_ID,
      'log_entry',
      TARGET_ID,
      CALLER_ID,
      'Best day ever!',
    );
  });

  it('rejects an empty (whitespace-only) body with trip_validation_failed (400)', async () => {
    const addComment = vi.fn();
    app = await buildApp('member', makeRepo({ addComment }));

    const res = await app.inject({
      method: 'POST',
      url: `/trips/${TRIP_ID}/feed/feed_item/${TARGET_ID}/comments`,
      payload: { body: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'trip_validation_failed' } });
    expect(addComment).not.toHaveBeenCalled();
  });
});

describe('DELETE /trips/:id/comments/:commentId', () => {
  it('removes the caller comment and returns 204', async () => {
    const removeComment = vi.fn().mockResolvedValue(true);
    app = await buildApp('member', makeRepo({ removeComment }));

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/comments/${COMMENT_ID}`,
    });

    expect(res.statusCode).toBe(204);
    expect(removeComment).toHaveBeenCalledWith(TRIP_ID, COMMENT_ID, CALLER_ID);
  });

  it('maps a missing comment to trip_not_found (404)', async () => {
    const removeComment = vi.fn().mockResolvedValue(false);
    app = await buildApp('member', makeRepo({ removeComment }));

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/comments/${COMMENT_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'trip_not_found' } });
  });

  it('maps a foreign-author removal to trip_forbidden (403) per R13.12', async () => {
    const removeComment = vi
      .fn()
      .mockRejectedValue(
        new AppError('trip_forbidden', 'Only the author may remove this comment.'),
      );
    app = await buildApp('member', makeRepo({ removeComment }));

    const res = await app.inject({
      method: 'DELETE',
      url: `/trips/${TRIP_ID}/comments/${COMMENT_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'trip_forbidden' } });
  });
});
