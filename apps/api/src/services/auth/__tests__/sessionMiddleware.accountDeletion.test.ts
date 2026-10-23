/**
 * Session middleware defence for account deletion (account-deletion R4.8, R2.3), through the REAL production
 * adapter SQL (`makeSessionDbAdapter` from `composeServices.ts`) on pg-mem.
 *
 *  - an UNREVOKED session whose user is not `active` answers `401` (Property 24 regression: revocation is the real
 *    control, the middleware catches a failed or raced revocation);
 *  - `request.sessionId` is the session row's primary key.
 *
 * Feature: account-deletion, Property 24: A non-active account cannot hold a working session
 *
 * Validates: Requirements 3.2, 4.8, 2.3
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeSessionDbAdapter } from '../../../composeServices.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { buildMigratedDb, createTestPool } from '../../accountDeletion/__tests__/helpers.js';
import {
  createSessionMiddleware,
  type SessionDbAdapter,
  type SessionRow,
} from '../sessionMiddleware.js';
import { generateToken, hashToken } from '../sessionToken.js';

const USER = randomUUID();

async function buildApp(db: SessionDbAdapter): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.get(
    '/whoami',
    { preHandler: createSessionMiddleware({ db, hashToken }) },
    async (request) => ({ userId: request.userId, sessionId: request.sessionId }),
  );
  await app.ready();
  return app;
}

describe('session middleware through the real adapter SQL', () => {
  let app: FastifyInstance;
  let pool: ReturnType<typeof createTestPool>['pool'];
  let token: string;
  let sessionId: string;

  const setState = async (state: string): Promise<void> => {
    if (state === 'active') {
      await pool.query(
        `UPDATE users SET deletion_state = 'active', deletion_requested_at = NULL, scheduled_purge_at = NULL, placeholder_id = NULL WHERE id = $1`,
        [USER],
      );
      return;
    }
    await pool.query(
      `UPDATE users SET deletion_state = $2, deletion_requested_at = $3, scheduled_purge_at = $4, placeholder_id = $5 WHERE id = $1`,
      [USER, state, new Date('2026-05-01T00:00:00Z'), new Date('2026-05-31T00:00:00Z'), randomUUID()],
    );
  };

  const whoami = (): Promise<{ statusCode: number; json: () => { userId?: string; sessionId?: string } }> =>
    app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${token}` } }) as never;

  beforeEach(async () => {
    const t = createTestPool(buildMigratedDb());
    pool = t.pool;
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'u@example.com', 'h')`, [USER]);
    const pair = generateToken();
    token = pair.token;
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, created_at, last_seen_at, absolute_expires_at)
       VALUES ($1, $2, now(), now(), $3) RETURNING id`,
      [USER, pair.tokenHash, new Date(Date.now() + 3_600_000)],
    );
    sessionId = inserted.rows[0]!.id;
    app = await buildApp(makeSessionDbAdapter(pool));
  });

  afterEach(async () => {
    await app.close();
  });

  it('authorizes an active user and exposes the session row id as request.sessionId', async () => {
    const res = await whoami();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: USER, sessionId });
  });

  it.each(['pending_deletion', 'purging'] as const)(
    'answers 401 for an unrevoked session of a %s user',
    async (state) => {
      await setState(state);
      // The session row itself is untouched and unrevoked: only the user's state differs.
      const row = await pool.query<{ revoked_at: Date | null }>(`SELECT revoked_at FROM sessions WHERE id = $1`, [sessionId]);
      expect(row.rows[0]?.revoked_at).toBeNull();
      const res = await whoami();
      expect(res.statusCode).toBe(401);
      expect((res.json() as unknown as { error: { code: string } }).error.code).toBe('unauthorized');
    },
  );

  it('works again once the user is active (a restore needs no new row for the old session to matter)', async () => {
    await setState('pending_deletion');
    expect((await whoami()).statusCode).toBe(401);
    await setState('active');
    expect((await whoami()).statusCode).toBe(200);
  });

  it('still rejects a revoked session of an active user', async () => {
    await pool.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [sessionId]);
    expect((await whoami()).statusCode).toBe(401);
  });
});

describe('session middleware with an adapter that does not report deletion_state', () => {
  it('keeps working (the field is optional so existing fakes compile) and still sets request.sessionId', async () => {
    const row: SessionRow = {
      id: 'sess-1',
      user_id: 'user-1',
      absolute_expires_at: new Date(Date.now() + 3_600_000),
      last_seen_at: new Date(),
      revoked_at: null,
    };
    const app = await buildApp({
      findByTokenHash: async () => row,
      updateActivity: async () => undefined,
    });
    const res = await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: 'Bearer anything' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: 'user-1', sessionId: 'sess-1' });
    await app.close();
  });

  it('rejects a reported non-active state before it writes any activity', async () => {
    let wrote = false;
    const app = await buildApp({
      findByTokenHash: async () => ({
        id: 'sess-1',
        user_id: 'user-1',
        absolute_expires_at: new Date(Date.now() + 3_600_000),
        last_seen_at: new Date(),
        revoked_at: null,
        deletion_state: 'tombstone',
      }),
      updateActivity: async () => {
        wrote = true;
      },
    });
    const res = await app.inject({ method: 'GET', url: '/whoami', headers: { authorization: 'Bearer anything' } });
    expect(res.statusCode).toBe(401);
    expect(wrote).toBe(false);
    await app.close();
  });
});
