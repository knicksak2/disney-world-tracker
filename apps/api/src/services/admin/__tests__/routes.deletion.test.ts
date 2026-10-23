/**
 * Task 12.4, rendered pages (account-deletion R5.7, R8.12, R15.5, R17.4): `server.inject` with basic auth over the
 * REAL admin repo on pg-mem. The user lookup shows a Deletion card for a non-active account (attempts and the
 * "purge is failing" text only above zero); the growth page shows Active users, Pending deletion, Last purge and the
 * seven-day purge table; neither page names a purged account's id or email; and no control targets a deletion route.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BOB,
  claimSubject,
  createWorld,
  makePending,
  SUBJECT,
  type World,
} from '../../accountDeletion/__tests__/visibility.harness.js';
import { createBasicAuthHook } from '../basicAuth.js';
import { createAdminRepo } from '../repo.js';
import { adminRoutes } from '../routes.js';
import { adminPoolShim, registerToChar } from './pgMemAdmin.js';

const auth = { authorization: `Basic ${Buffer.from('admin:supersecretpassword').toString('base64')}` };

let w: World;

beforeEach(async () => {
  w = await createWorld();
  registerToChar(w.db);
});

function app() {
  const server = Fastify();
  void server.register(
    adminRoutes({
      repo: createAdminRepo(adminPoolShim(w.pool), {} as never),
      basicAuth: createBasicAuthHook({ username: 'admin', password: 'supersecretpassword' }),
      catalogRepo: {} as never,
      intelligenceRepo: {} as never,
      pinRepo: {} as never,
      runCatalogSync: async () => {},
      isSyncInProgress: async () => false,
      getRateLimiterSnapshot: async () => ({
        syncGateway: { currentRps: 0, maxRps: 5, currentConcurrency: 0, maxConcurrency: 4 },
        web: { currentRps: 0, maxRps: 5, currentConcurrency: 0, maxConcurrency: 4 },
      }),
    } as never),
  );
  return server;
}

const lookup = async (email: string): Promise<{ status: number; body: string }> => {
  const res = await app().inject({ method: 'GET', url: `/admin/users?email=${encodeURIComponent(email)}`, headers: auth });
  return { status: res.statusCode, body: res.body };
};

/** Every form action and button/anchor target on the page. */
const controls = (html: string): string[] =>
  [...html.matchAll(/(?:action|href)="([^"]*)"/g)].map((m) => m[1]!);

describe('GET /admin/users', () => {
  it('an active account has no Deletion card', async () => {
    const { status, body } = await lookup(BOB.email);
    expect(status).toBe(200);
    expect(body).toContain(BOB.email);
    expect(body).not.toContain('data-testid="deletion-card"');
  });

  it('a pending account shows its state, scheduled purge and stage, and the failing text only when attempts are above zero', async () => {
    await makePending(w, SUBJECT.id, { scheduledPurgeAt: new Date('2026-05-01T12:00:00.000Z') });
    const clean = await lookup(SUBJECT.email);
    expect(clean.status).toBe(200);
    expect(clean.body).toContain('data-testid="deletion-card"');
    expect(clean.body).toContain('pending_deletion');
    expect(clean.body).toContain('2026-05-01T12:00:00.000Z');
    expect(clean.body).toContain('stage 0 of 5');
    expect(clean.body).not.toContain('purge is failing');

    await w.pool.query(`UPDATE users SET purge_attempts = 2, purge_stage = 3 WHERE id = $1`, [SUBJECT.id]);
    const failing = await lookup(SUBJECT.email);
    expect(failing.body).toContain('stage 3 of 5');
    expect(failing.body).toContain('purge is failing; see the server log');
  });

  it('a purged account\'s address answers "no matching account" and the page carries neither its id nor its email', async () => {
    const claimed = await claimSubject(w);
    const tombstoneId = await w.repo.ensureTombstone(claimed);
    const tombstoneEmail = String(
      ((await w.pool.query(`SELECT email FROM users WHERE id = $1`, [tombstoneId])).rows[0] as { email: string }).email,
    );
    const res = await lookup(tombstoneEmail);
    expect(res.status).toBe(200);
    expect(res.body).toContain('No matching account was found.');
    // The search box echoes what the admin typed (a tombstone address embeds its id); nothing else may carry it.
    const withoutEcho = res.body.split(tombstoneEmail).join('');
    expect(withoutEcho).not.toContain(tombstoneId);
    expect(withoutEcho).not.toContain(SUBJECT.email);
    expect(withoutEcho).not.toContain(SUBJECT.displayName);
  });

  it('has no form or link that requests, cancels or accelerates a deletion', async () => {
    await makePending(w, SUBJECT.id);
    const { body } = await lookup(SUBJECT.email);
    for (const target of controls(body)) {
      expect(target).not.toMatch(/account\/deletion|account-deletion|delete-account|purge/i);
    }
    expect(body).not.toMatch(/Delete account|Cancel deletion|Purge now/i);
  });
});

describe('GET /admin/growth', () => {
  it('shows Active users, Pending deletion, Last purge (UTC) and the seven-day purge table, and names no purged account', async () => {
    const claimed = await claimSubject(w);
    const tombstoneId = await w.repo.ensureTombstone(claimed);
    await makePending(w, BOB.id);
    await w.pool.query(`INSERT INTO account_deletion_ledger (requested_at, purged_at) VALUES ($1, $2)`, [
      new Date('2026-01-01T00:00:00Z'),
      new Date(),
    ]);

    const res = await app().inject({ method: 'GET', url: '/admin/growth', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Active users');
    expect(res.body).toContain('Pending deletion');
    expect(res.body).toContain('Last purge (UTC)');
    expect(res.body).toContain('Account purges, trailing 7 days (UTC)');
    expect(res.body).not.toContain('never');
    expect(res.body).not.toContain(tombstoneId);
    expect(res.body).not.toContain(SUBJECT.id);
    expect(res.body).not.toContain(SUBJECT.email);
    for (const target of controls(res.body)) {
      expect(target).not.toMatch(/account\/deletion|account-deletion|delete-account|purge/i);
    }
  });

  it('says "never" when no account has been purged', async () => {
    const res = await app().inject({ method: 'GET', url: '/admin/growth', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('never');
  });
});
