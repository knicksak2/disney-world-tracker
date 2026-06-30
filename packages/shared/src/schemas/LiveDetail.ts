/**
 * Zod schema for `LiveDetailDTO` (and the `LiveDetailResponseDTO` envelope).
 *
 * Validates the projected live shape that the `Live_Service` serves:
 *   - `status`             always present, one of the OperatingStatus values (R1.3, R1.4)
 *   - `waitMinutes`        optional whole number in [0, 1440] (R1.5, R1.6)
 *   - `singleRiderWaitMinutes` optional whole number in [0, 1440] (R1.11, R1.12)
 *   - `returnWindow` / `paidReturnWindow` optional, state-enum + optional times;
 *                          paid carries the upstream price strings verbatim (R1.13, R1.14)
 *   - `boardingGroup`      optional allocation-enum + optional numbers/time/wait (R1.15)
 *   - `forecast`           optional ordered series, each bounded entry (R1.16, R1.17)
 *   - `showtimes`          always an array (possibly empty) (R1.7, R1.18)
 *   - `operatingHours`     always an array (possibly empty) (R1.19)
 *   - `diningAvailability` always an array (possibly empty) (R1.20, R1.21)
 *   - `upstreamLastUpdated` optional, distinct from Retrieved_At (R1.22)
 *
 * All times are ISO-8601 UTC instants on the wire; the App renders them in the
 * Park's local time zone.
 *
 * Validates: Requirements 1.2, 1.10, 1.14, 1.17, 1.21, 1.22, 2.5
 */

import { z } from 'zod';

import { isoTimestampSchema } from './primitives.js';

/** Whole number of minutes in [0, 1440] (R1.5, R1.6, R1.11, R1.12, R1.15). */
const waitMinutesSchema = z.number().int().min(0).max(1440);

/** Operating_Status enum (R1.3, R1.4). */
export const operatingStatusSchema = z.enum([
  'Operating',
  'Closed',
  'Down',
  'Refurbishment',
  'Unknown',
]);

/** Return_Window state enum (R1.13). */
export const returnWindowStateSchema = z.enum([
  'Available',
  'Temporarily_Full',
  'Finished',
]);

/** Boarding_Group allocation enum (R1.15). */
export const boardingGroupAllocationSchema = z.enum([
  'Available',
  'Paused',
  'Closed',
]);

export const returnWindowSchema = z
  .object({
    state: returnWindowStateSchema,
    start: isoTimestampSchema.optional(),
    end: isoTimestampSchema.optional(),
  })
  .strict();

export const paidReturnWindowSchema = z
  .object({
    state: returnWindowStateSchema,
    start: isoTimestampSchema.optional(),
    end: isoTimestampSchema.optional(),
    price: z
      .object({
        amount: z.number(),
        currency: z.string(),
        formatted: z.string(),
      })
      .strict(),
  })
  .strict();

export const boardingGroupStatusSchema = z
  .object({
    allocation: boardingGroupAllocationSchema,
    currentGroupStart: z.number().int().optional(),
    currentGroupEnd: z.number().int().optional(),
    nextAllocationTime: isoTimestampSchema.optional(),
    estimatedWaitMinutes: waitMinutesSchema.optional(),
  })
  .strict();

export const forecastEntrySchema = z
  .object({
    time: isoTimestampSchema,
    waitMinutes: waitMinutesSchema,
    percentage: z.number().min(0).max(100),
  })
  .strict();

export const showtimeSchema = z
  .object({
    start: isoTimestampSchema,
    end: isoTimestampSchema.optional(),
    type: z.string().optional(),
  })
  .strict();

export const operatingHoursSchema = z
  .object({
    open: isoTimestampSchema,
    close: isoTimestampSchema,
    type: z.string().optional(),
  })
  .strict();

export const diningAvailabilityEntrySchema = z
  .object({
    partySize: z.number().int().optional(),
    estimatedWaitMinutes: waitMinutesSchema.optional(),
  })
  .strict();

export const liveDetailSchema = z
  .object({
    status: operatingStatusSchema,
    waitMinutes: waitMinutesSchema.optional(),
    singleRiderWaitMinutes: waitMinutesSchema.optional(),
    returnWindow: returnWindowSchema.optional(),
    paidReturnWindow: paidReturnWindowSchema.optional(),
    boardingGroup: boardingGroupStatusSchema.optional(),
    forecast: z.array(forecastEntrySchema).optional(),
    showtimes: z.array(showtimeSchema),
    operatingHours: z.array(operatingHoursSchema),
    diningAvailability: z.array(diningAvailabilityEntrySchema),
    upstreamLastUpdated: isoTimestampSchema.optional(),
  })
  .strict();

export const liveDetailResponseSchema = z
  .object({
    liveDetail: liveDetailSchema,
    retrievedAt: isoTimestampSchema,
    stale: z.boolean(),
  })
  .strict();
