/**
 * Menu-keyword Festival_Booth discovery (festival-booth-tagging R3.8, R3.9).
 *
 * The `Festival Kiosk` `quickService` facet (R3.3) reliably identifies the
 * temporary "Marketplace - X" structures, but several PERMANENT restaurants
 * also carry genuine festival-specific menu items without that facet —
 * verified against this app's own persisted menu cache for Tangierine Cafe:
 * Flavors of the Medina, Marketplace - Hawai'i, Swirled Showcase, La
 * Poutinerie, Regal Eagle Smokehouse, and Block & Hans. Disney writes the
 * festival-named menu group inconsistently:
 *
 *   - "Food & Wine Festival Food Offerings" (ampersand, plural)
 *   - "Food and Wine Festival Beverage Offering" (spelled "and", singular)
 *   - "Food & Wine Festival Alcoholic Beverage Offerings"
 *
 * A false-positive risk was also found and must be guarded against:
 * `Funnel Cake`'s cached menu carries a "Flower & Garden Festival Food
 * Offerings" group — a different festival's keyword. A menu-keyword match for
 * one festival must never fire on a different festival's menu group name
 * (Property 30).
 *
 * Validates: Requirements 3.8, 3.9, 10.1
 */

import type { FestivalSlug, MenuDTO } from '@dwt/shared';

/**
 * Per-festival keyword pattern used to recognize a menu group as belonging to
 * that festival, tolerant of Disney's "&" vs "and" and singular/plural
 * "Offering(s)" wording variants. Each pattern anchors on the festival's own
 * distinguishing word(s) immediately followed by "Festival", so a different
 * festival's menu group name (e.g. "Flower & Garden Festival...") can never
 * match another festival's pattern (R3.9).
 */
const FESTIVAL_MENU_KEYWORDS: Record<FestivalSlug, RegExp> = {
  'food-and-wine': /food\s*(?:&|and)\s*wine\s+festival/i,
  'flower-and-garden': /flower\s*(?:&|and)\s*garden\s+festival/i,
  'festival-of-the-arts': /festival\s+of\s+the\s+arts/i,
  'festival-of-the-holidays': /festival\s+of\s+the\s+holidays/i,
};

/**
 * Whether any group across any of the supplied menus has a name matching the
 * given Festival's keyword pattern (R3.8). Pure and total: an empty or absent
 * `menus` array never matches.
 */
export function menuMatchesFestival(
  menus: readonly MenuDTO[],
  slug: FestivalSlug,
): boolean {
  const pattern = FESTIVAL_MENU_KEYWORDS[slug];
  return menus.some((menu) =>
    menu.groups.some((group) => pattern.test(group.name)),
  );
}

/**
 * Like {@link menuMatchesFestival}, but returns the matching item NAMES
 * instead of a boolean — the dish-level signal Requirement 10.1 needs so a
 * `match_kind = 'menu'` Festival_Tag can be paired with per-dish
 * Food_Item_Festival_Tags for exactly the dishes found inside a matching
 * menu group (never every dish the restaurant serves).
 *
 * Pure and total; dedupes by case-insensitive trimmed name (mirrors
 * `food_items`' own case-insensitive per-scope uniqueness, so every returned
 * name maps to exactly one `food_items` row when resolved by the caller).
 *
 * `festivalMatchingItemNames(menus, slug).length > 0` is equivalent to
 * `menuMatchesFestival(menus, slug)`; the latter is kept as its own function
 * (unchanged) since `repo.ts`'s discovery filter has no need for the full
 * name list and changing its signature would be a gratuitous breaking change
 * to an already-tested function (R3.8, R3.9).
 */
export function festivalMatchingItemNames(
  menus: readonly MenuDTO[],
  slug: FestivalSlug,
): readonly string[] {
  const pattern = FESTIVAL_MENU_KEYWORDS[slug];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const menu of menus) {
    for (const group of menu.groups) {
      if (!pattern.test(group.name)) continue;
      for (const item of group.items) {
        const trimmed = item.name.trim();
        const key = trimmed.toLowerCase();
        if (trimmed.length === 0 || seen.has(key)) continue;
        seen.add(key);
        names.push(trimmed);
      }
    }
  }
  return names;
}
