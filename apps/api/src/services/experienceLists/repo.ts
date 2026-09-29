/**
 * Repository for Experience Lists (list-level operations only).
 *
 * Structural port of `apps/api/src/services/foodLists/repo.ts`'s
 * `FoodListRepo` — same constructor-injection style, same SQL patterns, same
 * `AppError`/`ErrorCode` conventions. Item, share, and affinity repos are
 * implemented in later tasks (2.2, 3.1, 4.1) and live in sibling files in
 * this same service directory.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 3.1, 3.2, 3.3, 7.1, 7.2,
 * 7.3; Property 1, Property 4.
 */

import type {
  CreateExperienceListInputDTO,
  ExperienceListCollectionDTO,
  ExperienceListDetailDTO,
  ExperienceListDiscoveryPageDTO,
  ExperienceListDTO,
  ExperienceListItemDTO,
  ExperienceListRole,
  ExperienceListShareDTO,
  ExperienceListShareRole,
  ExperienceListVisibility,
} from '@dwt/shared';


import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';
import { pair } from '../friends/canonicalPair.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * The `{ ownerId, visibility } | null` shape `trips` resolves through its
 * injected port to decide Trip-attachment eligibility (Requirement 14). A
 * simple existence lookup — no access check; the caller (`trips`) performs
 * its own eligibility check against the returned `ownerId`/`visibility`.
 */
export interface ExperienceListAttachEligibility {
  readonly ownerId: string;
  readonly visibility: ExperienceListVisibility;
}

export interface ExperienceListRepo {
  createList(userId: string, input: CreateExperienceListInputDTO): Promise<ExperienceListDTO>;
  renameList(listId: string, userId: string, name: string): Promise<ExperienceListDTO>;
  setVisibility(
    listId: string,
    userId: string,
    visibility: ExperienceListVisibility,
  ): Promise<ExperienceListDTO>;
  setPinned(listId: string, userId: string, pinned: boolean): Promise<ExperienceListDTO>;
  deleteList(listId: string, userId: string): Promise<void>;
  listOwned(userId: string): Promise<readonly ExperienceListDTO[]>;
  getListDetail(listId: string, viewerId: string): Promise<ExperienceListDetailDTO>;
  resolveForAttachEligibility(
    experienceListId: string,
  ): Promise<ExperienceListAttachEligibility | null>;
  discover(
    sort?: 'popular' | 'recent',
    cursor?: string | null,
    limit?: number,
  ): Promise<ExperienceListDiscoveryPageDTO>;
}

/**
 * Structural port of `FoodListItemRepo` — `addItem`/`removeItem`/
 * `reorderItems` with the identical optimistic-concurrency shape, adapted
 * for (1) the dining-ineligibility check `food-lists` has no equivalent of,
 * and (2) `experience_lists_items` referencing `experiences` directly
 * rather than a food-item catalog.
 */
export interface ExperienceListItemRepo {
  addItem(listId: string, userId: string, experienceId: string): Promise<ExperienceListItemDTO>;
  removeItem(listId: string, userId: string, experienceId: string): Promise<void>;
  reorderItems(
    listId: string,
    userId: string,
    experienceIds: readonly string[],
    expectedVersion: number,
  ): Promise<readonly ExperienceListItemDTO[]>;
}

/**
 * Structural port of `FoodListShareResult` — same `action` discriminant
 * (`'created' | 'role_changed' | 'unchanged'`) and optional `previousRole`
 * carried only on a `role_changed` result.
 */
export interface ExperienceListShareResult {
  readonly share: ExperienceListShareDTO;
  readonly action: 'created' | 'role_changed' | 'unchanged';
  readonly previousRole?: ExperienceListShareRole;
}

/**
 * Structural port of `FoodListShareRepo` — owner-only
 * `shareWithFriend`/`revokeShare`/`listShares`, plus the no-owner-check
 * `revokeSharesBetween` invoked from the unfriend flow.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 9.8.
 */
