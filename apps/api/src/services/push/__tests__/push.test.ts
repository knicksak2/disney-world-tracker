/**
 * Unit tests for the Push_Registration_Service (task 12.3).
 *
 * These cover the three behaviors scoped to this task:
 *
 *   - R8.4  Logout invalidation via `DELETE /me/push-registrations`
 *           transitions the current device's active registration to
 *           `invalidated` (through `repo.invalidateDevice`).
 *   - R8.6  `listActiveTokensForUser` excludes `invalidated`
 *           registrations from the delivery target set (the query is gated
 *           by `status = 'active'`).
 *   - R8.7  Malformed input — a blank/missing device id or Expo push token —
 *           is rejected with the `push_registration_invalid` error code
 *           without touching the repo.
 *
 * The repo is exercised against a hand-rolled fake `pg.Pool` that captures
 * every `query()`/`connect()` call and lets each test rig rows for specific
 * SQL. The routes are mounted on an in-process Fastify instance with a fake
 * `PushRepo` and a stubbed `requireSession` pre-handler. No real database or
 * session middleware is involved; each test is hermetic and deterministic.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../../errors/handler.js';
import { createPushRepo } from '../repo.js';
import { pushRoutes, type PushRoutesOptions } from '../routes.js';
import type { PushRegistrationState, PushRepo } from '../repo.js';

// ---------------------------------------------------------------------------
// Fake pool (for repo tests)
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
  readonly via: 'pool' | 'client';
}

interface RiggedResponse {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  readonly rowCount?: number;
  readonly throw?: Error;
}

type Responder = (call: FakeCall) => RiggedResponse | undefined;

interface FakeClientHandle {
  readonly released: boolean;
}

interface FakePool {
  readonly calls: FakeCall[];
  readonly clients: FakeClientHandle[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount: number }>;
  connect(): Promise<{
    query(
      text: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<{
      rows: ReadonlyArray<Record<string, unknown>>;
      rowCount: number;
    }>;
    release(): void;
  }>;
}

function makePool(responder: Responder = () => undefined): FakePool {
  const calls: FakeCall[] = [];
  const clients: FakeClientHandle[] = [];

  const dispatch = async (
    text: string,
    params: ReadonlyArray<unknown> = [],
    via: 'pool' | 'client',
  ) => {
    const call: FakeCall = { text, params, via };
    calls.push(call);
    const rigged = responder(call);
    if (rigged?.throw) {
      throw rigged.throw;
    }
    const rows = rigged?.rows ?? [];
    return { rows, rowCount: rigged?.rowCount ?? rows.length };
  };

  return {
    calls,
    clients,
    async query(text, params) {
      return dispatch(text, params, 'pool');
    },
    async connect() {
      const handle: { released: boolean } = { released: false };
      clients.push(handle);
      return {
        async query(text, params) {
          if (handle.released) {
            throw new Error('client used after release');
          }
          return dispatch(text, params, 'client');
        },
        release() {
          handle.released = true;
        },
      };
    },
  };
}

const USER_ID = '00000000-0000-5000-8000-000000000001';
const DEVICE_ID = 'device-abc';

// ---------------------------------------------------------------------------
// PushRepo.invalidateDevice (R8.4)
// ---------------------------------------------------------------------------

describe('PushRepo.invalidateDevice', () => {
  it('marks the active registration invalidated and reports true', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('UPDATE push_registrations')) {
        return { rowCount: 1 };
      }
      return undefined;
    });
    const repo = createPushRepo(pool as never);

    const changed = await repo.invalidateDevice(USER_ID, DEVICE_ID);

    expect(changed).toBe(true);
    const call = pool.calls[0]!;
    // The UPDATE flips status to 'invalidated' and is gated by the requesting
    // (user, device) plus status = 'active' so only the caller's own active
    // row is touched (R8.4).
    expect(call.text).toMatch(/UPDATE push_registrations/);
    expect(call.text).toMatch(/SET status = 'invalidated'/);
    expect(call.text).toMatch(/user_id = \$1/);
    expect(call.text).toMatch(/device_id = \$2/);
    expect(call.text).toMatch(/status = 'active'/);
    expect(call.params).toEqual([USER_ID, DEVICE_ID]);
  });

  it('reports false when the device had no active registration (idempotent logout)', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('UPDATE push_registrations')) {
        // No active row matched — a repeated logout or already-invalidated device.
        return { rowCount: 0 };
      }
      return undefined;
    });
    const repo = createPushRepo(pool as never);

    expect(await repo.invalidateDevice(USER_ID, DEVICE_ID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PushRepo.listActiveTokensForUser (R8.6)
// ---------------------------------------------------------------------------

describe('PushRepo.listActiveTokensForUser', () => {
  it('queries only active registrations, excluding invalidated ones', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('SELECT expo_push_token')) {
        // The DB returns only rows the query selected; the fake mirrors that the
        // SQL filters on status = 'active', so an invalidated token is absent.
        return {
          rows: [
            { expo_push_token: 'ExponentPushToken[active-newest]' },
            { expo_push_token: 'ExponentPushToken[active-older]' },
          ],
        };
      }
      return undefined;
    });
    const repo = createPushRepo(pool as never);

    const tokens = await repo.listActiveTokensForUser(USER_ID);

    expect(tokens).toEqual([
      'ExponentPushToken[active-newest]',
      'ExponentPushToken[active-older]',
    ]);
    const call = pool.calls[0]!;
    // R8.6: the delivery query is gated by status = 'active', so invalidated
    // (or rotated-away) registrations never enter the target set.
    expect(call.text).toMatch(/SELECT expo_push_token/);
    expect(call.text).toMatch(/status = 'active'/);
    expect(call.text).toMatch(/user_id = \$1/);
    expect(call.params).toEqual([USER_ID]);
  });

  it('returns an empty list when the user has no active registrations', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('SELECT expo_push_token')) {
        // Every registration for this user is invalidated → no active rows.
        return { rows: [] };
      }
      return undefined;
    });
    const repo = createPushRepo(pool as never);

    expect(await repo.listActiveTokensForUser(USER_ID)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Routes: stubs and app builder
// ---------------------------------------------------------------------------

interface RepoCalls {
  register: Array<{ userId: string; deviceId: string; expoPushToken: string }>;
  invalidateDevice: Array<{ userId: string; deviceId: string }>;
  listActiveTokensForUser: string[];
}

interface RepoStubs {
  register?: (
    userId: string,
    deviceId: string,
    expoPushToken: string,
  ) => Promise<PushRegistrationState>;
  invalidateDevice?: (userId: string, deviceId: string) => Promise<boolean>;
}

function makeRepo(stubs: RepoStubs = {}): { repo: PushRepo; calls: RepoCalls } {
  const calls: RepoCalls = {
    register: [],
    invalidateDevice: [],
    listActiveTokensForUser: [],
  };
  return {
    calls,
    repo: {
      async register(userId, deviceId, expoPushToken) {
        calls.register.push({ userId, deviceId, expoPushToken });
        if (stubs.register) {
          return stubs.register(userId, deviceId, expoPushToken);
        }
        return {
          userId,
          deviceId,
          expoPushToken,
          status: 'active',
          updatedAt: '2025-01-01T00:00:00.000Z',
        };
      },
      async invalidateDevice(userId, deviceId) {
        calls.invalidateDevice.push({ userId, deviceId });
        if (stubs.invalidateDevice) {
          return stubs.invalidateDevice(userId, deviceId);
        }
        return true;
      },
      async invalidateByToken() {
        return true;
      },
      async listActiveTokensForUser(userId) {
        calls.listActiveTokensForUser.push(userId);
        return [];
      },
    },
  };
}

/**
 * `requireSession` stub. By default assigns `USER_ID`; pass `unauthorized`
 * to exercise the gating path.
 */
