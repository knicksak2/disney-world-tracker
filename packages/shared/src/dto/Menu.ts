/**
 * Dining DTOs: `MealPeriodDTO` and `MenuDTO`.
 *
 * These carry the dining enrichment sourced from Disney for a restaurant
 * Experience. `MealPeriodDTO` is a lightweight facet (meal type + optional
 * price tier) persisted on the Experience itself (R5.5, R5.6), while `MenuDTO`
 * is the full menu structure fetched best-effort from the Menu_Service and
 * exposed on the Experience detail view (R8.2, R8.5).
 *
 * Types only — validation lives in `packages/shared/src/schemas/`.
 *
 * Validates: Requirements 5.5, 5.6, 8.2, 8.5
 */

/**
 * A single meal period on a restaurant Experience (e.g. `Breakfast`, `Lunch`,
 * `Dinner`) with its optional price tier. `priceTier` is `null`/absent when the
 * upstream document carries no tier for the period (R5.5).
 */
export interface MealPeriodDTO {
  /** Meal_Period type label copied from the Facility_Document (R5.5). */
  readonly type: string;
  /** Price tier for the period (e.g. `"$"`), or `null` when absent (R5.5). */
  readonly priceTier?: string | null;
}

/**
 * A single dining menu for a restaurant Experience, projected from the
 * Menu_Service payload. Each menu carries its type, an optional cuisine type,
 * and one or more named groups; each group lists its items with an optional
 * price string carried verbatim from upstream (R8.2).
 */
export interface MenuDTO {
  /** Menu_Type label (e.g. `"Dinner"`, `"All Day"`) (R8.2). */
  readonly menuType: string;
  /** Cuisine type when present upstream, else `null` (R8.2). */
  readonly cuisineType?: string | null;
  /** Menu groups (courses/sections), each with its items (R8.2). */
  readonly groups: readonly {
    /** Group name (e.g. `"Appetizers"`) (R8.2). */
    readonly name: string;
    /** Items in the group, each with a name and optional price string (R8.2). */
    readonly items: readonly {
      readonly name: string;
      /** Price string carried verbatim from upstream, or `null` when absent. */
      readonly price?: string | null;
    }[];
  }[];
}
