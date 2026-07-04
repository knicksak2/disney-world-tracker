/**
 * Friends_Service HTTP routes (task 7.2).
 *
 * Wires the six endpoints from the design's Friends_Service "Key
 * endpoints" table:
 *
 *   GET    /users/search?q=...                      user search (R8.1, R8.2)
 *   POST   /me/friend-requests                      send request (R8.3, R8.7, R8.8, R8.10)
 *   POST   /me/friend-requests/:id/accept           accept       (R8.4, R8.6)
 *   POST   /me/friend-requests/:id/decline          decline      (R8.5)
 *   GET    /me/friends                              list         (R8.9)
 *   DELETE /me/friends/:userId                      remove       (R8.6, R8.11)
 *
 * The plugin is dependency-injected:
 *
 *   - `repo`           — persistence surface from `./repo.ts`.
 *   - `requireSession` — pre-handler that authenticates the request and
 *                        assigns `request.userId` (task 6.2).
 *
 * Inputs are validated with the shared Zod primitives so the validation
 * rules cannot drift between the API and the mobile client. Domain
 * checks that require database state (self-target, unknown recipient,
 * duplicate request/friendship, missing friendship on remove) live in
 * the repo and surface here through `AppError` rejections.
 *
 * Validates: Requirements R8.1, R8.2, R8.3, R8.4, R8.5, R8.6, R8.7,
 *            R8.8, R8.9, R8.10, R8.11.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import {
  friendRequestInputSchema,
  searchQuerySchema,
  userSearchInputSchema,
  uuidSchema,
} from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { FriendsRepo } from './repo.js';

// ---------------------------------------------------------------------------
// FriendRequestReceived dispatch seam
// ---------------------------------------------------------------------------

/**
 * Event emitted after a Friend_Request is durably created (`sendRequest`
 * commits). Carries exactly what the Notification_Service needs to target and
 * compose a push without re-reading the `friend_requests` row: the recipient
 * to notify, the sender to name, and the request id for tap deep-linking.
 *
 * The type is declared here (rather than imported from the
 * Notification_Service) so the Friends_Service stays decoupled from the
 * notification wiring, mirroring the Sharing_Service's `ShareDeliveredNotice`.
 * It is structurally identical to the Notification_Service's
 * `FriendRequestReceivedEvent`, so the composition root can hand it straight
 * through.
 */
export interface FriendRequestReceivedNotice {
  readonly requestId: string;
  readonly senderId: string;
  readonly recipientId: string;
}

/**
 * Background dispatch port for {@link FriendRequestReceivedNotice}. It returns
 * `void` (not a promise) so the route handler cannot await — and therefore
 * cannot be blocked or failed by — the notification path. The port
 * implementation (wired in `composeServices.ts`) owns the fire-and-forget
 * scheduling and its own bounded retry; `POST /me/friend-requests` returns
 * `201` regardless of push outcome.
 */
export type FriendRequestReceivedDispatch = (
  event: FriendRequestReceivedNotice,
) => void;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `friendsRoutes`. Each dependency is supplied
 * explicitly so unit tests can wire fakes without monkey-patching
 * modules.
 */
