/**
 * Restore on login, on password reset (atomically with the reset) and through the web fallback page, through the
 * real auth routes, the real `PasswordResetRepo` (pg-mem, real SQL) and the real account-deletion service.
 *
 * Feature: account-deletion, Property 7: Login eligibility is a function of state and time only
 * Feature: account-deletion, Property 32: Restoring through a password reset is atomic with the reset
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.10, 4.11, 16.6, 17.3
 */
import { createHash, randomBytes } from 'node:crypto';

import fc from 'fast-check';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../../errors/handler.js';
import { authRoutes } from '../routes.js';
import { classifyLoginEligibility, type DeletionState } from '../../accountDeletion/deletionState.js';
import {
  buildAuthWorld,
  DAY_MS,
  PASSWORD,
  type AuthWorld,
} from '../../accountDeletion/__tests__/authWorld.js';
import { createPasswordResetRepo } from '../passwordResetRepo.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const GENERIC_FORGOT = 'If an account exists with this email, a reset code has been sent.';

interface UserRow {
  password_hash: string;
  deletion_state: string;
}

async function passwordHashOf(w: AuthWorld, id: string): Promise<string> {
  return ((await w.pool.query<UserRow>(`SELECT password_hash FROM users WHERE id = $1`, [id])).rows[0] as UserRow).password_hash;
}

async function usedAtOf(w: AuthWorld, resetId: string): Promise<Date | null> {
  const r = await w.pool.query<{ used_at: Date | null }>(`SELECT used_at FROM password_reset_tokens WHERE id = $1`, [resetId]);
  return r.rows[0]?.used_at ?? null;
}

async function makeReset(w: AuthWorld, userId: string, code = '123456'): Promise<{ id: string; code: string; token: string }> {
  const token = randomBytes(12).toString('hex');
  const id = await createPasswordResetRepo(w.pool).createResetRecord(
    userId,
    sha(code),
    sha(token),
    new Date(w.clock.t + 15 * 60_000),
  );
  return { id, code, token };
}

// ---------------------------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------------------------

