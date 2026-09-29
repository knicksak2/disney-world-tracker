// Feature: experience-lists, Task 11.4 — AddToExperienceListsSheet interaction tests
// Structural mirror of foodLists/__tests__/AddToListsSheet.test.tsx, adapted to this
// sheet's single-experience prop shape ({ experienceId, experienceName }, not an array).
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ExperienceListDetailDTO, ExperienceListDTO } from '@dwt/shared';

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

import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import AddToExperienceListsSheet from '../AddToExperienceListsSheet';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

const sampleOwnedLists: readonly ExperienceListDTO[] = [
  {
    id: 'elist-1',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Thrill Rides',
    visibility: 'public',
    itemCount: 1,
    likeCount: 5,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    pinnedAt: null,
  },
  {
    id: 'elist-2',
    ownerId: 'user-me',
    ownerDisplayName: 'Me',
    name: 'Kid Friendly',
    visibility: 'private',
    itemCount: 0,
    likeCount: 0,
    createdAt: '2026-09-02T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    pinnedAt: null,
  },
];

const sampleList1Detail: ExperienceListDetailDTO = {
  id: 'elist-1',
  ownerId: 'user-me',
  ownerDisplayName: 'Me',
  name: 'Thrill Rides',
  visibility: 'public',
  itemCount: 1,
  likeCount: 5,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  pinnedAt: null,
  liked: false,
  saved: false,
  version: 1,
  myRole: 'owner',
  items: [
    {
      experienceId: 'exp-space-mountain',
      name: 'Space Mountain',
      park: 'Magic Kingdom',
      category: 'Ride',
      position: 1000,
      addedByUserId: 'user-me',
      addedByDisplayName: 'Me',
    },
  ],
};

const sampleList2Detail: ExperienceListDetailDTO = {
  id: 'elist-2',
  ownerId: 'user-me',
  ownerDisplayName: 'Me',
  name: 'Kid Friendly',
  visibility: 'private',
  itemCount: 0,
  likeCount: 0,
  createdAt: '2026-09-02T00:00:00Z',
  updatedAt: '2026-09-02T00:00:00Z',
  pinnedAt: null,
  liked: false,
  saved: false,
  version: 1,
  myRole: 'owner',
  items: [],
};