export interface FriendsRoutesOptions {
  /** Persistence surface from `./repo.ts`. */
  readonly repo: FriendsRepo;
  /**
   * Pre-handler from task 6.2 that authenticates the request and
   * assigns `request.userId`. Reused on every route in this plugin.
   */
  readonly requireSession: preHandlerHookHandler;
  /**
   * Optional background dispatch invoked after a Friend_Request is created,
   * so the recipient receives a push notification. Fire-and-forget: the
   * request returns `201` regardless of push outcome. Omitted in unit tests
   * that don't exercise the notification seam.
   */
  readonly emitFriendRequestReceived?: FriendRequestReceivedDispatch;
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/**
 * `:id` path parameter for `accept`/`decline`. Friend_Request ids are
 * UUIDs (`gen_random_uuid()` per the migration).
 */
const requestIdParamsSchema = z.object({ id: uuidSchema }).strict();

/**
 * `:userId` path parameter for `DELETE /me/friends/:userId`.
 */
const userIdParamsSchema = z.object({ userId: uuidSchema }).strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Friends_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(
 *   friendsRoutes({ repo, requireSession }),
 * );
 * ```
 *
 * The factory closes over the options so the returned plugin's
 * signature stays the standard `FastifyPluginAsync` and Fastify can
 * register it without bespoke typing.
 */
export function friendsRoutes(
  options: FriendsRoutesOptions,
): FastifyPluginAsync {
  const { repo, requireSession, emitFriendRequestReceived } = options;

  return async function friendsRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -------------------------------------------------------------------
    // GET /users/search?q=...
    // -------------------------------------------------------------------
    app.get(
      '/users/search',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        const { q } = parseSearchQuery(request.query);
        const results = await repo.searchUsers(userId, q);
        return { results };
      },
    );

    // -------------------------------------------------------------------
    // POST /me/friend-requests
    // -------------------------------------------------------------------
    app.post(
      '/me/friend-requests',
      { preHandler: requireSession },
      async (request, reply) => {
        const senderId = requireUser(request);
        const body = parseOrAppError(friendRequestInputSchema, request.body);
        const dto = await repo.sendRequest(senderId, body.recipientId);
        // Fire-and-forget push to the recipient. The dispatch returns void and
        // owns its own error handling, so it never blocks or fails the 201.
        emitFriendRequestReceived?.({
          requestId: dto.id,
          senderId: dto.senderId,
          recipientId: dto.recipientId,
        });
        reply.code(201);
        return dto;
      },
    );

    // -------------------------------------------------------------------
    // POST /me/friend-requests/:id/accept
    // -------------------------------------------------------------------
    app.post<{ Params: { id: string } }>(
      '/me/friend-requests/:id/accept',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(requestIdParamsSchema, request.params);
        const friendship = await repo.acceptRequest(userId, id);
        if (!friendship) {
          // R8.4 + safety: the request either does not exist or is not
          // addressed to the caller. Both cases collapse to
          // `friendship_not_found` so the response cannot be used to
          // enumerate request ids that belong to other users.
          throw new AppError(
            'friendship_not_found',
            'Friend request not found.',
          );
        }
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // POST /me/friend-requests/:id/decline
    // -------------------------------------------------------------------
    app.post<{ Params: { id: string } }>(
      '/me/friend-requests/:id/decline',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { id } = parseOrAppError(requestIdParamsSchema, request.params);
        const removed = await repo.declineRequest(userId, id);
        if (!removed) {
          // Same rationale as accept: do not differentiate between
          // "no such id" and "wrong recipient".
          throw new AppError(
            'friendship_not_found',
            'Friend request not found.',
          );
        }
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // GET /me/friends
    // -------------------------------------------------------------------
    app.get(
      '/me/friends',
      { preHandler: requireSession },
      async (request) => {
        const userId = requireUser(request);
        return repo.listFriendsAndRequests(userId);
      },
    );

    // -------------------------------------------------------------------
    // DELETE /me/friends/:userId
    // -------------------------------------------------------------------
    app.delete<{ Params: { userId: string } }>(
      '/me/friends/:userId',
      { preHandler: requireSession },
      async (request, reply) => {
        const userId = requireUser(request);
        const { userId: otherUserId } = parseOrAppError(
          userIdParamsSchema,
          request.params,
        );
        const removed = await repo.removeFriend(userId, otherUserId);
        if (!removed) {
          // R8.11: a removal targeting a non-existent friendship is a
          // validation error. We surface the dedicated
          // `friendship_not_found` (404) so the client can distinguish
          // it from generic input errors.
          throw new AppError(
            'friendship_not_found',
            'No friendship exists with this user.',
          );
        }
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
 * Parse the `GET /users/search` query, translating Zod's
 * `search_query_length_invalid` issue message into the dedicated
 * domain error code (R8.2). Any other validation issue collapses to
 * `validation_failed` with a `field` pointer.
 *
 * `userSearchInputSchema` is `.strict()` so unknown query parameters
 * are rejected (e.g. a stray `limit=200` cannot bypass the 50-row cap).
 */
function parseSearchQuery(raw: unknown): { q: string } {
  try {
    return userSearchInputSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw zodErrorToAppError(err);
    }
    throw err;
  }
}

/**
 * Run `schema.parse` against `input` and translate Zod errors into the
 * uniform `AppError` envelope. Mirrors the helper used by the auth and
 * tracking route modules; intentionally duplicated to keep route
 * modules independent and dodge import cycles.
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

/**
 * Translate the first Zod issue into an `AppError`. Recognized issue
 * messages map to dedicated domain codes; everything else collapses to
 * `validation_failed` so unknown messages cannot accidentally produce a
 * misleading error code.
 */
function zodErrorToAppError(error: ZodError): AppError {
  const issue = error.issues[0];
  const field =
    issue && issue.path.length > 0
      ? issue.path.map(String).join('.')
      : undefined;
  const rawMessage = issue?.message ?? 'validation_failed';

  if (rawMessage === 'search_query_length_invalid') {
    return field !== undefined
      ? new AppError(
          'search_query_length_invalid',
          'Search query must be 1 to 100 characters.',
          { field },
        )
      : new AppError(
          'search_query_length_invalid',
          'Search query must be 1 to 100 characters.',
        );
  }

  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError('validation_failed', message, { field })
    : new AppError('validation_failed', message);
}

// `searchQuerySchema` is referenced indirectly via `userSearchInputSchema`;
// keep the import alive so a future refactor that drops the wrapper
// schema does not silently break R8.2 enforcement.
void searchQuerySchema;
