/**
 * Tests for budgetApi client functions, TanStack Query keys, and mutation hooks (Task 17.1).
 *
 * Validates: Requirements 22.6, 18.2, 18.3, 18.4, 18.6, 18.9
 */

import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type {
  BudgetLineInput,
  BudgetLineReplace,
  TravelerProfileInput,
  BudgetSettingsPatch,
  DismissSuggestionBody,
  PriceQuoteBody,
} from '@dwt/shared';
import { apiRequest } from '../../../api/client';
import {
  budgetKeys,
  invalidateBudgetQueries,
  fetchBudget,
  fetchBudgetSuggestions,
  createBudgetLine,
  editBudgetLine,
  deleteBudgetLine,
  linkBudgetLineExpense,
  putTravelerProfile,
  deleteTravelerProfile,
  patchBudgetSettings,
  dismissBudgetSuggestion,
  fetchPriceQuotes,
  useCreateBudgetLine,
  useEditBudgetLine,
  useDeleteBudgetLine,
  useLinkBudgetLineExpense,
  usePutTravelerProfile,
  useDeleteTravelerProfile,
  usePatchBudgetSettings,
  useDismissBudgetSuggestion,
} from '../budgetApi';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
}));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

describe('budgetApi', () => {
  const tripId = 'trip-1234';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('budgetKeys', () => {
    it('produces distinct query keys for detail and suggestions', () => {
      const detailKey = budgetKeys.detail(tripId);
      const suggestionsKey = budgetKeys.suggestions(tripId);

      expect(detailKey).toEqual(['tripBudget', 'detail', tripId]);
      expect(suggestionsKey).toEqual(['tripBudget', 'suggestions', tripId]);
      expect(detailKey).not.toEqual(suggestionsKey);
    });
  });

  describe('API client functions', () => {
    it('fetchBudget issues GET /trips/:id/budget', async () => {
      mockApiRequest.mockResolvedValueOnce({ tripId, lines: [] });
      const result = await fetchBudget(tripId);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('GET', `/trips/${tripId}/budget`);
      expect(result).toEqual({ tripId, lines: [] });
    });

    it('fetchBudgetSuggestions issues GET /trips/:id/budget/suggestions', async () => {
      mockApiRequest.mockResolvedValueOnce([]);
      const result = await fetchBudgetSuggestions(tripId);

      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('GET', `/trips/${tripId}/budget/suggestions`);
      expect(result).toEqual([]);
    });

    it('createBudgetLine issues POST /trips/:id/budget/lines with input and returns created BudgetLineDTO (201)', async () => {
      const input: BudgetLineInput = {
        category: 'dining',
        description: 'Chef Mickey Dinner',
        plannedDate: '2026-11-01',
        park: 'Magic Kingdom',
        experienceId: null,
        priceSource: 'user_entered',
        priceRef: null,
        applyTip: true,
        linkedExpenseId: null,
        allocations: [{ memberId: 'm1', amountCents: 5500 }],
      };
      const mockCreated = { id: 'line-1', ...input, subtotalCents: 5500 };
      mockApiRequest.mockResolvedValueOnce(mockCreated);

      const result = await createBudgetLine(tripId, input);
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('POST', `/trips/${tripId}/budget/lines`, input);
      expect(result).toEqual(mockCreated);
    });

    it('editBudgetLine issues PATCH /trips/:id/budget/lines/:lineId with the FULL line body (PUT semantics) and returns re-resolved BudgetLineDTO (200)', async () => {
      const lineId = 'line-99';
      const input: BudgetLineReplace = {
        category: 'dining',
        description: 'Chef Mickey Dinner Updated',
        plannedDate: '2026-11-01',
        park: 'Magic Kingdom',
        experienceId: null,
        priceSource: 'user_entered',
        priceRef: null,
        applyTip: true,
        linkedExpenseId: null,
        allocations: [{ memberId: 'm1', amountCents: 6000 }],
      };
      const mockUpdated = { id: lineId, ...input, subtotalCents: 6000 };
      mockApiRequest.mockResolvedValueOnce(mockUpdated);

      const result = await editBudgetLine(tripId, lineId, input);
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', `/trips/${tripId}/budget/lines/${lineId}`, input);
      expect(result).toEqual(mockUpdated);
    });

    it('deleteBudgetLine issues DELETE /trips/:id/budget/lines/:lineId and resolves without parsing body (204)', async () => {
      const lineId = 'line-99';
      mockApiRequest.mockResolvedValueOnce(null);

      await expect(deleteBudgetLine(tripId, lineId)).resolves.toBeUndefined();
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('DELETE', `/trips/${tripId}/budget/lines/${lineId}`);
    });

    it('linkBudgetLineExpense issues PUT /trips/:id/budget/lines/:lineId/link with { expenseId } and resolves void (204)', async () => {
      mockApiRequest.mockResolvedValueOnce(null);

      await expect(linkBudgetLineExpense(tripId, 'line-7', 'exp-42')).resolves.toBeUndefined();
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${tripId}/budget/lines/line-7/link`, {
        expenseId: 'exp-42',
      });
    });

    it('putTravelerProfile issues PUT /trips/:id/budget/travelers with input and returns TravelerProfileDTO (200)', async () => {
      const input: TravelerProfileInput = {
        memberId: 'm1',
        ageBracket: 'adult',
        ticketDays: 4,
        discountGroup: 'std-gst',
        passType: 'none',
      };
      const mockProfile = { id: 'prof-1', ...input };
      mockApiRequest.mockResolvedValueOnce(mockProfile);

      const result = await putTravelerProfile(tripId, input);
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${tripId}/budget/travelers`, input);
      expect(result).toEqual(mockProfile);
    });

    it('deleteTravelerProfile issues DELETE /trips/:id/budget/travelers/:profileId and resolves without parsing body (204)', async () => {
      const profileId = 'prof-1';
      mockApiRequest.mockResolvedValueOnce(null);

      await expect(deleteTravelerProfile(tripId, profileId)).resolves.toBeUndefined();
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('DELETE', `/trips/${tripId}/budget/travelers/${profileId}`);
    });

    it('patchBudgetSettings issues PATCH /trips/:id/budget/settings with input and returns BudgetSettingsDTO (200)', async () => {
      const input: BudgetSettingsPatch = {
        diningTipBps: 2000,
        taxBps: { dining: 700 },
      };
      const mockSettings = { diningTipBps: 2000, taxBps: { dining: 700 } };
      mockApiRequest.mockResolvedValueOnce(mockSettings);

      const result = await patchBudgetSettings(tripId, input);
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('PATCH', `/trips/${tripId}/budget/settings`, input);
      expect(result).toEqual(mockSettings);
    });

    it('dismissBudgetSuggestion issues POST /trips/:id/budget/suggestions/dismiss with input and resolves without parsing body (204)', async () => {
      const input: DismissSuggestionBody = {
        suggestionKey: 'sug-ticket-4day',
      };
      mockApiRequest.mockResolvedValueOnce(null);

      await expect(dismissBudgetSuggestion(tripId, input)).resolves.toBeUndefined();
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('POST', `/trips/${tripId}/budget/suggestions/dismiss`, input);
    });

    it('fetchPriceQuotes issues POST /trips/:id/budget/quotes with body and returns PriceQuoteDTO[] (200)', async () => {
      const body: PriceQuoteBody = {
        requests: [
          {
            kind: 'ticket',
            discountGroup: 'std-gst',
            numDays: 4,
            ageGroup: 'adult',
            optionCode: 'base',
            startDate: '2026-11-01',
          },
        ],
      };
      const mockQuotes = [{ priceCents: 45000, labelKind: 'current', cacheState: 'ready' }];
      mockApiRequest.mockResolvedValueOnce(mockQuotes);

      const result = await fetchPriceQuotes(tripId, body);
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).toHaveBeenCalledWith('POST', `/trips/${tripId}/budget/quotes`, body);
      expect(result).toEqual(mockQuotes);
    });
  });

  describe('Mutation hooks and cache invalidation', () => {
    function createTestWrapper() {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);
      return { queryClient, wrapper };
    }

    it('invalidateBudgetQueries invalidates both detail and suggestions queries', async () => {
      const { queryClient } = createTestWrapper();
      const spy = jest.spyOn(queryClient, 'invalidateQueries');

      await invalidateBudgetQueries(queryClient, tripId);
      expect(spy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(spy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('useCreateBudgetLine triggers createBudgetLine and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce({ id: 'line-new' });

      const { result } = renderHook(() => useCreateBudgetLine(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({
          category: 'other',
          description: 'Souvenirs',
          plannedDate: null,
          park: null,
          experienceId: null,
          priceSource: 'user_entered',
          priceRef: null,
          applyTip: false,
          linkedExpenseId: null,
          allocations: [{ memberId: 'm1', amountCents: 2000 }],
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('useEditBudgetLine triggers editBudgetLine and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce({ id: 'line-edit' });

      const { result } = renderHook(() => useEditBudgetLine(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({
          lineId: 'line-edit',
          input: {
            category: 'other',
            description: 'Souvenirs 2',
            plannedDate: null,
            park: null,
            experienceId: null,
            priceSource: 'user_entered',
            priceRef: null,
            applyTip: false,
            linkedExpenseId: null,
            allocations: [{ memberId: 'm1', amountCents: 2500 }],
          },
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('useDeleteBudgetLine triggers deleteBudgetLine and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useDeleteBudgetLine(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync('line-del');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('useLinkBudgetLineExpense calls the link route and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useLinkBudgetLineExpense(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ lineId: 'line-7', expenseId: 'exp-42' });
      });

      expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${tripId}/budget/lines/line-7/link`, {
        expenseId: 'exp-42',
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('usePutTravelerProfile triggers putTravelerProfile and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce({ id: 'prof-put' });

      const { result } = renderHook(() => usePutTravelerProfile(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({
          memberId: 'm1',
          ageBracket: 'child',
          ticketDays: 3,
          discountGroup: 'std-gst',
          passType: 'none',
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('useDeleteTravelerProfile triggers deleteTravelerProfile and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useDeleteTravelerProfile(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync('prof-del');
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('usePatchBudgetSettings triggers patchBudgetSettings and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce({ savedCents: 5000 });

      const { result } = renderHook(() => usePatchBudgetSettings(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ savedCents: 5000 });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });

    it('useDismissBudgetSuggestion triggers dismissBudgetSuggestion and invalidates detail + suggestions on success', async () => {
      const { queryClient, wrapper } = createTestWrapper();
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
      mockApiRequest.mockResolvedValueOnce(null);

      const { result } = renderHook(() => useDismissBudgetSuggestion(tripId), { wrapper });
      await act(async () => {
        await result.current.mutateAsync({ suggestionKey: 'sug-key-1' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.detail(tripId) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: budgetKeys.suggestions(tripId) });
    });
  });
});
