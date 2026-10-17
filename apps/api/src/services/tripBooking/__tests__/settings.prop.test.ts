import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { applySettingsUpdate, type BookingSettingsUpdate } from '../settings.js';
import type { StoredBookingSettings } from '../timeline.js';
import {
  STAY_TYPES,
  LIGHTNING_LANE_TIMINGS,
  addCalendarDays,
  isCheckInOverrideValid,
  type StayType,
  type LightningLaneTiming,
} from '@dwt/shared';
import { AppError } from '../../../errors/AppError.js';

const currentSettingsArb: fc.Arbitrary<StoredBookingSettings> = fc.record({
  stayType: fc.constantFrom<StayType | null>(null, ...STAY_TYPES),
  lightningLaneTiming: fc.constantFrom<LightningLaneTiming | null>(null, ...LIGHTNING_LANE_TIMINGS),
  checkInOverride: fc.constantFrom<string | null>(null, '2025-06-01', '2025-05-15'),
});

describe('settings.prop.test.ts', () => {
  // Feature: trip-booking-timeline, Property 7: Booking-settings updates are null-aware, merge-only, and atomic
  it('Property 7: Booking-settings updates are null-aware, merge-only, and atomic', () => {
    fc.assert(
      fc.property(
        currentSettingsArb,
        fc.constantFrom('2025-06-15', '2025-01-01', '2025-12-01'),
        fc.record({
          includeStayType: fc.boolean(),
          stayTypeVal: fc.constantFrom<StayType | null>(null, ...STAY_TYPES),
          includeLLTiming: fc.boolean(),
          llTimingVal: fc.constantFrom<LightningLaneTiming | null>(null, ...LIGHTNING_LANE_TIMINGS),
          includeOverride: fc.boolean(),
          overrideOffset: fc.constantFrom<number | null>(null, -40, -31, -30, -10, 0, 1, 10),
        }),
        (current, tripStart, u) => {
          // Freeze current to verify no mutation
          const frozenCurrent = Object.freeze({ ...current });

          const update: BookingSettingsUpdate = {};
          if (u.includeStayType) update.stayType = u.stayTypeVal;
          if (u.includeLLTiming) update.lightningLaneTiming = u.llTimingVal;
          if (u.includeOverride) {
            update.checkInOverride =
              u.overrideOffset !== null ? addCalendarDays(tripStart, u.overrideOffset) : null;
          }

          const hasKeys =
            u.includeStayType || u.includeLLTiming || u.includeOverride;

          const isOverrideValid =
            !u.includeOverride ||
            update.checkInOverride === null ||
            (update.checkInOverride !== undefined &&
              isCheckInOverrideValid(update.checkInOverride, tripStart));

          if (!hasKeys || !isOverrideValid) {
            // Must throw trip_validation_failed and leave current unchanged
            expect(() => applySettingsUpdate(frozenCurrent, update, tripStart)).toThrow(AppError);
            try {
              applySettingsUpdate(frozenCurrent, update, tripStart);
            } catch (err) {
              expect(err).toBeInstanceOf(AppError);
              expect((err as AppError).code).toBe('trip_validation_failed');
            }
            expect(frozenCurrent).toEqual(current);
          } else {
            const result = applySettingsUpdate(frozenCurrent, update, tripStart);

            // Null-aware overwrite
            if (u.includeStayType) {
              expect(result.stayType).toBe(u.stayTypeVal);
            } else {
              expect(result.stayType).toBe(current.stayType);
            }

            if (u.includeLLTiming) {
              expect(result.lightningLaneTiming).toBe(u.llTimingVal);
            } else {
              expect(result.lightningLaneTiming).toBe(current.lightningLaneTiming);
            }

            if (u.includeOverride) {
              expect(result.checkInOverride).toBe(update.checkInOverride);
            } else {
              expect(result.checkInOverride).toBe(current.checkInOverride);
            }

            // Caller's current input is untouched
            expect(frozenCurrent).toEqual(current);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