function makeRequireSession(
  opts: { userId?: string; unauthorized?: boolean } = {},
): PushRoutesOptions['requireSession'] {
  return async (request) => {
    if (opts.unauthorized === true) {
      return;
    }
    (request as { userId?: string }).userId = opts.userId ?? USER_ID;
  };
}

async function buildApp(
  overrides: Partial<PushRoutesOptions> = {},
): Promise<{ app: FastifyInstance; calls: RepoCalls }> {
  const fallback = makeRepo();
  const repo = overrides.repo ?? fallback.repo;
  const calls = overrides.repo
    ? {
        register: [],
        invalidateDevice: [],
        listActiveTokensForUser: [],
      }
    : fallback.calls;

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    pushRoutes({
      repo,
      requireSession: overrides.requireSession ?? makeRequireSession(),
    }),
  );
  await app.ready();
  return { app, calls };
}

// ---------------------------------------------------------------------------
// DELETE /me/push-registrations — logout invalidation (R8.4)
// ---------------------------------------------------------------------------

describe('DELETE /me/push-registrations', () => {
  it('invalidates the current device and returns 204', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/me/push-registrations',
      payload: { deviceId: DEVICE_ID },
    });

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    // The route forwards the authenticated user and body device id to the repo
    // so the current device's registration is marked invalidated (R8.4).
    expect(calls.invalidateDevice).toEqual([
      { userId: USER_ID, deviceId: DEVICE_ID },
    ]);
  });

  it('returns 204 even when no active registration existed (idempotent)', async () => {
    const { repo, calls } = makeRepo({
      async invalidateDevice() {
        return false;
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'DELETE',
      url: '/me/push-registrations',
      payload: { deviceId: DEVICE_ID },
    });

    // A repeated logout is indistinguishable from the first: still 204.
    expect(res.statusCode).toBe(204);
    expect(calls.invalidateDevice).toEqual([
      { userId: USER_ID, deviceId: DEVICE_ID },
    ]);
  });

  it('rejects a blank device id with push_registration_invalid without touching the repo', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'DELETE',
      url: '/me/push-registrations',
      payload: { deviceId: '   ' },
    });

    expect(res.json()).toMatchObject({
      error: { code: 'push_registration_invalid' },
    });
    expect(calls.invalidateDevice).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /me/push-registrations — malformed input rejection (R8.7)
