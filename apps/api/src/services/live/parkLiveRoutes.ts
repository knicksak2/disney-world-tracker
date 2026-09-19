/**
 * ParkLive Fastify route plugin.
 * (Requirements 9.1, 9.5, design.md Section 10)
 *
 * Exposes GET /parks/:park/live:
 *   - Session-authenticated
 *   - Validates :park path parameter against the Park enum (400 validation_failed on mismatch)
 *   - Calls parkLiveService.getParkLive(park)
 *   - Returns { park, entries, retrievedAt, stale }
 *   - Propagates live_unavailable (503) through global AppError handler
 */

import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from 'fastify';
import { z, ZodError } from 'zod';
import { parkSchema, type Park } from '@dwt/shared';
import type { ParkLiveService } from './parkLive.js';
import { AppError } from '../../errors/AppError.js';

export interface ParkLiveRoutesOptions {
  readonly service: ParkLiveService;
  readonly requireSession: preHandlerHookHandler;
}

const parkParamSchema = z
  .object({
    park: parkSchema,
  })
  .strict();

export function parseParkParam(raw: unknown): { park: Park } {
  try {
    return parkParamSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = issue && issue.path.length > 0 ? issue.path.map(String).join('.') : 'park';
      throw new AppError('validation_failed', `Invalid value for "${field}".`, {
        field,
      });
    }
    throw err;
  }
}

export function parkLiveRoutes(
  options: ParkLiveRoutesOptions,
): FastifyPluginAsync {
  return async function parkLiveRoutesPlugin(app: FastifyInstance): Promise<void> {
    app.get(
      '/parks/:park/live',
      { preHandler: [options.requireSession] },
      async (request) => {
        const { park } = parseParkParam(request.params);
        const result = await options.service.getParkLive(park);
        return {
          park: result.park,
          entries: result.entries,
          retrievedAt: result.retrievedAt,
          stale: result.stale,
        };
      },
    );
  };
}
