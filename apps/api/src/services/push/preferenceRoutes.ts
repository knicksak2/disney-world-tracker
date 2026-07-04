/**
 * Notification preference store — HTTP routes (task 13.1).
 *
 * Wires the two endpoints from the design's "Notification preference store"
 * table:
 *
 *   GET /me/notification-preferences   read preference (default enabled) (R9.3, R9.7)
 *   PUT /me/notification-preferences   set enabled/disabled              (R9.4, R9.5, R9.8)
 *
 * `GET` returns `{ pushNotificationsEnabled: boolean }`, defaulting to `true`
 * when the User has never set the preference (R9.7). `PUT` validates the body
 * against the shared `notificationPreferenceInputSchema`, persists the value,
 * and returns the persisted DTO (R9.4, R9.5). When the value cannot be
 * persisted, the route surfaces an error envelope so the mobile client can
 * retain the previously persisted value and show a message (R9.8).
 *
 * The plugin is dependency-injected (repo + `requireSession`) following the
 * constructor-injected factory + `requireSession` conventions used across the
 * other services (see `services/sharing/routes.ts`).
 *
 * NOTE: This plugin is intentionally NOT wired into `composeServices.ts` /
 * `server.ts` here — that composition is task 16.1.
 *
 * Validates: Requirements 9.3, 9.4, 9.5, 9.7, 9.8.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError } from 'zod';

import { notificationPreferenceInputSchema } from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { NotificationPreferenceRepo } from './preferenceRepo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `notificationPreferenceRoutes`. Each dependency is
 * supplied explicitly so unit tests can wire fakes without monkey-patching
 * modules.
 */
export interface NotificationPreferenceRoutesOptions {
  /** Persistence surface from `./preferenceRepo.ts`. */
  readonly repo: NotificationPreferenceRepo;
  /**
   * Pre-handler that authenticates the request and assigns `request.userId`.
   * Reused on every route in this plugin.
   */
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the notification preference Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(notificationPreferenceRoutes({ repo, requireSession }));
 * ```
 */
export function notificationPreferenceRoutes(
  options: NotificationPreferenceRoutesOptions,
): FastifyPluginAsync {
  const { repo, requireSession } = options;

  return async function notificationPreferenceRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -------------------------------------------------------------------
    // GET /me/notification-preferences (R9.3, R9.7)
    // -------------------------------------------------------------------
    app.get(
      '/me/notification-preferences',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return repo.getPreference(userId);
      },
    );

    // -------------------------------------------------------------------
    // PUT /me/notification-preferences (R9.4, R9.5, R9.8)
    // -------------------------------------------------------------------
    app.put(
      '/me/notification-preferences',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { pushNotificationsEnabled } = parseBody(request.body);
        try {
          // R9.4/R9.5: persist and echo the stored value.
          return await repo.setPreference(userId, pushNotificationsEnabled);
        } catch (err) {
          // R9.8: on a persistence failure the API returns an error so the
          // client keeps its previously persisted value and shows a message.
          // An AppError (e.g. `unauthorized`) is a deliberate domain outcome
          // and is rethrown unchanged; anything else is a genuine persistence
          // failure collapsed to `internal_error` with the cause preserved
          // for logging (the global hook redacts it from the wire).
          if (err instanceof AppError) {
            throw err;
          }
          throw new AppError(
            'internal_error',
            'Could not save the notification preference.',
            { cause: err },
          );
        }
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
 * Validate the `PUT` body against the shared input schema, translating a
 * `ZodError` into a `validation_failed` `AppError`. Keeping validation on the
 * shared schema ensures the API and mobile client cannot drift on the wire
 * shape.
 */
function parseBody(input: unknown): { pushNotificationsEnabled: boolean } {
  try {
    return notificationPreferenceInputSchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field =
        issue && issue.path.length > 0
          ? issue.path.map(String).join('.')
          : 'pushNotificationsEnabled';
      throw new AppError(
        'validation_failed',
        'pushNotificationsEnabled must be a boolean.',
        { field },
      );
    }
    throw err;
  }
}
