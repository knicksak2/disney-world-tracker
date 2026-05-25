/**
 * Zod schemas for Share-shaped values.
 *
 * The DTO schema mirrors `ShareDTO`, with `payloadSnapshot` validated as a
 * discriminated union over `kind` so the two payload variants
 * (`experience` and `progress`, R9.1, R9.7) are exhaustively handled.
 *
 * The "send share" input schema validates the body of `POST /me/shares` and
 * enforces the recipient-count bounds (R9.2). Authoritative friend-graph
 * checks (R9.3) live in the Sharing_Service because they require a database
 * lookup.
 *
 * Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6, 9.7
 */

import { z } from 'zod';

import { EXPERIENCE_CATEGORIES, PARKS } from '../enums.js';
import type { ExperienceCategory, Park } from '../enums.js';

import {
  completionPercentSchema,
  isoTimestampSchema,
  noteBodySchema,
  ratingValueSchema,
  recipientListSchema,
  sharePayloadKindSchema,
  uuidSchema,
} from './primitives.js';

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

/**
 * `experience` payload (R9.1, R9.4, R9.5, R9.6).
 *
 * - `rating` is `null` together with `ratingUnavailable: true` when the
 *   sender chose to include a Rating but none existed at delivery time
 *   (R9.5).
 * - `rating` is an integer in `1..10` when a Rating was included and existed
 *   at delivery time (R9.4).
 * - `note`, when present, is the trimmed body in `1..2000` characters (R9.6).
 */
export const experienceSharePayloadSchema = z
  .object({
    kind: z.literal('experience'),
    experienceId: uuidSchema,
    rating: ratingValueSchema.nullable().optional(),
    ratingUnavailable: z.boolean().optional(),
    note: noteBodySchema.optional(),
  })
  .strict();

const perParkPercentShape = Object.fromEntries(
  PARKS.map((park) => [park, completionPercentSchema.optional()] as const),
) as { [K in Park]: z.ZodOptional<typeof completionPercentSchema> };

const perCategoryPercentShape = Object.fromEntries(
  EXPERIENCE_CATEGORIES.map(
    (category) => [category, completionPercentSchema.optional()] as const,
  ),
) as {
  [K in ExperienceCategory]: z.ZodOptional<typeof completionPercentSchema>;
};

/**
 * `progress` payload (R9.7). Each percentage is in `[0.0, 100.0]`; per-Park
 * and per-category fields are optional so the sender can omit groups that
 * have no Experiences.
 */
export const progressSharePayloadSchema = z
  .object({
    kind: z.literal('progress'),
    overallPercent: completionPercentSchema,
    perParkPercent: z.object(perParkPercentShape).strict(),
    perCategoryPercent: z.object(perCategoryPercentShape).strict(),
  })
  .strict();

export const sharePayloadSchema = z.discriminatedUnion('kind', [
  experienceSharePayloadSchema,
  progressSharePayloadSchema,
]);

// ---------------------------------------------------------------------------
// DTO schema
// ---------------------------------------------------------------------------

export const shareSchema = z
  .object({
    id: uuidSchema,
    senderId: uuidSchema,
    payloadKind: sharePayloadKindSchema,
    payloadSnapshot: sharePayloadSchema,
    sentAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    // The discriminator on the wire envelope must agree with the snapshot
    // discriminator. This guards against a bug where the two are written
    // independently.
    if (value.payloadKind !== value.payloadSnapshot.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'payloadKind must match payloadSnapshot.kind',
        path: ['payloadKind'],
      });
    }
  });

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Body for `POST /me/shares`. The `payload` is the same discriminated union
 * used in delivery; the recipient list is bounded to 1-50 unique ids
 * (R9.1, R9.2). Whether the sender is friends with each recipient is checked
 * server-side in a single transaction (R9.3).
 */
export const shareInputSchema = z
  .object({
    recipientIds: recipientListSchema,
    payload: sharePayloadSchema,
  })
  .strict();

export type ShareInput = z.infer<typeof shareInputSchema>;
