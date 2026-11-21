import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  OnboardingPatchInput,
  OnboardingStateDTO,
  QuickCompletionsInput,
  QuickCompletionsResponseDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';

export const ONBOARDING_STALE_TIME_MS = 60_000;

export const onboardingKeys = {
  me: ['me', 'onboarding'] as const,
};

export function useOnboardingState(enabled = true) {
  return useQuery<OnboardingStateDTO, ApiError>({
    queryKey: onboardingKeys.me,
    queryFn: () => apiRequest<OnboardingStateDTO>('GET', '/me/onboarding'),
    staleTime: ONBOARDING_STALE_TIME_MS,
    enabled,
    retry: false,
  });
}

export function useUpdateOnboarding() {
  const queryClient = useQueryClient();
  return useMutation<OnboardingStateDTO, ApiError, OnboardingPatchInput>({
    mutationFn: (patch) =>
      apiRequest<OnboardingStateDTO>('PATCH', '/me/onboarding', patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(onboardingKeys.me, updated);
      void queryClient.invalidateQueries({ queryKey: onboardingKeys.me });
    },
  });
}

export function useQuickCompletions() {
  const queryClient = useQueryClient();
  return useMutation<QuickCompletionsResponseDTO, ApiError, QuickCompletionsInput>({
    mutationFn: (body) =>
      apiRequest<QuickCompletionsResponseDTO>(
        'POST',
        '/me/onboarding/quick-completions',
        body,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: onboardingKeys.me });
      void queryClient.invalidateQueries({ queryKey: ['pins', 'board'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });
}
