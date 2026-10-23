import fc from 'fast-check';
import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { DELETE_ACCOUNT_CONFIRMATION_PHRASE, isDeletedUserId } from '@dwt/shared';

import { AppError } from '../../../errors/AppError.js';
import { computeScheduledPurgeAt } from '../deletionState.js';
import { accountLogId } from '../logId.js';
import type { AccountDeletionRepo, DeletionRequestOutcome } from '../ports.js';
import { hashGrant } from '../reauthGrant.js';
import { createAccountDeletionService, DUMMY_PASSWORD_HASH } from '../service.js';
import { verify as realVerifyPassword } from '../../auth/password.js';
import { createRecordingLogger } from './helpers.js';

const RUNS = { numRuns: 100 };

const USER_ID = '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b';
const SESSION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const EMAIL = 'real.person@example.com';
const SECRET = 'test-session-secret-must-be-at-least-32-chars';
const NOW = new Date('2026-04-01T12:00:00.000Z');

type Call = { fn: string; args: unknown[] };

/** Fakes for every dependency; each records its calls so order and absence can be asserted. */
function build(
  opts: {
    locked?: boolean;
    passwordHash?: string | null;
    passwordOk?: boolean;
    activeUserByEmail?: { id: string; email: string; passwordHash: string } | null;
    requestForUserOutcome?: { outcome: 'ok'; email: string } | { outcome: 'not_active' };
    requestOutcome?: DeletionRequestOutcome;
    restoreResult?: { restored: boolean; email: string | null };
    restoreInTxResult?: 'restored' | 'not_needed' | 'not_restorable';
    getEmail?: () => Promise<string | null>;
    mailScheduledThrows?: boolean;
    mailCancelledThrows?: boolean;
    graceDays?: number;
    windowSeconds?: number;
    now?: Date;
  } = {},
) {
  const calls: Call[] = [];
  const rec = <T>(fn: string, value: T) => (...args: unknown[]): T => {
    calls.push({ fn, args });
    return value;
  };
  const { logger, calls: logs } = createRecordingLogger();
  const now = opts.now ?? NOW;

  const repo = {
    getPasswordHash: async (...a: unknown[]) => rec('repo.getPasswordHash', opts.passwordHash === undefined ? 'stored-hash' : opts.passwordHash)(...a),
    findActiveUserByEmail: async (...a: unknown[]) =>
      rec(
        'repo.findActiveUserByEmail',
        opts.activeUserByEmail === undefined
          ? { id: USER_ID, email: EMAIL, passwordHash: 'stored-hash' }
          : opts.activeUserByEmail,
      )(...a),
    requestDeletionForUser: async (...a: unknown[]) =>
      rec(
        'repo.requestDeletionForUser',
        opts.requestForUserOutcome ?? ({ outcome: 'ok', email: EMAIL } as const),
      )(...a),
    issueGrant: async (...a: unknown[]) => rec('repo.issueGrant', undefined)(...a),
    consumeGrantAndRequestDeletion: async (...a: unknown[]) =>
      rec('repo.consume', opts.requestOutcome ?? ({ outcome: 'ok', email: EMAIL } as DeletionRequestOutcome))(...a),
    restore: async (...a: unknown[]) => rec('repo.restore', opts.restoreResult ?? { restored: true, email: EMAIL })(...a),
    restoreInTx: async (...a: unknown[]) => rec('repo.restoreInTx', opts.restoreInTxResult ?? 'restored')(...a),
    getEmail: async (...a: unknown[]) => {
      calls.push({ fn: 'repo.getEmail', args: a });
      return opts.getEmail ? opts.getEmail() : EMAIL;
    },
  } as unknown as AccountDeletionRepo;

  const lockout = {
    isLocked: async (...a: unknown[]) => rec('lockout.isLocked', opts.locked ?? false)(...a),
    recordFailure: async (...a: unknown[]) => rec('lockout.recordFailure', false)(...a),
    clearOnSuccess: async (...a: unknown[]) => rec('lockout.clearOnSuccess', undefined)(...a),
  };
  const mail = {
    sendDeletionScheduled: async (...a: unknown[]) => {
      calls.push({ fn: 'mail.scheduled', args: a });
      if (opts.mailScheduledThrows) throw new Error(`smtp down for ${EMAIL}`);
    },
    sendDeletionCancelled: async (...a: unknown[]) => {
      calls.push({ fn: 'mail.cancelled', args: a });
      if (opts.mailCancelledThrows) throw new Error(`smtp down for ${EMAIL}`);
    },
  };
  const service = createAccountDeletionService({
    repo,
    lockout,
    mail,
    verify: async (...a: unknown[]) => rec('verify', opts.passwordOk ?? true)(...a),
    clock: { now: () => now },
    logger,
    config: { graceDays: opts.graceDays ?? 30, reauthWindowSeconds: opts.windowSeconds ?? 300 },
    logSecret: SECRET,
    newPlaceholderId: () => 'deadc0de-0000-4000-8000-000000000001',
  });
  const names = () => calls.map((c) => c.fn);
  const callsOf = (fn: string) => calls.filter((c) => c.fn === fn);
  return { service, calls, names, callsOf, logs };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return 'resolved';
}

