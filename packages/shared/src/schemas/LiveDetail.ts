/**
 * Zod schema for `LiveDetailDTO` (and the `LiveDetailResponseDTO` envelope).
 *
 * Validates the projected live shape that the `Live_Service` serves:
 *   - `status`             always present, one of the OperatingStatus values (R1.3, R1.4)
 *   - `waitMinutes`        optional whole number in [0, 1440] (R1.5, R1.6)
 *   - `singleRiderWaitMinutes` optional whole number in [0, 1440] (R1.11, R1.12)
 *   - `forecast`           optional ordered series, each bounded entry (R1.16, R1.17)
 *   - `showtimes`          always an array (possibly empty) (R1.7, R1.18)
 *   - `operatingHours`     always an array (possibly empty) (R1.19)
 *   - `diningAvailability` always an array (possibly empty), each entry
 *                          carrying optional walk-up status/party-size/wait (R1.20, R1.21)
 *   - `lightningLane`      optional coarse Lightning Lane state (ThemeParks.wiki, R11.6)
 *   - `boardingGroup`      optional boarding-group status (ThemeParks.wiki, R11.7)
 *   - `upstreamLastUpdated` optional, distinct from Retrieved_At (R1.22)
 *
 * `lightningLane` and `boardingGroup` are sourced solely from ThemeParks.wiki
 * and are omitted whenever the upstream does not provide them (R11.6, R11.7,
 * R11.8).
 *
 * All times are ISO-8601 UTC instants on the wire; the App renders them in the
 * Park's local time zone.
 *
 * Validates: Requirements 1.2, 1.10, 1.17, 1.21, 1.22, 2.5, 11.6, 11.7, 11.8
 */

import { z } from 'zod';

import { isoTimestampSchema } from './primitives.js';

/** Whole number of minutes in [0, 1440] (R1.5, R1.6, R1.11, R1.12). */
const waitMinutesSchema = z.number().int().min(0).max(1440);

/** Operating_Status enum (R1.3, R1.4). */
export const operatingStatusSchema = z.enum([
  'Operating',
  'Closed',
  'Down',
  'Refurbishment',
  'Unknown',
]);

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
    status: z.string().optional(),
    partySize: z.number().int().optional(),
    estimatedWaitMinutes: waitMinutesSchema.optional(),
  })
  .strict();

/**
 * Coarse Lightning Lane price + return-window state (R11.6). ThemeParks.wiki
 * only; every field is optional so the projection can omit absent/unparseable
 * values (R11.8).
 */
export const lightningLaneStateSchema = z
  .object({
    available: z.boolean().optional(),
    price: z
      .object({
        amount: z.number(),
        currency: z.string(),
      })
      .strict()
      .optional(),
    returnStart: isoTimestampSchema.optional(),
    returnEnd: isoTimestampSchema.optional(),
    state: z.string().optional(),
  })
  .strict();

/**
 * Boarding-group / virtual-queue status (R11.7). ThemeParks.wiki only; every
 * field is optional so the projection can omit absent/unparseable values
 * (R11.8).
 */
export const boardingGroupStateSchema = z
  .object({
    available: z.boolean().optional(),
    currentGroupStart: z.number().int().optional(),
    currentGroupEnd: z.number().int().optional(),
    state: z.string().optional(),
  })
  .strict();

export const liveDetailSchema = z
  .object({
    status: operatingStatusSchema,
    waitMinutes: waitMinutesSchema.optional(),
    singleRiderWaitMinutes: waitMinutesSchema.optional(),
    forecast: z.array(forecastEntrySchema).optional(),
    showtimes: z.array(showtimeSchema),
    operatingHours: z.array(operatingHoursSchema),
    diningAvailability: z.array(diningAvailabilityEntrySchema),
    lightningLane: lightningLaneStateSchema.optional(),
    boardingGroup: boardingGroupStateSchema.optional(),
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
