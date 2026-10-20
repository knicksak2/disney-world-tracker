/**
 * Sweep cron route:
 * - POST /internal/photos/sweep/run
 * - HEAD /internal/photos/sweep/run
 *
 * Implements: Task 9.3
 * Validates: Requirements 19.1, 19.2
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../errors/AppError.js';
import type { SweepRunner } from './sweep.js';

export interface SweepCronRouteOptions {
  readonly sweepRunner: SweepRunner;
  readonly cronSecret: string;
}

export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0 || expected.length === 0) {
    return false;
  }
  const h1 = createHash('sha256').update(provided).digest();
  const h2 = createHash('sha256').update(expected).digest();
  return timingSafeEqual(h1, h2);
}

export const sweepCronRoute: FastifyPluginAsync<SweepCronRouteOptions> = async (
  app,
  options
) => {
  const { sweepRunner, cronSecret } = options;
  const SWEEP_CRON_PATH = '/internal/photos/sweep/run';

  const gateCronSecret = (request: FastifyRequest): void => {
    const provided = request.headers['x-cron-secret'];
    if (!secretMatches(provided, cronSecret)) {
      throw new AppError('unauthorized', 'Missing or invalid cron secret');
    }
  };

  // POST /internal/photos/sweep/run
  app.post(SWEEP_CRON_PATH, async (request, reply) => {
    gateCronSecret(request);
    if (!sweepRunner) {
      throw new AppError('internal_error', 'Sweep runner not configured');
    }
    const result = sweepRunner.tryStart();
    reply.code(202);
    return result.started
      ? { status: 'accepted' }
      : { status: 'skipped', reason: result.reason };
  });

  // HEAD /internal/photos/sweep/run
  app.head(SWEEP_CRON_PATH, async (request, reply) => {
    gateCronSecret(request);
    if (!sweepRunner) {
      throw new AppError('internal_error', 'Sweep runner not configured');
    }
    sweepRunner.tryStart();
    return reply.code(202).send();
  });
};