describe('reauth', () => {
  it('refuses a locked account before any password work', async () => {
    const t = build({ locked: true });
    expect(await codeOf(t.service.reauth(USER_ID, SESSION_ID, 'pw'))).toBe('account_locked');
    // isLocked is the ONLY call: no hash read, no verify, no failure recorded, no grant issued.
    expect(t.names()).toEqual(['lockout.isLocked']);
  });

  it('a wrong password records exactly one failure, issues no grant and answers reauth_failed', async () => {
    const t = build({ passwordOk: false });
    expect(await codeOf(t.service.reauth(USER_ID, SESSION_ID, 'wrong'))).toBe('reauth_failed');
    expect(t.names()).toEqual(['lockout.isLocked', 'repo.getPasswordHash', 'verify', 'lockout.recordFailure']);
    expect(t.callsOf('lockout.recordFailure')[0]!.args).toEqual([USER_ID]);
  });

  it('a missing password hash counts as a failure without calling verify', async () => {
    const t = build({ passwordHash: null });
    expect(await codeOf(t.service.reauth(USER_ID, SESSION_ID, 'pw'))).toBe('reauth_failed');
    expect(t.callsOf('verify')).toHaveLength(0);
    expect(t.callsOf('lockout.recordFailure')).toHaveLength(1);
  });

  it('the error carries nothing beyond the code (no password, no user id)', async () => {
    const t = build({ passwordOk: false });
    const err = await t.service.reauth(USER_ID, SESSION_ID, 'my-secret-pw').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(JSON.stringify({ m: (err as AppError).message, d: (err as AppError).details })).not.toMatch(/my-secret-pw|3f2b8c1e/);
  });

  it('success issues one grant, hashed, bound to the session, and NEVER clears the lockout counter (R2.13)', async () => {
    const t = build();
    const res = await t.service.reauth(USER_ID, SESSION_ID, 'right');
    expect(t.names()).toEqual(['lockout.isLocked', 'repo.getPasswordHash', 'verify', 'repo.issueGrant']);
    expect(t.callsOf('lockout.clearOnSuccess')).toHaveLength(0);
    expect(t.callsOf('lockout.recordFailure')).toHaveLength(0);

    const issued = t.callsOf('repo.issueGrant')[0]!.args[0] as Record<string, unknown>;
    expect(issued).toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
      grantHash: hashGrant(res.reauthGrant),
      expiresAt: new Date(NOW.getTime() + 300_000),
      now: NOW,
    });
    expect(issued.grantHash).not.toBe(res.reauthGrant); // only the hash is stored
    expect(res.reauthGrant).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.expiresAt).toEqual(new Date(NOW.getTime() + 300_000));
    expect(res.graceDays).toBe(30);
  });

  it('the verified hash is the stored one and the plaintext reaches verify unchanged', async () => {
    const t = build({ passwordHash: 'argon2-stored' });
    await t.service.reauth(USER_ID, SESSION_ID, 'typed pw');
    expect(t.callsOf('verify')[0]!.args).toEqual(['argon2-stored', 'typed pw']);
  });

  it('a lockout (Redis) error propagates instead of letting the request through', async () => {
    const failing = createAccountDeletionService({
      repo: {} as AccountDeletionRepo,
      lockout: {
        isLocked: async () => {
          throw new Error('redis down');
        },
        recordFailure: async () => false,
        clearOnSuccess: async () => {},
      },
      mail: t_mail(),
      verify: async () => true,
      clock: { now: () => NOW },
      logger: createRecordingLogger().logger,
      config: { graceDays: 30, reauthWindowSeconds: 300 },
      logSecret: SECRET,
    });
    await expect(failing.reauth(USER_ID, SESSION_ID, 'pw')).rejects.toThrow('redis down');
  });

  // Feature: account-deletion, Property 4: A reauth grant works once, for one user and one session, within its window
  it('Property 4 (service half): the grant expires exactly the configured window after issue and only its hash is stored', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 30, max: 900 }),
        fc.date({ min: new Date('2024-01-01'), max: new Date('2035-01-01'), noInvalidDate: true }),
        fc.uuid(),
        fc.uuid(),
        async (window, now, userId, sessionId) => {
          const t = build({ windowSeconds: window, now });
          const res = await t.service.reauth(userId, sessionId, 'pw');
          const issued = t.callsOf('repo.issueGrant')[0]!.args[0] as { grantHash: string; expiresAt: Date; userId: string; sessionId: string };
          expect(res.expiresAt.getTime() - now.getTime()).toBe(window * 1000);
          expect(issued.expiresAt).toEqual(res.expiresAt);
          expect(issued.grantHash).toBe(hashGrant(res.reauthGrant));
          expect(issued.userId).toBe(userId);
          expect(issued.sessionId).toBe(sessionId);
        },
      ),
      RUNS,
    );
  });
});

