/**
 * `POST /me/feedback` through `server.inject`: the real route plugin over the real repo on pg-mem (every migration
 * applied, real `users` rows), with a fake session pre-handler and a fixed clock.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 6.1, 6.2
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { feedbackSubmitInputSchema } from '@dwt/shared';
import { AppError } from '../../../errors/AppError.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import { buildMigratedDb, createSeeder, createTestPool, type Seeder, type TestPool } from '../../accountDeletion/__tests__/helpers.js';
import { createFeedbackRepo, type FeedbackRepo } from '../repo.js';
import { FEEDBACK_LIMIT_MESSAGE, FEEDBACK_PATH, feedbackRoutes } from '../routes.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');
const minutesAgo = (m: number): Date => new Date(NOW.getTime() - m * 60_000);
const CAPS = { perHour: 5, perDay: 20 };

describe('POST /me/feedback', () => {
  let test: TestPool;
  let seeder: Seeder;
  let realRepo: FeedbackRepo;
  let alice: string;
  let bob: string;
  let pending: string;
  let app: FastifyInstance;
  let logLines: string[];
  let repoOverride: Partial<FeedbackRepo>;

  async function addUser(email: string, state = 'active'): Promise<string> {
    const id = randomUUID();
    const schedule =
      state === 'active'
        ? {}
        : { scheduled_purge_at: new Date('2026-12-01T00:00:00Z'), deletion_requested_at: NOW, placeholder_id: randomUUID() };
    await seeder.insertRow('users', { id, email, deletion_state: state, ...schedule });
    return id;
  }

  async function seedFeedback(over: Record<string, unknown>): Promise<string> {
    const row = await seeder.insertRow('user_feedback', { kind: 'bug', message: 'seeded', contact_ok: false, ...over });
    return row['id'] as string;
  }

  async function allRows(): Promise<Record<string, unknown>[]> {
    return (await test.pool.query(`SELECT * FROM user_feedback ORDER BY created_at, id`)).rows as Record<string, unknown>[];
  }

  beforeAll(() => {
    test = createTestPool(buildMigratedDb());
    seeder = createSeeder(test.pool);
    realRepo = createFeedbackRepo(test.pool);
  });

  beforeEach(async () => {
    await test.pool.query(`DELETE FROM user_feedback`);
    await test.pool.query(`DELETE FROM users`);
    alice = await addUser('alice@example.com');
    bob = await addUser('bob@example.com');
    pending = await addUser('pending@example.com', 'pending_deletion');
    repoOverride = {};
    logLines = [];

    const tokens = new Map<string, string>([
      ['tok-alice', alice],
      ['tok-bob', bob],
      ['tok-pending', pending],
    ]);
    const requireSession: preHandlerHookHandler = async (request) => {
      const header = request.headers.authorization;
      const token = typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : '';
      const userId = tokens.get(token);
      if (userId === undefined) throw new AppError('unauthorized', 'Authentication is required.');
      request.userId = userId;
    };

    app = Fastify({
      logger: { level: 'info', stream: { write: (line: string) => void logLines.push(line) } },
    });
    registerErrorHandler(app);
    const repo = new Proxy(realRepo, {
      get: (target, prop: keyof FeedbackRepo) => repoOverride[prop] ?? target[prop],
    }) as FeedbackRepo;
    await app.register(
      feedbackRoutes({ repo, caps: CAPS, retentionDays: 90, requireSession, now: () => NOW }),
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (payload: unknown, token: string | null = 'tok-alice') =>
    app.inject({
      method: 'POST',
      url: FEEDBACK_PATH,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      payload: payload as object,
    });

  describe('auth and happy path', () => {
    it('401 without a session and stores nothing', async () => {
      const res = await post({ kind: 'bug', message: 'x' }, null);
      expect(res.statusCode).toBe(401);
      expect(await allRows()).toEqual([]);
    });

    it('201 { id } for a minimal body; the row belongs to the session user with status new and no email or device', async () => {
      const res = await post({ kind: 'bug', message: '  It crashed on Space Mountain  ' });
      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };
      const [row] = await allRows();
      expect(row).toMatchObject({
        id,
        user_id: alice,
        kind: 'bug',
        message: 'It crashed on Space Mountain',
        status: 'new',
        contact_ok: false,
        contact_email: null,
        app_version: null,
        platform: null,
        os_version: null,
      });
    });

    it('stores device info and the account email when the user opts in to both', async () => {
      const res = await post({
        kind: 'idea',
        message: 'Add a packing list',
        contactOk: true,
        device: { appVersion: '1.4.0', platform: 'android', osVersion: '14' },
      });
      expect(res.statusCode).toBe(201);
      const [row] = await allRows();
      expect(row).toMatchObject({
        kind: 'idea',
        contact_ok: true,
        contact_email: 'alice@example.com',
        app_version: '1.4.0',
        platform: 'android',
        os_version: '14',
      });
    });

    it('401 and nothing stored when the account is pending deletion', async () => {
      const res = await post({ kind: 'bug', message: 'x' }, 'tok-pending');
      expect(res.statusCode).toBe(401);
      expect(await allRows()).toEqual([]);
    });
  });

  describe('validation (400 validation_failed, nothing stored)', () => {
    const bad: [string, unknown][] = [
      ['empty message', { kind: 'bug', message: '' }],
      ['whitespace-only message', { kind: 'bug', message: '  \n ' }],
      ['message over 2000 characters', { kind: 'bug', message: 'a'.repeat(2001) }],
      ['unknown kind', { kind: 'complaint', message: 'x' }],
      ['missing kind', { message: 'x' }],
      ['unknown platform', { kind: 'bug', message: 'x', device: { appVersion: '1', platform: 'windows', osVersion: '1' } }],
      ['over-long appVersion', { kind: 'bug', message: 'x', device: { appVersion: 'v'.repeat(33), platform: 'ios', osVersion: '1' } }],
      ['partial device', { kind: 'bug', message: 'x', device: { appVersion: '1.0' } }],
      ['client-supplied user id', { kind: 'bug', message: 'x', userId: randomUUID() }],
      ['client-supplied email', { kind: 'bug', message: 'x', contactEmail: 'evil@example.com' }],
    ];
    for (const [name, payload] of bad) {
      it(`rejects ${name}`, async () => {
        const res = await post(payload);
        expect(res.statusCode).toBe(400);
        expect((res.json() as { error: { code: string } }).error.code).toBe('validation_failed');
        expect(await allRows()).toEqual([]);
      });
    }

    it('accepts exactly 2000 characters', async () => {
      expect((await post({ kind: 'other', message: 'a'.repeat(2000) })).statusCode).toBe(201);
    });

    it('the validation message names the field but never echoes the submitted value', async () => {
      const secret = 'hunter2-should-not-echo';
      const res = await post({ kind: secret, message: 'x' });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(secret);
      expect((res.json() as { error: { field?: string } }).error.field).toBe('kind');
    });
  });

  describe('per-user caps (429 rate_limit_exceeded)', () => {
    it('hour cap: cap - 1 recent submissions is accepted, cap is refused with nothing stored', async () => {
      for (let i = 0; i < CAPS.perHour - 1; i++) await seedFeedback({ user_id: alice, created_at: minutesAgo(10 + i) });
      expect((await post({ kind: 'bug', message: 'fifth' })).statusCode).toBe(201);
      const before = (await allRows()).length;
      expect(before).toBe(CAPS.perHour);

      const res = await post({ kind: 'bug', message: 'sixth' });
      expect(res.statusCode).toBe(429);
      const err = (res.json() as { error: { code: string; message: string } }).error;
      expect(err.code).toBe('rate_limit_exceeded');
      expect(err.message).toBe(FEEDBACK_LIMIT_MESSAGE);
      expect((await allRows()).length).toBe(before);
    });

    it('day cap: 19 earlier-today submissions is accepted, 20 is refused', async () => {
      // Older than an hour so the hour cap is not what trips.
      for (let i = 0; i < CAPS.perDay - 1; i++) await seedFeedback({ user_id: alice, created_at: minutesAgo(120 + i) });
      expect((await post({ kind: 'idea', message: 'twentieth' })).statusCode).toBe(201);
      const res = await post({ kind: 'idea', message: 'twenty-first' });
      expect(res.statusCode).toBe(429);
      expect((res.json() as { error: { code: string } }).error.code).toBe('rate_limit_exceeded');
    });

    it('submissions older than 24 hours do not count', async () => {
      for (let i = 0; i < 30; i++) await seedFeedback({ user_id: alice, created_at: minutesAgo(24 * 60 + 5 + i) });
      expect((await post({ kind: 'bug', message: 'fresh start' })).statusCode).toBe(201);
    });

    it('another user hitting the cap does not limit this user', async () => {
      for (let i = 0; i < CAPS.perHour; i++) await seedFeedback({ user_id: bob, created_at: minutesAgo(i + 1) });
      expect((await post({ kind: 'bug', message: 'bob is capped' }, 'tok-bob')).statusCode).toBe(429);
      expect((await post({ kind: 'bug', message: 'alice is fine' }, 'tok-alice')).statusCode).toBe(201);
    });

    it('a rejected (400) submission does not consume the cap', async () => {
      for (let i = 0; i < CAPS.perHour + 3; i++) await post({ kind: 'nope', message: 'x' });
      expect((await post({ kind: 'bug', message: 'ok' })).statusCode).toBe(201);
    });
  });

  describe('retention prune', () => {
    it('removes old resolved rows after an accepted submission and never removes new or triaged rows', async () => {
      const longAgo = minutesAgo(200 * 24 * 60);
      const oldResolved = await seedFeedback({ user_id: bob, status: 'resolved', created_at: longAgo, status_changed_at: longAgo });
      const recentResolved = await seedFeedback({ user_id: bob, status: 'resolved', status_changed_at: minutesAgo(5 * 24 * 60) });
      const oldNew = await seedFeedback({ user_id: bob, status: 'new', created_at: longAgo, status_changed_at: longAgo });
      const oldTriaged = await seedFeedback({ user_id: bob, status: 'triaged', created_at: longAgo, status_changed_at: longAgo });

      expect((await post({ kind: 'bug', message: 'trigger prune' })).statusCode).toBe(201);
      const ids = new Set((await allRows()).map((r) => r['id'] as string));
      expect(ids.has(oldResolved)).toBe(false);
      expect(ids.has(recentResolved)).toBe(true);
      expect(ids.has(oldNew)).toBe(true);
      expect(ids.has(oldTriaged)).toBe(true);
    });

    it('does not prune when the submission is refused (cap)', async () => {
      const longAgo = minutesAgo(200 * 24 * 60);
      const oldResolved = await seedFeedback({ user_id: bob, status: 'resolved', created_at: longAgo, status_changed_at: longAgo });
      for (let i = 0; i < CAPS.perHour; i++) await seedFeedback({ user_id: alice, created_at: minutesAgo(i + 1) });
      expect((await post({ kind: 'bug', message: 'refused' })).statusCode).toBe(429);
      expect((await allRows()).some((r) => r['id'] === oldResolved)).toBe(true);
    });

    it('a failing prune still returns 201 with the row stored, and logs no user content', async () => {
      repoOverride = {
        pruneResolved: async () => {
          throw new Error('boom: secret-message-body');
        },
      };
      const res = await post({ kind: 'bug', message: 'still accepted' });
      expect(res.statusCode).toBe(201);
      expect((await allRows()).map((r) => r['message'])).toEqual(['still accepted']);
      const logged = logLines.join('\n');
      expect(logged).toContain('feedback prune failed');
      expect(logged).not.toContain('secret-message-body');
    });
  });

  describe('privacy of logs', () => {
    it('never logs the message, the contact email or the device values', async () => {
      const message = 'UNIQUE-MESSAGE-TEXT-7f3a';
      const res = await post({
        kind: 'bug',
        message,
        contactOk: true,
        device: { appVersion: '9.9.9-uniq', platform: 'ios', osVersion: '99.99-uniq' },
      });
      expect(res.statusCode).toBe(201);
      const logged = logLines.join('\n');
      expect(logged.length).toBeGreaterThan(0);
      for (const needle of [message, 'alice@example.com', '9.9.9-uniq', '99.99-uniq']) {
        expect(logged, needle).not.toContain(needle);
      }
    });

    it('also logs nothing sensitive when validation fails', async () => {
      const message = 'x'.repeat(2001) + 'UNIQUE-TAIL-91bc';
      expect((await post({ kind: 'bug', message })).statusCode).toBe(400);
      expect(logLines.join('\n')).not.toContain('UNIQUE-TAIL-91bc');
    });
  });

  it('the route accepts the shared schema contract (a valid shared body is a 201)', async () => {
    const body = feedbackSubmitInputSchema.parse({ kind: 'other', message: 'contract', device: { appVersion: '1.0.0', platform: 'web', osVersion: '1' } });
    expect((await post(body)).statusCode).toBe(201);
  });
});
