/**
 * Unit tests for the session lifecycle middleware (task 6.2).
 *
 * The middleware is exercised through an in-memory `SessionDbAdapter`
 * fake and a stubbed clock. Where it makes sense we call the hook
 * directly with hand-rolled `FastifyRequest`/`FastifyReply` stubs, so
 * we are testing the lifecycle rules themselves rather than Fastify's
 * routing layer. One end-to-end smoke case wires the hook into a real
 * Fastify instance to confirm the rejected error becomes a 401 with
 * the `unauthorized` envelope.
 *
 * These are example/specific-case tests; the universal-quantifier
 * property test (Property 14) is task 6.8.
 */

import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import {
  createSessionMiddleware,
  SESSION_BURST_DURATION_MS,
  SESSION_BURST_GAP_MS,
  SESSION_IDLE_WINDOW_MS,
  type SessionDbAdapter,
  type SessionRow,
} from '../sessionMiddleware.js';

/**
 * The middleware factory returns a `preHandlerAsyncHookHandler` whose
 * call signature carries a `this: FastifyInstance` annotation. We invoke
 * it directly in unit tests against hand-rolled request/reply stubs;
 * casting through this signature drops the `this` constraint without
 * changing any runtime behavior.
 */
type DirectMiddlewareCall = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

function asDirect(
  middleware: ReturnType<typeof createSessionMiddleware>,
): DirectMiddlewareCall {
  return middleware as unknown as DirectMiddlewareCall;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

interface FakeAdapter extends SessionDbAdapter {
  rows: Map<string, SessionRow>;
  updateCalls: Array<{
    sessionId: string;
    now: Date;
    absoluteExpiresAt: Date;
  }>;
}

function makeAdapter(initial: SessionRow[] = []): FakeAdapter {
  const rows = new Map<string, SessionRow>();
  for (const row of initial) {
    // Key by the hash that the test expects to find this row by. We use
    // `id` as the synthetic hash so test callers can pass `tokenHash =
    // session.id` straight through.
    rows.set(row.id, row);
  }
  const updateCalls: FakeAdapter['updateCalls'] = [];
  return {
    rows,
    updateCalls,
    async findByTokenHash(tokenHash: string) {
      return rows.get(tokenHash) ?? null;
    },
    async updateActivity(sessionId, now, absoluteExpiresAt) {
      updateCalls.push({ sessionId, now, absoluteExpiresAt });
      const existing = rows.get(sessionId);
      if (existing) {
        rows.set(sessionId, {
          ...existing,
          last_seen_at: now,
          absolute_expires_at: absoluteExpiresAt,
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Request/reply stub
// ---------------------------------------------------------------------------

interface StubRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: { id: string };
  userId?: string;
}

function makeRequest(authorization?: string | string[]): StubRequest {
  return {
    headers: authorization === undefined ? {} : { authorization },
  };
}

const noopReply = {} as FastifyReply;

// ---------------------------------------------------------------------------
// Constants used across cases
// ---------------------------------------------------------------------------

const T0 = new Date('2025-01-01T00:00:00.000Z');
const ONE_MINUTE_MS = 60 * 1000;

function makeSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'sess-1',
    user_id: 'user-1',
    last_seen_at: T0,
    absolute_expires_at: new Date(T0.getTime() + SESSION_BURST_DURATION_MS),
    revoked_at: null,
    ...overrides,
  };
}

// hashToken stub that just returns the token unchanged. The middleware
// only cares that the hash matches the lookup key in the adapter; we keep
// the test's mental model simple by making `tokenHash === token`.
const identityHash = (t: string) => t;

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

describe('createSessionMiddleware — Authorization header parsing', () => {
  it('rejects a missing Authorization header', async () => {
    const adapter = makeAdapter();
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });
    const req = makeRequest();

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it('rejects a non-Bearer scheme', async () => {
    const adapter = makeAdapter();
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });
    const req = makeRequest('Basic dXNlcjpwYXNz');

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects an empty bearer token', async () => {
    const adapter = makeAdapter();
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });
    const req = makeRequest('Bearer    ');

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects when the Authorization header is supplied as an array', async () => {
    const adapter = makeAdapter();
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });
    const req = makeRequest(['Bearer one', 'Bearer two']);

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('accepts a Bearer token with mixed-case scheme', async () => {
    const adapter = makeAdapter([makeSession()]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => new Date(T0.getTime() + ONE_MINUTE_MS),
    });
    const req = makeRequest('bEaReR sess-1');

    await asDirect(middleware)(req as unknown as FastifyRequest, noopReply);

    expect(req.user).toEqual({ id: 'user-1' });
    expect(req.userId).toBe('user-1');
  });
});

