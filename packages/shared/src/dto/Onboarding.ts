/**
 * Shared DTO types for first-run onboarding (`GET /me/onboarding`,
 * `PATCH /me/onboarding`, `POST /me/onboarding/quick-completions`).
 */

import type {
  ONBOARDING_INTENTS,
  ONBOARDING_PARKS,
} from '../constants/onboarding.js';

export type OnboardingIntent = (typeof ONBOARDING_INTENTS)[number];
export type OnboardingPark = (typeof ONBOARDING_PARKS)[number];

export interface StarterChecklistDTO {
  readonly loggedFirstExperience: boolean;
  readonly starredFavorite: boolean;
  readonly hasTrip: boolean;
  readonly claimedPin: boolean;
}

export interface OnboardingStateDTO {
  readonly needsOnboarding: boolean;
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
  readonly initialIntent: OnboardingIntent | null;
  readonly selectedPark: OnboardingPark | null;
  readonly starterChecklistDismissedAt: string | null;
  readonly checklist: StarterChecklistDTO;
  readonly showStarterChecklist: boolean;
}

export interface QuickCompletionsResponseDTO {
  readonly addedCount: number;
  readonly alreadyCompletedCount: number;
  readonly newlyAwardedPinIds: readonly string[];
}