function t_mail() {
  return { sendDeletionScheduled: async () => {}, sendDeletionCancelled: async () => {} };
}

describe('requestDeletion', () => {
  it('a wrong phrase is rejected before any repo call (the grant is not consumed)', async () => {
    const t = build();
    expect(await codeOf(t.service.requestDeletion(USER_ID, SESSION_ID, 'grant', 'delete'))).toBe('account_deletion_confirmation_invalid');
    expect(t.names()).toEqual([]);
  });

  it('success: one repo call with the grant HASH, the shared date, a placeholder id; then the mail; then the result', async () => {
    const t = build();
    const res = await t.service.requestDeletion(USER_ID, SESSION_ID, 'opaque-grant', DELETE_ACCOUNT_CONFIRMATION_PHRASE);

    const scheduled = new Date(NOW.getTime() + 30 * 86_400_000);
    expect(res).toEqual({ status: 'pending_deletion', scheduledPurgeAt: scheduled, graceDays: 30 });
    expect(t.names()).toEqual(['repo.consume', 'mail.scheduled']);
    expect(t.callsOf('repo.consume')[0]!.args[0]).toEqual({
      userId: USER_ID,
      sessionId: SESSION_ID,
      grantHash: hashGrant('opaque-grant'),
      now: NOW,
      scheduledPurgeAt: scheduled,
      placeholderId: 'deadc0de-0000-4000-8000-000000000001',
    });
    expect(t.callsOf('mail.scheduled')[0]!.args[0]).toEqual({ to: EMAIL, scheduledPurgeAt: scheduled, graceDays: 30 });
  });

  it('the plaintext grant never reaches the repo', async () => {
    const t = build();
    await t.service.requestDeletion(USER_ID, SESSION_ID, 'opaque-grant', 'DELETE');
    expect(JSON.stringify(t.calls)).not.toContain('opaque-grant');
  });

  it.each<[string, DeletionRequestOutcome]>([
    ['reauth_required', { outcome: 'reauth_required' }],
    ['not_active', { outcome: 'not_active' }],
  ])('repo outcome %s answers reauth_required and sends no mail', async (_name, requestOutcome) => {
    const t = build({ requestOutcome });
    expect(await codeOf(t.service.requestDeletion(USER_ID, SESSION_ID, 'g', 'DELETE'))).toBe('reauth_required');
    expect(t.callsOf('mail.scheduled')).toHaveLength(0);
  });

  it('a mail failure still resolves, and the warn log carries neither the recipient nor the user id', async () => {
    const t = build({ mailScheduledThrows: true });
    const res = await t.service.requestDeletion(USER_ID, SESSION_ID, 'g', 'DELETE');
    expect(res.status).toBe('pending_deletion');

    const warns = t.logs.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0]!.obj).toMatchObject({ account: accountLogId(USER_ID, SECRET), kind: 'scheduled', error: 'Error' });
    const text = JSON.stringify(t.logs);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('real.person');
    expect(text).not.toContain(USER_ID);
  });

  it('a repo failure propagates (nothing was committed, no mail is sent)', async () => {
    const service = createAccountDeletionService({
      repo: {
        consumeGrantAndRequestDeletion: async () => {
          throw new Error('db down');
        },
      } as unknown as AccountDeletionRepo,
      lockout: { isLocked: async () => false, recordFailure: async () => false, clearOnSuccess: async () => {} },
      mail: {
        sendDeletionScheduled: async () => {
          throw new Error('must not be called');
        },
        sendDeletionCancelled: async () => {},
      },
      verify: async () => true,
      clock: { now: () => NOW },
      logger: createRecordingLogger().logger,
      config: { graceDays: 30, reauthWindowSeconds: 300 },
      logSecret: SECRET,
    });
    await expect(service.requestDeletion(USER_ID, SESSION_ID, 'g', 'DELETE')).rejects.toThrow('db down');
  });

  it('the default placeholder id is a deadc0de- UUID', async () => {
    const calls: unknown[] = [];
    const service = createAccountDeletionService({
      repo: {
        consumeGrantAndRequestDeletion: async (a: unknown) => {
          calls.push(a);
          return { outcome: 'ok', email: EMAIL };
        },
      } as unknown as AccountDeletionRepo,
      lockout: { isLocked: async () => false, recordFailure: async () => false, clearOnSuccess: async () => {} },
      mail: t_mail(),
      verify: async () => true,
      clock: { now: () => NOW },
      logger: createRecordingLogger().logger,
      config: { graceDays: 30, reauthWindowSeconds: 300 },
      logSecret: SECRET,
    });
    await service.requestDeletion(USER_ID, SESSION_ID, 'g', 'DELETE');
    const id = (calls[0] as { placeholderId: string }).placeholderId;
    expect(isDeletedUserId(id)).toBe(true);
    expect(id).not.toContain(USER_ID);
  });

  // Feature: account-deletion, Property 5: The confirmation phrase is exact
  it('Property 5: accepted iff s.trim() equals DELETE exactly (case-sensitive), and a rejection never reaches the repo', async () => {
    const ws = fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0'), { maxLength: 3 }).map((a) => a.join(''));
    const variants = fc.oneof(
      fc.string({ maxLength: 12 }),
      fc.constantFrom('DELETE', 'delete', 'Delete', 'DELET', 'DELETEE', 'DE LETE', 'DELETE!', '', '   '),
      fc.tuple(ws, fc.constantFrom('DELETE', 'delete', 'DELETE.'), ws).map(([a, b, c]) => a + b + c),
    );
    await fc.assert(
      fc.asyncProperty(variants, async (s) => {
        const t = build();
        const outcome = await codeOf(t.service.requestDeletion(USER_ID, SESSION_ID, 'g', s));
        if (s.trim() === 'DELETE') {
          expect(outcome).toBe('resolved');
          expect(t.callsOf('repo.consume')).toHaveLength(1);
        } else {
          expect(outcome).toBe('account_deletion_confirmation_invalid');
          expect(t.names()).toEqual([]);
        }
      }),
      RUNS,
    );
  });

  // Feature: account-deletion, Property 3: The scheduled purge date is fixed at request time
  it('Property 3: the persisted date, the response date and the mail date are one value = request time + graceDays', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2035-01-01'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 365 }),
        async (now, graceDays) => {
          const t = build({ now, graceDays });
          const res = await t.service.requestDeletion(USER_ID, SESSION_ID, 'g', 'DELETE');
          const persisted = (t.callsOf('repo.consume')[0]!.args[0] as { scheduledPurgeAt: Date; now: Date });
          const mailed = t.callsOf('mail.scheduled')[0]!.args[0] as { scheduledPurgeAt: Date; graceDays: number };
          expect(persisted.scheduledPurgeAt).toEqual(computeScheduledPurgeAt(now, graceDays));
          expect(res.scheduledPurgeAt).toBe(persisted.scheduledPurgeAt); // the same Date, not a recomputation
          expect(mailed.scheduledPurgeAt).toBe(persisted.scheduledPurgeAt);
          expect(res.scheduledPurgeAt.getTime() - now.getTime()).toBe(graceDays * 86_400_000);
          expect(res.graceDays).toBe(graceDays);
        },
      ),
      RUNS,
    );
  });
});

