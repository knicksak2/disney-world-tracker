/**
 * OnboardingService — coordinates onboarding state reads, idempotent updates,
 * and batch starter completions with best-effort pin awarding.
 */

import type {
  OnboardingPatchInput,
  OnboardingStateDTO,
  QuickCompletionsInput,
  QuickCompletionsResponseDTO,
} from '@dwt/shared';

import { formatYmdInTimeZone } from '../tracking/logs/visitDate.js';
import {
  deriveOnboardingState,
  mergeOnboardingPatch,
} from './domain/statePolicy.js';
import type { OnboardingRepo } from './repo.js';

export interface OnboardingServiceOptions {
  readonly repo: OnboardingRepo;
  readonly awardPins?: (userId: string) => Promise<readonly string[]>;
  readonly clock?: () => Date;
  readonly onAwardPinsError?: (err: unknown) => void;
}

export interface OnboardingService {
  getOnboardingState(userId: string): Promise<OnboardingStateDTO>;
  patchOnboardingState(
    userId: string,
    patch: OnboardingPatchInput,
  ): Promise<OnboardingStateDTO>;
  submitQuickCompletions(
    userId: string,
    input: QuickCompletionsInput,
  ): Promise<QuickCompletionsResponseDTO>;
}

export function createOnboardingService(
  options: OnboardingServiceOptions,
): OnboardingService {
  const { repo, awardPins, onAwardPinsError } = options;
  const clock = options.clock ?? (() => new Date());

  return {
    async getOnboardingState(userId: string): Promise<OnboardingStateDTO> {
      const snapshot = await repo.getOrInitSnapshot(userId, clock());
      return deriveOnboardingState(snapshot.stored, snapshot.signals);
    },

    async patchOnboardingState(
      userId: string,
      patch: OnboardingPatchInput,
    ): Promise<OnboardingStateDTO> {
      const now = clock();
      const current = await repo.getOrInitSnapshot(userId, now);
      const nextStored = mergeOnboardingPatch(
        current.stored,
        patch,
        now.toISOString(),
      );
      const persisted = await repo.upsertState(userId, nextStored, now);
      return deriveOnboardingState(persisted, current.signals);
    },

    async submitQuickCompletions(
      userId: string,
      input: QuickCompletionsInput,
    ): Promise<QuickCompletionsResponseDTO> {
      const now = clock();
      const completedOn = formatYmdInTimeZone(now, input.userTz);
      const { addedCount, alreadyCompletedCount } =
        await repo.insertQuickCompletions(
          userId,
          input.experienceIds,
          completedOn,
          input.userTz,
        );

      let newlyAwardedPinIds: readonly string[] = [];
      if (awardPins) {
        try {
          newlyAwardedPinIds = await awardPins(userId);
        } catch (err) {
          onAwardPinsError?.(err);
        }
      }

      return {
        addedCount,
        alreadyCompletedCount,
        newlyAwardedPinIds,
      };
    },
  };
}
