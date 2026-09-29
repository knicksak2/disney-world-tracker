// Feature: experience-lists, Task 10.4 — ExperienceListDiscoveryScreen render/interaction tests
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FlatList } from 'react-native';
import type { ExperienceListDiscoveryPageDTO } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
    }),
  };
});

import { apiRequest as mockedApiRequest } from '../../../api/client';
import ExperienceListDiscoveryScreen from '../ExperienceListDiscoveryScreen';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderScreen(): ReturnType<typeof render> {
  const queryClient = createTestClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <ExperienceListDiscoveryScreen />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

const page1: ExperienceListDiscoveryPageDTO = {
  items: [
    {
      id: 'disc-exp-1',
      ownerId: 'user-bob',
      ownerDisplayName: 'Bob',
      name: 'Best Thrill Rides in MK',
      visibility: 'public',
      itemCount: 3,
      likeCount: 99,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      pinnedAt: null,
    },
    {
      id: 'disc-exp-2',
      ownerId: 'user-carol',
      ownerDisplayName: 'Carol',
      name: 'Low-Key Family Faves',
      visibility: 'public',
      itemCount: 8,
      likeCount: 45,
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
      pinnedAt: null,
    },
  ],
  nextCursor: 'cursor-page-2',
};

const page2: ExperienceListDiscoveryPageDTO = {
  items: [
    {
      id: 'disc-exp-3',
      ownerId: 'user-dave',
      ownerDisplayName: 'Dave',
      name: 'Late Night Fireworks Spots',
      visibility: 'public',
      itemCount: 2,
      likeCount: 15,
      createdAt: '2026-09-03T10:00:00.000Z',
      updatedAt: '2026-09-03T10:00:00.000Z',
      pinnedAt: null,
    },
  ],
  nextCursor: null,
};

describe('ExperienceListDiscoveryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path === 'string' && path.includes('/experience-lists/discover')) {
        if (path.includes('cursor=cursor-page-2')) {
          return page2;
        }
        return page1;
      }
      return {};
    });
  });

  test('renders discovery list with popular sort by default (Requirement 6.7)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Thrill Rides in MK')).toBeTruthy();
      expect(screen.getByText('Low-Key Family Faves')).toBeTruthy();
    });

    expect(screen.getByText('by Bob')).toBeTruthy();
    expect(screen.getByText('99')).toBeTruthy();
    expect(screen.getByText('3 items')).toBeTruthy();
    expect(screen.getByText('by Carol')).toBeTruthy();
    expect(screen.getByText('8 items')).toBeTruthy();

    expect(apiRequestMock).toHaveBeenCalledWith('GET', expect.stringContaining('sort=popular'));
  });

  test('toggles sort from popular to recent, changing the query param (Requirement 6.7)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Thrill Rides in MK')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('experience-discovery-sort-recent'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', expect.stringContaining('sort=recent'));
    });
  });

  test('infinite scroll: onEndReached triggers fetchNextPage and appends the second page\'s items (Requirement 6.7)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Thrill Rides in MK')).toBeTruthy();
      expect(screen.getByText('Low-Key Family Faves')).toBeTruthy();
    });

    expect(screen.queryByText('Late Night Fireworks Spots')).toBeNull();

    // The screen's real `FlatList` drives infinite scroll via `onEndReached`.
    // React Native's gesture/scroll pipeline for reaching list end isn't
    // practically drivable through `fireEvent` here, so this invokes the
    // real prop directly off the real `FlatList` element — the most direct
    // testable path to the real `handleLoadMore`/`fetchNextPage` contract.
    const flatList = screen.UNSAFE_getByType(FlatList);
    flatList.props.onEndReached();

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        expect.stringContaining('cursor=cursor-page-2'),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Late Night Fireworks Spots')).toBeTruthy();
    });

    // Original page-1 items remain rendered alongside the appended page-2 item.
    expect(screen.getByText('Best Thrill Rides in MK')).toBeTruthy();
    expect(screen.getByText('Low-Key Family Faves')).toBeTruthy();
  });

  test('tapping a card navigates to ExperienceListDetail with the right experienceListId (Requirement 6.7)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Thrill Rides in MK')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('experience-discovery-item-disc-exp-1'));
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceListDetail', {
      experienceListId: 'disc-exp-1',
    });
  });

  test('renders empty state when no public lists are returned (Requirement 6.7)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (typeof path === 'string' && path.includes('/experience-lists/discover')) {
        return { items: [], nextCursor: null };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No public experience lists found yet.')).toBeTruthy();
    });
  });

  test('renders error state when the discovery fetch fails (Requirement 6.7)', async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new Error('Network error');
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Could not load public experience lists.')).toBeTruthy();
    });
  });
});
