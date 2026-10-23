/**
 * The account-deletion HTTP routes through `server.inject`: the real service and the real route plugin over
 * in-memory fakes of the repo, lockout, mail and runner.
 *
 *  - every route is authenticated (session for the two `/me` routes, cron secret for the two `/internal` ones);
 *  - reauth: a wrong password is `403 reauth_failed` (never 401) with exactly one `recordFailure`, a locked account
 *    is refused before any password work, success never clears the lockout counter and stores only a hash;
 *  - deletion: validation, the phrase gate leaves the grant unconsumed, single use, session binding, expiry,
 *    a mail failure still answers 200;
 *  - purge/run: 401 without or with another cron's secret, 202 accepted, overlapping 202 skipped, HEAD 202 empty.
 *
 * Feature: account-deletion, Property 25: The cron endpoint contract
 * Feature: account-deletion, Property 4: A reauth grant works once, for one user and one session, within its window
 *
 * Validates: Requirements 2.1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10, 2.11, 2.13, 3.4, 3.9, 8.1, 8.2, 17.3
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  deleteAccountResponseSchema,
  reauthResponseSchema,
} from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { registerRateLimit } from '../../../plugins/rateLimit.js';
import type {
  AccountDeletionMail,
  AccountDeletionRepo,
  DeletionRequestOutcome,
  LockoutPort,
} from '../ports.js';
import type { PurgeRunner } from '../purgeRunner.js';
import {
  accountDeletionRoutes,
  DELETION_PATH,
  PRIVACY_PATH,
  PURGE_RUN_PATH,
  REAUTH_PATH,
  WEB_DELETION_PATH,
} from '../routes.js';
import { createAccountDeletionService } from '../service.js';
import { createRecordingLogger } from './helpers.js';

const CRON_SECRET = 'test-account-deletion-cron-secret-12345';
// Deliberately contains an apostrophe and an ampersand so the renderer's escaping is observable
// (defense in depth: config validation is a separate gate, tested in config.accountDeletion.prop.test.ts).
const SUPPORT_EMAIL = "o'brien&help@support.example.test";
const OTHER_CRON_SECRET = 'test-photos-cron-secret';
const SESSION_SECRET = 'test-session-secret-must-be-at-least-32-chars';
const PASSWORD = 'correct-horse-battery';
const WRONG_PASSWORD = 'definitely-the-wrong-one';
const EMAIL = 'alice@example.com';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

interface SessionFake {
  userId: string;
  sessionId: string;
  revoked: boolean;
}

interface Grant {
  userId: string;
  sessionId: string;
  hash: string;
  expiresAt: Date;
}

interface Harness {
  app: FastifyInstance;
  clock: { t: number };
  sessions: Map<string, SessionFake>;
  grants: Map<string, Grant>;
  lockoutEvents: string[];
  setLocked(locked: boolean): void;
  mailCalls: { kind: string; to: string }[];
  failMail(): void;
  repoCalls: string[];
  issued: { grantHash: string; sessionId: string; userId: string }[];
  verifyCalls: string[];
  runner: { tryStartCalls: number; setNext(r: { started: true } | { started: false; reason: 'in_flight' }): void };
  logs: ReturnType<typeof createRecordingLogger>['calls'];
  accountState: { state: 'active' | 'pending_deletion' };
}

async function buildHarness(opts: { omitSessionId?: boolean; withRateLimit?: boolean } = {}): Promise<Harness> {
  const clock = { t: Date.parse('2026-05-01T12:00:00.000Z') };
  const sessions = new Map<string, SessionFake>([
    ['tok-alice-1', { userId: 'user-alice', sessionId: 'sess-alice-1', revoked: false }],
    ['tok-alice-2', { userId: 'user-alice', sessionId: 'sess-alice-2', revoked: false }],
    ['tok-bob', { userId: 'user-bob', sessionId: 'sess-bob', revoked: false }],
  ]);
  const grants = new Map<string, Grant>(); // by session id (replace-on-issue)
  const lockoutEvents: string[] = [];
  let locked = false;
  const mailCalls: { kind: string; to: string }[] = [];
  let mailFails = false;
  const repoCalls: string[] = [];
  const issued: Harness['issued'] = [];
  const verifyCalls: string[] = [];
  const accountState: Harness['accountState'] = { state: 'active' };
  let nextRun: { started: true } | { started: false; reason: 'in_flight' } = { started: true };
  const runnerStats = { tryStartCalls: 0 };
  const { logger, calls: logs } = createRecordingLogger();

  const repo = {
    async getPasswordHash(userId: string) {
      repoCalls.push('getPasswordHash');
      return userId === 'user-alice' ? 'hash-of-correct-password' : null;
    },
    async findActiveUserByEmail(email: string) {
      repoCalls.push('findActiveUserByEmail');
      if (email.toLowerCase() === EMAIL.toLowerCase() && accountState.state === 'active') {
        return { id: 'user-alice', email: EMAIL, passwordHash: 'hash-of-correct-password' };
      }
      return null;
    },
    async requestDeletionForUser(a: { userId: string }) {
      repoCalls.push('requestDeletionForUser');
      if (accountState.state !== 'active') return { outcome: 'not_active' as const };
      accountState.state = 'pending_deletion';
      for (const s of sessions.values()) if (s.userId === a.userId) s.revoked = true;
      return { outcome: 'ok' as const, email: EMAIL };
    },
    async issueGrant(a: { userId: string; sessionId: string; grantHash: string; expiresAt: Date }) {
      repoCalls.push('issueGrant');
      issued.push({ grantHash: a.grantHash, sessionId: a.sessionId, userId: a.userId });
      grants.set(a.sessionId, { userId: a.userId, sessionId: a.sessionId, hash: a.grantHash, expiresAt: a.expiresAt });
    },
    async consumeGrantAndRequestDeletion(a: {
      userId: string;
      sessionId: string;
      grantHash: string;
      now: Date;
    }): Promise<DeletionRequestOutcome> {
      repoCalls.push('consumeGrantAndRequestDeletion');
      const g = grants.get(a.sessionId);
      if (!g || g.userId !== a.userId || g.hash !== a.grantHash || a.now.getTime() >= g.expiresAt.getTime()) {
        return { outcome: 'reauth_required' };
      }
      if (accountState.state !== 'active') return { outcome: 'not_active' };
      grants.delete(a.sessionId); // single use
      accountState.state = 'pending_deletion';
      for (const s of sessions.values()) if (s.userId === a.userId) s.revoked = true;
      return { outcome: 'ok', email: EMAIL };
    },
  } as unknown as AccountDeletionRepo;

  const lockout: LockoutPort = {
    isLocked: async (id) => {
      lockoutEvents.push(`isLocked:${id}`);
      return locked;
    },
    recordFailure: async (id) => {
      lockoutEvents.push(`recordFailure:${id}`);
      return false;
    },
    clearOnSuccess: async (id) => {
      lockoutEvents.push(`clearOnSuccess:${id}`);
    },
  };
  const mail: AccountDeletionMail = {
    sendDeletionScheduled: async ({ to }) => {
      mailCalls.push({ kind: 'scheduled', to });
      if (mailFails) throw new Error(`smtp refused ${to}`);
    },
    sendDeletionCancelled: async ({ to }) => {
      mailCalls.push({ kind: 'cancelled', to });
    },
  };

  const service = createAccountDeletionService({
    repo,
    lockout,
    mail,
    verify: async (_hash, plain) => {
      verifyCalls.push(plain);
      return plain === PASSWORD;
    },
    clock: { now: () => new Date(clock.t) },
    logger,
    config: { graceDays: 30, reauthWindowSeconds: 300 },
    logSecret: SESSION_SECRET,
  });

  const runner: PurgeRunner = {
    tryStart: () => {
      runnerStats.tryStartCalls += 1;
      const r = nextRun;
      nextRun = { started: false, reason: 'in_flight' };
      return r;
    },
    runOnce: async () => {
      throw new Error('the route must not run the runner inline');
    },
  };

  const requireSession: preHandlerHookHandler = async (request) => {
    const m = /^Bearer\s+(\S+)$/.exec(String(request.headers.authorization ?? ''));
    const s = m ? sessions.get(m[1]!) : undefined;
    if (!s || s.revoked) throw new AppError('unauthorized', 'Authentication is required.');
    request.userId = s.userId;
    if (!opts.omitSessionId) request.sessionId = s.sessionId;
  };

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.decorate('config', {
    accountDeletion: { cronSecret: CRON_SECRET },
    support: { email: SUPPORT_EMAIL },
  } as never);
  if (opts.withRateLimit) {
    // A generous global budget, so only a per-route override can produce a 429 in the tests that opt in.
    await registerRateLimit(app, {
      reads: { max: 1000, timeWindowMs: 60_000 },
      mutations: { max: 1000, timeWindowMs: 60_000 },
    });
  }
  await app.register(accountDeletionRoutes({ service, purgeRunner: runner, requireSession }));
  await app.ready();

  return {
    app,
    clock,
    sessions,
    grants,
    lockoutEvents,
    setLocked: (v) => {
      locked = v;
    },
    mailCalls,
    failMail: () => {
      mailFails = true;
    },
    repoCalls,
    issued,
    verifyCalls,
    runner: {
      get tryStartCalls() {
        return runnerStats.tryStartCalls;
      },
      setNext: (r) => {
        nextRun = r;
      },
    },
    logs,
    accountState,
  };
}

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });
const errCode = (res: { json: () => unknown }): string => (res.json() as { error: { code: string } }).error.code;

async function reauth(h: Harness, token = 'tok-alice-1', password = PASSWORD) {
  return h.app.inject({ method: 'POST', url: REAUTH_PATH, headers: auth(token), payload: { password } });
}
async function obtainGrant(h: Harness, token = 'tok-alice-1'): Promise<string> {
  const res = await reauth(h, token);
  expect(res.statusCode).toBe(200);
  return (res.json() as { reauthGrant: string }).reauthGrant;
}
async function requestDeletion(h: Harness, grant: string, confirmation = 'DELETE', token = 'tok-alice-1') {
  return h.app.inject({ method: 'POST', url: DELETION_PATH, headers: auth(token), payload: { reauthGrant: grant, confirmation } });
}

describe('authentication on every route', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it.each([
    ['POST', REAUTH_PATH],
    ['POST', DELETION_PATH],
  ] as const)('%s %s answers 401 without a session and touches nothing', async (method, url) => {
    const res = await h.app.inject({ method, url, payload: { password: PASSWORD } });
    expect(res.statusCode).toBe(401);
    expect(errCode(res)).toBe('unauthorized');
    expect(h.repoCalls).toEqual([]);
    expect(h.lockoutEvents).toEqual([]);
  });

  it('answers 401 for an unknown or revoked bearer token', async () => {
    h.sessions.get('tok-alice-1')!.revoked = true;
    expect((await reauth(h, 'tok-alice-1')).statusCode).toBe(401);
    expect((await reauth(h, 'tok-nobody')).statusCode).toBe(401);
    expect(h.repoCalls).toEqual([]);
  });

  it.each([
    ['POST', undefined],
    ['HEAD', undefined],
    ['POST', ''],
    ['POST', 'wrong-secret'],
    ['HEAD', 'wrong-secret'],
    ['POST', OTHER_CRON_SECRET],
    ['HEAD', OTHER_CRON_SECRET],
    ['POST', `${CRON_SECRET}x`],
    ['POST', CRON_SECRET.slice(0, -1)],
  ] as const)('%s %s with cron secret %j answers 401 and starts no run', async (method, secret) => {
    const res = await h.app.inject({
      method,
      url: PURGE_RUN_PATH,
      headers: secret === undefined ? {} : { 'x-cron-secret': secret },
    });
    expect(res.statusCode).toBe(401);
    expect(h.runner.tryStartCalls).toBe(0);
  });

  it('a bearer session is not a substitute for the cron secret', async () => {
    const res = await h.app.inject({ method: 'POST', url: PURGE_RUN_PATH, headers: auth('tok-alice-1') });
    expect(res.statusCode).toBe(401);
    expect(h.runner.tryStartCalls).toBe(0);
  });

  it('a request that reaches a /me handler without a session id answers 401 (the grant needs a session)', async () => {
    const bare = await buildHarness({ omitSessionId: true });
    const a = await reauth(bare);
    const b = await requestDeletion(bare, 'x'.repeat(43));
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(bare.repoCalls).toEqual([]);
    expect(bare.lockoutEvents).toEqual([]);
  });
});

describe('POST /me/account/deletion/reauth', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it('a wrong password is 403 reauth_failed (never 401) with exactly one recordFailure and no grant', async () => {
    const res = await reauth(h, 'tok-alice-1', WRONG_PASSWORD);
    expect(res.statusCode).toBe(403);
    expect(errCode(res)).toBe('reauth_failed');
    expect(h.lockoutEvents.filter((e) => e.startsWith('recordFailure'))).toEqual(['recordFailure:user-alice']);
    expect(h.issued).toEqual([]);
    expect(h.grants.size).toBe(0);
    // The caller is still signed in: the session was not revoked by a failed attempt.
    expect(h.sessions.get('tok-alice-1')!.revoked).toBe(false);
  });

  it('a locked account is refused with 423 before any password work', async () => {
    h.setLocked(true);
    const res = await reauth(h);
    expect(res.statusCode).toBe(423);
    expect(errCode(res)).toBe('account_locked');
    expect(h.verifyCalls).toEqual([]);
    expect(h.repoCalls).toEqual([]);
    expect(h.lockoutEvents).toEqual(['isLocked:user-alice']);
  });

  it('success returns a grant that matches the shared schema, binds it to the caller’s session and stores only its hash', async () => {
    const res = await reauth(h);
    expect(res.statusCode).toBe(200);
    const body = reauthResponseSchema.parse(res.json());
    expect(body.graceDays).toBe(30);
    expect(new Date(body.expiresAt).getTime()).toBe(h.clock.t + 300_000);
    expect(h.issued).toHaveLength(1);
    expect(h.issued[0]).toEqual({ grantHash: sha(body.reauthGrant), sessionId: 'sess-alice-1', userId: 'user-alice' });
    // Plaintext appears nowhere in what was stored.
    expect(JSON.stringify(h.issued)).not.toContain(body.reauthGrant);
  });

  it('success never clears the lockout counter (R2.13)', async () => {
    await reauth(h, 'tok-alice-1', WRONG_PASSWORD);
    await reauth(h);
    expect(h.lockoutEvents.some((e) => e.startsWith('clearOnSuccess'))).toBe(false);
  });

  it('replaces the previous grant of the same session (one live grant per session)', async () => {
    const first = await obtainGrant(h);
    const second = await obtainGrant(h);
    expect(first).not.toBe(second);
    expect(h.grants.size).toBe(1);
    expect((await requestDeletion(h, first)).statusCode).toBe(403);
    expect((await requestDeletion(h, second)).statusCode).toBe(200);
  });

  it.each([
    ['missing password', {}],
    ['empty password', { password: '' }],
    ['129-character password', { password: 'p'.repeat(129) }],
    ['non-string password', { password: 12345 }],
    ['unknown key', { password: PASSWORD, extra: true }],
  ])('rejects %s with 400 validation_failed and does no password work', async (_name, payload) => {
    const res = await h.app.inject({ method: 'POST', url: REAUTH_PATH, headers: auth('tok-alice-1'), payload });
    expect(res.statusCode).toBe(400);
    expect(errCode(res)).toBe('validation_failed');
    expect(h.verifyCalls).toEqual([]);
    expect(h.lockoutEvents).toEqual([]);
  });

  it('a validation error never echoes the submitted password', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: REAUTH_PATH,
      headers: auth('tok-alice-1'),
      payload: { password: PASSWORD, surprise: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.payload).not.toContain(PASSWORD);
  });
});

describe('POST /me/account/deletion/reauth rate limit (R2.11, real route)', () => {
  // Guards the registration in routes.ts: removing `config.rateLimit` from the reauth route makes the sixth call
  // below answer 403 instead of 429. `rateLimit.reauth.test.ts` covers the helper; this covers the wiring.
  it('answers the sixth wrong-password call on one session token with 429 and does no password work for it', async () => {
    const h = await buildHarness({ withRateLimit: true });
    for (let i = 0; i < 5; i++) {
      const res = await reauth(h, 'tok-alice-1', WRONG_PASSWORD);
      expect(res.statusCode).toBe(403);
    }
    expect(h.verifyCalls).toHaveLength(5);
    const blocked = await reauth(h, 'tok-alice-1', WRONG_PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(errCode(blocked)).toBe('rate_limit_exceeded');
    expect(h.verifyCalls).toHaveLength(5);
    expect(h.lockoutEvents.filter((e) => e.startsWith('recordFailure'))).toHaveLength(5);
    await h.app.close();
  });

  it('keeps the bucket per session token: another session of the same user is not blocked', async () => {
    const h = await buildHarness({ withRateLimit: true });
    for (let i = 0; i < 6; i++) await reauth(h, 'tok-alice-1', WRONG_PASSWORD);
    expect((await reauth(h, 'tok-alice-1')).statusCode).toBe(429);
    expect((await reauth(h, 'tok-alice-2')).statusCode).toBe(200);
    await h.app.close();
  });

  it('does not throttle the confirmation route with the reauth budget', async () => {
    const h = await buildHarness({ withRateLimit: true });
    for (let i = 0; i < 7; i++) {
      const res = await requestDeletion(h, 'g'.repeat(43), 'DELETE', 'tok-bob');
      expect(res.statusCode).not.toBe(429);
    }
    await h.app.close();
  });
});

describe('POST /me/account/deletion', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  it('schedules the deletion: body matches the shared schema and carries the one persisted date', async () => {
    const grant = await obtainGrant(h);
    const res = await requestDeletion(h, grant);
    expect(res.statusCode).toBe(200);
    const body = deleteAccountResponseSchema.parse(res.json());
    expect(body.status).toBe('pending_deletion');
    expect(body.graceDays).toBe(30);
    expect(new Date(body.scheduledPurgeAt).getTime()).toBe(h.clock.t + 30 * 86_400_000);
    expect(h.accountState.state).toBe('pending_deletion');
    expect(h.mailCalls).toEqual([{ kind: 'scheduled', to: EMAIL }]);
  });

  it('accepts the phrase around whitespace, and rejects any other casing', async () => {
    const lower = await obtainGrant(h);
    const bad = await requestDeletion(h, lower, 'delete');
    expect(bad.statusCode).toBe(400);
    expect(errCode(bad)).toBe('account_deletion_confirmation_invalid');
    const ok = await requestDeletion(h, lower, '  DELETE \n');
    expect(ok.statusCode).toBe(200);
  });

  it('a wrong phrase leaves the grant unconsumed and the account untouched, so the same grant still works', async () => {
    const grant = await obtainGrant(h);
    h.repoCalls.length = 0;
    const res = await requestDeletion(h, grant, 'NOPE');
    expect(res.statusCode).toBe(400);
    expect(errCode(res)).toBe('account_deletion_confirmation_invalid');
    expect(h.repoCalls).toEqual([]); // the phrase is checked before any repo call
    expect(h.grants.size).toBe(1);
    expect(h.accountState.state).toBe('active');
    expect((await requestDeletion(h, grant)).statusCode).toBe(200);
  });

  it('a grant is single-use: the replay is 403 reauth_required', async () => {
    const grant = await obtainGrant(h);
    expect((await requestDeletion(h, grant)).statusCode).toBe(200);
    h.sessions.get('tok-alice-1')!.revoked = false; // the replay must fail on the grant, not on the revoked session
    h.accountState.state = 'active';
    const replay = await requestDeletion(h, grant);
    expect(replay.statusCode).toBe(403);
    expect(errCode(replay)).toBe('reauth_required');
  });

  it('a grant works only for the session that earned it', async () => {
    const grant = await obtainGrant(h, 'tok-alice-1');
    const otherSession = await requestDeletion(h, grant, 'DELETE', 'tok-alice-2');
    expect(otherSession.statusCode).toBe(403);
    expect(errCode(otherSession)).toBe('reauth_required');
    expect(h.accountState.state).toBe('active');
    expect((await requestDeletion(h, grant, 'DELETE', 'tok-alice-1')).statusCode).toBe(200);
  });

  it('a grant works only for the user that earned it', async () => {
    const grant = await obtainGrant(h, 'tok-alice-1');
    const bob = await requestDeletion(h, grant, 'DELETE', 'tok-bob');
    expect(bob.statusCode).toBe(403);
    expect(errCode(bob)).toBe('reauth_required');
  });

  it('an expired grant is 403 reauth_required', async () => {
    const grant = await obtainGrant(h);
    h.clock.t += 300_000; // exactly the window: expired
    const res = await requestDeletion(h, grant);
    expect(res.statusCode).toBe(403);
    expect(errCode(res)).toBe('reauth_required');
    expect(h.accountState.state).toBe('active');
  });

  it('an account that is no longer active answers the same reauth_required (a concurrent request won)', async () => {
    const grant = await obtainGrant(h);
    h.accountState.state = 'pending_deletion';
    const res = await requestDeletion(h, grant);
    expect(res.statusCode).toBe(403);
    expect(errCode(res)).toBe('reauth_required');
  });

  it('a mail failure still answers 200, and the warning names neither the address nor the user', async () => {
    h.failMail();
    const grant = await obtainGrant(h);
    const res = await requestDeletion(h, grant);
    expect(res.statusCode).toBe(200);
    const warns = h.logs.filter((c) => c.level === 'warn');
    expect(warns).toHaveLength(1);
    const text = JSON.stringify(warns);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('user-alice');
  });

  it.each([
    ['missing body fields', {}],
    ['missing confirmation', { reauthGrant: 'g'.repeat(43) }],
    ['missing grant', { confirmation: 'DELETE' }],
    ['grant too short', { reauthGrant: 'short', confirmation: 'DELETE' }],
    ['grant too long', { reauthGrant: 'g'.repeat(129), confirmation: 'DELETE' }],
    ['grant with illegal characters', { reauthGrant: `${'g'.repeat(30)}!!`, confirmation: 'DELETE' }],
    ['unknown key', { reauthGrant: 'g'.repeat(43), confirmation: 'DELETE', extra: 1 }],
  ])('rejects %s with 400 validation_failed before any repo call', async (_name, payload) => {
    const res = await h.app.inject({ method: 'POST', url: DELETION_PATH, headers: auth('tok-alice-1'), payload });
    expect(res.statusCode).toBe(400);
    expect(errCode(res)).toBe('validation_failed');
    expect(h.repoCalls).toEqual([]);
  });

  it('nothing the caller submitted is logged: not the password, the grant or the phrase', async () => {
    const grant = await obtainGrant(h);
    await reauth(h, 'tok-alice-1', WRONG_PASSWORD);
    await requestDeletion(h, grant, 'DELETE');
    const logged = JSON.stringify(h.logs);
    for (const secret of [PASSWORD, WRONG_PASSWORD, grant]) expect(logged).not.toContain(secret);
  });
});

describe('POST and HEAD /internal/account-deletion/purge/run', () => {
  let h: Harness;
  const secretHeader = { 'x-cron-secret': CRON_SECRET };
  beforeEach(async () => {
    h = await buildHarness();
  });

  it('POST with the right secret answers 202 accepted and starts one run', async () => {
    const res = await h.app.inject({ method: 'POST', url: PURGE_RUN_PATH, headers: secretHeader });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'accepted' });
    expect(h.runner.tryStartCalls).toBe(1);
  });

  it('an overlapping POST answers 202 skipped in_flight', async () => {
    await h.app.inject({ method: 'POST', url: PURGE_RUN_PATH, headers: secretHeader });
    const second = await h.app.inject({ method: 'POST', url: PURGE_RUN_PATH, headers: secretHeader });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ status: 'skipped', reason: 'in_flight' });
  });

  it('HEAD answers 202 with an empty body and still triggers the run', async () => {
    const res = await h.app.inject({ method: 'HEAD', url: PURGE_RUN_PATH, headers: secretHeader });
    expect(res.statusCode).toBe(202);
    expect(res.payload).toBe('');
    expect(h.runner.tryStartCalls).toBe(1);
  });

  it('answers immediately: the route never awaits the run itself', async () => {
    // `runOnce` of the fake throws if called; a 202 proves the route only called `tryStart`.
    const res = await h.app.inject({ method: 'POST', url: PURGE_RUN_PATH, headers: secretHeader });
    expect(res.statusCode).toBe(202);
  });
});

describe('GET /account-deletion, POST /account-deletion, and GET /privacy (Requirements 19 & 20)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('GET /account-deletion returns 200 text/html with security headers, the self-service form, grace days, in-app path, and /privacy link', async () => {
    const res = await h.app.inject({ method: 'GET', url: WEB_DELETION_PATH });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.payload).toContain('<form method="POST" action="/account-deletion">');
    expect(res.payload).toContain('name="email"');
    expect(res.payload).toContain('name="password"');
    expect(res.payload).toContain('name="confirmation"');
    expect(res.payload).toContain('30-day grace period');
    expect(res.payload).toContain('You &amp; Crew');
    expect(res.payload).toContain('Deleted user');
    expect(res.payload).toContain('href="/privacy"');
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('GET /privacy returns 200 text/html with anti-framing headers, the full privacy policy disclosures, and a link to /account-deletion', async () => {
    const res = await h.app.inject({ method: 'GET', url: PRIVACY_PATH });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.payload).toContain('Privacy Policy');
    expect(res.payload).toContain('omni-moderation-latest');
    expect(res.payload).toContain('gemini-3.5-flash-lite');
    expect(res.payload).toContain('Cloudflare');
    expect(res.payload).toContain('30 days');
    expect(res.payload).toContain('href="/account-deletion"');
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('GET /privacy renders the configured SUPPORT_EMAIL (escaped) as a mailto link and never the old placeholder (R20.4)', async () => {
    const res = await h.app.inject({ method: 'GET', url: PRIVACY_PATH });
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(
      '<a href="mailto:o&#039;brien&amp;help@support.example.test">o&#039;brien&amp;help@support.example.test</a>',
    );
    expect(res.payload).not.toContain("o'brien&help@support.example.test");
    expect(res.payload).not.toContain('Support Contact Email');
    expect(res.payload).not.toContain('must replace');
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('POST /account-deletion accepts application/x-www-form-urlencoded, schedules deletion, revokes sessions, sends email, and renders 200 HTML confirmation', async () => {
    const formBody = new URLSearchParams({
      email: EMAIL,
      password: PASSWORD,
      confirmation: 'DELETE',
    }).toString();

    const res = await h.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: formBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.payload).toContain('Account Deletion Scheduled');
    expect(res.payload).toContain('May 31, 2026');
    expect(res.payload).toContain('30-day grace period');
    expect(h.accountState.state).toBe('pending_deletion');
    expect(h.sessions.get('tok-alice-1')!.revoked).toBe(true);
    expect(h.sessions.get('tok-alice-2')!.revoked).toBe(true);
    expect(h.mailCalls).toEqual([{ kind: 'scheduled', to: EMAIL }]);
    expect(h.lockoutEvents.some((e) => e.startsWith('clearOnSuccess'))).toBe(false);
  });

  it('POST /account-deletion also accepts application/json', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      payload: { email: EMAIL, password: PASSWORD, confirmation: 'DELETE' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('Account Deletion Scheduled');
    expect(h.accountState.state).toBe('pending_deletion');
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('POST /account-deletion with wrong confirmation phrase returns 400 text/html without querying the database or recording lockout', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        email: EMAIL,
        password: PASSWORD,
        confirmation: 'delete',
      }).toString(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.payload).toContain('Please type DELETE in all caps to confirm account deletion.');
    expect(res.payload).toContain(`value="${EMAIL}"`);
    expect(h.repoCalls).toEqual([]);
    expect(h.lockoutEvents).toEqual([]);
  });

  it('POST /account-deletion with malformed email or empty password returns 400 text/html and escapes the email field', async () => {
    const badEmail = '"><script>alert(1)</script>';
    const res = await h.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      payload: { email: badEmail, password: PASSWORD, confirmation: 'DELETE' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).not.toContain('<script>alert(1)</script>');
    expect(res.payload).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(h.repoCalls).toEqual([]);
    expect(h.lockoutEvents).toEqual([]);
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('POST /account-deletion with unknown email or wrong password returns identical 403 HTML error wording, runs dummy verify on unknown email, and only records lockout for an existing active user', async () => {
    const unknownRes = await h.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      payload: { email: 'stranger@example.com', password: PASSWORD, confirmation: 'DELETE' },
    });
    expect(unknownRes.statusCode).toBe(403);
    expect(unknownRes.headers['content-type']).toContain('text/html');
    expect(unknownRes.headers['x-frame-options']).toBe('DENY');
    expect(unknownRes.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(unknownRes.headers['cache-control']).toBe('no-store');
    expect(unknownRes.payload).toContain('Invalid email or password.');
    expect(h.lockoutEvents).toEqual([]);
    expect(h.verifyCalls).toEqual([PASSWORD]);

    const wrongPwRes = await h.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      payload: { email: EMAIL, password: WRONG_PASSWORD, confirmation: 'DELETE' },
    });
    expect(wrongPwRes.statusCode).toBe(403);
    expect(wrongPwRes.headers['content-type']).toContain('text/html');
    expect(wrongPwRes.payload).toContain('Invalid email or password.');
    expect(wrongPwRes.payload).not.toContain(WRONG_PASSWORD);
    expect(h.lockoutEvents).toEqual(['isLocked:user-alice', 'recordFailure:user-alice']);
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('POST /account-deletion for a locked account returns 423 text/html before any password work', async () => {
    h.setLocked(true);
    const res = await h.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      payload: { email: EMAIL, password: PASSWORD, confirmation: 'DELETE' },
    });
    expect(res.statusCode).toBe(423);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.payload).toContain('temporarily locked');
    expect(h.verifyCalls).toEqual([]);
    expect(h.lockoutEvents).toEqual(['isLocked:user-alice']);
  });

  it('POST /account-deletion enforces loginRateLimitConfig() and renders 429 text/html on the 6th attempt for one email', async () => {
    const rl = await buildHarness({ withRateLimit: true });
    for (let i = 0; i < 5; i++) {
      const r = await rl.app.inject({
        method: 'POST',
        url: WEB_DELETION_PATH,
        payload: { email: EMAIL, password: WRONG_PASSWORD, confirmation: 'DELETE' },
      });
      expect(r.statusCode).toBe(403);
    }
    expect(rl.verifyCalls).toHaveLength(5);

    const sixth = await rl.app.inject({
      method: 'POST',
      url: WEB_DELETION_PATH,
      payload: { email: EMAIL, password: WRONG_PASSWORD, confirmation: 'DELETE' },
    });
    expect(sixth.statusCode).toBe(429);
    expect(sixth.headers['content-type']).toContain('text/html');
    expect(sixth.payload).toContain('Too many requests');
    expect(rl.verifyCalls).toHaveLength(5);
    await rl.app.close();
  });
});

describe('routes.ts structure', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, '..', 'routes.ts'), 'utf8');
  const importPaths = [...source.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]!);

  it('imports nothing from another service folder', () => {
    expect(importPaths.length).toBeGreaterThan(5);
    const upward = importPaths.filter((p) => p.startsWith('../'));
    // Only the error type and the rate-limit plugin live outside this folder, and neither is a service.
    expect(upward.sort()).toEqual(['../../errors/AppError.js', '../../plugins/rateLimit.js']);
    expect(importPaths.some((p) => /services\/|\/(photos|auth|tripBooking|trips)\//.test(p))).toBe(false);
  });

  it('declares every path under /me/account/deletion, /internal/account-deletion, /account-deletion, or /privacy and none under /photos', () => {
    const paths = [
      ...source.matchAll(
        /(?:REAUTH_PATH|DELETION_PATH|PURGE_RUN_PATH|WEB_DELETION_PATH|PRIVACY_PATH)\s*=\s*'([^']+)'/g,
      ),
    ].map((m) => m[1]!);
    expect(paths.sort()).toEqual([
      '/account-deletion',
      '/internal/account-deletion/purge/run',
      '/me/account/deletion',
      '/me/account/deletion/reauth',
      '/privacy',
    ]);
    expect(paths.some((p) => p.startsWith('/photos'))).toBe(false);
  });

  it('never logs or returns the submitted secrets', () => {
    expect(source).not.toMatch(/\blog(ger)?\b|console\./);
    expect(source).not.toMatch(/request\.log/);
  });
});
