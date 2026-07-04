/**
 * Push_Registration_Service HTTP routes (task 12.1).
 *
 * Wires the two endpoints from the design's Push_Registration_Service
 * "Endpoints" table (both behind `requireSession`):
 *
 *   POST   /me/push-registrations   register/refresh this device's token (R8.1, R8.2, R8.3, R8.5)
 *   DELETE /me/push-registrations   invalidate this device's registration (R8.4)
 *
 * `POST` body: `{ deviceId: string; expoPushToken: string }`. The repo upserts
 * on the physical `expo_push_token` — reassigning it to the requesting User and
 * marking it active so a token is active for exactly one User at a time (R8.3,
 * R8.5) — and on `(user_id, device_id)` so a device that rotates its token
 * replaces the old one (R8.2).
 *
 * `DELETE` body: `{ deviceId: string }` marks that device's registration
 * invalidated (R8.4). Invalidated registrations are excluded from delivery by
 * the repo's `listActiveTokensForUser` query (R8.6).
 *
 * Malformed input (a missing/blank device id or push token) surfaces as the
 * `push_registration_invalid` error code (R8.7); the mobile client treats it as
 * a registration failure it retries a bounded number of times before continuing
 * without an active registration.
 *
 * Validates: Requirements R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.7.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import { AppError } from '../../errors/AppError.js';
import type { PushRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `pushRoutes`. Each dependency is supplied explicitly so
 * unit tests can wire fakes without monkey-patching modules, mirroring the
 * Sharing_Service plugin convention.
 */
export interface PushRoutesOptions {
  /** Persistence surface from `./repo.ts`. */
  readonly repo: PushRepo;
  /**
   * Pre-handler that authenticates the request and assigns `request.userId`.
   * Reused on every route in this plugin.
   */
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/**
 * A stable device installation identifier. Trimmed and bounded to a sane
 * length; a blank or over-long value is malformed input (R8.7). The identifier
 * is opaque to the API (the client generates and persists it), so no structural
 * format beyond non-emptiness is imposed.
 */
const deviceIdSchema = z
  .string()
  .trim()
  .min(1, { message: 'push_registration_invalid' })
  .max(256, { message: 'push_registration_invalid' });

/**
 * An Expo push token (e.g. `ExponentPushToken[...]`). Trimmed and bounded; a
 * blank or over-long value is malformed input (R8.7). The exact Expo token
 * grammar is not re-validated here — the push provider is the authority on
 * token validity, and an unusable token is discovered and invalidated on the
 * delivery path (R7.6) rather than rejected at registration.
 */
const expoPushTokenSchema = z
  .string()
  .trim()
  .min(1, { message: 'push_registration_invalid' })
  .max(512, { message: 'push_registration_invalid' });

/** Body schema for `POST /me/push-registrations`. */
const registerBodySchema = z
  .object({
    deviceId: deviceIdSchema,
    expoPushToken: expoPushTokenSchema,
  })
  .strict();

/** Body schema for `DELETE /me/push-registrations`. */
const invalidateBodySchema = z
  .object({
    deviceId: deviceIdSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Push_Registration_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(pushRoutes({ repo, requireSession }));
 * ```
 */
export function pushRoutes(options: PushRoutesOptions): FastifyPluginAsync {
  const { repo, requireSession } = options;

  return async function pushRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -------------------------------------------------------------------
    // POST /me/push-registrations
    // -------------------------------------------------------------------
    app.post(
      '/me/push-registrations',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { deviceId, expoPushToken } = parseOrAppError(
          registerBodySchema,
          request.body,
        );
        const registration = await repo.register(
          userId,
          deviceId,
          expoPushToken,
        );
        reply.code(201);
        return {
          deviceId: registration.deviceId,
          expoPushToken: registration.expoPushToken,
          status: registration.status,
        };
      },
    );

    // -------------------------------------------------------------------
    // DELETE /me/push-registrations
    // -------------------------------------------------------------------
    app.delete(
      '/me/push-registrations',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { deviceId } = parseOrAppError(
          invalidateBodySchema,
          request.body,
        );
        // The result (whether an active registration existed) is intentionally
        // not surfaced: logout invalidation is idempotent and the client does
        // not block on it (R8.8). A 204 is returned whether or not a row was
        // transitioned so a repeated logout is indistinguishable from the first.
        await repo.invalidateDevice(userId, deviceId);
        reply.code(204);
        reply.send();
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read `request.userId` or raise `unauthorized` if the middleware skipped. */
function requireUser(request: FastifyRequest): string {
  const userId = request.userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Authentication is required.');
  }
  return userId;
}

/**
 * Run a Zod schema and translate any `ZodError` into an `AppError`.
 *
 * Every validation failure on this plugin's bodies collapses to
 * `push_registration_invalid` (R8.7): the only inputs are the device id and the
 * push token, and a malformed value for either is a registration failure the
 * client retries. The offending field name is carried in the envelope's
 * `field` slot for diagnostics.
 */
function parseOrAppError<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
): z.infer<S> {
  try {
    return schema.parse(input) as z.infer<S>;
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const message = 'Device id and Expo push token must be non-empty strings.';
  return field !== undefined
    ? new AppError('push_registration_invalid', message, { field })
    : new AppError('push_registration_invalid', message);
}
