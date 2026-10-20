import type { Park } from '../enums.js';
import type {
  PhotoTargetKind,
  PhotoStatus,
  PhotoRejectReason,
} from '../constants/photos.js';

export interface PhotoUploaderDTO {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarPreset: string | null;
}

export interface PhotoUploadSlotDTO {
  readonly photoId: string;
  readonly putUrl: string;
  readonly thumbPutUrl: string;
  readonly expiresAt: string;
}

export interface PhotoInitiateResponseDTO {
  readonly slots: readonly PhotoUploadSlotDTO[];
}

export interface PhotoConfirmResultDTO {
  readonly photoId: string;
  readonly result: 'accepted' | 'already' | 'incomplete' | 'invalid';
}

export interface PhotoConfirmResponseDTO {
  readonly results: readonly PhotoConfirmResultDTO[];
}

export interface MyPhotoDTO {
  readonly id: string;
  readonly targetKind: PhotoTargetKind;
  readonly targetId: string;
  readonly scopeId: string;
  readonly status: PhotoStatus;
  readonly rejectReason: PhotoRejectReason | null;
  readonly rejectMessage: string | null;
  readonly thumbUrl: string | null;
  readonly url: string | null;
  readonly width: number;
  readonly height: number;
  readonly feedItemId: string | null;
  readonly createdAt: string;
}

export interface MyPhotoStatusResponseDTO {
  readonly photos: readonly MyPhotoDTO[];
}

export interface FoodPhotoDTO {
  readonly id: string;
  readonly foodItemId: string;
  readonly thumbUrl: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly createdDay: string;
  readonly uploader: PhotoUploaderDTO | null;
  readonly mine: boolean;
}

export interface RestaurantFoodPhotoDTO extends FoodPhotoDTO {
  readonly foodItemName: string;
}

export interface TripPhotoDTO {
  readonly id: string;
  readonly tripId: string;
  readonly thumbUrl: string | null;
  readonly url: string | null;
  readonly width: number;
  readonly height: number;
  readonly sortAt: string;
  readonly createdAt: string;
  readonly uploader: PhotoUploaderDTO;
  readonly mine: boolean;
  readonly status: PhotoStatus;
  readonly feedItemId: string | null;
}

export type TripPostSlotState = 'ready' | 'checking' | 'removed' | 'unavailable';

export interface TripPostPhotoSlotDTO {
  readonly photoId: string;
  readonly state: TripPostSlotState;
  readonly mine: boolean;
  readonly status: PhotoStatus | null;
  readonly thumbUrl: string | null;
  readonly url: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface SharedSummaryPhotoDTO {
  readonly id: string;
  readonly thumbUrl: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly sortAt: string;
  readonly mine?: boolean | undefined;
}

export interface TripSummaryPhotosDTO {
  readonly access: 'granted' | 'not_included' | 'unavailable';
  readonly photos: readonly SharedSummaryPhotoDTO[];
}

export interface TripRecapSuperlativeDTO {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly experienceName?: string;
  readonly value?: string | number;
  readonly memberDisplayName?: string;
}

/**
 * One top-rated row of a shared recap. `park`, `category` and `imageUrl` are public
 * catalog data (decision D34) and are present only when the Experience has them.
 * There is deliberately no `experienceId` and no per-member field.
 */
export interface TripRecapTopRatedDTO {
  readonly experienceName: string;
  readonly meanRating: number;
  readonly ratingCount: number;
  readonly park?: Park;
  readonly category?: string;
  readonly imageUrl?: string;
}

export interface TripRecapFiguresDTO {
  readonly distinctExperienceCount: number;
  readonly plannedCompletedCount: number;
  readonly plannedTotalCount: number;
  /** Trip-wide aggregate (decision D34); `0` when the Trip summary omits it. */
  readonly totalCompletionsCount: number;
  /** Trip-wide aggregate (decision D34); `0` when the Trip summary omits it. */
  readonly totalRatingsCount: number;
  /** Count of distinct parks in the Trip summary's park breakdown (decision D34). */
  readonly parksExploredCount: number;
  readonly superlatives: readonly TripRecapSuperlativeDTO[];
  readonly topRated: ReadonlyArray<TripRecapTopRatedDTO>;
}

export interface TripRecapDTO {
  readonly tripId: string;
  readonly tripName: string;
  readonly sharerDisplayName: string;
  readonly recap: TripRecapFiguresDTO | null;
  readonly photos: TripSummaryPhotosDTO;
}

/**
 * GET /me/inbox/:shareId/trip-recap/photos (R15.25 to R15.30, decision D35).
 * Each item has EXACTLY id, thumbUrl, url, width, height, sortAt; `mine` is never set (R15.28).
 */
export interface TripRecapPhotosDTO {
  /** 'granted' | 'not_included' | 'unavailable'; 'unavailable' wins (R15.26). */
  readonly access: TripSummaryPhotosDTO['access'];
  readonly photos: ReadonlyArray<SharedSummaryPhotoDTO>;
  /** Opaque keyset cursor; null on the last page and whenever access != 'granted'. */
  readonly nextCursor: string | null;
}

export interface PhotoPageDTO<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface PhotoClientConfigDTO {
  readonly enabled: boolean;
  readonly foodEnabled: boolean;
  readonly tripEnabled: boolean;
  readonly maxPerFoodLog: number;
  readonly maxPerTrip: number;
  readonly maxFeedPostPhotos: number;
  readonly maxBatch: number;
  readonly maxBytes: number;
  readonly maxThumbBytes: number;
  readonly dailyCap: number;
  readonly remainingToday: number;
  readonly experienceStripMax: number;
}

export interface BlockedUserDTO {
  readonly blockId: string;
  readonly displayName: string | null;
  readonly avatarPreset: string | null;
  readonly createdAt: string;
}
