/**
 * Repositories for Food_Items and Food_Item_Logs (Feature: food-item-logging).
 *
 * Validates: Requirements 1.1, 1.2, 1.4, 1.7, 1.8, 2.1, 2.2, 3.1, 3.2, 3.4, 3.5, 4.1-4.4, 6.5, 6.6
 */

import type {
  FoodItemDTO,
  FoodItemLogDTO,
  FoodItemLogHistoryDTO,
  FoodItemLogWithContextDTO,
  MenuDTO,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateFoodItemLogRepoInput {
  readonly userId: string;
  readonly foodItemId: string;
  readonly visitedOn: string; // YYYY-MM-DD
  readonly userTz: string;
  readonly rating?: number | null;
  readonly note?: string | null;
}

export interface SubmitScopedFoodItemInput {
  readonly experienceId?: string | null;
  readonly locationId?: string | null;
  readonly userId: string;
  readonly name: string;
}

export interface FoodItemRepo {
  upsertFoodItemsFromMenus(
    experienceId: string,
    menus: readonly MenuDTO[],
    seenAt: Date,
  ): Promise<void>;
  listFoodItems(experienceId: string): Promise<readonly FoodItemDTO[]>;
  submitFoodItem(
    experienceId: string,
    userId: string,
    name: string,
  ): Promise<FoodItemDTO>;
  listLocationFoodItems(locationId: string): Promise<readonly FoodItemDTO[]>;
  submitLocationFoodItem(
    locationId: string,
    userId: string,
    name: string,
  ): Promise<FoodItemDTO>;
  submitScopedFoodItem(
    input: SubmitScopedFoodItemInput,
  ): Promise<FoodItemDTO>;
  findFoodItem(foodItemId: string): Promise<FoodItemDTO | null>;
}

export interface UpdateFoodItemLogRepoInput {
  readonly userId: string;
  readonly foodItemId: string;
  readonly logId: string;
  readonly rating?: number | null | undefined;
  readonly note?: string | null | undefined;
}

export interface FoodItemLogRepo {
  addLog(input: CreateFoodItemLogRepoInput): Promise<FoodItemLogDTO>;
  getLogHistory(
    userId: string,
    foodItemId: string,
  ): Promise<FoodItemLogHistoryDTO>;
  deleteLog(
    userId: string,
    foodItemId: string,
    logId: string,
  ): Promise<void>;
  updateLog(
    input: UpdateFoodItemLogRepoInput,
  ): Promise<FoodItemLogDTO>;
  getAllLogsForUser(
    userId: string,
  ): Promise<readonly FoodItemLogWithContextDTO[]>;
  getLogsForUserAtScope(
    userId: string,
    scope: { readonly experienceId?: string; readonly locationId?: string },
  ): Promise<readonly FoodItemLogWithContextDTO[]>;
}

interface FoodItemRow {
  id: string;
  experience_id: string | null;
  location_id: string | null;
  name: string;
  price: string | null;
  source: 'menu_sync' | 'user_submitted';
  currently_on_menu: boolean | null;
}

interface FoodItemLogRow {
  id: string;
  user_id: string;
  food_item_id: string;
  visited_on: string;
  user_tz: string;
  logged_at: Date | string;
  rating: number | null;
  note: string | null;
}

function mapFoodItemRow(row: FoodItemRow): FoodItemDTO {
  return {
    id: row.id,
    experienceId: row.experience_id,
    locationId: row.location_id,
    name: row.name,
    price: row.price,
    source: row.source,
    currentlyOnMenu: Boolean(row.currently_on_menu),
  };
}

function mapFoodItemLogRow(row: FoodItemLogRow): FoodItemLogDTO {
  const visitedOnStr =
    typeof row.visited_on === 'string'
      ? row.visited_on.slice(0, 10)
      : (row.visited_on as unknown as Date).toISOString().slice(0, 10);

  const loggedAtStr =
    typeof row.logged_at === 'string'
      ? row.logged_at
      : row.logged_at.toISOString();

  return {
    id: row.id,
    userId: row.user_id,
    foodItemId: row.food_item_id,
    visitedOn: visitedOnStr,
    userTz: row.user_tz,
    loggedAt: loggedAtStr,
    rating: row.rating !== null && row.rating !== undefined ? Number(row.rating) : null,
    note: row.note,
  };
}

interface FoodItemLogWithContextRow extends FoodItemLogRow {
  food_item_name: string;
  experience_id: string | null;
  location_id: string | null;
  currently_on_menu: boolean | null;
  restaurant_name: string | null;
  location_name: string | null;
}

function mapFoodItemLogWithContextRow(
  row: FoodItemLogWithContextRow,
): FoodItemLogWithContextDTO {
  const base = mapFoodItemLogRow(row);
  return {
    ...base,
    foodItemName: row.food_item_name,
    currentlyOnMenu: Boolean(row.currently_on_menu),
    restaurantName: row.restaurant_name ?? null,
    locationName: row.location_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// FoodItemRepo Factory
// ---------------------------------------------------------------------------

export function createFoodItemRepo(pool: DbPool): FoodItemRepo {
  return {
    async upsertFoodItemsFromMenus(
      experienceId: string,
      menus: readonly MenuDTO[],
      seenAt: Date,
    ): Promise<void> {
      const itemsToUpsert = new Map<string, { name: string; price: string | null }>();

      for (const menu of menus) {
        for (const group of menu.groups) {
          for (const item of group.items) {
            const trimmed = item.name.trim();
            const lower = trimmed.toLowerCase();
            if (!lower) continue;
            itemsToUpsert.set(lower, {
              name: trimmed,
              price: item.price ?? null,
            });
          }
        }
      }

      if (itemsToUpsert.size === 0) {
        return;
      }

      for (const item of itemsToUpsert.values()) {
        await pool.query(
          `INSERT INTO food_items (experience_id, name, price, source, last_seen_at)
           VALUES ($1, $2, $3, 'menu_sync', $4)
           ON CONFLICT (experience_id, lower(name))
           DO UPDATE SET
             price = EXCLUDED.price,
             last_seen_at = EXCLUDED.last_seen_at`,
          [experienceId, item.name, item.price, seenAt],
        );
      }
    },

    async listFoodItems(experienceId: string): Promise<readonly FoodItemDTO[]> {
      const result = await pool.query<FoodItemRow>(
        `SELECT fi.id, fi.experience_id, fi.location_id, fi.name, fi.price, fi.source,
                (fi.source = 'user_submitted'
                  OR (em.fetched_at IS NOT NULL AND fi.last_seen_at >= em.fetched_at)) AS currently_on_menu
           FROM food_items fi
           LEFT JOIN experience_menus em ON em.experience_id = fi.experience_id
          WHERE fi.experience_id = $1
          ORDER BY fi.name ASC`,
        [experienceId],
      );

      return result.rows.map(mapFoodItemRow);
    },

    async submitFoodItem(
      experienceId: string,
      userId: string,
      name: string,
    ): Promise<FoodItemDTO> {
      return this.submitScopedFoodItem({
        experienceId,
        locationId: null,
        userId,
        name,
      });
    },

    async listLocationFoodItems(locationId: string): Promise<readonly FoodItemDTO[]> {
      const result = await pool.query<FoodItemRow>(
        `SELECT fi.id, fi.experience_id, fi.location_id, fi.name, fi.price, fi.source,
                true AS currently_on_menu
           FROM food_items fi
          WHERE fi.location_id = $1
          ORDER BY fi.name ASC`,
        [locationId],
      );

      return result.rows.map(mapFoodItemRow);
    },

    async submitLocationFoodItem(
      locationId: string,
      userId: string,
      name: string,
    ): Promise<FoodItemDTO> {
      return this.submitScopedFoodItem({
        experienceId: null,
        locationId,
        userId,
        name,
      });
    },

    async submitScopedFoodItem(
      input: SubmitScopedFoodItemInput,
    ): Promise<FoodItemDTO> {
      const trimmed = input.name.trim();
      if (!trimmed || trimmed.length > 200) {
        throw new AppError('validation_failed', 'Food item name must be between 1 and 200 characters');
      }

      const hasExp = Boolean(input.experienceId);
      const hasLoc = Boolean(input.locationId);

      // Scope exclusivity check (Requirement 6.6, Property 9)
      if ((hasExp && hasLoc) || (!hasExp && !hasLoc)) {
        throw new AppError(
          'validation_failed',
          'Must provide exactly one of experienceId or locationId',
        );
      }

      if (hasExp) {
        const expCheck = await pool.query(
          `SELECT id FROM experiences WHERE id = $1`,
          [input.experienceId],
        );
        if (expCheck.rows.length === 0) {
          throw new AppError('validation_failed', 'Experience not found');
        }

        try {
          const insertRes = await pool.query<FoodItemRow>(
            `INSERT INTO food_items (experience_id, name, source, created_by_user_id)
             VALUES ($1, $2, 'user_submitted', $3)
             RETURNING id, experience_id, location_id, name, price, source, true AS currently_on_menu`,
            [input.experienceId, trimmed, input.userId],
          );
          return mapFoodItemRow(insertRes.rows[0]!);
        } catch (err: unknown) {
          const existing = await pool.query<{ id: string }>(
            `SELECT id FROM food_items WHERE experience_id = $1 AND lower(name) = lower($2)`,
            [input.experienceId, trimmed],
          );
          if (existing.rows.length > 0) {
            throw new AppError(
              'food_item_duplicate',
              'A food item with that name already exists for this restaurant',
              { details: { existingId: existing.rows[0]?.id } },
            );
          }
          throw err;
        }
      } else {
        const locCheck = await pool.query(
          `SELECT id FROM user_submitted_locations WHERE id = $1`,
          [input.locationId],
        );
        if (locCheck.rows.length === 0) {
          throw new AppError('validation_failed', 'Location not found');
        }

        try {
          const insertRes = await pool.query<FoodItemRow>(
            `INSERT INTO food_items (location_id, name, source, created_by_user_id)
             VALUES ($1, $2, 'user_submitted', $3)
             RETURNING id, experience_id, location_id, name, price, source, true AS currently_on_menu`,
            [input.locationId, trimmed, input.userId],
          );
          return mapFoodItemRow(insertRes.rows[0]!);
        } catch (err: unknown) {
          const existing = await pool.query<{ id: string }>(
            `SELECT id FROM food_items WHERE location_id = $1 AND lower(name) = lower($2)`,
            [input.locationId, trimmed],
          );
          if (existing.rows.length > 0) {
            throw new AppError(
              'food_item_duplicate',
              'A food item with that name already exists for this location',
              { details: { existingId: existing.rows[0]?.id } },
            );
          }
          throw err;
        }
      }
    },

    async findFoodItem(foodItemId: string): Promise<FoodItemDTO | null> {
      const result = await pool.query<FoodItemRow>(
        `SELECT fi.id, fi.experience_id, fi.location_id, fi.name, fi.price, fi.source,
                (fi.source = 'user_submitted'
                  OR (em.fetched_at IS NOT NULL AND fi.last_seen_at >= em.fetched_at)) AS currently_on_menu
           FROM food_items fi
           LEFT JOIN experience_menus em ON em.experience_id = fi.experience_id
          WHERE fi.id = $1`,
        [foodItemId],
      );

      if (result.rows.length === 0) {
        return null;
      }

      return mapFoodItemRow(result.rows[0]!);
    },
  };
}

// ---------------------------------------------------------------------------
// FoodItemLogRepo Factory
// ---------------------------------------------------------------------------

function formatYmdInTimeZone(now: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
  } catch (err) {
    if (err instanceof RangeError) {
      throw new AppError(
        'validation_failed',
        'Unknown IANA time zone identifier.',
        { field: 'userTz' },
      );
    }
    throw err;
  }

  let yyyy = '';
  let mm = '';
  let dd = '';
  for (const part of parts) {
    if (part.type === 'year') yyyy = part.value;
    else if (part.type === 'month') mm = part.value;
    else if (part.type === 'day') dd = part.value;
  }

  return `${yyyy.padStart(4, '0')}-${mm}-${dd}`;
}

export function createFoodItemLogRepo(options: {
  pool: DbPool;
  clock?: () => Date;
}): FoodItemLogRepo {
  const pool = options.pool;
  const clock = options.clock ?? (() => new Date());

  return {
    async addLog(input: CreateFoodItemLogRepoInput): Promise<FoodItemLogDTO> {
      // 1. Future date check (Requirement 3.3, Property 5)
      const todayInUserTz = formatYmdInTimeZone(clock(), input.userTz);
      if (input.visitedOn > todayInUserTz) {
        throw new AppError(
          'food_log_future_date',
          'Visit date cannot be in the future',
          { field: 'visitedOn' },
        );
      }

      // 2. Check if food item exists
      const itemRes = await pool.query<{
        id: string;
        experience_id: string | null;
        location_id: string | null;
      }>(
        `SELECT id, experience_id, location_id FROM food_items WHERE id = $1`,
        [input.foodItemId],
      );

      if (itemRes.rows.length === 0) {
        throw new AppError('food_item_not_found', 'Food item not found');
      }

      const item = itemRes.rows[0]!;
      // Requirement 6.6 / Property 9: scope exclusivity check
      const hasExp = Boolean(item.experience_id);
      const hasLoc = Boolean(item.location_id);
      if ((hasExp && hasLoc) || (!hasExp && !hasLoc)) {
        throw new AppError(
          'validation_failed',
          'Food item must be scoped to exactly one of experience or location',
        );
      }

      const ratingVal =
        input.rating !== undefined && input.rating !== null
          ? input.rating
          : null;
      const noteVal =
        input.note !== undefined && input.note !== null
          ? input.note.trim() || null
          : null;

      // 3. Insert into food_item_logs (no touch to completions/ratings/experience_logs)
      const res = await pool.query<FoodItemLogRow>(
        `INSERT INTO food_item_logs (user_id, food_item_id, visited_on, user_tz, rating, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, user_id, food_item_id, visited_on, user_tz, logged_at, rating, note`,
        [
          input.userId,
          input.foodItemId,
          input.visitedOn,
          input.userTz,
          ratingVal,
          noteVal,
        ],
      );

      return mapFoodItemLogRow(res.rows[0]!);
    },

    async getLogHistory(
      userId: string,
      foodItemId: string,
    ): Promise<FoodItemLogHistoryDTO> {
      // Verify food item exists
      const itemCheck = await pool.query(
        `SELECT id FROM food_items WHERE id = $1`,
        [foodItemId],
      );
      if (itemCheck.rows.length === 0) {
        throw new AppError('food_item_not_found', 'Food item not found');
      }

      const res = await pool.query<FoodItemLogRow>(
        `SELECT id, user_id, food_item_id, visited_on, user_tz, logged_at, rating, note
           FROM food_item_logs
          WHERE user_id = $1 AND food_item_id = $2
          ORDER BY visited_on DESC, logged_at DESC`,
        [userId, foodItemId],
      );

      const logs = res.rows.map(mapFoodItemLogRow);
      return {
        foodItemId,
        repeatCount: logs.length,
        logs,
      };
    },

    async deleteLog(
      userId: string,
      foodItemId: string,
      logId: string,
    ): Promise<void> {
      const res = await pool.query(
        `DELETE FROM food_item_logs
          WHERE id = $1 AND user_id = $2 AND food_item_id = $3
         RETURNING id`,
        [logId, userId, foodItemId],
      );

      if (res.rows.length === 0) {
        throw new AppError('food_log_not_found', 'Food item log not found');
      }
    },

    async updateLog(
      input: UpdateFoodItemLogRepoInput,
    ): Promise<FoodItemLogDTO> {
      const checkRes = await pool.query<{ id: string }>(
        `SELECT id FROM food_item_logs
          WHERE id = $1 AND user_id = $2 AND food_item_id = $3`,
        [input.logId, input.userId, input.foodItemId],
      );

      if (checkRes.rows.length === 0) {
        throw new AppError('food_log_not_found', 'Food item log not found');
      }

      const updates: string[] = [];
      const values: unknown[] = [input.logId, input.userId, input.foodItemId];
      let paramIdx = 4;

      if (input.rating !== undefined) {
        updates.push(`rating = $${paramIdx++}`);
        values.push(input.rating);
      }

      if (input.note !== undefined) {
        updates.push(`note = $${paramIdx++}`);
        values.push(input.note === null ? null : input.note.trim() || null);
      }

      if (updates.length === 0) {
        const existing = await pool.query<FoodItemLogRow>(
          `SELECT id, user_id, food_item_id, visited_on, user_tz, logged_at, rating, note
             FROM food_item_logs
            WHERE id = $1`,
          [input.logId],
        );
        return mapFoodItemLogRow(existing.rows[0]!);
      }

      const res = await pool.query<FoodItemLogRow>(
        `UPDATE food_item_logs
            SET ${updates.join(', ')}
          WHERE id = $1 AND user_id = $2 AND food_item_id = $3
         RETURNING id, user_id, food_item_id, visited_on, user_tz, logged_at, rating, note`,
        values,
      );

      return mapFoodItemLogRow(res.rows[0]!);
    },

    async getAllLogsForUser(
      userId: string,
    ): Promise<readonly FoodItemLogWithContextDTO[]> {
      const res = await pool.query<FoodItemLogWithContextRow>(
        `SELECT fil.id, fil.user_id, fil.food_item_id, fil.visited_on, fil.user_tz, fil.logged_at,
                fil.rating, fil.note,
                fi.name AS food_item_name, fi.experience_id, fi.location_id,
                (fi.source = 'user_submitted'
                  OR (em.fetched_at IS NOT NULL AND fi.last_seen_at >= em.fetched_at)) AS currently_on_menu,
                e.name AS restaurant_name, usl.name AS location_name
           FROM food_item_logs fil
           JOIN food_items fi ON fi.id = fil.food_item_id
           LEFT JOIN experiences e ON e.id = fi.experience_id
           LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
           LEFT JOIN experience_menus em ON em.experience_id = fi.experience_id
          WHERE fil.user_id = $1
          ORDER BY fil.visited_on DESC, fil.logged_at DESC`,
        [userId],
      );

      return res.rows.map(mapFoodItemLogWithContextRow);
    },

    async getLogsForUserAtScope(
      userId: string,
      scope: { readonly experienceId?: string; readonly locationId?: string },
    ): Promise<readonly FoodItemLogWithContextDTO[]> {
      const hasExp = Boolean(scope.experienceId);
      const hasLoc = Boolean(scope.locationId);
      if ((hasExp && hasLoc) || (!hasExp && !hasLoc)) {
        throw new AppError(
          'validation_failed',
          'Must specify exactly one of experienceId or locationId',
        );
      }

      const whereClause = scope.experienceId
        ? 'WHERE fil.user_id = $1 AND fi.experience_id = $2'
        : 'WHERE fil.user_id = $1 AND fi.location_id = $2';
      const param = scope.experienceId ?? scope.locationId!;

      const res = await pool.query<FoodItemLogWithContextRow>(
        `SELECT fil.id, fil.user_id, fil.food_item_id, fil.visited_on, fil.user_tz, fil.logged_at,
                fil.rating, fil.note,
                fi.name AS food_item_name, fi.experience_id, fi.location_id,
                (fi.source = 'user_submitted'
                  OR (em.fetched_at IS NOT NULL AND fi.last_seen_at >= em.fetched_at)) AS currently_on_menu,
                e.name AS restaurant_name, usl.name AS location_name
           FROM food_item_logs fil
           JOIN food_items fi ON fi.id = fil.food_item_id
           LEFT JOIN experiences e ON e.id = fi.experience_id
           LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
           LEFT JOIN experience_menus em ON em.experience_id = fi.experience_id
          ${whereClause}
          ORDER BY fil.visited_on DESC, fil.logged_at DESC`,
        [userId, param],
      );

      return res.rows.map(mapFoodItemLogWithContextRow);
    },
  };
}
