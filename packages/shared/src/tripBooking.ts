/**
 * Trip Booking domain contracts for `@dwt/shared`.
 *
 * This module is the single source of truth for the Trip Booking Timeline feature's
 * wire contracts, declarative rules, schemas, and DTOs.
 *
 * Validates: Requirements 1.1, 1.14, 11.2, 11.10, 15.1, 15.2
 */

import { z } from 'zod';

import {
  LIGHTNING_LANE_TIMINGS,
  PACKING_CATEGORIES,
  STAY_TYPES,
  WINDOW_KINDS,
  type LightningLaneTiming,
  type PackingCategory,
  type StayType,
  type WindowKind,
  type WindowStatus,
} from './enums.js';
import { uuidSchema } from './schemas/primitives.js';
import { tripCalendarDateSchema } from './trips.js';

export const BOOKING_RULES_VERSION = 1;

/** One evaluated shape for every (kind, stay-type | timing) combination. */
export interface WindowRule {
  /** Days before the Arrival_Date that the head window opens. */
  readonly headOffsetDays: number;
  /** Stay_Dates covered by the head window, counted from the Arrival_Date; null = all of them. */
  readonly headCoverDays: number | null;
  /** What happens to Stay_Dates beyond the head. null only when headCoverDays is null. */
  readonly tail:
    | { readonly offsetDays: number; readonly mode: 'shared' } // ONE window, Arrival_Date − offset
    | { readonly offsetDays: number; readonly mode: 'per_date' } // one window per date: date − offset
    | null;
}

export const BOOKING_RULES = {
  dining: {
    /** Drop_Time 06:00 WDW as minutes from midnight. */
    dropMinutes: 360,
    byStayType: {
      resort: { headOffsetDays: 60, headCoverDays: 10, tail: { offsetDays: 60, mode: 'per_date' } },
      partner_hotel: { headOffsetDays: 60, headCoverDays: 1, tail: { offsetDays: 60, mode: 'per_date' } },
      offsite: { headOffsetDays: 60, headCoverDays: 1, tail: { offsetDays: 60, mode: 'per_date' } },
    },
  },
  lightning_lane: {
    /** Drop_Time 07:00 WDW. */
    dropMinutes: 420,
    byTiming: {
      seven_day: { headOffsetDays: 7, headCoverDays: 14, tail: { offsetDays: 3, mode: 'shared' } },
      three_day: { headOffsetDays: 3, headCoverDays: null, tail: null },
      three_day_daily: { headOffsetDays: 3, headCoverDays: 1, tail: { offsetDays: 3, mode: 'per_date' } },
    },
    /** Used when Booking_Settings holds no Lightning_Lane_Timing (R1.9, R2.9). */
    defaultTimingByStayType: { resort: 'seven_day', partner_hotel: 'seven_day', offsite: 'three_day' },
  },
} as const;

/** Reminder lead schedule (R7.1). `minutes` = WDW wall-clock minutes from midnight. */
export const REMINDER_LEAD_SCHEDULE = {
  eve: { kind: 'day_before', daysBefore: 1, minutes: 20 * 60 }, // Drop_On − 1 day @ 20:00
  open: { kind: 'at_drop' }, // Fire_At = Drop_At
  week: { kind: 'day_before', daysBefore: 7, minutes: 9 * 60 }, // Drop_On − 7 days @ 09:00
} as const;

export const CHECK_IN_OVERRIDE_MAX_DAYS_BEFORE_START = 30;
export const PACKING_LIST_MAX_ITEMS = 300;
export const PACKING_NAME_MAX = 80;
export const PACKING_QUANTITY_MIN = 1;
export const PACKING_QUANTITY_MAX = 99;
export const BOOKING_REMINDER_BODY_MAX = 100;

// ---------------------------------------------------------------------------
// Calendar-date helpers & formatters (UTC-only Date.UTC arithmetic, DST-immune)
// ---------------------------------------------------------------------------

const ENGLISH_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function diffCalendarDays(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(a) - ms(b)) / 86_400_000);
}

export function listCalendarDates(from: string, to: string): string[] {
  if (to < from) return [];
  const out: string[] = [];
  let curr = from;
  while (curr <= to) {
    out.push(curr);
    curr = addCalendarDays(curr, 1);
  }
  return out;
}