describe('AddToExperienceListsSheet', () => {
  const mockOnClose = jest.fn();
  const mockOnComplete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/experience-lists') {
        return sampleOwnedLists;
      }
      if (path === '/experience-lists/elist-1') {
        return sampleList1Detail;
      }
      if (path === '/experience-lists/elist-2') {
        return sampleList2Detail;
      }
      return {};
    });
  });

  function renderSheet(visible = true): ReturnType<typeof render> {
    const queryClient = createTestClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <AddToExperienceListsSheet
          visible={visible}
          onClose={mockOnClose}
          onComplete={mockOnComplete}
          experienceId="exp-space-mountain"
          experienceName="Space Mountain"
        />
      </QueryClientProvider>,
    );
  }

  test('pre-selects list where the experience is already present (Requirement 9.3)', async () => {
    renderSheet();

    // Verifies the fetch sequence: owned lists first, then each owned
    // list's detail, to determine pre-selection.
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', '/me/experience-lists');
    });
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('GET', '/experience-lists/elist-1');
      expect(apiRequestMock).toHaveBeenCalledWith('GET', '/experience-lists/elist-2');
    });

    await waitFor(() => {
      expect(screen.getByText('Thrill Rides')).toBeTruthy();
      expect(screen.getByText('Kid Friendly')).toBeTruthy();
    });

    await waitFor(() => {
      const list1Row = screen.getByTestId('experience-list-checkbox-row-elist-1');
      expect(list1Row.props.accessibilityState.checked).toBe(true);
    });

    const list2Row = screen.getByTestId('experience-list-checkbox-row-elist-2');
    expect(list2Row.props.accessibilityState.checked).toBe(false);
  });

  test('toggling selection saves additions and removals on Save', async () => {
    renderSheet();

    await waitFor(() => {
      const list1Row = screen.getByTestId('experience-list-checkbox-row-elist-1');
      expect(list1Row.props.accessibilityState.checked).toBe(true);
    });

    // Uncheck list-1 (removal)
    fireEvent.press(screen.getByTestId('experience-list-checkbox-row-elist-1'));
    // Check list-2 (addition)
    fireEvent.press(screen.getByTestId('experience-list-checkbox-row-elist-2'));

    fireEvent.press(screen.getByTestId('add-to-experience-lists-save-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        '/me/experience-lists/elist-1/items/exp-space-mountain',
      );
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/experience-lists/elist-2/items',
        { experienceId: 'exp-space-mountain' },
      );
    });

    expect(mockOnComplete).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });

  test('creates a new list inline via POST /me/experience-lists and auto-selects it', async () => {
    const newlyCreatedLists: ExperienceListDTO[] = [];
    const newListDetail: ExperienceListDetailDTO = {
      id: 'elist-new-inline',
      ownerId: 'user-me',
      ownerDisplayName: 'Me',
      name: 'Must Do Attractions',
      visibility: 'private',
      itemCount: 0,
      likeCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pinnedAt: null,
      liked: false,
      saved: false,
      version: 1,
      myRole: 'owner',
      items: [],
    };

    apiRequestMock.mockImplementation(async (method, path, body) => {
      if (path === '/me/experience-lists') {
        if (method === 'POST') {
          const created: ExperienceListDTO = {
            id: 'elist-new-inline',
            ownerId: 'user-me',
            ownerDisplayName: 'Me',
            name: (body as any)?.name,
            visibility: 'private',
            itemCount: 0,
            likeCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            pinnedAt: null,
          };
          newlyCreatedLists.push(created);
          return created;
        }
        return [...sampleOwnedLists, ...newlyCreatedLists];
      }
      if (path === '/experience-lists/elist-1') return sampleList1Detail;
      if (path === '/experience-lists/elist-2') return sampleList2Detail;
      if (path === '/experience-lists/elist-new-inline') return newListDetail;
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('inline-create-experience-list-btn')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('inline-create-experience-list-btn'));

    fireEvent.changeText(
      screen.getByTestId('create-experience-list-name-input'),
      'Must Do Attractions',
    );

    fireEvent.press(screen.getByTestId('submit-create-experience-list-inline-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', '/me/experience-lists', {
        name: 'Must Do Attractions',
        visibility: 'private',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('experience-list-checkbox-row-elist-new-inline')).toBeTruthy();
    });
    await waitFor(() => {
      const newRow = screen.getByTestId('experience-list-checkbox-row-elist-new-inline');
      expect(newRow.props.accessibilityState.checked).toBe(true);
    });

    // Auto-selected: saving now must add the experience to the newly-created list.
    fireEvent.press(screen.getByTestId('add-to-experience-lists-save-btn'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        '/me/experience-lists/elist-new-inline/items',
        { experienceId: 'exp-space-mountain' },
      );
    });
  });

  test('swallows an experience_list_item_duplicate error on save (Requirement 9.4)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/experience-lists') return sampleOwnedLists;
      if (path === '/experience-lists/elist-1') return sampleList1Detail;
      if (path === '/experience-lists/elist-2') return sampleList2Detail;
      if (path === '/me/experience-lists/elist-2/items' && method === 'POST') {
        throw new ApiError({
          code: 'experience_list_item_duplicate',
          message: 'Duplicate item',
          status: 409,
        });
      }
      return {};
    });

    renderSheet();

    await waitFor(() => {
      expect(screen.getByTestId('experience-list-checkbox-row-elist-2')).toBeTruthy();
    });

    // Select list-2 (addition path that will 409)
    fireEvent.press(screen.getByTestId('experience-list-checkbox-row-elist-2'));

    fireEvent.press(screen.getByTestId('add-to-experience-lists-save-btn'));

    // Duplicate is swallowed, not thrown — onComplete/onClose still fire.
    await waitFor(() => {
      expect(mockOnComplete).toHaveBeenCalled();
      expect(mockOnClose).toHaveBeenCalled();
    });
  });
});
