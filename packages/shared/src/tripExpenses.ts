/**
 * Trip Expenses domain contracts for `@dwt/shared`.
 *
 * This module is the single source of truth for the Trip Expenses feature's wire
 * contracts so `apps/api` and `apps/mobile` cannot drift. It holds:
 *
 *  - vocabulary limits and constants,
 *  - the Zod input schemas that validate request bodies (`expenseCreateSchema`,
 *    `expenseEditSchema`, `settlementCreateSchema`, `tripGuestAddSchema`,
 *    `refundCreateSchema`, etc.), and
 *  - the read-projection DTOs (`ExpenseDTO`, `ExpenseShareDTO`, `NetBalanceDTO`,
 *    `PairwiseBalanceDTO`, `BalanceDrillDownEntryDTO`, etc.).
 *
 * Validates: Requirements 1.1–1.6, 1.11, 1.12, 2.2, 2.5, 2.6, 2.8, 3.1, 3.2, 3.6,
 *            3.7, 4.1, 4.3, 4.6, 5.1, 5.2, 5.7, 5.8, 6.3–6.5, 7.1, 7.2, 8.3, 11.1,
 *            11.2, 12.1, 12.2, 14.1, 14.2
 */

import { z } from 'zod';

import type { ChargeLineKind, ExpenseCategory, ExpenseSplitMode } from './enums.js';
import { CHARGE_LINE_KINDS, EXPENSE_CATEGORIES, EXPENSE_SPLIT_MODES } from './enums.js';
import { uuidSchema } from './schemas/primitives.js';
import { tripCalendarDateSchema } from './trips.js';

// ---------------------------------------------------------------------------
// Constants & Limits
// ---------------------------------------------------------------------------

export const EXPENSE_AMOUNT_MAX_CENTS = 10_000_000; // $100,000.00 (Req 1.3)
export const EXPENSE_LIMIT = 1_000; // per-Trip cap (Req 1.12)
export const GUEST_NAME_MAX = 100; // (Req 2.2)
export const EXPENSE_DESCRIPTION_MAX = 200; // (Req 1.5)
export const EXPENSE_TIER_NAME_MAX = 40; // (Req 4.1)
export const EXPENSE_ITEM_NAME_MAX = 100; // (Req 5.1)

// ---------------------------------------------------------------------------
// Input Schemas
// ---------------------------------------------------------------------------

/**
 * An explicit share for an `exact` Split_Mode Expense. Exactly one of memberId
 * or guestId is specified.
 */
export const expenseShareInputSchema = z
  .object({
    memberId: uuidSchema.optional(),
    guestId: uuidSchema.optional(),
    amountCents: z
      .number()
      .int()
      .positive({ message: 'trip_validation_failed' })
      .max(EXPENSE_AMOUNT_MAX_CENTS, { message: 'trip_validation_failed' }),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasMember = Boolean(val.memberId);
    const hasGuest = Boolean(val.guestId);
    if ((hasMember && hasGuest) || (!hasMember && !hasGuest)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trip_validation_failed',
      });
    }
  });

export type ExpenseShareInput = z.infer<typeof expenseShareInputSchema>;

/**
 * A named price tier for a `tiered` Split_Mode Expense.
 */
export const expenseTierInputSchema = z
  .object({
    id: uuidSchema.optional(),
    name: z
      .string()
      .trim()
      .min(1, { message: 'trip_validation_failed' })
      .max(EXPENSE_TIER_NAME_MAX, { message: 'trip_validation_failed' }),
    priceCents: z
      .number()
      .int()
      .positive({ message: 'trip_validation_failed' })
      .max(EXPENSE_AMOUNT_MAX_CENTS, { message: 'trip_validation_failed' }),
  })
  .strict();

export type ExpenseTierInput = z.infer<typeof expenseTierInputSchema>;

/**
 * Count of a tier attributed to a Trip_Member or Trip_Guest.
 */
export const expenseTierCountInputSchema = z
  .object({
    tierId: z.string().min(1, { message: 'trip_validation_failed' }),
    memberId: uuidSchema.optional(),
    guestId: uuidSchema.optional(),
    count: z
      .number()
      .int()
      .min(1, { message: 'trip_validation_failed' }),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasMember = Boolean(val.memberId);
    const hasGuest = Boolean(val.guestId);
    if ((hasMember && hasGuest) || (!hasMember && !hasGuest)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trip_validation_failed',
      });
    }
  });

export type ExpenseTierCountInput = z.infer<typeof expenseTierCountInputSchema>;

/**
 * One item line on an `itemized` Split_Mode Expense.
 */
export const expenseItemInputSchema = z
  .object({
    id: uuidSchema.optional(),
    name: z
      .string()
      .trim()
      .min(1, { message: 'trip_validation_failed' })
      .max(EXPENSE_ITEM_NAME_MAX, { message: 'trip_validation_failed' }),
    priceCents: z
      .number()
      .int()
      .positive({ message: 'trip_validation_failed' })
      .max(EXPENSE_AMOUNT_MAX_CENTS, { message: 'trip_validation_failed' }),
    assigneeIds: z
      .array(uuidSchema)
      .min(1, { message: 'trip_validation_failed' }),
    isAlcohol: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    for (const id of val.assigneeIds) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
          path: ['assigneeIds'],
        });
      }
      seen.add(id);
    }
  });

