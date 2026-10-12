/**
 * Pure receipt parsing and pattern matching logic (Tasks 14.2, 15.2, 15.3).
 *
 * Implements:
 * - parseReceiptText: Losslessly partitions recognized receipt text into items, charge lines,
 *   subtotal context, and ignored totals (Requirements 9.2, 9.5, 9.6, Property 8).
 * - flagAlcoholCandidate: Pattern-matches known alcohol terms and Disney lounge drinks,
 *   excluding non-alcoholic items like root beer (Requirement 9.8).
 * - matchMenuItemName: Suggests catalog restaurant menu item corrections (Requirement 9.9).
 * - extractTierPriceSuggestions: Suggests per-person pricing tiers from restaurant menus (Requirement 11.4).
 * - combineScannedReceipts: Multi-photo append and discard logic (Requirements 9.10, 9.11, 9.12, Property 9).
 *
 * PURE MODULE: Zero React imports, zero I/O, zero network calls (Requirement 9.7).
 */

import type { ChargeLineKind, MenuDTO } from '@dwt/shared';

export interface DraftReceiptItem {
  id?: string | undefined;
  name: string;
  priceCents: number;
  isAlcohol: boolean;
  assigneeIds?: string[] | undefined;
}

export interface DraftReceiptChargeLine {
  id?: string | undefined;
  kind: ChargeLineKind;
  amountCents: number;
  excludeAlcohol?: boolean | undefined;
}

export interface ParsedReceiptResult {
  items: DraftReceiptItem[];
  chargeLines: DraftReceiptChargeLine[];
  subtotalCents: number | null;
}

export type ReceiptLineClassification =
  | { kind: 'item'; item: DraftReceiptItem }
  | { kind: 'chargeLine'; chargeLine: DraftReceiptChargeLine }
  | { kind: 'subtotal'; amountCents: number }
  | { kind: 'ignored' };

const ALCOHOL_PATTERNS: readonly RegExp[] = [
  // Beer & Cider
  /\b(?:beer|draft|draught|craft\s+beer|cider|hard\s+cider)\b/i,
  /\b(?:ale|ipa|lager|pilsner|stout|porter|wheat\s+ale|pale\s+ale|hefeweizen)\b/i,
  /\b(?:bud\s*light|miller\s*lite|coors|michelob|corona|heineken|stella\s*artois|guinness|sam\s*adams|schofferhofer|schöfferhofer|safari\s*amber|kungaloosh)\b/i,
  // Wine & Sparkling
  /\b(?:wine|red\s+wine|white\s+wine|sparkling\s+wine)\b/i,
  /\b(?:chardonnay|cabernet|pinot\s*noir|pinot\s*grigio|merlot|sauvignon\s*blanc|riesling|prosecco|champagne|ros[eé]|moscato|zinfandel|malbec|syrah|shiraz|sangria)\b/i,
  // Cocktails & Mixed drinks
  /\b(?:cocktail|margarita|martini|mojito|mimosa|old\s*fashioned|manhattan|daiquiri|mule|moscow\s*mule|spritz|aperol\s*spritz|cosmopolitan|cosmo|negroni|whiskey\s*sour|paloma|mai\s*tai|pi[nñ]a\s*colada|colada|long\s*island)\b/i,
  // Spirits & Liquors
  /\b(?:liquor|spirits?|rum|vodka|gin|tequila|mezcal|whiskey|whisky|bourbon|scotch|cognac|brandy|liqueur|schnapps|triple\s*sec|aperol|campari|baileys|kahlua|grand\s*marnier)\b/i,
  // Disney-specific bar & lounge drinks
  /\b(?:lapu\s*lapu|uh-?oa|hippopotomai-?tai|spikey\s*pineapple|bespin\s*fizz|fuzzy\s*tauntaun|outer\s*rim|jet\s*juice|yub\s*nub|slug\s*slinger|tipsy\s*ducks|welsh\s*dragon|avocado\s*margarita)\b/i,
];

const NON_ALCOHOL_EXCLUSIONS: readonly RegExp[] = [
  /\b(?:root\s+beer|ginger\s+beer|beer\s+battered|non-?alcoholic|zero\s+proof|mocktail|virgin)\b/i,
];

/**
 * Flags candidate alcohol items against maintained common and Disney terms (Req 9.8).
 */
