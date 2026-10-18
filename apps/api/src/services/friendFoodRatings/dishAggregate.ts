/**
 * Pure aggregation, sorting, cursor encoding/decoding, and LIKE pattern
 * construction for the Friend Food Ratings service.
 *
 * This module has no I/O and acts as the pure domain model and property-test
 * reference for the SQL queries in repo.ts.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 5.3, 6.1, 6.2, 6.3, 6.5, 14.5, 16.1, 16.3
 */

import type {
  AvatarPresetId,
  FriendDishFriendRatingDTO,
  FriendDishSocialProofDTO,
  FriendFoodSort,
} from '@dwt/shared';
import { AppError } from '../../errors/AppError.js';

export interface DishLogInput {
  readonly foodItemId: string;
  readonly rating: number | null; // 1..10 or null
  readonly visitedOn: string; // YYYY-MM-DD (no logged_at: never part of order or cursor, R5.3)
}

export interface DishAggregate {
  readonly foodItemId: string;
  readonly averageRating: number | null; // continuous mean of non-null ratings
  readonly ratedLogCount: number;
  readonly logCount: number;
  readonly latestVisitedOn: string;
}

export interface SocialProofRow {
  readonly foodItemId: string;
  readonly friendId: string;
  readonly displayName: string;
  readonly avatarPreset: AvatarPresetId | null;
  readonly averageRating: number;
  readonly ratedLogCount: number;
  readonly logCount: number;
  readonly latestVisitedOn: string;
}

/**
 * Reference model of the SQL aggregation: aggregates logs into exactly one
 * DishAggregate per distinct foodItemId.
 */
export function aggregateByDish(logs: readonly DishLogInput[]): readonly DishAggregate[] {
  const groups = new Map<
    string,
    {
      foodItemId: string;
      ratings: number[];
      logCount: number;
      latestVisitedOn: string;
    }
  >();

  for (const log of logs) {
    const existing = groups.get(log.foodItemId);
    if (!existing) {
      groups.set(log.foodItemId, {
        foodItemId: log.foodItemId,
        ratings: log.rating !== null ? [log.rating] : [],
        logCount: 1,
        latestVisitedOn: log.visitedOn,
      });
    } else {
      existing.logCount += 1;
      if (log.rating !== null) {
        existing.ratings.push(log.rating);
      }
      if (log.visitedOn.localeCompare(existing.latestVisitedOn) > 0) {
        existing.latestVisitedOn = log.visitedOn;
      }
    }
  }

  const result: DishAggregate[] = [];
  for (const group of groups.values()) {
    const ratedCount = group.ratings.length;
    const avg =
      ratedCount > 0
        ? group.ratings.reduce((acc, r) => acc + r, 0) / ratedCount
        : null;

    result.push({
      foodItemId: group.foodItemId,
      averageRating: avg,
      ratedLogCount: ratedCount,
      logCount: group.logCount,
      latestVisitedOn: group.latestVisitedOn,
    });
  }

  return result;
}

/**
 * Returns a comparator implementing the strict total order for the given sort.
 * (R6.1)
 */
export function compareDishes(
  sort: FriendFoodSort,
): (a: DishAggregate, b: DishAggregate) => number {
  return (a: DishAggregate, b: DishAggregate) => {
    if (sort === 'highest_rated') {
      // 1. averageRating DESC. Dishes with no rating (null) sort last.
      if (a.averageRating !== null && b.averageRating !== null) {
        if (a.averageRating !== b.averageRating) {
          return b.averageRating - a.averageRating;
        }
      } else if (a.averageRating !== null && b.averageRating === null) {
        return -1;
      } else if (a.averageRating === null && b.averageRating !== null) {
        return 1;
      }
      // 2. ratedLogCount DESC
      if (a.ratedLogCount !== b.ratedLogCount) {
        return b.ratedLogCount - a.ratedLogCount;
      }
      // 3. foodItemId ASC (tie-break)
      return a.foodItemId.localeCompare(b.foodItemId);
    }

    if (sort === 'recent') {
      // 1. latestVisitedOn DESC
      const dateCmp = b.latestVisitedOn.localeCompare(a.latestVisitedOn);
      if (dateCmp !== 0) {
        return dateCmp;
      }
      // 2. foodItemId ASC (tie-break)
      return a.foodItemId.localeCompare(b.foodItemId);
    }

    if (sort === 'most_logged') {
      // 1. logCount DESC
      if (a.logCount !== b.logCount) {
        return b.logCount - a.logCount;
      }
      // 2. latestVisitedOn DESC
      const dateCmp = b.latestVisitedOn.localeCompare(a.latestVisitedOn);
      if (dateCmp !== 0) {
        return dateCmp;
      }
      // 3. foodItemId ASC (tie-break)
      return a.foodItemId.localeCompare(b.foodItemId);
    }

    return 0;
  };
}

