// Feature: experience-lists, Task 10.4 — MyExperienceListsScreen render/interaction tests
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ExperienceListCollectionDTO, ExperienceListDTO } from '@dwt/shared';

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
const mockCanGoBack = jest.fn(() => true);
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      canGoBack: mockCanGoBack,
    }),
  };
});

import { apiRequest as mockedApiRequest } from '../../../api/client';
import MyExperienceListsScreen from '../MyExperienceListsScreen';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderScreen(): ReturnType<typeof render> {
  const queryClient = createTestClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <MyExperienceListsScreen />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

const sampleOwnedLists: readonly ExperienceListDTO[] = [
  {
    id: 'exp-list-1',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Thrill Rides',
    visibility: 'public',
    itemCount: 4,
    likeCount: 12,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    pinnedAt: null,
  },
  {
    id: 'exp-list-2',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Rainy Day Backups',
    visibility: 'private',
    itemCount: 2,
    likeCount: 0,
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:00:00.000Z',
    pinnedAt: null,
  },
];

const sampleSavedLists: ExperienceListCollectionDTO['saved'] = [
  {
    available: true as const,
    id: 'exp-list-saved-1',
    ownerId: 'user-alice',
    ownerDisplayName: 'Alice',
    name: "Alice's Must-Dos",
    visibility: 'public' as const,
    itemCount: 5,
    likeCount: 42,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    pinnedAt: null,
  },
  {
    available: false as const,
    experienceListId: 'exp-list-saved-2',
  },
];

describe('MyExperienceListsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/experience-lists/collection') {
        return {
          owned: sampleOwnedLists,
          saved: sampleSavedLists,
        };
      }
      return {};
    });
  });

  test('shows a loading indicator, then renders owned experience lists on the default tab (Requirement 1.1, 5.1)', async () => {
    let resolveCollection: (() => void) | undefined;
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/experience-lists/collection') {
        await new Promise<void>((resolve) => {
          resolveCollection = resolve;
        });
        return { owned: sampleOwnedLists, saved: sampleSavedLists };
      }
      return {};
    });

    renderScreen();

    expect(screen.getByTestId('my-experience-lists-loading')).toBeTruthy();

    resolveCollection?.();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
      expect(screen.getByText('Rainy Day Backups')).toBeTruthy();
    });

    expect(screen.getByText('4 items')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
  });

  test('switches between owned and saved tabs, rendering an available: false row as a degraded, non-interactive notice keyed by experienceListId (Requirement 1.2, 1.3, 3.1)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('my-experience-lists-tab-saved'));

    await waitFor(() => {
      expect(screen.getByText("Alice's Must-Dos")).toBeTruthy();
      expect(screen.getByText('No longer available')).toBeTruthy();
    });

    // Available saved row navigates when tapped.
    fireEvent.press(screen.getByTestId('saved-experience-list-card-exp-list-saved-1'));
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceListDetail', {
      experienceListId: 'exp-list-saved-1',
    });

    // Degraded row is keyed by experienceListId, not id, and has no navigation surface.
    expect(screen.queryByTestId('saved-experience-list-card-exp-list-saved-2')).toBeNull();
    expect(
      screen.getByTestId('saved-experience-list-unavailable-exp-list-saved-2'),
    ).toBeTruthy();

    // Switching back to owned still shows the owned tab content.
    fireEvent.press(screen.getByTestId('my-experience-lists-tab-owned'));
    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });
  });

  test('empty state renders on the owned tab when there are no owned lists (Requirement 1.1)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/experience-lists/collection') {
        return { owned: [], saved: sampleSavedLists };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('my-experience-lists-owned-empty')).toBeTruthy();
      expect(
        screen.getByText("You haven't created any experience lists yet."),
      ).toBeTruthy();
    });
  });

  test('empty state renders on the saved tab when there are no saved lists (Requirement 1.2)', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/experience-lists/collection') {
        return { owned: sampleOwnedLists, saved: [] };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('my-experience-lists-tab-saved'));

    await waitFor(() => {
      expect(screen.getByTestId('my-experience-lists-saved-empty')).toBeTruthy();
      expect(screen.getByText('No saved lists yet.')).toBeTruthy();
    });
  });

  test('creates a new experience list through the modal, sending name + visibility and refetching the collection (Requirement 1.4)', async () => {
    let ownedAfterCreate: ExperienceListDTO[] = [...sampleOwnedLists];
    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (path === '/me/experience-lists' && method === 'POST') {
        const created: ExperienceListDTO = {
          id: 'exp-list-new-1',
          ownerId: 'user-me',
          ownerDisplayName: 'Me',
          name: (body as any)?.name,
          visibility: (body as any)?.visibility ?? 'private',
          itemCount: 0,
          likeCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pinnedAt: null,
        };
        ownedAfterCreate = [created, ...ownedAfterCreate];
        return created;
      }
      if (path === '/me/experience-lists/collection') {
        return { owned: ownedAfterCreate, saved: sampleSavedLists };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('my-experience-lists-create-btn'));
    expect(screen.getByText('Create Experience List')).toBeTruthy();

    fireEvent.changeText(
      screen.getByTestId('new-experience-list-name-input'),
      'Must-Ride Attractions',
    );
    fireEvent.press(screen.getByTestId('new-experience-list-visibility-public'));
    fireEvent.press(screen.getByTestId('submit-create-experience-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/experience-lists', {
        name: 'Must-Ride Attractions',
        visibility: 'public',
      });
    });

    // The collection query is invalidated/refetched, so the new list appears.
    await waitFor(() => {
      expect(screen.getByText('Must-Ride Attractions')).toBeTruthy();
    });
  });

  test('renames a list via the rename modal opened from a card\'s rename button (Requirement 1.4)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/experience-lists/collection') {
        return { owned: sampleOwnedLists, saved: sampleSavedLists };
      }
      if (path === '/me/experience-lists/exp-list-1' && method === 'PATCH') {
        return { ...sampleOwnedLists[0], name: 'Must-Ride Thrills' };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('my-experience-lists-rename-btn-exp-list-1'));
    expect(screen.getByText('Rename List')).toBeTruthy();

    fireEvent.changeText(
      screen.getByTestId('rename-experience-list-input'),
      'Must-Ride Thrills',
    );
    fireEvent.press(screen.getByTestId('submit-rename-experience-list-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/experience-lists/exp-list-1',
        { name: 'Must-Ride Thrills' },
      );
    });
  });

  test('toggles a list\'s visibility, sending the flipped value (Requirement 1.4)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    // exp-list-1 is public; toggling should flip it to private.
    fireEvent.press(screen.getByTestId('my-experience-lists-visibility-btn-exp-list-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/experience-lists/exp-list-1',
        { visibility: 'private' },
      );
    });

    // exp-list-2 is private; toggling should flip it to public.
    fireEvent.press(screen.getByTestId('my-experience-lists-visibility-btn-exp-list-2'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/experience-lists/exp-list-2',
        { visibility: 'public' },
      );
    });
  });

  test('deletes a list via DELETE /me/experience-lists/:id (Requirement 1.4)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('my-experience-lists-delete-btn-exp-list-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', '/me/experience-lists/exp-list-1');
    });
  });

  test('header back button invokes navigation.goBack() when history exists (Requirement 1.1)', async () => {
    mockCanGoBack.mockReturnValue(true);
    renderScreen();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();
    });

    fireEvent.press(screen.getByRole('button', { name: 'Go back' }));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  // Feature: list-pinning
  test('pins an unpinned experience list, sending pinned: true', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    expect(screen.getByLabelText('Pin Thrill Rides')).toBeTruthy();

    fireEvent.press(screen.getByTestId('my-experience-lists-pin-btn-exp-list-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/experience-lists/exp-list-1',
        { pinned: true },
      );
    });
  });

  // Feature: list-pinning
  test('unpins an already-pinned experience list, sending pinned: false', async () => {
    const pinnedOwned = [
      { ...sampleOwnedLists[0]!, pinnedAt: '2026-09-20T08:00:00.000Z' },
      sampleOwnedLists[1]!,
    ];
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/experience-lists/collection') {
        return { owned: pinnedOwned, saved: sampleSavedLists };
      }
      return {};
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
    });

    expect(screen.getByLabelText('Unpin Thrill Rides')).toBeTruthy();

    fireEvent.press(screen.getByTestId('my-experience-lists-pin-btn-exp-list-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        '/me/experience-lists/exp-list-1',
        { pinned: false },
      );
    });
  });

  test('header "Discover" button navigates to ExperienceListDiscovery (Requirement 1.1, 6.7)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('my-experience-lists-discover-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('my-experience-lists-discover-btn'));
    expect(mockNavigate).toHaveBeenCalledWith('ExperienceListDiscovery');
  });
});
