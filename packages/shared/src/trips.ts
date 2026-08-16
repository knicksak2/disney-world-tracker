/**
 * Trips domain contracts for `@dwt/shared`.
 *
 * This module is the single source of truth for the Trip feature's wire
 * contracts so `apps/api` and `apps/mobile` cannot drift. It holds:
 *
 *  - the derived-status and role value types (`TripStatus`, `TripRole`),
 *  - the Zod input schemas that validate request bodies (`tripCreateSchema`,
 *    `tripEditSchema`, and the planned-item / log-entry / rode-with-confirm /
 *    reaction / comment inputs), and
 *  - the read-projection DTOs (`TripDTO`, `TripMemberDTO`, `TripInviteDTO`,
 *    `PlannedItemDTO`, `TripLogEntryDTO`, `TripFeedItemDTO`, `TripSummaryDTO`).
 *
 * The `Trip_Name`/`Trip_Description`/date rules encoded here are validated
 * identically on create and edit (Property 2). Cross-table state
 * (membership, friendship, duplicates, the Last_Organizer_Rule) is enforced
 * in the Trip_Service repo, not here.
 *
 * Trip_Status is never a stored, editable field — it is derived from the two
 * dates and the WDW calendar date — so no input schema accepts a status and
 * `TripDTO.status` is a read-only projection (R2.5).
 *
 * Validates: Requirements 1.4, 1.5, 1.6, 1.7, 1.8, 3.4, 3.5, 3.6, 13.9, 21.1
 */

import { z } from 'zod';

import type { Park, TripReactionValue } from './enums.js';
import {
  isoTimestampSchema,
  ratingValueSchema,
  tripReactionValueSchema,
  uuidSchema,
} from './schemas/primitives.js';

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/**
 * Derived Trip lifecycle status (R2.1–R2.6). Computed from the Trip_Start_Date,
 * the Trip_End_Date, and the WDW_Current_Date; never stored as an independent
 * editable field.
 */
export type TripStatus = 'upcoming' | 'active' | 'past';

/** The role a Trip_Member holds on a Trip (R4.1). */
export type TripRole = 'organizer' | 'member';

/** The lifecycle state of a Trip_Invite (R6.1, R6.8, R7.1–R7.3). */
export type TripInviteState = 'pending' | 'accepted' | 'declined' | 'cancelled';

/** The lifecycle state of a Rode_With_Tag (R10.3, R11.2–R11.6, R8.6, R8.7). */
export type RodeWithTagState = 'pending' | 'confirmed' | 'declined' | 'cancelled';

/** The kinds of entity a Trip_Reaction / Trip_Comment may target (R13.10). */
export type TripFeedTargetType = 'feed_item' | 'log_entry';

// ---------------------------------------------------------------------------
// Reusable Trip primitives
// ---------------------------------------------------------------------------

/**
 * Trip_Name: trimmed, 1–100 characters, with at least one non-whitespace
 * character (R1.4, R1.5, R3.4). The trim is a transform so the validated value
 * matches the value the Trip_Service stores byte-for-byte (R1.3, R3.2). The
 * `\S` regex rejects inputs that are only unicode/zero-width whitespace that
 * survive `String.prototype.trim`.
 */
export const tripNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'trip_validation_failed' })
  .max(100, { message: 'trip_validation_failed' })
  .regex(/\S/u, { message: 'trip_validation_failed' });

/**
 * Trip_Description: optional free-form text up to 2000 characters (R1.6,
 * R3.5). The value is not trimmed because only its length is constrained by
 * the requirements.
 */
export const tripDescriptionSchema = z
  .string()
  .max(2000, { message: 'trip_validation_failed' });

/**
 * A valid calendar date in `YYYY-MM-DD` form (R1.7). Beyond the gross shape,
 * a `superRefine` rejects strings that match the pattern but are not real
 * calendar dates (e.g. `2023-02-30` or `2023-13-01`) by round-tripping the
 * parsed components through a UTC `Date`. Because the format is
 * lexicographically ordered, string comparison of two such values is a valid
 * chronological comparison (used by the `end >= start` check below).
 */
export const tripCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, { message: 'trip_validation_failed' })
  .superRefine((value, ctx) => {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trip_validation_failed',
      });
    }
  });