export type ExpenseItemInput = z.infer<typeof expenseItemInputSchema>;

/**
 * Bill-level adjustment on an `itemized` Expense.
 * A discount must be negative; taxes, gratuities, and fees must be positive.
 */
export const chargeLineInputSchema = z
  .object({
    kind: z.enum(CHARGE_LINE_KINDS),
    amountCents: z.number().int(),
    scopeItemIds: z.array(uuidSchema).optional(),
    excludeAlcohol: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.kind === 'discount') {
      if (val.amountCents >= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
          path: ['amountCents'],
        });
      }
    } else {
      if (val.amountCents <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
          path: ['amountCents'],
        });
      }
    }
    if (val.scopeItemIds !== undefined && val.scopeItemIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trip_validation_failed',
        path: ['scopeItemIds'],
      });
    }
  });

export type ChargeLineInputDTO = z.infer<typeof chargeLineInputSchema>;

/**
 * Body for creating a new Expense. Discriminated on Split_Mode.
 */
export const expenseCreateSchema = z
  .object({
    payerId: uuidSchema,
    description: z
      .string()
      .trim()
      .min(1, { message: 'trip_validation_failed' })
      .max(EXPENSE_DESCRIPTION_MAX, { message: 'trip_validation_failed' }),
    date: tripCalendarDateSchema,
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    splitMode: z.enum(EXPENSE_SPLIT_MODES),
    experienceId: uuidSchema.optional(),
    resortId: uuidSchema.optional(),
    amountCents: z
      .number()
      .int()
      .positive({ message: 'trip_validation_failed' })
      .max(EXPENSE_AMOUNT_MAX_CENTS, { message: 'trip_validation_failed' })
      .optional(),
    shares: z.array(expenseShareInputSchema).optional(),
    participantIds: z.array(uuidSchema).optional(),
    tiers: z.array(expenseTierInputSchema).optional(),
    tierCounts: z.array(expenseTierCountInputSchema).optional(),
    items: z.array(expenseItemInputSchema).optional(),
    chargeLines: z.array(chargeLineInputSchema).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Category & catalog link consistency (Req 11.1, 11.2, 11.8)
    if (val.experienceId !== undefined && val.category !== 'dining') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trip_validation_failed',
        path: ['experienceId'],
      });
    }
    if (val.resortId !== undefined && val.category !== 'hotel') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trip_validation_failed',
        path: ['resortId'],
      });
    }
    if (val.experienceId !== undefined && val.resortId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'trip_validation_failed',
      });
    }

    // Split_Mode discrimination
    if (val.splitMode === 'itemized') {
      if (val.amountCents !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
          path: ['amountCents'],
        });
      }
      if (!val.items || val.items.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
          path: ['items'],
        });
      }
      if (
        val.shares !== undefined ||
        val.participantIds !== undefined ||
        val.tiers !== undefined ||
        val.tierCounts !== undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
        });
      }
    } else {
      // exact, even, tiered require amountCents
      if (val.amountCents === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
          path: ['amountCents'],
        });
      }
      if (val.items !== undefined || val.chargeLines !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'trip_validation_failed',
        });
      }

      if (val.splitMode === 'exact') {
        if (
          val.participantIds !== undefined ||
          val.tiers !== undefined ||
          val.tierCounts !== undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trip_validation_failed',
          });
        }
        if (val.shares !== undefined) {
          const seen = new Set<string>();
          let sum = 0;
          for (const s of val.shares) {
            const recipient = s.memberId ?? s.guestId;
            if (recipient) {
              if (seen.has(recipient)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: 'trip_validation_failed',
                  path: ['shares'],
                });
              }
              seen.add(recipient);
            }
            sum += s.amountCents;
          }
          if (val.amountCents !== undefined && sum > val.amountCents) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'trip_validation_failed',
              path: ['shares'],
            });
          }
        }
      } else if (val.splitMode === 'even') {
        if (
          val.shares !== undefined ||
          val.tiers !== undefined ||
          val.tierCounts !== undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trip_validation_failed',
          });
        }
        if (!val.participantIds || val.participantIds.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trip_validation_failed',
            path: ['participantIds'],
          });
        } else {
          const seen = new Set<string>();
          for (const p of val.participantIds) {
            if (seen.has(p)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'trip_validation_failed',
                path: ['participantIds'],
              });
            }
            seen.add(p);
          }
          const otherParticipants = val.participantIds.filter((id) => id !== val.payerId);
          if (otherParticipants.length < 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'trip_validation_failed',
              path: ['participantIds'],
            });
          }
        }
      } else if (val.splitMode === 'tiered') {
        if (val.shares !== undefined || val.participantIds !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trip_validation_failed',
          });
        }
        if (!val.tiers || val.tiers.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'trip_validation_failed',
            path: ['tiers'],
          });
        }
      }
    }
  });

export type ExpenseCreateInput = z.infer<typeof expenseCreateSchema>;

