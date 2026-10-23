/**
 * The whole path once, over real repos and the real routes (checkpoint 11): register, re-authenticate, request
 * deletion, find the old session dead, cancel by signing in, request again, jump past the due date, call the
 * cron route twice, run the held job, and find the account gone.
 *
 * Only Redis, mail, the photo store and the aggregate recompute are fakes (see `authWorld.ts`).
 *
 * Feature: account-deletion, Property 24: A non-active account cannot hold a working session
 * Feature: account-deletion, Property 25: The cron endpoint contract
 * Feature: account-deletion, Property 7: Login eligibility is a function of state and time only
 *
 * Validates: Requirements 2.1, 2.3, 3.2, 3.4, 4.1, 4.2, 4.6, 4.8, 8.1, 8.2, 8.3, 9.5, 9.6, 17.3
 */
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashToken } from '../../auth/sessionToken.js';
import { buildAuthWorld, CRON_SECRET, DAY_MS, GRACE_DAYS, PASSWORD, type AuthWorld } from './authWorld.js';

let w: AuthWorld;

beforeEach(async () => {
  w = await buildAuthWorld();
});
afterEach(async () => {
  await w.close();
});

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

async function requestDeletion(token: string): Promise<{ scheduledPurgeAt: string }> {
  const reauth = await w.app.inject({
    method: 'POST',
    url: '/me/account/deletion/reauth',
    headers: bearer(token),
    payload: { password: PASSWORD },
  });
  expect(reauth.statusCode).toBe(200);
  const { reauthGrant } = reauth.json() as { reauthGrant: string };
  const res = await w.app.inject({
    method: 'POST',
    url: '/me/account/deletion',
    headers: bearer(token),
    payload: { reauthGrant, confirmation: 'DELETE' },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { scheduledPurgeAt: string };
}

describe('request, stale session, cancel by signing in', () => {
  it('walks reauth -> request -> dead session -> login restore', async () => {
    const { token, userId } = await w.register('walk@example.com');

    // Request: the stored date is the one the response carried.
    const { scheduledPurgeAt } = await requestDeletion(token);
    expect(new Date(scheduledPurgeAt).getTime()).toBe(w.clock.t + GRACE_DAYS * DAY_MS);
    const row = await w.userRow(userId);
    expect(row?.deletion_state).toBe('pending_deletion');
    expect(new Date(row?.scheduled_purge_at as Date).getTime()).toBe(w.clock.t + GRACE_DAYS * DAY_MS);
    const live = await w.pool.query(`SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    expect((live.rows[0] as { n: number }).n).toBe(0);
    expect(w.scheduledMail).toHaveLength(1);

    // Stale re-auth: the caller's own session was revoked by the request, so it is a plain 401 now.
    const stale = await w.app.inject({
      method: 'POST',
      url: '/me/account/deletion/reauth',
      headers: bearer(token),
      payload: { password: PASSWORD },
    });
    expect(stale.statusCode).toBe(401);
    expect((await w.app.inject({ method: 'GET', url: '/me', headers: bearer(token) })).statusCode).toBe(401);

    // A wrong password does not restore and counts toward the lockout.
    w.lockoutEvents.length = 0;
    const wrong = await w.login('walk@example.com', 'not-the-password');
    expect(wrong.statusCode).toBe(401);
    expect(w.lockoutEvents).toContain(`recordFailure:${userId}`);
    expect((await w.userRow(userId))?.deletion_state).toBe('pending_deletion');

    // The right password cancels the deletion.
    const back = await w.login('walk@example.com');
    expect(back.statusCode).toBe(200);
    const body = back.json() as { token: string; accountRestored?: boolean };
    expect(body.accountRestored).toBe(true);
    expect((await w.userRow(userId))?.deletion_state).toBe('active');
    expect(w.cancelledMail).toEqual(['walk@example.com']);
    expect((await w.app.inject({ method: 'GET', url: '/me', headers: bearer(body.token) })).statusCode).toBe(200);

    // Once active, a login carries no accountRestored key at all.
    const again = await w.login('walk@example.com');
    expect(again.statusCode).toBe(200);
    expect(Object.keys(again.json() as object)).not.toContain('accountRestored');
  });
});

describe('session binding through the real middleware and repo', () => {
  it('the stored grant carries the middleware’s session id and only its hash', async () => {
    const { token, userId } = await w.register('bound@example.com');
    const reauth = await w.app.inject({
      method: 'POST',
      url: '/me/account/deletion/reauth',
      headers: bearer(token),
      payload: { password: PASSWORD },
    });
    expect(reauth.statusCode).toBe(200);
    const { reauthGrant } = reauth.json() as { reauthGrant: string };

    const session = await w.pool.query<{ id: string }>(`SELECT id FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
    const grants = await w.pool.query<{ session_id: string; user_id: string; grant_hash: string }>(
      `SELECT session_id, user_id, grant_hash FROM account_deletion_reauth_grants`,
    );
    expect(grants.rows).toHaveLength(1);
    expect(grants.rows[0]!.session_id).toBe(session.rows[0]!.id);
    expect(grants.rows[0]!.user_id).toBe(userId);
    expect(grants.rows[0]!.grant_hash).not.toBe(reauthGrant);
    expect(grants.rows[0]!.grant_hash).toBe(createHash('sha256').update(reauthGrant).digest('hex'));
    // Success did not touch the lockout counter.
    expect(w.lockoutEvents.some((e) => e.startsWith('clearOnSuccess'))).toBe(false);

    // A second login session of the same user cannot spend the first session's grant.
    const second = await w.login('bound@example.com');
    const otherToken = (second.json() as { token: string }).token;
    const spend = await w.app.inject({
      method: 'POST',
      url: '/me/account/deletion',
      headers: bearer(otherToken),
      payload: { reauthGrant, confirmation: 'DELETE' },
    });
    expect(spend.statusCode).toBe(403);
    expect((spend.json() as { error: { code: string } }).error.code).toBe('reauth_required');
    expect((await w.userRow(userId))?.deletion_state).toBe('active');
  });

  it('a wrong password costs a lockout failure and no grant row', async () => {
    const { token, userId } = await w.register('wrong@example.com');
    w.lockoutEvents.length = 0;
    const res = await w.app.inject({
      method: 'POST',
      url: '/me/account/deletion/reauth',
      headers: bearer(token),
      payload: { password: 'definitely-not-it' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('reauth_failed');
    expect(w.lockoutEvents).toEqual([`isLocked:${userId}`, `recordFailure:${userId}`]);
    expect((await w.pool.query(`SELECT count(*)::int AS n FROM account_deletion_reauth_grants`)).rows[0]).toEqual({ n: 0 });
    // Still signed in: a failed re-authentication never signs the user out.
    expect((await w.app.inject({ method: 'GET', url: '/me', headers: bearer(token) })).statusCode).toBe(200);
  });
});

describe('forced due date, purge run, account gone', () => {
  it('purges after the due date and answers the cron route 202 accepted then 202 skipped', async () => {
    const { token, userId } = await w.register('gone@example.com', 'Gone Person');
    await requestDeletion(token);

    // Past the due date: the account behaves exactly like an unknown email (Property 7).
    w.clock.t += (GRACE_DAYS + 1) * DAY_MS;
    const unknown = await w.login('nobody-at-all@example.com');
    const expired = await w.login('gone@example.com');
    expect(expired.statusCode).toBe(401);
    expect(expired.payload).toBe(unknown.payload);

    // The cron route: first call starts a run, an overlapping call is skipped, work has not run yet.
    const first = await w.app.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toEqual({ status: 'accepted' });
    const second = await w.app.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual({ status: 'skipped', reason: 'in_flight' });
    expect(w.jobs).toHaveLength(1);
    expect((await w.userRow(userId))?.deletion_state).toBe('pending_deletion');

    // The held job does the work.
    await w.jobs[0]!();
    expect(await w.userRow(userId)).toBeUndefined();
    const ledger = await w.pool.query(`SELECT outcome FROM account_deletion_ledger`);
    expect(ledger.rows).toEqual([{ outcome: 'completed' }]);

    // The address is free again, and the old credentials no longer work.
    expect((await w.login('gone@example.com')).statusCode).toBe(401);
    const reused = await w.register('gone@example.com', 'Someone Else');
    expect(reused.userId).not.toBe(userId);

    // The runner is released: the next cron call starts a new run.
    const third = await w.app.inject({ method: 'HEAD', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    expect(third.statusCode).toBe(202);
    expect(w.jobs).toHaveLength(2);
  });

  it('a restored account is not purged: signing in just before the due date wins', async () => {
    const { token, userId } = await w.register('late@example.com');
    await requestDeletion(token);
    w.clock.t += GRACE_DAYS * DAY_MS - 1; // one millisecond before the due date
    const back = await w.login('late@example.com');
    expect(back.statusCode).toBe(200);
    expect((back.json() as { accountRestored?: boolean }).accountRestored).toBe(true);

    w.clock.t += 5 * DAY_MS;
    await w.app.inject({ method: 'POST', url: '/internal/account-deletion/purge/run', headers: { 'x-cron-secret': CRON_SECRET } });
    await w.jobs[0]!();
    expect((await w.userRow(userId))?.deletion_state).toBe('active');
    expect((await w.pool.query(`SELECT count(*)::int AS n FROM account_deletion_ledger`)).rows[0]).toEqual({ n: 0 });
  });
});
