/**
 * DTO contracts for the Experience Lists feature.
 *
 * Single source of truth shared between `apps/api` and `apps/mobile`. This
 * is a direct structural port of `FoodList.ts`'s shapes — see that file for
 * the "why" of the collection/discovery/share shapes; only the entity name
 * and the presence of `park`/`category` on the item DTO differ here.
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.5, 3.1, 4.1, 4.3, 7.1
 */

import type { ExperienceCategory, Park } from '../enums.js';

export interface ExperienceListDTO {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerDisplayName: string;
  readonly name: string;
  readonly visibility: 'private' | 'public';
  readonly likeCount: number;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * ISO-8601 UTC timestamp of when the owner pinned this list, or `null` if
   * unpinned. See `FoodListDTO.pinnedAt` for the identical ordering rule
   * this drives in `listOwned`.
   */
  readonly pinnedAt: string | null;
}

export interface ExperienceListItemDTO {
  readonly experienceId: string;
  readonly name: string;
  readonly park: Park | null;
  readonly category: ExperienceCategory;
  readonly position: number;
  /** `null` when the contributing User's account has since been deleted (ON DELETE SET NULL). */
  readonly addedByUserId: string | null;
  readonly addedByDisplayName: string | null;
}

/** The requesting User's access level on an Experience_List (Requirement 7.1, 7.3). */
export type ExperienceListRole = 'owner' | 'editor' | 'viewer';

export interface ExperienceListDetailDTO extends ExperienceListDTO {
  readonly liked: boolean;
  readonly saved: boolean;
  /** Optimistic-concurrency counter (Requirement 2.5, 2.7) — echo back as `expectedVersion` on the next reorder. */
  readonly version: number;
  readonly myRole: ExperienceListRole;
  readonly items: readonly ExperienceListItemDTO[];
}

export interface ExperienceListCollectionDTO {
  readonly owned: readonly ExperienceListDTO[];
  readonly saved: readonly (
    | ({ readonly available: true } & ExperienceListDTO)
    | { readonly available: false; readonly experienceListId: string }
  )[];
}

export interface ExperienceListDiscoveryPageDTO {
  readonly items: readonly ExperienceListDTO[];
  readonly nextCursor: string | null;
}

export type ExperienceListVisibility = 'private' | 'public';

export interface CreateExperienceListInputDTO {
  readonly name: string;
  readonly visibility?: ExperienceListVisibility | undefined;
}

export interface UpdateExperienceListInputDTO {
  readonly name?: string;
  readonly visibility?: ExperienceListVisibility;
  /** `true` pins the list (server stamps `pinnedAt`); `false` unpins it (`pinnedAt` set to `null`). */
  readonly pinned?: boolean | undefined;
}

export interface AddExperienceListItemInputDTO {
  readonly experienceId: string;
}

export interface ReorderExperienceListItemsInputDTO {
  readonly experienceIds: readonly string[];
  /** The `version` last read for this list (Requirement 2.5, 2.7); a mismatch at write time is rejected as stale. */
  readonly expectedVersion: number;
}

export type ExperienceListShareRole = 'viewer' | 'editor';

export interface ShareExperienceListInputDTO {
  readonly recipientId: string;
  readonly role: ExperienceListShareRole;
}

/** Backs the mobile "Manage sharing" surface (Requirement 9.8's Experience_List analogue). */
export interface ExperienceListShareDTO {
  readonly recipientId: string;
  readonly recipientDisplayName: string;
  readonly role: ExperienceListShareRole;
  readonly sharedAt: string; // ISO-8601 UTC
}
