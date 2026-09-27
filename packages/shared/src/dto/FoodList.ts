/**
 * DTO contracts for the Food Lists feature.
 *
 * Single source of truth shared between `apps/api` and `apps/mobile`.
 * Validates: Requirements 1-11
 */

export interface FoodListDTO {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly name: string;
  readonly visibility: 'private' | 'public';
  readonly isChecklist: boolean;
  readonly likeCount: number;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FoodListItemDTO {
  readonly foodItemId: string;
  readonly name: string;
  /**
   * Exactly one of `experienceId`/`locationId` is non-null, mirroring
   * `food-item-logging`'s `FoodItemDTO` (that spec's Requirement 6 lets a
   * Food_Item be scoped to a User_Submitted_Location instead of a catalog
   * Restaurant_Experience, e.g. an uncatalogued snack cart). `locationName`
   * is populated from `user_submitted_locations.name` in that case.
   */
  readonly experienceId: string | null;
  readonly experienceName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly price: string | null;
  readonly position: number;
  /** `null` when the contributing User's account has since been deleted (ON DELETE SET NULL). */
  readonly addedByUserId: string | null;
  readonly addedByDisplayName: string | null;
  /** Present only when the parent Food_List's `isChecklist` is `true` (Requirement 13.3, 13.4). */
  readonly gotten?: boolean;
  /**
   * The 1-10 rating from the User's most recent qualifying `Food_Item_Log`
   * for this item (Requirement 13.7's repeat-log allowance — "most recent"
   * is the same tie-break this codebase already uses elsewhere), or `null`
   * if that log carried no rating. Present only when `gotten` is `true`;
   * absent entirely (not merely `null`) when the list isn't a checklist or
   * the item isn't yet gotten.
   */
  readonly rating?: number | null | undefined;
  /**
   * The id of the most recent qualifying Food_Item_Log that marked this item
   * as gotten (Requirement 13.23). Present only when `gotten` is `true`.
   */
  readonly logId?: string | null | undefined;
}

/** The requesting User's access level on a Food_List (Requirement 7.1, 7.3). */
export type FoodListRole = 'owner' | 'editor' | 'viewer';

export interface FoodListDetailDTO extends FoodListDTO {
  readonly liked: boolean;
  readonly saved: boolean;
  /** Optimistic-concurrency counter (Requirement 2.5, 2.7) — echo back as `expectedVersion` on the next reorder. */
  readonly version: number;
  readonly myRole: FoodListRole;
  readonly items: readonly FoodListItemDTO[];
  /** Present only when `isChecklist` is `true` (Requirement 13.9). */
  readonly gottenCount?: number;
}

export interface FoodListCollectionDTO {
  readonly owned: readonly FoodListDTO[];
  readonly saved: readonly (
    | ({ readonly available: true } & FoodListDTO)
    | { readonly available: false; readonly foodListId: string }
  )[];
}

export interface FoodListDiscoveryPageDTO {
  readonly items: readonly FoodListDTO[];
  readonly nextCursor: string | null;
}

export type FoodListVisibility = 'private' | 'public';

export interface CreateFoodListInputDTO {
  readonly name: string;
  readonly visibility?: FoodListVisibility | undefined;
  /** Defaults server-side to `false` when omitted (Requirement 13.1). */
  readonly isChecklist?: boolean | undefined;
}

export interface UpdateFoodListInputDTO {
  readonly name?: string;
  readonly visibility?: FoodListVisibility;
  /** Requirement 13.2 — symmetric with `visibility`'s existing update path. */
  readonly isChecklist?: boolean | undefined;
}

export interface AddFoodListItemInputDTO {
  readonly foodItemId: string;
}

export interface ReorderFoodListItemsInputDTO {
  readonly foodItemIds: readonly string[];
  /** The `version` last read for this list (Requirement 2.5, 2.7); a mismatch at write time is rejected as stale. */
  readonly expectedVersion: number;
}

export type FoodListShareRole = 'viewer' | 'editor';

export interface ShareFoodListInputDTO {
  readonly recipientId: string;
  readonly role: FoodListShareRole;
}

/** Backs the mobile "Manage sharing" surface (Requirement 9.8). */
export interface FoodListShareDTO {
  readonly recipientId: string;
  readonly recipientDisplayName: string;
  readonly role: FoodListShareRole;
  readonly sharedAt: string; // ISO-8601 UTC
}
