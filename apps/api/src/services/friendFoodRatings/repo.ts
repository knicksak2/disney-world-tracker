/**
 * Repository for Friend Food Ratings.
 *
 * Implements read-only queries for:
 *   - listDishes: per-dish aggregation, keyset pagination, and conjunctive filters
 *   - listScopes: distinct scopes (restaurant / user-submitted location)
 *   - listFriendSocialProof: Phase 2 batch query for menu / picker inline proof
 *
 * This repo never selects `note` or `logged_at`, issues no writes, and adds no persistence.
 *
 * Validates: Requirements 3.7, 4.1, 4.2, 4.4, 4.5, 4.6, 4.7, 5.2, 5.3, 6.1, 6.2, 6.4, 6.5, 6.6, 6.8, 19.2, 19.4
 */

import type {
  FoodScopeKind,
  FriendFoodScopeDTO,
  FriendFoodSort,
  Park,
} from '@dwt/shared';
import {
  FRIEND_FOOD_BATCH_MAX_ROWS,
  FRIEND_FOOD_SCOPES_MAX,
} from '@dwt/shared';
import type { DbPool } from '../../db/pool.js';
import type { SocialProofRow } from './dishAggregate.js';

export interface ListDishesInput {
  readonly targetUserId: string;
  readonly sort: FriendFoodSort;
  readonly limit: number;
  readonly cursor?: { a: string; b: string | null; id: string } | undefined;
  readonly experienceId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly park?: Park | undefined;
  readonly likePattern?: string | undefined; // from toLikeContainsPattern
  readonly minRatedLogs: number;
}

export interface DishRow {
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly scopeKind: FoodScopeKind;
  readonly scopeId: string;
  readonly scopeName: string;
  readonly park: Park | null;
  readonly logCount: number;
  readonly ratedCount: number;
  readonly averageRating: number | null;
  readonly latestVisitedOn: string;
  readonly cursorA: string;
  readonly cursorB: string | null;
}

export interface FriendFoodRatingsRepo {
  listDishes(input: ListDishesInput): Promise<{ rows: readonly DishRow[]; hasMore: boolean }>;
  listScopes(targetUserId: string): Promise<readonly FriendFoodScopeDTO[]>;
  listFriendSocialProof(
    viewerId: string,
    scope: { kind: 'experience' | 'location'; id: string },
  ): Promise<{ rows: readonly SocialProofRow[]; capped: boolean }>;
}

interface SortSqlFragments {
  readonly cursorA: string;
  readonly cursorB: string;
  readonly orderBy: string;
  readonly keysetPredicate: (paramIndexStart: number) => string;
}

const SORT_SQL: Record<FriendFoodSort, SortSqlFragments> = {
  highest_rated: {
    cursorA: 'rating_key::text',
    cursorB: 'rated_count::text',
    orderBy: 'rating_key DESC, rated_count DESC, food_item_id ASC',
    keysetPredicate: (i) =>
      `((rating_key < $${i}::numeric) OR (rating_key = $${i}::numeric AND rated_count < $${i + 1}::int) OR (rating_key = $${i}::numeric AND rated_count = $${i + 1}::int AND food_item_id > $${i + 2}::uuid))`,
  },
  recent: {
    cursorA: "to_char(latest_visited_on, 'YYYY-MM-DD')",
    cursorB: 'NULL::text',
    orderBy: 'latest_visited_on DESC, food_item_id ASC',
    keysetPredicate: (i) =>
      `((latest_visited_on < $${i}::date) OR (latest_visited_on = $${i}::date AND food_item_id > $${i + 1}::uuid))`,
  },
  most_logged: {
    cursorA: 'log_count::text',
    cursorB: "to_char(latest_visited_on, 'YYYY-MM-DD')",
    orderBy: 'log_count DESC, latest_visited_on DESC, food_item_id ASC',
    keysetPredicate: (i) =>
      `((log_count < $${i}::int) OR (log_count = $${i}::int AND latest_visited_on < $${i + 1}::date) OR (log_count = $${i}::int AND latest_visited_on = $${i + 1}::date AND food_item_id > $${i + 2}::uuid))`,
  },
};

