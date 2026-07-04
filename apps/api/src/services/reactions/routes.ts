/**
 * Reaction_Service HTTP routes (task 14.1).
 *
 * Wires the three endpoints from the design's Reaction_Service "Endpoints"
 * table (design.md → "Reaction_Service"):
 *
 *   POST   /me/inbox/:shareId/reactions    submit/replace the caller's reaction
 *   DELETE /me/inbox/:shareId/reactions    remove the caller's reaction
 *   GET    /me/shares/:shareId/reactions   sender views reactions on their share
 *
 * All three routes authenticate through the shared `requireSession`
 * pre-handler, which assigns `request.userId` before the handler body runs.
 *
 * Validation and authorization split:
 *
 *   - The reaction *value* is validated against the closed
 *     `Reaction_Vocabulary` at this layer via `shareReactionValueSchema`
 *     (R11.2). A value outside the vocabulary is rejected with
 *     `reaction_invalid` (400) and never reaches the repo, so nothing is
 *     persisted (R11.3).
 *   - "Delivered to that recipient" authorization (R11.8) and "gated to the
 *     sender" authorization (R11.7) are enforced in the repo against the
 *     `share_recipients` / `shares` rows and surface as `reaction_forbidden`
 *     (403).
 *
 * Validates: Requirements 11.1, 11.4, 11.5, 11.6, 11.7, 11.8.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError, z } from 'zod';

import type { ErrorCode, ShareReactionDTO } from '@dwt/shared';
import { shareReactionValueSchema, uuidSchema } from '@dwt/shared';

import { AppError } from '../../errors/AppError.js';
import type { ReactionsRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by `reactionRoutes`. Each dependency is supplied
 * explicitly so unit tests can wire fakes without monkey-patching modules,
 * mirroring the other service plugins.
 */
export interface ReactionRoutesOptions {
  /** Persistence surface from `./repo.ts`. */
  readonly repo: ReactionsRepo;
  /**
   * Pre-handler from task 6.2 that authenticates the request and assigns
   * `request.userId`. Reused on every route in this plugin.
   */
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Local schemas
// ---------------------------------------------------------------------------

/** Path-param schema shared by all three routes. */
const shareParamsSchema = z.object({ shareId: uuidSchema }).strict();

/**
 * Body schema for `POST /me/inbox/:shareId/reactions`. The single `reaction`
 * field must be a member of the closed `Reaction_Vocabulary`; any other
 * value (including a free-text string) fails here and maps to
 * `reaction_invalid` (R11.2, R11.3).
 */
const reactionBodySchema = z
  .object({ reaction: shareReactionValueSchema })
  .strict();

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Reaction_Service Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(reactionRoutes({ repo, requireSession }));
 * ```
 */
export function reactionRoutes(
  options: ReactionRoutesOptions,
): FastifyPluginAsync {
  const { repo, requireSession } = options;

  return async function reactionRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -------------------------------------------------------------------
    // POST /me/inbox/:shareId/reactions
    // -------------------------------------------------------------------
    app.post<{ Params: { shareId: string } }>(
      '/me/inbox/:shareId/reactions',
      { preHandler: requireSession },
      async (request, reply) => {
        const recipientId = requireUser(request);
        const { shareId } = parseOrAppError(shareParamsSchema, request.params);
        const { reaction } = parseOrAppError(reactionBodySchema, request.body);

        // The repo enforces "delivered to that recipient" (R11.8) and
        // upserts at most one reaction per (share, recipient), replacing on
        // resubmit (R11.4, R11.5). It throws `reaction_forbidden` when the
        // caller is not a recipient.
        await repo.upsertReaction(shareId, recipientId, reaction);

        // 204 No Content: the reaction is stored; the sender's reactions
        // view and the recipient's inbox `myReaction` reflect it on read.
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // DELETE /me/inbox/:shareId/reactions
    // -------------------------------------------------------------------
    app.delete<{ Params: { shareId: string } }>(
      '/me/inbox/:shareId/reactions',
      { preHandler: requireSession },
      async (request, reply) => {
        const recipientId = requireUser(request);
        const { shareId } = parseOrAppError(shareParamsSchema, request.params);

        // Removal is idempotent (R11.6): deleting a reaction the caller does
        // not have is a no-op that still reports success.
        await repo.deleteReaction(shareId, recipientId);
        reply.code(204);
        reply.send();
      },
    );

    // -------------------------------------------------------------------
    // GET /me/shares/:shareId/reactions
    // -------------------------------------------------------------------
    app.get<{ Params: { shareId: string } }>(
      '/me/shares/:shareId/reactions',
      { preHandler: requireSession },
      async (request): Promise<ShareReactionDTO[]> => {
        const senderId = requireUser(request);
        const { shareId } = parseOrAppError(shareParamsSchema, request.params);

        // R11.7: gated to the Share's sender in the repo, which throws
        // `reaction_forbidden` for a non-sender or unknown Share. Each
        // reaction carries the reactor's display name.
        return repo.listReactionsForSender(shareId, senderId);
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
 * The reaction body's only domain-specific failure is a value outside the
 * closed `Reaction_Vocabulary`, which surfaces as `reaction_invalid` (R11.3).
 * Everything else — a malformed path UUID, an unexpected key — collapses to
 * `validation_failed` so unknown failures cannot masquerade as a domain code.
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

  // A failure on the `reaction` field means the submitted value is not a
  // member of the Reaction_Vocabulary (R11.3).
  if (field === 'reaction') {
    const code: ErrorCode = 'reaction_invalid';
    return new AppError(
      code,
      'Reaction must be one of the allowed values.',
      { field },
    );
  }

  const code: ErrorCode = 'validation_failed';
  const message = `Invalid value${field ? ` for "${field}"` : ''}.`;
  return field !== undefined
    ? new AppError(code, message, { field })
    : new AppError(code, message);
}