// ---------------------------------------------------------------------------
// Token lookup
// ---------------------------------------------------------------------------

describe('createSessionMiddleware — token lookup', () => {
  it('rejects when no session row matches the token hash', async () => {
    const adapter = makeAdapter([makeSession()]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });
    const req = makeRequest('Bearer not-a-known-hash');

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it('passes the hashed token to the adapter, not the raw token', async () => {
    const adapter = makeAdapter([makeSession()]);
    const findSpy = vi.spyOn(adapter, 'findByTokenHash');
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: (t) => `hashed:${t}`,
      clock: () => new Date(T0.getTime() + ONE_MINUTE_MS),
    });
    const req = makeRequest('Bearer raw-token');

    // The default fake adapter only knows the row by `sess-1`, so we
    // expect a rejection — but the assertion of interest is what
    // `findByTokenHash` was called with.
    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });

    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(findSpy).toHaveBeenCalledWith('hashed:raw-token');
  });
});

// ---------------------------------------------------------------------------
// Lifecycle rules
// ---------------------------------------------------------------------------

describe('createSessionMiddleware — lifecycle rules', () => {
  it('rejects revoked sessions (R6.8, R6.9)', async () => {
    const adapter = makeAdapter([
      makeSession({ revoked_at: new Date(T0.getTime() - ONE_MINUTE_MS) }),
    ]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });
    const req = makeRequest('Bearer sess-1');

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it('rejects when now is after absolute_expires_at (R6.5)', async () => {
    const expiresAt = new Date(T0.getTime() + 60 * ONE_MINUTE_MS);
    const adapter = makeAdapter([
      makeSession({ absolute_expires_at: expiresAt, last_seen_at: T0 }),
    ]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => new Date(expiresAt.getTime() + ONE_MINUTE_MS),
    });
    const req = makeRequest('Bearer sess-1');

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(adapter.updateCalls).toHaveLength(0);
  });

  it('rejects when now equals absolute_expires_at (boundary at-or-over)', async () => {
    const expiresAt = new Date(T0.getTime() + 60 * ONE_MINUTE_MS);
    const adapter = makeAdapter([
      makeSession({ absolute_expires_at: expiresAt, last_seen_at: T0 }),
    ]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => expiresAt,
    });
    const req = makeRequest('Bearer sess-1');

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects when the idle gap reaches 30 days (R6.5)', async () => {
    const adapter = makeAdapter([
      makeSession({
        last_seen_at: T0,
        // Push the absolute window far enough out that the only
        // active failure is the idle window.
        absolute_expires_at: new Date(
          T0.getTime() + SESSION_IDLE_WINDOW_MS + SESSION_BURST_DURATION_MS,
        ),
      }),
    ]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => new Date(T0.getTime() + SESSION_IDLE_WINDOW_MS),
    });
    const req = makeRequest('Bearer sess-1');

    await expect(
      asDirect(middleware)(req as unknown as FastifyRequest, noopReply),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('accepts an active session inside the burst and updates last_seen_at', async () => {
    const adapter = makeAdapter([makeSession({ last_seen_at: T0 })]);
    const now = new Date(T0.getTime() + 5 * ONE_MINUTE_MS);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => now,
    });
    const req = makeRequest('Bearer sess-1');

    await asDirect(middleware)(req as unknown as FastifyRequest, noopReply);

    expect(req.user).toEqual({ id: 'user-1' });
    expect(adapter.updateCalls).toHaveLength(1);
    const call = adapter.updateCalls[0]!;
    expect(call.sessionId).toBe('sess-1');
    expect(call.now.getTime()).toBe(now.getTime());
    // Inside the burst (< 30 minutes since last_seen), the absolute
    // expiry is preserved exactly.
    expect(call.absoluteExpiresAt.getTime()).toBe(
      T0.getTime() + SESSION_BURST_DURATION_MS,
    );
  });

  it('does NOT roll the burst when the idle gap is just under 30 minutes', async () => {
    const adapter = makeAdapter([makeSession({ last_seen_at: T0 })]);
    const now = new Date(T0.getTime() + SESSION_BURST_GAP_MS - 1);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => now,
    });
    const req = makeRequest('Bearer sess-1');

    await asDirect(middleware)(req as unknown as FastifyRequest, noopReply);

    const call = adapter.updateCalls[0]!;
    expect(call.absoluteExpiresAt.getTime()).toBe(
      T0.getTime() + SESSION_BURST_DURATION_MS,
    );
  });

  it('rolls the burst forward when the idle gap is exactly 30 minutes', async () => {
    const adapter = makeAdapter([makeSession({ last_seen_at: T0 })]);
    const now = new Date(T0.getTime() + SESSION_BURST_GAP_MS);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => now,
    });
    const req = makeRequest('Bearer sess-1');

    await asDirect(middleware)(req as unknown as FastifyRequest, noopReply);

    const call = adapter.updateCalls[0]!;
    expect(call.absoluteExpiresAt.getTime()).toBe(
      now.getTime() + SESSION_BURST_DURATION_MS,
    );
  });

  it('rolls the burst forward after a multi-hour idle gap (still under 30 days)', async () => {
    const adapter = makeAdapter([
      makeSession({
        last_seen_at: T0,
        // Burst originally would have ended 24h after T0; we are well
        // beyond that here, so without the rollover rule the request
        // would fail the absolute_expires_at check. The rollover is
        // applied BEFORE the burst-end check is rerun? No: the design
        // says the burst-end check uses the prior absolute_expires_at
        // and rollover only takes effect for *future* requests. The
        // case we test here keeps absolute_expires_at past `now` so
        // we observe a clean rollover.
        absolute_expires_at: new Date(T0.getTime() + 48 * 60 * ONE_MINUTE_MS),
      }),
    ]);
    const now = new Date(T0.getTime() + 4 * 60 * ONE_MINUTE_MS); // 4 hours
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => now,
    });
    const req = makeRequest('Bearer sess-1');

    await asDirect(middleware)(req as unknown as FastifyRequest, noopReply);

    const call = adapter.updateCalls[0]!;
    // The new burst window starts at `now`.
    expect(call.absoluteExpiresAt.getTime()).toBe(
      now.getTime() + SESSION_BURST_DURATION_MS,
    );
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('createSessionMiddleware — defaults', () => {
  it('defaults the clock to the system time when none is supplied', async () => {
    // Stage: pretend the session was just used a moment ago (according
    // to wall-clock time). We cannot stub the default clock, so we make
    // the test tolerant to a few-second skew.
    const justNow = new Date();
    const adapter = makeAdapter([
      makeSession({
        last_seen_at: new Date(justNow.getTime() - 5000),
        absolute_expires_at: new Date(
          justNow.getTime() + SESSION_BURST_DURATION_MS,
        ),
      }),
    ]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      // No `clock` override — exercise the default branch.
    });
    const req = makeRequest('Bearer sess-1');

    await asDirect(middleware)(req as unknown as FastifyRequest, noopReply);

    expect(req.user).toEqual({ id: 'user-1' });
    expect(adapter.updateCalls).toHaveLength(1);
    const call = adapter.updateCalls[0]!;
    // The recorded `now` must be within a generous skew window.
    expect(Math.abs(call.now.getTime() - Date.now())).toBeLessThan(5000);
  });
});

