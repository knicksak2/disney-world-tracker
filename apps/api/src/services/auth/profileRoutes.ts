/**
 * Auth_Service profile and avatar routes.
 *
 * Exports a Fastify plugin that registers the three Profile-related
 * endpoints from design.md "Auth_Service":
 *
 *   - `PATCH /me/profile`           — update display name (R7.2, R7.5, R7.6)
 *   - `PUT   /me/profile/avatar`    — choose an avatar preset (R7.3)
 *   - `GET   /users/:userId/profile` — view a Profile (R7.1, R7.4, R7.8)
 *
 * Avatars are a fixed set of original Disney-themed illustrations bundled with
 * the client; the Profile stores only the chosen *preset id* (or `null`). The
 * avatar route therefore takes a small JSON body and validates the id against
 * the shared allowlist — there is no upload, object storage, or multipart.
 *
 * The plugin is **dependency-injected**: it receives the database pool and an
 * authentication pre-handler via `ProfileRoutesOptions`. This decouples the
 * routes from the session middleware (task 6.2) and from process-wide
 * singletons, so unit and integration tests can wire fakes without
 * monkey-patching modules.
 *
 * Authorization:
 *   - `PATCH /me/profile` and `PUT /me/profile/avatar` require an
 *     authenticated session; the pre-handler must set `request.userId`.
 *   - `GET /users/:userId/profile` requires the requester to be either the
 *     Profile owner OR an accepted Friend of the owner. Per R7.8, denied
 *     reads emit **no** analytics, audit, or telemetry events. The
 *     handler therefore goes out of its way to:
 *       a) issue the friendship lookup before any logging would occur,
 *       b) throw `AppError('profile_forbidden')` immediately on a deny,
 *          which the global error hook handles via `info`-level logging
 *          *only when the error is actually thrown*. The route itself
 *          never calls `req.log.info` or any analytics emitter on the
 *          deny path. (See design.md "Security and Privacy Notes".)
 *
 * Validates: Requirements R7.1, R7.2, R7.3, R7.4, R7.5, R7.6, R7.7, R7.8.
 */

import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from 'fastify';

import {
  profileAvatarInputSchema,
  profileDisplayNameInputSchema,
  type AvatarPresetId,
  type ProfileDTO,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertOwnerOrFriend } from '../friends/ownerOrFriend.js';
import { computePercent } from '../stats/computePercent.js';

// ---------------------------------------------------------------------------
// Plugin option surface
// ---------------------------------------------------------------------------

/**
 * Options accepted by the `profileRoutes` plugin.
 *
 * Every dependency is passed in explicitly to keep the plugin trivially
 * testable. The session pre-handler in particular is supplied as a hook so
 * that this module never has to import the (still-in-progress) session
 * middleware directly.
 */
export interface ProfileRoutesOptions {
  /** Database pool used for profile reads/writes and the friendship check. */
  readonly pool: DbPool;
  /**
   * Pre-handler that authenticates the request and assigns
   * `request.userId`. Subsequent handlers in this plugin assume
   * `request.userId` is set; if it is missing, a 401 is raised.
   */
  readonly requireAuth: preHandlerHookHandler;
}

// ---------------------------------------------------------------------------
// Module augmentation
// ---------------------------------------------------------------------------
//
// `request.userId` is the contract between the auth pre-handler and these
// routes. We declare it here so handlers can read it with a typed property.

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ProfileRow {
  user_id: string;
  display_name: string;
  avatar_preset: string | null;
}

/**
 * Read the requesting user's id from the request, raising `unauthorized`
 * if the session pre-handler did not supply one. We surface this as a
 * dedicated error rather than relying on truthy access because
 * `request.userId` is typed as `string | undefined` — silent coercion to
 * an empty user id would be a much subtler bug.
 */
function getRequesterId(userId: string | undefined): string {
  if (!userId) {
    throw new AppError('unauthorized', 'Request is not authenticated.');
  }
  return userId;
}

/**
 * Compute the user's overall completion percentage by counting their
 * Completion rows over the count of currently-active Experiences. Mirrors
 * the per-Park / per-Category formula from R3.1 by reusing
 * `computePercent` so the rounding and `[0.0, 100.0]` clamp behave
 * identically across endpoints. R3.6 (zero-denominator → 0.0) is
 * automatically satisfied because `computePercent` returns `0.0` when
 * `denominator === 0`.
 */
async function getOverallCompletionPercent(
  pool: DbPool,
  userId: string,
): Promise<number> {
  const result = await pool.query<{ completed: string; total: string }>(
    `SELECT
       (SELECT COUNT(*)::bigint FROM completions c
          JOIN experiences e ON e.id = c.experience_id
          WHERE c.user_id = $1 AND e.active = TRUE) AS completed,
       (SELECT COUNT(*)::bigint FROM experiences WHERE active = TRUE) AS total
    `,
    [userId],
  );
  const row = result.rows[0];
  // pg returns COUNT() as a string for `bigint`; parse explicitly.
  const completed = row ? Number.parseInt(row.completed, 10) : 0;
  const total = row ? Number.parseInt(row.total, 10) : 0;
  return computePercent(completed, total);
}