describe('POST /auth/login and account deletion', () => {
  let w: AuthWorld;
  beforeAll(async () => {
    w = await buildAuthWorld();
  });
  afterAll(async () => {
    await w.close();
  });

  it('an account pending inside its grace period is restored by a correct password', async () => {
    const id = await w.seedUser('grace@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 5 * DAY_MS));
    const res = await w.login('grace@example.com');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accountRestored?: boolean; token: string; user: { id: string } };
    expect(body.accountRestored).toBe(true);
    expect(body.user.id).toBe(id);
    expect((await w.userRow(id))?.deletion_state).toBe('active');
    expect(w.cancelledMail).toContain('grace@example.com');
    // The session minted after the restore is usable.
    expect((await w.app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${body.token}` } })).statusCode).toBe(200);
  });

  it('an active account’s response has no accountRestored key', async () => {
    await w.seedUser('plain@example.com');
    const res = await w.login('plain@example.com');
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json() as object).sort()).toEqual(['profile', 'token', 'user']);
  });

  it('a registration response never carries accountRestored', async () => {
    const res = await w.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'fresh@example.com', displayName: 'Fresh', password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
    expect(Object.keys(res.json() as object)).not.toContain('accountRestored');
  });

  it('a wrong password on a restorable account is invalid_credentials, counts toward lockout and restores nothing', async () => {
    const id = await w.seedUser('wrongpw@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 5 * DAY_MS));
    w.lockoutEvents.length = 0;
    const res = await w.login('wrongpw@example.com', 'not-the-password');
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_credentials');
    expect(w.lockoutEvents).toEqual([`isLocked:${id}`, `recordFailure:${id}`]);
    expect((await w.userRow(id))?.deletion_state).toBe('pending_deletion');
  });

  it('a locked restorable account is refused as locked before any password work', async () => {
    const id = await w.seedUser('locked@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 5 * DAY_MS));
    w.setLocked(id, true);
    w.lockoutEvents.length = 0;
    const res = await w.login('locked@example.com');
    w.setLocked(id, false);
    expect(res.statusCode).toBe(423);
    expect((res.json() as { error: { code: string } }).error.code).toBe('account_locked');
    // Refused before any password work or restore.
    expect(w.lockoutEvents).toEqual([`isLocked:${id}`]);
    expect((await w.userRow(id))?.deletion_state).toBe('pending_deletion');
  });

  it.each([
    ['pending past its date', async (id: string) => w.setState(id, 'pending_deletion', new Date(w.clock.t - DAY_MS))],
    ['pending exactly at its date', async (id: string) => w.setState(id, 'pending_deletion', new Date(w.clock.t))],
    ['purging', async (id: string) => w.setState(id, 'purging')],
  ])('an account that is %s looks exactly like an unknown email: same bytes, no lockout call, nothing changed', async (name, put) => {
    const email = `ineligible-${name.replace(/\s+/g, '-')}@example.com`;
    const id = await w.seedUser(email);
    await put(id);
    const before = await w.userRow(id);

    w.lockoutEvents.length = 0;
    const unknown = await w.login('nobody-by-that-name@example.com');
    const unknownEvents = [...w.lockoutEvents];
    w.lockoutEvents.length = 0;
    const ineligible = await w.login(email);

    expect(ineligible.statusCode).toBe(401);
    expect(ineligible.payload).toBe(unknown.payload);
    expect(unknownEvents).toEqual([]);
    expect(w.lockoutEvents).toEqual([]);
    expect(await w.userRow(id)).toEqual(before);
  });
});

describe('login restore failure modes', () => {
  it('fails closed with invalid_credentials when no restore port is wired, and mints no session', async () => {
    const w = await buildAuthWorld({ withoutRestorePort: true });
    const id = await w.seedUser('noport@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 5 * DAY_MS));
    const res = await w.login('noport@example.com');
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_credentials');
    expect((await w.userRow(id))?.deletion_state).toBe('pending_deletion');
    expect((await w.pool.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [id])).rows[0]).toEqual({ n: 0 });
    await w.close();
  });

  it('a restore that loses the race to the purge claim is invalid_credentials and mints no session', async () => {
    const w = await buildAuthWorld({
      wrapRestorePort: (real) => ({ ...real, restore: async () => 'not_restorable' as const }),
    });
    const id = await w.seedUser('lost@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 5 * DAY_MS));
    const res = await w.login('lost@example.com');
    expect(res.statusCode).toBe(401);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_credentials');
    expect((await w.pool.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [id])).rows[0]).toEqual({ n: 0 });
    expect(w.cancelledMail).toEqual([]);
    await w.close();
  });
});

describe('auth wired without the restore port', () => {
  async function registerLines(withPort: boolean): Promise<string[]> {
    const lines: string[] = [];
    const app = Fastify({ logger: { level: 'error', stream: { write: (m: string) => void lines.push(m) } } });
    registerErrorHandler(app);
    await app.register(
      authRoutes({
        pool: {} as never,
        lockout: {} as never,
        requireSession: async () => undefined,
        ...(withPort
          ? { accountRestore: { restore: async () => 'restored', restoreInTx: async () => 'not_needed', notifyRestored: async () => undefined } }
          : {}),
      } as never),
    );
    await app.ready();
    await app.close();
    return lines;
  }

  it('logs one error at registration (a pending account then cannot sign in), and none when the port is wired', async () => {
    const missing = await registerLines(false);
    expect(missing.filter((l) => l.includes('auth.account_restore_port_missing'))).toHaveLength(1);
    expect(await registerLines(true)).toEqual([]);
  });
});

// Feature: account-deletion, Property 7: Login eligibility is a function of state and time only
describe('Property 7 through the login route', () => {
  it('active logs in plain, restorable restores, ineligible is indistinguishable from an unknown email', async () => {
    const w = await buildAuthWorld();
    const id = await w.seedUser('prop7@example.com');
    const unknown = await w.login('prop7-nobody@example.com');
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'active' | 'pending_deletion' | 'purging'>('active', 'pending_deletion', 'purging'),
        fc.integer({ min: -3, max: 3 }), // milliseconds between "now" and scheduled_purge_at
        async (state, offsetMs) => {
          const scheduled = new Date(w.clock.t + offsetMs);
          await w.setState(id, state, scheduled);
          const expected = classifyLoginEligibility(
            { state: state as DeletionState, scheduledPurgeAt: state === 'active' ? null : scheduled },
            new Date(w.clock.t),
          );
          const res = await w.login('prop7@example.com');
          if (expected === 'ineligible') {
            expect(res.statusCode).toBe(401);
            expect(res.payload).toBe(unknown.payload);
          } else {
            expect(res.statusCode).toBe(200);
            const body = res.json() as { accountRestored?: true };
            expect(body.accountRestored).toBe(expected === 'restorable' ? true : undefined);
            expect('accountRestored' in body).toBe(expected === 'restorable');
          }
        },
      ),
      { numRuns: 100 },
    );
    await w.close();
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------------------------

describe('POST /auth/forgot-password and account deletion', () => {
  let w: AuthWorld;
  beforeAll(async () => {
    w = await buildAuthWorld();
  });
  afterAll(async () => {
    await w.close();
  });

  it('a pending account inside its grace period gets a reset email', async () => {
    const id = await w.seedUser('fg-grace@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 3 * DAY_MS));
    const res = await w.forgot('fg-grace@example.com');
    expect(res.statusCode).toBe(200);
    expect(w.resetMail.filter((m) => m.to === 'fg-grace@example.com')).toHaveLength(1);
  });

  it('an active account gets a reset email', async () => {
    await w.seedUser('fg-active@example.com');
    await w.forgot('fg-active@example.com');
    expect(w.resetMail.filter((m) => m.to === 'fg-active@example.com')).toHaveLength(1);
  });

  it.each([
    ['pending past its date', async (id: string) => w.setState(id, 'pending_deletion', new Date(w.clock.t - DAY_MS))],
    ['pending exactly at its date', async (id: string) => w.setState(id, 'pending_deletion', new Date(w.clock.t))],
    ['purging', async (id: string) => w.setState(id, 'purging')],
  ])('an account that is %s looks non-existent: no email, no code, same response bytes', async (name, put) => {
    const email = `fg-${name.replace(/\s+/g, '-')}@example.com`;
    const id = await w.seedUser(email);
    await put(id);
    const unknown = await w.forgot('fg-nobody@example.com');
    const mailBefore = w.resetMail.length;
    const res = await w.forgot(email);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toBe(unknown.payload);
    expect((res.json() as { message: string }).message).toBe(GENERIC_FORGOT);
    expect(w.resetMail.length).toBe(mailBefore);
    const codes = await w.pool.query(`SELECT count(*)::int AS n FROM password_reset_tokens WHERE user_id = $1`, [id]);
    expect((codes.rows[0] as { n: number }).n).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Reset password (mobile), atomic restore
// ---------------------------------------------------------------------------------------------

describe('POST /auth/reset-password restores atomically (Property 32)', () => {
  let w: AuthWorld;
  beforeAll(async () => {
    w = await buildAuthWorld();
  });
  afterAll(async () => {
    await w.close();
  });

  const reset = (email: string, code: string) =>
    w.app.inject({ method: 'POST', url: '/auth/reset-password', payload: { email, code, newPassword: 'a-brand-new-password' } });

  it('a pending account: restored, password changed, code consumed, accountRestored true, mail after commit', async () => {
    const id = await w.seedUser('rs-pending@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 4 * DAY_MS));
    const before = await passwordHashOf(w, id);
    const { id: resetId, code } = await makeReset(w, id);

    const res = await reset('rs-pending@example.com', code);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { accountRestored?: boolean; token: string };
    expect(body.accountRestored).toBe(true);
    expect((await w.userRow(id))?.deletion_state).toBe('active');
    expect(await passwordHashOf(w, id)).not.toBe(before);
    expect(await usedAtOf(w, resetId)).not.toBeNull();
    expect(w.cancelledMail).toContain('rs-pending@example.com');
    expect((await w.app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${body.token}` } })).statusCode).toBe(200);
  });

  it('an active account: reset behaves as before, no accountRestored key, no cancellation mail', async () => {
    const id = await w.seedUser('rs-active@example.com');
    const before = await passwordHashOf(w, id);
    const { code } = await makeReset(w, id);
    const mailBefore = w.cancelledMail.length;
    const res = await reset('rs-active@example.com', code);
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json() as object)).not.toContain('accountRestored');
    expect(await passwordHashOf(w, id)).not.toBe(before);
    expect(w.cancelledMail.length).toBe(mailBefore);
  });

  it('a purging account looks non-existent: invalid_code, nothing changes', async () => {
    const id = await w.seedUser('rs-purging@example.com');
    const { id: resetId, code } = await makeReset(w, id);
    await w.setState(id, 'purging');
    const before = await passwordHashOf(w, id);
    const res = await reset('rs-purging@example.com', code);
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_code');
    expect(await passwordHashOf(w, id)).toBe(before);
    expect(await usedAtOf(w, resetId)).toBeNull();
  });

  it('losing the race inside the reset transaction: invalid_code, password unchanged, code NOT consumed, state untouched', async () => {
    const lost = await buildAuthWorld({
      wrapRestorePort: (real) => ({ ...real, restoreInTx: async () => 'not_restorable' as const }),
    });
    const id = await lost.seedUser('rs-lost@example.com');
    await lost.setState(id, 'pending_deletion', new Date(lost.clock.t + 4 * DAY_MS));
    const before = await passwordHashOf(lost, id);
    const { id: resetId, code } = await makeReset(lost, id);

    const res = await lost.app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { email: 'rs-lost@example.com', code, newPassword: 'a-brand-new-password' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('invalid_code');
    expect(await passwordHashOf(lost, id)).toBe(before);
    expect(await usedAtOf(lost, resetId)).toBeNull();
    expect((await lost.userRow(id))?.deletion_state).toBe('pending_deletion');
    expect(lost.cancelledMail).toEqual([]);
    expect((await lost.pool.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1`, [id])).rows[0]).toEqual({ n: 0 });
    await lost.close();
  });
});

// Feature: account-deletion, Property 32: Restoring through a password reset is atomic with the reset
describe('Property 32 through the real completeReset', () => {
  it('restores together with the reset, or changes nothing: for every state and every millisecond around the date', async () => {
    const w = await buildAuthWorld();
    const repo = createPasswordResetRepo(w.pool);
    let n = 0;
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<'active' | 'pending_deletion' | 'purging'>('active', 'pending_deletion', 'purging'),
        fc.constantFrom(-1000, -1, 0, 1, 1000),
        async (state, offsetMs) => {
          const email = `p32-${(n += 1)}@example.com`;
          const id = await w.seedUser(email);
          const at = new Date(w.clock.t);
          const scheduled = new Date(w.clock.t + offsetMs);
          const reset = await makeReset(w, id);
          await w.setState(id, state, scheduled);
          const hashBefore = await passwordHashOf(w, id);

          // The lookup and the restore read ONE clock value, so they agree on the strict boundary.
          const found = await repo.findActiveByEmail(email, at);
          const outcome = await repo.completeReset(reset.id, id, 'new-hash-value', {
            restoreInTx: (client) => w.service.restoreInTx(client, id, at),
          });

          const graceful = state === 'pending_deletion' && offsetMs > 0;
          if (state === 'active') {
            expect(found).not.toBeNull();
            expect(outcome).toBeUndefined();
            expect(await passwordHashOf(w, id)).toBe('new-hash-value');
            expect(await usedAtOf(w, reset.id)).not.toBeNull();
          } else if (graceful) {
            expect(found).not.toBeNull();
            expect(outcome).toBe('restored');
            expect((await w.userRow(id))?.deletion_state).toBe('active');
            expect(await passwordHashOf(w, id)).toBe('new-hash-value');
            expect(await usedAtOf(w, reset.id)).not.toBeNull();
          } else {
            // Not restorable: the lookup already hides the account, and the transaction changes nothing.
            expect(found).toBeNull();
            expect(outcome).toBe('restore_lost');
            expect((await w.userRow(id))?.deletion_state).toBe(state);
            expect(await passwordHashOf(w, id)).toBe(hashBefore);
            expect(await usedAtOf(w, reset.id)).toBeNull();
          }
        },
      ),
      { numRuns: 100 },
    );
    await w.close();
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
// Web fallback
// ---------------------------------------------------------------------------------------------

describe('web fallback page', () => {
  let w: AuthWorld;
  beforeAll(async () => {
    w = await buildAuthWorld();
  });
  afterAll(async () => {
    await w.close();
  });

  const form = (token: string): string =>
    `token=${encodeURIComponent(token)}&password=${encodeURIComponent('a-brand-new-password')}&confirmPassword=${encodeURIComponent('a-brand-new-password')}`;
  const submit = (token: string) =>
    w.app.inject({
      method: 'POST',
      url: '/auth/reset-password-web',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form(token),
    });

  it('shows the form for a pending account in grace and, on submit, says the account was restored', async () => {
    const id = await w.seedUser('web-pending@example.com');
    await w.setState(id, 'pending_deletion', new Date(w.clock.t + 4 * DAY_MS));
    const { id: resetId, token } = await makeReset(w, id);

    const page = await w.app.inject({ method: 'GET', url: `/auth/reset-password?token=${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.payload).toContain('Choose a New Password');

    const res = await submit(token);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Account Restored');
    expect(res.payload).toContain('restored');
    expect((await w.userRow(id))?.deletion_state).toBe('active');
    expect(await usedAtOf(w, resetId)).not.toBeNull();
    expect(w.cancelledMail).toContain('web-pending@example.com');
  });

  it('an active account gets the ordinary success page, not the restored wording', async () => {
    const id = await w.seedUser('web-active@example.com');
    const { token } = await makeReset(w, id);
    const res = await submit(token);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain('Password Updated!');
    expect(res.payload).not.toContain('Account Restored');
  });

  it('a purging account’s link is the ordinary invalid-link page (400), on GET and on POST', async () => {
    const id = await w.seedUser('web-purging@example.com');
    const { token } = await makeReset(w, id);
    await w.setState(id, 'purging');
    const get = await w.app.inject({ method: 'GET', url: `/auth/reset-password?token=${token}` });
    expect(get.statusCode).toBe(400);
    expect(get.payload).toContain('Link Expired or Invalid');
    const post = await submit(token);
    expect(post.statusCode).toBe(400);
    expect(post.payload).toContain('Link Expired or Invalid');
  });

  it('losing the race inside the transaction shows the invalid-link page and changes nothing', async () => {
    const lost = await buildAuthWorld({
      wrapRestorePort: (real) => ({ ...real, restoreInTx: async () => 'not_restorable' as const }),
    });
    const id = await lost.seedUser('web-lost@example.com');
    await lost.setState(id, 'pending_deletion', new Date(lost.clock.t + 4 * DAY_MS));
    const before = await passwordHashOf(lost, id);
    const { id: resetId, token } = await makeReset(lost, id);
    const res = await lost.app.inject({
      method: 'POST',
      url: '/auth/reset-password-web',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: form(token),
    });
    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain('Link Expired or Invalid');
    expect(await passwordHashOf(lost, id)).toBe(before);
    expect(await usedAtOf(lost, resetId)).toBeNull();
    expect((await lost.userRow(id))?.deletion_state).toBe('pending_deletion');
    await lost.close();
  });
});
