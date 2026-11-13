/**
 * Shared Trip Budget domain constants, schemas, DTOs, and helpers.
 *
 * Implements the contracts for forward-looking Trip Budget planning,
 * allocation, pricing provenance, and comparison with actual expenses.
 *
 * Validates: Requirements 2.1-2.9, 3.1-3.7, 5.1-5.10, 6.1-6.10, 7.1-7.8,
 *            14.9, 18.5, 18.8, 20.4, 20.6
 */

import { z } from 'zod';
import {
  uuidSchema,
  parkSchema,
} from './schemas/primitives.js';
import {
  tripCalendarDateSchema,
} from './trips.js';
import {
  BUDGET_CATEGORIES,
  CREATABLE_PRICE_SOURCES,
  AGE_BRACKETS,
  TICKET_OPTIONS,
  TICKET_DISCOUNT_GROUPS,
  TRAVELER_PASS_TYPES,
  LL_PASS_TYPES,
} from './enums.js';
import type {
  BudgetCategory,
  CreatablePriceSource,
  PriceSource,
  PriceLabelKind,
  AgeBracket,
  TicketOption,
  TicketDiscountGroup,
  TravelerPassType,
  Park,
  ExpenseCategory,
} from './enums.js';
import {
  EXPENSE_AMOUNT_MAX_CENTS,
  EXPENSE_ITEM_NAME_MAX,
  EXPENSE_TIER_NAME_MAX,
} from './tripExpenses.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BUDGET_LINE_LIMIT = 500;
export const BUDGET_ALLOCATIONS_PER_LINE_MAX = 50;
export const BUDGET_DISMISSED_LIMIT = 200;
export const BUDGET_MENU_ITEMS_PER_LINE_MAX = 100;
export const BUDGET_READ_MAX_STATEMENTS = 14;
export const BUDGET_DESCRIPTION_MAX = 200;
export const BUDGET_TOTAL_CAP_CENTS = 1_000_000_000; // $10,000,000.00 sanity cap

export const BUDGET_DEFAULT_TAX_BPS: Readonly<Record<BudgetCategory, number>> = {
  tickets: 650,
  lightning_lane: 650,
  dining: 650,
  lodging: 0,
  transportation: 0,
  shopping: 650,
  other: 0,
};

export const BUDGET_DEFAULT_DINING_TIP_BPS = 1800;

export const BUDGET_TO_EXPENSE_CATEGORY: Readonly<Record<BudgetCategory, ExpenseCategory>> = {
  tickets: 'tickets',
  lightning_lane: 'lightning_lane',
  dining: 'dining',
  lodging: 'hotel',
  transportation: 'transportation',
  shopping: 'shopping',
  other: 'other',
};

export const MENU_SHAPE_VERSION = 2;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ticketPriceRefSchema = z.object({
  kind: z.literal('ticket'),
  discountGroup: z.enum(TICKET_DISCOUNT_GROUPS),
  numDays: z.number().int().min(1).max(10),
  ageGroup: z.enum(['adult', 'child']),
  optionCode: z.enum(TICKET_OPTIONS),
  startDate: tripCalendarDateSchema,
  park: z.enum(['mk', 'ep', 'hs', 'ak']).optional(),
}).strict();
export type TicketPriceRef = z.infer<typeof ticketPriceRefSchema>;

export const llPriceRefSchema = z.object({
  kind: z.literal('ll'),
  passType: z.enum(LL_PASS_TYPES),
  park: parkSchema,
  date: tripCalendarDateSchema,
  experienceId: uuidSchema.optional(),
}).strict();
export type LlPriceRef = z.infer<typeof llPriceRefSchema>;

export const menuPriceRefSchema = z.object({
  kind: z.literal('menu'),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(EXPENSE_ITEM_NAME_MAX),
    priceCents: z.number().int().positive().max(EXPENSE_AMOUNT_MAX_CENTS),
    priceLabel: z.string().max(60).nullable(),
    quantity: z.number().int().min(1).max(50),
    isAlcohol: z.boolean().optional(),
  }).strict()).min(1).max(100).optional(),
  tier: z.object({
    name: z.string().trim().min(1).max(EXPENSE_TIER_NAME_MAX),
    priceCents: z.number().int().positive().max(EXPENSE_AMOUNT_MAX_CENTS),
  }).strict().optional(),
}).strict();
export type MenuPriceRef = z.infer<typeof menuPriceRefSchema>;

export const priceRefSchema = z
  .discriminatedUnion('kind', [ticketPriceRefSchema, llPriceRefSchema, menuPriceRefSchema])
  .superRefine((v, ctx) => {
    if (v.kind === 'menu') {
      const hasItems = Boolean(v.items && v.items.length > 0);
      const hasTier = Boolean(v.tier);
      if ((hasItems && hasTier) || (!hasItems && !hasTier)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Exactly one of items or tier must be present in menu priceRef',
          path: ['items'],
        });
      }
    }
  });
