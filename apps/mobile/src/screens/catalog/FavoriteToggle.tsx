/**
 * FavoriteToggle — universal favorite toggle affordance (heart icon).
 *
 * Reused everywhere (header, catalog rows, Home, etc.) via its `size` prop.
 *
 * Validates: Requirements 2.2, 2.3, 2.4, 3.3
 */

import React from 'react';
import { Pressable } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import type { FavoritesResponseDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { FAVORITES_QUERY_KEY } from './useFavoritedExperiences';

export interface FavoriteToggleProps {
  readonly experienceId: string;
  readonly favorited: boolean;
  readonly size?: 'small' | 'large';
  readonly accessibilityLabel?: string;
}

export default function FavoriteToggle({
  experienceId,
  favorited,
  size = 'large',
  accessibilityLabel,
}: FavoriteToggleProps): JSX.Element {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation<void, ApiError, boolean, { previous?: FavoritesResponseDTO | undefined }>({
    mutationFn: async (nextFavorited) => {
      if (nextFavorited) {
        await apiRequest<null>('PUT', `/me/experiences/${encodeURIComponent(experienceId)}/favorite`);
      } else {
        await apiRequest<null>('DELETE', `/me/experiences/${encodeURIComponent(experienceId)}/favorite`);
      }
    },
    onMutate: async (nextFavorited) => {
      await queryClient.cancelQueries({ queryKey: FAVORITES_QUERY_KEY });
      const previous = queryClient.getQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY);
      queryClient.setQueryData<FavoritesResponseDTO>(FAVORITES_QUERY_KEY, (old) => {
        const ids = new Set(old?.experienceIds ?? []);
        if (nextFavorited) {
          ids.add(experienceId);
        } else {
          ids.delete(experienceId);
        }
        return { experienceIds: [...ids] };
      });
      return { previous };
    },
    onError: (_err, _next, context) => {
      if (context?.previous) {
        queryClient.setQueryData(FAVORITES_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: FAVORITES_QUERY_KEY });
    },
  });

  const isFavorited = toggleMutation.isPending ? toggleMutation.variables : favorited;

  return (
    <Pressable
      onPress={() => toggleMutation.mutate(!isFavorited)}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (isFavorited ? 'Remove from favorites' : 'Add to favorites')
      }
      accessibilityState={{ selected: isFavorited }}
      testID={`favorite-toggle-${experienceId}`}
      hitSlop={8}
    >
      <Ionicons
        name={isFavorited ? 'heart' : 'heart-outline'}
        size={size === 'large' ? 22 : 18}
        color={isFavorited ? '#FF2D55' : theme.color.textSecondary}
      />
    </Pressable>
  );
}

export { FavoriteToggle };
