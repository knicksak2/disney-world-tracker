/**
 * Pure module data shapes for Trip Budget integration.
 *
 * Contract between the repository and the pure modules (design.md Section 3).
 *
 * Validates: Requirements 3.4, 6.6, 6.9, 7.1, 7.2, 7.7
 */

import type {
  BudgetCategory,
  BudgetSettingsDTO,
  ExpenseCategory,
  PriceLabelKind,
  PriceQuoteDTO,
  PriceRef,
  PriceSource,
  TicketPriceRef,
  LlPriceRef,
  TravelerProfileDTO,
} from '@dwt/shared';

export type PersonKey = `m:${string}` | `g:${string}`;

export interface StoredAllocation {
  id: string;
  personKey: PersonKey;
  storedCents: number;
  priceRef: PriceRef | null;
}

export interface StoredLine {
  id: string;
  category: BudgetCategory;
  description: string;
  plannedDate: string | null; // YYYY-MM-DD
  park: string | null; // one of PARKS or null
  experienceId: string | null;
  priceSource: PriceSource;
  priceAsOf: Date; // trip_budget_lines.price_as_of
  priceRef: TicketPriceRef | LlPriceRef | null; // line-level default
  applyTip: boolean;
  allocations: StoredAllocation[]; // SORTED by personKey (string compare) before any math
  createdBy?: string;
  linkedExpenseId?: string | null;
  suggestionKey?: string | null;
}

export interface EffectiveAllocation {
  allocationId: string;
  personKey: PersonKey;
  storedCents: number;
  effectiveCents: number; // pre-tax
  labelKind: PriceLabelKind;
  effectivePriceSource: PriceSource;
  asOf: Date;
  estimateReason?: PriceQuoteDTO['estimateReason'];
  soldOut?: boolean;
  priceRef: PriceRef | null;
}

export interface ResolvedLine extends Omit<StoredLine, 'allocations'> {
  allocations: EffectiveAllocation[];
  effectivePriceSource: PriceSource; // line-level (see resolveLinePrices)
  priceLabelKind: PriceLabelKind; // worst allocation label
  asOf: Date; // oldest allocation asOf
  soldOut: boolean;
  attribution: 'disney' | 'themeparks_wiki' | null;
}

export interface PersonInfo {
  label: string;
  sponsorMemberId: string | null;
  deleted: boolean;
} // label 'Deleted user' when deleted

export type PersonIndex = ReadonlyMap<PersonKey, PersonInfo>;

export interface BudgetSettingsEffective {
  taxBps: Readonly<Record<BudgetCategory, number>>; // stored override merged over BUDGET_DEFAULT_TAX_BPS
  diningTipBps: number; // stored override ?? BUDGET_DEFAULT_DINING_TIP_BPS
  savedCents: number;
  savingsTargetCents: number | null;
}

export interface LineMath {
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  perPerson: { personKey: PersonKey; cents: number; taxCents: number; tipCents: number }[]; // same order as allocations
}

export interface PlannedItemRow {
  id: string;
  experienceId: string | null;
  plannedDate: string | null;
  reservationKind: string | null;
  partySize: number | null;
  isLightningLane: boolean;
}

export interface RawBudgetBundle {
  trip: {
    startDate: string;
    endDate: string;
    dayTouringHours: Record<string, { startingPark?: string }>;
  };
  storedLines: StoredLine[];
  travelers: TravelerProfileDTO[];
  settings: BudgetSettingsDTO;
  settingsEffective: BudgetSettingsEffective;
  people: PersonIndex;
  vsActualByExpenseCategory: Record<ExpenseCategory, number>;
}

