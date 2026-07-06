/**
 * Integration tests for the profile/avatar routes plugin.
 *
 * The plugin is registered against an in-process Fastify instance with a fake
 * database pool. The auth pre-handler is also a fake that simply assigns
 * `request.userId` from a header so that each test controls the requester
 * identity without setting up a session.
 *
 * Coverage focuses on the requirements scoped to the profile routes:
 *   - PATCH /me/profile validation (R7.2, R7.5, R7.6)
 *   - PUT /me/profile/avatar preset selection + allowlist validation (R7.3)
 *   - GET /users/:userId/profile owner-or-friend gate and the
 *     no-analytics-on-deny rule (R7.4, R7.8)
 */

import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';

import { registerErrorHandler } from '../../../errors/handler.js';
import {
  profileRoutes,
  type ProfileRoutesOptions,
} from '../profileRoutes.js';

// ---------------------------------------------------------------------------
// Fake DB pool
// ---------------------------------------------------------------------------
//
// A minimal `pg`-compatible shape that captures the SQL string and
// parameters per call and returns rigged rows. We only need `query`; the
// route handlers never call `connect`/`withTransaction` for the in-scope
// flows.

interface FakePoolCall {
  text: string;
  params: ReadonlyArray<unknown>;
}

interface FakePool {
  query: (text: string, params?: ReadonlyArray<unknown>) => Promise<{ rows: unknown[] }>;
  calls: FakePoolCall[];
  responder: (call: FakePoolCall) => { rows: unknown[] };
}

function makeFakePool(
  responder: (call: FakePoolCall) => { rows: unknown[] },
): FakePool {
  const calls: FakePoolCall[] = [];
  return {
    calls,
    responder,
    async query(text: string, params: ReadonlyArray<unknown> = []) {
      const call: FakePoolCall = { text, params };
      calls.push(call);
      return responder(call);
    },
  };
}

// ---------------------------------------------------------------------------
// Auth pre-handler
// ---------------------------------------------------------------------------

const requireAuth: ProfileRoutesOptions['requireAuth'] = async (request) => {
  const id = request.headers['x-test-user-id'];
  if (typeof id === 'string' && id.length > 0) {
    request.userId = id;
  }
};

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

async function buildApp(opts: {
  pool: FakePool;
  /**
   * Optional pre-`ready` setup callback so tests can install additional
   * hooks (e.g. log spies) before the Fastify instance starts handling
   * requests. Adding hooks after `inject` triggers `ready()` is rejected
   * with `FST_ERR_INSTANCE_ALREADY_LISTENING`.
   */
  setup?: (app: ReturnType<typeof Fastify>) => void | Promise<void>;
}): Promise<{ app: ReturnType<typeof Fastify> }> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(profileRoutes, {
    pool: opts.pool as unknown as ProfileRoutesOptions['pool'],
    requireAuth,
  });
  if (opts.setup) {
    await opts.setup(app);
  }
  await app.ready();
  return { app };
}

// ---------------------------------------------------------------------------
// PATCH /me/profile
// ---------------------------------------------------------------------------

describe('PATCH /me/profile', () => {
  it('updates the display name and returns the new ProfileDTO', async () => {
    const pool = makeFakePool((call) => {
      if (call.text.startsWith('UPDATE profiles')) {
        return {
          rows: [
            { user_id: 'u-1', display_name: 'Alice', avatar_preset: null },
          ],
        };
      }
      if (call.text.includes('completions')) {
        // 4 completions out of 10 active experiences => 40.0
        return { rows: [{ completed: '4', total: '10' }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/profile',
      headers: { 'x-test-user-id': 'u-1', 'content-type': 'application/json' },
      payload: { displayName: '  Alice  ' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      userId: 'u-1',
      displayName: 'Alice',
      avatarPreset: null,
      overallCompletionPercent: 40.0,
    });

    // The UPDATE was issued with the trimmed value.
    const updateCall = pool.calls.find((c) =>
      c.text.startsWith('UPDATE profiles'),
    );
    expect(updateCall?.params[0]).toBe('Alice');
    expect(updateCall?.params[1]).toBe('u-1');
  });

  it('rejects an empty display name with display_name_invalid', async () => {
    const pool = makeFakePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/profile',
      headers: { 'x-test-user-id': 'u-1', 'content-type': 'application/json' },
      payload: { displayName: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: {
        code: 'display_name_invalid',
        message: expect.any(String),
        field: 'displayName',
      },
    });
    // Crucially: no UPDATE was issued, so the prior name is preserved (R7.6).
    expect(
      pool.calls.find((c) => c.text.startsWith('UPDATE profiles')),
    ).toBeUndefined();
  });

  it('rejects a 51-char display name with display_name_invalid', async () => {
    const pool = makeFakePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/profile',
      headers: { 'x-test-user-id': 'u-1', 'content-type': 'application/json' },
      payload: { displayName: 'a'.repeat(51) },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'display_name_invalid',
    );
  });

  it('returns 401 when the request is unauthenticated', async () => {
    const pool = makeFakePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/profile',
      headers: { 'content-type': 'application/json' },
      payload: { displayName: 'Alice' },
    });

    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'unauthorized',
    );
  });
});

