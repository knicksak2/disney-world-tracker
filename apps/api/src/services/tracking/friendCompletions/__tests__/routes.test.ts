/**
 * Unit tests for the Friend Completions route plugin (task 4.5).
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake `FriendCompletionsRepo`, a fake DB pool (driving only the single
 * friendship lookup performed by the shared `assertOwnerOrFriend` gate), and
 * a stub session pre-handler that reads `x-test-user-id`. No Postgres or
 * Redis traffic is involved. Modeled on the Stats_Service routes test.
 *
 * Coverage focuses on the route's error codes and the session-precedence
 * invariant scoped to this task:
 *
 *   - R1.5 / R3.6 — a non-friend / unknown target is denied with an
 *                   identical `profile_forbidden` (403), and the target's
 *                   completions are never read on the deny path.
 *   - R1.6        — the session check is evaluated *before* the
 *                   owner-or-friend rule: with no session, the response is
 *                   `unauthorized` (401), never `profile_forbidden`, and no
 *                   friendship lookup or repo read happens.
 *   - validation  — a malformed `:userId` yields `validation_failed` (400)
 *                   before any DB access.
 *   - happy path  — owner self-read and accepted-friend read return
 *                   `{ entries }` mapped 1:1 from the repo rows.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import type { CompletionEntryDTO } from '@dwt/shared';

import { registerErrorHandler } from '../../../../errors/handler.js';
import {
  friendCompletionsRoutes,
  type FriendCompletionsRoutesOptions,
} from '../routes.js';
import type { CompletionEntry, FriendCompletionsRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Fake DB pool (drives only the friendship lookup)
// ---------------------------------------------------------------------------

interface FakePoolCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

interface FakePool {
  query: (
    text: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<{ rows: unknown[] }>;
  calls: FakePoolCall[];
}

function makeFakePool(
  responder: (call: FakePoolCall) => { rows: unknown[] },
): FakePool {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      const call: FakePoolCall = { text, params };
      calls.push(call);
      return responder(call);
    },
  };
}

// ---------------------------------------------------------------------------
// Fake FriendCompletionsRepo
// ---------------------------------------------------------------------------

function makeFakeRepo(entriesByUser: Map<string, readonly CompletionEntry[]>): {
  repo: FriendCompletionsRepo;
  callsForUser: string[];
} {
  const callsForUser: string[] = [];
  return {
    callsForUser,
    repo: {
      async listCompletions(
        userId: string,
      ): Promise<readonly CompletionEntry[]> {
        callsForUser.push(userId);
        return entriesByUser.get(userId) ?? [];
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Stub session pre-handler — sets request.userId from x-test-user-id
// ---------------------------------------------------------------------------

const requireSession: FriendCompletionsRoutesOptions['requireSession'] = (
  request,
  _reply,
  done,
) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
  }
  done();
};

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

async function buildApp(opts: {
  pool: FakePool;
  repo: FriendCompletionsRepo;
}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    friendCompletionsRoutes({
      pool: opts.pool as unknown as FriendCompletionsRoutesOptions['pool'],
      repo: opts.repo,
      requireSession,
    }),
  );
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// VIEWER < TARGET lexicographically → canonical pair (lo, hi) = (VIEWER, TARGET).
const VIEWER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

const isFriendshipQuery = (call: FakePoolCall): boolean =>
  call.text.includes('FROM friendships');

function sampleEntry(
  overrides: Partial<CompletionEntry> = {},
): CompletionEntry {
  return {
    experienceId: '33333333-3333-4333-8333-333333333333',
    experienceName: 'Space Mountain',
    park: 'Magic Kingdom',
    areaType: 'ThemePark',
    category: 'Ride',
    completedOn: '2024-05-01',
    rating: 9,
    sharedNote: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GET /users/:userId/completions — error codes
// ---------------------------------------------------------------------------

describe('GET /users/:userId/completions — error codes (R1.5, R1.6, R3.6)', () => {
  it('returns 400 validation_failed for a malformed :userId before any DB access', async () => {
    const { repo, callsForUser } = makeFakeRepo(new Map());
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: '/users/not-a-uuid/completions',
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'validation_failed',
    );
    // No friendship lookup, no repo read on the validation-failure path.
    expect(pool.calls).toHaveLength(0);
    expect(callsForUser).toEqual([]);
  });

  it('denies a non-friend / unknown target with profile_forbidden (403) and does not read completions or disclose any Experience_Id (R1.5)', async () => {
    // The target has completions (incl. an Experience_Id) on file: a leak on
    // the deny path would surface this id, so seed it to prove non-disclosure.
    const seededId = '99999999-9999-4999-8999-999999999999';
    const { repo, callsForUser } = makeFakeRepo(
      new Map([[TARGET_ID, [sampleEntry({ experienceId: seededId })]]]),
    );
    const pool = makeFakePool((call) => {
      if (isFriendshipQuery(call)) {
        return { rows: [{ exists: false }] };
      }
      return { rows: [] };
    });

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/users/${TARGET_ID}/completions`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json() as {
      error: { code: string };
      entries?: unknown;
    };
    expect(body.error.code).toBe('profile_forbidden');

    // The friendship lookup ran exactly once, with the canonical (lo, hi) pair.
    const friendCalls = pool.calls.filter(isFriendshipQuery);
    expect(friendCalls).toHaveLength(1);
    expect(friendCalls[0]!.params).toEqual([VIEWER_ID, TARGET_ID]);

    // The completions read is NOT performed on the deny path.
    expect(callsForUser).toEqual([]);

    // R1.5: the deny response discloses no Completion_Entry and, in
    // particular, no Experience_Id — neither a structured `entries` field nor
    // the seeded id anywhere in the serialized payload.
    expect(body.entries).toBeUndefined();
    expect(res.payload).not.toContain('entries');
    expect(res.payload).not.toContain(seededId);
    expect(res.payload).not.toContain('experienceId');
  });

  it('returns 401 unauthorized when the session check fails, before the owner-or-friend rule (R1.6)', async () => {
    const { repo, callsForUser } = makeFakeRepo(new Map());
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    // No x-test-user-id header → the stub session pre-handler leaves
    // request.userId unset.
    const res = await app.inject({
      method: 'GET',
      url: `/users/${TARGET_ID}/completions`,
    });

    expect(res.statusCode).toBe(401);
    const code = (res.json() as { error: { code: string } }).error.code;
    expect(code).toBe('unauthorized');
    // Session precedence: it must NOT surface as profile_forbidden.
    expect(code).not.toBe('profile_forbidden');

    // Neither the friendship lookup nor the completions read happens when the
    // session check fails first.
    expect(pool.calls.filter(isFriendshipQuery)).toHaveLength(0);
    expect(callsForUser).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /users/:userId/completions — happy path
// ---------------------------------------------------------------------------

describe('GET /users/:userId/completions — authorized reads (R1.1)', () => {
  it('allows the owner to self-read without consulting friendships and returns mapped entries', async () => {
    const entries: CompletionEntry[] = [
      sampleEntry(),
      sampleEntry({
        experienceName: 'Living with the Land',
        park: 'EPCOT',
        category: 'Ride',
        completedOn: '2024-04-01',
        rating: null,
        sharedNote: 'Loved the greenhouse.',
      }),
    ];
    const { repo, callsForUser } = makeFakeRepo(
      new Map([[VIEWER_ID, entries]]),
    );
    const pool = makeFakePool(() => ({ rows: [] }));

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/users/${VIEWER_ID}/completions`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: CompletionEntryDTO[] };
    expect(body.entries).toEqual(entries);

    // Self-read: no friendship lookup, repo read for the owner.
    expect(pool.calls.filter(isFriendshipQuery)).toHaveLength(0);
    expect(callsForUser).toEqual([VIEWER_ID]);
  });

  it('allows an accepted Friend to read the target completions (R1.1)', async () => {
    const entries: CompletionEntry[] = [sampleEntry()];
    const { repo, callsForUser } = makeFakeRepo(
      new Map([[TARGET_ID, entries]]),
    );
    const pool = makeFakePool((call) => {
      if (isFriendshipQuery(call)) {
        return { rows: [{ exists: true }] };
      }
      return { rows: [] };
    });

    const app = await buildApp({ pool, repo });

    const res = await app.inject({
      method: 'GET',
      url: `/users/${TARGET_ID}/completions`,
      headers: { 'x-test-user-id': VIEWER_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { entries: CompletionEntryDTO[] };
    expect(body.entries).toEqual(entries);

    // Friendship lookup ran with canonical (lo, hi) = (VIEWER, TARGET).
    const friendCall = pool.calls.find(isFriendshipQuery);
    expect(friendCall?.params).toEqual([VIEWER_ID, TARGET_ID]);

    // The repo was queried with the TARGET's id, not the viewer's.
    expect(callsForUser).toEqual([TARGET_ID]);
  });
});
