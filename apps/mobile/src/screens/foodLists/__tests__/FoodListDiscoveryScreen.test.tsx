// Feature: food-lists, Task 8.4 — FoodListDiscoveryScreen component and interaction tests
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { FoodListDiscoveryPageDTO } from '@dwt/shared';

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
import FoodListDiscoveryScreen from '../FoodListDiscoveryScreen';

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
        <FoodListDiscoveryScreen />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

const page1: FoodListDiscoveryPageDTO = {
  items: [
    {
      id: 'disc-1',
      ownerId: 'user-bob',
      ownerDisplayName: 'Bob',
      name: 'Best Churros in MK',
      visibility: 'public',
      isChecklist: false,
      itemCount: 3,
      likeCount: 99,
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'disc-2',
      ownerId: 'user-carol',
      ownerDisplayName: 'Carol',
      name: 'Gluten Free Disney',
      visibility: 'public',
      isChecklist: false,
      itemCount: 8,
      likeCount: 45,
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    },
  ],
  nextCursor: 'cursor-page-2',
};

const page2: FoodListDiscoveryPageDTO = {
  items: [
    {
      id: 'disc-3',
      ownerId: 'user-dave',
      ownerDisplayName: 'Dave',
      name: 'Late Night Bites',
      visibility: 'public',
      isChecklist: false,
      itemCount: 2,
      likeCount: 15,
      createdAt: '2026-09-03T10:00:00.000Z',
      updatedAt: '2026-09-03T10:00:00.000Z',
    },
  ],
  nextCursor: null,
};

describe('FoodListDiscoveryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path.includes('/food-lists/discover')) {
        if (path.includes('cursor=cursor-page-2')) {
          return page2;
        }
        return page1;
      }
      return {};
    });
  });

  test('renders discovery list with popular sort by default', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Churros in MK')).toBeTruthy();
      expect(screen.getByText('Gluten Free Disney')).toBeTruthy();
    });

    // Check metadata
    expect(screen.getByText('by Bob')).toBeTruthy();
    expect(screen.getByText('99')).toBeTruthy();
    expect(screen.getByText('3 items')).toBeTruthy();
    expect(screen.getByText('by Carol')).toBeTruthy();
    expect(screen.getByText('8 items')).toBeTruthy();

    expect(apiRequestMock).toHaveBeenCalledWith('GET', expect.stringContaining('sort=popular'));
  });

  test('toggles sort from popular to recent', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Churros in MK')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-discovery-sort-recent'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', expect.stringContaining('sort=recent'));
    });
  });

  test('tapping a card navigates to FoodListDetail', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Best Churros in MK')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('food-discovery-item-disc-1'));
    expect(mockNavigate).toHaveBeenCalledWith('FoodListDetail', {
      foodListId: 'disc-1',
    });
  });

  test('renders empty state when no public lists are returned', async () => {
    apiRequestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('No public food lists found yet.')).toBeTruthy();
    });
  });
});