describe('restore port', () => {
  it('restore: a restored account sends the cancelled mail to the address the repo returned', async () => {
    const t = build();
    expect(await t.service.restore(USER_ID, NOW)).toBe('restored');
    expect(t.names()).toEqual(['repo.restore', 'mail.cancelled']);
    expect(t.callsOf('repo.restore')[0]!.args).toEqual([USER_ID, NOW]);
    expect(t.callsOf('mail.cancelled')[0]!.args[0]).toEqual({ to: EMAIL });
  });

  it('restore: not restorable sends no mail', async () => {
    const t = build({ restoreResult: { restored: false, email: null } });
    expect(await t.service.restore(USER_ID, NOW)).toBe('not_restorable');
    expect(t.names()).toEqual(['repo.restore']);
  });

  it('restore: a mail failure still resolves restored and logs without the recipient', async () => {
    const t = build({ mailCancelledThrows: true });
    expect(await t.service.restore(USER_ID, NOW)).toBe('restored');
    const text = JSON.stringify(t.logs);
    expect(t.logs.filter((l) => l.level === 'warn')).toHaveLength(1);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(USER_ID);
  });

  it('restoreInTx delegates with the caller client, returns the repo verdict and sends nothing', async () => {
    const client = { tag: 'reset-tx' } as unknown as PoolClient;
    for (const verdict of ['restored', 'not_needed', 'not_restorable'] as const) {
      const t = build({ restoreInTxResult: verdict });
      expect(await t.service.restoreInTx(client, USER_ID, NOW)).toBe(verdict);
      expect(t.names()).toEqual(['repo.restoreInTx']);
      expect(t.callsOf('repo.restoreInTx')[0]!.args[0]).toBe(client);
    }
  });

  it('notifyRestored reads the address and sends the cancelled mail', async () => {
    const t = build();
    await t.service.notifyRestored(USER_ID);
    expect(t.names()).toEqual(['repo.getEmail', 'mail.cancelled']);
    expect(t.callsOf('mail.cancelled')[0]!.args[0]).toEqual({ to: EMAIL });
  });

  it('notifyRestored with no address sends nothing; with a failing lookup or mail it still resolves', async () => {
    const none = build({ getEmail: async () => null });
    await none.service.notifyRestored(USER_ID);
    expect(none.callsOf('mail.cancelled')).toHaveLength(0);

    const lookupFails = build({
      getEmail: async () => {
        throw new Error('db down');
      },
    });
    await expect(lookupFails.service.notifyRestored(USER_ID)).resolves.toBeUndefined();
    expect(lookupFails.callsOf('mail.cancelled')).toHaveLength(0);
    expect(lookupFails.logs.filter((l) => l.level === 'warn')).toHaveLength(1);

    const mailFails = build({ mailCancelledThrows: true });
    await expect(mailFails.service.notifyRestored(USER_ID)).resolves.toBeUndefined();
    expect(JSON.stringify(mailFails.logs)).not.toContain(EMAIL);
  });
});