/**
 * Trip_Comment body: trimmed, 1–2000 characters (R13.9). Whitespace-only
 * inputs are rejected because the trimmed length is 0.
 */
export const tripCommentBodySchema = z
  .string()
  .trim()
  .min(1, { message: 'trip_validation_failed' })
  .max(2000, { message: 'trip_validation_failed' });

/**
 * Upper bound on the number of Resorts a single Trip may record staying at
 * (R21.1). A Walt Disney World visit can span more than one hotel (a "split
 * stay"), but a realistic party never records dozens; the cap is generous
 * headroom that still bounds the request. The Trip_Service repo enforces that
 * every id references an existing, active catalog Resort.
 */
export const TRIP_RESORT_LIMIT = 20;

/**
 * The set of Resorts a Trip's party stayed at, as catalog Resort ids (R21.1).
 * Each entry is a `ResortDTO.id`. Order is not significant and duplicates are
 * collapsed by the Trip_Service (the join table's composite PK is the final
 * guard, R21.2). An empty array is valid and, on edit, clears the recorded
 * stay. Bounded by {@link TRIP_RESORT_LIMIT}.
 */
export const tripResortIdsSchema = z
  .array(uuidSchema)
  .max(TRIP_RESORT_LIMIT, { message: 'trip_validation_failed' });

// ---------------------------------------------------------------------------
// Trip lifecycle inputs
// ---------------------------------------------------------------------------

/**
 * Guards `endDate >= startDate` (R1.8, R3.6). Only runs the comparison when
 * both values are present strings so that a per-field validation failure (an
 * invalid calendar date) surfaces as its own issue rather than being masked
 * by the cross-field check. The comparison is lexicographic, which is a valid
 * chronological comparison for `YYYY-MM-DD` values.
 */
function refineDateOrder(
  value: {
    readonly startDate?: string | undefined;
    readonly endDate?: string | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  if (
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    value.endDate < value.startDate
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'trip_validation_failed',
      path: ['endDate'],
    });
  }
}

/**
 * Body for `POST /me/trips` (R1.4–R1.8). The Trip_Name is required and stored
 * trimmed; the Trip_Description is optional and capped at 2000 characters;
 * both dates are required valid calendar dates with `endDate >= startDate`.
 */
export const tripCreateSchema = z
  .object({
    name: tripNameSchema,
    description: tripDescriptionSchema.optional(),
    startDate: tripCalendarDateSchema,
    endDate: tripCalendarDateSchema,
    resortIds: tripResortIdsSchema.optional(),
  })
  .strict()
  .superRefine(refineDateOrder);

export type TripCreateInput = z.infer<typeof tripCreateSchema>;

/**
 * Per-date touring/schedule preferences configured in Schedule Builder Settings (`⚙️`).
 */
export const dayTouringHoursSchema = z
  .object({
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
    useEarlyEntry: z.boolean().optional(),
    useExtendedEvening: z.boolean().optional(),
    hasAfterHoursTicket: z.boolean().optional(),
    startingPark: z.string().optional(),
  })
  .strict();

export type DayTouringHoursDTO = z.infer<typeof dayTouringHoursSchema>;

/**
 * Body for `PATCH /trips/:id` (R3.4–R3.6). Every field is optional so an edit
 * may touch any subset of `{name, description, startDate, endDate, resortIds, walkingSpeed, earlyEntryEligible, dayTouringHours}`;
 * each supplied field is validated by the identical rule used on create. When
 * both dates are supplied together the `endDate >= startDate` invariant is
 * checked here; an edit that supplies only one date is checked against the
 * stored value in the Trip_Service repo. Supplying `resortIds` replaces the
 * Trip's recorded Resort stay wholesale; an empty array clears it (R21.1).
 */
export const tripEditSchema = z
  .object({
    name: tripNameSchema.optional(),
    description: tripDescriptionSchema.optional(),
    startDate: tripCalendarDateSchema.optional(),
    endDate: tripCalendarDateSchema.optional(),
    resortIds: tripResortIdsSchema.optional(),
    walkingSpeed: z.enum(['slow', 'moderate', 'fast']).optional(),
    earlyEntryEligible: z.boolean().optional(),
    dayTouringHours: z.record(z.string(), dayTouringHoursSchema).optional(),
  })
  .strict()
  .superRefine(refineDateOrder);

