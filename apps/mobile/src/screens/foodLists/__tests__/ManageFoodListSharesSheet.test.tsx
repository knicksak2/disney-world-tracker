// Feature: food-lists, Task 8.10 — ManageFoodListSharesSheet interaction tests
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { FoodListShareDTO } from '@dwt/shared';

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

import { apiRequest as mockedApiRequest } from '../../../api/client';
import ManageFoodListSharesSheet from '../ManageFoodListSharesSheet';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

const sampleShares: readonly FoodListShareDTO[] = [
  {
    recipientId: 'user-friend-1',
    recipientDisplayName: 'Friend One',
    role: 'viewer',
    sharedAt: '2026-09-01T12:00:00.000Z',
  },
  {
    recipientId: 'user-friend-2',
    recipientDisplayName: 'Friend Two',
    role: 'editor',
    sharedAt: '2026-09-02T12:00:00.000Z',
  },
];

const sampleFriends = {
  friends: [
    {
      userId: 'user-friend-1',
      displayName: 'Friend One',
      email: 'f1@example.com',
      avatarUrl: null,
      friendshipId: 'fr-1',
      friendsSince: '2026-01-01T00:00:00Z',
    },
    {
      userId: 'user-friend-2',
      displayName: 'Friend Two',
      email: 'f2@example.com',
      avatarUrl: null,
      friendshipId: 'fr-2',
      friendsSince: '2026-01-01T00:00:00Z',
    },
    {
      userId: 'user-friend-3',
      displayName: 'Friend Three',
      email: 'f3@example.com',
      avatarUrl: null,
      friendshipId: 'fr-3',
      friendsSince: '2026-01-01T00:00:00Z',
    },
  ],
  incomingRequests: [],
  outgoingRequests: [],
};

describe('ManageFoodListSharesSheet', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/food-lists/list-123/shares') {
        return sampleShares;
      }
      if (path === '/me/friends') {
        return sampleFriends;
      }
      return {};
    });
  });

  function renderSheet(visible = true): ReturnType<typeof render> {
    const queryClient = createTestClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <ManageFoodListSharesSheet
          visible={visible}
          onClose={mockOnClose}
          foodListId="list-123"
        />
      </QueryClientProvider>,
    );
  }

  test('renders recipient shares with current roles (Task 8.10)', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByText('Friend One')).toBeTruthy();
      expect(screen.getByText('Friend Two')).toBeTruthy();
    });

    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.getByText('Can edit items')).toBeTruthy();
  });

  test('toggles role from viewer to editor via POST /me/food-lists/:id/shares', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByText('Friend One')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('share-role-toggle-user-friend-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-lists/list-123/shares',
        {
          recipientId: 'user-friend-1',
          role: 'editor',
        },
      );
    });
  });

  test('toggles role from editor to viewer via POST /me/food-lists/:id/shares', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByText('Friend Two')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('share-role-toggle-user-friend-2'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-lists/list-123/shares',
        {
          recipientId: 'user-friend-2',
          role: 'viewer',
        },
      );
    });
  });

  test('revokes a share via DELETE /me/food-lists/:id/shares/:recipientId', async () => {
    renderSheet();

    await waitFor(() => {
      expect(screen.getByText('Friend One')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('share-revoke-btn-user-friend-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/food-lists/list-123/shares/user-friend-1',
      );
    });
  });

  test('adds a new share with an available friend', async () => {
    renderSheet();

    await waitFor(() => {
      // Friend 1 and 2 already have shares; only Friend 3 is available in friend chips
      expect(screen.getByTestId('share-friend-select-user-friend-3')).toBeTruthy();
    });

    // Select Friend 3
    fireEvent.press(screen.getByTestId('share-friend-select-user-friend-3'));

    // Toggle role to editor for new share
    fireEvent.press(screen.getByTestId('add-share-role-editor'));

    // Submit new share
    fireEvent.press(screen.getByTestId('add-share-submit-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/food-lists/list-123/shares',
        {
          recipientId: 'user-friend-3',
          role: 'editor',
        },
      );
    });
  });
});
