import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useMickeyConfig,
  useMickeySummary,
  useMickeyList,
  useMickeyDetail,
  useMickeyHint,
  useMickeyFind,
  useMickeyUndoFind,
  useMickeyVote,
  useMickeyReport,
  useSubmitMickey,
  useMySubmissions,
  useFriendMickeyFinds,
  mickeyKeys,
} from '../api';
import * as clientModule from '../../../api/client';
import type { MickeyDetailDTO } from '@dwt/shared';

function createWrapper(queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('Mickeys API hooks & mutations (Task 10.2, Requirement 13.8)', () => {
  let apiRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    apiRequestSpy = jest.spyOn(clientModule, 'apiRequest');
  });

  afterEach(() => {
    apiRequestSpy.mockRestore();
  });

  it('useMickeyConfig calls GET /mickeys/config', async () => {
    apiRequestSpy.mockResolvedValueOnce({ enabled: true, submissionsEnabled: true });
    const { result } = renderHook(() => useMickeyConfig(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/mickeys/config');
    expect(result.current.data).toEqual({ enabled: true, submissionsEnabled: true });
  });

  it('useMickeySummary calls GET /mickeys/summary with and without for parameter', async () => {
    apiRequestSpy.mockResolvedValueOnce({
      overall: { total: 10, found: 4 },
      byPark: [{ park: 'Magic Kingdom', total: 10, found: 4 }],
      community: { found: 2 },
    });

    const { result } = renderHook(() => useMickeySummary(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/mickeys/summary');

    apiRequestSpy.mockResolvedValueOnce({
      overall: { total: 10, found: 5 },
      byPark: [],
      community: { found: 0 },
    });
    const { result: friendResult } = renderHook(() => useMickeySummary('user-friend-1'), {
      wrapper: createWrapper(),
    });
    await waitFor(() => expect(friendResult.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/mickeys/summary?for=user-friend-1');
  });

  it('useMickeyList serializes all query filters into query params', async () => {
    apiRequestSpy.mockResolvedValueOnce({ items: [], nextCursor: null });

    const { result } = renderHook(
      () =>
        useMickeyList({
          experienceId: 'exp-1',
          park: 'EPCOT',
          areaType: 'ThemePark',
          zone: 'queue',
          difficulty: 'easy',
          found: 'unfound',
          scope: 'official',
          q: 'fountain',
          limit: 25,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledWith(
      'GET',
      '/mickeys?experienceId=exp-1&park=EPCOT&areaType=ThemePark&zone=queue&difficulty=easy&found=unfound&scope=official&q=fountain&limit=25',
    );
  });

  it('useMickeyList automatically drains paginated nextCursor pages so all Mickeys load', async () => {
    apiRequestSpy
      .mockResolvedValueOnce({
        items: [{ id: 'm1', experienceId: 'e1', experienceName: 'Ride A', clue1: 'Clue 1' }],
        nextCursor: 'cursor-page-2',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'm2', experienceId: 'e2', experienceName: 'Ride B', clue1: 'Clue 2' }],
        nextCursor: 'cursor-page-3',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'm3', experienceId: 'e3', experienceName: 'Ride C', clue1: 'Clue 3' }],
        nextCursor: null,
      });

    const { result } = renderHook(() => useMickeyList({ park: 'Magic Kingdom' }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledTimes(3);
    expect(apiRequestSpy).toHaveBeenNthCalledWith(1, 'GET', '/mickeys?park=Magic+Kingdom');
    expect(apiRequestSpy).toHaveBeenNthCalledWith(
      2,
      'GET',
      '/mickeys?park=Magic+Kingdom&cursor=cursor-page-2',
    );
    expect(apiRequestSpy).toHaveBeenNthCalledWith(
      3,
      'GET',
      '/mickeys?park=Magic+Kingdom&cursor=cursor-page-3',
    );
    expect(result.current.data?.items.map((i) => i.id)).toEqual(['m1', 'm2', 'm3']);
    expect(result.current.data?.nextCursor).toBeNull();
  });

  it('useMickeyDetail calls GET /mickeys/:id', async () => {
    const mockDetail: MickeyDetailDTO = {
      id: 'mickey-1',
      experienceId: 'exp-1',
      experienceName: 'Space Mountain',
      park: 'Magic Kingdom',
      land: 'Tomorrowland',
      zone: 'queue',
      difficulty: 'easy',
      clue1: 'Look at the ceiling star map.',
      official: true,
      communityVerified: false,
      confidenceLabel: 'confirmed',
      hintLevel: 1,
      found: false,
      tripId: null,
      friendsFoundCount: 2,
    };
    apiRequestSpy.mockResolvedValueOnce(mockDetail);

    const { result } = renderHook(() => useMickeyDetail('mickey-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/mickeys/mickey-1');
    expect(result.current.data).toEqual(mockDetail);
  });

  it('useMickeyHint posts level to /me/mickeys/:id/hint', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    apiRequestSpy.mockResolvedValueOnce({ mickeyId: 'mickey-1', hintLevel: 2 });

    const { result } = renderHook(() => useMickeyHint(), { wrapper: createWrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync({ mickeyId: 'mickey-1', level: 2 });
    });

    expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/mickeys/mickey-1/hint', { level: 2 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: mickeyKeys.detail('mickey-1') });
  });

  it('useMickeyFind performs optimistic update and rolls back on failure', async () => {
    const queryClient = new QueryClient();
    const initialDetail: MickeyDetailDTO = {
      id: 'mickey-1',
      experienceId: 'exp-1',
      experienceName: 'Space Mountain',
      park: 'Magic Kingdom',
      land: null,
      zone: 'queue',
      difficulty: 'easy',
      clue1: 'Clue 1 text here.',
      official: true,
      communityVerified: false,
      confidenceLabel: 'confirmed',
      hintLevel: 1,
      found: false,
      tripId: null,
      friendsFoundCount: 0,
    };
    queryClient.setQueryData(mickeyKeys.detail('mickey-1'), initialDetail);

    // Fail the mutation to trigger rollback
    apiRequestSpy.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useMickeyFind(), { wrapper: createWrapper(queryClient) });

    await act(async () => {
      try {
        await result.current.mutateAsync({ mickeyId: 'mickey-1', tripId: 'trip-99' });
      } catch {
        // expected error
      }
    });

    expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/mickeys/mickey-1/find', {
      tripId: 'trip-99',
    });

    // Check that cache rolled back to unfound
    const rolledBack = queryClient.getQueryData<MickeyDetailDTO>(mickeyKeys.detail('mickey-1'));
    expect(rolledBack?.found).toBe(false);
    expect(rolledBack?.tripId).toBeNull();
  });

  it('useMickeyUndoFind performs optimistic update and rolls back on failure', async () => {
    const queryClient = new QueryClient();
    const initialDetail: MickeyDetailDTO = {
      id: 'mickey-1',
      experienceId: 'exp-1',
      experienceName: 'Space Mountain',
      park: 'Magic Kingdom',
      land: null,
      zone: 'queue',
      difficulty: 'easy',
      clue1: 'Clue 1 text here.',
      official: true,
      communityVerified: false,
      confidenceLabel: 'confirmed',
      hintLevel: 1,
      found: true,
      tripId: 'trip-1',
      friendsFoundCount: 0,
    };
    queryClient.setQueryData(mickeyKeys.detail('mickey-1'), initialDetail);

    apiRequestSpy.mockRejectedValueOnce(new Error('Undo failed'));

    const { result } = renderHook(() => useMickeyUndoFind(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync({ mickeyId: 'mickey-1' });
      } catch {
        // expected
      }
    });

    expect(apiRequestSpy).toHaveBeenCalledWith('DELETE', '/me/mickeys/mickey-1/find');
    const rolledBack = queryClient.getQueryData<MickeyDetailDTO>(mickeyKeys.detail('mickey-1'));
    expect(rolledBack?.found).toBe(true);
    expect(rolledBack?.tripId).toBe('trip-1');
  });

  it('useMickeyVote posts to PUT /me/mickeys/:id/vote and invalidates caches', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    apiRequestSpy.mockResolvedValueOnce({ mickeyId: 'mickey-1', vote: 'there' });

    const { result } = renderHook(() => useMickeyVote(), { wrapper: createWrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync({ mickeyId: 'mickey-1', vote: 'there' });
    });

    expect(apiRequestSpy).toHaveBeenCalledWith('PUT', '/me/mickeys/mickey-1/vote', {
      vote: 'there',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: mickeyKeys.detail('mickey-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: mickeyKeys.summary() });
  });

  it('useMickeyReport posts to POST /mickeys/:id/report and invalidates caches', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    apiRequestSpy.mockResolvedValueOnce({ mickeyId: 'mickey-1', reported: true });

    const { result } = renderHook(() => useMickeyReport(), { wrapper: createWrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync({
        mickeyId: 'mickey-1',
        reason: 'not_a_mickey',
        note: 'Accidental scuff mark',
      });
    });

    expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/mickeys/mickey-1/report', {
      reason: 'not_a_mickey',
      note: 'Accidental scuff mark',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: mickeyKeys.detail('mickey-1') });
  });

  it('useSubmitMickey posts to POST /me/mickeys/submissions and invalidates submissions and list', async () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const mockSubmission = {
      id: 'sub-1',
      status: 'pending',
      official: false,
      communityVerified: false,
      clue1: 'A hidden shape in the carpet.',
      experienceName: 'Haunted Mansion',
      reviewNote: null,
      createdAt: '2026-11-07T00:00:00Z',
    };
    apiRequestSpy.mockResolvedValueOnce(mockSubmission);

    const { result } = renderHook(() => useSubmitMickey(), { wrapper: createWrapper(queryClient) });
    await act(async () => {
      await result.current.mutateAsync({
        experienceId: 'exp-1',
        zone: 'queue',
        difficulty: 'medium',
        clue1: 'A hidden shape in the carpet.',
        clue2: 'Look down right before the stretching room.',
        reveal: 'Three circular patterns on the burgundy carpet weave.',
      });
    });

    expect(apiRequestSpy).toHaveBeenCalledWith('POST', '/me/mickeys/submissions', expect.any(Object));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: mickeyKeys.mySubmissions() });
  });

  it('useMySubmissions calls GET /me/mickeys/submissions', async () => {
    apiRequestSpy.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useMySubmissions(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/me/mickeys/submissions');
  });

  it('useFriendMickeyFinds calls GET /users/:id/mickeys/finds', async () => {
    apiRequestSpy.mockResolvedValueOnce({ items: [], nextCursor: null });
    const { result } = renderHook(() => useFriendMickeyFinds('friend-123'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiRequestSpy).toHaveBeenCalledWith('GET', '/users/friend-123/mickeys/finds');
  });
});
