/**
 * Verifies that Friend Food Ratings constants, schemas, and DTOs are properly
 * re-exported from the packages/shared index barrel.
 */

import { describe, expect, it } from 'vitest';
import * as Shared from '../index.js';

describe('Friend Food Ratings barrel exports', () => {
  it('exports all expected constants', () => {
    expect(Shared.FRIEND_FOOD_PAGE_SIZE_DEFAULT).toBe(20);
    expect(Shared.FRIEND_FOOD_PAGE_SIZE_MAX).toBe(50);
    expect(Shared.FRIEND_FOOD_HIGHLIGHT_COUNT).toBe(5);
    expect(Shared.FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS).toBe(1);
    expect(Shared.FRIEND_FOOD_SEARCH_MAX_LENGTH).toBe(100);
    expect(Shared.FRIEND_FOOD_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(Shared.FRIEND_FOOD_SCOPES_MAX).toBe(200);
    expect(Shared.FRIEND_FOOD_INLINE_MAX_FRIENDS).toBe(3);
    expect(Shared.FRIEND_FOOD_BATCH_MAX_ROWS).toBe(5000);
    expect(Shared.FRIEND_FOOD_SORTS).toEqual(['highest_rated', 'recent', 'most_logged']);
  });

  it('exports the query schema', () => {
    expect(typeof Shared.friendFoodRatingsQuerySchema.parse).toBe('function');
  });
});
