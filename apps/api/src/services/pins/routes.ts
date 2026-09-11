/**
 * Pin_Service — `GET /me/pins` (the Pin Board read).
 *
 * Returns the caller's full Pin Board: every Series 1 Pin projected as
 * unlocked (with `awardedAt`) or locked (with clamped progress), plus the
 * whole-collection tier summary and totals (R3.1, R3.2). Optional `tier`,
 * `track`, and `unlocked` query filters narrow the returned `pins` list; the
 * summary/totals always describe the entire collection so the header counts do
 * not move as the grid is filtered (R3.3).
 *
 * The award path is NOT here — Pins are awarded synchronously by the mutating
 * actions (log / rating / note / rode-with confirm) via the injected
 * `awardPins` port. This route is read-only.
 *
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode, PinBoardDTO, PinTier, PinTrack } from '@dwt/shared';
import { PINS, PIN_TIERS, PIN_TRACKS } from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { PinRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface PinRoutesOptions {
  readonly repo: PinRepo;
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Query schema
// ---------------------------------------------------------------------------

const boardQuerySchema = z
  .object({
    tier: z.enum(PIN_TIERS).optional(),
    track: z.enum(PIN_TRACKS).optional(),
    // Accept the string form the query string carries; coerce to boolean.
    unlocked: z.enum(['true', 'false']).optional(),
  })
  .strict();

/** `:pinId` path parameter for the claim endpoint. Any non-empty string is
 *  accepted here — an id that does not resolve to any catalog Pin (or to an
 *  awarded one) is indistinguishable from an unmet Pin and surfaces as the
 *  same `pin_not_eligible` the route already returns for that case. */
const claimParamsSchema = z.object({ pinId: z.string().min(1) }).strict();

/** Static `pinId -> {tier, track}` lookup for filtering the projected board. */
const PIN_META: ReadonlyMap<string, { tier: PinTier; track: PinTrack }> = new Map(
  PINS.map((p) => [p.id, { tier: p.tier, track: p.track }]),
);

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function pinRoutes(options: PinRoutesOptions): FastifyPluginAsync {
  return async function pinRoutesPlugin(app: FastifyInstance): Promise<void> {
    app.get(
      '/me/pins',
      { preHandler: options.requireSession },
      async (request): Promise<PinBoardDTO> => {
        const userId = requireUser(request);
        const { tier, track, unlocked } = parseOrAppError(
          boardQuerySchema,
          request.query,
        );

        const board = await options.repo.getBoard(userId);

        // No filter → the board as-is (summary + all pins).
        if (tier === undefined && track === undefined && unlocked === undefined) {
          return board;
        }

        const wantUnlocked = unlocked === undefined ? undefined : unlocked === 'true';
        const pins = board.pins.filter((p) => {
          if (wantUnlocked !== undefined && p.unlocked !== wantUnlocked) return false;
          const meta = PIN_META.get(p.pinId);
          if (tier !== undefined && meta?.tier !== tier) return false;
          if (track !== undefined && meta?.track !== track) return false;
          return true;
        });

        // The tier summary and totals stay whole-collection (R3.2, R3.3); only
        // the returned pin list is narrowed by the filter.
        return { ...board, pins };
      },
    );

    // -----------------------------------------------------------------
    // POST /me/pins/:pinId/claim — manual claim (Requirement 20.3, 20.4)
    // -----------------------------------------------------------------
    // Claiming is a User-facing step layered on top of an already-awarded
    // Pin; it never awards a Pin itself. `not_awarded` means no `user_pins`
    // row exists yet, surfaced as `pin_not_eligible` (409) so the client
    // knows the Pin has not been earned. Claiming an already-claimed Pin is
    // NOT an error — it is a no-op returning the existing `claimedAt` with
    // `200`, so a retried/duplicate tap never re-fires a celebration.
    app.post(
      '/me/pins/:pinId/claim',
      { preHandler: options.requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { pinId } = parseOrAppError(claimParamsSchema, request.params);

        const result = await options.repo.claimPin(userId, pinId);
        if (result.status === 'not_awarded') {
          throw new AppError('pin_not_eligible', 'This pin has not been earned yet.');
        }
        return { pinId, claimedAt: result.claimedAt };
      },
    );

    // -----------------------------------------------------------------
    // POST / HEAD /internal/pins/reconcile — historical backfill
    // (Requirement 21.2, 21.3, 21.4)
    // -----------------------------------------------------------------
    // Mirrors `/internal/sampling/run` (apps/api/src/services/intelligence/
    // routes.ts): cron-secret-gated, replies 202 immediately, and runs
    // `reconcileAll` fire-and-forget so the caller never waits on however
    // long a full-catalog pass over every User takes. Errors are logged,
    // never surfaced to the caller. This is the ONLY path that invokes
    // reconciliation — `GET /me/pins` above remains strictly read-only.
    const assertCronSecret = (request: { headers: Record<string, unknown> }): void => {
      const authHeader = request.headers['x-cron-secret'];
      const expectedSecret = app.config.pins.reconcileCronSecret;
      if (!authHeader || authHeader !== expectedSecret) {
        throw new AppError('unauthorized', 'Missing or invalid cron secret');
      }
    };

    const kickOffReconcile = (): void => {
      options.repo.reconcileAll().catch((err: unknown) => {
        app.log.error({ err }, 'Pin reconciliation pass failed');
      });
    };

    app.post('/internal/pins/reconcile', async (request, reply) => {
      assertCronSecret(request);
      void reply.code(202).send({ status: 'accepted' });
      kickOffReconcile();
      return reply;
    });

    // HEAD variant so the keep-alive cron can hit this endpoint without a
    // body — a reply body can never exceed the 8KB the cron scheduler caps
    // at (see docs/hosting.md), regardless of how large a JSON ack would be.
    app.head('/internal/pins/reconcile', async (request, reply) => {
      assertCronSecret(request);
      void reply.code(202).send();
      kickOffReconcile();
      return reply;
    });
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

function parseOrAppError<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0 ? issue.path.map(String).join('.') : undefined;
      const code: ErrorCode = 'validation_failed';
      throw field !== undefined
        ? new AppError(code, `Invalid value for "${field}".`, { field })
        : new AppError(code, 'Invalid request.');
    }
    throw err;
  }
}