/**
 * Build a `ProfileDTO` from a `profiles` row plus a freshly-computed
 * completion percentage. Centralized so both `PATCH /me/profile` and
 * `GET /users/:userId/profile` return identically-shaped responses.
 */
function toProfileDTO(row: ProfileRow, overallCompletionPercent: number): ProfileDTO {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    // The column is constrained to the known preset ids by a DB CHECK, so a
    // non-null value is always a valid `AvatarPresetId`.
    avatarPreset: row.avatar_preset as AvatarPresetId | null,
    overallCompletionPercent,
  };
}

/**
 * Look up the profile row for `userId`, returning `null` when the user has
 * no profile (which should not happen for live accounts because every
 * registration creates one, but the read path defends against it anyway).
 */
async function loadProfileRow(
  pool: DbPool,
  userId: string,
): Promise<ProfileRow | null> {
  const result = await pool.query<ProfileRow>(
    'SELECT user_id, display_name, avatar_preset FROM profiles WHERE user_id = $1',
    [userId],
  );
  return result.rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin registering the Profile/avatar endpoints. Register with:
 *
 * ```ts
 * await app.register(profileRoutes, { pool, requireAuth });
 * ```
 */
export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (
  app: FastifyInstance,
  opts: ProfileRoutesOptions,
) => {
  const { pool, requireAuth } = opts;

  // -----------------------------------------------------------------------
  // PATCH /me/profile — display-name update
  // -----------------------------------------------------------------------
  app.patch(
    '/me/profile',
    { preHandler: requireAuth },
    async (request) => {
      const userId = getRequesterId(request.userId);

      const parsed = profileDisplayNameInputSchema.safeParse(request.body);
      if (!parsed.success) {
        // R7.6: empty / whitespace-only / over-length names are rejected
        // with `display_name_invalid`; the prior name is preserved because
        // we never reach the UPDATE statement below.
        throw new AppError(
          'display_name_invalid',
          'Display name must be 1-50 characters with at least one non-whitespace character.',
          { field: 'displayName' },
        );
      }

      const { displayName } = parsed.data;
      const updated = await pool.query<ProfileRow>(
        `UPDATE profiles
            SET display_name = $1
          WHERE user_id = $2
        RETURNING user_id, display_name, avatar_preset`,
        [displayName, userId],
      );

      const row = updated.rows[0];
      if (!row) {
        // If for some reason the user has no profile row, surface as
        // unauthorized rather than 404 — the only legitimate way to reach
        // this state is to use a session for a deleted user.
        throw new AppError('unauthorized', 'No profile for the active session.');
      }

      const percent = await getOverallCompletionPercent(pool, userId);
      return toProfileDTO(row, percent);
    },
  );

  // -----------------------------------------------------------------------
  // PUT /me/profile/avatar — choose an avatar preset (R7.3)
  // -----------------------------------------------------------------------
  //
  // The body is `{ "avatarPreset": <preset id> | null }`. The id must be one
  // of the known presets (validated against the shared allowlist); `null`
  // clears the avatar back to the placeholder. An unknown id is rejected with
  // `avatar_invalid` so the DB never holds an id the client cannot render.
  app.put(
    '/me/profile/avatar',
    { preHandler: requireAuth },
    async (request) => {
      const userId = getRequesterId(request.userId);

      const parsed = profileAvatarInputSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(
          'avatar_invalid',
          'Avatar must be one of the available presets, or null to clear it.',
          { field: 'avatarPreset' },
        );
      }

      const { avatarPreset } = parsed.data;
      const updated = await pool.query<ProfileRow>(
        `UPDATE profiles
            SET avatar_preset = $1
          WHERE user_id = $2
        RETURNING user_id, display_name, avatar_preset`,
        [avatarPreset, userId],
      );

      const row = updated.rows[0];
      if (!row) {
        throw new AppError('unauthorized', 'No profile for the active session.');
      }

      const percent = await getOverallCompletionPercent(pool, userId);
      return toProfileDTO(row, percent);
    },
  );

  // -----------------------------------------------------------------------
  // GET /users/:userId/profile — owner-or-friend gated read
  // -----------------------------------------------------------------------
  app.get<{ Params: { userId: string } }>(
    '/users/:userId/profile',
    { preHandler: requireAuth },
    async (request) => {
      const requesterId = getRequesterId(request.userId);
      const ownerId = request.params.userId;

      // R7.8: do NOT log or otherwise record the viewing attempt before
      // the authorization check resolves. The check itself emits no
      // analytics events; on deny, we throw immediately and the route
      // returns. Successful reads are not analytics events either —
      // they are normal API responses logged by Fastify's own access log.
      await assertOwnerOrFriend(pool, requesterId, ownerId);

      const row = await loadProfileRow(pool, ownerId);
      if (!row) {
        // Treat "owner has no profile" as forbidden rather than 404 to
        // avoid leaking account existence to an authorized friend.
        throw new AppError('profile_forbidden', 'You may not view this profile.');
      }

      const percent = await getOverallCompletionPercent(pool, ownerId);
      return toProfileDTO(row, percent);
    },
  );
};

export default profileRoutes;
