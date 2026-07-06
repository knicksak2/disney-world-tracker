/**
 * Integration tests for the Auth_Service routes plugin (task 6.3).
 *
 * The plugin is registered against an in-process Fastify instance with a
 * fake pool, a fake lockout service, and a stubbed `requireSession`
 * pre-handler. We never connect to a real database, Redis, or session
 * middleware so each test is hermetic and deterministic.
 *
 * Coverage focuses on the requirements scoped to this task:
 *   - R6.1 register issues a session and returns 201 with `{ user, profile, token }`
 *   - R6.2 / R6.3 duplicate email surfaces as 409 `email_in_use`
 *   - R6.4 schema validation surfaces as 400 `validation_failed` with a `field`
 *   - R6.5 login establishes a session row and returns the token
 *   - R6.6 invalid credentials surface as 401 `invalid_credentials`
 *   - R6.7 lockout-coordination — `account_locked` when the lockout port reports locked
 *   - R6.8 logout sets `revoked_at = now()` on the session row keyed by token hash
 *   - R6.11 plaintext password never appears in the persisted SQL parameters
 *   - GET /me returns the current user and profile through the session pre-handler
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../../errors/handler.js';
import { hashToken } from '../sessionToken.js';
import type { LockoutService } from '../lockout.js';
import { authRoutes, type AuthRoutesOptions } from '../routes.js';

// ---------------------------------------------------------------------------
// Fake pool
// ---------------------------------------------------------------------------
//
// Captures every query string + params, and lets each test rig the rows
// returned per call. The auth routes use both `pool.query` (login, /me,
// logout) and `pool.connect()` (register, which runs in a transaction), so
// the fake supports both and routes the transactional INSERTs through the
// same responder.

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface FakeClient {
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
  release(): void;
}

interface FakePool {
  readonly calls: FakeCall[];
  query(text: string, params?: ReadonlyArray<unknown>): Promise<{ rows: unknown[] }>;
  connect(): Promise<FakeClient>;
}

function makePool(
  responder: (call: FakeCall) => { rows: unknown[] } | Error,
): FakePool {
  const calls: FakeCall[] = [];
  const run = async (text: string, params: ReadonlyArray<unknown> = []) => {
    const call: FakeCall = { text, params };
    calls.push(call);
    const result = responder(call);
    if (result instanceof Error) {
      throw result;
    }
    return result;
  };
  return {
    calls,
    query: run,
    async connect(): Promise<FakeClient> {
      return {
        query: run,
        release: () => undefined,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Fake lockout service
// ---------------------------------------------------------------------------

interface FakeLockout extends LockoutService {
  readonly events: string[];
  setLocked(locked: boolean): void;
}

function makeLockout(initial: { locked?: boolean } = {}): FakeLockout {
  let locked = initial.locked ?? false;
  const events: string[] = [];
  return {
    events,
    setLocked(next: boolean) {
      locked = next;
    },
    async isLocked(userId: string): Promise<boolean> {
      events.push(`isLocked:${userId}`);
      return locked;
    },
    async recordFailure(userId: string): Promise<boolean> {
      events.push(`recordFailure:${userId}`);
      return locked;
    },
    async clearOnSuccess(userId: string): Promise<void> {
      events.push(`clearOnSuccess:${userId}`);
    },
  };
}

// ---------------------------------------------------------------------------
// requireSession stub
// ---------------------------------------------------------------------------
//
// Reads `x-test-user-id` from the request header and assigns it to
// `request.userId` (matching the contract real session middleware exposes).
// Tests pass `null` to simulate an unauthenticated request, which the
// global error hook will translate to a 401.

function makeRequireSession(opts: { userId?: string } = {}): AuthRoutesOptions['requireSession'] {
  return async (request) => {
    const headerUserId = request.headers['x-test-user-id'];
    const id = typeof headerUserId === 'string' && headerUserId.length > 0
      ? headerUserId
      : opts.userId;
    if (!id) {
      // Simulate the real middleware: throw an unauthorized error if no
      // session can be resolved. We do this lazily so the auth-required
      // route paths can opt in.
      const { AppError } = await import('../../../errors/AppError.js');
      throw new AppError('unauthorized', 'Authentication is required.');
    }
    request.userId = id;
  };
}

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

async function buildApp(opts: {
  pool: FakePool;
  lockout?: FakeLockout;
  requireSession?: AuthRoutesOptions['requireSession'];
  now?: () => Date;
}): Promise<{ app: FastifyInstance; lockout: FakeLockout }> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  const lockout = opts.lockout ?? makeLockout();
  await app.register(
    authRoutes({
      pool: opts.pool as unknown as AuthRoutesOptions['pool'],
      lockout,
      requireSession: opts.requireSession ?? makeRequireSession(),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    }),
  );
  await app.ready();
  return { app, lockout };
}

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

describe('POST /auth/register', () => {
  it('creates the user, profile, and session and returns 201 with the token (R6.1)', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('INSERT INTO users')) {
        return { rows: [{ id: 'user-1', email: 'alice@example.com' }] };
      }
      if (call.text.startsWith('INSERT INTO profiles')) {
        return { rows: [] };
      }
      if (call.text.startsWith('INSERT INTO sessions')) {
        return { rows: [{ id: 'session-1' }] };
      }
      // BEGIN / COMMIT
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'alice@example.com',
        displayName: 'Alice',
        password: 'correcthorsebatterystaple',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      user: { id: string; email: string };
      profile: { displayName: string };
      token: string;
    };
    expect(body.user).toEqual({ id: 'user-1', email: 'alice@example.com' });
    expect(body.profile).toEqual({ displayName: 'Alice' });
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);

    // Transaction was opened/committed.
    expect(pool.calls.some((c) => c.text === 'BEGIN')).toBe(true);
    expect(pool.calls.some((c) => c.text === 'COMMIT')).toBe(true);
  });

  it('persists only the Argon2id hash, never the plaintext password (R6.11)', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('INSERT INTO users')) {
        return { rows: [{ id: 'user-1', email: 'bob@example.com' }] };
      }
      if (call.text.startsWith('INSERT INTO profiles')) {
        return { rows: [] };
      }
      if (call.text.startsWith('INSERT INTO sessions')) {
        return { rows: [{ id: 'session-1' }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const plaintext = 's3cret-passw0rd-xyz';
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'bob@example.com',
        displayName: 'Bob',
        password: plaintext,
      },
    });

    // No persisted SQL parameter — across every captured call — equals the
    // plaintext, and no captured call's text contains it.
    for (const call of pool.calls) {
      expect(call.text.includes(plaintext)).toBe(false);
      for (const param of call.params) {
        expect(param).not.toBe(plaintext);
      }
    }
    // The users INSERT received an Argon2 PHC string for the hash column.
    const userInsert = pool.calls.find((c) => c.text.startsWith('INSERT INTO users'));
    expect(userInsert).toBeDefined();
    const persistedHash = userInsert!.params[1];
    expect(typeof persistedHash).toBe('string');
    expect(String(persistedHash)).toMatch(/^\$argon2id\$/);
  });

  it('returns 409 email_in_use when the citext UNIQUE constraint trips (R6.3)', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('INSERT INTO users')) {
        const err = new Error('duplicate key value violates unique constraint') as Error & {
          code: string;
        };
        err.code = '23505';
        return err;
      }
      return { rows: [] };
    });
    const { app } = await buildApp({ pool });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'taken@example.com',
        displayName: 'Taken',
        password: 'long-enough-password',
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('email_in_use');
    expect(body.error.field).toBe('email');

    // Transaction was rolled back.
    expect(pool.calls.some((c) => c.text === 'ROLLBACK')).toBe(true);
    expect(pool.calls.some((c) => c.text === 'COMMIT')).toBe(false);
  });

  it('returns 400 validation_failed with field on Zod schema violation (R6.4)', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'not-an-email',
        displayName: 'Alice',
        password: 'long-enough-password',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.field).toBe('email');
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe('POST /auth/login', () => {
  // A fixed Argon2id encoded hash for the password "correctpass1234".
  // Pre-computed once so the test does not need to call `argon2.hash` itself
  // (which would slow each run by ~100ms). Generated with the production
  // parameters (m=64MiB, t=3, p=1) so `verify` accepts it.
  const knownPassword = 'correctpass1234';
  // We compute this at module load so we don't ship a stale hash.
  let knownHash: string | undefined;

  async function ensureHash(): Promise<string> {
    if (!knownHash) {
      const { hash } = await import('../password.js');
      knownHash = await hash(knownPassword);
    }
    return knownHash;
  }

  it('issues a session and returns the token on valid credentials (R6.5)', async () => {
    const passwordHash = await ensureHash();
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT id, email, password_hash')) {
        return {
          rows: [
            {
              id: 'user-1',
              email: 'alice@example.com',
              password_hash: passwordHash,
            },
          ],
        };
      }
      if (call.text.startsWith('SELECT display_name')) {
        return { rows: [{ display_name: 'Alice' }] };
      }
      if (call.text.startsWith('INSERT INTO sessions')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const lockout = makeLockout({ locked: false });
    const { app } = await buildApp({ pool, lockout });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'alice@example.com', password: knownPassword },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      user: { id: string; email: string };
      profile: { displayName: string };
      token: string;
    };
    expect(body.user.id).toBe('user-1');
    expect(body.profile.displayName).toBe('Alice');
    expect(body.token.length).toBeGreaterThan(0);

    // Lockout flow: isLocked checked, then clearOnSuccess on the success path.
    expect(lockout.events).toEqual(['isLocked:user-1', 'clearOnSuccess:user-1']);

    // Session row was inserted.
    expect(pool.calls.some((c) => c.text.startsWith('INSERT INTO sessions'))).toBe(true);
  });

  it('returns 401 invalid_credentials on a wrong password and records a failure (R6.6, R6.7)', async () => {
    const passwordHash = await ensureHash();
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT id, email, password_hash')) {
        return {
          rows: [
            { id: 'user-1', email: 'alice@example.com', password_hash: passwordHash },
          ],
        };
      }
      return { rows: [] };
    });
    const lockout = makeLockout({ locked: false });
    const { app } = await buildApp({ pool, lockout });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'alice@example.com', password: 'totally-wrong-pass' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('invalid_credentials');
    expect(lockout.events).toContain('recordFailure:user-1');
    expect(lockout.events).not.toContain('clearOnSuccess:user-1');
  });

  it('returns 401 invalid_credentials for an unknown email without consulting lockout (no existence leak)', async () => {
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT id, email, password_hash')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const lockout = makeLockout();
    const { app } = await buildApp({ pool, lockout });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', password: 'long-enough-password' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('invalid_credentials');
    // No userId to key it on, so no lockout activity at all.
    expect(lockout.events).toEqual([]);
  });

  it('returns 423 account_locked when the lockout service reports locked (R6.7)', async () => {
    const passwordHash = await ensureHash();
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT id, email, password_hash')) {
        return {
          rows: [
            { id: 'user-1', email: 'alice@example.com', password_hash: passwordHash },
          ],
        };
      }
      return { rows: [] };
    });
    const lockout = makeLockout({ locked: true });
    const { app } = await buildApp({ pool, lockout });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'alice@example.com', password: knownPassword },
    });

    expect(response.statusCode).toBe(423);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('account_locked');
    // We bailed before verifying the password — no session row inserted.
    expect(pool.calls.some((c) => c.text.startsWith('INSERT INTO sessions'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

describe('POST /auth/logout', () => {
  it('stamps revoked_at on the matching session row keyed by token hash (R6.8)', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const { app } = await buildApp({
      pool,
      requireSession: makeRequireSession({ userId: 'user-1' }),
    });

    const bearer = 'opaquesessiontokenABCDEFG';
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        authorization: `Bearer ${bearer}`,
        'x-test-user-id': 'user-1',
      },
    });

    expect(response.statusCode).toBe(204);

    const update = pool.calls.find((c) => c.text.includes('UPDATE sessions'));
    expect(update).toBeDefined();
    expect(update!.text).toMatch(/SET revoked_at = now\(\)/);
    // Looked up by hash, not plaintext token.
    expect(update!.params[0]).toBe(hashToken(bearer));
    expect(update!.params[0]).not.toBe(bearer);
    expect(update!.params[1]).toBe('user-1');
  });

  it('returns 401 unauthorized when the requireSession pre-handler rejects', async () => {
    const pool = makePool(() => ({ rows: [] }));
    // requireSession with no header configured will reject any request.
    const { app } = await buildApp({ pool });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(response.statusCode).toBe(401);
    expect(pool.calls.find((c) => c.text.includes('UPDATE sessions'))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// POST /auth/change-password
// ---------------------------------------------------------------------------

describe('POST /auth/change-password', () => {
  const currentPassword = 'correctpass1234';
  let currentHash: string | undefined;

  async function ensureCurrentHash(): Promise<string> {
    if (!currentHash) {
      const { hash } = await import('../password.js');
      currentHash = await hash(currentPassword);
    }
    return currentHash;
  }

  it('updates the hash, revokes other sessions, and returns 204 on success (R6.13, R6.16)', async () => {
    const passwordHash = await ensureCurrentHash();
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT password_hash FROM users')) {
        return { rows: [{ password_hash: passwordHash }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({
      pool,
      requireSession: makeRequireSession({ userId: 'user-1' }),
    });

    const bearer = 'opaquesessiontokenABCDEFG';
    const newPassword = 'brand-new-passw0rd';
    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: {
        authorization: `Bearer ${bearer}`,
        'x-test-user-id': 'user-1',
      },
      payload: { currentPassword, newPassword },
    });

    expect(response.statusCode).toBe(204);

    // Password was updated with a fresh Argon2id hash, not the plaintext.
    const update = pool.calls.find((c) => c.text.includes('UPDATE users SET password_hash'));
    expect(update).toBeDefined();
    expect(typeof update!.params[0]).toBe('string');
    expect(String(update!.params[0])).toMatch(/^\$argon2id\$/);
    expect(update!.params[0]).not.toBe(newPassword);
    expect(update!.params[1]).toBe('user-1');

    // Other sessions (everything except the caller's current token) revoked.
    const revoke = pool.calls.find(
      (c) => c.text.includes('UPDATE sessions') && c.text.includes('token_hash <>'),
    );
    expect(revoke).toBeDefined();
    expect(revoke!.params[0]).toBe('user-1');
    expect(revoke!.params[1]).toBe(hashToken(bearer));

    // Wrapped in a transaction.
    expect(pool.calls.some((c) => c.text === 'BEGIN')).toBe(true);
    expect(pool.calls.some((c) => c.text === 'COMMIT')).toBe(true);

    // The plaintext never appears in any captured SQL parameter.
    for (const call of pool.calls) {
      for (const param of call.params) {
        expect(param).not.toBe(newPassword);
        expect(param).not.toBe(currentPassword);
      }
    }
  });

  it('returns 401 invalid_credentials when the current password is wrong, leaving the hash untouched (R6.14)', async () => {
    const passwordHash = await ensureCurrentHash();
    const pool = makePool((call) => {
      if (call.text.startsWith('SELECT password_hash FROM users')) {
        return { rows: [{ password_hash: passwordHash }] };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({
      pool,
      requireSession: makeRequireSession({ userId: 'user-1' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: {
        authorization: 'Bearer some-token',
        'x-test-user-id': 'user-1',
      },
      payload: { currentPassword: 'wrong-current-pass', newPassword: 'brand-new-passw0rd' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('invalid_credentials');
    expect(pool.calls.some((c) => c.text.includes('UPDATE users SET password_hash'))).toBe(false);
  });

  it('returns 400 validation_failed when the new password is too short (R6.15)', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const { app } = await buildApp({
      pool,
      requireSession: makeRequireSession({ userId: 'user-1' }),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: {
        authorization: 'Bearer some-token',
        'x-test-user-id': 'user-1',
      },
      payload: { currentPassword: 'correctpass1234', newPassword: 'short' },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; field?: string } };
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.field).toBe('newPassword');
    // Bailed before touching the database.
    expect(pool.calls.some((c) => c.text.includes('UPDATE users'))).toBe(false);
  });

  it('returns 401 unauthorized when no session is attached', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: 'correctpass1234', newPassword: 'brand-new-passw0rd' },
    });

    expect(response.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------

describe('GET /me', () => {
  it('returns the authenticated user and profile', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('FROM users u')) {
        return {
          rows: [
            {
              id: 'user-1',
              email: 'alice@example.com',
              display_name: 'Alice',
              avatar_preset: 'castle',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { app } = await buildApp({
      pool,
      requireSession: makeRequireSession({ userId: 'user-1' }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-test-user-id': 'user-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: { id: 'user-1', email: 'alice@example.com' },
      profile: { displayName: 'Alice', avatarPreset: 'castle' },
    });
  });

  it('returns 401 unauthorized when no session is attached', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const { app } = await buildApp({ pool });

    const response = await app.inject({ method: 'GET', url: '/me' });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 unauthorized when the user row was deleted between auth and lookup', async () => {
    const pool = makePool(() => ({ rows: [] }));
    const { app } = await buildApp({
      pool,
      requireSession: makeRequireSession({ userId: 'ghost-user' }),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { 'x-test-user-id': 'ghost-user' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });
});
