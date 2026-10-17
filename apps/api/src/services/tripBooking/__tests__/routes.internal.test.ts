/**
 * Property 25: Internal Cron Endpoint Tests
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fc from 'fast-check';
import { tripBookingRoutes } from '../routes.js';
import { registerErrorHandler } from '../../../errors/handler.js';
import type { ReminderRunner, StartResult, PassSummary } from '../runner.js';
import { secretMatches } from '../passGate.js';

class RecordingRunner implements ReminderRunner {
  public tryStartCalls = 0;
  public runPassCalls = 0;
  public nextResult: StartResult = { started: true };

  tryStart(): StartResult {
    this.tryStartCalls++;
    const res = this.nextResult;
    // Default to debounced on subsequent call
    this.nextResult = { started: false, reason: 'debounced' };
    return res;
  }

  async runPass(): Promise<PassSummary> {
    this.runPassCalls++;
    return { tripsEvaluated: 0, remindersClaimed: 0, remindersDispatched: 0 };
  }
}

describe('Internal Cron Endpoint — /internal/trip-booking-reminders/run (Property 25)', () => {
  const EXPECTED_SECRET = 'Exact-Super-Secret-Cron-Token-12345';
  let app: FastifyInstance;
  let runner: RecordingRunner;

  beforeEach(async () => {
    runner = new RecordingRunner();
    app = Fastify();
    registerErrorHandler(app);

    app.decorate('config', {
      tripBooking: {
        cronSecret: EXPECTED_SECRET,
      },
    } as any);

    await app.register(
      tripBookingRoutes({
        repo: {} as any,
        pool: {} as any,
        requireSession: async () => {},
        reminderRunner: runner,
      }),
    );
    await app.ready();
  });

  // Feature: trip-booking-timeline, Property 25: Only the exact configured secret authorises the reminder endpoint
  it('Property 25: secretMatches accepts only exact byte-matching strings', () => {
    fc.assert(
      fc.property(fc.string(), (candidate) => {
        const matches = secretMatches(candidate, EXPECTED_SECRET);
        expect(matches).toBe(candidate === EXPECTED_SECRET);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects missing or invalid secret with 401 without calling tryStart', async () => {
    const invalidHeaders = [
      undefined,
      '',
      '   ',
      'wrong-secret',
      EXPECTED_SECRET.toUpperCase(),
      EXPECTED_SECRET.toLowerCase(),
      ` ${EXPECTED_SECRET}`,
      `${EXPECTED_SECRET} `,
    ];

    for (const h of invalidHeaders) {
      runner.tryStartCalls = 0;

      const headers: Record<string, string> = {};
      if (h !== undefined) {
        headers['x-cron-secret'] = h;
      }

      const postRes = await app.inject({
        method: 'POST',
        url: '/internal/trip-booking-reminders/run',
        headers,
      });

      expect(postRes.statusCode).toBe(401);
      const postBody = postRes.json();
      expect(postBody.error.code).toBe('unauthorized');
      expect(runner.tryStartCalls).toBe(0);

      const headRes = await app.inject({
        method: 'HEAD',
        url: '/internal/trip-booking-reminders/run',
        headers,
      });

      expect(headRes.statusCode).toBe(401);
      expect(runner.tryStartCalls).toBe(0);
    }
  });

  it('POST with exact secret returns 202 accepted, then 202 skipped on next trigger', async () => {
    // 1. First trigger: started
    const res1 = await app.inject({
      method: 'POST',
      url: '/internal/trip-booking-reminders/run',
      headers: { 'x-cron-secret': EXPECTED_SECRET },
    });

    expect(res1.statusCode).toBe(202);
    expect(res1.json()).toEqual({ status: 'accepted' });
    expect(runner.tryStartCalls).toBe(1);

    // 2. Second trigger: runner returns debounced
    const res2 = await app.inject({
      method: 'POST',
      url: '/internal/trip-booking-reminders/run',
      headers: { 'x-cron-secret': EXPECTED_SECRET },
    });

    expect(res2.statusCode).toBe(202);
    expect(res2.json()).toEqual({ status: 'skipped', reason: 'debounced' });
    expect(runner.tryStartCalls).toBe(2);
  });

  it('HEAD with exact secret returns 202 with no body', async () => {
    const res = await app.inject({
      method: 'HEAD',
      url: '/internal/trip-booking-reminders/run',
      headers: { 'x-cron-secret': EXPECTED_SECRET },
    });

    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
    expect(runner.tryStartCalls).toBe(1);
  });
});