export type TripEditInput = z.infer<typeof tripEditSchema>;

// ---------------------------------------------------------------------------
export const MEAL_PERIODS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealPeriod = (typeof MEAL_PERIODS)[number];

export const MEAL_WINDOWS: Partial<Record<MealPeriod, { readonly startMinutes: number; readonly endMinutes: number }>> = {
  breakfast: { startMinutes: 480, endMinutes: 630 },   // 08:00 - 10:30 (480 - 630 mins)
  lunch: { startMinutes: 690, endMinutes: 840 },       // 11:30 - 14:00 (690 - 840 mins)
  dinner: { startMinutes: 1020, endMinutes: 1200 },    // 17:00 - 20:00 (1020 - 1200 mins)
};

export const MEAL_SERVICE_WINDOWS: Partial<Record<MealPeriod, { readonly startMinutes: number; readonly endMinutes: number }>> = {
  breakfast: { startMinutes: 420, endMinutes: 660 },   // 07:00 - 11:00 (420 - 660 mins)
  lunch: { startMinutes: 660, endMinutes: 930 },       // 11:00 - 15:30 (660 - 930 mins)
  dinner: { startMinutes: 960, endMinutes: 1260 },     // 16:00 - 21:00 (960 - 1260 mins)
};

/**
 * Body for `POST /trips/:id/planned-items` (R9.1). Catalog existence,
 * duplicate, and 500-item-limit checks are enforced in the repo (R9.3–R9.5).
 */
export const plannedItemAddSchema = z
  .object({
    experienceId: uuidSchema.nullable().optional(),
    customTitle: z.string().trim().min(1).max(255).nullable().optional(),
    plannedDate: tripCalendarDateSchema.nullable().optional(),
    plannedTime: isoTimestampSchema.nullable().optional(),
    isFixed: z.boolean().optional(),
    isLightningLane: z.boolean().optional(),
    useSingleRider: z.boolean().optional(),
    priority: z.number().int().min(1).max(3).optional(),
    itemType: z.enum(['experience', 'break']).optional(),
    durationMinutes: z.number().int().min(1).max(480).nullable().optional(),
    windowStartMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    windowEndMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    mealPeriod: z.enum(MEAL_PERIODS).nullable().optional(),
  })
  .strict()
  .transform((data) => {
    if (data.mealPeriod && data.windowStartMinutes == null && data.windowEndMinutes == null) {
      const window = MEAL_WINDOWS[data.mealPeriod];
      if (window) {
        return {
          ...data,
          windowStartMinutes: window.startMinutes,
          windowEndMinutes: window.endMinutes,
        };
      }
    }
    return data;
  })
  .superRefine((data, ctx) => {
    if (!data.experienceId && data.itemType !== 'break') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['experienceId'],
        message: "Unlocated items without an experienceId must have itemType 'break'",
      });
    }
    const hasStart = data.windowStartMinutes != null;
    const hasEnd = data.windowEndMinutes != null;
    if ((hasStart && !hasEnd) || (!hasStart && hasEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? 'windowEndMinutes' : 'windowStartMinutes'],
        message: 'Both windowStartMinutes and windowEndMinutes must be provided together',
      });
    } else if (hasStart && hasEnd && data.windowEndMinutes! < data.windowStartMinutes!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEndMinutes'],
        message: 'windowEndMinutes must be greater than or equal to windowStartMinutes',
      });
    }
  });

export type PlannedItemAddInput = z.infer<typeof plannedItemAddSchema>;

