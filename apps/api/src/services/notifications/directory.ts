/**
 * Notification directory lookups (task 15.1).
 *
 * Small pool-backed resolvers the Notification_Service uses to turn ids in a
 * {@link ShareDeliveredEvent} into human-readable notification text without
 * coupling the service to a concrete repo:
 *
 *   - {@link createSenderDisplayNameResolver} reads a sending User's display
 *     name from `profiles` for the notification title (R7.2);
 *   - {@link createExperienceNameResolver} reads a referenced Experience's name
 *     from `experiences` for the content label (R7.3).
 *
 * Both return `null` on a missing row so the service can fall back to a neutral
 * label (it never fabricates disclosure). They are exposed as plain function
 * factories so `composeServices.ts` (task 16.1) can wire them — or substitute
 * the existing catalog repo's `getExperience` — without this module importing
 * the whole catalog surface.
 */

import type { DbPool } from '../../db/pool.js';

/**
 * Build a resolver that returns a User's `display_name` from `profiles`, or
 * `null` when the User has no profile row (R7.2).
 */
export function createSenderDisplayNameResolver(
  pool: DbPool,
): (senderId: string) => Promise<string | null> {
  return async (senderId: string): Promise<string | null> => {
    const result = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM profiles WHERE user_id = $1`,
      [senderId],
    );
    return result.rows[0]?.display_name ?? null;
  };
}

/**
 * Build a resolver that returns an Experience's `name` from `experiences`, or
 * `null` when the Experience cannot be found (R7.3). The service truncates the
 * name to 100 characters, so this returns it untruncated.
 */
export function createExperienceNameResolver(
  pool: DbPool,
): (experienceId: string) => Promise<string | null> {
  return async (experienceId: string): Promise<string | null> => {
    const result = await pool.query<{ name: string }>(
      `SELECT name FROM experiences WHERE id = $1`,
      [experienceId],
    );
    return result.rows[0]?.name ?? null;
  };
}
