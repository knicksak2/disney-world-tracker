/**
 * Tests for Sweep Cron Route (Task 9.3).
 *
 * Exercises:
 * - POST /internal/photos/sweep/run
 * - HEAD /internal/photos/sweep/run
 * - Missing x-cron-secret returns 401
 * - Wrong x-cron-secret returns 401
 * - Correct secret returns 202 and starts the sweep for POST and HEAD
 * - Second call while in-flight returns 202 with status: 'skipped', reason: 'in_flight'
 * - Constant-time secret matching logic
 *
 * Implements: Task 9.3
 * Validates: Requirements 19.1, 19.2
 */

import fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { registerErrorHandler } from '../../../errors/handler.js';
import { sweepCronRoute, secretMatches } from '../sweepCronRoute.js';
import type { SweepRunner } from '../sweep.js';

describe('Sweep Cron Route (Task 9.3)', () => {
  const CRON_SECRET = 'correct-cron-secret-12345';

  function createTestServer(runnerOverrides?: Partial<SweepRunner>) {
    let inFlight = false;
    const defaultRunner: SweepRunner = {
      tryStart: vi.fn(() => {
        if (inFlight) {
          return { started: false as const, reason: 'in_flight' as const };
        }
        inFlight = true;
        return { started: true as const };
      }),
      runOnce: vi.fn(),
      ...runnerOverrides,
    };

    const app = fastify();
    registerErrorHandler(app);

    app.register(sweepCronRoute, {
      sweepRunner: defaultRunner,
      cronSecret: CRON_SECRET,
    });

    return { app, runner: defaultRunner, resetInFlight: () => { inFlight = false; } };
  }

  describe('secretMatches helper', () => {
    it('returns false for empty, missing, or non-string inputs', () => {
      expect(secretMatches(undefined, CRON_SECRET)).toBe(false);
      expect(secretMatches(null, CRON_SECRET)).toBe(false);
      expect(secretMatches(123, CRON_SECRET)).toBe(false);
      expect(secretMatches('', CRON_SECRET)).toBe(false);
      expect(secretMatches(CRON_SECRET, '')).toBe(false);
    });

    it('returns true when values match and false when they differ', () => {
      expect(secretMatches(CRON_SECRET, CRON_SECRET)).toBe(true);
      expect(secretMatches('wrong-secret', CRON_SECRET)).toBe(false);
      expect(secretMatches(CRON_SECRET, 'wrong-secret')).toBe(false);
    });
  });

  describe('POST /internal/photos/sweep/run', () => {
    it('returns 401 when x-cron-secret header is missing', async () => {
      const { app, runner } = createTestServer();
      await app.ready();

      const res = await app.inject({
        method: 'POST',
        url: '/internal/photos/sweep/run',
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
      expect(runner.tryStart).not.toHaveBeenCalled();
    });

    it('returns 401 when x-cron-secret header is incorrect', async () => {
      const { app, runner } = createTestServer();
      await app.ready();

      const res = await app.inject({
        method: 'POST',
        url: '/internal/photos/sweep/run',
        headers: { 'x-cron-secret': 'bad-secret' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
      expect(runner.tryStart).not.toHaveBeenCalled();
    });

    it('returns 202 with status: "accepted" and starts the runner when secret matches', async () => {
      const { app, runner } = createTestServer();
      await app.ready();

      const res = await app.inject({
        method: 'POST',
        url: '/internal/photos/sweep/run',
        headers: { 'x-cron-secret': CRON_SECRET },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'accepted' });
      expect(runner.tryStart).toHaveBeenCalledTimes(1);
    });

    it('returns 202 with status: "skipped" and reason: "in_flight" when sweep is already running', async () => {
      const { app, runner } = createTestServer();
      await app.ready();

      // First run succeeds
      const res1 = await app.inject({
        method: 'POST',
        url: '/internal/photos/sweep/run',
        headers: { 'x-cron-secret': CRON_SECRET },
      });
      expect(res1.statusCode).toBe(202);
      expect(res1.json()).toEqual({ status: 'accepted' });

      // Second run is rejected because inFlight = true
      const res2 = await app.inject({
        method: 'POST',
        url: '/internal/photos/sweep/run',
        headers: { 'x-cron-secret': CRON_SECRET },
      });
      expect(res2.statusCode).toBe(202);
      expect(res2.json()).toEqual({ status: 'skipped', reason: 'in_flight' });
      expect(runner.tryStart).toHaveBeenCalledTimes(2);
    });
  });

  describe('HEAD /internal/photos/sweep/run', () => {
    it('returns 401 when x-cron-secret header is missing', async () => {
      const { app, runner } = createTestServer();
      await app.ready();

      const res = await app.inject({
        method: 'HEAD',
        url: '/internal/photos/sweep/run',
      });

      expect(res.statusCode).toBe(401);
      expect(runner.tryStart).not.toHaveBeenCalled();
    });

    it('returns 401 when x-cron-secret header is incorrect', async () => {
      const { app, runner } = createTestServer();
      await app.ready();

      const res = await app.inject({
        method: 'HEAD',
        url: '/internal/photos/sweep/run',
        headers: { 'x-cron-secret': 'bad-secret' },
      });

      expect(res.statusCode).toBe(401);
      expect(runner.tryStart).not.toHaveBeenCalled();
    });

    it('returns 202 with empty body and starts runner when secret matches', async () => {
      const { app, runner } = createTestServer();
      await app.ready();

      const res = await app.inject({
        method: 'HEAD',
        url: '/internal/photos/sweep/run',
        headers: { 'x-cron-secret': CRON_SECRET },
      });

      expect(res.statusCode).toBe(202);
      expect(res.body).toBe('');
      expect(runner.tryStart).toHaveBeenCalledTimes(1);
    });
  });
});
