/**
 * Unit tests for Friend Food Ratings schemas and constants.
 *
 * Validates: Requirements 6.2, 6.4, 6.5, 6.6, 6.7, 11.1
 */

import { describe, expect, it } from 'vitest';
import {
  FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS,
  FRIEND_FOOD_PAGE_SIZE_DEFAULT,
  FRIEND_FOOD_PAGE_SIZE_MAX,
  FRIEND_FOOD_SEARCH_MAX_LENGTH,
  FRIEND_FOOD_SORTS,
} from '../../constants/friendFoodRatings.js';
import { FOOD_STATS_MIN_RATED_LOGS } from '../../dto/Stats.js';
import { PARKS } from '../../enums.js';
import { friendFoodRatingsQuerySchema } from '../FriendFoodRatings.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('friendFoodRatingsQuerySchema', () => {
  it('applies defaults for an empty query object', () => {
    const parsed = friendFoodRatingsQuerySchema.parse({});
    expect(parsed.sort).toBe('recent');
    expect(parsed.limit).toBe(FRIEND_FOOD_PAGE_SIZE_DEFAULT);
    expect(parsed.minRatedLogs).toBe(0);
    expect(parsed.cursor).toBeUndefined();
    expect(parsed.experienceId).toBeUndefined();
    expect(parsed.locationId).toBeUndefined();
    expect(parsed.park).toBeUndefined();
    expect(parsed.q).toBeUndefined();
  });

  it('accepts every valid filter individually and combined (with experienceId)', () => {
    const parsed = friendFoodRatingsQuerySchema.parse({
      sort: 'highest_rated',
      cursor: 'eyJ2IjoxLCJzIjoiaGlnaGVzdF9yYXRlZCJ9',
      limit: 10,
      experienceId: UUID_A,
      park: 'Magic Kingdom',
      q: '  Dole Whip  ',
      minRatedLogs: 2,
    });

    expect(parsed.sort).toBe('highest_rated');
    expect(parsed.cursor).toBe('eyJ2IjoxLCJzIjoiaGlnaGVzdF9yYXRlZCJ9');
    expect(parsed.limit).toBe(10);
    expect(parsed.experienceId).toBe(UUID_A);
    expect(parsed.locationId).toBeUndefined();
    expect(parsed.park).toBe('Magic Kingdom');
    expect(parsed.q).toBe('Dole Whip'); // trims whitespace
    expect(parsed.minRatedLogs).toBe(2);
  });

  it('accepts locationId when experienceId is not provided', () => {
    const parsed = friendFoodRatingsQuerySchema.parse({
      locationId: UUID_B,
    });
    expect(parsed.locationId).toBe(UUID_B);
    expect(parsed.experienceId).toBeUndefined();
  });

  it('accepts all valid sort values', () => {
    for (const sort of FRIEND_FOOD_SORTS) {
      const parsed = friendFoodRatingsQuerySchema.parse({ sort });
      expect(parsed.sort).toBe(sort);
    }
  });

  it('coerces string limits and minRatedLogs to integers', () => {
    const parsed = friendFoodRatingsQuerySchema.parse({
      limit: '15',
      minRatedLogs: '3',
    });
    expect(parsed.limit).toBe(15);
    expect(parsed.minRatedLogs).toBe(3);
  });

  it('rejects invalid sort', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ sort: 'alphabetical' })).toThrow();
  });

  it('rejects limit 0', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ limit: 0 })).toThrow();
  });

  it('rejects limit greater than max (51)', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ limit: FRIEND_FOOD_PAGE_SIZE_MAX + 1 })).toThrow();
  });

  it('rejects empty q string', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ q: '' })).toThrow();
  });

  it('rejects whitespace-only q string after trimming', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ q: '   ' })).toThrow();
  });

  it('rejects q exceeding max length (101 characters)', () => {
    const longQ = 'a'.repeat(FRIEND_FOOD_SEARCH_MAX_LENGTH + 1);
    expect(() => friendFoodRatingsQuerySchema.parse({ q: longQ })).toThrow();
  });

  it('accepts q of exact max length (100 characters)', () => {
    const maxQ = 'a'.repeat(FRIEND_FOOD_SEARCH_MAX_LENGTH);
    const parsed = friendFoodRatingsQuerySchema.parse({ q: maxQ });
    expect(parsed.q).toBe(maxQ);
  });

  it('rejects when both experienceId and locationId are supplied', () => {
    expect(() =>
      friendFoodRatingsQuerySchema.parse({
        experienceId: UUID_A,
        locationId: UUID_B,
      }),
    ).toThrow(/Specify at most one of experienceId or locationId/);
  });

  it('rejects invalid park', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ park: 'Disneyland' })).toThrow();
  });

  it('accepts each valid park', () => {
    for (const park of PARKS) {
      const parsed = friendFoodRatingsQuerySchema.parse({ park });
      expect(parsed.park).toBe(park);
    }
  });

  it('rejects unknown query keys (.strict())', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ unknownFilter: 'value' })).toThrow();
  });

  it('rejects minRatedLogs exceeding 10 (11)', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ minRatedLogs: 11 })).toThrow();
  });

  it('rejects negative minRatedLogs (-1)', () => {
    expect(() => friendFoodRatingsQuerySchema.parse({ minRatedLogs: -1 })).toThrow();
  });
});

describe('Constants check', () => {
  it('enforces FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS < FOOD_STATS_MIN_RATED_LOGS', () => {
    expect(FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS).toBeLessThan(FOOD_STATS_MIN_RATED_LOGS);
    expect(FRIEND_FOOD_HIGHLIGHT_MIN_RATED_LOGS).toBe(1);
    expect(FOOD_STATS_MIN_RATED_LOGS).toBe(2);
  });
});
