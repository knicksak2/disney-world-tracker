/**
 * Visibility choke points for hand-written SQL (account-deletion R5.1).
 *
 * A person who is not `active` is invisible to everyone else. Reads that need an identity go
 * through the `profile_identity` view; friendship and trip-membership listings go through the other
 * two views; any other hand-written query that must see only active people writes its predicate
 * with `ACTIVE_USER_SQL`, so the predicate exists in exactly one place.
 */

/** Per-person identity: `public_id`, `display_name`, `avatar_preset`, `is_visible` (0064). */
export const PROFILE_IDENTITY_VIEW = 'profile_identity';
/** `friendships` rows whose two sides are both active (0064). */
export const ACTIVE_FRIENDSHIPS_VIEW = 'active_friendships';
/** `trip_memberships` rows of active users only (0064). */
export const ACTIVE_TRIP_MEMBERSHIPS_VIEW = 'active_trip_memberships';

export const VISIBILITY_VIEWS = [
  PROFILE_IDENTITY_VIEW,
  ACTIVE_FRIENDSHIPS_VIEW,
  ACTIVE_TRIP_MEMBERSHIPS_VIEW,
] as const;

import { DELETED_USER_DISPLAY_NAME } from '@dwt/shared';
import type { PoolClient } from 'pg';

import type { DbPool } from '../../db/pool.js';

const ALIAS_RE = /^[a-z_][a-z0-9_]*$/i;

export interface ResolvedIdentity {
  readonly publicId: string;
  readonly displayName: string;
  readonly avatarPreset: string | null;
  readonly isVisible: boolean;
}

/**
 * One read of `profile_identity` that maps ids to how the reader sees them. Accepts a real user id, a
 * pending account's alias (`public_id`) and a tombstone id, and returns the same identity under every key
 * that names the person. An id with no profile (a guest id, a removed row) comes back as
 * `{ publicId: id, displayName: 'Deleted user', avatarPreset: null, isVisible: false }` so a caller can
 * never print a raw id as a name. Used by TypeScript-assembled DTOs (money) where a SQL join per column
 * would be unwieldy (account-deletion R5.3, R12.10).
 */
export async function resolvePublicIds(
  db: DbPool | PoolClient,
  ids: readonly string[],
): Promise<ReadonlyMap<string, ResolvedIdentity>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, ResolvedIdentity>();
  if (unique.length > 0) {
    const res = await db.query<{
      user_id: string;
      public_id: string;
      display_name: string;
      avatar_preset: string | null;
      is_visible: boolean;
    }>(
      `SELECT user_id, public_id, display_name, avatar_preset, is_visible
         FROM profile_identity
        WHERE user_id = ANY($1::uuid[]) OR public_id = ANY($1::uuid[])`,
      [unique],
    );
    for (const row of res.rows) {
      const identity: ResolvedIdentity = {
        publicId: row.public_id,
        displayName: row.display_name,
        avatarPreset: row.avatar_preset,
        isVisible: row.is_visible,
      };
      out.set(row.user_id, identity);
      out.set(row.public_id, identity);
    }
  }
  for (const id of unique) {
    if (!out.has(id)) {
      out.set(id, { publicId: id, displayName: DELETED_USER_DISPLAY_NAME, avatarPreset: null, isVisible: false });
    }
  }
  return out;
}

/** SQL fragment `<alias>.deletion_state = 'active'`. `alias` must be a plain identifier. */
export function ACTIVE_USER_SQL(alias: string): string {
  if (!ALIAS_RE.test(alias)) {
    throw new RangeError(`ACTIVE_USER_SQL alias must be a plain SQL identifier, got ${JSON.stringify(alias)}`);
  }
  return `${alias}.deletion_state = 'active'`;
}
