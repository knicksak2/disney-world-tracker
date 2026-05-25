/**
 * Integration tests for the profile/avatar routes plugin.
 *
 * The plugin is registered against an in-process Fastify instance with
 * fakes for the database pool and the S3 client. The auth pre-handler is
 * also a fake that simply assigns `request.userId` from a header so that
 * each test controls the requester identity without setting up a session.
 *
 * Coverage focuses on the requirements scoped to task 6.5:
 *   - PATCH /me/profile validation (R7.2, R7.5, R7.6)
 *   - PUT /me/profile/avatar magic-byte sniff and size cap (R7.3, R7.7)
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
// Fake S3 client
// ---------------------------------------------------------------------------
//
// Records every `send` call. We never actually open a TCP connection.

function makeFakeS3() {
  const sent: unknown[] = [];
  return {
    sent,
    async send(cmd: unknown) {
      sent.push(cmd);
      return {};
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
  s3?: ReturnType<typeof makeFakeS3>;
  /**
   * Optional pre-`ready` setup callback so tests can install additional
   * hooks (e.g. log spies) before the Fastify instance starts handling
   * requests. Adding hooks after `inject` triggers `ready()` is rejected
   * with `FST_ERR_INSTANCE_ALREADY_LISTENING`.
   */
  setup?: (app: ReturnType<typeof Fastify>) => void | Promise<void>;
}): Promise<{
  app: ReturnType<typeof Fastify>;
  s3: ReturnType<typeof makeFakeS3>;
}> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const s3 = opts.s3 ?? makeFakeS3();
  await app.register(profileRoutes, {
    pool: opts.pool as unknown as ProfileRoutesOptions['pool'],
    s3Client: s3 as unknown as ProfileRoutesOptions['s3Client'],
    bucket: 'avatars',
    endpoint: 'https://s3.example.com',
    requireAuth,
  });
  if (opts.setup) {
    await opts.setup(app);
  }
  await app.ready();
  return { app, s3 };
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
            { user_id: 'u-1', display_name: 'Alice', avatar_url: null },
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
      avatarUrl: null,
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
// PUT /me/profile/avatar
// ---------------------------------------------------------------------------

/**
 * Build a multipart/form-data body containing a single `avatar` file with
 * the supplied bytes. Avoids pulling `form-data` as a test dependency.
 */
function multipartAvatarBody(
  bytes: Buffer,
  filename = 'avatar.bin',
  contentType = 'application/octet-stream',
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----dwt-test-boundary-7f3a';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="avatar"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const payload = Buffer.concat([head, bytes, tail]);
  return {
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
  };
}

describe('PUT /me/profile/avatar', () => {
  it('accepts a PNG, uploads to S3, and updates the profile', async () => {
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    ]);

    const pool = makeFakePool((call) => {
      if (call.text.startsWith('UPDATE profiles')) {
        return {
          rows: [
            {
              user_id: 'u-1',
              display_name: 'Alice',
              avatar_url: call.params[0] as string,
            },
          ],
        };
      }
      if (call.text.includes('completions')) {
        return { rows: [{ completed: '0', total: '0' }] };
      }
      return { rows: [] };
    });
    const { app, s3 } = await buildApp({ pool });

    const { payload, headers } = multipartAvatarBody(pngBytes);
    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', ...headers },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      userId: string;
      avatarUrl: string;
      overallCompletionPercent: number;
    };
    expect(body.userId).toBe('u-1');
    // The avatar URL should reference the configured endpoint and bucket
    // and the path should include `avatars/u-1/`.
    expect(body.avatarUrl.startsWith('https://s3.example.com/avatars/avatars/u-1/'))
      .toBe(true);
    expect(body.avatarUrl.endsWith('.png')).toBe(true);
    // Zero-denominator stats produce 0.0 (R3.6).
    expect(body.overallCompletionPercent).toBe(0);

    // Exactly one PUT was sent to S3.
    expect(s3.sent).toHaveLength(1);

    // The DB row was updated with mime=image/png and size = PNG byte count.
    const updateCall = pool.calls.find((c) =>
      c.text.startsWith('UPDATE profiles'),
    );
    expect(updateCall?.params[1]).toBe('image/png');
    expect(updateCall?.params[2]).toBe(pngBytes.length);
  });

  it('accepts a JPEG signature', async () => {
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

    const pool = makeFakePool((call) => {
      if (call.text.startsWith('UPDATE profiles')) {
        return {
          rows: [
            {
              user_id: 'u-1',
              display_name: 'Alice',
              avatar_url: call.params[0] as string,
            },
          ],
        };
      }
      if (call.text.includes('completions')) {
        return { rows: [{ completed: '1', total: '1' }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const { payload, headers } = multipartAvatarBody(jpegBytes, 'avatar.jpg');
    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', ...headers },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { avatarUrl: string };
    expect(body.avatarUrl.endsWith('.jpg')).toBe(true);

    const updateCall = pool.calls.find((c) =>
      c.text.startsWith('UPDATE profiles'),
    );
    expect(updateCall?.params[1]).toBe('image/jpeg');
  });

  it('rejects a payload whose magic bytes are not PNG/JPEG (type confusion)', async () => {
    // GIF87a header — must NOT pass even though some clients may claim
    // image/png in the part headers.
    const gifBytes = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);

    const pool = makeFakePool(() => ({ rows: [] }));
    const { app, s3 } = await buildApp({ pool });

    const { payload, headers } = multipartAvatarBody(
      gifBytes,
      'avatar.png',
      'image/png',
    );
    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', ...headers },
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'avatar_invalid',
    );
    // Critical: no S3 upload, no DB update on rejection (R7.7).
    expect(s3.sent).toHaveLength(0);
    expect(
      pool.calls.find((c) => c.text.startsWith('UPDATE profiles')),
    ).toBeUndefined();
  });

  it('rejects an oversized payload', async () => {
    // 5 MB + 1 byte starting with a real PNG signature. The multipart
    // streaming layer rejects this at `limits.fileSize`.
    const oversize = Buffer.alloc(5 * 1024 * 1024 + 1);
    oversize[0] = 0x89;
    oversize[1] = 0x50;
    oversize[2] = 0x4e;
    oversize[3] = 0x47;

    const pool = makeFakePool(() => ({ rows: [] }));
    const { app, s3 } = await buildApp({ pool });

    const { payload, headers } = multipartAvatarBody(oversize);
    const res = await app.inject({
      method: 'PUT',
      url: '/me/profile/avatar',
      headers: { 'x-test-user-id': 'u-1', ...headers },
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      'avatar_invalid',
    );
    expect(s3.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /users/:userId/profile
// ---------------------------------------------------------------------------

describe('GET /users/:userId/profile', () => {
  it('allows the owner to view their own profile', async () => {
    const pool = makeFakePool((call) => {
      if (call.text.startsWith('SELECT user_id, display_name, avatar_url FROM profiles')) {
        return {
          rows: [
            { user_id: 'u-1', display_name: 'Alice', avatar_url: null },
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
      avatarUrl: null,
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
      if (call.text.startsWith('SELECT user_id, display_name, avatar_url FROM profiles')) {
        return {
          rows: [
            { user_id: 'u-2', display_name: 'Bob', avatar_url: null },
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
    const body = res.json() as { userId: string; overallCompletionPercent: number };
    expect(body.userId).toBe('u-2');
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
        c.text.startsWith('SELECT user_id, display_name, avatar_url FROM profiles'),
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