export interface ExperienceListShareRepo {
  shareWithFriend(
    listId: string,
    ownerId: string,
    recipientId: string,
    role: ExperienceListShareRole,
  ): Promise<ExperienceListShareResult>;
  revokeShare(listId: string, ownerId: string, recipientId: string): Promise<void>;
  listShares(listId: string, ownerId: string): Promise<readonly ExperienceListShareDTO[]>;
  revokeSharesBetween(userIdA: string, userIdB: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal Rows and Mappings
// ---------------------------------------------------------------------------

export interface ListAccessRow {
  id: string;
  owner_id: string;
  visibility: ExperienceListVisibility;
  share_role: 'viewer' | 'editor' | null;
  has_trip_access?: boolean;
}

interface ExperienceListRow {
  id: string;
  owner_id: string;
  owner_display_name: string;
  name: string;
  visibility: ExperienceListVisibility;
  like_count: number;
  item_count: number;
  created_at: Date | string;
  updated_at: Date | string;
  pinned_at: Date | string | null;
}

interface ExperienceListItemRow {
  experience_id: string;
  name: string;
  park: string | null;
  category: string;
  position: number;
  added_by_user_id: string | null;
  added_by_display_name: string | null;
}

function toIsoString(val: Date | string): string {
  return typeof val === 'string' ? val : val.toISOString();
}

function mapExperienceListRow(row: ExperienceListRow): ExperienceListDTO {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerDisplayName: row.owner_display_name,
    name: row.name,
    visibility: row.visibility,
    likeCount: Number(row.like_count),
    itemCount: Number(row.item_count),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    pinnedAt: row.pinned_at === null ? null : toIsoString(row.pinned_at),
  };
}

function mapExperienceListItemRow(row: ExperienceListItemRow): ExperienceListItemDTO {
  return {
    experienceId: row.experience_id,
    name: row.name,
    park: (row.park ?? null) as ExperienceListItemDTO['park'],
    category: row.category as ExperienceListItemDTO['category'],
    position: Number(row.position),
    addedByUserId: row.added_by_user_id ?? null,
    addedByDisplayName: row.added_by_display_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Access Evaluation Helpers (Property 1, Property 4)
//
// Property 4's fourth OR-branch (`trip_experience_lists` JOIN
// `trip_memberships`, Requirement 14) is folded into `has_trip_access`
// below and consumed only by `assertViewAccess` — it is a view-access
// widening only; `assertOwner`/`assertEditAccess` treat `has_trip_access`
// only as a "list exists and is viewable" signal for the two-tier
// not-found/forbidden error distinction, exactly mirroring
// `foodLists/repo.ts`'s `has_trip_access` handling — a Trip_Member gains
// no edit rights merely because the list is attached to a Trip they
// belong to.
//
// `isTripTableAvailable` guards against `trip_experience_lists`/
// `trip_memberships` being absent from the schema under test (the
// property-test pg-mem harnesses in this directory only apply migrations
// 0001/0050, not 0015/0051) — mirrors `foodLists/repo.ts`'s identical
// guard for `trip_food_lists`.
// ---------------------------------------------------------------------------

const tripTableAvailable = new WeakMap<DbPool, Promise<boolean>>();

async function isTripTableAvailable(pool: DbPool): Promise<boolean> {
  let p = tripTableAvailable.get(pool);
  if (!p) {
    p = pool
      .query('SELECT 1 FROM trip_experience_lists LIMIT 0')
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
    `SELECT el.id, el.owner_id, el.visibility, els.role AS share_role
       FROM experience_lists el
       LEFT JOIN experience_list_shares els
         ON els.experience_list_id = el.id AND els.shared_with_user_id = $2
      WHERE el.id = $1`,
    [listId, userId],
  );
  const row = res.rows[0];
  if (!row) return null;

  if (row.owner_id !== userId && row.visibility !== 'public' && !row.share_role) {
    if (await isTripTableAvailable(pool)) {
      const tripRes = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM trip_experience_lists tel
           JOIN trip_memberships tm ON tm.trip_id = tel.trip_id
           WHERE tel.experience_list_id = $1 AND tm.user_id = $2
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

/** Requirement 1.5, Property 1 — ownership and existence collapse to the same response. */
export function assertOwner(access: ListAccessRow | null, userId: string): void {
  if (!access) {
    throw new AppError('experience_list_not_found', 'Experience list not found');
  }
  if (access.owner_id === userId) {
    return;
  }
  if (access.visibility === 'public' || access.share_role !== null || access.has_trip_access) {
    throw new AppError('experience_list_edit_forbidden', 'Only the owner can perform this action');
  }
  throw new AppError('experience_list_not_found', 'Experience list not found');
}

/**
 * Property 4 — owner, OR `visibility = 'public'`, OR an active share of
 * either role, OR the list is attached (Requirement 14) to a Trip the
 * User currently belongs to (`has_trip_access`).
 */
export function assertViewAccess(access: ListAccessRow | null, userId: string): void {
  if (!access) {
    throw new AppError('experience_list_not_found', 'Experience list not found');
  }
  if (
    access.owner_id === userId ||
    access.visibility === 'public' ||
    access.share_role !== null ||
    access.has_trip_access
  ) {
    return;
  }
  throw new AppError('experience_list_not_found', 'Experience list not found');
}

/**
 * Requirement 7.3 — the single edit-access predicate reused by every
 * mutating method (`addItem`, `removeItem`, `reorderItems`): owner, OR an
 * active `experience_list_shares` row with `role = 'editor'`.
 *
 * Requirement 2.8, 2.9 — the two-tier rejection: no access at all (not
 * owner, no share, not public) throws `experience_list_not_found`; a
 * viewable-but-not-editable access (public viewer, or a `viewer`-role
 * share) throws `experience_list_edit_forbidden` instead, since the caller
 * already knows the list exists.
 */
export function assertEditAccess(access: ListAccessRow | null, userId: string): void {
  if (!access) {
    throw new AppError('experience_list_not_found', 'Experience list not found');
  }
  if (access.owner_id === userId || access.share_role === 'editor') {
    return;
  }
  if (
    access.visibility === 'public' ||
    access.share_role === 'viewer' ||
    access.has_trip_access
  ) {
    throw new AppError('experience_list_edit_forbidden', 'Editor access required');
  }
  throw new AppError('experience_list_not_found', 'Experience list not found');
}

/**
 * Requirement 7.3 — `hasEditAccess(listId, userId)`: owner OR an active
 * `experience_list_shares` row with `role = 'editor'`. Exported standalone
 * (in addition to `assertEditAccess`, which throws) so callers that only
 * need a boolean check (rather than a mutating-method access gate) can
 * reuse the same predicate without catching an `AppError`.
 */
export async function hasEditAccess(
  pool: DbPool,
  listId: string,
  userId: string,
): Promise<boolean> {
  const access = await getListAccess(pool, listId, userId);
  if (!access) return false;
  return access.owner_id === userId || access.share_role === 'editor';
}

// ---------------------------------------------------------------------------
// ExperienceListRepo Implementation
// ---------------------------------------------------------------------------

export function createExperienceListRepo(pool: DbPool): ExperienceListRepo {
  async function getListSummary(listId: string): Promise<ExperienceListDTO> {
    const res = await pool.query<ExperienceListRow>(
      `SELECT
         el.id,
         el.owner_id,
         COALESCE(p.display_name, 'User') AS owner_display_name,
         el.name,
         el.visibility,
         el.like_count,
         COALESCE(ic.item_count, 0)::int AS item_count,
         el.created_at,
         el.updated_at,
         el.pinned_at
       FROM experience_lists el
       LEFT JOIN profiles p ON p.user_id = el.owner_id
       LEFT JOIN (
         SELECT experience_list_id, COUNT(*)::int AS item_count
         FROM experience_lists_items
         GROUP BY experience_list_id
       ) ic ON ic.experience_list_id = el.id
      WHERE el.id = $1`,
      [listId],
    );
    if (res.rows.length === 0) {
      throw new AppError('experience_list_not_found', 'Experience list not found');
    }
    return mapExperienceListRow(res.rows[0]!);
  }

  return {
    async createList(
      userId: string,
      input: CreateExperienceListInputDTO,
    ): Promise<ExperienceListDTO> {
      const trimmed = input.name.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new AppError(
          'validation_failed',
          'Experience list name must be between 1 and 100 characters',
        );
      }

      const visibility = input.visibility ?? 'private';
      if (visibility !== 'private' && visibility !== 'public') {
        throw new AppError('validation_failed', 'Invalid visibility');
      }

      const insertRes = await pool.query<{ id: string }>(
        `INSERT INTO experience_lists (owner_id, name, visibility)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [userId, trimmed, visibility],
      );

      return getListSummary(insertRes.rows[0]!.id);
    },

    async renameList(listId: string, userId: string, name: string): Promise<ExperienceListDTO> {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new AppError(
          'validation_failed',
          'Experience list name must be between 1 and 100 characters',
        );
      }

      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      await pool.query(
        `UPDATE experience_lists
            SET name = $2, updated_at = now()
          WHERE id = $1`,
        [listId, trimmed],
      );

      return getListSummary(listId);
    },

    async setVisibility(
      listId: string,
      userId: string,
      visibility: ExperienceListVisibility,
    ): Promise<ExperienceListDTO> {
      if (visibility !== 'private' && visibility !== 'public') {
        throw new AppError('validation_failed', 'Invalid visibility');
      }

      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      await pool.query(
        `UPDATE experience_lists
            SET visibility = $2, updated_at = now()
          WHERE id = $1`,
        [listId, visibility],
      );

      return getListSummary(listId);
    },

    async setPinned(listId: string, userId: string, pinned: boolean): Promise<ExperienceListDTO> {
      if (typeof pinned !== 'boolean') {
        throw new AppError('validation_failed', 'pinned must be a boolean');
      }

      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      // Pinning/unpinning does NOT touch `updated_at` — it is a display-order
      // preference, not a content edit, so it must not perturb the
      // recency-based ordering unpinned lists fall back to.
      await pool.query(
        `UPDATE experience_lists
            SET pinned_at = CASE WHEN $2 THEN now() ELSE NULL END
          WHERE id = $1`,
        [listId, pinned],
      );

      return getListSummary(listId);
    },

    async deleteList(listId: string, userId: string): Promise<void> {
      const access = await getListAccess(pool, listId, userId);
      assertOwner(access, userId);

      // ON DELETE CASCADE (migration 0050) removes items/shares/likes/saves.
      await pool.query(`DELETE FROM experience_lists WHERE id = $1`, [listId]);
    },

    async listOwned(userId: string): Promise<readonly ExperienceListDTO[]> {
      const res = await pool.query<ExperienceListRow>(
        `SELECT
           el.id,
           el.owner_id,
           COALESCE(p.display_name, 'User') AS owner_display_name,
           el.name,
           el.visibility,
           el.like_count,
           COALESCE(ic.item_count, 0)::int AS item_count,
           el.created_at,
           el.updated_at,
           el.pinned_at
         FROM experience_lists el
         LEFT JOIN profiles p ON p.user_id = el.owner_id
         LEFT JOIN (
           SELECT experience_list_id, COUNT(*)::int AS item_count
           FROM experience_lists_items
           GROUP BY experience_list_id
         ) ic ON ic.experience_list_id = el.id
        WHERE el.owner_id = $1
        ORDER BY el.pinned_at DESC NULLS LAST, el.updated_at DESC`,
        [userId],
      );

      return res.rows.map(mapExperienceListRow);
    },

    async getListDetail(listId: string, viewerId: string): Promise<ExperienceListDetailDTO> {
      const access = await getListAccess(pool, listId, viewerId);
      assertViewAccess(access, viewerId);

      const listRes = await pool.query<{
        id: string;
        owner_id: string;
        owner_display_name: string;
        name: string;
        visibility: ExperienceListVisibility;
        like_count: number;
        version: number;
        created_at: Date | string;
        updated_at: Date | string;
        pinned_at: Date | string | null;
        liked: boolean;
        saved: boolean;
      }>(
        `SELECT
           el.id,
           el.owner_id,
           COALESCE(p.display_name, 'User') AS owner_display_name,
           el.name,
           el.visibility,
           el.like_count,
           el.version,
           el.created_at,
           el.updated_at,
           el.pinned_at,
           (ell.experience_list_id IS NOT NULL) AS liked,
           (els_save.experience_list_id IS NOT NULL) AS saved
         FROM experience_lists el
         LEFT JOIN profiles p ON p.user_id = el.owner_id
         LEFT JOIN experience_list_likes ell
           ON ell.experience_list_id = el.id AND ell.user_id = $2
         LEFT JOIN experience_list_saves els_save
           ON els_save.experience_list_id = el.id AND els_save.saved_by_user_id = $2
        WHERE el.id = $1`,
        [listId, viewerId],
      );

      const row = listRes.rows[0]!;

      const itemsRes = await pool.query<ExperienceListItemRow>(
        `SELECT
           eli.experience_id,
           e.name,
           e.park,
           e.category,
           eli.position,
           eli.added_by_user_id,
           p.display_name AS added_by_display_name
         FROM experience_lists_items eli
         JOIN experiences e ON e.id = eli.experience_id
         LEFT JOIN profiles p ON p.user_id = eli.added_by_user_id
        WHERE eli.experience_list_id = $1
        ORDER BY eli.position ASC`,
        [listId],
      );
      const items = itemsRes.rows.map(mapExperienceListItemRow);

      let myRole: ExperienceListRole = 'viewer';
      if (access!.owner_id === viewerId) {
        myRole = 'owner';
      } else if (access!.share_role === 'editor') {
        myRole = 'editor';
      }

      const detail: ExperienceListDetailDTO = {
        id: row.id,
        ownerId: row.owner_id,
        ownerDisplayName: row.owner_display_name,
        name: row.name,
        visibility: row.visibility,
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
      };

      return detail;
    },

    async resolveForAttachEligibility(
      experienceListId: string,
    ): Promise<ExperienceListAttachEligibility | null> {
      const res = await pool.query<{ owner_id: string; visibility: ExperienceListVisibility }>(
        `SELECT owner_id, visibility FROM experience_lists WHERE id = $1`,
        [experienceListId],
      );
      const row = res.rows[0];
      if (!row) return null;
      return { ownerId: row.owner_id, visibility: row.visibility };
    },

    async discover(
      sort: 'popular' | 'recent' = 'popular',
      cursor?: string | null,
      limit: number = 20,
    ): Promise<ExperienceListDiscoveryPageDTO> {
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
              el.id,
              el.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              el.name,
              el.visibility,
              el.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              el.created_at,
              el.updated_at,
              el.pinned_at
            FROM experience_lists el
            LEFT JOIN profiles p ON p.user_id = el.owner_id
            LEFT JOIN (
              SELECT experience_list_id, COUNT(*)::int AS item_count
              FROM experience_lists_items
              GROUP BY experience_list_id
            ) ic ON ic.experience_list_id = el.id
            WHERE el.visibility = 'public'
              AND (el.like_count < $2 OR (el.like_count = $2 AND el.id > $3))
            ORDER BY el.like_count DESC, el.id ASC
            LIMIT $1`;
        } else {
          queryText = `
            SELECT
              el.id,
              el.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              el.name,
              el.visibility,
              el.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              el.created_at,
              el.updated_at,
              el.pinned_at
            FROM experience_lists el
            LEFT JOIN profiles p ON p.user_id = el.owner_id
            LEFT JOIN (
              SELECT experience_list_id, COUNT(*)::int AS item_count
              FROM experience_lists_items
              GROUP BY experience_list_id
            ) ic ON ic.experience_list_id = el.id
            WHERE el.visibility = 'public'
            ORDER BY el.like_count DESC, el.id ASC
            LIMIT $1`;
        }
      } else {
        if (parsedCursor) {
          params.push(new Date(String(parsedCursor.k)), parsedCursor.id);
          queryText = `
            SELECT
              el.id,
              el.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              el.name,
              el.visibility,
              el.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              el.created_at,
              el.updated_at,
              el.pinned_at
            FROM experience_lists el
            LEFT JOIN profiles p ON p.user_id = el.owner_id
            LEFT JOIN (
              SELECT experience_list_id, COUNT(*)::int AS item_count
              FROM experience_lists_items
              GROUP BY experience_list_id
            ) ic ON ic.experience_list_id = el.id
            WHERE el.visibility = 'public'
              AND (el.created_at < $2 OR (el.created_at = $2 AND el.id > $3))
            ORDER BY el.created_at DESC, el.id ASC
            LIMIT $1`;
        } else {
          queryText = `
            SELECT
              el.id,
              el.owner_id,
              COALESCE(p.display_name, 'User') AS owner_display_name,
              el.name,
              el.visibility,
              el.like_count,
              COALESCE(ic.item_count, 0)::int AS item_count,
              el.created_at,
              el.updated_at,
              el.pinned_at
            FROM experience_lists el
            LEFT JOIN profiles p ON p.user_id = el.owner_id
            LEFT JOIN (
              SELECT experience_list_id, COUNT(*)::int AS item_count
              FROM experience_lists_items
              GROUP BY experience_list_id
            ) ic ON ic.experience_list_id = el.id
            WHERE el.visibility = 'public'
            ORDER BY el.created_at DESC, el.id ASC
            LIMIT $1`;
        }
      }

      const res = await pool.query<ExperienceListRow>(queryText, params);
      const rows = res.rows;
      const hasMore = rows.length > pageSize;
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
      const items = pageRows.map(mapExperienceListRow);

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
// ExperienceListItemRepo Implementation
//
// Structural port of `foodLists/repo.ts`'s `createFoodListItemRepo` — same
// checked-out-client + raw BEGIN/COMMIT/ROLLBACK transaction shape (foodLists
// does not use `db/pool.ts::withTransaction`, so this mirrors that exactly
// for consistency within the sibling service). Differs from `foodLists` in
// two ways: (1) `addItem` rejects `experience_not_found` and, before the
// duplicate check, `experience_list_dining_ineligible` for a
// `Restaurant`-category Experience (Requirement 2.3); (2) items join
// `experiences` directly rather than a food-item catalog table.
// ---------------------------------------------------------------------------

/**
 * Loads the list row (locked `FOR UPDATE`) and the caller's share role
 * within an open transaction, then applies `assertEditAccess`'s two-tier
 * rejection (Requirement 2.8, 2.9). Shared by `addItem`, `removeItem`, and
 * `reorderItems` so the edit-access predicate is expressed once.
 */
async function loadListForEditWithinTx(
  client: {
    query: <R extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params?: unknown[],
    ) => Promise<{ rows: R[] }>;
  },
  listId: string,
  userId: string,
): Promise<{ id: string; owner_id: string; visibility: ExperienceListVisibility; version: number }> {
  const listRes = await client.query<{
    id: string;
    owner_id: string;
    visibility: ExperienceListVisibility;
    version: number;
  }>(
    `SELECT id, owner_id, visibility, version
       FROM experience_lists
      WHERE id = $1
        FOR UPDATE`,
    [listId],
  );

  if (listRes.rows.length === 0) {
    throw new AppError('experience_list_not_found', 'Experience list not found');
  }
  const list = listRes.rows[0]!;

  const shareRes = await client.query<{ role: 'viewer' | 'editor' }>(
    `SELECT role FROM experience_list_shares
      WHERE experience_list_id = $1 AND shared_with_user_id = $2`,
    [listId, userId],
  );
  const shareRole = shareRes.rows[0]?.role ?? null;

  assertEditAccess(
    {
      id: list.id,
      owner_id: list.owner_id,
      visibility: list.visibility,
      share_role: shareRole,
      // Edit access never widens via Trip attachment (Property 4 is a
      // view-access-only predicate); this field is unused by
      // `assertEditAccess` but required by `ListAccessRow`'s shape.
      has_trip_access: false,
    },
    userId,
  );

  return list;
}

export function createExperienceListItemRepo(pool: DbPool): ExperienceListItemRepo {
  return {
    async addItem(
      listId: string,
      userId: string,
      experienceId: string,
    ): Promise<ExperienceListItemDTO> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await loadListForEditWithinTx(client, listId, userId);

        // Requirement 2.3: experience must exist and be active, checked
        // BEFORE the dining-eligibility check and the duplicate check.
        const experienceRes = await client.query<{ id: string; category: string }>(
          `SELECT id, category FROM experiences WHERE id = $1 AND active = TRUE`,
          [experienceId],
        );
        if (experienceRes.rows.length === 0) {
          throw new AppError('experience_not_found', 'Experience not found');
        }
        const experience = experienceRes.rows[0]!;

        // Requirement 2.3, Property 3: dining exclusion runs BEFORE the
        // duplicate check.
        if (experience.category === 'Restaurant') {
          throw new AppError(
            'experience_list_dining_ineligible',
            'Restaurant experiences cannot be added to an Experience List',
          );
        }

        const dupRes = await client.query<{ id: string }>(
          `SELECT id FROM experience_lists_items
            WHERE experience_list_id = $1 AND experience_id = $2`,
          [listId, experienceId],
        );
        if (dupRes.rows.length > 0) {
          throw new AppError(
            'experience_list_item_duplicate',
            'Experience already in this list',
          );
        }

        const maxRes = await client.query<{ max_pos: number | null }>(
          `SELECT MAX(position) AS max_pos FROM experience_lists_items WHERE experience_list_id = $1`,
          [listId],
        );
        const nextPos =
          maxRes.rows[0]?.max_pos !== null && maxRes.rows[0]?.max_pos !== undefined
            ? Number(maxRes.rows[0].max_pos) + 1
            : 0;

        await client.query(
          `INSERT INTO experience_lists_items (experience_list_id, experience_id, position, added_by_user_id)
           VALUES ($1, $2, $3, $4)`,
          [listId, experienceId, nextPos, userId],
        );

        await client.query(
          `UPDATE experience_lists
              SET version = version + 1, updated_at = now()
            WHERE id = $1`,
          [listId],
        );

        const itemRes = await client.query<ExperienceListItemRow>(
          `SELECT
             eli.experience_id,
             e.name,
             e.park,
             e.category,
             eli.position,
             eli.added_by_user_id,
             p.display_name AS added_by_display_name
           FROM experience_lists_items eli
           JOIN experiences e ON e.id = eli.experience_id
           LEFT JOIN profiles p ON p.user_id = eli.added_by_user_id
          WHERE eli.experience_list_id = $1 AND eli.experience_id = $2`,
          [listId, experienceId],
        );

        await client.query('COMMIT');
        return mapExperienceListItemRow(itemRes.rows[0]!);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    async removeItem(listId: string, userId: string, experienceId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await loadListForEditWithinTx(client, listId, userId);

        // Requirement 2.4: any contributor's item may be removed by any
        // editor/owner; remaining items' relative order (their `position`
        // values) is left untouched — no renumbering.
        const delRes = await client.query<{ id: string }>(
          `DELETE FROM experience_lists_items
            WHERE experience_list_id = $1 AND experience_id = $2
           RETURNING id`,
          [listId, experienceId],
        );

        if (delRes.rows.length > 0) {
          await client.query(
            `UPDATE experience_lists
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
      experienceIds: readonly string[],
      expectedVersion: number,
    ): Promise<readonly ExperienceListItemDTO[]> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const list = await loadListForEditWithinTx(client, listId, userId);

        const currentItemsRes = await client.query<{ experience_id: string }>(
          `SELECT experience_id FROM experience_lists_items WHERE experience_list_id = $1 ORDER BY position ASC`,
          [listId],
        );
        const currentIds = currentItemsRes.rows.map((r) => r.experience_id);

        // Requirement 2.6: id-set mismatch (missing, extra, or duplicate)
        // → `experience_list_reorder_mismatch`, no changes applied.
        if (experienceIds.length !== currentIds.length) {
          throw new AppError(
            'experience_list_reorder_mismatch',
            'Reorder list of experience IDs does not match current list items',
          );
        }
        const currentSet = new Set(currentIds);
        const submittedSet = new Set(experienceIds);
        if (submittedSet.size !== experienceIds.length) {
          throw new AppError(
            'experience_list_reorder_mismatch',
            'Duplicate experience IDs submitted in reorder',
          );
        }
        for (const id of experienceIds) {
          if (!currentSet.has(id)) {
            throw new AppError(
              'experience_list_reorder_mismatch',
              'Submitted experience ID is not in this experience list',
            );
          }
        }

        // Requirement 2.7: stale `version` → `experience_list_stale_write`,
        // no changes applied. Checked after the id-set check so a mismatch
        // is reported even when the version is also stale, matching
        // `foodLists`' check ordering.
        if (Number(list.version) !== expectedVersion) {
          throw new AppError('experience_list_stale_write', 'Experience list version has changed');
        }

        // Pass 1: negative temporary positions to avoid the UNIQUE
        // (experience_list_id, position) collision while reassigning.
        for (let i = 0; i < experienceIds.length; i++) {
          await client.query(
            `UPDATE experience_lists_items
                SET position = $1
              WHERE experience_list_id = $2 AND experience_id = $3`,
            [-1 - i, listId, experienceIds[i]],
          );
        }

        // Pass 2: final positions matching the submitted order.
        for (let i = 0; i < experienceIds.length; i++) {
          await client.query(
            `UPDATE experience_lists_items
                SET position = $1
              WHERE experience_list_id = $2 AND experience_id = $3`,
            [i, listId, experienceIds[i]],
          );
        }

        await client.query(
          `UPDATE experience_lists
              SET version = version + 1, updated_at = now()
            WHERE id = $1`,
          [listId],
        );

        const itemsRes = await client.query<ExperienceListItemRow>(
          `SELECT
             eli.experience_id,
             e.name,
             e.park,
             e.category,
             eli.position,
             eli.added_by_user_id,
             p.display_name AS added_by_display_name
           FROM experience_lists_items eli
           JOIN experiences e ON e.id = eli.experience_id
           LEFT JOIN profiles p ON p.user_id = eli.added_by_user_id
          WHERE eli.experience_list_id = $1
          ORDER BY eli.position ASC`,
          [listId],
        );

        await client.query('COMMIT');
        return itemsRes.rows.map(mapExperienceListItemRow);
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
// ExperienceListShareRepo Implementation
//
// Structural port of `foodLists/repo.ts`'s `createFoodListShareRepo` — same
// owner-only gate via `assertOwner`, same friend-check via
// `canonicalPair.ts`'s `pair`, same created/role_changed/unchanged
// discriminant, same no-owner-check `revokeSharesBetween` for the unfriend
// flow.
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 9.8.
// ---------------------------------------------------------------------------

export function createExperienceListShareRepo(pool: DbPool): ExperienceListShareRepo {
  return {
    async shareWithFriend(
      listId: string,
      ownerId: string,
      recipientId: string,
      role: ExperienceListShareRole,
    ): Promise<ExperienceListShareResult> {
      const access = await getListAccess(pool, listId, ownerId);
      assertOwner(access, ownerId);

      if (recipientId === ownerId) {
        throw new AppError('experience_list_share_not_friend', 'Cannot share with yourself');
      }

      const { lo, hi } = pair(ownerId, recipientId);
      const friendRes = await pool.query(
        `SELECT 1 FROM friendships WHERE user_lo_id = $1 AND user_hi_id = $2`,
        [lo, hi],
      );
      if (friendRes.rows.length === 0) {
        throw new AppError('experience_list_share_not_friend', 'Recipient is not a friend');
      }

      const profileRes = await pool.query<{ display_name: string }>(
        `SELECT display_name FROM profiles WHERE user_id = $1`,
        [recipientId],
      );
      const recipientDisplayName = profileRes.rows[0]?.display_name ?? 'Friend';

      const existingRes = await pool.query<{
        role: ExperienceListShareRole;
        shared_at: Date | string;
      }>(
        `SELECT role, shared_at FROM experience_list_shares
          WHERE experience_list_id = $1 AND shared_with_user_id = $2`,
        [listId, recipientId],
      );

      if (existingRes.rows.length === 0) {
        const insertRes = await pool.query<{ shared_at: Date | string }>(
          `INSERT INTO experience_list_shares (experience_list_id, shared_with_user_id, shared_by_user_id, role)
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
          `UPDATE experience_list_shares
              SET role = $3
            WHERE experience_list_id = $1 AND shared_with_user_id = $2`,
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
        `DELETE FROM experience_list_shares
          WHERE experience_list_id = $1 AND shared_with_user_id = $2`,
        [listId, recipientId],
      );
    },

    async listShares(listId: string, ownerId: string): Promise<readonly ExperienceListShareDTO[]> {
      const access = await getListAccess(pool, listId, ownerId);
      assertOwner(access, ownerId);

      const res = await pool.query<{
        recipient_id: string;
        recipient_display_name: string;
        role: ExperienceListShareRole;
        shared_at: Date | string;
      }>(
        `SELECT
           els.shared_with_user_id AS recipient_id,
           COALESCE(p.display_name, 'User') AS recipient_display_name,
           els.role,
           els.shared_at
         FROM experience_list_shares els
         LEFT JOIN profiles p ON p.user_id = els.shared_with_user_id
        WHERE els.experience_list_id = $1
        ORDER BY els.shared_at ASC`,
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
        `DELETE FROM experience_list_shares
          WHERE (shared_by_user_id = $1 AND shared_with_user_id = $2)
             OR (shared_by_user_id = $2 AND shared_with_user_id = $1)`,
        [userIdA, userIdB],
      );
    },
  };
}

// ---------------------------------------------------------------------------
// ExperienceListAffinityRepo Implementation
//
// Structural port of `foodLists/repo.ts`'s `createFoodListAffinityRepo` —
// same transactional idempotent like/unlike (denormalized `like_count`
// incremented/decremented in the same transaction as the
// insert/delete), same view-access-gated save/unsave, same
// self-save rejection, same batched `getCollection` shape. Like
// `foodLists`' own `getCollection`, this one's `can_view` computed column
// includes the trip-attachment OR-branch (Property 4, Requirement 14) via
// `trip_experience_lists` JOIN `trip_memberships`.
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8.
// ---------------------------------------------------------------------------

export interface ExperienceListAffinityRepo {
  like(listId: string, userId: string): Promise<void>;
  unlike(listId: string, userId: string): Promise<void>;
  save(listId: string, userId: string): Promise<void>;
  unsave(listId: string, userId: string): Promise<void>;
  getCollection(userId: string): Promise<ExperienceListCollectionDTO>;
}

export function createExperienceListAffinityRepo(
  pool: DbPool,
  experienceListRepo: ExperienceListRepo,
): ExperienceListAffinityRepo {
  return {
    async like(listId: string, userId: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const access = await getListAccess(client as unknown as DbPool, listId, userId);
        assertViewAccess(access, userId);

        // Requirement 6.1: idempotent — an existing like is a no-op, not a
        // duplicate-key error and not a second `like_count` increment.
        const checkRes = await client.query<{ experience_list_id: string }>(
          `SELECT experience_list_id FROM experience_list_likes
            WHERE experience_list_id = $1 AND user_id = $2`,
          [listId, userId],
        );
        if (checkRes.rows.length > 0) {
          await client.query('COMMIT');
          return;
        }

        await client.query(
          `INSERT INTO experience_list_likes (experience_list_id, user_id) VALUES ($1, $2)`,
          [listId, userId],
        );

        await client.query(
          `UPDATE experience_lists
              SET like_count = like_count + 1, updated_at = now()
            WHERE id = $1`,
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

        // Requirement 6.3: idempotent — deleting a non-existent like is a
        // no-op; `like_count` is only decremented when a row actually
        // existed to delete, and never below zero (`GREATEST(0, ...)`).
        const delRes = await client.query<{ experience_list_id: string }>(
          `DELETE FROM experience_list_likes
            WHERE experience_list_id = $1 AND user_id = $2
           RETURNING experience_list_id`,
          [listId, userId],
        );

        if (delRes.rows.length > 0) {
          await client.query(
            `UPDATE experience_lists
                SET like_count = GREATEST(0, like_count - 1), updated_at = now()
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

    async save(listId: string, userId: string): Promise<void> {
      // Requirement 6.5: no view access at all → `experience_list_not_found`.
      const access = await getListAccess(pool, listId, userId);
      assertViewAccess(access, userId);

      // Requirement 6.6: a User may not save their own list.
      if (access!.owner_id === userId) {
        throw new AppError('experience_list_save_self', 'Cannot save your own experience list');
      }

      // Idempotent — an existing save is a no-op.
      const existingRes = await pool.query<{ experience_list_id: string }>(
        `SELECT experience_list_id FROM experience_list_saves
          WHERE experience_list_id = $1 AND saved_by_user_id = $2`,
        [listId, userId],
      );
      if (existingRes.rows.length > 0) {
        return;
      }

      await pool.query(
        `INSERT INTO experience_list_saves (experience_list_id, saved_by_user_id) VALUES ($1, $2)`,
        [listId, userId],
      );
    },

    async unsave(listId: string, userId: string): Promise<void> {
      await pool.query(
        `DELETE FROM experience_list_saves
          WHERE experience_list_id = $1 AND saved_by_user_id = $2`,
        [listId, userId],
      );
    },

    async getCollection(userId: string): Promise<ExperienceListCollectionDTO> {
      const owned = await experienceListRepo.listOwned(userId);

      const hasTrips = await isTripTableAvailable(pool);
      const tripCondition = hasTrips ? 'OR tm_save.trip_id IS NOT NULL' : '';
      const tripJoin = hasTrips
        ? `LEFT JOIN trip_experience_lists tel_save ON tel_save.experience_list_id = el.id
           LEFT JOIN trip_memberships tm_save ON tm_save.trip_id = tel_save.trip_id AND tm_save.user_id = $1`
        : '';

      const savedRes = await pool.query<{
        raw_experience_list_id: string;
        id: string | null;
        owner_id: string | null;
        owner_display_name: string | null;
        name: string | null;
        visibility: ExperienceListVisibility | null;
        like_count: number | null;
        item_count: number | null;
        created_at: Date | string | null;
        updated_at: Date | string | null;
        pinned_at: Date | string | null;
        can_view: boolean;
      }>(
        `SELECT
           els_user.experience_list_id AS raw_experience_list_id,
           el.id,
           el.owner_id,
           COALESCE(p.display_name, 'User') AS owner_display_name,
           el.name,
           el.visibility,
           el.like_count,
           COALESCE(ic.item_count, 0)::int AS item_count,
           el.created_at,
           el.updated_at,
           el.pinned_at,
           (el.id IS NOT NULL AND (
             el.visibility = 'public'
             OR el.owner_id = $1
             OR shares.role IS NOT NULL
             ${tripCondition}
           )) AS can_view
         FROM experience_list_saves els_user
         LEFT JOIN experience_lists el ON el.id = els_user.experience_list_id
         LEFT JOIN profiles p ON p.user_id = el.owner_id
         LEFT JOIN experience_list_shares shares
           ON shares.experience_list_id = el.id AND shares.shared_with_user_id = $1
         ${tripJoin}
         LEFT JOIN (
           SELECT experience_list_id, COUNT(*)::int AS item_count
           FROM experience_lists_items
           GROUP BY experience_list_id
         ) ic ON ic.experience_list_id = el.id
        WHERE els_user.saved_by_user_id = $1
        ORDER BY els_user.saved_at DESC`,
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
            likeCount: Number(row.like_count),
            itemCount: Number(row.item_count),
            createdAt: toIsoString(row.created_at!),
            updatedAt: toIsoString(row.updated_at!),
            pinnedAt: row.pinned_at === null ? null : toIsoString(row.pinned_at),
          };
        }
        return {
          available: false as const,
          experienceListId: row.raw_experience_list_id,
        };
      });

      return {
        owned,
        saved,
      };
    },
  };
}
