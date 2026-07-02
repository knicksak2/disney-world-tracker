/**
 * Auth_Service profile and avatar routes.
 *
 * Exports a Fastify plugin that registers the three Profile-related
 * endpoints from design.md "Auth_Service":
 *
 *   - `PATCH /me/profile`           — update display name (R7.2, R7.5, R7.6)
 *   - `PUT   /me/profile/avatar`    — upload avatar (R7.3, R7.7)
 *   - `GET   /users/:userId/profile` — view a Profile (R7.1, R7.4, R7.8)
 *
 * The plugin is **dependency-injected**: it receives the database pool,
 * S3 client, bucket configuration, and an authentication pre-handler via
 * `ProfileRoutesOptions`. This decouples the routes from the session
 * middleware (task 6.2) and from process-wide singletons, so unit and
 * integration tests can wire fakes without monkey-patching modules.
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

import { randomUUID } from 'node:crypto';

import type { S3Client } from '@aws-sdk/client-s3';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from 'fastify';

import {
  profileDisplayNameInputSchema,
  type ProfileDTO,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { assertOwnerOrFriend } from '../friends/ownerOrFriend.js';
import { computePercent } from '../stats/computePercent.js';
import {
  MAX_AVATAR_BYTES,
  sniffAvatar,
  type AvatarMimeType,
} from './avatarValidation.js';
import {
  getAvatarPublicUrl,
  uploadAvatar,
} from './avatarStore.js';

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
  /** S3-compatible client for avatar uploads. */
  readonly s3Client: S3Client;
  /** Bucket name avatars are uploaded to. */
  readonly bucket: string;
  /** Public-facing endpoint URL used to render `avatarUrl` in the DTO. */
  readonly endpoint: string;
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
  avatar_url: string | null;
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
    avatarUrl: row.avatar_url,
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
    'SELECT user_id, display_name, avatar_url FROM profiles WHERE user_id = $1',
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
 * await app.register(profileRoutes, {
 *   pool, s3Client, bucket, endpoint, requireAuth,
 * });
 * ```
 *
 * The plugin registers `@fastify/multipart` in its own scope; if the host
 * has already registered it at a wider scope, register this plugin in a
 * separate `app.register` call rather than the global scope.
 */
export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (
  app: FastifyInstance,
  opts: ProfileRoutesOptions,
) => {
  const { pool, s3Client, bucket, endpoint, requireAuth } = opts;

  // Multipart is only used by the avatar upload route. Limit the per-file
  // size to MAX_AVATAR_BYTES so the request body is rejected at the
  // streaming boundary, before it is buffered into memory (R7.7).
  await app.register(multipart, {
    limits: {
      fileSize: MAX_AVATAR_BYTES,
      files: 1,
      fields: 0,
    },
  });

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
        RETURNING user_id, display_name, avatar_url`,
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
  // PUT /me/profile/avatar — multipart avatar upload
  // -----------------------------------------------------------------------
  app.put(
    '/me/profile/avatar',
    { preHandler: requireAuth },
    async (request) => {
      const userId = getRequesterId(request.userId);

      // The multipart parser yields a single file because we configured
      // `limits.files = 1`; missing file is treated as `avatar_invalid`.
      const file = await request.file();
      if (!file) {
        throw new AppError(
          'avatar_invalid',
          'Avatar upload requires a single image file.',
          { field: 'avatar' },
        );
      }

      // `toBuffer()` throws when the streamed body would exceed
      // `limits.fileSize`. We catch that specifically and translate to a
      // user-facing `avatar_invalid` per R7.7.
      let body: Buffer;
      try {
        body = await file.toBuffer();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new AppError(
            'avatar_invalid',
            `Avatar exceeds the ${MAX_AVATAR_BYTES}-byte size limit.`,
            { field: 'avatar', cause: err },
          );
        }
        throw err;
      }

      // Defense in depth: an oversize body could still arrive if the
      // limits config is bypassed (e.g. test wiring). Re-check explicitly.
      if (body.length === 0 || body.length > MAX_AVATAR_BYTES) {
        throw new AppError(
          'avatar_invalid',
          'Avatar must be between 1 byte and 5 MB.',
          { field: 'avatar' },
        );
      }

      // Magic-byte sniff (R7.3, R7.7). The `Content-Type` header is NOT
      // trusted: a malicious client can lie about it. We rely on the
      // sniffed type for both the storage `ContentType` and the DB
      // `avatar_mime` column so the type-confusion vector is closed.
      const sniffed = sniffAvatar(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
      if (!sniffed) {
        throw new AppError(
          'avatar_invalid',
          'Avatar must be a PNG or JPEG image.',
          { field: 'avatar' },
        );
      }

      const mime: AvatarMimeType = sniffed;
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const key = `avatars/${userId}/${randomUUID()}.${ext}`;

      // Upload first, then update the row. If the upload fails the DB row
      // remains pointing at the prior URL (R7.7 "preserve the prior avatar
      // image"). The previous object is intentionally not deleted here:
      // garbage collection of orphaned avatars is a separate, periodic
      // job so a failed mid-upload does not leave the user with neither an
      // old nor a new image.
      await uploadAvatar(s3Client, bucket, key, new Uint8Array(body), mime);

      const url = getAvatarPublicUrl(endpoint, bucket, key);
      const updated = await pool.query<ProfileRow>(
        `UPDATE profiles
            SET avatar_url = $1,
                avatar_mime = $2,
                avatar_size_bytes = $3
          WHERE user_id = $4
        RETURNING user_id, display_name, avatar_url`,
        [url, mime, body.length, userId],
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
