/**
 * Pure domain logic for first-run onboarding state derivation, first-read
 * veteran grandfathering, and monotonic patch merging.
 *
 * No I/O — property-tested directly with fast-check.
 */

import type {
  OnboardingIntent,
  OnboardingPark,
  OnboardingPatchInput,
  OnboardingStateDTO,
  StarterChecklistDTO,
} from '@dwt/shared';

export interface StoredOnboardingRow {
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
  readonly grandfatheredAt: string | null;
  readonly initialIntent: OnboardingIntent | null;
  readonly selectedPark: OnboardingPark | null;
  readonly starterChecklistDismissedAt: string | null;
}

export interface ActivitySignals {
  readonly hasCompletion: boolean;
  readonly hasExperienceLog: boolean;
  readonly hasFoodLog: boolean;
  readonly hasFavorite: boolean;
  readonly hasTripMembership: boolean;
  readonly hasClaimedPin: boolean;
}

/**
 * Determines on a user's first `GET /me/onboarding` whether they already have
 * prior activity in core tables (`completions`, `experience_logs`,
 * `food_item_logs`, or `trip_memberships`) and should therefore be permanently
 * grandfathered as a veteran user.
 */
export function shouldGrandfatherOnFirstRead(signals: ActivitySignals): boolean {
  return (
    signals.hasCompletion ||
    signals.hasExperienceLog ||
    signals.hasFoodLog ||
    signals.hasTripMembership
  );
}

/**
 * Derives the public `OnboardingStateDTO` from the persisted `user_onboarding`
 * row and live-derived activity signals.
 */
export function deriveOnboardingState(
  stored: StoredOnboardingRow,
  signals: ActivitySignals,
): OnboardingStateDTO {
  const isVeteran = stored.grandfatheredAt !== null;
  const hasOnboardingDecision =
    stored.completedAt !== null || stored.skippedAt !== null;
  const needsOnboarding = !isVeteran && !hasOnboardingDecision;

  const checklist: StarterChecklistDTO = {
    loggedFirstExperience:
      signals.hasCompletion || signals.hasExperienceLog || signals.hasFoodLog,
    starredFavorite: signals.hasFavorite,
    hasTrip: signals.hasTripMembership,
    claimedPin: signals.hasClaimedPin,
  };

  const allChecklistDone =
    checklist.loggedFirstExperience &&
    checklist.starredFavorite &&
    checklist.hasTrip &&
    checklist.claimedPin;

  const showStarterChecklist =
    !isVeteran &&
    stored.starterChecklistDismissedAt === null &&
    !allChecklistDone;

  return {
    needsOnboarding,
    completedAt: stored.completedAt,
    skippedAt: stored.skippedAt,
    initialIntent: stored.initialIntent,
    selectedPark: stored.selectedPark,
    starterChecklistDismissedAt: stored.starterChecklistDismissedAt,
    checklist,
    showStarterChecklist,
  };
}

/**
 * Pure merge of a validated `OnboardingPatchInput` onto the current stored row.
 * Preserves `grandfatheredAt` unconditionally and keeps `completedAt` /
 * `skippedAt` monotonic once set.
 */
export function mergeOnboardingPatch(
  current: StoredOnboardingRow | null,
  patch: OnboardingPatchInput,
  nowIso: string,
): StoredOnboardingRow {
  const completedAt =
    current?.completedAt ?? (patch.complete === true ? nowIso : null);
  const skippedAt = current?.skippedAt ?? (patch.skip === true ? nowIso : null);

  let starterChecklistDismissedAt =
    current?.starterChecklistDismissedAt ?? null;
  if (patch.dismissStarterChecklist === true) {
    starterChecklistDismissedAt =
      current?.starterChecklistDismissedAt ?? nowIso;
  } else if (patch.restoreStarterChecklist === true) {
    starterChecklistDismissedAt = null;
  }

  return {
    completedAt,
    skippedAt,
    grandfatheredAt: current?.grandfatheredAt ?? null,
    initialIntent:
      patch.initialIntent !== undefined
        ? patch.initialIntent
        : (current?.initialIntent ?? null),
    selectedPark:
      patch.selectedPark !== undefined
        ? patch.selectedPark
        : (current?.selectedPark ?? null),
    starterChecklistDismissedAt,
  };
}
