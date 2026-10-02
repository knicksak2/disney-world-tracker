/**
 * Food_Item wire contracts (Feature: food-item-logging).
 *
 * Validates: Requirements 1.6, 1.8, 2.1, 6.5, 6.6
 */

export interface FoodItemDTO {
  readonly id: string;
  /** Exactly one of `experienceId`/`locationId` is non-null (Requirement 6.6). */
  readonly experienceId: string | null;
  readonly locationId: string | null;
  readonly name: string;
  readonly price: string | null;
  readonly source: 'menu_sync' | 'user_submitted';
  /**
   * `true` when this item is a `user_submitted` entry, or its `last_seen_at`
   * falls within the Restaurant_Experience's most recent successful menu-sync
   * fetch; `false` when a `menu_sync` item was not seen in that most recent
   * fetch (the dish dropped off the current menu). Computed at read time from
   * `food_items.last_seen_at` vs. `experience_menus.fetched_at` — never a
   * stored column, so it always reflects the latest sync without a backfill
   * (Requirement 1.7, 1.8).
   */
  readonly currentlyOnMenu: boolean;
}

export interface SubmitFoodItemInputDTO {
  readonly name: string;
}

export interface FoodItemsResponseDTO {
  readonly items: readonly FoodItemDTO[];
  readonly menus?: readonly import('./Menu.js').MenuDTO[];
}