export function checkInOverrideRange(tripStart: string): { min: string; max: string } {
  return {
    min: addCalendarDays(tripStart, -CHECK_IN_OVERRIDE_MAX_DAYS_BEFORE_START),
    max: tripStart,
  };
}

export function isCheckInOverrideValid(override: string, tripStart: string): boolean {
  const { min, max } = checkInOverrideRange(tripStart);
  return override >= min && override <= max;
}

export function formatMonthDay(date: string): string {
  const parts = date.split('-');
  const mStr = parts[1];
  const dStr = parts[2];
  const monthIdx = Number(mStr) - 1;
  const day = Number(dStr);
  const month = ENGLISH_MONTHS[monthIdx] ?? '';
  return `${month} ${day}`;
}

export function formatDateRange(first: string, last: string): string {
  if (first === last) {
    return formatMonthDay(first);
  }
  return `${formatMonthDay(first)} \u2013 ${formatMonthDay(last)}`;
}

export interface StarterPackingEntry {
  readonly name: string;
  readonly category: PackingCategory;
  readonly quantity: number;
}

// ---------------------------------------------------------------------------
// Zod schemas (all .strict(), violations carry message 'trip_validation_failed')
// ---------------------------------------------------------------------------

const M = { message: 'trip_validation_failed' };
const TYPE_ERR = {
  invalid_type_error: 'trip_validation_failed',
  required_error: 'trip_validation_failed',
};
const ENUM_ERR = {
  errorMap: () => ({ message: 'trip_validation_failed' }),
};

export const bookingSettingsUpdateSchema = z
  .object(
    {
      stayType: z.enum(STAY_TYPES, ENUM_ERR).nullable().optional(),
      lightningLaneTiming: z.enum(LIGHTNING_LANE_TIMINGS, ENUM_ERR).nullable().optional(),
      checkInOverride: tripCalendarDateSchema.nullable().optional(),
    },
    TYPE_ERR,
  )
  .strict({ message: 'trip_validation_failed' })
  .superRefine((v, ctx) => {
    // R2.11: at least one key present (null counts as present)
    if (
      v.stayType === undefined &&
      v.lightningLaneTiming === undefined &&
      v.checkInOverride === undefined
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'trip_validation_failed' });
    }
  });

export const windowDoneSchema = z
  .object(
    {
      done: z.boolean(TYPE_ERR),
    },
    TYPE_ERR,
  )
  .strict({ message: 'trip_validation_failed' });

export const reminderMuteSchema = z
  .object(
    {
      muted: z.boolean(TYPE_ERR),
    },
    TYPE_ERR,
  )
  .strict({ message: 'trip_validation_failed' });

export const windowDoneParamsSchema = z
  .object(
    {
      id: uuidSchema,
      kind: z.enum(WINDOW_KINDS, ENUM_ERR),
      dropOn: tripCalendarDateSchema,
    },
    TYPE_ERR,
  )
  .strict({ message: 'trip_validation_failed' });

const packingNameSchema = z
  .string(TYPE_ERR)
  .trim()
  .min(1, M)
  .max(PACKING_NAME_MAX, M);

const packingQuantitySchema = z
  .number(TYPE_ERR)
  .int(M)
  .min(PACKING_QUANTITY_MIN, M)
  .max(PACKING_QUANTITY_MAX, M);

export const packingItemCreateSchema = z
  .object(
    {
      name: packingNameSchema,
      category: z.enum(PACKING_CATEGORIES, ENUM_ERR),
      quantity: packingQuantitySchema.optional(),
      assigneeId: uuidSchema.nullable().optional(),
    },
    TYPE_ERR,
  )
  .strict({ message: 'trip_validation_failed' });

export const packingItemUpdateSchema = z
  .object(
    {
      name: packingNameSchema.optional(),
      category: z.enum(PACKING_CATEGORIES, ENUM_ERR).optional(),
      quantity: packingQuantitySchema.optional(),
      assigneeId: uuidSchema.nullable().optional(),
    },
    TYPE_ERR,
  )
  .strict({ message: 'trip_validation_failed' })
  .superRefine((v, ctx) => {
    // R11.7: at least one key !== undefined
    if (
      v.name === undefined &&
      v.category === undefined &&
      v.quantity === undefined &&
      v.assigneeId === undefined
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'trip_validation_failed' });
    }
  });