export const plannedItemEditSchema = z
  .object({
    customTitle: z.string().trim().min(1).max(255).nullable().optional(),
    plannedDate: tripCalendarDateSchema.nullable().optional(),
    plannedTime: isoTimestampSchema.nullable().optional(),
    isFixed: z.boolean().optional(),
    isLightningLane: z.boolean().optional(),
    useSingleRider: z.boolean().optional(),
    priority: z.number().int().min(1).max(3).optional(),
    itemType: z.enum(['experience', 'break']).optional(),
    durationMinutes: z.number().int().min(1).max(480).nullable().optional(),
    windowStartMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    windowEndMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    mealPeriod: z.enum(MEAL_PERIODS).nullable().optional(),
  })
  .strict()
  .transform((data) => {
    if (data.mealPeriod && data.windowStartMinutes == null && data.windowEndMinutes == null) {
      const window = MEAL_WINDOWS[data.mealPeriod];
      if (window) {
        return {
          ...data,
          windowStartMinutes: window.startMinutes,
          windowEndMinutes: window.endMinutes,
        };
      }
    }
    return data;
  })
  .superRefine((data, ctx) => {
    const hasStart = data.windowStartMinutes != null;
    const hasEnd = data.windowEndMinutes != null;
    if ((hasStart && !hasEnd) || (!hasStart && hasEnd)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? 'windowEndMinutes' : 'windowStartMinutes'],
        message: 'Both windowStartMinutes and windowEndMinutes must be provided together',
      });
    } else if (hasStart && hasEnd && data.windowEndMinutes! < data.windowStartMinutes!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['windowEndMinutes'],
        message: 'windowEndMinutes must be greater than or equal to windowStartMinutes',
      });
    }
  });

export type PlannedItemEditInput = z.infer<typeof plannedItemEditSchema>;

export const tripOptimizationInputSchema = z
  .object({
    date: tripCalendarDateSchema,
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
  })
  .strict();

export type TripOptimizationInput = z.infer<typeof tripOptimizationInputSchema>;

export interface OptimizedItem {
  readonly plannedItemId: string;
  readonly suggestedArrival: string;
  readonly predictedWaitMinutes: number;
  readonly scheduledShowtime?: string | null;
  readonly travelFromPrev: {
    readonly kind: 'walk' | 'park_hop';
    readonly minutes: number;
  } | null;
}

export interface TripOptimizationResult {
  readonly items: readonly OptimizedItem[];
  readonly totalWaitMinutes: number;
  readonly totalWalkMinutes: number;
  readonly unfittedItemIds: readonly string[];
  readonly warnings: readonly string[];
}


/**
 * Body for `POST /trips/:id/log-entries` (R10). `rodeWith` is the list of
 * Trip_Member ids the logging Member rode with; `rating` is the logging
 * Member's optional canonical Rating, a whole number 1–10 (R10.10). Self-tags,
 * non-members, and in-request duplicate tags are rejected in the repo where
 * the membership set is known (R10.4–R10.6).
 */
export const tripLogEntryCreateSchema = z
  .object({
    experienceId: uuidSchema,
    rodeWith: z.array(uuidSchema).default([]),
    rating: ratingValueSchema.optional(),
  })
  .strict();

export type TripLogEntryCreateInput = z.infer<typeof tripLogEntryCreateSchema>;

/**
 * Body for `POST /me/rode-with-tags/:tagId/confirm` (R11.4, R11.5). The
 * optional `rating` sets the Tagged_Member's single canonical Rating; when it
 * is omitted the canonical Rating is left unchanged.
 */
export const rodeWithConfirmSchema = z
  .object({
    rating: ratingValueSchema.optional(),
  })
  .strict();

export type RodeWithConfirmInput = z.infer<typeof rodeWithConfirmSchema>;

/**
 * Body for `POST /trips/:id/feed/:targetType/:targetId/reactions` (R13.6). The
 * reaction is validated against the closed `Trip_Reaction` vocabulary; any
 * other value is a validation error and nothing is persisted.
 */
export const tripReactionInputSchema = z
  .object({
    reaction: tripReactionValueSchema,
  })
  .strict();

export type TripReactionInput = z.infer<typeof tripReactionInputSchema>;

/**
 * Body for `POST /trips/:id/feed/:targetType/:targetId/comments` (R13.8,
 * R13.9). The body is trimmed and constrained to 1–2000 characters.
 */
export const tripCommentInputSchema = z
  .object({
    body: tripCommentBodySchema,
  })
  .strict();

export type TripCommentInput = z.infer<typeof tripCommentInputSchema>;

// ---------------------------------------------------------------------------
// DTO schemas (runtime validators for read projections)
// ---------------------------------------------------------------------------

