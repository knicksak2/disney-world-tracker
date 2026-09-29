// Feature: experience-lists — Schedule Builder / Planned List Picker Integration (Requirement 15).
// Task 20.1: `useAttachedExperienceListItems` fetches each attached (available)
// Experience_List's contents and merges them into one flat,
// deduplicated-by-`experienceId` result set for ExperiencePicker's "My Lists" tab.
//
// Validates: Requirements 15.1, 15.2, 15.3

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import type { ExperienceListDetailDTO, TripExperienceListDTO } from '@dwt/shared';

import { apiRequest } from '../../../api/client';
import {
  useAttachedExperienceListItems,
  useAttachedExperienceListItemsForTrip,
} from '../useAttachedExperienceListItems';

jest.mock('../../../api/client', () => ({
  apiRequest: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function makeListDetail(
  overrides: Partial<ExperienceListDetailDTO> & { items: ExperienceListDetailDTO['items'] },
): ExperienceListDetailDTO {
  return {
    id: 'list-placeholder',
    ownerId: 'owner-1',
    ownerDisplayName: 'Alex',
    name: 'My List',
    visibility: 'private',
    likeCount: 0,
    itemCount: overrides.items.length,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    pinnedAt: null,
    liked: false,
    saved: false,
    version: 1,
    myRole: 'owner',
    ...overrides,
  };
}

describe('useAttachedExperienceListItems (R15.1, R15.2, R15.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty, non-loading result when there are zero attached lists (R15.3)', async () => {
    const { result } = renderHook(() => useAttachedExperienceListItems([]), { wrapper });

    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('fetches only the available attached lists (skipping unavailable ones) and merges their items (R15.1, R15.2)', async () => {
    const experienceLists: readonly TripExperienceListDTO[] = [
      {
        available: true,
        experienceListId: 'list-1',
        name: 'Must Do Rides',
        itemCount: 1,
        ownerDisplayName: 'Alex',
      },
      { available: false, experienceListId: 'list-deleted' },
      {
        available: true,
        experienceListId: 'list-2',
        name: 'Dining Wishlist',
        itemCount: 1,
        ownerDisplayName: 'Sam',
      },
    ];

    (apiRequest as jest.Mock).mockImplementation(async (_method: string, path: string) => {
      if (path === '/experience-lists/list-1') {
        return makeListDetail({
          id: 'list-1',
          items: [
            {
              experienceId: 'exp-space-mountain',
              name: 'Space Mountain',
              park: 'Magic Kingdom',
              category: 'Ride',
              position: 0,
              addedByUserId: 'user-1',
              addedByDisplayName: 'Alex',
            },
          ],
        });
      }
      if (path === '/experience-lists/list-2') {
        return makeListDetail({
          id: 'list-2',
          items: [
            {
              experienceId: 'exp-be-our-guest',
              name: 'Be Our Guest',
              park: 'Magic Kingdom',
              category: 'Restaurant',
              position: 0,
              addedByUserId: 'user-2',
              addedByDisplayName: 'Sam',
            },
          ],
        });
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { result } = renderHook(() => useAttachedExperienceListItems(experienceLists), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Only the two available lists are fetched — the unavailable link is
    // skipped, since it has no items to source (R14.8 / R15.1).
    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenCalledWith('GET', '/experience-lists/list-1');
    expect(apiRequest).toHaveBeenCalledWith('GET', '/experience-lists/list-2');

    const ids = result.current.items.map((item) => item.id);
    expect(ids).toEqual(['exp-space-mountain', 'exp-be-our-guest']);

    // Each merged row carries the ExperienceDTO shape the picker expects.
    const spaceMountain = result.current.items.find((i) => i.id === 'exp-space-mountain');
    expect(spaceMountain).toMatchObject({
      id: 'exp-space-mountain',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
    });
  });

  it('deduplicates by experienceId when the same Experience appears on more than one attached list (R15.2)', async () => {
    const experienceLists: readonly TripExperienceListDTO[] = [
      { available: true, experienceListId: 'list-1', name: 'List A', itemCount: 1, ownerDisplayName: 'Alex' },
      { available: true, experienceListId: 'list-2', name: 'List B', itemCount: 1, ownerDisplayName: 'Sam' },
    ];

    const sharedItem = {
      experienceId: 'exp-shared',
      name: 'Jungle Cruise',
      park: 'Magic Kingdom' as const,
      category: 'Ride' as const,
      position: 0,
      addedByUserId: 'user-1',
      addedByDisplayName: 'Alex',
    };

    (apiRequest as jest.Mock).mockImplementation(async (_method: string, path: string) => {
      if (path === '/experience-lists/list-1') {
        return makeListDetail({ id: 'list-1', items: [sharedItem] });
      }
      if (path === '/experience-lists/list-2') {
        return makeListDetail({ id: 'list-2', items: [sharedItem] });
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { result } = renderHook(() => useAttachedExperienceListItems(experienceLists), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The shared Experience appears on both lists but must surface exactly
    // once in the merged, deduplicated-by-experienceId result set.
    expect(result.current.items.filter((i) => i.id === 'exp-shared').length).toBe(1);
  });

  it('does not issue any request when enabled=false', () => {
    const experienceLists: readonly TripExperienceListDTO[] = [
      { available: true, experienceListId: 'list-1', name: 'List A', itemCount: 1, ownerDisplayName: 'Alex' },
    ];

    renderHook(() => useAttachedExperienceListItems(experienceLists, false), { wrapper });

    expect(apiRequest).not.toHaveBeenCalled();
  });
});

describe('useAttachedExperienceListItemsForTrip (R15.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches the Trip, then merges its attached lists\u2019 items', async () => {
    (apiRequest as jest.Mock).mockImplementation(async (_method: string, path: string) => {
      if (path === '/trips/trip-1') {
        return {
          id: 'trip-1',
          experienceLists: [
            {
              available: true,
              experienceListId: 'list-1',
              name: 'List A',
              itemCount: 1,
              ownerDisplayName: 'Alex',
            },
          ],
        };
      }
      if (path === '/experience-lists/list-1') {
        return makeListDetail({
          id: 'list-1',
          items: [
            {
              experienceId: 'exp-space-mountain',
              name: 'Space Mountain',
              park: 'Magic Kingdom',
              category: 'Ride',
              position: 0,
              addedByUserId: 'user-1',
              addedByDisplayName: 'Alex',
            },
          ],
        });
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const { result } = renderHook(() => useAttachedExperienceListItemsForTrip('trip-1'), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items.map((i) => i.id)).toEqual(['exp-space-mountain']);
  });

  it('does not fetch the Trip or any list when enabled=false', () => {
    renderHook(() => useAttachedExperienceListItemsForTrip('trip-1', false), { wrapper });

    expect(apiRequest).not.toHaveBeenCalled();
  });
});