export type PriceRef = z.infer<typeof priceRefSchema>;

const baseBudgetAllocationInputSchema = z.object({
  memberId: uuidSchema.optional(),
  guestId: uuidSchema.optional(),
  amountCents: z.number().int().min(0).max(EXPENSE_AMOUNT_MAX_CENTS).optional(),
  priceRef: priceRefSchema.optional(),
}).strict();

export const budgetAllocationInputSchema = baseBudgetAllocationInputSchema.superRefine((v, ctx) => {
  const hasMember = Boolean(v.memberId);
  const hasGuest = Boolean(v.guestId);
  if ((hasMember && hasGuest) || (!hasMember && !hasGuest)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exactly one of memberId or guestId must be provided',
      path: [hasMember && hasGuest ? 'guestId' : 'memberId'],
    });
  }
});
export type BudgetAllocationInput = z.infer<typeof budgetAllocationInputSchema>;

const baseBudgetLineInputSchema = z.object({
  category: z.enum(BUDGET_CATEGORIES),
  description: z.string().trim().min(1).max(BUDGET_DESCRIPTION_MAX),
  plannedDate: tripCalendarDateSchema.nullable().optional(),
  park: parkSchema.nullable().optional(),
  experienceId: uuidSchema.nullable().optional(),
  priceSource: z.enum(CREATABLE_PRICE_SOURCES),
  priceRef: z.discriminatedUnion('kind', [llPriceRefSchema, ticketPriceRefSchema]).nullable().optional(),
  applyTip: z.boolean().optional(),
  linkedExpenseId: uuidSchema.nullable().optional(),
  suggestionKey: z.string().max(120).optional(),
  allocations: z.array(budgetAllocationInputSchema).min(1).max(BUDGET_ALLOCATIONS_PER_LINE_MAX),
}).strict();