// ---------------------------------------------------------------------------

describe('POST /me/push-registrations malformed input (R8.7)', () => {
  it('registers a well-formed device and returns 201', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/me/push-registrations',
      payload: {
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc123]',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      deviceId: DEVICE_ID,
      expoPushToken: 'ExponentPushToken[abc123]',
      status: 'active',
    });
    expect(calls.register).toEqual([
      {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        expoPushToken: 'ExponentPushToken[abc123]',
      },
    ]);
  });

  it('rejects a blank device id with push_registration_invalid', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/me/push-registrations',
      payload: { deviceId: '   ', expoPushToken: 'ExponentPushToken[abc]' },
    });

    expect(res.json()).toMatchObject({
      error: { code: 'push_registration_invalid', field: 'deviceId' },
    });
    expect(calls.register).toEqual([]);
  });

  it('rejects a blank Expo push token with push_registration_invalid', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/me/push-registrations',
      payload: { deviceId: DEVICE_ID, expoPushToken: '   ' },
    });

    expect(res.json()).toMatchObject({
      error: { code: 'push_registration_invalid', field: 'expoPushToken' },
    });
    expect(calls.register).toEqual([]);
  });

  it('rejects a missing device id field with push_registration_invalid', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/me/push-registrations',
      payload: { expoPushToken: 'ExponentPushToken[abc]' },
    });

    expect(res.json()).toMatchObject({
      error: { code: 'push_registration_invalid' },
    });
    expect(calls.register).toEqual([]);
  });

  it('rejects a missing Expo push token field with push_registration_invalid', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'POST',
      url: '/me/push-registrations',
      payload: { deviceId: DEVICE_ID },
    });

    expect(res.json()).toMatchObject({
      error: { code: 'push_registration_invalid' },
    });
    expect(calls.register).toEqual([]);
  });
});
