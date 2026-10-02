/**
 * Repositories for Food Lists and Food List Items (Feature: food-lists).
 *
 * Validates: Requirements 1-11, Properties 1, 2, 3, 5
 */

import type {
  CreateFoodListInputDTO,
  FoodListCollectionDTO,
  FoodListDetailDTO,
  FoodListDiscoveryPageDTO,
  FoodListDTO,
  FoodListItemDTO,
  FoodListRole,
  FoodListShareDTO,
  FoodListShareRole,
} from '@dwt/shared';

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { pair } from '../friends/canonicalPair.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface FoodListRepo {
  createList(userId: string, input: CreateFoodListInputDTO): Promise<FoodListDTO>;
  renameList(listId: string, userId: string, name: string): Promise<FoodListDTO>;
  setVisibility(
    listId: string,
    userId: string,
    visibility: 'private' | 'public',
  ): Promise<FoodListDTO>;
  setChecklistMode(
    listId: string,
    userId: string,
    isChecklist: boolean,
  ): Promise<FoodListDTO>;
  setPinned(listId: string, userId: string, pinned: boolean): Promise<FoodListDTO>;
  deleteList(listId: string, userId: string): Promise<void>;
  listOwned(userId: string): Promise<readonly FoodListDTO[]>;
  getListDetail(listId: string, viewerId: string): Promise<FoodListDetailDTO>;
  findListById(listId: string): Promise<{ id: string; ownerId: string; name: string } | null>;
  discover(
    sort?: 'popular' | 'recent',
    cursor?: string | null,
    limit?: number,
  ): Promise<FoodListDiscoveryPageDTO>;
}

export interface FoodListItemRepo {
  addItem(listId: string, userId: string, foodItemId: string): Promise<FoodListItemDTO>;
  removeItem(listId: string, userId: string, foodItemId: string): Promise<void>;
  reorderItems(
    listId: string,
    userId: string,
    foodItemIds: readonly string[],
    expectedVersion: number,
  ): Promise<readonly FoodListItemDTO[]>;
}

export interface FoodListShareResult {
  readonly share: FoodListShareDTO;
  readonly action: 'created' | 'role_changed' | 'unchanged';
  readonly previousRole?: FoodListShareRole;
}

export interface FoodListShareRepo {
  shareWithFriend(
    listId: string,
    ownerId: string,
    recipientId: string,
    role: FoodListShareRole,
  ): Promise<FoodListShareResult>;
  revokeShare(listId: string, ownerId: string, recipientId: string): Promise<void>;
  listShares(listId: string, ownerId: string): Promise<readonly FoodListShareDTO[]>;
  revokeSharesBetween(userIdA: string, userIdB: string): Promise<void>;
}

export interface FoodListAffinityRepo {
  like(listId: string, userId: string): Promise<void>;
  unlike(listId: string, userId: string): Promise<void>;
  save(listId: string, userId: string): Promise<void>;
  unsave(listId: string, userId: string): Promise<void>;
  getCollection(userId: string): Promise<FoodListCollectionDTO>;
}

// ---------------------------------------------------------------------------
// Internal Rows and Mappings
// ---------------------------------------------------------------------------

export interface ListAccessRow {
  id: string;
  owner_id: string;
  visibility: 'private' | 'public';
  share_role: 'viewer' | 'editor' | null;
  has_trip_access?: boolean;
}

interface FoodListRow {
  id: string;
  owner_id: string;
  owner_display_name: string;
  name: string;
  visibility: 'private' | 'public';
  is_checklist: boolean;
  like_count: number;
  item_count: number;
  created_at: Date | string;
  updated_at: Date | string;
  pinned_at: Date | string | null;
}

interface FoodListItemRow {
  food_item_id: string;
  name: string;
  experience_id: string | null;
  experience_name: string | null;
  location_id: string | null;
  location_name: string | null;
  price: string | null;
  position: number;
  added_by_user_id: string | null;
  added_by_display_name: string | null;
}

function toIsoString(val: Date | string): string {
  return typeof val === 'string' ? val : val.toISOString();
}

function mapFoodListRow(row: FoodListRow): FoodListDTO {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerDisplayName: row.owner_display_name,
    name: row.name,
    visibility: row.visibility,
    isChecklist: Boolean(row.is_checklist),
    likeCount: Number(row.like_count),
    itemCount: Number(row.item_count),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    pinnedAt: row.pinned_at === null ? null : toIsoString(row.pinned_at),
  };
}