/**
 * Body for editing an Expense.
 */
export const expenseEditSchema = expenseCreateSchema;
export type ExpenseEditInput = z.infer<typeof expenseEditSchema>;

/**
 * Body for recording a Settlement between two Trip_Members.
 */
export const settlementCreateSchema = z
  .object({
    payerId: uuidSchema,
    recipientId: uuidSchema,
    amountCents: z
      .number()
      .int()
      .positive({ message: 'trip_validation_failed' })
      .max(EXPENSE_AMOUNT_MAX_CENTS, { message: 'trip_validation_failed' }),
    date: tripCalendarDateSchema,
  })
  .strict()
  .refine((v) => v.payerId !== v.recipientId, { message: 'trip_validation_failed' });

export type SettlementCreateInput = z.infer<typeof settlementCreateSchema>;

/**
 * Body for creating a new Trip_Guest.
 */
export const tripGuestAddSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'trip_validation_failed' })
      .max(GUEST_NAME_MAX, { message: 'trip_validation_failed' }),
    sponsorMemberId: uuidSchema.optional(),
  })
  .strict();

export type TripGuestAddInput = z.infer<typeof tripGuestAddSchema>;

/**
 * Body for renaming an existing Trip_Guest.
 */
export const tripGuestRenameSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'trip_validation_failed' })
      .max(GUEST_NAME_MAX, { message: 'trip_validation_failed' }),
    sponsorMemberId: uuidSchema.optional(),
  })
  .strict();

export type TripGuestRenameInput = z.infer<typeof tripGuestRenameSchema>;

/**
 * Body for recording a Refund against an Expense.
 */
export const refundCreateSchema = z
  .object({
    amountCents: z
      .number()
      .int()
      .positive({ message: 'trip_validation_failed' })
      .max(EXPENSE_AMOUNT_MAX_CENTS, { message: 'trip_validation_failed' }),
    date: tripCalendarDateSchema,
  })
  .strict();

export type RefundCreateInput = z.infer<typeof refundCreateSchema>;

// ---------------------------------------------------------------------------
// DTOs (Read Projections)
// ---------------------------------------------------------------------------

export interface ExpenseShareDTO {
  readonly id: string;
  readonly expenseId: string;
  readonly memberId: string | null;
  readonly guestId: string | null;
  readonly amountCents: number;
}

export interface ExpenseTierDTO {
  readonly id: string;
  readonly expenseId: string;
  readonly name: string;
  readonly priceCents: number;
}

export interface ExpenseTierCountDTO {
  readonly id: string;
  readonly tierId: string;
  readonly memberId: string | null;
  readonly guestId: string | null;
  readonly count: number;
}

export interface ExpenseItemDTO {
  readonly id: string;
  readonly expenseId: string;
  readonly name: string;
  readonly priceCents: number;
  readonly isAlcohol: boolean;
  readonly assigneeIds: readonly string[];
}

export interface ChargeLineDTO {
  readonly id: string;
  readonly expenseId: string;
  readonly kind: ChargeLineKind;
  readonly amountCents: number;
  readonly excludeAlcohol: boolean;
  readonly scopeItemIds: readonly string[];
}

export interface RefundDTO {
  readonly id: string;
  readonly expenseId: string;
  readonly createdByUserId: string;
  readonly amountCents: number;
  readonly date: string;
  readonly createdAt: string;
}

export interface ExpenseDTO {
  readonly id: string;
  readonly tripId: string;
  readonly payerId: string;
  readonly createdByUserId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly date: string;
  readonly category: ExpenseCategory | null;
  readonly splitMode: ExpenseSplitMode;
  readonly experienceId: string | null;
  readonly resortId: string | null;
  readonly shares: readonly ExpenseShareDTO[];
  readonly tiers: readonly ExpenseTierDTO[];
  readonly tierCounts?: readonly ExpenseTierCountDTO[];
  readonly items: readonly ExpenseItemDTO[];
  readonly chargeLines: readonly ChargeLineDTO[];
  readonly refunds: readonly RefundDTO[];
  readonly createdAt: string;
}

export interface SettlementDTO {
  readonly id: string;
  readonly tripId: string;
  readonly payerId: string;
  readonly recipientId: string;
  readonly createdByUserId: string;
  readonly amountCents: number;
  readonly date: string;
  readonly createdAt: string;
}

export interface TripGuestDTO {
  readonly id: string;
  readonly tripId: string;
  readonly sponsorMemberId: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface NetBalanceDTO {
  readonly memberId: string;
  readonly netCents: number;
}

export interface PairwiseBalanceDTO {
  readonly memberIdA: string;
  readonly memberIdB: string;
  readonly aOwesBCents: number;
}

export interface TripBalancesResponseDTO {
  readonly net: readonly NetBalanceDTO[];
  readonly pairwise: readonly PairwiseBalanceDTO[];
}

export interface BalanceDrillDownEntryDTO {
  readonly kind: 'expense' | 'settlement';
  readonly sourceId: string;
  readonly description: string;
  readonly date: string;
  readonly contributionCents: number;
  readonly payerId?: string | undefined;
  readonly recipientId?: string | undefined;
}

