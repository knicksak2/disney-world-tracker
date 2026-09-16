/**
 * Food_Item_Log wire contracts (Feature: food-item-logging).
 *
 * Validates: Requirements 3.1, 4.1, 4.2
 */

export interface FoodItemLogDTO {
  readonly id: string;
  readonly userId: string;
  readonly foodItemId: string;
  readonly visitedOn: string; // YYYY-MM-DD
  readonly userTz: string;
  readonly loggedAt: string; // ISO-8601 UTC
  readonly rating: number | null; // 1..10
  readonly note: string | null;
}

export interface FoodItemLogHistoryDTO {
  readonly foodItemId: string;
  readonly repeatCount: number;
  readonly logs: readonly FoodItemLogDTO[];
}

export interface CreateFoodItemLogInputDTO {
  readonly visitedOn: string; // YYYY-MM-DD
  readonly userTz: string;
  readonly rating?: number | null;
  readonly note?: string | null;
}

export interface FoodItemLogWithContextDTO extends FoodItemLogDTO {
  readonly foodItemName: string;
  readonly currentlyOnMenu: boolean;
  readonly restaurantName: string | null;
  readonly locationName: string | null;
}

