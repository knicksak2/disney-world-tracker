/**
 * Pure derivation core for the Menu_Summary_Card (R4.1).
 *
 * `summarizeMenus` reduces an already-fetched list of `MenuDTO`s to the compact
 * shape the Menu_Summary_Card displays: the number of menus and the ordered
 * list of each menu's `menuType` label. It is pure, total, and framework-free
 * (no React, no react-navigation) so the "card summary reflects the menus"
 * guarantee (Property 6) is property-testable without rendering. It never
 * mutates its input and preserves the provided order of the menus.
 */

import type { MenuDTO } from '@dwt/shared';

/** Compact summary of a restaurant's available menus shown on the card (R4.1). */
export interface MenuSummary {
  /** Number of menus available. */
  readonly count: number;
  /** Each menu's `menuType`, in the provided order. */
  readonly menuTypes: readonly string[];
}

/**
 * Summarize a menu list into its count and the ordered list of menu-type
 * labels the Menu_Summary_Card renders (R4.1). Pure and total: any list
 * (including empty) maps to a well-formed `MenuSummary` preserving order.
 */
export function summarizeMenus(menus: readonly MenuDTO[]): MenuSummary {
  return {
    count: menus.length,
    menuTypes: menus.map((menu) => menu.menuType),
  };
}
