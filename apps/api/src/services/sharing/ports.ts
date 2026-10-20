/**
 * Structural ports for Sharing service Phase 2 trip recap integration.
 *
 * Implements: Task 21.4
 * Validates: Requirements 15.17, 15.18, 20.2, 20.9
 */

import type { TripRole } from '../trips/permissions.js';
import type { TripSummaryDTO, SharedSummaryPhotoDTO } from '@dwt/shared';

export interface TripShareFacts {
  /**
   * Returns the role of the user in the trip, or null if the user is not a member,
   * the membership was removed, or the trip does not exist.
   */
  roleOf(userId: string, tripId: string): Promise<TripRole | null>;

  /**
   * Returns the trip name, or null when the trip does not exist.
   */
  tripName(tripId: string): Promise<string | null>;

  /**
   * Returns true only when the user is a current member of the trip.
   */
  isMember(userId: string, tripId: string): Promise<boolean>;

  /**
   * Returns the live summary for the trip, or null when the trip does not exist.
   */
  summary(tripId: string): Promise<TripSummaryDTO | null>;
}

export interface RecapShareAccess {
  readonly tripId: string;
  readonly sharerId: string;
  readonly includePhotos: boolean;
  readonly tripAvailable: boolean;
  readonly tripName?: string;
  readonly sharerDisplayName?: string;
}

export interface RecapShareGate {
  resolve(shareId: string, recipientId: string): Promise<RecapShareAccess | null>;
}

export interface RecapAlbumPage {
  readonly photos: SharedSummaryPhotoDTO[];
  readonly nextCursor: string | null;
}

export interface RecapPhotoPort {
  highlights(access: RecapShareAccess, recipientId: string): Promise<SharedSummaryPhotoDTO[]>;
  isHighlight(access: RecapShareAccess, recipientId: string, photoId: string): Promise<boolean>;
  /**
   * One keyset page (newest first) of every approved Trip photo visible to the recipient (D35).
   * Throws AppError('validation_failed') for a malformed cursor.
   */
  albumPage(
    access: RecapShareAccess,
    recipientId: string,
    params: { readonly cursor?: string | undefined; readonly limit: number },
  ): Promise<RecapAlbumPage>;
  /**
   * True when the photo is an approved photo of the share's Trip, not blocked either way with
   * the recipient, and the share allows photos (D35, widens D32).
   */
  isAlbumPhoto(access: RecapShareAccess, recipientId: string, photoId: string): Promise<boolean>;
}