function mapFoodListItemRow(row: FoodListItemRow): FoodListItemDTO {
  return {
    foodItemId: row.food_item_id,
    name: row.name,
    experienceId: row.experience_id ?? null,
    experienceName: row.experience_name ?? null,
    locationId: row.location_id ?? null,
    locationName: row.location_name ?? null,
    price: row.price ?? null,
    position: Number(row.position),
    addedByUserId: row.added_by_user_id ?? null,
    addedByDisplayName: row.added_by_display_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Access Evaluation Helpers (Properties 1, 2, 3; Trips R22.3, R22.4, R22.8)
// ---------------------------------------------------------------------------

const tripTableAvailable = new WeakMap<DbPool, Promise<boolean>>();

async function isTripTableAvailable(pool: DbPool): Promise<boolean> {
  let p = tripTableAvailable.get(pool);
  if (!p) {
    p = pool
      .query('SELECT 1 FROM trip_food_lists LIMIT 0')
      .then(() => true)
      .catch(() => false);
    tripTableAvailable.set(pool, p);
  }
  return p;
}

export async function getListAccess(
  pool: DbPool,
  listId: string,
  userId: string,
): Promise<ListAccessRow | null> {
  const res = await pool.query<ListAccessRow>(
    `SELECT fl.id, fl.owner_id, fl.visibility, fls.role AS share_role
       FROM food_lists fl
       LEFT JOIN food_list_shares fls
         ON fls.food_list_id = fl.id AND fls.shared_with_user_id = $2
      WHERE fl.id = $1`,
    [listId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;

  // If caller is not owner, list is private, and caller has no direct share,
  // check live Trip-derived view access (Trips R22.3, R22.4, R22.8)
  if (row.owner_id !== userId && row.visibility !== 'public' && !row.share_role) {
    if (await isTripTableAvailable(pool)) {
      const tripRes = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM trip_food_lists tfl
           JOIN trip_memberships tm ON tm.trip_id = tfl.trip_id
           WHERE tfl.food_list_id = $1 AND tm.user_id = $2
         ) AS exists`,
        [listId, userId],
      );
      row.has_trip_access = Boolean(tripRes.rows[0]?.exists);
    } else {
      row.has_trip_access = false;
    }
  } else {
    row.has_trip_access = false;
  }

  return row;
}

export function assertOwner(access: ListAccessRow | null, userId: string): void {
  if (!access) {
    throw new AppError('food_list_not_found', 'Food list not found');
  }
  if (access.owner_id === userId) {
    return;
  }
  if (access.visibility === 'public' || access.share_role !== null || access.has_trip_access) {
    throw new AppError('food_list_edit_forbidden', 'Only the owner can perform this action');
  }
  throw new AppError('food_list_not_found', 'Food list not found');
}

export function assertEditAccess(access: ListAccessRow | null, userId: string): void {
  if (!access) {
    throw new AppError('food_list_not_found', 'Food list not found');
  }
  if (access.owner_id === userId || access.share_role === 'editor') {
    return;
  }
  if (access.visibility === 'public' || access.share_role === 'viewer' || access.has_trip_access) {
    throw new AppError('food_list_edit_forbidden', 'Editor access required');
  }
  throw new AppError('food_list_not_found', 'Food list not found');
}

export function assertViewAccess(access: ListAccessRow | null, userId: string): void {
  if (!access) {
    throw new AppError('food_list_not_found', 'Food list not found');
  }
  if (
    access.owner_id === userId ||
    access.visibility === 'public' ||
    access.share_role !== null ||
    access.has_trip_access === true
  ) {
    return;
  }
  throw new AppError('food_list_not_found', 'Food list not found');
}

// ---------------------------------------------------------------------------
// FoodListRepo Implementation
// ---------------------------------------------------------------------------

export function createFoodListRepo(pool: DbPool): FoodListRepo {
  async function getListSummary(listId: string): Promise<FoodListDTO> {
    const res = await pool.query<FoodListRow>(
      `SELECT
         fl.id,
         fl.owner_id,
         COALESCE(p.display_name, 'User') AS owner_display_name,
         fl.name,
         fl.visibility,
         fl.is_checklist,
         fl.like_count,
         COALESCE(ic.item_count, 0)::int AS item_count,
         fl.created_at,
         fl.updated_at,
         fl.pinned_at
       FROM food_lists fl
       LEFT JOIN profiles p ON p.user_id = fl.owner_id
       LEFT JOIN (
         SELECT food_list_id, COUNT(*)::int AS item_count
         FROM food_lists_items
         GROUP BY food_list_id
       ) ic ON ic.food_list_id = fl.id
      WHERE fl.id = $1`,
      [listId],
    );
    if (res.rows.length === 0) {
      throw new AppError('food_list_not_found', 'Food list not found');
    }
    return mapFoodListRow(res.rows[0]!);
  }

  return {
    async createList(userId: string, input: CreateFoodListInputDTO): Promise<FoodListDTO> {
      const trimmed = input.name.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new AppError(
          'validation_failed',
          'Food list name must be between 1 and 100 characters',
        );
      }

      const visibility = input.visibility ?? 'private';
      if (visibility !== 'private' && visibility !== 'public') {
        throw new AppError('validation_failed', 'Invalid visibility');
      }

      const isChecklist = input.isChecklist ?? false;
      if (typeof isChecklist !== 'boolean') {
        throw new AppError('validation_failed', 'isChecklist must be a boolean');
      }

      const insertRes = await pool.query<{ id: string }>(
        `INSERT INTO food_lists (owner_id, name, visibility, is_checklist)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [userId, trimmed, visibility, isChecklist],
      );

      return getListSummary(insertRes.rows[0]!.id);
    },

    async renameList(listId: string, userId: string, name: string): Promise<FoodListDTO> {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new AppError(
          'validation_failed',
          'Food list name must be between 1 and 100 characters',
        );
      }

      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      await pool.query(
        `UPDATE food_lists
            SET name = $2, updated_at = now()
          WHERE id = $1`,
        [listId, trimmed],
      );

      return getListSummary(listId);
    },

    async setVisibility(
      listId: string,
      userId: string,
      visibility: 'private' | 'public',
    ): Promise<FoodListDTO> {
      if (visibility !== 'private' && visibility !== 'public') {
        throw new AppError('validation_failed', 'Invalid visibility');
      }

      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      await pool.query(
        `UPDATE food_lists
            SET visibility = $2, updated_at = now()
          WHERE id = $1`,
        [listId, visibility],
      );

      return getListSummary(listId);
    },

    async setChecklistMode(
      listId: string,
      userId: string,
      isChecklist: boolean,
    ): Promise<FoodListDTO> {
      if (typeof isChecklist !== 'boolean') {
        throw new AppError('validation_failed', 'isChecklist must be a boolean');
      }

      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      await pool.query(
        `UPDATE food_lists
            SET is_checklist = $2, updated_at = now()
          WHERE id = $1`,
        [listId, isChecklist],
      );

      return getListSummary(listId);
    },

    async setPinned(listId: string, userId: string, pinned: boolean): Promise<FoodListDTO> {
      if (typeof pinned !== 'boolean') {
        throw new AppError('validation_failed', 'pinned must be a boolean');
      }

      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      if (pinned) {
        const countRes = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::int AS count
             FROM food_lists
            WHERE owner_id = $1
              AND pinned_at IS NOT NULL
              AND id != $2`,
          [userId, listId],
        );
        if (Number(countRes.rows[0]?.count ?? 0) >= 4) {
          throw new AppError(
            'food_list_pin_limit_reached',
            'You can pin up to 4 lists. Unpin a list first.',
          );
        }
      }

      // Pinning/unpinning does NOT touch `updated_at` — it is a display-order
      // preference, not a content edit, so it must not perturb the
      // recency-based ordering unpinned lists fall back to.
      await pool.query(
        `UPDATE food_lists
            SET pinned_at = CASE WHEN $2 THEN now() ELSE NULL END
          WHERE id = $1`,
        [listId, pinned],
      );

      return getListSummary(listId);
    },

    async deleteList(listId: string, userId: string): Promise<void> {
      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      await pool.query(`DELETE FROM food_lists WHERE id = $1`, [listId]);
    },

    async listOwned(userId: string): Promise<readonly FoodListDTO[]> {
      const res = await pool.query<FoodListRow>(
        `SELECT
           fl.id,
           fl.owner_id,
           COALESCE(p.display_name, 'User') AS owner_display_name,
           fl.name,
           fl.visibility,
           fl.is_checklist,
           fl.like_count,
           COALESCE(ic.item_count, 0)::int AS item_count,
           fl.created_at,
           fl.updated_at,
           fl.pinned_at
         FROM food_lists fl
         LEFT JOIN profiles p ON p.user_id = fl.owner_id
         LEFT JOIN (
           SELECT food_list_id, COUNT(*)::int AS item_count
           FROM food_lists_items
           GROUP BY food_list_id
         ) ic ON ic.food_list_id = fl.id
        WHERE fl.owner_id = $1
        ORDER BY fl.pinned_at DESC NULLS LAST, fl.updated_at DESC`,
        [userId],
      );

      return res.rows.map(mapFoodListRow);
    },

    async getListDetail(listId: string, viewerId: string): Promise<FoodListDetailDTO> {
      const access = await getListAccess(pool, listId, viewerId);
      assertViewAccess(access, viewerId);

      const listRes = await pool.query<{
        id: string;
        owner_id: string;
        owner_display_name: string;
        name: string;
        visibility: 'private' | 'public';
        is_checklist: boolean;
        like_count: number;
        version: number;
        created_at: Date | string;
        updated_at: Date | string;
        pinned_at: Date | string | null;
        liked: boolean;
        saved: boolean;
      }>(
        `SELECT
           fl.id,
           fl.owner_id,
           COALESCE(p.display_name, 'User') AS owner_display_name,
           fl.name,
           fl.visibility,
           fl.is_checklist,
           fl.like_count,
           fl.version,
           fl.created_at,
           fl.updated_at,
           fl.pinned_at,
           (fll.food_list_id IS NOT NULL) AS liked,
           (fls_save.food_list_id IS NOT NULL) AS saved
         FROM food_lists fl
         LEFT JOIN profiles p ON p.user_id = fl.owner_id
         LEFT JOIN food_list_likes fll
           ON fll.food_list_id = fl.id AND fll.user_id = $2
         LEFT JOIN food_list_saves fls_save
           ON fls_save.food_list_id = fl.id AND fls_save.saved_by_user_id = $2
        WHERE fl.id = $1`,
        [listId, viewerId],
      );

      const row = listRes.rows[0]!;
      const isChecklist = Boolean(row.is_checklist);
      let items: FoodListItemDTO[];

      if (isChecklist) {
        const listCreatedAtDate = toIsoString(row.created_at).slice(0, 10);
        // `fil` picks the single most recent qualifying log per item (per
        // Requirement 13.7's repeat-log allowance, `DISTINCT ON` +
        // `ORDER BY visited_on DESC, logged_at DESC` mirrors this
        // codebase's existing "most recent log wins" convention elsewhere)
        // so a rating shown on the row reflects the User's latest visit,
        // not an arbitrary one among several.
        const itemsRes = await pool.query<
          FoodListItemRow & { gotten: boolean; rating: number | null; log_id: string | null }
        >(
          `SELECT
             fli.food_item_id,
             fi.name,
             fi.experience_id,
             e.name AS experience_name,
             fi.location_id,
             usl.name AS location_name,
             fi.price,
             fli.position,
             fli.added_by_user_id,
             p.display_name AS added_by_display_name,
             (fil.food_item_id IS NOT NULL) AS gotten,
             fil.rating,
             fil.log_id
           FROM food_lists_items fli
           JOIN food_items fi ON fi.id = fli.food_item_id
           LEFT JOIN experiences e ON e.id = fi.experience_id
           LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
           LEFT JOIN profiles p ON p.user_id = fli.added_by_user_id
           LEFT JOIN (
             SELECT DISTINCT ON (food_item_id) food_item_id, id AS log_id, rating
               FROM food_item_logs
              WHERE user_id = $2
                AND visited_on >= $3
              ORDER BY food_item_id, visited_on DESC, logged_at DESC
           ) fil ON fil.food_item_id = fli.food_item_id
          WHERE fli.food_list_id = $1
          ORDER BY fli.position ASC`,
          [listId, viewerId, listCreatedAtDate],
        );
        items = itemsRes.rows.map((itemRow) => {
          const gotten = Boolean(itemRow.gotten);
          return {
            foodItemId: itemRow.food_item_id,
            name: itemRow.name,
            experienceId: itemRow.experience_id ?? null,
            experienceName: itemRow.experience_name ?? null,
            locationId: itemRow.location_id ?? null,
            locationName: itemRow.location_name ?? null,
            price: itemRow.price ?? null,
            position: Number(itemRow.position),
            addedByUserId: itemRow.added_by_user_id ?? null,
            addedByDisplayName: itemRow.added_by_display_name ?? null,
            gotten,
            // Requirement 13.19, 13.23: `rating` and `logId` are present if and
            // only if `gotten` is `true`.
            ...(gotten
              ? { rating: itemRow.rating ?? null, logId: itemRow.log_id ?? null }
              : {}),
          };
        });
      } else {
        const itemsRes = await pool.query<FoodListItemRow>(
          `SELECT
             fli.food_item_id,
             fi.name,
             fi.experience_id,
             e.name AS experience_name,
             fi.location_id,
             usl.name AS location_name,
             fi.price,
             fli.position,
             fli.added_by_user_id,
             p.display_name AS added_by_display_name
           FROM food_lists_items fli
           JOIN food_items fi ON fi.id = fli.food_item_id
           LEFT JOIN experiences e ON e.id = fi.experience_id
           LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
           LEFT JOIN profiles p ON p.user_id = fli.added_by_user_id
          WHERE fli.food_list_id = $1
          ORDER BY fli.position ASC`,
          [listId],
        );
        items = itemsRes.rows.map(mapFoodListItemRow);
      }

      let myRole: FoodListRole = 'viewer';
      if (access!.owner_id === viewerId) {
        myRole = 'owner';
      } else if (access!.share_role === 'editor') {
        myRole = 'editor';
      }

      const detail: FoodListDetailDTO = {
        id: row.id,
        ownerId: row.owner_id,
        ownerDisplayName: row.owner_display_name,
        name: row.name,
        visibility: row.visibility,
        isChecklist,
        likeCount: Number(row.like_count),
        itemCount: items.length,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at),
        pinnedAt: row.pinned_at === null ? null : toIsoString(row.pinned_at),
        liked: Boolean(row.liked),
        saved: Boolean(row.saved),
        version: Number(row.version),
        myRole,
        items,
        ...(isChecklist ? { gottenCount: items.filter((it) => it.gotten === true).length } : {}),
      };

      return detail;
    },

    async findListById(
      listId: string,
    ): Promise<{ id: string; ownerId: string; name: string } | null> {
      const res = await pool.query<{ id: string; owner_id: string; name: string }>(
        `SELECT id, owner_id, name FROM food_lists WHERE id = $1`,
        [listId],
      );
      if (res.rows.length === 0) return null;
      return {
        id: res.rows[0]!.id,
        ownerId: res.rows[0]!.owner_id,
        name: res.rows[0]!.name,
      };
    },

    async discover(
      sort: 'popular' | 'recent' = 'popular',
      cursor?: string | null,
      limit: number = 20,
    ): Promise<FoodListDiscoveryPageDTO> {
      if (sort !== 'popular' && sort !== 'recent') {
        throw new AppError('validation_failed', 'Invalid discovery sort');
      }

      let parsedCursor: { k: string | number; id: string } | null = null;
      if (cursor) {
        try {
          const json = Buffer.from(cursor, 'base64').toString('utf8');
          const parsed = JSON.parse(json);
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            !parsed.id ||
            parsed.k === undefined
          ) {
            throw new Error('malformed');
          }
          parsedCursor = { k: parsed.k, id: String(parsed.id) };
        } catch {
          throw new AppError('validation_failed', 'Invalid cursor');
        }
      }

      const pageSize = Math.max(1, Math.min(limit, 50));
      const fetchLimit = pageSize + 1;

      let queryText = '';
      const params: unknown[] = [fetchLimit];

      if (sort === 'popular') {
        if (parsedCursor) {
          params.push(Number(parsedCursor.k), parsedCursor.id);
          queryText = `
            SELECT
              fl.id,
              fl.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              fl.name,
              fl.visibility,
              fl.is_checklist,
              fl.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              fl.created_at,
              fl.updated_at,
              fl.pinned_at
            FROM food_lists fl
            LEFT JOIN profiles p ON p.user_id = fl.owner_id
            LEFT JOIN (
              SELECT food_list_id, COUNT(*)::int AS item_count
              FROM food_lists_items
              GROUP BY food_list_id
            ) ic ON ic.food_list_id = fl.id
            WHERE fl.visibility = 'public'
              AND (fl.like_count < $2 OR (fl.like_count = $2 AND fl.id > $3))
            ORDER BY fl.like_count DESC, fl.id ASC
            LIMIT $1`;
        } else {
          queryText = `
            SELECT
              fl.id,
              fl.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              fl.name,
              fl.visibility,
              fl.is_checklist,
              fl.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              fl.created_at,
              fl.updated_at,
              fl.pinned_at
            FROM food_lists fl
            LEFT JOIN profiles p ON p.user_id = fl.owner_id
            LEFT JOIN (
              SELECT food_list_id, COUNT(*)::int AS item_count
              FROM food_lists_items
              GROUP BY food_list_id
            ) ic ON ic.food_list_id = fl.id
            WHERE fl.visibility = 'public'
            ORDER BY fl.like_count DESC, fl.id ASC
            LIMIT $1`;
        }
      } else {
        if (parsedCursor) {
          params.push(new Date(String(parsedCursor.k)), parsedCursor.id);
          queryText = `
            SELECT
              fl.id,
              fl.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              fl.name,
              fl.visibility,
              fl.is_checklist,
              fl.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              fl.created_at,
              fl.updated_at,
              fl.pinned_at
            FROM food_lists fl
            LEFT JOIN profiles p ON p.user_id = fl.owner_id
            LEFT JOIN (
              SELECT food_list_id, COUNT(*)::int AS item_count
              FROM food_lists_items
              GROUP BY food_list_id
            ) ic ON ic.food_list_id = fl.id
            WHERE fl.visibility = 'public'
              AND (fl.created_at < $2 OR (fl.created_at = $2 AND fl.id > $3))
            ORDER BY fl.created_at DESC, fl.id ASC
            LIMIT $1`;
        } else {
          queryText = `
            SELECT
              fl.id,
              fl.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              fl.name,
              fl.visibility,
              fl.is_checklist,
              fl.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              fl.created_at,
              fl.updated_at,
              fl.pinned_at
            FROM food_lists fl
            LEFT JOIN profiles p ON p.user_id = fl.owner_id
            LEFT JOIN (
              SELECT food_list_id, COUNT(*)::int AS item_count
              FROM food_lists_items
              GROUP BY food_list_id
            ) ic ON ic.food_list_id = fl.id
            WHERE fl.visibility = 'public'
            ORDER BY fl.created_at DESC, fl.id ASC
            LIMIT $1`;
        }
      }

      const res = await pool.query<FoodListRow>(queryText, params);
      const rows = res.rows;
      const hasMore = rows.length > pageSize;
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
      const items = pageRows.map(mapFoodListRow);

      let nextCursor: string | null = null;
      if (hasMore && items.length > 0) {
        const last = items[items.length - 1]!;
        const k = sort === 'popular' ? last.likeCount : last.createdAt;
        nextCursor = Buffer.from(JSON.stringify({ k, id: last.id })).toString('base64');
      }

      return {
        items,
        nextCursor,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// FoodListItemRepo Implementation
// ---------------------------------------------------------------------------

export function createFoodListItemRepo(pool: DbPool): FoodListItemRepo {
  return {
    async addItem(
      listId: string,
      userId: string,
      foodItemId: string,
    ): Promise<FoodListItemDTO> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const listRes = await client.query<{
          id: string;
          owner_id: string;
          visibility: 'private' | 'public';
        }>(
          `SELECT id, owner_id, visibility
             FROM food_lists
            WHERE id = $1
              FOR UPDATE`,
          [listId],
        );

        if (listRes.rows.length === 0) {
          throw new AppError('food_list_not_found', 'Food list not found');
        }
        const list = listRes.rows[0]!;

        const shareRes = await client.query<{ role: 'viewer' | 'editor' }>(
          `SELECT role FROM food_list_shares WHERE food_list_id = $1 AND shared_with_user_id = $2`,
          [listId, userId],
        );
        const shareRole = shareRes.rows[0]?.role ?? null;

        if (list.owner_id !== userId && shareRole !== 'editor') {
          let hasTripAccess = false;
          if (list.visibility !== 'public' && shareRole !== 'viewer') {
            try {
              const tripRes = await client.query<{ exists: boolean }>(
                `SELECT EXISTS (
                   SELECT 1 FROM trip_food_lists tfl
                   JOIN trip_memberships tm ON tm.trip_id = tfl.trip_id
                   WHERE tfl.food_list_id = $1 AND tm.user_id = $2
                 ) AS exists`,
                [listId, userId],
              );
              hasTripAccess = Boolean(tripRes.rows[0]?.exists);
            } catch {
              hasTripAccess = false;
            }
          }
          if (list.visibility === 'public' || shareRole === 'viewer' || hasTripAccess) {
            throw new AppError('food_list_edit_forbidden', 'Editor access required');
          }
          throw new AppError('food_list_not_found', 'Food list not found');
        }

        const foodItemRes = await client.query<{ id: string }>(
          `SELECT id FROM food_items WHERE id = $1`,
          [foodItemId],
        );
        if (foodItemRes.rows.length === 0) {
          throw new AppError('food_item_not_found', 'Food item not found');
        }

        const dupRes = await client.query<{ id: string }>(
          `SELECT id FROM food_lists_items WHERE food_list_id = $1 AND food_item_id = $2`,
          [listId, foodItemId],
        );
        if (dupRes.rows.length > 0) {
          throw new AppError('food_list_item_duplicate', 'Food item already in list');
        }

        const maxRes = await client.query<{ max_pos: number | null }>(
          `SELECT MAX(position) AS max_pos FROM food_lists_items WHERE food_list_id = $1`,
          [listId],
        );
        const nextPos =
          maxRes.rows[0]?.max_pos !== null && maxRes.rows[0]?.max_pos !== undefined
            ? Number(maxRes.rows[0].max_pos) + 1
            : 0;

        await client.query(
          `INSERT INTO food_lists_items (food_list_id, food_item_id, position, added_by_user_id)
           VALUES ($1, $2, $3, $4)`,
          [listId, foodItemId, nextPos, userId],
        );

        await client.query(
          `UPDATE food_lists
              SET version = version + 1, updated_at = now()
            WHERE id = $1`,
          [listId],
        );

        const itemRes = await client.query<FoodListItemRow>(
          `SELECT
             fli.food_item_id,
             fi.name,
             fi.experience_id,
             e.name AS experience_name,
             fi.location_id,
             usl.name AS location_name,
             fi.price,
             fli.position,
             fli.added_by_user_id,
             p.display_name AS added_by_display_name
           FROM food_lists_items fli
           JOIN food_items fi ON fi.id = fli.food_item_id
           LEFT JOIN experiences e ON e.id = fi.experience_id
           LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
           LEFT JOIN profiles p ON p.user_id = fli.added_by_user_id
          WHERE fli.food_list_id = $1 AND fli.food_item_id = $2`,
          [listId, foodItemId],
        );

        await client.query('COMMIT');
        return mapFoodListItemRow(itemRes.rows[0]!);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async removeItem(listId: string, userId: string, foodItemId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const listRes = await client.query<{
          id: string;
          owner_id: string;
          visibility: 'private' | 'public';
        }>(
          `SELECT id, owner_id, visibility
             FROM food_lists
            WHERE id = $1
              FOR UPDATE`,
          [listId],
        );

        if (listRes.rows.length === 0) {
          throw new AppError('food_list_not_found', 'Food list not found');
        }
        const list = listRes.rows[0]!;

        const shareRes = await client.query<{ role: 'viewer' | 'editor' }>(
          `SELECT role FROM food_list_shares WHERE food_list_id = $1 AND shared_with_user_id = $2`,
          [listId, userId],
        );
        const shareRole = shareRes.rows[0]?.role ?? null;

        if (list.owner_id !== userId && shareRole !== 'editor') {
          let hasTripAccess = false;
          if (list.visibility !== 'public' && shareRole !== 'viewer') {
            try {
              const tripRes = await client.query<{ exists: boolean }>(
                `SELECT EXISTS (
                   SELECT 1 FROM trip_food_lists tfl
                   JOIN trip_memberships tm ON tm.trip_id = tfl.trip_id
                   WHERE tfl.food_list_id = $1 AND tm.user_id = $2
                 ) AS exists`,
                [listId, userId],
              );
              hasTripAccess = Boolean(tripRes.rows[0]?.exists);
            } catch {
              hasTripAccess = false;
            }
          }
          if (list.visibility === 'public' || shareRole === 'viewer' || hasTripAccess) {
            throw new AppError('food_list_edit_forbidden', 'Editor access required');
          }
          throw new AppError('food_list_not_found', 'Food list not found');
        }

        const delRes = await client.query<{ id: string }>(
          `DELETE FROM food_lists_items
            WHERE food_list_id = $1 AND food_item_id = $2
           RETURNING id`,
          [listId, foodItemId],
        );

        if (delRes.rows.length > 0) {
          await client.query(
            `UPDATE food_lists
                SET version = version + 1, updated_at = now()
              WHERE id = $1`,
            [listId],
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async reorderItems(
      listId: string,
      userId: string,
      foodItemIds: readonly string[],
      expectedVersion: number,
    ): Promise<readonly FoodListItemDTO[]> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const listRes = await client.query<{
          id: string;
          owner_id: string;
          visibility: 'private' | 'public';
          version: number;
        }>(
          `SELECT id, owner_id, visibility, version
             FROM food_lists
            WHERE id = $1
              FOR UPDATE`,
          [listId],
        );

        if (listRes.rows.length === 0) {
          throw new AppError('food_list_not_found', 'Food list not found');
        }
        const list = listRes.rows[0]!;

        const shareRes = await client.query<{ role: 'viewer' | 'editor' }>(
          `SELECT role FROM food_list_shares WHERE food_list_id = $1 AND shared_with_user_id = $2`,
          [listId, userId],
        );
        const shareRole = shareRes.rows[0]?.role ?? null;

        if (list.owner_id !== userId && shareRole !== 'editor') {
          let hasTripAccess = false;
          if (list.visibility !== 'public' && shareRole !== 'viewer') {
            try {
              const tripRes = await client.query<{ exists: boolean }>(
                `SELECT EXISTS (
                   SELECT 1 FROM trip_food_lists tfl
                   JOIN trip_memberships tm ON tm.trip_id = tfl.trip_id
                   WHERE tfl.food_list_id = $1 AND tm.user_id = $2
                 ) AS exists`,
                [listId, userId],
              );
              hasTripAccess = Boolean(tripRes.rows[0]?.exists);
            } catch {
              hasTripAccess = false;
            }
          }
          if (list.visibility === 'public' || shareRole === 'viewer' || hasTripAccess) {
            throw new AppError('food_list_edit_forbidden', 'Editor access required');
          }
          throw new AppError('food_list_not_found', 'Food list not found');
        }

        const currentItemsRes = await client.query<{ food_item_id: string }>(
          `SELECT food_item_id FROM food_lists_items WHERE food_list_id = $1 ORDER BY position ASC`,
          [listId],
        );
        const currentIds = currentItemsRes.rows.map((r) => r.food_item_id);

        if (foodItemIds.length !== currentIds.length) {
          throw new AppError(
            'food_list_reorder_mismatch',
            'Reorder list of item IDs does not match current list items',
          );
        }
        const currentSet = new Set(currentIds);
        const submittedSet = new Set(foodItemIds);
        if (submittedSet.size !== foodItemIds.length) {
          throw new AppError(
            'food_list_reorder_mismatch',
            'Duplicate item IDs submitted in reorder',
          );
        }
        for (const id of foodItemIds) {
          if (!currentSet.has(id)) {
            throw new AppError(
              'food_list_reorder_mismatch',
              'Submitted item ID is not in this food list',
            );
          }
        }

        if (Number(list.version) !== expectedVersion) {
          throw new AppError('food_list_stale_write', 'Food list version has changed');
        }

        // Pass 1: negative temporary positions to avoid UNIQUE (food_list_id, position) collisions
        for (let i = 0; i < foodItemIds.length; i++) {
          await client.query(
            `UPDATE food_lists_items
                SET position = $1
              WHERE food_list_id = $2 AND food_item_id = $3`,
            [-1 - i, listId, foodItemIds[i]],
          );
        }

        // Pass 2: final positions
        for (let i = 0; i < foodItemIds.length; i++) {
          await client.query(
            `UPDATE food_lists_items
                SET position = $1
              WHERE food_list_id = $2 AND food_item_id = $3`,
            [i, listId, foodItemIds[i]],
          );
        }

        await client.query(
          `UPDATE food_lists
              SET version = version + 1, updated_at = now()
            WHERE id = $1`,
          [listId],
        );

        const itemsRes = await client.query<FoodListItemRow>(
          `SELECT
             fli.food_item_id,
             fi.name,
             fi.experience_id,
             e.name AS experience_name,
             fi.location_id,
             usl.name AS location_name,
             fi.price,
             fli.position,
             fli.added_by_user_id,
             p.display_name AS added_by_display_name
           FROM food_lists_items fli
           JOIN food_items fi ON fi.id = fli.food_item_id
           LEFT JOIN experiences e ON e.id = fi.experience_id
           LEFT JOIN user_submitted_locations usl ON usl.id = fi.location_id
           LEFT JOIN profiles p ON p.user_id = fli.added_by_user_id
          WHERE fli.food_list_id = $1
          ORDER BY fli.position ASC`,
          [listId],
        );

        await client.query('COMMIT');
        return itemsRes.rows.map(mapFoodListItemRow);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// FoodListShareRepo Implementation
// ---------------------------------------------------------------------------

export function createFoodListShareRepo(pool: DbPool): FoodListShareRepo {
  return {
    async shareWithFriend(
      listId: string,
      ownerId: string,
      recipientId: string,
      role: FoodListShareRole,
    ): Promise<FoodListShareResult> {
      const access = await getListAccess(pool, listId, ownerId);
      assertOwner(access, ownerId);

      if (recipientId === ownerId) {
        throw new AppError('food_list_share_not_friend', 'Cannot share with yourself');
      }

      const { lo, hi } = pair(ownerId, recipientId);
      const friendRes = await pool.query(
        `SELECT 1 FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2`,
        [lo, hi],
      );
      if (friendRes.rows.length === 0) {
        throw new AppError('food_list_share_not_friend', 'Recipient is not a friend');
      }

      const profileRes = await pool.query<{ display_name: string }>(
        `SELECT display_name FROM profiles WHERE user_id = $1`,
        [recipientId],
      );
      const recipientDisplayName = profileRes.rows[0]?.display_name ?? 'Friend';

      const existingRes = await pool.query<{ role: FoodListShareRole; shared_at: Date | string }>(
        `SELECT role, shared_at FROM food_list_shares WHERE food_list_id = $1 AND shared_with_user_id = $2`,
        [listId, recipientId],
      );

      if (existingRes.rows.length === 0) {
        const insertRes = await pool.query<{ shared_at: Date | string }>(
          `INSERT INTO food_list_shares (food_list_id, shared_with_user_id, shared_by_user_id, role)
           VALUES ($1, $2, $3, $4)
           RETURNING shared_at`,
          [listId, recipientId, ownerId, role],
        );

        return {
          share: {
            recipientId,
            recipientDisplayName,
            role,
            sharedAt: toIsoString(insertRes.rows[0]!.shared_at),
          },
          action: 'created',
        };
      }

      const existing = existingRes.rows[0]!;
      if (existing.role !== role) {
        await pool.query(
          `UPDATE food_list_shares
              SET role = $3
            WHERE food_list_id = $1 AND shared_with_user_id = $2`,
          [listId, recipientId, role],
        );

        return {
          share: {
            recipientId,
            recipientDisplayName,
            role,
            sharedAt: toIsoString(existing.shared_at),
          },
          action: 'role_changed',
          previousRole: existing.role,
        };
      }

      return {
        share: {
          recipientId,
          recipientDisplayName,
          role: existing.role,
          sharedAt: toIsoString(existing.shared_at),
        },
        action: 'unchanged',
      };
    },

    async revokeShare(listId: string, ownerId: string, recipientId: string): Promise<void> {
      const access = await getListAccess(pool, listId, ownerId);
      assertOwner(access, ownerId);

      await pool.query(
        `DELETE FROM food_list_shares
          WHERE food_list_id = $1 AND shared_with_user_id = $2`,
        [listId, recipientId],
      );
    },

    async listShares(listId: string, ownerId: string): Promise<readonly FoodListShareDTO[]> {
      const access = await getListAccess(pool, listId, ownerId);
      assertOwner(access, ownerId);

      const res = await pool.query<{
        recipient_id: string;
        recipient_display_name: string;
        role: FoodListShareRole;
        shared_at: Date | string;
      }>(
        `SELECT
           fls.shared_with_user_id AS recipient_id,
           COALESCE(p.display_name, 'User') AS recipient_display_name,
           fls.role,
           fls.shared_at
         FROM food_list_shares fls
         LEFT JOIN profiles p ON p.user_id = fls.shared_with_user_id
        WHERE fls.food_list_id = $1
        ORDER BY fls.shared_at ASC`,
        [listId],
      );

      return res.rows.map((r) => ({
        recipientId: r.recipient_id,
        recipientDisplayName: r.recipient_display_name,
        role: r.role,
        sharedAt: toIsoString(r.shared_at),
      }));
    },

    async revokeSharesBetween(userIdA: string, userIdB: string): Promise<void> {
      await pool.query(
        `DELETE FROM food_list_shares
          WHERE (shared_by_user_id = $1 AND shared_with_user_id = $2)
             OR (shared_by_user_id = $2 AND shared_with_user_id = $1)`,
        [userIdA, userIdB],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// FoodListAffinityRepo Implementation
// ---------------------------------------------------------------------------

export function createFoodListAffinityRepo(
  pool: DbPool,
  foodListRepo: FoodListRepo,
): FoodListAffinityRepo {
  return {
    async like(listId: string, userId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const access = await getListAccess(client as unknown as DbPool, listId, userId);
        assertViewAccess(access, userId);

        const checkRes = await client.query<{ food_list_id: string }>(
          `SELECT food_list_id FROM food_list_likes WHERE food_list_id = $1 AND user_id = $2`,
          [listId, userId],
        );
        if (checkRes.rows.length > 0) {
          await client.query('COMMIT');
          return;
        }

        await client.query(
          `INSERT INTO food_list_likes (food_list_id, user_id) VALUES ($1, $2)`,
          [listId, userId],
        );

        await client.query(
          `UPDATE food_lists SET like_count = like_count + 1, updated_at = now() WHERE id = $1`,
          [listId],
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async unlike(listId: string, userId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const delRes = await client.query<{ food_list_id: string }>(
          `DELETE FROM food_list_likes WHERE food_list_id = $1 AND user_id = $2 RETURNING food_list_id`,
          [listId, userId],
        );

        if (delRes.rows.length > 0) {
          await client.query(
            `UPDATE food_lists SET like_count = GREATEST(0, like_count - 1), updated_at = now() WHERE id = $1`,
            [listId],
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async save(listId: string, userId: string): Promise<void> {
      const access = await getListAccess(pool, listId, userId);
      assertViewAccess(access, userId);

      if (access!.owner_id === userId) {
        throw new AppError('food_list_save_self', 'Cannot save your own food list');
      }

      const existingRes = await pool.query<{ food_list_id: string }>(
        `SELECT food_list_id FROM food_list_saves WHERE food_list_id = $1 AND saved_by_user_id = $2`,
        [listId, userId],
      );
      if (existingRes.rows.length > 0) {
        return;
      }

      await pool.query(
        `INSERT INTO food_list_saves (food_list_id, saved_by_user_id) VALUES ($1, $2)`,
        [listId, userId],
      );
    },

    async unsave(listId: string, userId: string): Promise<void> {
      await pool.query(
        `DELETE FROM food_list_saves WHERE food_list_id = $1 AND saved_by_user_id = $2`,
        [listId, userId],
      );
    },

    async getCollection(userId: string): Promise<FoodListCollectionDTO> {
      const owned = await foodListRepo.listOwned(userId);

      const hasTrips = await isTripTableAvailable(pool);
      const tripCondition = hasTrips ? 'OR tm_save.trip_id IS NOT NULL' : '';
      const tripJoin = hasTrips
        ? `LEFT JOIN trip_food_lists tfl_save ON tfl_save.food_list_id = fl.id
           LEFT JOIN trip_memberships tm_save ON tm_save.trip_id = tfl_save.trip_id AND tm_save.user_id = $1`
        : '';

      const savedRes = await pool.query<{
        raw_food_list_id: string;
        id: string | null;
        owner_id: string | null;
        owner_display_name: string | null;
        name: string | null;
        visibility: 'private' | 'public' | null;
        is_checklist: boolean | null;
        like_count: number | null;
        item_count: number | null;
        created_at: Date | string | null;
        updated_at: Date | string | null;
        pinned_at: Date | string | null;
        can_view: boolean;
      }>(
        `SELECT
           fls_user.food_list_id AS raw_food_list_id,
           fl.id,
           fl.owner_id,
           COALESCE(p.display_name, 'User') AS owner_display_name,
           fl.name,
           fl.visibility,
           fl.is_checklist,
           fl.like_count,
           COALESCE(ic.item_count, 0)::int AS item_count,
           fl.created_at,
           fl.updated_at,
           fl.pinned_at,
           (fl.id IS NOT NULL AND (
             fl.visibility = 'public'
             OR fl.owner_id = $1
             OR shares.role IS NOT NULL
             ${tripCondition}
           )) AS can_view
         FROM food_list_saves fls_user
         LEFT JOIN food_lists fl ON fl.id = fls_user.food_list_id
         LEFT JOIN profiles p ON p.user_id = fl.owner_id
         LEFT JOIN food_list_shares shares
           ON shares.food_list_id = fl.id AND shares.shared_with_user_id = $1
         ${tripJoin}
         LEFT JOIN (
           SELECT food_list_id, COUNT(*)::int AS item_count
           FROM food_lists_items
           GROUP BY food_list_id
         ) ic ON ic.food_list_id = fl.id
        WHERE fls_user.saved_by_user_id = $1
        ORDER BY fls_user.saved_at DESC`,
        [userId],
      );

      const saved = savedRes.rows.map((row) => {
        if (row.can_view && row.id) {
          return {
            available: true as const,
            id: row.id,
            ownerId: row.owner_id!,
            ownerDisplayName: row.owner_display_name!,
            name: row.name!,
            visibility: row.visibility!,
            isChecklist: Boolean(row.is_checklist),
            likeCount: Number(row.like_count),
            itemCount: Number(row.item_count),
            createdAt: toIsoString(row.created_at!),
            updatedAt: toIsoString(row.updated_at!),
            pinnedAt: row.pinned_at === null ? null : toIsoString(row.pinned_at),
          };
        }
        return {
          available: false as const,
          foodListId: row.raw_food_list_id,
        };
      });

      return {
        owned,
        saved,
      };
    },
  };
}
