/**
 * Shared types for ticket prices.
 *
 * Validates: Requirements 11.3, 11.4, 11.14, 5.10
 */

import type { PriceLabelKind, PriceQuoteDTO } from '@dwt/shared';

export interface TicketPriceKey {
  readonly discountGroup: string;
  readonly numDays: number;
  readonly ageGroup: string;
  readonly optionCode: string;
  readonly park?: string | undefined;
}

export interface TicketPriceRow {
  readonly discountGroup: string;
  readonly numDays: number;
  readonly ageGroup: string;
  readonly optionCode: string;
  readonly park: string;
  readonly startDate: string;
  readonly priceCents: number;
  readonly taxCents: number;
  readonly validEndDate?: string;
  readonly productId?: string;
  readonly changedAt?: Date;
}

export interface TicketPriceSetMeta {
  readonly discountGroup: string;
  readonly numDays: number;
  readonly asOf: Date | null;
  readonly horizonDate: string | null;
  readonly rowCount?: number;
  readonly windowDays?: number;
  readonly lastAttemptAt?: Date | null;
  readonly lastError: string | null;
}

export interface LabelCfg {
  readonly freshDays: number;
  readonly estimateAfterDays: number;
}

export interface TicketResolution {
  readonly priceCents: number | null;
  readonly taxCents: number | null;
  readonly resolvedStartDate: string | null;
  readonly parkAssumed: boolean;
  readonly labelKind: PriceLabelKind;
  readonly asOf: Date | null;
  readonly estimateReason: NonNullable<PriceQuoteDTO['estimateReason']>;
  readonly flUnavailable: boolean;
}


