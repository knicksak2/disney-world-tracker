/**
 * Unit tests for the notification preference store (task 13.2).
 *
 * These cover the two behaviors scoped to this task:
 *
 *   - R9.7  A read for a User who has never set the preference returns
 *           `{ pushNotificationsEnabled: true }` (default enabled). No row is
 *           written as a side effect of the read.
 *   - R9.8  When the value cannot be persisted, the store propagates the
 *           underlying error and the `PUT` route surfaces an error envelope so
 *           the client keeps its previously persisted value and shows a
 *           message.
 *
 * The repo is exercised against a hand-rolled fake `pg.Pool` that captures
 * every `query()` call and lets each test rig rows for specific SQL. The
 * routes are mounted on an in-process Fastify instance with a fake
 * `NotificationPreferenceRepo` and a stubbed `requireSession` pre-handler.
 * No real database or session middleware is involved; each test is hermetic
 * and deterministic. This mirrors the rig used in `push.test.ts`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import {
  createNotificationPreferenceRepo,
  type NotificationPreferenceRepo,
} from '../preferenceRepo.js';
import {
  notificationPreferenceRoutes,
  type NotificationPreferenceRoutesOptions,
} from '../preferenceRoutes.js';

// ---------------------------------------------------------------------------
// Fake pool (for repo tests)
// ---------------------------------------------------------------------------

interface FakeCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface RiggedResponse {
  readonly rows?: ReadonlyArray<Record<string, unknown>>;
  readonly rowCount?: number;
  readonly throw?: Error;
}

type Responder = (call: FakeCall) => RiggedResponse | undefined;

interface FakePool {
  readonly calls: FakeCall[];
  query(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>>; rowCount: number }>;
}

function makePool(responder: Responder = () => undefined): FakePool {
  const calls: FakeCall[] = [];
  return {
    calls,
    async query(text, params = []) {
      const call: FakeCall = { text, params };
      calls.push(call);
      const rigged = responder(call);
      if (rigged?.throw) {
        throw rigged.throw;
      }
      const rows = rigged?.rows ?? [];
      return { rows, rowCount: rigged?.rowCount ?? rows.length };
    },
  };
}

const USER_ID = '00000000-0000-5000-8000-000000000001';

// ---------------------------------------------------------------------------
// NotificationPreferenceRepo.getPreference (R9.7 default)
// ---------------------------------------------------------------------------

describe('NotificationPreferenceRepo.getPreference', () => {
  it('defaults to enabled when the User has never set a preference (no row)', async () => {
    // The SELECT returns no rows: the User has never toggled the setting.
    const pool = makePool((call) => {
      if (call.text.includes('SELECT push_notifications_enabled')) {
        return { rows: [] };
      }
      return undefined;
    });
    const repo = createNotificationPreferenceRepo(pool as never);

    const pref = await repo.getPreference(USER_ID);

    // R9.7: absence of a row is treated as enabled by default.
    expect(pref).toEqual({ pushNotificationsEnabled: true });
    // Exactly one read; the read never writes a row as a side effect.
    expect(pool.calls).toHaveLength(1);
    const call = pool.calls[0]!;
    expect(call.text).toMatch(/SELECT push_notifications_enabled/);
    expect(call.text).toMatch(/FROM notification_preferences/);
    expect(call.text).toMatch(/user_id = \$1/);
    expect(call.text).not.toMatch(/INSERT|UPDATE/);
    expect(call.params).toEqual([USER_ID]);
  });

  it('returns the stored value when a row exists', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('SELECT push_notifications_enabled')) {
        return { rows: [{ push_notifications_enabled: false }] };
      }
      return undefined;
    });
    const repo = createNotificationPreferenceRepo(pool as never);

    // A persisted `false` is returned as-is rather than the default.
    expect(await repo.getPreference(USER_ID)).toEqual({
      pushNotificationsEnabled: false,
    });
  });
});

// ---------------------------------------------------------------------------
// NotificationPreferenceRepo.setPreference (R9.8 propagation)
// ---------------------------------------------------------------------------

describe('NotificationPreferenceRepo.setPreference', () => {
  it('returns the persisted value from the upsert RETURNING clause', async () => {
    const pool = makePool((call) => {
      if (call.text.includes('INSERT INTO notification_preferences')) {
        return { rows: [{ push_notifications_enabled: false }] };
      }
      return undefined;
    });
    const repo = createNotificationPreferenceRepo(pool as never);

    const pref = await repo.setPreference(USER_ID, false);

    // R9.4/R9.5: the persisted value is echoed, not the request value.
    expect(pref).toEqual({ pushNotificationsEnabled: false });
    const call = pool.calls[0]!;
    expect(call.text).toMatch(/INSERT INTO notification_preferences/);
    expect(call.text).toMatch(/ON CONFLICT \(user_id\)/);
    expect(call.text).toMatch(/RETURNING push_notifications_enabled/);
    expect(call.params).toEqual([USER_ID, false]);
  });

  it('propagates the underlying error when the write cannot persist (R9.8)', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    const pool = makePool((call) => {
      if (call.text.includes('INSERT INTO notification_preferences')) {
        return { throw: dbError };
      }
      return undefined;
    });
    const repo = createNotificationPreferenceRepo(pool as never);

    // The repo does not swallow the failure: it surfaces so the route can map
    // it to an error envelope (R9.8).
    await expect(repo.setPreference(USER_ID, true)).rejects.toBe(dbError);
  });

  it('surfaces a failure when the upsert returns no row (R9.8)', async () => {
    // An INSERT ... RETURNING that yields no row means the write did not
    // persist; the repo raises rather than silently returning the request value.
    const pool = makePool((call) => {
      if (call.text.includes('INSERT INTO notification_preferences')) {
        return { rows: [] };
      }
      return undefined;
    });
    const repo = createNotificationPreferenceRepo(pool as never);

    await expect(repo.setPreference(USER_ID, true)).rejects.toThrow(
      /returned no row/,
    );
  });
});

// ---------------------------------------------------------------------------
// Routes: stubs and app builder
// ---------------------------------------------------------------------------

interface RepoCalls {
  getPreference: string[];
  setPreference: Array<{ userId: string; enabled: boolean }>;
}

interface RepoStubs {
  getPreference?: (userId: string) => Promise<{ pushNotificationsEnabled: boolean }>;
  setPreference?: (
    userId: string,
    enabled: boolean,
  ) => Promise<{ pushNotificationsEnabled: boolean }>;
}

function makeRepo(stubs: RepoStubs = {}): {
  repo: NotificationPreferenceRepo;
  calls: RepoCalls;
} {
  const calls: RepoCalls = { getPreference: [], setPreference: [] };
  return {
    calls,
    repo: {
      async getPreference(userId) {
        calls.getPreference.push(userId);
        if (stubs.getPreference) {
          return stubs.getPreference(userId);
        }
        return { pushNotificationsEnabled: true };
      },
      async setPreference(userId, enabled) {
        calls.setPreference.push({ userId, enabled });
        if (stubs.setPreference) {
          return stubs.setPreference(userId, enabled);
        }
        return { pushNotificationsEnabled: enabled };
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
): NotificationPreferenceRoutesOptions['requireSession'] {
  return async (request) => {
    if (opts.unauthorized === true) {
      return;
    }
    (request as { userId?: string }).userId = opts.userId ?? USER_ID;
  };
}

async function buildApp(
  overrides: Partial<NotificationPreferenceRoutesOptions> = {},
): Promise<{ app: FastifyInstance; calls: RepoCalls }> {
  const fallback = makeRepo();
  const repo = overrides.repo ?? fallback.repo;
  const calls = overrides.repo
    ? { getPreference: [], setPreference: [] }
    : fallback.calls;

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await app.register(
    notificationPreferenceRoutes({
      repo,
      requireSession: overrides.requireSession ?? makeRequireSession(),
    }),
  );
  await app.ready();
  return { app, calls };
}

// ---------------------------------------------------------------------------
// GET /me/notification-preferences — default enabled (R9.7)
// ---------------------------------------------------------------------------

describe('GET /me/notification-preferences', () => {
  it('returns { pushNotificationsEnabled: true } for a User with no stored preference (R9.7)', async () => {
    // A fresh User whose repo reports the default: enabled.
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'GET',
      url: '/me/notification-preferences',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pushNotificationsEnabled: true });
    // The authenticated user is forwarded to the repo read.
    expect(calls.getPreference).toEqual([USER_ID]);
  });

  it('echoes a stored disabled preference', async () => {
    const { repo } = makeRepo({
      async getPreference() {
        return { pushNotificationsEnabled: false };
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'GET',
      url: '/me/notification-preferences',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pushNotificationsEnabled: false });
  });
});

// ---------------------------------------------------------------------------
// PUT /me/notification-preferences — persistence failure envelope (R9.8)
// ---------------------------------------------------------------------------

describe('PUT /me/notification-preferences persistence failure (R9.8)', () => {
  it('surfaces an error envelope when the repo cannot persist the value', async () => {
    // The repo rejects with a generic persistence failure (e.g. connectivity loss).
    const { repo, calls } = makeRepo({
      async setPreference() {
        throw new Error('connection terminated unexpectedly');
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'PUT',
      url: '/me/notification-preferences',
      payload: { pushNotificationsEnabled: false },
    });

    // R9.8: a genuine persistence failure is collapsed to an error envelope so
    // the client retains its previous value and shows a message. The generic
    // failure maps to `internal_error`.
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: { code: 'internal_error' },
    });
    // The route did attempt the write with the requested value.
    expect(calls.setPreference).toEqual([{ userId: USER_ID, enabled: false }]);
  });

  it('rethrows a domain AppError unchanged (does not mask it as internal_error)', async () => {
    // A deliberate domain outcome surfaces with its own code rather than being
    // collapsed to internal_error.
    const { repo } = makeRepo({
      async setPreference() {
        throw new AppError('unauthorized', 'Authentication is required.');
      },
    });
    const { app } = await buildApp({ repo });

    const res = await app.inject({
      method: 'PUT',
      url: '/me/notification-preferences',
      payload: { pushNotificationsEnabled: true },
    });

    expect(res.json()).toMatchObject({
      error: { code: 'unauthorized' },
    });
  });

  it('persists and echoes the value on success', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: '/me/notification-preferences',
      payload: { pushNotificationsEnabled: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pushNotificationsEnabled: false });
    expect(calls.setPreference).toEqual([{ userId: USER_ID, enabled: false }]);
  });

  it('rejects a non-boolean body with validation_failed without touching the repo', async () => {
    const { app, calls } = await buildApp();

    const res = await app.inject({
      method: 'PUT',
      url: '/me/notification-preferences',
      payload: { pushNotificationsEnabled: 'nope' },
    });

    expect(res.json()).toMatchObject({
      error: { code: 'validation_failed', field: 'pushNotificationsEnabled' },
    });
    expect(calls.setPreference).toEqual([]);
  });
});
