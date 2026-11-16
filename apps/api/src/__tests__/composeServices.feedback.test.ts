/**
 * Integration test for in-app feedback wiring through composeServices.ts / server.ts (Feature: in-app-feedback).
 *
 * Exercises the real composition root (real session middleware, real repo, config-driven caps) and asserts:
 *  - POST /me/feedback without a session is 401;
 *  - with a session it is 201 and the row belongs to that session's user;
 *  - the FEEDBACK_PER_HOUR env var reaches the route (the third submission with a cap of 2 is 429);
 *  - the Admin_Panel section is registered and shows the stored submission, behind Basic Auth.
 *
 * A green unit suite cannot prove these: each piece can pass while the route or the admin port is never wired.
 */
import { randomUUID } from 'node:crypto';
import RedisMock from 'ioredis-mock';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../composeServices.js';
import { loadConfig } from '../config.js';
import type { DbPool } from '../db/pool.js';
import { generateToken } from '../services/auth/sessionToken.js';
import { buildMigratedDb, createTestPool } from '../services/accountDeletion/__tests__/helpers.js';

function testEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/appdb',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'a'.repeat(32),
    DISNEY_SYNC_GATEWAY_USERNAME: 'disney-user',
    DISNEY_SYNC_GATEWAY_PASSWORD: 'disney-pass',
    SAMPLING_CRON_SECRET: 'test-sampling-cron-secret',
    PIN_RECONCILE_CRON_SECRET: 'test-pin-reconcile-secret',
    TRIP_BOOKING_CRON_SECRET: 'test-trip-booking-cron-secret',
    ACCOUNT_DELETION_CRON_SECRET: 'test-account-deletion-cron-secret',
    SUPPORT_EMAIL: 'support@example.com',
    ADMIN_PANEL_USERNAME: 'admin-user',
    ADMIN_PANEL_PASSWORD: 'admin-password',
    PHOTO_HARM_API_KEY: 'test-harm-api-key',
    FEEDBACK_PER_HOUR: '2',
  };
}

describe('composeServices wiring for in-app feedback', () => {
  let built: BuiltApp;
  let pool: DbPool;
  let userId: string;
  let token: string;
  const admin = `Basic ${Buffer.from('admin-user:admin-password').toString('base64')}`;

  beforeAll(async () => {
    pool = createTestPool(buildMigratedDb()).pool;
    const config = loadConfig(testEnv());
    built = await buildApp(config, { pool, redis: new RedisMock() as never });
    await built.app.ready();

    userId = randomUUID();
    const pair = generateToken();
    token = pair.token;
    const now = new Date();
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'wired@example.com', 'hash')`, [userId]);
    await pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $4, $5)`,
      [randomUUID(), userId, pair.tokenHash, now, new Date(now.getTime() + 7 * 24 * 3600 * 1000)],
    );
  });

  afterAll(async () => {
    await built.dispose();
  });

  const submit = (message: string, auth: string | null) =>
    built.app.inject({
      method: 'POST',
      url: '/me/feedback',
      headers: auth === null ? {} : { authorization: `Bearer ${auth}` },
      payload: { kind: 'bug', message, contactOk: true },
    });

  it('401 without a session', async () => {
    expect((await submit('nope', null)).statusCode).toBe(401);
  });

  it('201 with a session, storing the row for that user with the account email (consent given)', async () => {
    const res = await submit('wired-first', token);
    expect(res.statusCode).toBe(201);
    const stored = await pool.query(`SELECT user_id, contact_email, status FROM user_feedback WHERE message = 'wired-first'`);
    expect(stored.rows).toEqual([{ user_id: userId, contact_email: 'wired@example.com', status: 'new' }]);
  });

  it('applies FEEDBACK_PER_HOUR from the environment: the third submission is 429', async () => {
    expect((await submit('wired-second', token)).statusCode).toBe(201);
    const third = await submit('wired-third', token);
    expect(third.statusCode).toBe(429);
    expect((third.json() as { error: { code: string } }).error.code).toBe('rate_limit_exceeded');
    const stored = await pool.query(`SELECT count(*)::int AS n FROM user_feedback WHERE user_id = $1`, [userId]);
    expect((stored.rows[0] as { n: number }).n).toBe(2);
  });

  it('the Admin_Panel section is registered, behind Basic Auth, and lists the stored submissions', async () => {
    expect((await built.app.inject({ method: 'GET', url: '/admin/feedback' })).statusCode).toBe(401);
    const res = await built.app.inject({ method: 'GET', url: '/admin/feedback', headers: { authorization: admin } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('wired-first');
    expect(res.body).toContain('wired-second');
    expect(res.body).not.toContain('wired-third');
    // The dashboard lists the section too.
    const dash = await built.app.inject({ method: 'GET', url: '/admin', headers: { authorization: admin } });
    expect(dash.body).toContain('/admin/feedback');
  });
});