export function flagAlcoholCandidate(name: string): boolean {
  if (!name || !name.trim()) return false;
  const trimmed = name.trim();

  // Exclude explicit non-alcoholic items (e.g. Root Beer, Ginger Beer, Beer Battered)
  for (const exclusion of NON_ALCOHOL_EXCLUSIONS) {
    if (exclusion.test(trimmed)) {
      return false;
    }
  }

  for (const pattern of ALCOHOL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }

  return false;
}

const SUBTOTAL_REGEX = /\b(?:sub-?total|sub\s+total)\b/i;

const IGNORED_TOTAL_REGEXES: readonly RegExp[] = [
  /\b(?:grand\s+)?total\b/i,
  /\b(?:amount|balance)\s+due\b/i,
  /\bbalance\b/i,
  /\bamount\s+tendered\b/i,
  /\bchange\s*(?:due)?\b/i,
  /\b(?:cash|visa|mastercard|mc|amex|american\s+express|discover|apple\s+pay|google\s+pay)\b/i,
  /\b(?:suggested\s+gratuity|suggested\s+tip)\b/i,
  /\b\d+%\s*=\s*/i,
];

const TAX_REGEX = /\b(?:tax|sales\s*tax|state\s*tax|local\s*tax|food\s*tax|gst|hst|vat)\b/i;
const TIP_REGEX = /\b(?:tip|gratuity|auto\s*gratuity|service\s*charge|server\s*tip)\b/i;
const FEE_REGEX = /\b(?:fee|service\s*fee|delivery\s*fee|bag\s*fee|resort\s*fee|convenience\s*fee)\b/i;
const DISCOUNT_REGEX = /\b(?:discount|promo|coupon|passholder|ap\s*discount|dvc|cast\s*member|credit)\b/i;

interface ExtractedPrice {
  name: string;
  priceCents: number;
  isNegative: boolean;
}

function extractLinePrice(line: string): ExtractedPrice | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Match price at end of line:
  // e.g. "Item Name $12.50", "Item 12.50", "Discount -5.00", "Discount (5.00)", "Discount 5.00-"
  const match = trimmed.match(
    /^(.*?)(?:\s+)(?:[$€£])?\s*(?:(-?\d+\.\d{2})|\((\d+\.\d{2})\)|(\d+\.\d{2})-)\s*(?:[A-Za-z*])?$/
  );

  if (match) {
    const rawNum = match[2] ?? match[3] ?? match[4];
    if (rawNum) {
      const val = parseFloat(rawNum);
      const isNegative = val < 0 || Boolean(match[3]) || Boolean(match[4]);
      const priceCents = Math.round(Math.abs(val) * 100);
      return {
        name: (match[1] ?? '').trim(),
        priceCents,
        isNegative,
      };
    }
  }

  // Also check if line has dollar sign with decimal price
  const dollarMatch = trimmed.match(
    /^(.*?)(?:\s+)?\$(-?\d+(?:\.\d{2})?)\s*(?:[A-Za-z*])?$/
  );
  if (dollarMatch && dollarMatch[2]) {
    const val = parseFloat(dollarMatch[2]);
    return {
      name: (dollarMatch[1] ?? '').trim(),
      priceCents: Math.round(Math.abs(val) * 100),
      isNegative: val < 0,
    };
  }

  return null;
}

/**
 * Classifies a single line into exactly one of: item, chargeLine, subtotal, or ignored (Property 8).
 */
export function classifyReceiptLine(line: string): ReceiptLineClassification {
  const extracted = extractLinePrice(line);
  if (!extracted || extracted.priceCents <= 0) {
    return { kind: 'ignored' };
  }

  const { name, priceCents, isNegative } = extracted;

  // 1. Subtotal line (Req 9.6 context only)
  if (SUBTOTAL_REGEX.test(name) || SUBTOTAL_REGEX.test(line)) {
    return { kind: 'subtotal', amountCents: priceCents };
  }

  // 2. Ignored totals and payments
  for (const totalRegex of IGNORED_TOTAL_REGEXES) {
    if (totalRegex.test(name) || totalRegex.test(line)) {
      return { kind: 'ignored' };
    }
  }

  // 3. Charge lines
  if (TAX_REGEX.test(name)) {
    return { kind: 'chargeLine', chargeLine: { kind: 'tax', amountCents: priceCents } };
  }
  if (TIP_REGEX.test(name)) {
    return { kind: 'chargeLine', chargeLine: { kind: 'gratuity', amountCents: priceCents } };
  }
  if (FEE_REGEX.test(name)) {
    return { kind: 'chargeLine', chargeLine: { kind: 'fee', amountCents: priceCents } };
  }
  if (DISCOUNT_REGEX.test(name) || isNegative) {
    return { kind: 'chargeLine', chargeLine: { kind: 'discount', amountCents: priceCents } };
  }

  // 4. Candidate Expense Item
  // Clean leading quantity indicator like "1 ", "2x ", "1x "
  let itemName = name.replace(/^(\d+\s*x?\s*)/i, '').trim();
  if (!itemName) {
    itemName = name || 'Item';
  }

  const isAlcohol = flagAlcoholCandidate(itemName);

  return {
    kind: 'item',
    item: {
      name: itemName,
      priceCents,
      isAlcohol,
      assigneeIds: [],
    },
  };
}

