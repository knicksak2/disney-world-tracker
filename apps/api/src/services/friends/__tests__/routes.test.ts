/**
 * Integration tests for the Friends_Service routes plugin (task 7.2).
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake `FriendsRepo` and a stubbed `requireSession` pre-handler. We
 * never connect to a real database or session middleware so each test
 * is hermetic and deterministic.
 *
 * Coverage focuses on the requirements scoped to this task:
 *   - R8.1 search returns the repo result
 *   - R8.2 invalid query length surfaces as 400 `search_query_length_invalid`
 *   - R8.3 send request: 201 with the created DTO on success
 *   - R8.7 duplicate request/friendship surfaces as 409 `friend_duplicate_relationship`
 *   - R8.8 self-target surfaces as 400 `friend_self_target`
 *   - R8.10 unknown recipient surfaces as 400 `friend_recipient_unknown`
 *   - R8.4 accept returns 204 on success
 *   - R8.5 decline returns 204 on success
 *   - R8.4/R8.5 missing or wrong-recipient request surfaces as 404 `friendship_not_found`
 *   - R8.9 list returns the repo bundle
 *   - R8.11 remove with no friendship surfaces as 404 `friendship_not_found`
 *   - Authorization gate: every route requires a session
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { FriendRequestDTO } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type {
  FriendsAndRequests,
  FriendsRepo,
  FriendSearchHit,
} from '../repo.js';
import { friendsRoutes, type FriendsRoutesOptions } from '../routes.js';

// ---------------------------------------------------------------------------
// Fake repo
// ---------------------------------------------------------------------------

interface FakeRepoEvent {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

interface FakeRepo extends FriendsRepo {
  readonly events: FakeRepoEvent[];
}

interface FakeRepoOverrides {
  readonly searchUsers?: (
    requesterId: string,
    query: string,
    limit?: number,
  ) => Promise<ReadonlyArray<FriendSearchHit>>;
  readonly sendRequest?: (
    senderId: string,
    recipientId: string,
  ) => Promise<FriendRequestDTO>;
  readonly acceptRequest?: (
    recipientId: string,
    requestId: string,
  ) => Promise<{ readonly userLoId: string; readonly userHiId: string } | null>;
  readonly declineRequest?: (
    recipientId: string,
    requestId: string,
  ) => Promise<boolean>;
  readonly removeFriend?: (
    userId: string,
    otherUserId: string,
  ) => Promise<boolean>;
  readonly listFriendsAndRequests?: (
    userId: string,
  ) => Promise<FriendsAndRequests>;
}

function makeRepo(overrides: FakeRepoOverrides = {}): FakeRepo {
  const events: FakeRepoEvent[] = [];
  const record = (method: string, args: ReadonlyArray<unknown>): void => {
    events.push({ method, args });
  };
  return {
    events,
    async searchUsers(requesterId, query, limit) {
      record('searchUsers', [requesterId, query, limit]);
      if (overrides.searchUsers) {
        return overrides.searchUsers(requesterId, query, limit);
      }
      return [];
    },
    async sendRequest(senderId, recipientId) {
      record('sendRequest', [senderId, recipientId]);
      if (overrides.sendRequest) {
        return overrides.sendRequest(senderId, recipientId);
      }
      throw new Error('sendRequest stub not provided');
    },
    async acceptRequest(recipientId, requestId) {
      record('acceptRequest', [recipientId, requestId]);
      if (overrides.acceptRequest) {
        return overrides.acceptRequest(recipientId, requestId);
      }
      return null;
    },
    async declineRequest(recipientId, requestId) {
      record('declineRequest', [recipientId, requestId]);
      if (overrides.declineRequest) {
        return overrides.declineRequest(recipientId, requestId);
      }
      return false;
    },
    async removeFriend(userId, otherUserId) {
      record('removeFriend', [userId, otherUserId]);
      if (overrides.removeFriend) {
        return overrides.removeFriend(userId, otherUserId);
      }
      return false;
    },
    async listFriendsAndRequests(userId) {
      record('listFriendsAndRequests', [userId]);
      if (overrides.listFriendsAndRequests) {
        return overrides.listFriendsAndRequests(userId);
      }
      return { friends: [], incomingRequests: [], outgoingRequests: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------

function makeRequireSession(opts: { userId?: string } = {}): FriendsRoutesOptions['requireSession'] {
  return async (request) => {
    const headerUserId = request.headers['x-test-user-id'];
    const id =
      typeof headerUserId === 'string' && headerUserId.length > 0
        ? headerUserId
        : opts.userId;
    if (!id) {
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = id;
  };
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(options: {
  repo?: FakeRepo;
  defaultUserId?: string;
} = {}): Promise<{ app: FastifyInstance; repo: FakeRepo }> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const repo = options.repo ?? makeRepo();
  const requireSession =
    options.defaultUserId !== undefined
      ? makeRequireSession({ userId: options.defaultUserId })
      : makeRequireSession();
  await app.register(
    friendsRoutes({
      repo,
      requireSession,
    }),
  );
  await app.ready();
  return { app, repo };
}

// Two stable UUIDs used throughout the test suite. Treating them as named
// constants makes the assertion failure messages much easier to read than
// raw uuid strings sprinkled through every payload.
const REQUESTER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const REQUEST_DTO: FriendRequestDTO = {
  id: REQUEST_ID,
  senderId: REQUESTER_ID,
  recipientId: OTHER_ID,
  createdAt: '2024-01-01T00:00:00.000Z',
};

// ===========================================================================
// GET /users/search
// ===========================================================================

describe('GET /users/search', () => {
  it('returns the repo result wrapped in `{ results }` (R8.1)', async () => {
    const hits: FriendSearchHit[] = [
      { id: OTHER_ID, displayName: 'Goofy', email: 'goofy@example.com' },
    ];
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async searchUsers() {
          return hits;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/users/search?q=goof',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { results: FriendSearchHit[] };
    expect(body.results).toEqual(hits);
    expect(repo.events).toEqual([
      { method: 'searchUsers', args: [REQUESTER_ID, 'goof', undefined] },
    ]);
  });

  it('rejects an empty `q` with search_query_length_invalid (R8.2)', async () => {
    const { app, repo } = await buildApp({
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/users/search?q=',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('search_query_length_invalid');
    expect(body.error.field).toBe('q');
    // The repo is not consulted for an invalid query.
    expect(repo.events).toHaveLength(0);
  });

  it('rejects a query longer than 100 chars with search_query_length_invalid (R8.2)', async () => {
    const { app, repo } = await buildApp({
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/users/search?q=${'x'.repeat(101)}`,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('search_query_length_invalid');
    expect(repo.events).toHaveLength(0);
  });

  it('rejects an unauthenticated request as 401 unauthorized', async () => {
    const { app } = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/users/search?q=anything',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });
});

// ===========================================================================
// POST /me/friend-requests
// ===========================================================================

describe('POST /me/friend-requests', () => {
  it('returns 201 with the created DTO on success (R8.3)', async () => {
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async sendRequest() {
          return REQUEST_DTO;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/friend-requests',
      payload: { recipientId: OTHER_ID },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(REQUEST_DTO);
    expect(repo.events).toEqual([
      { method: 'sendRequest', args: [REQUESTER_ID, OTHER_ID] },
    ]);
  });

  it('surfaces self-target as 400 friend_self_target (R8.8)', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async sendRequest() {
          // Mirror the repo's actual rejection so the route surfaces the
          // domain code untouched.
          throw new AppError(
            'friend_self_target',
            'Cannot send a friend request to yourself.',
            { field: 'recipientId' },
          );
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/friend-requests',
      payload: { recipientId: REQUESTER_ID },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('friend_self_target');
    expect(body.error.field).toBe('recipientId');
  });

  it('surfaces unknown recipient as 400 friend_recipient_unknown (R8.10)', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async sendRequest() {
          throw new AppError(
            'friend_recipient_unknown',
            'Recipient user does not exist.',
            { field: 'recipientId' },
          );
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/friend-requests',
      payload: { recipientId: OTHER_ID },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('friend_recipient_unknown');
  });

  it('surfaces duplicate relationship as 409 friend_duplicate_relationship (R8.7)', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async sendRequest() {
          throw new AppError(
            'friend_duplicate_relationship',
            'A pending friend request already exists between you and this user.',
          );
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/friend-requests',
      payload: { recipientId: OTHER_ID },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('friend_duplicate_relationship');
  });

  it('rejects a malformed body (non-UUID recipientId) with validation_failed', async () => {
    const { app, repo } = await buildApp({
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/me/friend-requests',
      payload: { recipientId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.field).toBe('recipientId');
    // Body validation rejects before the repo is consulted.
    expect(repo.events).toHaveLength(0);
  });

  it('rejects an unauthenticated request as 401 unauthorized', async () => {
    const { app } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/me/friend-requests',
      payload: { recipientId: OTHER_ID },
    });
    expect(response.statusCode).toBe(401);
  });
});

// ===========================================================================
// POST /me/friend-requests/:id/accept
// ===========================================================================

describe('POST /me/friend-requests/:id/accept', () => {
  it('returns 204 on success (R8.4)', async () => {
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async acceptRequest() {
          return { userLoId: REQUESTER_ID, userHiId: OTHER_ID };
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/me/friend-requests/${REQUEST_ID}/accept`,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(repo.events).toEqual([
      { method: 'acceptRequest', args: [REQUESTER_ID, REQUEST_ID] },
    ]);
  });

  it('returns 404 friendship_not_found when the repo reports no matching request', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async acceptRequest() {
          return null;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/me/friend-requests/${REQUEST_ID}/accept`,
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('friendship_not_found');
  });

  it('rejects a non-UUID :id with validation_failed', async () => {
    const { app, repo } = await buildApp({ defaultUserId: REQUESTER_ID });

    const response = await app.inject({
      method: 'POST',
      url: '/me/friend-requests/not-a-uuid/accept',
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
    expect(repo.events).toHaveLength(0);
  });
});

// ===========================================================================
// POST /me/friend-requests/:id/decline
// ===========================================================================

describe('POST /me/friend-requests/:id/decline', () => {
  it('returns 204 on success (R8.5)', async () => {
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async declineRequest() {
          return true;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/me/friend-requests/${REQUEST_ID}/decline`,
    });

    expect(response.statusCode).toBe(204);
    expect(repo.events).toEqual([
      { method: 'declineRequest', args: [REQUESTER_ID, REQUEST_ID] },
    ]);
  });

  it('returns 404 friendship_not_found when the repo reports no matching request', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async declineRequest() {
          return false;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/me/friend-requests/${REQUEST_ID}/decline`,
    });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      'friendship_not_found',
    );
  });
});

// ===========================================================================
// GET /me/friends
// ===========================================================================

describe('GET /me/friends', () => {
  it('returns the bundled list from the repo (R8.9)', async () => {
    const bundle: FriendsAndRequests = {
      friends: [
        {
          userId: OTHER_ID,
          displayName: 'Goofy',
          avatarUrl: null,
          establishedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      incomingRequests: [
        {
          id: REQUEST_ID,
          otherUserId: OTHER_ID,
          otherDisplayName: 'Donald',
          createdAt: '2024-01-02T00:00:00.000Z',
        },
      ],
      outgoingRequests: [],
    };
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async listFriendsAndRequests() {
          return bundle;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({ method: 'GET', url: '/me/friends' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(bundle);
    expect(repo.events).toEqual([
      { method: 'listFriendsAndRequests', args: [REQUESTER_ID] },
    ]);
  });

  it('rejects an unauthenticated request as 401 unauthorized', async () => {
    const { app } = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/me/friends' });
    expect(response.statusCode).toBe(401);
  });
});

// ===========================================================================
// DELETE /me/friends/:userId
// ===========================================================================

describe('DELETE /me/friends/:userId', () => {
  it('returns 204 on success (R8.6)', async () => {
    const { app, repo } = await buildApp({
      repo: makeRepo({
        async removeFriend() {
          return true;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${OTHER_ID}`,
    });

    expect(response.statusCode).toBe(204);
    expect(repo.events).toEqual([
      { method: 'removeFriend', args: [REQUESTER_ID, OTHER_ID] },
    ]);
  });

  it('returns 404 friendship_not_found when the friendship is missing (R8.11)', async () => {
    const { app } = await buildApp({
      repo: makeRepo({
        async removeFriend() {
          return false;
        },
      }),
      defaultUserId: REQUESTER_ID,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/me/friends/${OTHER_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      'friendship_not_found',
    );
  });

  it('rejects a non-UUID :userId with validation_failed', async () => {
    const { app, repo } = await buildApp({ defaultUserId: REQUESTER_ID });

    const response = await app.inject({
      method: 'DELETE',
      url: '/me/friends/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
    expect(repo.events).toHaveLength(0);
  });
});
