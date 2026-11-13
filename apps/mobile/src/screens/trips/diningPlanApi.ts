/**
 * TanStack Query keys, API client functions and hooks for the Dining Plan calculator (dining-plan-calculator
 * Requirements 16.1, 19.4, 19.5, 19.6, 20.3; design.md "Mobile").
 *
 * - fetchDiningPlan: GET /trips/:id/dining-plan -> DiningPlanDTO
 * - putDiningSettings: PUT /trips/:id/dining-plan/settings -> DiningPlanDTO
 * - putDiningEntry: PUT /trips/:id/dining-plan/entries/:date/:mealPeriod -> DiningPlanDTO
 * - deleteDiningEntry: DELETE /trips/:id/dining-plan/entries/:date/:mealPeriod -> DiningPlanDTO
 * - importDiningReservations: POST /trips/:id/dining-plan/import-reservations -> DiningPlanImportResultDTO
 * - calculateDining: POST /dining-plan/calculate -> DiningPlanResultDTO (stateless)
 * - exportDiningToBudget: POST /trips/:id/dining-plan/export-to-budget -> DiningBudgetExportResultDTO
 *
 * Every Trip mutation answers with the recomputed plan, so its hook writes that plan into the query cache: the screen
 * shows the server's figures and never recomputes a total (Requirement 13.8).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DiningBudgetExportBody,
  DiningBudgetExportResultDTO,
  DiningCalculateBody,
  DiningMealPeriod,
  DiningPlanDTO,
  DiningPlanEntryBody,
  DiningPlanImportBody,
  DiningPlanImportResultDTO,
  DiningPlanResultDTO,
  DiningPlanSettingsInput,
} from '@dwt/shared';
import { apiRequest } from '../../api/client';
import { budgetKeys } from './budgetApi';

export const diningPlanKeys = {
  all: ['diningPlan'] as const,
  details: () => [...diningPlanKeys.all, 'detail'] as const,
  detail: (tripId: string) => [...diningPlanKeys.details(), tripId] as const,
};

/** The body of an entry `PUT`: the shared entry body as the client sends it (defaults applied by the server). */
export type DiningEntryInput = {
  readonly kind: DiningPlanEntryBody['kind'];
  readonly experienceId?: string | null;
  readonly placeholderKind?: DiningPlanEntryBody['placeholderKind'];
  readonly excludedKeys?: readonly string[];
};

export interface DiningSlot {
  readonly date: string;
  readonly mealPeriod: DiningMealPeriod;
}

// ---------------------------------------------------------------------------
// Client functions
// ---------------------------------------------------------------------------

export async function fetchDiningPlan(tripId: string): Promise<DiningPlanDTO> {
  return apiRequest<DiningPlanDTO>('GET', `/trips/${tripId}/dining-plan`);
}

export async function putDiningSettings(tripId: string, settings: DiningPlanSettingsInput): Promise<DiningPlanDTO> {
  return apiRequest<DiningPlanDTO>('PUT', `/trips/${tripId}/dining-plan/settings`, settings);
}

export async function putDiningEntry(tripId: string, slot: DiningSlot, entry: DiningEntryInput): Promise<DiningPlanDTO> {
  return apiRequest<DiningPlanDTO>('PUT', `/trips/${tripId}/dining-plan/entries/${slot.date}/${slot.mealPeriod}`, entry);
}

export async function deleteDiningEntry(tripId: string, slot: DiningSlot): Promise<DiningPlanDTO> {
  return apiRequest<DiningPlanDTO>('DELETE', `/trips/${tripId}/dining-plan/entries/${slot.date}/${slot.mealPeriod}`);
}

export async function importDiningReservations(tripId: string, body: DiningPlanImportBody): Promise<DiningPlanImportResultDTO> {
  return apiRequest<DiningPlanImportResultDTO>('POST', `/trips/${tripId}/dining-plan/import-reservations`, body);
}

export async function calculateDining(body: DiningCalculateBody): Promise<DiningPlanResultDTO> {
  return apiRequest<DiningPlanResultDTO>('POST', '/dining-plan/calculate', body);
}

/** Requirement 26: `preview: true` lists the lines and writes nothing; `preview: false` writes them. */
export async function exportDiningToBudget(tripId: string, body: DiningBudgetExportBody): Promise<DiningBudgetExportResultDTO> {
  return apiRequest<DiningBudgetExportResultDTO>('POST', `/trips/${tripId}/dining-plan/export-to-budget`, body);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useDiningPlan(tripId: string) {
  return useQuery({ queryKey: diningPlanKeys.detail(tripId), queryFn: () => fetchDiningPlan(tripId) });
}

export function usePutDiningSettings(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: DiningPlanSettingsInput) => putDiningSettings(tripId, settings),
    onSuccess: (plan) => {
      queryClient.setQueryData(diningPlanKeys.detail(tripId), plan);
    },
  });
}

export function usePutDiningEntry(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, entry }: { slot: DiningSlot; entry: DiningEntryInput }) => putDiningEntry(tripId, slot, entry),
    onSuccess: (plan) => {
      queryClient.setQueryData(diningPlanKeys.detail(tripId), plan);
    },
  });
}

export function useDeleteDiningEntry(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (slot: DiningSlot) => deleteDiningEntry(tripId, slot),
    onSuccess: (plan) => {
      queryClient.setQueryData(diningPlanKeys.detail(tripId), plan);
    },
  });
}

/** The export changes Budget lines, not the plan: a real export (not a preview) makes the Budget refetch. */
export function useExportDiningToBudget(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DiningBudgetExportBody) => exportDiningToBudget(tripId, body),
    onSuccess: (_result, body) => {
      if (!body.preview) void queryClient.invalidateQueries({ queryKey: budgetKeys.detail(tripId) });
    },
  });
}

export function useImportDiningReservations(tripId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DiningPlanImportBody) => importDiningReservations(tripId, body),
    onSuccess: (result) => {
      queryClient.setQueryData(diningPlanKeys.detail(tripId), result.plan);
    },
  });
}
