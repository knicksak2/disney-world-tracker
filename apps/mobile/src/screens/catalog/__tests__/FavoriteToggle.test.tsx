// Feature: experience-favorites
// Task 4.3: FavoriteToggle test (real component render, mocked apiRequest,
// asserts optimistic flip + rollback-on-rejection for both the favorite and unfavorite directions)
//
// Validates: Requirements 1.1, 1.3, 2.2, 2.3, 2.4, 3.3

import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { FavoritesResponseDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import FavoriteToggle from '../FavoriteToggle';
import { FAVORITES_QUERY_KEY } from '../useFavoritedExperiences';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const mockedApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

function getIconProps(button: ReactTestInstance): { name?: string; size?: number; color?: string } {
  const child = button.children[0];
  if (typeof child === 'object' && child !== null && 'props' in child) {
    return (child as ReactTestInstance).props as { name?: string; size?: number; color?: string };
  }
  throw new Error('Expected button to have an icon child with props');
}

function renderFavoriteToggle(
  props: React.ComponentProps<typeof FavoriteToggle>,
  initialCacheIds: string[] = [],
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  if (initialCacheIds.length > 0) {
    queryClient.setQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY, {
      experienceIds: initialCacheIds,
    });
  }

  const result = render(
    <QueryClientProvider client={queryClient}>
      <FavoriteToggle {...props} />
    </QueryClientProvider>,
  );

  return { ...result, queryClient };
}