// ---------------------------------------------------------------------------
// End-to-end smoke through Fastify
// ---------------------------------------------------------------------------

describe('createSessionMiddleware — Fastify integration', () => {
  it('translates a rejected session to a 401 unauthorized envelope', async () => {
    const adapter = makeAdapter();
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });

    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get('/protected', { preHandler: middleware }, () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer nope' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: {
        code: 'unauthorized',
        message: 'Authentication is required.',
      },
    });
  });

  it('forwards request.user to the handler on success', async () => {
    const adapter = makeAdapter([makeSession()]);
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => new Date(T0.getTime() + ONE_MINUTE_MS),
    });

    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.get('/whoami', { preHandler: middleware }, async (request) => ({
      userId: request.user?.id,
      legacyUserId: request.userId,
    }));
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer sess-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: 'user-1', legacyUserId: 'user-1' });
  });

  it('throws an AppError instance (not a generic Error)', async () => {
    const adapter = makeAdapter();
    const middleware = createSessionMiddleware({
      db: adapter,
      hashToken: identityHash,
      clock: () => T0,
    });

    let captured: unknown;
    try {
      await asDirect(middleware)(
        makeRequest() as unknown as FastifyRequest,
        noopReply,
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(AppError);
    expect((captured as AppError).code).toBe('unauthorized');
  });
});