export const packingItemPackedSchema = z
  .object(
    {
      packed: z.boolean(TYPE_ERR),
    },
    TYPE_ERR,
  )
  .strict({ message: 'trip_validation_failed' });

// ---------------------------------------------------------------------------
// DTOs (types only)
// ---------------------------------------------------------------------------

export interface BookingWindowDTO {
  readonly windowKey: string; // `${kind}:${dropOn}`
  readonly kind: WindowKind;
  readonly dropOn: string; // YYYY-MM-DD WDW
  readonly dropAt: string; // ISO-8601 UTC
  readonly coveredDates: readonly string[]; // ascending, non-empty
  readonly status: WindowStatus;
  readonly daysUntilDrop: number | null; // integer >= 0 iff status === 'upcoming'
  readonly done: boolean;
  readonly doneAt: string | null; // ISO UTC, null when !done
  readonly doneByDisplayName: string | null;
  readonly bookedCount: number; // informational only (R3.6)
}

export interface BookingTimelineDTO {
  readonly tripId: string;
  readonly rulesVersion: number;
  readonly stayType: { readonly value: StayType; readonly source: 'auto' | 'override' };
  readonly lightningLaneTiming: { readonly value: LightningLaneTiming; readonly source: 'auto' | 'override' };
  readonly arrivalDate: { readonly value: string; readonly source: 'trip_start' | 'override' };
  readonly muted: boolean; // viewer-specific ONLY (R3.1, R3.11)
  readonly windows: readonly BookingWindowDTO[];
}

export interface BookingSettingsDTO {
  readonly tripId: string;
  readonly stayType: StayType | null;
  readonly lightningLaneTiming: LightningLaneTiming | null;
  readonly checkInOverride: string | null;
}

export interface BookingReminderMuteDTO {
  readonly tripId: string;
  readonly muted: boolean;
}

export interface PackingItemDTO {
  readonly id: string;
  readonly tripId: string;
  readonly name: string;
  readonly category: PackingCategory;
  readonly quantity: number;
  readonly packed: boolean;
  readonly packedAt: string | null;
  readonly packedByDisplayName: string | null;
  readonly addedById: string;
  readonly addedByDisplayName: string;
  readonly assigneeId: string | null;
  readonly assigneeDisplayName: string | null;
  readonly createdAt: string;
}

export interface PackingListDTO {
  readonly items: readonly PackingItemDTO[];
  readonly totalCount: number;
  readonly packedCount: number;
}

export type BookingSettingsUpdateInput = z.infer<typeof bookingSettingsUpdateSchema>;
export type PackingItemCreateInput = z.infer<typeof packingItemCreateSchema>;
export type PackingItemUpdateInput = z.infer<typeof packingItemUpdateSchema>;

export const STARTER_PACKING_LIST: readonly StarterPackingEntry[] = [
  { name: 'Park tickets or passes', category: 'documents', quantity: 1 },
  { name: 'Photo ID', category: 'documents', quantity: 1 },
  { name: 'Hotel confirmation', category: 'documents', quantity: 1 },
  { name: 'Comfortable walking shoes', category: 'clothing', quantity: 1 },
  { name: 'Extra socks', category: 'clothing', quantity: 1 },
  { name: 'Swimsuit', category: 'clothing', quantity: 1 },
  { name: 'Light rain jacket', category: 'clothing', quantity: 1 },
  { name: 'Sunscreen', category: 'toiletries', quantity: 1 },
  { name: 'Toiletry kit', category: 'toiletries', quantity: 1 },
  { name: 'Medications', category: 'health', quantity: 1 },
  { name: 'Blister bandages', category: 'health', quantity: 1 },
  { name: 'Pain reliever', category: 'health', quantity: 1 },
  { name: 'Phone charger', category: 'tech', quantity: 1 },
  { name: 'Portable battery', category: 'tech', quantity: 1 },
  { name: 'Headphones', category: 'tech', quantity: 1 },
  { name: 'Refillable water bottle', category: 'park_gear', quantity: 1 },
  { name: 'Ponchos', category: 'park_gear', quantity: 1 },
  { name: 'Hat and sunglasses', category: 'park_gear', quantity: 1 },
  { name: 'Small day bag', category: 'park_gear', quantity: 1 },
  { name: 'Stroller or wagon', category: 'kids', quantity: 1 },
  { name: 'Snacks', category: 'kids', quantity: 1 },
] as const;
