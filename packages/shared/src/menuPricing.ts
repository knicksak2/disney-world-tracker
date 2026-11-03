/**
 * Shared menu price parsing, promotion, and tier suggestion helpers.
 *
 * Implements pure, I/O-free price extraction from menu item names, prices,
 * and group headers.
 *
 * Validates: Requirements 9.5, 9.10, 10.1, 10.2, 10.3, 10.4, 10.8,
 *            Properties 5, 6, 7, 34
 */

import type { MenuDTO, MenuItemDTO } from './dto/Menu.js';
import { EXPENSE_TIER_NAME_MAX } from './tripExpenses.js';

const NON_USD_REGEX = /[\u20AC\u00A3\u00A5]|EUR|GBP|JPY/i;

/**
 * Converts a decimal string ("12.50", "45", "19.99") into integer cents
 * without floating-point rounding issues.
 * Returns null if non-numeric, <= 0, or not finite.
 */
function decimalStringToCents(str: string): number | null {
  const parts = str.split('.');
  const whole = parseInt(parts[0]!, 10);
  if (!Number.isFinite(whole)) return null;
  let fraction = 0;
  if (parts.length > 1 && parts[1] !== undefined) {
    const fractionStr = parts[1].padEnd(2, '0').slice(0, 2);
    fraction = parseInt(fractionStr, 10);
    if (!Number.isFinite(fraction)) return null;
  }
  const cents = whole * 100 + fraction;
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/**
 * All USD amounts in `text`, in order, as integer cents (> 0, finite).
 * "$12 / $18" -> [1200, 1800].
 * Non-USD tokens produce nothing.
 */
export function parseDollarAmounts(text: string): number[] {
  if (!text || typeof text !== 'string') return [];

  // Match dollar amounts prefixed with $ or with explicit USD
  const dollarRegex = /(?:^|[^a-zA-Z0-9\u20AC\u00A3\u00A5])\$\s*(\d+(?:\.\d{1,2})?)(?!\s*(?:[\u20AC\u00A3\u00A5]|EUR|GBP|JPY))/gi;
  const results: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = dollarRegex.exec(text)) !== null) {
    const numStr = match[1];
    if (numStr) {
      const cents = decimalStringToCents(numStr);
      if (cents !== null && cents > 0) {
        results.push(cents);
      }
    }
  }

  return results;
}

/**
 * Parse a verbatim menu `price` string. Returns [] when nothing parses.
 */
export function parseMenuPriceString(price: string | null | undefined): number[] {
  if (!price || typeof price !== 'string') return [];

  if (NON_USD_REGEX.test(price) && !price.includes('$')) {
    return [];
  }

  const dollarAmounts = parseDollarAmounts(price);
  if (dollarAmounts.length > 0) {
    return dollarAmounts;
  }

  // If no $ sign was present, but string is a plain positive number
  if (!NON_USD_REGEX.test(price)) {
    const match = price.trim().match(/^(\d+(?:\.\d{1,2})?)$/);
    if (match && match[1]) {
      const cents = decimalStringToCents(match[1]);
      if (cents !== null && cents > 0) {
        return [cents];
      }
    }
  }

  return [];
}

export interface MenuPriceOffer {
  readonly kind: 'per_person_tier' | 'fixed_menu' | 'banner_item';
  readonly label: string; // "Adult", "Child", "Person", item title, or banner item name
  readonly audience: 'adult' | 'child' | 'person' | null;
  readonly priceCents: number;
  readonly menuType: string;
  readonly sourceText: string;
}

const PER_PERSON_REGEX = /\$?(\d+(?:\.\d{2})?)\s*(?:per|\/)\s*(adult|child|guest|senior|person)/i;
const COLON_REGEX = /(Adult|Child|Guest|Senior)\s*:\s*\$?(\d+(?:\.\d{2})?)/i;
const FIXED_MENU_GROUP_REGEX = /\(\s*\$?(\d+(?:\.\d{2})?)\s*(?:per|\/)\s*(person|adult|child|guest)\s*\)/i;
const BANNER_GROUP_REGEX = /pricing|prix fixe|buffet|price/i;

function mapAudience(raw: string): 'adult' | 'child' | 'person' {
  const lower = raw.toLowerCase();
  if (lower === 'adult' || lower === 'senior') return 'adult';
  if (lower === 'child') return 'child';
  return 'person';
}

