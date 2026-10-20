/**
 * Shared gate helpers for the recipient-facing recap routes (recap and recap album).
 *
 * Both routes call these two functions so the gate (decision D25, D27, D33) cannot drift
 * between them. No Trip or photo read happens here; the Friendship re-check lives inside
 * `RecapShareGate.resolve`.
 *
 * Implements: Task 21.6
 * Validates: Requirements 15.14, 15.15, 15.26, decision D35
 */

import type { TripSummaryPhotosDTO } from '@dwt/shared';
import { AppError } from '../../errors/AppError.js';
import type { RecapPhotoPort, RecapShareAccess, RecapShareGate } from './ports.js';

export type RecapPhotoAccess = TripSummaryPhotosDTO['access'];

/**
 * Resolves the share for the recipient or throws the collapsed `validation_failed`
 * (non-recipient, deleted share, unknown share and ended Friendship are indistinguishable).
 */
export async function resolveShareAccess(
  gate: RecapShareGate,
  shareId: string,
  userId: string,
): Promise<RecapShareAccess> {
  const access = await gate.resolve(shareId, userId);
  if (!access) {
    throw new AppError('validation_failed', 'Share not found in your inbox.');
  }
  return access;
}

/** `unavailable` wins over `not_included`; no photo port (kill switch) is `unavailable`. */
export function photoAccessFor(
  access: RecapShareAccess,
  port: RecapPhotoPort | undefined,
): RecapPhotoAccess {
  if (!access.tripAvailable) return 'unavailable';
  if (!access.includePhotos) return 'not_included';
  if (!port) return 'unavailable';
  return 'granted';
}
