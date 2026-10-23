/**
 * `reauthRateLimitConfig()` (account-deletion R2.11): the login budget (5 per 15 minutes) keyed on the SHA-256
 * of the bearer token, not on an email the reauth body does not have.
 *
 * Validates: Requirements 2.11
 */
import { createHash } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../errors/handler.js';
import { registerRateLimit, reauthRateLimitConfig } from '../rateLimit.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const fakeRequest = (authorization: string | undefined, ip = '10.0.0.1'): FastifyRequest =>
  ({ headers: authorization === undefined ? {} : { authorization }, ip, body: { password: 'x' } }) as unknown as FastifyRequest;

describe('reauthRateLimitConfig key', () => {
  const keyOf = (req: FastifyRequest): string =>
    (reauthRateLimitConfig().keyGenerator as (r: FastifyRequest) => string)(req);

  it('keys on the SHA-256 of the bearer token and never contains the token', () => {
    const key = keyOf(fakeRequest('Bearer secret-token-value'));
    expect(key).toBe(`reauth:${sha('secret-token-value')}`);
    expect(key).not.toContain('secret-token-value');
  });

  it('is stable per token, distinct between tokens, and independent of the client address', () => {
    expect(keyOf(fakeRequest('Bearer a', '1.1.1.1'))).toBe(keyOf(fakeRequest('Bearer a', '2.2.2.2')));
    expect(keyOf(fakeRequest('Bearer a'))).not.toBe(keyOf(fakeRequest('Bearer b')));
  });

  it('falls back to the client address when there is no usable bearer header', () => {
    expect(keyOf(fakeRequest(undefined, '9.9.9.9'))).toBe('reauth:ip:9.9.9.9');
    expect(keyOf(fakeRequest('Basic abc', '9.9.9.9'))).toBe('reauth:ip:9.9.9.9');
    expect(keyOf(fakeRequest('Bearer    ', '9.9.9.9'))).toBe('reauth:ip:9.9.9.9');
  });

  it('uses the login budget by default: 5 per 15 minutes', () => {
    const cfg = reauthRateLimitConfig();
    expect(cfg.max).toBe(5);
    expect(cfg.timeWindow).toBe(15 * 60_000);
  });
});

describe('reauthRateLimitConfig on a route', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    // A generous global budget, so only the route override can produce a 429 here.
    await registerRateLimit(app, {
      reads: { max: 1000, timeWindowMs: 60_000 },
      mutations: { max: 1000, timeWindowMs: 60_000 },
    });
    app.post('/reauth', { config: { rateLimit: reauthRateLimitConfig() } }, async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (token: string, ip = '10.0.0.1') =>
    app.inject({ method: 'POST', url: '/reauth', headers: { authorization: `Bearer ${token}` }, remoteAddress: ip, payload: { password: 'x' } });

  it('allows five calls per session token and answers the sixth with the 429 envelope', async () => {
    for (let i = 0; i < 5; i++) expect((await call('tok-a')).statusCode).toBe(200);
    const blocked = await call('tok-a');
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('rate_limit_exceeded');
  });

  it('keeps another session’s bucket separate, even from the same address', async () => {
    for (let i = 0; i < 5; i++) await call('tok-a');
    expect((await call('tok-a')).statusCode).toBe(429);
    expect((await call('tok-b')).statusCode).toBe(200);
  });

  it('the same token from a different address shares one bucket', async () => {
    for (let i = 0; i < 5; i++) await call('tok-c', '10.0.0.1');
    expect((await call('tok-c', '10.0.0.2')).statusCode).toBe(429);
  });
});