/**
 * Extracts structured price offers (tiers, fixed menus, group banners)
 * from a list of restaurant menus.
 */
export function extractMenuPriceOffers(
  menus: readonly MenuDTO[] | null | undefined
): MenuPriceOffer[] {
  if (!menus || menus.length === 0) return [];

  const offers: MenuPriceOffer[] = [];
  const seenLabels = new Set<string>();

  for (const menu of menus) {
    const menuType = menu.menuType ?? '';

    for (const group of menu.groups ?? []) {
      const groupName = group.name ?? '';

      // Pattern 3: Group name contains "($N per person)" or "($N per adult)" -> fixed_menu
      const fixedMatch = groupName.match(FIXED_MENU_GROUP_REGEX);
      if (fixedMatch && fixedMatch[1] && fixedMatch[2]) {
        const cents = decimalStringToCents(fixedMatch[1]);
        const label = groupName.trim();
        if (cents !== null && cents > 0 && !seenLabels.has(label)) {
          seenLabels.add(label);
          offers.push({
            kind: 'fixed_menu',
            label,
            audience: mapAudience(fixedMatch[2]),
            priceCents: cents,
            menuType,
            sourceText: groupName,
          });
        }
      }

      // Process items within group
      const isBannerGroup = BANNER_GROUP_REGEX.test(groupName);

      for (const item of group.items ?? []) {
        const text = `${item.name} ${item.price ?? ''}`;

        // Pattern 1: "$65 per adult", "$40 per child", "$50 per person"
        const perMatch = text.match(PER_PERSON_REGEX);
        if (perMatch && perMatch[1] && perMatch[2]) {
          const cents = decimalStringToCents(perMatch[1]);
          const rawAudience = perMatch[2];
          const label = rawAudience.charAt(0).toUpperCase() + rawAudience.slice(1).toLowerCase();
          if (cents !== null && cents > 0 && !seenLabels.has(label)) {
            seenLabels.add(label);
            offers.push({
              kind: 'per_person_tier',
              label,
              audience: mapAudience(rawAudience),
              priceCents: cents,
              menuType,
              sourceText: text.trim(),
            });
          }
          continue;
        }

        // Pattern 2: "Adult: $65.00", "Child: $40.00"
        const colonMatch = text.match(COLON_REGEX);
        if (colonMatch && colonMatch[1] && colonMatch[2]) {
          const cents = decimalStringToCents(colonMatch[2]);
          const rawAudience = colonMatch[1];
          const label = rawAudience.charAt(0).toUpperCase() + rawAudience.slice(1).toLowerCase();
          if (cents !== null && cents > 0 && !seenLabels.has(label)) {
            seenLabels.add(label);
            offers.push({
              kind: 'per_person_tier',
              label,
              audience: mapAudience(rawAudience),
              priceCents: cents,
              menuType,
              sourceText: text.trim(),
            });
          }
          continue;
        }

        // Pattern 4: Group name matches /pricing|prix fixe|buffet|price/i and item has a single price
        if (isBannerGroup) {
          let itemCents = item.priceCents ?? null;
          if (!itemCents && item.price) {
            const parsed = parseMenuPriceString(item.price);
            if (parsed.length === 1 && parsed[0] !== undefined) {
              itemCents = parsed[0];
            }
          }
          if (itemCents !== null && itemCents > 0) {
            const label = item.name.trim();
            if (label && !seenLabels.has(label)) {
              seenLabels.add(label);
              let aud: 'adult' | 'child' | 'person' | null = null;
              if (/\badult\b/i.test(label)) aud = 'adult';
              else if (/\bchild\b/i.test(label)) aud = 'child';
              else if (/\bperson|guest\b/i.test(label)) aud = 'person';

              offers.push({
                kind: 'banner_item',
                label,
                audience: aud,
                priceCents: itemCents,
                menuType,
                sourceText: text.trim(),
              });
            }
          }
        }
      }
    }
  }

  return offers;
}

/**
 * Promoted from receiptScan.pure.ts. Same signature and behavior for existing inputs.
 * Returns per_person_tier offers as { name, priceCents }.
 */
export function extractTierPriceSuggestions(
  menus?: readonly MenuDTO[] | null
): { name: string; priceCents: number }[] {
  if (!menus || menus.length === 0) return [];

  const offers = extractMenuPriceOffers(menus);
  return offers
    .filter((o) => o.kind === 'per_person_tier')
    .map((o) => ({ name: o.label, priceCents: o.priceCents }));
}

