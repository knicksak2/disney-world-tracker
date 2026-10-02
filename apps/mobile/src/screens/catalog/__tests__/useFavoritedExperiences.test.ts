// Feature: experience-favorites
// Task 4.3: useFavoritedExperiences hook test (mocked network layer, asserts correct Set on success and empty Set on error/loading)
//
// Validates: Requirements 1.1, 1.3, 1.5, 2.4

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { FavoritesResponseDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import {
  FAVORITES_QUERY_KEY,
  useFavoritedExperiences,
} from '../useFavoritedExperiences';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockedApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useFavoritedExperiences (Requirements 1.1, 1.3, 1.5, 2.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes the single shared query key FAVORITES_QUERY_KEY = ["me", "favorites"]', () => {
    expect(FAVORITES_QUERY_KEY).toEqual(['me', 'favorites']);
  });

  it('returns an empty Set initially while query is loading', () => {
    mockedApiRequest.mockImplementation(() => new Promise(() => {}));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useFavoritedExperiences(), { wrapper });

    expect(result.current).toBeInstanceOf(Set);
    expect(result.current.size).toBe(0);
  });

  it('returns a populated Set containing the favorited experience ids on success', async () => {
    const payload: FavoritesResponseDTO = {
      experienceIds: [
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ],
    };
    mockedApiRequest.mockResolvedValueOnce(payload);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useFavoritedExperiences(), { wrapper });

    await waitFor(() => {
      expect(result.current.size).toBe(2);
    });

    expect(result.current.has('11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(result.current.has('22222222-2222-2222-2222-222222222222')).toBe(true);
    expect(result.current.has('33333333-3333-3333-3333-333333333333')).toBe(false);
    expect(mockedApiRequest).toHaveBeenCalledWith('GET', '/me/favorites');
  });

  it('returns an empty Set on network or api failure', async () => {
    mockedApiRequest.mockRejectedValueOnce(new Error('Network error'));

    const wrapper = createWrapper();
    const { result } = renderHook(() => useFavoritedExperiences(), { wrapper });

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalled();
    });

    expect(result.current).toBeInstanceOf(Set);
    expect(result.current.size).toBe(0);
  });
});
