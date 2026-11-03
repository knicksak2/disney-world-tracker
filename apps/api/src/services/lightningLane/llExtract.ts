/**
 * Pure extraction and classification of Lightning Lane prices from ThemeParks.wiki
 * schedule feeds (Requirement 15).
 *
 * Validates: Requirements 15.2, 15.3
 */

import type {
  ThemeParksPurchase,
  ThemeParksScheduleEntry,
} from '../live/themeParksLiveClient.js';

export interface LlDayPrices {
  date: string;
  multi?: { cents: number; available: boolean | null };
  premier?: { cents: number; available: boolean | null };
  singles: {
    purchaseId: string;
    attractionName: string;
    cents: number;
    available: boolean | null;
  }[];
}

/**
 * Classify a ThemeParks.wiki purchase entry into a Multi Pass, Premier Pass, or Single Pass.
 *
 * Rules:
 * - type === 'PACKAGE':
 *     - id starts with 'lightninglanemultipass_' -> multi
 *     - id starts with 'premierpass_' -> premier
 *     - else name === 'Lightning Lane Multi Pass' -> multi
 *     - else name === 'Lightning Lane Premier Pass' -> premier
 * - type === 'ATTRACTION':
 *     - id starts with 'lightninglane_' and not 'lightninglanemultipass_' -> single
 * - everything else -> null
 */
export function classifyPurchase(
  p: ThemeParksPurchase,
): { kind: 'multi' | 'premier' | 'single'; id: string } | null {
  if (typeof p !== 'object' || p === null) {
    return null;
  }
  const id = typeof p.id === 'string' ? p.id.trim() : '';
  if (id.length === 0) {
    return null;
  }

  const type = typeof p.type === 'string' ? p.type.toUpperCase() : '';
  const name = typeof p.name === 'string' ? p.name.trim() : '';

  if (type === 'PACKAGE') {
    if (id.startsWith('lightninglanemultipass_')) {
      return { kind: 'multi', id };
    }
    if (id.startsWith('premierpass_')) {
      return { kind: 'premier', id };
    }
    if (name === 'Lightning Lane Multi Pass') {
      return { kind: 'multi', id };
    }
    if (name === 'Lightning Lane Premier Pass') {
      return { kind: 'premier', id };
    }
  }

  if (type === 'ATTRACTION') {
    if (id.startsWith('lightninglane_') && !id.startsWith('lightninglanemultipass_')) {
      return { kind: 'single', id };
    }
  }

  return null;
}

/**
 * Extract Lightning Lane prices from one park's schedule entries.
 *
 * Within one date, the first valid purchase of each kind and each single id wins.
 * Non-positive, non-integer, or non-USD amounts are ignored.
 * Returns array sorted by date ascending.
 */
export function extractLlPrices(
  schedule: readonly ThemeParksScheduleEntry[],
): LlDayPrices[] {
  if (!Array.isArray(schedule) || schedule.length === 0) {
    return [];
  }

  const daysMap = new Map<string, LlDayPrices>();
  const singlesSeenByDate = new Map<string, Set<string>>();

  for (const se of schedule) {
    if (!se || typeof se.date !== 'string') continue;
    const dateParsed = new Date(se.date);
    if (Number.isNaN(dateParsed.getTime())) continue;
    const dateKey = dateParsed.toISOString().split('T')[0];
    if (!dateKey) continue;

    let dayPrices = daysMap.get(dateKey);
    if (!dayPrices) {
      dayPrices = { date: dateKey, singles: [] };
      daysMap.set(dateKey, dayPrices);
      singlesSeenByDate.set(dateKey, new Set<string>());
    }

    const seenSingles = singlesSeenByDate.get(dateKey)!;
    const purchases = Array.isArray(se.purchases) ? se.purchases : [];

    for (const p of purchases) {
      const classified = classifyPurchase(p);
      if (!classified) continue;

      // Currency check: if provided, must be USD
      if (
        p.price?.currency !== undefined &&
        p.price?.currency !== null &&
        p.price.currency !== 'USD'
      ) {
        continue;
      }

      // Amount check: integer > 0
      const amount = p.price?.amount;
      if (
        typeof amount !== 'number' ||
        !Number.isInteger(amount) ||
        amount <= 0
      ) {
        continue;
      }

      const available =
        typeof p.available === 'boolean' ? p.available : null;

      if (classified.kind === 'multi') {
        if (!dayPrices.multi) {
          dayPrices.multi = { cents: amount, available };
        }
      } else if (classified.kind === 'premier') {
        if (!dayPrices.premier) {
          dayPrices.premier = { cents: amount, available };
        }
      } else if (classified.kind === 'single') {
        if (!seenSingles.has(classified.id)) {
          seenSingles.add(classified.id);
          const attractionName =
            typeof p.name === 'string' && p.name.trim().length > 0
              ? p.name.trim()
              : '';
          dayPrices.singles.push({
            purchaseId: classified.id,
            attractionName,
            cents: amount,
            available,
          });
        }
      }
    }
  }

  return Array.from(daysMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

