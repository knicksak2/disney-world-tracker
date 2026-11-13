/**
 * Dining Plan API client and hooks (dining-plan-calculator task 11.1): each client function's method, path and body,
 * and that each mutation hook writes the server's returned plan into the query cache.
 *
 * Validates: Requirements 16.1, 19.4, 19.5, 19.6, 20.3.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { apiRequest } from '../../../api/client';
import { plan, result, SETTINGS, TRIP_ID } from '../../../test/diningPlanFixtures';
import { budgetKeys } from '../budgetApi';
import {
  calculateDining,
  deleteDiningEntry,
  diningPlanKeys,
  exportDiningToBudget,
  fetchDiningPlan,
  importDiningReservations,
  putDiningEntry,
  putDiningSettings,
  useDeleteDiningEntry,
  useDiningPlan,
  useExportDiningToBudget,
  useImportDiningReservations,
  usePutDiningEntry,
  usePutDiningSettings,
} from '../diningPlanApi';

jest.mock('../../../api/client', () => ({ apiRequest: jest.fn() }));

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const SLOT = { date: '2027-03-02', mealPeriod: 'dinner' as const };

beforeEach(() => {
  mockApiRequest.mockReset();
});

describe('client functions', () => {
  it('fetchDiningPlan issues GET /trips/:id/dining-plan', async () => {
    mockApiRequest.mockResolvedValueOnce(plan());
    await expect(fetchDiningPlan(TRIP_ID)).resolves.toEqual(plan());
    expect(mockApiRequest).toHaveBeenCalledWith('GET', `/trips/${TRIP_ID}/dining-plan`);
  });

  it('putDiningSettings issues PUT .../settings with the settings', async () => {
    mockApiRequest.mockResolvedValueOnce(plan());
    await putDiningSettings(TRIP_ID, { ...SETTINGS, orderStyle: 'splurge' });
    expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${TRIP_ID}/dining-plan/settings`, { ...SETTINGS, orderStyle: 'splurge' });
  });

  it('putDiningEntry issues PUT .../entries/:date/:mealPeriod with the entry', async () => {
    mockApiRequest.mockResolvedValueOnce(plan());
    const entry = { kind: 'placeholder' as const, placeholderKind: 'table_service' as const, excludedKeys: [] };
    await putDiningEntry(TRIP_ID, SLOT, entry);
    expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${TRIP_ID}/dining-plan/entries/2027-03-02/dinner`, entry);
  });

  it('deleteDiningEntry issues DELETE .../entries/:date/:mealPeriod with no body', async () => {
    mockApiRequest.mockResolvedValueOnce(plan());
    await deleteDiningEntry(TRIP_ID, { date: '2027-03-04', mealPeriod: 'breakfast' });
    expect(mockApiRequest).toHaveBeenCalledWith('DELETE', `/trips/${TRIP_ID}/dining-plan/entries/2027-03-04/breakfast`);
  });

  it('importDiningReservations issues POST .../import-reservations with the body', async () => {
    mockApiRequest.mockResolvedValueOnce({ plan: plan(), created: 1, skippedExisting: 0, skippedOutOfStay: 0 });
    await importDiningReservations(TRIP_ID, { overwrite: false });
    expect(mockApiRequest).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/dining-plan/import-reservations`, { overwrite: false });
  });

  it('exportDiningToBudget issues POST .../export-to-budget with the body', async () => {
    const answer = { created: 1, updated: 0, deleted: 0, lines: [], warnings: [] };
    mockApiRequest.mockResolvedValueOnce(answer);
    await expect(exportDiningToBudget(TRIP_ID, { include: ['plan'], preview: true })).resolves.toEqual(answer);
    expect(mockApiRequest).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/dining-plan/export-to-budget`, { include: ['plan'], preview: true });
  });

  it('calculateDining issues POST /dining-plan/calculate', async () => {
    const body = { party: [{ key: 'g:a1', label: 'Adult 1', ageBracket: 'adult' as const, passType: 'none' as const }], stay: { checkIn: '2027-03-01', checkOut: '2027-03-04' }, settings: SETTINGS, entries: [] };
    mockApiRequest.mockResolvedValueOnce(result());
    await expect(calculateDining(body)).resolves.toEqual(result());
    expect(mockApiRequest).toHaveBeenCalledWith('POST', '/dining-plan/calculate', body);
  });
});

describe('useExportDiningToBudget', () => {
  it('makes the Budget refetch after a real export, not after a preview, and leaves the plan alone', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(budgetKeys.detail(TRIP_ID), { lines: [] });
    queryClient.setQueryData(diningPlanKeys.detail(TRIP_ID), plan());
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);
    const budgetStale = () => queryClient.getQueryState(budgetKeys.detail(TRIP_ID))?.isInvalidated;
    mockApiRequest.mockResolvedValue({ created: 1, updated: 0, deleted: 0, lines: [], warnings: [] });
    const { result: hook } = renderHook(() => useExportDiningToBudget(TRIP_ID), { wrapper });

    await act(async () => {
      await hook.current.mutateAsync({ include: ['plan', 'out_of_pocket', 'tips'], preview: true });
    });
    expect(budgetStale()).toBe(false);

    await act(async () => {
      await hook.current.mutateAsync({ include: ['plan'], preview: false });
    });
    expect(budgetStale()).toBe(true);
    expect(queryClient.getQueryState(diningPlanKeys.detail(TRIP_ID))?.isInvalidated).toBe(false);
  });
});

describe('hooks write the returned plan into the cache', () => {
  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    queryClient.setQueryData(diningPlanKeys.detail(TRIP_ID), plan({ entries: [] }));
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);
    return { queryClient, wrapper };
  }
  // TanStack's structural sharing keeps equal sub-objects, so the cache holds an equal copy, not the same instance.
  // Each returned plan differs from the seeded one (`entries: []`), so equality proves the cache was written.
  const cached = (qc: QueryClient) => qc.getQueryData(diningPlanKeys.detail(TRIP_ID));

  it('useDiningPlan reads the plan', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);
    mockApiRequest.mockResolvedValueOnce(plan());
    const { result: hook } = renderHook(() => useDiningPlan(TRIP_ID), { wrapper });
    await waitFor(() => expect(hook.current.data).toEqual(plan()));
  });

  it('usePutDiningSettings', async () => {
    const { queryClient, wrapper } = setup();
    const returned = plan({ settings: { ...SETTINGS, beverage: 'water' } });
    mockApiRequest.mockResolvedValueOnce(returned);
    const { result: hook } = renderHook(() => usePutDiningSettings(TRIP_ID), { wrapper });
    await act(async () => {
      await hook.current.mutateAsync({ ...SETTINGS, beverage: 'water' });
    });
    expect(cached(queryClient)).toEqual(returned);
  });

  it('usePutDiningEntry', async () => {
    const { queryClient, wrapper } = setup();
    const returned = plan();
    mockApiRequest.mockResolvedValueOnce(returned);
    const { result: hook } = renderHook(() => usePutDiningEntry(TRIP_ID), { wrapper });
    await act(async () => {
      await hook.current.mutateAsync({ slot: SLOT, entry: { kind: 'skip' } });
    });
    expect(mockApiRequest).toHaveBeenCalledWith('PUT', `/trips/${TRIP_ID}/dining-plan/entries/2027-03-02/dinner`, { kind: 'skip' });
    expect(cached(queryClient)).toEqual(returned);
  });

  it('useDeleteDiningEntry', async () => {
    const { queryClient, wrapper } = setup();
    const returned = plan({ entries: [], suggestionsNeedingMealPeriod: 3 });
    mockApiRequest.mockResolvedValueOnce(returned);
    const { result: hook } = renderHook(() => useDeleteDiningEntry(TRIP_ID), { wrapper });
    await act(async () => {
      await hook.current.mutateAsync(SLOT);
    });
    expect(cached(queryClient)).toEqual(returned);
  });

  it('useImportDiningReservations stores the plan inside the import result', async () => {
    const { queryClient, wrapper } = setup();
    const returned = plan();
    mockApiRequest.mockResolvedValueOnce({ plan: returned, created: 2, skippedExisting: 1, skippedOutOfStay: 0 });
    const { result: hook } = renderHook(() => useImportDiningReservations(TRIP_ID), { wrapper });
    let counts: unknown;
    await act(async () => {
      counts = await hook.current.mutateAsync({ overwrite: false });
    });
    expect(counts).toMatchObject({ created: 2, skippedExisting: 1 });
    expect(cached(queryClient)).toEqual(returned);
  });

  it('leaves the cache alone when a mutation fails', async () => {
    const { queryClient, wrapper } = setup();
    const before = cached(queryClient);
    mockApiRequest.mockRejectedValueOnce(new Error('trip_validation_failed'));
    const { result: hook } = renderHook(() => usePutDiningEntry(TRIP_ID), { wrapper });
    await act(async () => {
      await expect(hook.current.mutateAsync({ slot: SLOT, entry: { kind: 'skip' } })).rejects.toThrow('trip_validation_failed');
    });
    expect(cached(queryClient)).toBe(before);
    expect(cached(queryClient)).toEqual(plan({ entries: [] }));
  });
});