/**
 * Encodes an opaque keyset cursor: base64 JSON { v: 1, s: sort, a: string, b: string | null, id: string }.
 * `b` is null for `recent` (single secondary key).
 */
export function encodeCursor(
  sort: FriendFoodSort,
  a: string,
  b: string | null,
  id: string,
): string {
  const payload = {
    v: 1,
    s: sort,
    a,
    b: sort === 'recent' ? null : b,
    id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/**
 * Decodes and validates an opaque keyset cursor.
 * Throws AppError('validation_failed', 'Invalid cursor') if malformed,
 * undecodable, or issued for a different sort.
 */
export function decodeCursor(
  cursor: string,
  expectedSort: FriendFoodSort,
): { a: string; b: string | null; id: string } {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      throw new AppError('validation_failed', 'Invalid cursor');
    }

    if (parsed.v !== 1 || parsed.s !== expectedSort) {
      throw new AppError('validation_failed', 'Invalid cursor');
    }

    if (typeof parsed.id !== 'string' || parsed.id.trim() === '') {
      throw new AppError('validation_failed', 'Invalid cursor');
    }

    if (typeof parsed.a !== 'string' || parsed.a.trim() === '') {
      throw new AppError('validation_failed', 'Invalid cursor');
    }

    if (expectedSort === 'recent') {
      if (parsed.b !== null) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.a)) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
    } else if (expectedSort === 'highest_rated') {
      if (typeof parsed.b !== 'string' || parsed.b.trim() === '') {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      if (Number.isNaN(Number(parsed.a))) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      if (!/^\d+$/.test(parsed.b)) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
    } else if (expectedSort === 'most_logged') {
      if (typeof parsed.b !== 'string' || parsed.b.trim() === '') {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      if (!/^\d+$/.test(parsed.a)) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.b)) {
        throw new AppError('validation_failed', 'Invalid cursor');
      }
    }

    return { a: parsed.a, b: parsed.b, id: parsed.id };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('validation_failed', 'Invalid cursor');
  }
}

/**
 * Escapes %, _ and \ so a search term matches literally; returns '%' + escaped lower(term) + '%'.
 */
export function toLikeContainsPattern(term: string): string {
  const lower = term.toLowerCase();
  const escaped = lower
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `%${escaped}%`;
}

/**
 * Groups raw per-friend-per-dish rows into FriendDishSocialProofDTO[] (R14.4).
 * If `capped` is true, drops the final possibly partial dish group.
 */
export function groupSocialProof(
  rows: readonly SocialProofRow[],
  maxFriends: number,
  capped: boolean,
): readonly FriendDishSocialProofDTO[] {
  if (rows.length === 0) {
    return [];
  }

  // Rows are ordered by food_item_id ASC, avg_rating DESC, latest_visited_on DESC, friend_id ASC
  const dishGroups: { foodItemId: string; rows: SocialProofRow[] }[] = [];
  let currentGroup: { foodItemId: string; rows: SocialProofRow[] } | null = null;

  for (const row of rows) {
    if (!currentGroup || currentGroup.foodItemId !== row.foodItemId) {
      currentGroup = { foodItemId: row.foodItemId, rows: [row] };
      dishGroups.push(currentGroup);
    } else {
      currentGroup.rows.push(row);
    }
  }

  // When capped, drop the final (possibly partial) dish group
  if (capped && dishGroups.length > 0) {
    dishGroups.pop();
  }

  return dishGroups.map((group) => {
    const friendCount = group.rows.length;
    const avgSum = group.rows.reduce((sum, r) => sum + r.averageRating, 0);
    const friendsAverageRating = avgSum / friendCount;

    const friends: FriendDishFriendRatingDTO[] = group.rows
      .slice(0, maxFriends)
      .map((r) => ({
        friendId: r.friendId,
        displayName: r.displayName,
        avatarPreset: r.avatarPreset,
        averageRating: r.averageRating,
        ratedLogCount: r.ratedLogCount,
        logCount: r.logCount,
        latestVisitedOn: r.latestVisitedOn,
      }));

    return {
      foodItemId: group.foodItemId,
      friendCount,
      friendsAverageRating,
      friends,
    };
  });
}
