/**
 * Tracking_Service — Friend Completions read route (task 4.1).
 *
 * Registers the single new endpoint from the design's Tracking_Service
 * "Endpoints" table:
 *
 *   GET /users/:userId/completions   friend-or-self Completions list
 *
 * The endpoint mirrors the Auth_Service Profile read (`GET /users/:userId/
 * profile`): a UUID path param identifying the target User, gated by the
 * shared owner-or-friend authorization rule, returning the target's data.
 * It is the read-side counterpart to the per-Experience Completion routes,
 * but target-scoped: it returns up to 5,000 of the target's Completions over
 * Active Experiences (R4.1), each enriched with the target's Rating and the
 * body of a shareable Note.
 *
 * Authorization and disclosure:
 *   - `requireSession` runs as a pre-handler, so the session check is
 *     evaluated *before* the handler body and therefore before the
 *     owner-or-friend rule (R1.6); an absent/expired session yields
 *     `unauthorized` (401) regardless of the target.
 *   - `assertOwnerOrFriend(pool, requesterId, targetId)` runs before any data
 *     read, so a forbidden request short-circuits with an identical
 *     `profile_forbidden` (403) for the non-friend, pending-only,
 *     terminated-friendship, and unknown-target cases (R1.1, R1.2, R1.3, R1.5,
 *     R1.7) and records no viewing attempt (R1.4, enforced by the shared
 *     helper).
 *   - The `:userId` path param is parsed with `uuidSchema` before any DB
 *     access, translating a malformed id into `validation_failed` (400).
 *
 * The repo's single SQL statement already enforces the active-only filter,
 * rating/shareable-note projection, ordering, and 5,000-entry cap
 * (R4.2–R4.8); this route maps each `CompletionEntry` 1:1 onto a
 * `CompletionEntryDTO` and returns `{ entries }` (an empty array when the
 * target has no qualifying Completions, which the App renders as the empty
 * state, R4.10).
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 4.1, 4.2, 4.3, 4.4,
 * 4.5, 4.6, 4.7, 4.8.
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from 'fastify';
import { ZodError } from 'zod';

import type { CompletionEntryDTO, FriendCompletionsDTO } from '@dwt/shared';
import { uuidSchema } from '@dwt/shared';

import type { DbPool } from '../../../db/pool.js';
import { AppError } from '../../../errors/AppError.js';
import { assertOwnerOrFriend } from '../../friends/ownerOrFriend.js';
import type { CompletionEntry, FriendCompletionsRepo } from './repo.js';

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

/**
 * Options accepted by the `friendCompletionsRoutes` plugin.
 *
 * Every dependency is injected so the plugin is hermetic in tests, matching
 * the `statsRoutes` factory pattern:
 *
 *   - `repo`           — the Friend Completions persistence surface.
 *   - `pool`           — used only by `assertOwnerOrFriend` for the single
 *                        friendship lookup; passing it in here (vs. baking a
 *                        `friendsRepo` dependency) keeps the single SQL hop
 *                        visible at this layer, as in `statsRoutes`.
 *   - `requireSession` — pre-handler that authenticates the request and
 *                        assigns `request.userId`.
 */
export interface FriendCompletionsRoutesOptions {
  readonly repo: FriendCompletionsRepo;
  readonly pool: DbPool;
  readonly requireSession: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Build the Friend Completions Fastify plugin. Register it via:
 *
 * ```ts
 * await app.register(
 *   friendCompletionsRoutes({ repo, pool, requireSession }),
 * );
 * ```
 *
 * The factory closes over the options so the returned plugin keeps the
 * standard `FastifyPluginAsync` signature, matching `statsRoutes`.
 */
export function friendCompletionsRoutes(
  options: FriendCompletionsRoutesOptions,
): FastifyPluginAsync {
  const { repo, pool, requireSession } = options;

  return async function friendCompletionsRoutesPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    // -----------------------------------------------------------------
    // GET /users/:userId/completions — friend-or-self Completions list
    // -----------------------------------------------------------------
    app.get<{ Params: { userId: string } }>(
      '/users/:userId/completions',
      { preHandler: requireSession },
      async (request): Promise<FriendCompletionsDTO> => {
        const requesterId = getRequesterId(request.userId);
        const targetId = parseUserId(request.params.userId);

        // R1.* + R4.*: the friendship lookup runs before the completions
        // read so a forbidden request short-circuits without reading the
        // target's data and without writing any analytics record.
        await assertOwnerOrFriend(pool, requesterId, targetId);

        const rows = await repo.listCompletions(targetId);
        return { entries: rows.map(toCompletionEntryDTO) };
      },
    );
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the requesting user's id from the request, throwing `unauthorized`
 * if the session pre-handler did not supply one. Mirrors the helper in
 * `stats/routes.ts` and `auth/profileRoutes.ts`.
 */
function getRequesterId(userId: string | undefined): string {
  if (!userId) {
    throw new AppError('unauthorized', 'Request is not authenticated.');
  }
  return userId;
}

/**
 * Parse and validate the `:userId` path param as a UUID before any DB
 * access. Translates a Zod failure into `AppError('validation_failed', ...)`
 * with a `field` pointer, matching the query-parse helper in `stats/routes.ts`.
 */
function parseUserId(raw: unknown): string {
  try {
    return uuidSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AppError(
        'validation_failed',
        'Invalid value for "userId".',
        { field: 'userId' },
      );
    }
    throw err;
  }
}

/**
 * Project a repo `CompletionEntry` onto the shared `CompletionEntryDTO`. The
 * two shapes are structurally identical; this mapping makes the wire contract
 * explicit and keeps the route independent of the repo's internal type.
 */
function toCompletionEntryDTO(entry: CompletionEntry): CompletionEntryDTO {
  return {
    experienceId: entry.experienceId,
    experienceName: entry.experienceName,
    park: entry.park,
    areaType: entry.areaType,
    category: entry.category,
    completedOn: entry.completedOn,
    rating: entry.rating,
    sharedNote: entry.sharedNote,
  };
}
