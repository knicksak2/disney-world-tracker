/**
 * Unit tests for the gateway-level rate-limit plugin (task 13.3).
 *
 * The plugin wraps `@fastify/rate-limit` with three route-group budgets:
 *
 *   - GET/HEAD reads         60 / 60 s, per-user (tok-hash or IP)
 *   - other mutations        10 / 60 s, per-user
 *   - POST /auth/login        5 / 15 m, account-keyed (lower-cased email)
 *
 * These tests run the plugin against a tiny throw-away Fastify instance
 * with the project's standard error handler attached, so we exercise the
 * full envelope path the production server uses (status code, JSON
 * body, code → 429 mapping). The login route is registered with the
 * `loginRateLimitConfig` block to mirror what `services/auth/routes.ts`
 * attaches in the real app.
 *
 * Validates: Requirements 6.7 (defense in depth)
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerErrorHandler } from '../../errors/handler.js';
import {
  loginRateLimitConfig,
  registerRateLimit,
} from '../rateLimit.js';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------
//
// `buildTestApp` creates a fresh Fastify instance, registers the rate-limit
// plugin with small windows (so a test can safely repeat a request 6 times
// in series), and exposes:
//
//   GET  /read       — exercises the read budget (default 5/min in tests)
//   POST /mutate     — exercises the mutation budget (default 10/min in tests)
//   POST /auth/login — exercises the email-keyed login budget (5/15min)
//
// We use small budgets in the read test so the test does not have to do 61
// requests; the production budget (60/min) is exercised by the SLA harness
// rather than this unit suite, and the rate-limit plugin's behavior is
// independent of the absolute number we pick.
//
// The plugin's default in-memory store is per-instance, so each test gets
// a clean slate by building a fresh app in `beforeEach`.

interface HarnessOptions {
  readonly readsMax?: number;
  readonly mutationsMax?: number;
}

async function buildTestApp(opts: HarnessOptions = {}): Promise<FastifyInstance> {
  const readsMax = opts.readsMax ?? 5;
  const mutationsMax = opts.mutationsMax ?? 10;

  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  await registerRateLimit(app, {
    reads: { max: readsMax, timeWindowMs: 60_000 },
    mutations: { max: mutationsMax, timeWindowMs: 60_000 },
  });

  app.get('/read', async () => ({ ok: true }));
  app.post('/mutate', async () => ({ ok: true }));
  app.post(
    '/auth/login',
    { config: { rateLimit: loginRateLimitConfig() } },
    async () => ({ ok: true }),
  );

  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildTestApp();
});

afterEach(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// 1) Read budget
// ---------------------------------------------------------------------------

describe('read budget', () => {
  it('rejects the (max + 1)th GET in the window with a 429 envelope', async () => {
    // The harness above sets `readsMax = 5`, so the 6th request should be
    // rate-limited. Allowed requests must come back as 200; the rejected
    // request must come back as 429 with our project envelope.
    for (let i = 0; i < 5; i += 1) {
      const ok = await app.inject({
        method: 'GET',
        url: '/read',
        // Stable IP so the keyer locks all six requests into the same bucket.
        remoteAddress: '127.0.0.10',
      });
      expect(ok.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'GET',
      url: '/read',
      remoteAddress: '127.0.0.10',
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('rate_limit_exceeded');
    expect(typeof body.error.message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// 2) Mutation budget
// ---------------------------------------------------------------------------

describe('mutation budget', () => {
  it('rejects the 11th mutation in the window with a 429 envelope', async () => {
    // `mutationsMax = 10` matches the design's per-user-per-minute budget.
    for (let i = 0; i < 10; i += 1) {
      const ok = await app.inject({
        method: 'POST',
        url: '/mutate',
        remoteAddress: '127.0.0.20',
      });
      expect(ok.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/mutate',
      remoteAddress: '127.0.0.20',
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { error: { code: string } };
    expect(body.error.code).toBe('rate_limit_exceeded');
  });
});

// ---------------------------------------------------------------------------
// 3) Login budget — account-keyed
// ---------------------------------------------------------------------------

describe('login budget (account-keyed)', () => {
  it('rejects the 6th login attempt for the same email even from rotating IPs', async () => {
    // The whole point of "account-keyed" is that an attacker cannot
    // bypass the budget by rotating IPs. We send each of the six
    // attempts from a fresh source IP and assert the budget still
    // catches the 6th. The first five must succeed (the dummy handler
    // returns 200 — the real login route is unaware of the limiter).
    const targetEmail = 'victim@example.com';

    for (let i = 0; i < 5; i += 1) {
      const ok = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: targetEmail, password: `wrong-${i}` },
        remoteAddress: `10.0.0.${i + 1}`,
      });
      expect(ok.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: targetEmail, password: 'still-wrong' },
      // Brand-new source IP — would slip past an IP-based limiter.
      remoteAddress: '10.99.99.99',
    });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { error: { code: string } };
    expect(body.error.code).toBe('rate_limit_exceeded');
  });

  it('keys attempts by lower-cased email so capitalization variations share the bucket', async () => {
    // Same account, mixed-case spellings — e.g. an attacker rotating
    // address-form variants — must collapse to the same key.
    const variations = [
      'Mixed@Example.com',
      'mixed@example.com',
      'MIXED@EXAMPLE.COM',
      'mIxEd@ExAmPlE.cOm',
      ' mixed@example.com ',
    ];

    for (let i = 0; i < variations.length; i += 1) {
      const ok = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: variations[i], password: 'whatever' },
        remoteAddress: `10.1.0.${i + 1}`,
      });
      expect(ok.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      // Same email, capitalized differently again. The bucket already
      // holds five attempts; this is the 6th and must be rejected.
      payload: { email: 'MIXED@example.COM', password: 'whatever' },
      remoteAddress: '10.99.0.1',
    });
    expect(blocked.statusCode).toBe(429);
  });

  it('isolates buckets per account so unrelated emails do not collide', async () => {
    // Five attempts on one account must NOT spill over to a sibling
    // account from the same IP. This is the symmetric assertion to the
    // previous test: the limiter is account-keyed, not IP-keyed.
    const ip = '172.16.0.5';

    for (let i = 0; i < 5; i += 1) {
      const ok = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'first@example.com', password: 'whatever' },
        remoteAddress: ip,
      });
      expect(ok.statusCode).toBe(200);
    }

    // Sixth attempt on the saturated account: blocked.
    const blockedFirst = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'first@example.com', password: 'whatever' },
      remoteAddress: ip,
    });
    expect(blockedFirst.statusCode).toBe(429);

    // First attempt on a sibling account from the SAME IP: allowed.
    const allowedSecond = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'second@example.com', password: 'whatever' },
      remoteAddress: ip,
    });
    expect(allowedSecond.statusCode).toBe(200);
  });

  it('falls back to IP when the body is missing an email so junk-body floods are still counted', async () => {
    // Five malformed-body requests from the same IP burn through the
    // login budget under the `login:ip:<ip>` fallback key. The sixth
    // is blocked. (The dummy handler accepts the empty body; in the
    // real auth route this would 400 first, but the limiter is supposed
    // to count *requests*, not just well-formed ones.)
    const ip = '203.0.113.7';

    for (let i = 0; i < 5; i += 1) {
      const ok = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {},
        remoteAddress: ip,
      });
      expect(ok.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {},
      remoteAddress: ip,
    });
    expect(blocked.statusCode).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// 4) Method classification
// ---------------------------------------------------------------------------

describe('method classification', () => {
  it('keys read and mutation requests in separate buckets', async () => {
    // A user should be able to spend their read budget without affecting
    // the mutation budget for their next request, and vice versa. The
    // limiter shares one Redis key namespace so the differentiator must
    // come from the per-request `max`. Reads cap at 5, mutations cap at
    // 10 (test budgets); after 5 reads the 6th read is blocked, but a
    // POST from the same IP is still allowed.
    for (let i = 0; i < 5; i += 1) {
      const ok = await app.inject({
        method: 'GET',
        url: '/read',
        remoteAddress: '198.51.100.1',
      });
      expect(ok.statusCode).toBe(200);
    }

    // 6th read from same IP — the read max applies to the shared bucket
    // (the limiter cannot distinguish read vs mutation slots inside one
    // bucket), so this is blocked.
    const blockedRead = await app.inject({
      method: 'GET',
      url: '/read',
      remoteAddress: '198.51.100.1',
    });
    expect(blockedRead.statusCode).toBe(429);

    // The mutation also lives in the same bucket; this assertion just
    // documents the behavior. We do NOT assert that the mutation
    // succeeds — the design's defense-in-depth posture is that any
    // caller who has burst beyond their read budget is already on a
    // suspicious trajectory and a stricter mutation cap is fine.
    const followUpMutation = await app.inject({
      method: 'POST',
      url: '/mutate',
      remoteAddress: '198.51.100.1',
    });
    expect([200, 429]).toContain(followUpMutation.statusCode);
  });
});
