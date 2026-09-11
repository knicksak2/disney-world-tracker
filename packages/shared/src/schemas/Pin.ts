/**
 * Zod schemas for the pin-collection contracts.
 *
 * `pinSchema` mirrors `PinDTO` (a static catalog entry) and `pinCriteriaSchema`
 * validates the machine-readable `PinCriteria` discriminated union the evaluator
 * consumes. `userPinProgressSchema` mirrors `UserPinProgressDTO` (the per-User
 * Pin Board projection). The tier / track / count-metric enums reuse the runtime
 * tuples from `../enums.js` so the wire values cannot drift from the catalog.
 *
 * Validates: Requirements 1, 3.1, 7, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19
 */

import { z } from 'zod';

import { PARKS, PIN_COUNT_METRICS, PIN_TIERS, PIN_TRACKS } from '../enums.js';
import type { PinCriteria } from '../dto/Pin.js';
import { isoTimestampSchema } from './primitives.js';

/** Pin_Tier enum (R7). */
export const pinTierSchema = z.enum(PIN_TIERS);

/** Pin_Track enum (board grouping). */
export const pinTrackSchema = z.enum(PIN_TRACKS);

/** Pin count-metric enum (the ladders). */
export const pinCountMetricSchema = z.enum(PIN_COUNT_METRICS);

/** A set is satisfied by completing a positive number of members, or all of them. */
const setRequirementSchema = z.union([
  z.number().int().positive(),
  z.literal('all'),
]);

/** Single-day feat, discriminated on `type` (R18). */
const singleDayFeatSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('multiPark'), parks: z.number().int().min(2).max(4) }).strict(),
  z.object({ type: z.literal('rideMarathon'), rides: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('grandSlam') }).strict(),
  z.object({ type: z.literal('diningAllParks') }).strict(),
  z.object({ type: z.literal('aroundTheWorld') }).strict(),
]);

/**
 * The `PinCriteria` discriminated union. Declared via `z.lazy` + an explicit
 * `z.ZodType<PinCriteria>` annotation because the `compound` member references
 * the schema recursively.
 */
export const pinCriteriaSchema: z.ZodType<PinCriteria> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('count'), metric: pinCountMetricSchema, threshold: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('firstInPark'), park: z.enum(PARKS) }).strict(),
    z.object({ kind: z.literal('firstInLand'), land: z.string().min(1) }).strict(),
    z.object({ kind: z.literal('landComplete'), lands: z.array(z.string().min(1)).min(1) }).strict(),
    z.object({ kind: z.literal('allLandsVisited') }).strict(),
    z.object({ kind: z.literal('parkComplete'), park: z.enum(PARKS), scope: z.enum(['attractions', 'everything']) }).strict(),
    z.object({ kind: z.literal('parksAttractionsComplete') }).strict(),
    z.object({ kind: z.literal('catalogComplete'), scope: z.enum(['attractions', 'all']) }).strict(),
    z.object({ kind: z.literal('set'), setId: z.string().min(1), required: setRequirementSchema }).strict(),
    z.object({ kind: z.literal('singleDay'), feat: singleDayFeatSchema }).strict(),
    z.object({ kind: z.literal('compound'), all: z.array(pinCriteriaSchema).min(2) }).strict(),
  ]),
);

/** A static catalog Pin definition. */
export const pinSchema = z
  .object({
    id: z.string().min(1),
    tier: pinTierSchema,
    track: pinTrackSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    criteria: pinCriteriaSchema,
  })
  .strict();

/**
 * Per-User Pin Board projection. Unlocked pins carry `awardedAt` and null
 * progress; locked pins carry progress with `percentComplete` clamped to
 * `[0, 99]` (Property 4). `claimedAt` is additive (Requirement 20.2): it is
 * only meaningful when `unlocked` is true, and never affects `unlocked` or
 * the progress fields (Property 13, Property 14).
 */
export const userPinProgressSchema = z
  .object({
    pinId: z.string().min(1),
    unlocked: z.boolean(),
    awardedAt: isoTimestampSchema.nullable(),
    currentValue: z.number().nullable(),
    targetValue: z.number().nullable(),
    percentComplete: z.number().min(0).max(99).nullable(),
    claimedAt: isoTimestampSchema.nullable(),
  })
  .strict();