/**
 * Pure parser: parses recognized receipt text into draft items, charge lines, and subtotal (Req 9.2, 9.6).
 * Lossless partition guaranteed by classifyReceiptLine (Property 8).
 */
export function parseReceiptText(rawText: string): ParsedReceiptResult {
  const items: DraftReceiptItem[] = [];
  const chargeLines: DraftReceiptChargeLine[] = [];
  let subtotalCents: number | null = null;

  if (!rawText || !rawText.trim()) {
    return { items, chargeLines, subtotalCents };
  }

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const classification = classifyReceiptLine(line);
    switch (classification.kind) {
      case 'item':
        items.push({
          ...classification.item,
          id: `draft-item-${items.length + 1}`,
        });
        break;
      case 'chargeLine':
        chargeLines.push({
          ...classification.chargeLine,
          id: `draft-charge-${chargeLines.length + 1}`,
        });
        break;
      case 'subtotal':
        subtotalCents = classification.amountCents;
        break;
      case 'ignored':
        break;
    }
  }

  return { items, chargeLines, subtotalCents };
}

function normalizeForComparison(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) {
    const row = dp[i];
    if (row) row[0] = i;
  }
  const firstRow = dp[0];
  if (firstRow) {
    for (let j = 0; j <= n; j++) firstRow[j] = j;
  }
  for (let i = 1; i <= m; i++) {
    const prevRow = dp[i - 1];
    const currRow = dp[i];
    if (!prevRow || !currRow) continue;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val1 = (prevRow[j] ?? 0) + 1;
      const val2 = (currRow[j - 1] ?? 0) + 1;
      const val3 = (prevRow[j - 1] ?? 0) + cost;
      currRow[j] = Math.min(val1, val2, val3);
    }
  }
  return dp[m]?.[n] ?? 0;
}

/**
 * Matches a recognized receipt item name against known restaurant menu items (Req 9.9, 11.9).
 * Returns the matched menu item name on confident match, or null.
 */
export function matchMenuItemName(
  recognizedName: string,
  menuItemNames: readonly string[]
): string | null {
  if (!recognizedName || !menuItemNames || menuItemNames.length === 0) return null;

  const normRec = normalizeForComparison(recognizedName);
  if (!normRec) return null;

  // 1. Exact normalized match
  for (const item of menuItemNames) {
    if (normalizeForComparison(item) === normRec) {
      return item;
    }
  }

  // 2. Substring match for substantial names
  if (normRec.length >= 4) {
    for (const item of menuItemNames) {
      const normItem = normalizeForComparison(item);
      if (normItem.includes(normRec) || normRec.includes(normItem)) {
        return item;
      }
    }
  }

  // 3. Levenshtein edit distance for OCR typos
  if (normRec.length >= 5) {
    let closestItem: string | null = null;
    let minDistance = 3;
    for (const item of menuItemNames) {
      const normItem = normalizeForComparison(item);
      const dist = levenshteinDistance(normRec, normItem);
      if (dist <= 2 && dist < minDistance) {
        minDistance = dist;
        closestItem = item;
      }
    }
    if (closestItem) {
      return closestItem;
    }
  }

  // 4. Token overlap (Jaccard similarity >= 0.6)
  const recTokens = new Set(normRec.split(' ').filter(w => w.length > 2));
  if (recTokens.size > 0) {
    let bestScore = 0;
    let bestMatch: string | null = null;
    for (const item of menuItemNames) {
      const itemTokens = new Set(normalizeForComparison(item).split(' ').filter(w => w.length > 2));
      if (itemTokens.size === 0) continue;
      let intersection = 0;
      for (const t of recTokens) {
        if (itemTokens.has(t)) intersection++;
      }
      const union = new Set([...recTokens, ...itemTokens]).size;
      const score = intersection / union;
      if (score >= 0.6 && score > bestScore) {
        bestScore = score;
        bestMatch = item;
      }
    }
    if (bestMatch) return bestMatch;
  }

  return null;
}