/**
 * Validates the shape of a {@link PendingRodeWithTagDTO} as returned by
 * `GET /me/rode-with-tags?state=pending`. Kept alongside the trips input
 * schemas so the Trips_API producer and the Notification_Center consumer
 * cannot drift on the pending rode-with read projection (R3.3). The `tagId`
 * and `tripLogEntryId` are UUIDs, the names are free-form strings, and
 * `createdAt` is an ISO-8601 UTC timestamp; the object is `.strict()` so an
 * unexpected extra field surfaces as a drift error.
 */
export const pendingRodeWithTagSchema = z
  .object({
    tagId: uuidSchema,
    tripLogEntryId: uuidSchema,
    experienceName: z.string(),
    taggingMemberDisplayName: z.string(),
    createdAt: isoTimestampSchema,
  })
  .strict();

// ---------------------------------------------------------------------------
// DTOs (types only — no runtime payload)
// ---------------------------------------------------------------------------

/**
 * One Resort a Trip's party stayed at, as surfaced on a {@link TripDTO}
 * (R21.1). A lightweight projection of the catalog `ResortDTO` carrying only
 * what a Trip screen renders — the id and display name; the full Resort detail
 * (image, address, …) is available from the catalog `GET /resorts` read used to
 * populate the picker.
 */
export interface TripResortDTO {
  /** Catalog Resort Internal_Id (`ResortDTO.id`). */
  readonly id: string;
  /** Resort display name (`ResortDTO.name`). */
  readonly name: string;
}

/**
 * A Trip as returned to a Trip_Member. `status` is the derived Trip_Status
 * (R2), never a persisted, independently editable field.
 */
export interface TripDTO {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Trip_Start_Date as `YYYY-MM-DD`. */
  readonly startDate: string;
  /** Trip_End_Date as `YYYY-MM-DD`. */
  readonly endDate: string;
  /** Derived from the two dates and the WDW_Current_Date (R2). */
  readonly status: TripStatus;
  /** ISO-8601 timestamp the Trip was created. */
  readonly createdAt: string;
  /**
   * The Resort(s) the Trip's party stayed at, ordered by name then id (R21.1).
   * An empty array when none are recorded. Sourced from the `trip_resorts`
   * join, never a copy of catalog data.
   */
  readonly resorts: readonly TripResortDTO[];
  /** Walking pace scaling travel times: 'slow' (50m/min), 'moderate' (80m/min), 'fast' (100m/min). */
  readonly walkingSpeed?: 'slow' | 'moderate' | 'fast' | undefined;
  /** Flag indicating whether the party is eligible for 30m Early Entry. */
  readonly earlyEntryEligible?: boolean | undefined;
  /** Per-date touring hours and event settings dictionary keyed by YYYY-MM-DD. */
  readonly dayTouringHours?: Record<string, DayTouringHoursDTO> | undefined;
}

/** One Trip_Member with their display info and role. */
export interface TripMemberDTO {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarPreset: string | null;
  readonly role: TripRole;
}

/** A Trip_Invite as surfaced to the invited User for the deep-link target. */
export interface TripInviteDTO {
  readonly id: string;
  readonly tripId: string;
  readonly tripName: string;
  readonly inviterDisplayName: string;
  readonly state: TripInviteState;
}

/**
 * One `pending` Trip_Invite as surfaced to the *invited* User in their
 * invitations inbox (`GET /me/trip-invites`). Carries everything the Trips_List
 * needs to show who invited them and to which Trip, plus the `inviteId` the
 * accept/decline actions post to (R7.1–R7.3). Only `pending` invites are
 * listed, so a row here is always actionable.
 */
export interface TripIncomingInviteDTO {
  readonly inviteId: string;
  readonly tripId: string;
  readonly tripName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly inviterDisplayName: string;
  readonly inviterAvatarPreset: string | null;
  /**
   * ISO-8601 timestamp the Trip_Invite was created, sourced from the
   * already-stored `trip_invites.created_at`. Added additively so the invite
   * can carry a source timestamp for ordering in the Notification_Center; it
   * reshapes no request contract and removes no existing field (R1.3, R1.4,
   * R7.3).
   */
  readonly createdAt: string;
}

