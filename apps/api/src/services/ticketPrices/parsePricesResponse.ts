/**
 * Zod validation and parsing of Disney Endpoint P (pricing calendar) response.
 *
 * Validates: Requirements 11.3, 11.4, 11.5, 11.10
 */

import { z } from 'zod';
import { crossCheck, parseTicketProductId } from './idMapping.js';
import { dollarsStringToCents } from './ticketMoney.js';
import type { TicketPriceRow } from './types.js';

export class InvalidResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidResponse';
  }
}

const calendarDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const pricingItemSchema = z.object({
  id: z.string(),
  ageGroup: z.string().optional(),
  pricePerDay: z.unknown().optional(), // ignored
  subtotal: z.unknown(),
  tax: z.unknown().optional(),
  stopSale: z.boolean().optional(),
  availability: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const dateEntrySchema = z.object({
  date: z.string().regex(calendarDateRegex),
  validityEndDate: z.string().regex(calendarDateRegex),
  currency: z.string().optional(),
  pricing: z.array(pricingItemSchema).default([]),
});

const pricingCalendarGroupSchema = z.object({
  numDays: z.union([z.string(), z.number()]),
  dates: z.array(dateEntrySchema).default([]),
});

const endpointPBodySchema = z.object({
  maxPricingCalendarDate: z.string().regex(calendarDateRegex),
  pricingCalendar: z.array(pricingCalendarGroupSchema),
});

export interface ParsedPricesSet {
  readonly rows: TicketPriceRow[];
  readonly skippedUnrecognized: number;
  readonly skippedNotSellable: number;
  readonly invalidPriceCount: number;
  readonly horizonDate: string;
}

/**
 * Parses and validates an Endpoint P response body.
 * Throws InvalidResponse if the payload does not conform to the schema.
 */
export function parsePricesResponse(
  body: unknown,
  requested: { numDays: number; discountGroup: string },
): ParsedPricesSet {
  const parseResult = endpointPBodySchema.safeParse(body);
  if (!parseResult.success) {
    throw new InvalidResponse(`Endpoint P response failed schema validation: ${parseResult.error.message}`);
  }

  const { maxPricingCalendarDate, pricingCalendar } = parseResult.data;

  let skippedUnrecognized = 0;
  let skippedNotSellable = 0;
  let invalidPriceCount = 0;
  const rows: TicketPriceRow[] = [];
  const now = new Date();

  for (const group of pricingCalendar) {
    const groupNumDays = typeof group.numDays === 'string' ? parseInt(group.numDays, 10) : group.numDays;
    if (groupNumDays !== requested.numDays) {
      continue;
    }

    for (const dateEntry of group.dates) {
      const { date: startDate, validityEndDate, pricing } = dateEntry;

      for (const item of pricing) {
        // Sellability check: sellable only when stopSale !== true, availability !== false, enabled !== false
        const isNotSellable = item.stopSale === true || item.availability === false || item.enabled === false;
        if (isNotSellable) {
          skippedNotSellable++;
          continue;
        }

        // Product ID mapping & cross-check
        const parts = parseTicketProductId(item.id);
        if (!parts || !crossCheck(parts, item, requested)) {
          skippedUnrecognized++;
          continue;
        }

        // Subtotal price parsing (dollarsStringToCents)
        const priceCents = dollarsStringToCents(item.subtotal);
        if (priceCents === null) {
          invalidPriceCount++;
          continue;
        }

        // Tax parsing: tax can be 0 or a positive dollar string
        let taxCents = 0;
        if (typeof item.tax === 'string' && (item.tax === '0' || item.tax === '0.00')) {
          taxCents = 0;
        } else {
          taxCents = dollarsStringToCents(item.tax) ?? 0;
        }

        rows.push({
          discountGroup: parts.discountGroup,
          numDays: parts.numDays,
          ageGroup: parts.ageGroup,
          optionCode: parts.optionCode,
          park: parts.park,
          startDate,
          priceCents,
          taxCents,
          validEndDate: validityEndDate,
          productId: item.id,
          changedAt: now,
        });
      }
    }
  }

  return {
    rows,
    skippedUnrecognized,
    skippedNotSellable,
    invalidPriceCount,
    horizonDate: maxPricingCalendarDate,
  };
}