export function createFriendFoodRatingsRepo(
  pool: DbPool,
  batchMaxRows: number = FRIEND_FOOD_BATCH_MAX_ROWS,
): FriendFoodRatingsRepo {
  return {
    async listDishes(input: ListDishesInput): Promise<{ rows: readonly DishRow[]; hasMore: boolean }> {
      const sortConfig = SORT_SQL[input.sort];
      const params: unknown[] = [
        input.targetUserId,
        input.experienceId ?? null,
        input.locationId ?? null,
        input.park ?? null,
        input.likePattern ?? null,
        input.minRatedLogs,
      ];

      let keysetClause = 'TRUE';
      if (input.cursor) {
        const nextIndex = params.length + 1;
        if (input.sort === 'recent') {
          keysetClause = sortConfig.keysetPredicate(nextIndex);
          params.push(input.cursor.a, input.cursor.id);
        } else {
          keysetClause = sortConfig.keysetPredicate(nextIndex);
          params.push(input.cursor.a, input.cursor.b, input.cursor.id);
        }
      }

      const limitParamIndex = params.length + 1;
      params.push(input.limit + 1);

      const sql = `
WITH dish AS (
  SELECT fi.id                                   AS food_item_id,
         fi.name                                 AS food_item_name,
         CASE WHEN fi.experience_id IS NOT NULL THEN 'experience' ELSE 'location' END AS scope_kind,
         COALESCE(fi.experience_id, fi.location_id) AS scope_id,
         COALESCE(e.name, usl.name)              AS scope_name,
         COALESCE(e.park, usl.park)              AS park,
         COUNT(*)::int                           AS log_count,
         COUNT(fil.rating)::int                  AS rated_count,
         AVG(fil.rating)                         AS avg_rating,
         MAX(fil.visited_on)                     AS latest_visited_on
    FROM food_item_logs fil
    JOIN food_items fi                 ON fi.id  = fil.food_item_id
    LEFT JOIN experiences e            ON e.id   = fi.experience_id
    LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
   WHERE fil.user_id = $1
     AND ($2::uuid IS NULL OR fi.experience_id = $2::uuid)
     AND ($3::uuid IS NULL OR fi.location_id   = $3::uuid)
     AND ($4::text IS NULL OR COALESCE(e.park, usl.park) = $4::text)
     AND ($5::text IS NULL OR lower(fi.name) LIKE $5::text)
   GROUP BY fi.id, fi.name, fi.experience_id, fi.location_id, COALESCE(e.name, usl.name), COALESCE(e.park, usl.park)
), keyed AS (
  SELECT dish.*, COALESCE(avg_rating, 0) AS rating_key
    FROM dish
   WHERE rated_count >= $6::int
)
SELECT food_item_id, food_item_name, scope_kind, scope_id, scope_name, park,
       log_count, rated_count,
       avg_rating::float                        AS average_rating,
       to_char(latest_visited_on, 'YYYY-MM-DD') AS latest_visited_on,
       ${sortConfig.cursorA} AS cursor_a, ${sortConfig.cursorB} AS cursor_b
  FROM keyed
 WHERE ${keysetClause}
 ORDER BY ${sortConfig.orderBy}
 LIMIT $${limitParamIndex};
`;

      const result = await pool.query<{
        food_item_id: string;
        food_item_name: string;
        scope_kind: FoodScopeKind;
        scope_id: string;
        scope_name: string;
        park: Park | null;
        log_count: number;
        rated_count: number;
        average_rating: number | null;
        latest_visited_on: string;
        cursor_a: string;
        cursor_b: string | null;
      }>(sql, params);

      const hasMore = result.rows.length > input.limit;
      const returnedRows = result.rows.slice(0, input.limit);

      const rows: DishRow[] = returnedRows.map((r) => ({
        foodItemId: r.food_item_id,
        foodItemName: r.food_item_name,
        scopeKind: r.scope_kind,
        scopeId: r.scope_id,
        scopeName: r.scope_name,
        park: r.park ?? null,
        logCount: Number(r.log_count),
        ratedCount: Number(r.rated_count),
        averageRating:
          r.average_rating !== null && r.average_rating !== undefined
            ? Number(r.average_rating)
            : null,
        latestVisitedOn:
          (r.latest_visited_on as unknown) instanceof Date
            ? (r.latest_visited_on as unknown as Date).toISOString().split('T')[0]!
            : String(r.latest_visited_on).split('T')[0]!,
        cursorA: r.cursor_a,
        cursorB: r.cursor_b ?? null,
      }));

      return { rows, hasMore };
    },

    async listScopes(targetUserId: string): Promise<readonly FriendFoodScopeDTO[]> {
      const sql = `
SELECT CASE WHEN fi.experience_id IS NOT NULL THEN 'experience' ELSE 'location' END AS kind,
       COALESCE(fi.experience_id, fi.location_id) AS id,
       COALESCE(e.name, usl.name)                 AS name,
       COALESCE(e.park, usl.park)                 AS park,
       COUNT(DISTINCT fi.id)::int                 AS dish_count
  FROM food_item_logs fil
  JOIN food_items fi                 ON fi.id  = fil.food_item_id
  LEFT JOIN experiences e            ON e.id   = fi.experience_id
  LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
 WHERE fil.user_id = $1
 GROUP BY fi.experience_id, fi.location_id, COALESCE(e.name, usl.name), COALESCE(e.park, usl.park)
 ORDER BY lower(COALESCE(e.name, usl.name)) ASC, COALESCE(fi.experience_id, fi.location_id) ASC
 LIMIT $2;
`;

      const result = await pool.query<{
        kind: FoodScopeKind;
        id: string;
        name: string;
        park: Park | null;
        dish_count: number;
      }>(sql, [targetUserId, FRIEND_FOOD_SCOPES_MAX]);

      return result.rows.map((r) => ({
        kind: r.kind,
        id: r.id,
        name: r.name,
        park: r.park ?? null,
        dishCount: Number(r.dish_count),
      }));
    },

    async listFriendSocialProof(
      viewerId: string,
      scope: { kind: 'experience' | 'location'; id: string },
    ): Promise<{ rows: readonly SocialProofRow[]; capped: boolean }> {
      const scopeCol =
        scope.kind === 'experience' ? 'fi.experience_id' : 'fi.location_id';

      const sql = `
WITH friend_ids AS (
  SELECT CASE WHEN user_lo_id = $1 THEN user_hi_id ELSE user_lo_id END AS friend_id
    FROM active_friendships
   WHERE user_lo_id = $1 OR user_hi_id = $1
), per_friend AS (
  SELECT fil.food_item_id,
         fil.user_id                         AS friend_id,
         COUNT(*)::int                       AS log_count,
         COUNT(fil.rating)::int              AS rated_count,
         AVG(fil.rating)                     AS avg_rating,
         MAX(fil.visited_on)                 AS latest_visited_on
    FROM food_item_logs fil
    JOIN food_items fi   ON fi.id = fil.food_item_id
    JOIN friend_ids f    ON f.friend_id = fil.user_id
   WHERE ${scopeCol} = $2::uuid
   GROUP BY fil.food_item_id, fil.user_id
)
SELECT pf.food_item_id, pf.friend_id, p.display_name, p.avatar_preset,
       pf.log_count, pf.rated_count,
       pf.avg_rating::float                          AS average_rating,
       to_char(pf.latest_visited_on, 'YYYY-MM-DD')   AS latest_visited_on
  FROM per_friend pf
  JOIN profile_identity p ON p.user_id = pf.friend_id AND p.is_visible
 WHERE pf.rated_count >= 1
 ORDER BY pf.food_item_id ASC, pf.avg_rating DESC, pf.latest_visited_on DESC, pf.friend_id ASC
 LIMIT $3;
`;

      const result = await pool.query<{
        food_item_id: string;
        friend_id: string;
        display_name: string;
        avatar_preset: string | null;
        log_count: number;
        rated_count: number;
        average_rating: number;
        latest_visited_on: string;
      }>(sql, [viewerId, scope.id, batchMaxRows + 1]);

      const capped = result.rows.length > batchMaxRows;
      const returnedRows = result.rows.slice(0, batchMaxRows);

      const rows: SocialProofRow[] = returnedRows.map((r) => ({
        foodItemId: r.food_item_id,
        friendId: r.friend_id,
        displayName: r.display_name,
        avatarPreset: (r.avatar_preset as SocialProofRow['avatarPreset']) ?? null,
        averageRating: Number(r.average_rating),
        ratedLogCount: Number(r.rated_count),
        logCount: Number(r.log_count),
        latestVisitedOn:
          (r.latest_visited_on as unknown) instanceof Date
            ? (r.latest_visited_on as unknown as Date).toISOString().split('T')[0]!
            : String(r.latest_visited_on).split('T')[0]!,
      }));

      return { rows, capped };
    },
  };
}