describe('FavoriteToggle (Requirements 2.2, 2.3, 2.4, 3.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('optimistic flip & success — favorite direction (favorited=false -> true)', () => {
    it('optimistically flips immediately on tap and calls PUT /me/experiences/:id/favorite', async () => {
      let resolvePut!: () => void;
      const putPromise = new Promise<null>((res) => {
        resolvePut = () => res(null);
      });
      mockedApiRequest.mockReturnValueOnce(putPromise);

      const expId = 'exp-add-1';
      const { getByTestId, queryClient } = renderFavoriteToggle({
        experienceId: expId,
        favorited: false,
      });

      const button = getByTestId(`favorite-toggle-${expId}`);
      expect(button.props.accessibilityState?.selected).toBe(false);
      expect(button.props.accessibilityLabel).toBe('Add to favorites');
      expect(getIconProps(button).name).toBe('heart-outline');

      // Tap to favorite
      await act(async () => {
        fireEvent.press(button);
      });

      // Optimistic flip before network resolves:
      await waitFor(() => {
        const optimisticButton = getByTestId(`favorite-toggle-${expId}`);
        expect(optimisticButton.props.accessibilityState?.selected).toBe(true);
        expect(optimisticButton.props.accessibilityLabel).toBe('Remove from favorites');
        expect(getIconProps(optimisticButton).name).toBe('heart');
      });

      expect(mockedApiRequest).toHaveBeenCalledWith(
        'PUT',
        `/me/experiences/${expId}/favorite`,
      );

      // Cache updated optimistically
      const cached = queryClient.getQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY);
      expect(cached?.experienceIds).toContain(expId);

      // Settle network call
      await act(async () => {
        resolvePut();
      });

      await waitFor(() => {
        const settledButton = getByTestId(`favorite-toggle-${expId}`);
        expect(settledButton.props.accessibilityState?.selected).toBe(true);
      });
    });

    it('rolls back to unfavorited if PUT fails', async () => {
      let rejectPut!: (err: Error) => void;
      const putPromise = new Promise<null>((_, rej) => {
        rejectPut = rej;
      });
      mockedApiRequest.mockReturnValueOnce(putPromise);

      const expId = 'exp-fail-add';
      const { getByTestId, queryClient } = renderFavoriteToggle(
        { experienceId: expId, favorited: false },
        ['other-exp'],
      );

      const button = getByTestId(`favorite-toggle-${expId}`);
      expect(button.props.accessibilityState?.selected).toBe(false);

      // Tap to favorite
      await act(async () => {
        fireEvent.press(button);
      });

      // Optimistically flipped to true
      await waitFor(() => {
        const optimisticButton = getByTestId(`favorite-toggle-${expId}`);
        expect(optimisticButton.props.accessibilityState?.selected).toBe(true);
      });

      // Reject network call
      await act(async () => {
        rejectPut(new Error('Network error'));
      });

      // Rolls back to false
      await waitFor(() => {
        const rolledBackButton = getByTestId(`favorite-toggle-${expId}`);
        expect(rolledBackButton.props.accessibilityState?.selected).toBe(false);
        expect(rolledBackButton.props.accessibilityLabel).toBe('Add to favorites');
        expect(getIconProps(rolledBackButton).name).toBe('heart-outline');
      });

      // Cache rolled back
      const cached = queryClient.getQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY);
      expect(cached?.experienceIds).not.toContain(expId);
    });
  });

  describe('optimistic flip & success — unfavorite direction (favorited=true -> false)', () => {
    it('optimistically flips immediately on tap and calls DELETE /me/experiences/:id/favorite', async () => {
      let resolveDelete!: () => void;
      const deletePromise = new Promise<null>((res) => {
        resolveDelete = () => res(null);
      });
      mockedApiRequest.mockReturnValueOnce(deletePromise);

      const expId = 'exp-del-1';
      const { getByTestId, queryClient } = renderFavoriteToggle(
        { experienceId: expId, favorited: true },
        [expId],
      );

      const button = getByTestId(`favorite-toggle-${expId}`);
      expect(button.props.accessibilityState?.selected).toBe(true);
      expect(button.props.accessibilityLabel).toBe('Remove from favorites');
      expect(getIconProps(button).name).toBe('heart');

      // Tap to unfavorite
      await act(async () => {
        fireEvent.press(button);
      });

      // Optimistic flip before network resolves:
      await waitFor(() => {
        const optimisticButton = getByTestId(`favorite-toggle-${expId}`);
        expect(optimisticButton.props.accessibilityState?.selected).toBe(false);
        expect(optimisticButton.props.accessibilityLabel).toBe('Add to favorites');
        expect(getIconProps(optimisticButton).name).toBe('heart-outline');
      });

      expect(mockedApiRequest).toHaveBeenCalledWith(
        'DELETE',
        `/me/experiences/${expId}/favorite`,
      );

      // Cache updated optimistically
      const cached = queryClient.getQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY);
      expect(cached?.experienceIds).not.toContain(expId);

      // Settle network call
      await act(async () => {
        resolveDelete();
      });

      await waitFor(() => {
        const settledButton = getByTestId(`favorite-toggle-${expId}`);
        expect(settledButton.props.accessibilityState?.selected).toBe(false);
      });
    });

    it('rolls back to favorited if DELETE fails', async () => {
      let rejectDelete!: (err: Error) => void;
      const deletePromise = new Promise<null>((_, rej) => {
        rejectDelete = rej;
      });
      mockedApiRequest.mockReturnValueOnce(deletePromise);

      const expId = 'exp-fail-del';
      const { getByTestId, queryClient } = renderFavoriteToggle(
        { experienceId: expId, favorited: true },
        [expId],
      );

      const button = getByTestId(`favorite-toggle-${expId}`);
      expect(button.props.accessibilityState?.selected).toBe(true);

      // Tap to unfavorite
      await act(async () => {
        fireEvent.press(button);
      });

      // Optimistically flipped to false
      await waitFor(() => {
        const optimisticButton = getByTestId(`favorite-toggle-${expId}`);
        expect(optimisticButton.props.accessibilityState?.selected).toBe(false);
      });

      // Reject network call
      await act(async () => {
        rejectDelete(new Error('Network error'));
      });

      // Rolls back to true
      await waitFor(() => {
        const rolledBackButton = getByTestId(`favorite-toggle-${expId}`);
        expect(rolledBackButton.props.accessibilityState?.selected).toBe(true);
        expect(rolledBackButton.props.accessibilityLabel).toBe('Remove from favorites');
        expect(getIconProps(rolledBackButton).name).toBe('heart');
      });

      // Cache rolled back
      const cached = queryClient.getQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY);
      expect(cached?.experienceIds).toContain(expId);
    });
  });

  describe('size and styling', () => {
    it('renders with small size (18) vs large size (22)', () => {
      const expId = 'exp-size';
      const { getByTestId, rerender } = renderFavoriteToggle({
        experienceId: expId,
        favorited: false,
        size: 'small',
      });

      const buttonSmall = getByTestId(`favorite-toggle-${expId}`);
      expect(getIconProps(buttonSmall).size).toBe(18);

      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <FavoriteToggle experienceId={expId} favorited={false} size="large" />
        </QueryClientProvider>,
      );

      const buttonLarge = getByTestId(`favorite-toggle-${expId}`);
      expect(getIconProps(buttonLarge).size).toBe(22);
    });

    it('honors custom accessibilityLabel when provided', () => {
      const expId = 'exp-a11y';
      const { getByTestId } = renderFavoriteToggle({
        experienceId: expId,
        favorited: false,
        accessibilityLabel: 'Custom favorite button',
      });

      const button = getByTestId(`favorite-toggle-${expId}`);
      expect(button.props.accessibilityLabel).toBe('Custom favorite button');
    });
  });
});