describe('requestDeletionByPassword and getGraceDays', () => {
  it('getGraceDays returns configured graceDays', () => {
    const t = build({ graceDays: 45 });
    expect(t.service.getGraceDays()).toBe(45);
  });

  it('rejects a wrong confirmation phrase before any repo or lockout call', async () => {
    const t = build();
    expect(await codeOf(t.service.requestDeletionByPassword(EMAIL, 'pw', 'delete'))).toBe(
      'account_deletion_confirmation_invalid',
    );
    expect(t.names()).toEqual([]);
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34 (service): unknown or non-active email runs dummy Argon2id verify to equalize timing, answers reauth_failed, and never touches lockout', async () => {
    const t = build({ activeUserByEmail: null });
    expect(await codeOf(t.service.requestDeletionByPassword('unknown@example.com', 'pw', 'DELETE'))).toBe(
      'reauth_failed',
    );
    expect(t.names()).toEqual(['repo.findActiveUserByEmail', 'verify']);
    expect(t.callsOf('verify')[0]!.args).toEqual([DUMMY_PASSWORD_HASH, 'pw']);
    // Also confirm the real Argon2id verifier accepts DUMMY_PASSWORD_HASH as a well-formed PHC string and returns false.
    expect(await realVerifyPassword(DUMMY_PASSWORD_HASH, 'pw')).toBe(false);
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34 (service): locked active account answers account_locked before password verification', async () => {
    const t = build({ locked: true });
    expect(await codeOf(t.service.requestDeletionByPassword(EMAIL, 'pw', 'DELETE'))).toBe('account_locked');
    expect(t.names()).toEqual(['repo.findActiveUserByEmail', 'lockout.isLocked']);
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34 (service): wrong password on active account records one lockout failure and answers reauth_failed', async () => {
    const t = build({ passwordOk: false });
    expect(await codeOf(t.service.requestDeletionByPassword(EMAIL, 'wrong-pw', 'DELETE'))).toBe('reauth_failed');
    expect(t.names()).toEqual([
      'repo.findActiveUserByEmail',
      'lockout.isLocked',
      'verify',
      'lockout.recordFailure',
    ]);
    expect(t.callsOf('lockout.recordFailure')[0]!.args).toEqual([USER_ID]);
  });

  // Feature: account-deletion, Property 34: Web account deletion and privacy policy routes
  it('Property 34 (service): valid credentials transition the account, send the scheduled email, and never clear lockout', async () => {
    const t = build();
    const res = await t.service.requestDeletionByPassword(`  ${EMAIL}  `, 'correct-pw', ' DELETE ');
    const scheduled = new Date(NOW.getTime() + 30 * 86_400_000);
    expect(res).toEqual({
      status: 'pending_deletion',
      scheduledPurgeAt: scheduled,
      graceDays: 30,
    });
    expect(t.names()).toEqual([
      'repo.findActiveUserByEmail',
      'lockout.isLocked',
      'verify',
      'repo.requestDeletionForUser',
      'mail.scheduled',
    ]);
    expect(t.callsOf('repo.findActiveUserByEmail')[0]!.args).toEqual([EMAIL]);
    expect(t.callsOf('lockout.clearOnSuccess')).toHaveLength(0);
    expect(t.callsOf('repo.requestDeletionForUser')[0]!.args[0]).toEqual({
      userId: USER_ID,
      now: NOW,
      scheduledPurgeAt: scheduled,
      placeholderId: 'deadc0de-0000-4000-8000-000000000001',
    });
  });

  it('a race where requestDeletionForUser returns not_active answers reauth_failed and sends no mail', async () => {
    const t = build({ requestForUserOutcome: { outcome: 'not_active' } });
    expect(await codeOf(t.service.requestDeletionByPassword(EMAIL, 'correct-pw', 'DELETE'))).toBe('reauth_failed');
    expect(t.callsOf('mail.scheduled')).toHaveLength(0);
  });

  it('a mail failure in requestDeletionByPassword logs at warn without recipient or userId and still resolves', async () => {
    const t = build({ mailScheduledThrows: true });
    const res = await t.service.requestDeletionByPassword(EMAIL, 'correct-pw', 'DELETE');
    expect(res.status).toBe('pending_deletion');
    const warns = t.logs.filter((l) => l.level === 'warn');
    expect(warns).toHaveLength(1);
    const text = JSON.stringify(t.logs);
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(USER_ID);
  });
});
