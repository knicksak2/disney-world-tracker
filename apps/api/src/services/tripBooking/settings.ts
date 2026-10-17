import { z } from 'zod';
import {
  bookingSettingsUpdateSchema,
  isCheckInOverrideValid,
} from '@dwt/shared';
import { AppError } from '../../errors/AppError.js';
import type { StoredBookingSettings } from './timeline.js';

export type BookingSettingsUpdate = z.infer<typeof bookingSettingsUpdateSchema>;

/**
 * Pure merge: supplied keys (including null) overwrite; omitted keys are untouched.
 * Throws AppError('trip_validation_failed') when checkInOverride is non-null and
 * !isCheckInOverrideValid(override, tripStart), or if no keys are supplied.
 * All-or-nothing.
 */
export function applySettingsUpdate(
  current: StoredBookingSettings,
  update: BookingSettingsUpdate,
  tripStart: string
): StoredBookingSettings {
  if (
    update.stayType === undefined &&
    update.lightningLaneTiming === undefined &&
    update.checkInOverride === undefined
  ) {
    throw new AppError('trip_validation_failed', 'At least one setting must be supplied');
  }

  if (
    update.checkInOverride !== undefined &&
    update.checkInOverride !== null &&
    !isCheckInOverrideValid(update.checkInOverride, tripStart)
  ) {
    throw new AppError('trip_validation_failed', 'Invalid check-in override date', {
      field: 'checkInOverride',
    });
  }

  return {
    stayType: update.stayType !== undefined ? update.stayType : current.stayType,
    lightningLaneTiming:
      update.lightningLaneTiming !== undefined
        ? update.lightningLaneTiming
        : current.lightningLaneTiming,
    checkInOverride:
      update.checkInOverride !== undefined
        ? update.checkInOverride
        : current.checkInOverride,
  };
}
