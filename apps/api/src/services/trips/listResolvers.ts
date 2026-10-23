/**
 * The two cross-spec list ports injected into `createTripRepo` (`TripRepoDeps.resolveFoodList` and
 * `resolveExperienceList`), moved out of `composeServices.ts` unchanged in behavior so the pg-mem tests can run
 * them. Each returns the full `{ id, ownerId, visibility, name, itemCount, ownerDisplayName }` shape the Trip read
 * projection needs, which `experienceListRepo.resolveForAttachEligibility` does not return.
 *
 * A list whose owner is not an active account does not resolve (account-deletion R5.1): the Trip then projects
 * it as `available: false`, exactly as for a deleted list, and it resolves again after Restoration.
 */
import type { DbPool } from '../../db/pool.js';

interface ResolvedListRow {
  id: string;
  owner_id: string;
  visibility: 'private' | 'public';
  name: string;
  item_count: number;
  owner_display_name: string;
}

interface ResolvedList {
  readonly id: string;
  readonly ownerId: string;
  readonly visibility: 'private' | 'public';
  readonly name: string;
  readonly itemCount: number;
  readonly ownerDisplayName: string;
}

function toResolved(row: ResolvedListRow): ResolvedList {
  return {
    id: row.id,
    ownerId: row.owner_id,
    visibility: row.visibility,
    name: row.name,
    itemCount: row.item_count,
    ownerDisplayName: row.owner_display_name,
  };
}

export function resolveFoodListForTrip(pool: DbPool): (foodListId: string) => Promise<ResolvedList | null> {
  return async (foodListId) => {
    const res = await pool.query<ResolvedListRow>(
      `SELECT
         fl.id,
         fl.owner_id,
         fl.visibility,
         fl.name,
         COALESCE(ic.item_count, 0)::int AS item_count,
         COALESCE(p.display_name, 'User') AS owner_display_name
       FROM food_lists fl
       LEFT JOIN profile_identity p ON p.user_id = fl.owner_id
       LEFT JOIN (
         SELECT food_list_id, COUNT(*)::int AS item_count
         FROM food_lists_items
         GROUP BY food_list_id
       ) ic ON ic.food_list_id = fl.id
      WHERE fl.id = $1 AND COALESCE(p.is_visible, TRUE)`,
      [foodListId],
    );
    const row = res.rows[0];
    return row ? toResolved(row) : null;
  };
}

export function resolveExperienceListForTrip(pool: DbPool): (experienceListId: string) => Promise<ResolvedList | null> {
  return async (experienceListId) => {
    const res = await pool.query<ResolvedListRow>(
      `SELECT
         el.id,
         el.owner_id,
         el.visibility,
         el.name,
         COALESCE(ic.item_count, 0)::int AS item_count,
         COALESCE(p.display_name, 'User') AS owner_display_name
       FROM experience_lists el
       LEFT JOIN profile_identity p ON p.user_id = el.owner_id
       LEFT JOIN (
         SELECT experience_list_id, COUNT(*)::int AS item_count
         FROM experience_lists_items
         GROUP BY experience_list_id
       ) ic ON ic.experience_list_id = el.id
      WHERE el.id = $1 AND COALESCE(p.is_visible, TRUE)`,
      [experienceListId],
    );
    const row = res.rows[0];
    return row ? toResolved(row) : null;
  };
}
