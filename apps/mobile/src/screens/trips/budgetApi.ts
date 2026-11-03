/**
 * TanStack Query keys, API client functions, and mutation hooks for Trip Budget (Task 17.1).
 *
 * Covers:
 * - Query keys: budgetKeys.detail(tripId), .suggestions(tripId)
 * - Client functions for all 10 routes in tripBudgetRoutes:
 *   - fetchBudget: GET /trips/:id/budget -> BudgetDTO
 *   - fetchBudgetSuggestions: GET /trips/:id/budget/suggestions -> BudgetSuggestionDTO[]
 *   - createBudgetLine: POST /trips/:id/budget/lines -> 201 + BudgetLineDTO
 *   - editBudgetLine: PATCH /trips/:id/budget/lines/:lineId (full replace) -> 200 + BudgetLineDTO
 *   - deleteBudgetLine: DELETE /trips/:id/budget/lines/:lineId -> 204
 *   - putTravelerProfile: PUT /trips/:id/budget/travelers -> 200 + TravelerProfileDTO
 *   - deleteTravelerProfile: DELETE /trips/:id/budget/travelers/:profileId -> 204
 *   - patchBudgetSettings: PATCH /trips/:id/budget/settings -> 200 + BudgetSettingsDTO
 *   - dismissBudgetSuggestion: POST /trips/:id/budget/suggestions/dismiss -> 204
 *   - fetchPriceQuotes: POST /trips/:id/budget/quotes -> 200 + PriceQuoteDTO[]
 * - Mutation hooks invalidating budgetKeys.detail(tripId) and .suggestions(tripId) on success.
 *
 * Validates: Requirements 22.6, 18.2, 18.3, 18.4, 18.6, 18.9
 */

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  BudgetDTO,
  BudgetSuggestionDTO,
  BudgetLineDTO,
  BudgetLineInput,
  BudgetLineReplace,
  TravelerProfileDTO,
  TravelerProfileInput,
  BudgetSettingsDTO,
  BudgetSettingsPatch,
  DismissSuggestionBody,
  PriceQuoteDTO,
  PriceQuoteBody,
} from '@dwt/shared';
import { apiRequest } from '../../api/client';

export const budgetKeys = {
  all: ['tripBudget'] as const,
  details: () => [...budgetKeys.all, 'detail'] as const,
  detail: (tripId: string) => [...budgetKeys.details(), tripId] as const,
  suggestionsList: () => [...budgetKeys.all, 'suggestions'] as const,
  suggestions: (tripId: string) => [...budgetKeys.suggestionsList(), tripId] as const,
};

export async function invalidateBudgetQueries(queryClient: QueryClient, tripId: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: budgetKeys.detail(tripId) }),
    queryClient.invalidateQueries({ queryKey: budgetKeys.suggestions(tripId) }),
  ]);
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

export async function fetchBudget(tripId: string): Promise<BudgetDTO> {
  return apiRequest<BudgetDTO>('GET', `/trips/${tripId}/budget`);
}

export async function fetchBudgetSuggestions(tripId: string): Promise<readonly BudgetSuggestionDTO[]> {
  return apiRequest<readonly BudgetSuggestionDTO[]>('GET', `/trips/${tripId}/budget/suggestions`);
}

export async function createBudgetLine(
  tripId: string,
  input: BudgetLineInput,
): Promise<BudgetLineDTO> {
  return apiRequest<BudgetLineDTO>('POST', `/trips/${tripId}/budget/lines`, input);
}

export async function editBudgetLine(
  tripId: string,
  lineId: string,
  input: BudgetLineReplace,
): Promise<BudgetLineDTO> {
  return apiRequest<BudgetLineDTO>('PATCH', `/trips/${tripId}/budget/lines/${lineId}`, input);
}

export async function deleteBudgetLine(
  tripId: string,
  lineId: string,
): Promise<void> {
  await apiRequest('DELETE', `/trips/${tripId}/budget/lines/${lineId}`);
}

export async function putTravelerProfile(
  tripId: string,
  input: TravelerProfileInput,
): Promise<TravelerProfileDTO> {
  return apiRequest<TravelerProfileDTO>('PUT', `/trips/${tripId}/budget/travelers`, input);
}

export async function deleteTravelerProfile(
  tripId: string,
  profileId: string,
): Promise<void> {
  await apiRequest('DELETE', `/trips/${tripId}/budget/travelers/${profileId}`);
}

export async function patchBudgetSettings(
  tripId: string,
  input: BudgetSettingsPatch,
): Promise<BudgetSettingsDTO> {
  return apiRequest<BudgetSettingsDTO>('PATCH', `/trips/${tripId}/budget/settings`, input);
}

export async function dismissBudgetSuggestion(
  tripId: string,
  input: DismissSuggestionBody,
): Promise<void> {
  await apiRequest('POST', `/trips/${tripId}/budget/suggestions/dismiss`, input);
}

export async function fetchPriceQuotes(
  tripId: string,
  body: PriceQuoteBody,
): Promise<readonly PriceQuoteDTO[]> {
  return apiRequest<readonly PriceQuoteDTO[]>('POST', `/trips/${tripId}/budget/quotes`, body);
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useCreateBudgetLine(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BudgetLineInput) => createBudgetLine(tripId, input),
    onSuccess: () => {
      void invalidateBudgetQueries(queryClient, tripId);
    },
  });
}

export function useEditBudgetLine(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ lineId, input }: { lineId: string; input: BudgetLineReplace }) =>
      editBudgetLine(tripId, lineId, input),
    onSuccess: () => {
      void invalidateBudgetQueries(queryClient, tripId);
    },
  });
}

export function useDeleteBudgetLine(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteBudgetLine(tripId, lineId),
    onSuccess: () => {
      void invalidateBudgetQueries(queryClient, tripId);
    },
  });
}

export function usePutTravelerProfile(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TravelerProfileInput) => putTravelerProfile(tripId, input),
    onSuccess: () => {
      void invalidateBudgetQueries(queryClient, tripId);
    },
  });
}

export function useDeleteTravelerProfile(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) => deleteTravelerProfile(tripId, profileId),
    onSuccess: () => {
      void invalidateBudgetQueries(queryClient, tripId);
    },
  });
}

export function usePatchBudgetSettings(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BudgetSettingsPatch) => patchBudgetSettings(tripId, input),
    onSuccess: () => {
      void invalidateBudgetQueries(queryClient, tripId);
    },
  });
}

export function useDismissBudgetSuggestion(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DismissSuggestionBody) => dismissBudgetSuggestion(tripId, input),
    onSuccess: () => {
      void invalidateBudgetQueries(queryClient, tripId);
    },
  });
}

