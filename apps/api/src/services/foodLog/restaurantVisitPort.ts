/**
 * Structural port and factory for ensuring a Restaurant_Experience visit exists
 * when a User logs a Food_Item at that restaurant (Feature: unified-dining-logging).
 *
 * Keeps `services/foodLog/` decoupled from `services/tracking/` and `services/trips/`
 * by depending only on structural interfaces injected at composition time.
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9
 */

import type { DbPool } from '../../db/pool.js';
import { AppError } from '../../errors/AppError.js';

export interface EnsureRestaurantVisitInput {
  readonly userId: string;
  readonly foodItemId: string;
  readonly visitedOn: string;
  readonly userTz: string;
  readonly tripId: string | null;
  readonly rodeWith: readonly string[];
}

export interface EnsureRestaurantVisitResult {
  readonly experienceId: string;
  readonly logId: string;
  readonly created: boolean;
  readonly tripLog?: {
    readonly tripId: string;
    readonly logEntryId: string;
    readonly taggedCount: number;
  };
  readonly pendingTags?: readonly {
    readonly tagId: string;
    readonly taggedMemberId: string;
  }[];
}

export interface RestaurantVisitPort {
  ensureVisitForDishLog(
    input: EnsureRestaurantVisitInput,
  ): Promise<EnsureRestaurantVisitResult | null>;
}

export interface CreateRestaurantVisitPortDeps {
  readonly pool: DbPool;
  readonly addExperienceLog: (input: {
    readonly userId: string;
    readonly experienceId: string;
    readonly visitedOn: string;
    readonly userTz: string;
    readonly rating: null;
    readonly note: null;
    readonly tripId: null;
  }) => Promise<{ readonly id: string }>;
  readonly logToTrip: (input: {
    readonly tripId: string;
    readonly userId: string;
    readonly experienceId: string;
    readonly visitedOn: string;
    readonly userTz: string;
    readonly rating: null;
    readonly note: null;
    readonly rodeWith: readonly string[];
  }) => Promise<{
    readonly logId: string;
    readonly loggedAt: string;
    readonly logEntryId: string;
    readonly pendingTags: readonly {
      readonly tagId: string;
      readonly taggedMemberId: string;
    }[];
  }>;
}

export function createRestaurantVisitPort(
  deps: CreateRestaurantVisitPortDeps,
): RestaurantVisitPort {
  return {
    async ensureVisitForDishLog(
      input: EnsureRestaurantVisitInput,
    ): Promise<EnsureRestaurantVisitResult | null> {
      const itemRes = await deps.pool.query<{
        id: string;
        experience_id: string | null;
        location_id: string | null;
      }>(
        `SELECT id, experience_id, location_id FROM food_items WHERE id = $1`,
        [input.foodItemId],
      );

      if (itemRes.rows.length === 0) {
        throw new AppError('food_item_not_found', 'Food item not found');
      }

      const experienceId = itemRes.rows[0]!.experience_id;

      // Requirement 1.6 & 1.7: User_Submitted_Location items have no experience_id.
      if (experienceId === null) {
        if (input.tripId !== null || input.rodeWith.length > 0) {
          throw new AppError(
            'validation_failed',
            'Trip attribution is only supported for catalog restaurants.',
            { field: 'tripId' },
          );
        }
        return null;
      }

      // Check whether the User already has an Experience_Log for this restaurant on visitedOn (Requirement 1.4).
      const existing = await deps.pool.query<{ id: string }>(
        `SELECT id
           FROM experience_logs
          WHERE user_id = $1
            AND experience_id = $2
            AND visited_on = $3
          ORDER BY logged_at DESC
          LIMIT 1`,
        [input.userId, experienceId, input.visitedOn],
      );

      if (existing.rows.length > 0) {
        return {
          experienceId,
          logId: existing.rows[0]!.id,
          created: false,
        };
      }

      // Requirement 1.3 & 1.5: Trip-linked auto-visit via TripLogPort (with rating=null, note=null).
      if (input.tripId !== null) {
        const tripOut = await deps.logToTrip({
          tripId: input.tripId,
          userId: input.userId,
          experienceId,
          visitedOn: input.visitedOn,
          userTz: input.userTz,
          rating: null,
          note: null,
          rodeWith: input.rodeWith,
        });

        return {
          experienceId,
          logId: tripOut.logId,
          created: true,
          tripLog: {
            tripId: input.tripId,
            logEntryId: tripOut.logEntryId,
            taggedCount: tripOut.pendingTags.length,
          },
          pendingTags: tripOut.pendingTags,
        };
      }

      // Requirement 1.2 & 1.5: Personal auto-visit (rating=null, note=null).
      const createdLog = await deps.addExperienceLog({
        userId: input.userId,
        experienceId,
        visitedOn: input.visitedOn,
        userTz: input.userTz,
        rating: null,
        note: null,
        tripId: null,
      });

      return {
        experienceId,
        logId: createdLog.id,
        created: true,
      };
    },
  };
}