export const budgetLineInputSchema = baseBudgetLineInputSchema.superRefine((v: z.infer<typeof baseBudgetLineInputSchema>, ctx) => {
  if (v.applyTip && v.category !== 'dining') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'applyTip is only allowed when category is dining',
      path: ['applyTip'],
    });
  }
  if (v.priceSource === 'user_entered') {
    v.allocations.forEach((alloc, idx) => {
      if (alloc.amountCents === undefined || alloc.amountCents === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'amountCents is required for user_entered allocations',
          path: ['allocations', idx, 'amountCents'],
        });
      }
    });
  }
  if (v.priceSource === 'disney_menu') {
    if (v.category !== 'dining') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'disney_menu requires dining category',
        path: ['category'],
      });
    }
    if (!v.experienceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'disney_menu requires non-null experienceId',
        path: ['experienceId'],
      });
    }
    v.allocations.forEach((alloc, idx) => {
      if (!alloc.priceRef || alloc.priceRef.kind !== 'menu') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'disney_menu requires a menu priceRef on every allocation',
          path: ['allocations', idx, 'priceRef'],
        });
      }
    });
  }
  let totalMenuItems = 0;
  for (const alloc of v.allocations) {
    if (alloc.priceRef && alloc.priceRef.kind === 'menu' && alloc.priceRef.items) {
      totalMenuItems += alloc.priceRef.items.length;
    }
  }
  if (totalMenuItems > BUDGET_MENU_ITEMS_PER_LINE_MAX) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Total menu items across allocations cannot exceed ${BUDGET_MENU_ITEMS_PER_LINE_MAX}`,
      path: ['allocations'],
    });
  }
});
export type BudgetLineInput = z.infer<typeof budgetLineInputSchema>;

export const budgetLineReplaceSchema = budgetLineInputSchema;
export type BudgetLineReplace = z.infer<typeof budgetLineReplaceSchema>;

export const dismissSuggestionBodySchema = z.object({
  suggestionKey: z.string().min(1).max(120),
}).strict();
export type DismissSuggestionBody = z.infer<typeof dismissSuggestionBodySchema>;

/**
 * Body of `PUT /trips/:id/budget/lines/:lineId/link` (trip-budget Requirement 23.5):
 * the Expense a Budget_Line was logged as.
 */
export const budgetLineLinkBodySchema = z.object({
  expenseId: uuidSchema,
}).strict();
export type BudgetLineLinkBody = z.infer<typeof budgetLineLinkBodySchema>;

export const travelerProfileInputSchema = z.object({
  memberId: uuidSchema.optional(),
  guestId: uuidSchema.optional(),
  ageBracket: z.enum(AGE_BRACKETS),
  ticketOption: z.enum(TICKET_OPTIONS).nullable().optional(),
  ticketDays: z.number().int().min(1).max(10).nullable().optional(),
  ticketStartDate: tripCalendarDateSchema.nullable().optional(),
  discountGroup: z.enum(TICKET_DISCOUNT_GROUPS).optional(),
  passType: z.enum(TRAVELER_PASS_TYPES).optional(),
}).strict().superRefine((v, ctx) => {
  const hasMember = Boolean(v.memberId);
  const hasGuest = Boolean(v.guestId);
  if ((hasMember && hasGuest) || (!hasMember && !hasGuest)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exactly one of memberId or guestId must be provided',
      path: [hasMember && hasGuest ? 'guestId' : 'memberId'],
    });
  }
});
export type TravelerProfileInput = z.infer<typeof travelerProfileInputSchema>;

export const budgetSettingsPatchSchema = z.object({
  taxBps: z.record(z.enum(BUDGET_CATEGORIES), z.number().int().min(0).max(2500)).optional(),
  diningTipBps: z.number().int().min(0).max(5000).nullable().optional(),
  savedCents: z.number().int().min(0).max(BUDGET_TOTAL_CAP_CENTS).optional(),
  savingsTargetCents: z.number().int().min(0).max(BUDGET_TOTAL_CAP_CENTS).nullable().optional(),
}).strict();
export type BudgetSettingsPatch = z.infer<typeof budgetSettingsPatchSchema>;

export const priceQuoteRequestSchema = z.discriminatedUnion('kind', [
  ticketPriceRefSchema,
  llPriceRefSchema,
]);
export type PriceQuoteRequest = z.infer<typeof priceQuoteRequestSchema>;

export const priceQuoteBodySchema = z.object({
  requests: z.array(priceQuoteRequestSchema).min(1).max(40),
}).strict();
export type PriceQuoteBody = z.infer<typeof priceQuoteBodySchema>;

const budgetSuggestionDraftSchema = z.object({
  category: z.enum(BUDGET_CATEGORIES),
  description: z.string().trim().min(1).max(BUDGET_DESCRIPTION_MAX),
  plannedDate: tripCalendarDateSchema.nullable(),
  park: parkSchema.nullable(),
  experienceId: uuidSchema.nullable(),
  priceSource: z.enum(CREATABLE_PRICE_SOURCES),
  priceRef: z.discriminatedUnion('kind', [ticketPriceRefSchema, llPriceRefSchema]).nullable(),
  applyTip: z.boolean(),
  suggestionKey: z.string().min(1).max(120),
  partySize: z.number().int().min(1).nullable(),
  allocations: z.array(z.object({
    memberId: uuidSchema.optional(),
    guestId: uuidSchema.optional(),
    amountCents: z.number().int().min(0).optional(),
    priceRef: priceRefSchema.optional(),
  }).strict()),
  needsPrice: z.boolean(),
  needsPeople: z.boolean(),
}).strict();

export const budgetSuggestionDtoSchema = z.object({
  suggestionKey: z.string().min(1).max(120),
  kind: z.enum(['dining', 'lightning_lane', 'tickets']),
  draft: budgetSuggestionDraftSchema,
}).strict();

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface PriceStampDTO {
  readonly effectivePriceSource: PriceSource;
  readonly priceLabelKind: PriceLabelKind;
  readonly asOf: string;
  readonly attribution: 'disney' | 'themeparks_wiki' | null;
  readonly soldOut?: boolean;
}

export interface BudgetAllocationDTO {
  readonly id: string;
  readonly memberId: string | null;
  readonly guestId: string | null;
  readonly storedCents: number;
  readonly effectiveCents: number;
  readonly taxCents: number;
  readonly tipCents: number;
  readonly priceRef: PriceRef | null;
}

export interface BudgetLineDTO extends PriceStampDTO {
  readonly id: string;
  readonly tripId: string;
  readonly createdBy: string;
  readonly category: BudgetCategory;
  readonly description: string;
  readonly plannedDate: string | null;
  readonly park: string | null;
  readonly experienceId: string | null;
  readonly priceSource: PriceSource;
  readonly applyTip: boolean;
  readonly linkedExpenseId: string | null;
  readonly suggestionKey: string | null;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly tipCents: number;
  readonly totalCents: number;
  readonly allocations: readonly BudgetAllocationDTO[];
}

export interface BudgetBucketDTO {
  readonly key: string;
  readonly label: string;
  readonly totalCents: number;
  readonly sponsorMemberId?: string | null;
}

export interface SavingsPlanDTO {
  readonly targetCents: number;
  readonly savedCents: number;
  readonly remainingCents: number;
  readonly daysUntilStart: number;
  readonly weeksRemaining: number | null;
  readonly perWeekCents: number | null;
  readonly status: 'on_track' | 'saving' | 'trip_started_or_past';
}

export interface VsActualDTO {
  readonly expenseCategory: ExpenseCategory;
  readonly budgetedCents: number;
  readonly actualCents: number;
}

export interface BudgetSettingsDTO {
  readonly taxBps: Readonly<Record<BudgetCategory, number>>;
  readonly taxBpsIsDefault: Readonly<Record<BudgetCategory, boolean>>;
  readonly diningTipBps: number;
  readonly diningTipBpsIsDefault: boolean;
  readonly savedCents: number;
  readonly savingsTargetCents: number | null;
}

export interface TravelerProfileDTO {
  readonly id: string;
  readonly memberId: string | null;
  readonly guestId: string | null;
  readonly label: string;
  readonly ageBracket: AgeBracket;
  readonly ticketOption: TicketOption | null;
  readonly ticketDays: number | null;
  readonly ticketStartDate: string | null;
  readonly discountGroup: TicketDiscountGroup;
  readonly passType: TravelerPassType;
}

export interface BudgetDTO {
  readonly tripId: string;
  readonly lines: readonly BudgetLineDTO[];
  readonly travelers: readonly TravelerProfileDTO[];
  readonly settings: BudgetSettingsDTO;
  readonly totalCents: number;
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly tipCents: number;
  readonly byPerson: readonly BudgetBucketDTO[];
  readonly byDay: readonly BudgetBucketDTO[];
  readonly byPark: readonly BudgetBucketDTO[];
  readonly byCategory: readonly BudgetBucketDTO[];
  readonly savings: SavingsPlanDTO;
  readonly vsActual: readonly VsActualDTO[];
}

export interface BudgetSuggestionDraft {
  readonly category: BudgetCategory;
  readonly description: string;
  readonly plannedDate: string | null;
  readonly park: Park | null;
  readonly experienceId: string | null;
  readonly priceSource: CreatablePriceSource;
  readonly priceRef: TicketPriceRef | LlPriceRef | null;
  readonly applyTip: boolean;
  readonly suggestionKey: string;
  readonly partySize: number | null;
  readonly allocations: readonly {
    memberId?: string;
    guestId?: string;
    amountCents?: number;
    priceRef?: PriceRef;
  }[];
  readonly needsPrice: boolean;
  readonly needsPeople: boolean;
}

export interface BudgetSuggestionDTO {
  readonly suggestionKey: string;
  readonly kind: 'dining' | 'lightning_lane' | 'tickets';
  readonly draft: BudgetSuggestionDraft;
}

export interface PriceQuoteDTO extends PriceStampDTO {
  readonly priceCents: number | null;
  readonly taxCents: number | null;
  readonly resolvedStartDate?: string;
  readonly parkAssumed?: boolean;
  readonly flUnavailable?: boolean;
  readonly estimateReason?: 'beyond_horizon' | 'no_exact_date' | 'park_unset' | 'typical' | 'stale' | 'fl_unavailable' | 'none';
  readonly cacheState?: 'disabled' | 'warming' | 'failed' | 'ready';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Pure formatter for YYYY-MM-DD into "en-US" "MMM d, yyyy" using a fixed month-name
 * table (no Intl, no Date timezone shifts).
 */
export function formatCalendarDateAsOf(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return dateStr;
  const year = match[1];
  const monthIdx = parseInt(match[2]!, 10) - 1;
  const day = parseInt(match[3]!, 10);
  const monthName = MONTH_NAMES[monthIdx];
  if (!monthName) return dateStr;
  return `${monthName} ${day}, ${year}`;
}

/**
 * Produces the visible provenance string for a price stamp (Requirement 5.3).
 *
 * Example outputs:
 * - "Disney price, as of Oct 25, 2026"
 * - "Disney price, as of Oct 25, 2026 (may have changed)"
 * - "Lightning Lane price, as of Oct 25, 2026"
 * - "Disney menu price (before tax), as of Oct 25, 2026"
 * - "Estimate, as of Oct 25, 2026"
 * - "Add your price"
 * - "Your price"
 */
export function priceLabelText(
  kind: PriceLabelKind,
  source: PriceSource,
  asOfDate?: string | null
): string {
  if (kind === 'your_price') {
    return 'Your price';
  }
  if (kind === 'add_your_price') {
    return 'Add your price';
  }
  const dateFormatted = asOfDate ? formatCalendarDateAsOf(asOfDate) : '';
  if (kind === 'estimate') {
    return dateFormatted ? `Estimate, as of ${dateFormatted}` : 'Estimate';
  }

  let sourcePrefix: string;
  if (source === 'themeparks_ll') {
    sourcePrefix = 'Lightning Lane price';
  } else if (source === 'disney_menu') {
    sourcePrefix = 'Disney menu price (before tax)';
  } else {
    sourcePrefix = 'Disney price';
  }

  const baseText = dateFormatted ? `${sourcePrefix}, as of ${dateFormatted}` : sourcePrefix;
  if (kind === 'may_have_changed') {
    return `${baseText} (may have changed)`;
  }
  return baseText;
}