/**
 * Runtime validator mirroring {@link TripIncomingInviteDTO} for API/DTO drift
 * protection. `createdAt` is validated as an ISO-8601 timestamp but kept
 * `.optional()` so the field is additive: existing producers/consumers that do
 * not yet carry it still validate, and nothing about the trip-invite contract
 * is reshaped (R1.3, R1.4, R7.3).
 */
export const tripIncomingInviteSchema = z
  .object({
    inviteId: uuidSchema,
    tripId: uuidSchema,
    tripName: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    inviterDisplayName: z.string(),
    inviterAvatarPreset: z.string().nullable(),
    createdAt: isoTimestampSchema.optional(),
  })
  .strict();

/**
 * One `pending` Rode_With_Tag as surfaced to the Tagged_Member in the
 * Notification_Center (`GET /me/rode-with-tags?state=pending`). Only `pending`
 * tags are listed, so a row here is always actionable: it carries the `tagId`
 * the confirm/decline actions post to, the linked `tripLogEntryId`, the
 * referenced Experience name, the tagging member's display name, and the tag's
 * creation timestamp used as the Notification_Center source-sort key
 * (R3.1–R3.3).
 */
export interface PendingRodeWithTagDTO {
  readonly tagId: string;
  readonly tripLogEntryId: string;
  readonly experienceName: string;
  readonly taggingMemberDisplayName: string;
  /** ISO-8601 timestamp the tag was created; source timestamp + sort key. */
  readonly createdAt: string;
}

/**
 * One `pending` Trip_Invite as surfaced to an Organizer managing a Trip's
 * roster (`GET /trips/:id/invites`). Carries the invited User's display info so
 * the Members screen can list who has an outstanding invite and offer a Cancel
 * control (R6.8), and can exclude already-invited Friends from the invite
 * picker (R6.5).
 */
export interface TripPendingInviteDTO {
  readonly inviteId: string;
  readonly inviteeId: string;
  readonly inviteeDisplayName: string;
  readonly inviteeAvatarPreset: string | null;
}

/**
 * A travel leg between two consecutive scheduled items: how the guest gets
 * there (`walk` within a park, `park_hop` across parks) and how long it takes.
 */
export interface TripTravelLeg {
  readonly kind: 'walk' | 'park_hop';
  readonly minutes: number;
}

/**
 * One Planned_List entry, carrying the referenced Experience's name, its Park,
 * and the display name of the Trip_Member who added it (R9.9).
 */
export interface PlannedItemDTO {
  readonly id: string;
  readonly experienceId: string | null;
  readonly experienceName: string | null;
  readonly park: Park | null;
  readonly customTitle: string | null;
  readonly addedByDisplayName: string;
  readonly plannedDate: string | null;
  readonly plannedTime: string | null;
  readonly isFixed: boolean;
  readonly isLightningLane: boolean;
  readonly useSingleRider: boolean;
  readonly priority: number;
  readonly itemType: 'experience' | 'break';
  readonly durationMinutes: number | null;
  readonly windowStartMinutes: number | null;
  readonly windowEndMinutes: number | null;
  readonly mealPeriod: MealPeriod | null;
  readonly scheduledShowtime: string | null;
  readonly servedMealPeriods?: readonly string[] | undefined;
  /**
   * Persisted result of the last optimize run for this item (R8.1–R8.4).
   * All three are `null` when the item has not been optimized (or was edited
   * since), so the timeline shows a "not optimized yet" state rather than a
   * placeholder wait. `travelFromPrev` is `null` for the first item of a day.
   */
  readonly predictedWaitMinutes: number | null;
  readonly travelFromPrev: TripTravelLeg | null;
  readonly optimizedAt: string | null;
}

/**
 * One Shared_Log entry. `rating` is the logging Member's current canonical
 * Rating joined live at read time, or `null` when they have none (R12.4,
 * R12.8). `rodeWith` lists each tagged Member and the tag's current state.
 */
export interface TripLogEntryDTO {
  readonly id: string;
  readonly memberId: string;
  readonly memberDisplayName: string;
  readonly experienceId: string;
  readonly experienceName: string;
  /** Current canonical Rating (whole number 1–10) or `null` when unrated. */
  readonly rating: number | null;
  readonly rodeWith: readonly {
    readonly taggedMemberId: string;
    readonly state: RodeWithTagState;
  }[];
}