/** Returns true if group type indicates alcohol */
export function isAlcoholGroupType(type: string | null | undefined): boolean {
  return /alcohol/i.test(type ?? '');
}

/** 4995 -> "$49.95" */
export function formatCentsAsDollarString(cents: number): string {
  const isNegative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const sign = isNegative ? '-' : '';
  return `${sign}$${dollars}.${remainder.toString().padStart(2, '0')}`;
}

/** Normalizes menu item name for both-sides comparison (round 4 L9) */
export function normalizeMenuName(s: string): string {
  return s.trim().slice(0, 100);
}

/** Normalizes offer label for tier name storage and verification (round 5 L8) */
export function normalizeTierName(label: string): string {
  return label.trim().slice(0, EXPENSE_TIER_NAME_MAX);
}

export interface MenuEstimatePerPerson {
  readonly perPersonCents: number;
  readonly basis: 'entrees' | 'items';
  readonly sampleCount: number;
}

const ENTREE_GROUP_REGEX =
  /entree|entr\u00e9e|main|platter|sandwich|burger|pasta|steak|seafood|specialt|bowl|taco|pizza|flatbread|rib|chicken|feast/i;
const NON_ENTREE_GROUP_REGEX =
  /kid|child|side|beverage|drink|alcohol|cocktail|wine|beer|dessert|snack|appetizer|starter|enhanc|accompaniment|soup|salad|bakery/i;

function resolveItemRepresentativeCents(item: MenuItemDTO): number | null {
  if (typeof item.priceCents === 'number' && Number.isSafeInteger(item.priceCents) && item.priceCents > 0) {
    return item.priceCents;
  }
  if (item.prices && item.prices.length > 0) {
    const valid = item.prices.map((p) => p.cents).filter((c) => Number.isSafeInteger(c) && c > 0);
    if (valid.length > 0) {
      const sum = valid.reduce((a, b) => a + b, 0);
      return Math.round(sum / valid.length);
    }
  }
  const parsed = parseMenuPriceString(item.price);
  if (parsed.length > 0) {
    const sum = parsed.reduce((a, b) => a + b, 0);
    return Math.round(sum / parsed.length);
  }
  return null;
}

/**
 * Computes an estimated per-person meal cost in integer cents from cached MenuDTOs.
 * Prefers entrée/main-course groups when at least 2 priced items exist there;
 * otherwise averages all non-alcoholic priced items. Returns null when no priced items exist.
 *
 * Validates: Requirement 9.11, Property 50(a)
 */
export function computeMenuEstimatePerPerson(
  menus: readonly MenuDTO[] | null | undefined
): MenuEstimatePerPerson | null {
  if (!menus || menus.length === 0) return null;

  const entreePrices: number[] = [];
  const allNonAlcoholPrices: number[] = [];

  for (const menu of menus) {
    for (const group of menu.groups ?? []) {
      const groupName = group.name ?? '';
      const groupType = group.type ?? '';
      const combinedGroupText = `${groupType} ${groupName}`;

      if (isAlcoholGroupType(groupType) || isAlcoholGroupType(groupName)) {
        continue;
      }

      const isEntreeGroup =
        ENTREE_GROUP_REGEX.test(combinedGroupText) && !NON_ENTREE_GROUP_REGEX.test(combinedGroupText);

      for (const item of group.items ?? []) {
        const cents = resolveItemRepresentativeCents(item);
        if (cents !== null && cents > 0) {
          allNonAlcoholPrices.push(cents);
          if (isEntreeGroup) {
            entreePrices.push(cents);
          }
        }
      }
    }
  }

  if (entreePrices.length >= 2) {
    const total = entreePrices.reduce((a, b) => a + b, 0);
    return {
      perPersonCents: Math.round(total / entreePrices.length),
      basis: 'entrees',
      sampleCount: entreePrices.length,
    };
  }

  if (allNonAlcoholPrices.length >= 1) {
    const total = allNonAlcoholPrices.reduce((a, b) => a + b, 0);
    return {
      perPersonCents: Math.round(total / allNonAlcoholPrices.length),
      basis: 'items',
      sampleCount: allNonAlcoholPrices.length,
    };
  }

  return null;
}