// ---------------------------------------------------------------------------
// PUT /me/profile/avatar — preset selection (R7.3)
// ---------------------------------------------------------------------------

describe('PUT /me/profile/avatar', () => {
  it('sets a valid preset id and returns the updated ProfileDTO', async () => {
    const pool = makeFakePool((call) => {
      if (call.text.startsWith('UPDATE profiles')) {
        return {
          rows: [
            {
              user_id: 'u-1',
              display_name: 'Alice',
              avatar_preset: call.params[0] as string | null,
            },
          ],
        };
      }
      if (call.text.includes('completions')) {
        return { rows: [{ completed: '0', total: '0' }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', 'content-type': 'application/json' },
      payload: { avatarPreset: 'castle' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      userId: 'u-1',
      displayName: 'Alice',
      avatarPreset: 'castle',
      overallCompletionPercent: 0,
    });

    // The UPDATE persisted the chosen preset id for the requester.
    const updateCall = pool.calls.find((c) =>
      c.text.startsWith('UPDATE profiles'),
    );
    expect(updateCall?.params[0]).toBe('castle');
    expect(updateCall?.params[1]).toBe('u-1');
  });

  it('accepts null to clear the avatar back to the placeholder', async () => {
    const pool = makeFakePool((call) => {
      if (call.text.startsWith('UPDATE profiles')) {
        return {
          rows: [
            { user_id: 'u-1', display_name: 'Alice', avatar_preset: null },
          ],
        };
      }
      if (call.text.includes('completions')) {
        return { rows: [{ completed: '1', total: '1' }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', 'content-type': 'application/json' },
      payload: { avatarPreset: null },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { avatarPreset: string | null };
    expect(body.avatarPreset).toBeNull();

    const updateCall = pool.calls.find((c) =>
      c.text.startsWith('UPDATE profiles'),
    );
    expect(updateCall?.params[0]).toBeNull();
  });

  it('rejects an unknown preset id with avatar_invalid and does not write', async () => {
    const pool = makeFakePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', 'content-type': 'application/json' },
      payload: { avatarPreset: 'not-a-real-preset' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'avatar_invalid',
    );
    // No UPDATE on rejection — the prior avatar is preserved.
    expect(
      pool.calls.find((c) => c.text.startsWith('UPDATE profiles')),
    ).toBeUndefined();
  });

  it('rejects a body with unexpected extra keys (strict schema)', async () => {
    const pool = makeFakePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', 'content-type': 'application/json' },
      payload: { avatarPreset: 'castle', avatarUrl: 'https://evil.example/x.png' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'avatar_invalid',
    );
  });

  it('returns 401 when the request is unauthenticated', async () => {
    const pool = makeFakePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'content-type': 'application/json' },
      payload: { avatarPreset: 'castle' },
    });

    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'unauthorized',
    );
  });
});

// ---------------------------------------------------------------------------
// GET /users/:userId/profile
// ---------------------------------------------------------------------------

describe('GET /users/:userId/profile', () => {
  it('allows the owner to view their own profile', async () => {
    const pool = makeFakePool((call) => {
      if (call.text.startsWith('SELECT user_id, display_name, avatar_preset FROM profiles')) {
        return {
          rows: [
            { user_id: 'u-1', display_name: 'Alice', avatar_preset: null },
          ],
        };
      }
      if (call.text.includes('completions')) {
        return { rows: [{ completed: '5', total: '20' }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'GET',
      url: '/users/u-1/profile',
      headers: { 'x-test-user-id': 'u-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      userId: 'u-1',
      displayName: 'Alice',
      avatarPreset: null,
      overallCompletionPercent: 25.0,
    });

    // Self-view skips the friendship lookup (no SELECT against friendships).
    expect(
      pool.calls.find((c) => c.text.includes('FROM friendships')),
    ).toBeUndefined();
  });

  it('allows an accepted Friend to view the owner profile', async () => {
    const pool = makeFakePool((call) => {
      if (call.text.includes('FROM friendships')) {
        // Friendship row exists.
        return { rows: [{ exists: true }] };
      }
      if (call.text.startsWith('SELECT user_id, display_name, avatar_preset FROM profiles')) {
        return {
          rows: [
            { user_id: 'u-2', display_name: 'Bob', avatar_preset: 'fireworks' },
          ],
        };
      }
      if (call.text.includes('completions')) {
        return { rows: [{ completed: '0', total: '10' }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'GET',
      url: '/users/u-2/profile',
      // u-1 < u-2 lexicographically so the canonical pair is (u-1, u-2).
      headers: { 'x-test-user-id': 'u-1' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      userId: string;
      avatarPreset: string | null;
      overallCompletionPercent: number;
    };
    expect(body.userId).toBe('u-2');
    expect(body.avatarPreset).toBe('fireworks');
    expect(body.overallCompletionPercent).toBe(0); // R3.6 zero numerator

    // Friendship lookup ran with canonical (lo, hi) = (u-1, u-2).
    const fcall = pool.calls.find((c) => c.text.includes('FROM friendships'));
    expect(fcall?.params).toEqual(['u-1', 'u-2']);
  });

  it('denies a non-friend with profile_forbidden and emits no analytics on deny (R7.8)', async () => {
    const pool = makeFakePool((call) => {
      if (call.text.includes('FROM friendships')) {
        return { rows: [{ exists: false }] };
      }
      return { rows: [] };
    });

    // Spy on every level the route could conceivably write through. None of
    // them must be called on the deny path. The error hook itself logs at
    // `info` once — that is operational logging of an error response, which
    // is distinct from "viewing attempt analytics" and is permitted.
    const infoSpy = vi.fn();
    const debugSpy = vi.fn();
    const { app } = await buildApp({
      pool,
      setup: (instance) => {
        instance.addHook('onRequest', async (request: FastifyRequest) => {
          // Wrap, do not replace, so the error-hook info still fires.
          const original = request.log;
          request.log = new Proxy(original, {
            get(target, prop, receiver) {
              if (prop === 'info') return infoSpy;
              if (prop === 'debug') return debugSpy;
              return Reflect.get(target, prop, receiver);
            },
          }) as typeof request.log;
        });
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/users/u-2/profile',
      headers: { 'x-test-user-id': 'u-1' },
    });

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'profile_forbidden',
    );

    // The route handler itself did not call info/debug for an analytics
    // event. (The error hook calls info for the rejected-error log line;
    // that line carries only the error code, not a viewing-attempt audit.)
    // We assert that no info call is tagged as a profile-view event.
    for (const call of infoSpy.mock.calls) {
      const payload = call[0];
      if (payload && typeof payload === 'object' && 'event' in payload) {
        expect((payload as { event: string }).event).not.toMatch(
          /profile_view/i,
        );
      }
    }
    // The debug stream — historically used for analytics-style traces —
    // was not touched by the deny path.
    expect(debugSpy).not.toHaveBeenCalled();

    // The profile row was NEVER read, because we abort before that query
    // (defense in depth: the requester learns nothing from the deny).
    expect(
      pool.calls.find((c) =>
        c.text.startsWith('SELECT user_id, display_name, avatar_preset FROM profiles'),
      ),
    ).toBeUndefined();
  });

  it('returns 401 when no session is present', async () => {
    const pool = makeFakePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const res = await app.inject({
      method: 'GET',
      url: '/users/u-2/profile',
    });

    expect(res.statusCode).toBe(401);
  });
});