/**
 * Extracts suggested pricing tiers from cached restaurant menus (Req 11.4, 11.5).
 * Matches patterns like "$65 per adult", "$40 per child", "Adult: $65".
 */
export function extractTierPriceSuggestions(
  menus?: readonly MenuDTO[] | null
): { name: string; priceCents: number }[] {
  if (!menus || menus.length === 0) return [];

  const suggestions: { name: string; priceCents: number }[] = [];
  const seen = new Set<string>();

  for (const menu of menus) {
    for (const group of menu.groups ?? []) {
      for (const item of group.items ?? []) {
        const text = `${item.name} ${item.price ?? ''}`;

        // Pattern 1: "$65 per adult", "$40 per child"
        const perMatch = text.match(/\$?(\d+(?:\.\d{2})?)\s*(?:per|\/)\s*(adult|child|guest|senior)/i);
        if (perMatch && perMatch[1] && perMatch[2]) {
          const price = Math.round(parseFloat(perMatch[1]) * 100);
          const name = perMatch[2].charAt(0).toUpperCase() + perMatch[2].slice(1).toLowerCase();
          if (!seen.has(name) && price > 0) {
            seen.add(name);
            suggestions.push({ name, priceCents: price });
          }
        }

        // Pattern 2: "Adult: $65.00", "Child: $40.00"
        const colonMatch = text.match(/(Adult|Child|Guest|Senior)\s*:\s*\$?(\d+(?:\.\d{2})?)/i);
        if (colonMatch && colonMatch[1] && colonMatch[2]) {
          const name = colonMatch[1].charAt(0).toUpperCase() + colonMatch[1].slice(1).toLowerCase();
          const price = Math.round(parseFloat(colonMatch[2]) * 100);
          if (!seen.has(name) && price > 0) {
            seen.add(name);
            suggestions.push({ name, priceCents: price });
          }
        }
      }
    }
  }

  return suggestions;
}

/**
 * Multi-photo receipt support (Req 9.10, 9.11, 9.12, Property 9).
 */
export interface ScannedPhotoReceipt {
  id: string;
  rawText: string;
  items: DraftReceiptItem[];
  chargeLines: DraftReceiptChargeLine[];
  subtotalCents: number | null;
}

export function createScannedPhotoReceipt(photoId: string, rawText: string): ScannedPhotoReceipt {
  const parsed = parseReceiptText(rawText);
  return {
    id: photoId,
    rawText,
    items: parsed.items.map((it, idx) => ({ ...it, id: `${photoId}-item-${idx + 1}` })),
    chargeLines: parsed.chargeLines.map((cl, idx) => ({ ...cl, id: `${photoId}-charge-${idx + 1}` })),
    subtotalCents: parsed.subtotalCents,
  };
}

export function combineScannedReceipts(photos: readonly ScannedPhotoReceipt[]): {
  items: DraftReceiptItem[];
  chargeLines: DraftReceiptChargeLine[];
  subtotals: (number | null)[];
} {
  const items: DraftReceiptItem[] = [];
  const chargeLines: DraftReceiptChargeLine[] = [];
  const subtotals: (number | null)[] = [];

  for (const photo of photos) {
    items.push(...photo.items);
    chargeLines.push(...photo.chargeLines);
    if (photo.subtotalCents !== null) {
      subtotals.push(photo.subtotalCents);
    }
  }

  return { items, chargeLines, subtotals };
}

/**
 * Realistic sample Disney dining receipt for demonstrations, testing, and environments
 * where custom native OCR binaries are not available (e.g. Expo Go).
 */
export const SAMPLE_DISNEY_RECEIPT = `Be Our Guest Restaurant
Magic Kingdom Park
1 French Dip Sandwich $19.99
1 Croque Monsieur $17.50
1 French Onion Soup $11.00
1 Gaston's Brew $6.50
Subtotal $54.99
Sales Tax $3.57
Gratuity $10.00
Total $68.56`;