/**
 * Aggregated Trip_Reactions of one value on a feed target: how many Members
 * applied it (`count`) and whether the reading caller is one of them (`mine`),
 * so the client can render a count and an "on" state without a second read
 * (R13.4–R13.7).
 */
export interface TripReactionSummary {
  readonly reaction: TripReactionValue;
  readonly count: number;
  readonly mine: boolean;
}

/**
 * One Trip_Comment on a feed target, carrying its author's display name and
 * whether the reading caller authored it (`mine`) so only the author sees a
 * remove control (R13.8, R13.11, R13.12).
 */
export interface TripCommentDTO {
  readonly id: string;
  readonly authorId: string;
  readonly authorDisplayName: string;
  /**
   * The author's chosen avatar preset id (`ProfileDTO.avatarPreset`), or `null`
   * when they have none — so the feed can render the author's avatar rather
   * than only initials. Always present on the wire (possibly `null`).
   */
  readonly authorAvatarPreset: string | null;
  readonly body: string;
  /** ISO-8601 timestamp; comments are listed oldest-first under their item. */
  readonly createdAt: string;
  readonly mine: boolean;
}

/**
 * One event in the reverse-chronological Trip_Feed (R13.1–R13.3), including the
 * Trip_Reactions applied to it (aggregated with the caller's own state) and its
 * Trip_Comments (oldest-first), so the feed shows the whole group's engagement
 * rather than only the caller's own session activity (R13.4–R13.8).
 */
export interface TripFeedItemDTO {
  readonly id: string;
  readonly type: string;
  readonly actorDisplayName: string;
  /**
   * The acting Member's chosen avatar preset id (`ProfileDTO.avatarPreset`), or
   * `null` when they have none — so the feed can render the actor's avatar
   * rather than only initials. Always present on the wire (possibly `null`).
   */
  readonly actorAvatarPreset: string | null;
  /** ISO-8601 timestamp; the primary Trip_Feed sort key (R13.3). */
  readonly createdAt: string;
  /**
   * Display context folded in by the read projection. For a `completion_logged`
   * item this includes `experienceName`, `park`, `experienceCategory`,
   * `experienceLand`, and `experienceImageUrl` (the referenced Experience), the
   * logging Member's live `rating`, and the `rodeWith` tag states — so the row
   * can show a rich card, not just a name.
   */
  readonly metadata: Record<string, unknown>;
  readonly reactions: readonly TripReactionSummary[];
  readonly comments: readonly TripCommentDTO[];
}

/**
 * The derived Trip_Summary (R14). Exposes per-Trip aggregates and per-Member
 * counts so a future trip-to-trip comparison can consume the same shape
 * (R14.7).
 */
export interface TripSummaryDTO {
  /** Distinct Experiences completed in the Trip context, `0` when none (R14.1). */
  readonly distinctExperienceCount: number;
  /** Up to 5 top-rated Experiences, empty when none are rated (R14.2, R14.3). */
  readonly topRated: readonly {
    readonly experienceId: string;
    readonly experienceName: string;
    readonly meanRating: number;
    readonly ratingCount: number;
  }[];
  /** Per-Member log-entry and confirmed-tag counts, `0` where none (R14.4, R14.5). */
  readonly perMember: readonly {
    readonly memberId: string;
    readonly displayName: string;
    readonly logEntryCount: number;
    readonly confirmedTagCount: number;
  }[];
  /**
   * Total number of Planned_Items in the Trip's Planned_List, a non-negative
   * integer and `0` for an empty list. Derived at read time from the
   * Planned_Items; never stored as an independent editable field
   * (Planned List Completion Sync R5.1, R5.3, R5.4).
   */
  readonly plannedTotalCount: number;
  /**
   * Number of Planned_Items whose referenced Experience matches at least one
   * Trip_Log_Entry in the Trip under the Planned_Completion_Match, each counted
   * at most once. A non-negative integer clamped to
   * `0 <= plannedCompletedCount <= plannedTotalCount`, and `0` for an empty list.
   * Derived at read time; never stored (Planned List Completion Sync R5.2, R5.5, R5.6).
   */
  readonly plannedCompletedCount: number;
}
