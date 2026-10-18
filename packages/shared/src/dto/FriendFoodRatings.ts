import type { Park } from '../enums.js';
import type { AvatarPresetId } from '../constants/avatarPresets.js';
import type { FRIEND_FOOD_SORTS } from '../constants/friendFoodRatings.js';

export type FriendFoodSort = (typeof FRIEND_FOOD_SORTS)[number];
export type FoodScopeKind = 'experience' | 'location';

/** One row per distinct dish. No note, no log id, no per-log timestamps (R5). */
export interface FriendDishRatingDTO {
  readonly foodItemId: string;
  readonly foodItemName: string;
  readonly scopeKind: FoodScopeKind;
  readonly scopeId: string;
  readonly scopeName: string;
  /** COALESCE(experiences.park, user_submitted_locations.park); locations always have one, null only for a park-less Experience (R4.6). */
  readonly park: Park | null;
  /** Continuous mean of rated logs, in [1,10]; null when the dish has no rated log (R4.5, R16). */
  readonly averageRating: number | null;
  readonly ratedLogCount: number;
  readonly logCount: number;
  /** YYYY-MM-DD */
  readonly latestVisitedOn: string;
}

export interface FriendFoodScopeDTO {
  readonly kind: FoodScopeKind;
  readonly id: string;
  readonly name: string;
  /** Same COALESCE as FriendDishRatingDTO.park (R4.6). */
  readonly park: Park | null;
  readonly dishCount: number;
}

export interface FriendFoodRatingsPageDTO {
  readonly items: readonly FriendDishRatingDTO[];
  readonly nextCursor: string | null;
  /** Present (possibly empty) on the first page; null on continuation pages (R6.8, R13.1). */
  readonly scopes: readonly FriendFoodScopeDTO[] | null;
}

export interface FriendDishFriendRatingDTO {
  readonly friendId: string;
  readonly displayName: string;
  readonly avatarPreset: AvatarPresetId | null;
  readonly averageRating: number; // always non-null here: rated logs only
  readonly ratedLogCount: number;
  readonly logCount: number;
  readonly latestVisitedOn: string;
}

export interface FriendDishSocialProofDTO {
  readonly foodItemId: string;
  /** All Friends who rated this dish (not capped by `friends`). */
  readonly friendCount: number;
  /** Mean of the per-friend averages, continuous (R14.4, R16). */
  readonly friendsAverageRating: number;
  /** At most FRIEND_FOOD_INLINE_MAX_FRIENDS, ordered per R14.4. */
  readonly friends: readonly FriendDishFriendRatingDTO[];
}

export interface FriendFoodSocialProofResponseDTO {
  readonly items: readonly FriendDishSocialProofDTO[];
}
