/**
 * User_Submitted_Location wire contracts (Feature: food-item-logging).
 *
 * Validates: Requirements 6.1, 6.2
 */

import type { Park } from '../enums.js';

export interface UserSubmittedLocationDTO {
  readonly id: string;
  readonly name: string;
  readonly park: Park;
}

export interface CreateUserSubmittedLocationInputDTO {
  readonly name: string;
  readonly park: Park;
}

/** One ranked candidate from `GET /locations/suggest` (Requirement 6.2). */
export interface LocationSuggestionDTO {
  readonly id: string;
  readonly name: string;
  readonly similarity: number; // 0..1, pg_trgm's similarity() score
}
