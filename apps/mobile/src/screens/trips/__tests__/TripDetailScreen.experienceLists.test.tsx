/**
 * Mobile tests for Trip "Attached Experience Lists" section (Tasks 19.1, 19.2).
 *
 * Validates: Requirements 14.1, 14.4, 14.8
 *
 * Covers:
 *   - R14.8: Rendering attached experience lists with name, item count, and owner.
 *   - R14.8: Tapping an available experience list navigates to ExperienceListDetail with experienceListId.
 *   - R14.8: Rendering unavailable entries with greyed "No longer available" treatment.
 *   - R14.1: Sourcing owned and public-browsable lists for attach, excluding already-attached lists.
 *   - R14.1: Successful attach triggers POST /trips/:id/experience-lists and refreshes detail.
 *   - R14.1: Mapping trip_experience_list_ineligible to friendly copy.
 *   - R14.1: Mapping experience_list_not_found to friendly copy.
 *   - R14.4: Organizer detach triggers DELETE /trips/:id/experience-lists/:experienceListId.
 *   - R14.4: Adder detach triggers DELETE /trips/:id/experience-lists/:experienceListId.
 *   - R14.4: Forbidden third party (non-organizer non-adder) has detach gated client-side.
 *   - R14.4: Server rejection trip_forbidden on detach displays friendly copy.
 *   - R14.8/R14.4: Organizer can detach unavailable entries to clean up dead links.
 */

import React from 'react';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

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

import TripDetailScreen from '../TripDetailScreen';
import AttachedExperienceListsSection from '../AttachedExperienceListsSection';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type {
  ExperienceListDTO,
  ExperienceListDiscoveryPageDTO,
  TripDTO,
  TripExperienceListDTO,
} from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = '44444444-4444-4444-8444-444444444444';
const OWN_USER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_USER_ID = '66666666-6666-4666-8666-666666666666';

const LIST_1_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const LIST_2_ID = '10101010-1010-4101-8101-101010101010';
const LIST_UNAVAIL_ID = '20202020-2020-4202-8202-202020202020';
const LIST_NEW_ID = '30303030-3030-4303-8303-303030303030';
const LIST_PUB_ID = '40404040-4040-4404-8404-404040404040';

const AVAILABLE_LIST_1: TripExperienceListDTO = {
  available: true,
  experienceListId: LIST_1_ID,
  name: 'Thrill Rides of Magic Kingdom',
  itemCount: 5,
  ownerDisplayName: 'Ariel',
};

const AVAILABLE_LIST_2: TripExperienceListDTO = {
  available: true,
  experienceListId: LIST_2_ID,
  name: 'Must-See Shows',
  itemCount: 3,
  ownerDisplayName: 'Sebastian',
};

const UNAVAILABLE_LIST: TripExperienceListDTO = {
  available: false,
  experienceListId: LIST_UNAVAIL_ID,
};

const BASE_TRIP: TripDTO = {
  id: TRIP_ID,
  name: 'Disney Trip 2026',
  description: 'Rides and fun.',
  startDate: '2026-10-01',
  endDate: '2026-10-05',
  status: 'active',
  createdAt: '2026-09-01T00:00:00Z',
  resorts: [],
  foodLists: [],
  experienceLists: [AVAILABLE_LIST_1, UNAVAILABLE_LIST],
};

const OWNED_EXPERIENCE_LISTS: readonly ExperienceListDTO[] = [
  {
    id: LIST_1_ID, // already attached
    ownerId: OWN_USER_ID,
    ownerDisplayName: 'Ariel',
    name: 'Thrill Rides of Magic Kingdom',
    visibility: 'private',
    likeCount: 2,
    itemCount: 5,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    pinnedAt: null,
  },
  {
    id: LIST_NEW_ID, // not attached yet
    ownerId: OWN_USER_ID,
    ownerDisplayName: 'Ariel',
    name: 'Epcot Must-Dos',
    visibility: 'public',
    likeCount: 10,
    itemCount: 8,
    createdAt: '2026-09-02T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    pinnedAt: null,
  },
];

const DISCOVERY_PAGE: ExperienceListDiscoveryPageDTO = {
  items: [
    {
      id: LIST_1_ID, // already attached
      ownerId: OWN_USER_ID,
      ownerDisplayName: 'Ariel',
      name: 'Thrill Rides of Magic Kingdom',
      visibility: 'public',
      likeCount: 20,
      itemCount: 5,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      pinnedAt: null,
    },
    {
      id: LIST_PUB_ID, // not attached yet
      ownerId: OTHER_USER_ID,
      ownerDisplayName: 'Chef Mickey',
      name: 'Best Thrill Rides',
      visibility: 'public',
      likeCount: 45,
      itemCount: 12,
      createdAt: '2026-09-03T00:00:00Z',
      updatedAt: '2026-09-03T00:00:00Z',
      pinnedAt: null,
    },
  ],
  nextCursor: null,
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function makeNavigation(): { navigate: jest.Mock; goBack: jest.Mock } {
  return { navigate: jest.fn(), goBack: jest.fn() };
}

describe('Attached Experience Lists UI (Task 19.1, 19.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      const confirmButton = buttons?.find(
        (b) => b.text === 'Detach' || b.style === 'destructive',
      );
      confirmButton?.onPress?.();
    });
  });

  test('R14.8: renders attached experience lists with name, itemCount, and ownerDisplayName', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (path === '/me') return { user: { id: OWN_USER_ID } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      throw new Error(`Unexpected path ${path}`);
    });

    const navigation = makeNavigation();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <TripDetailScreen
          navigation={navigation as any}
          route={{
            key: 'detail',
            name: 'TripDetail',
            params: { tripId: TRIP_ID },
          }}
        />
      </QueryClientProvider>,
    );

    // Header and section exist
    expect(
      await screen.findByTestId('trip-detail-experience-lists-section'),
    ).toBeTruthy();
    expect(screen.getByText('Attached Experience Lists')).toBeTruthy();

    // Available list item rendered with name, owner, and itemCount
    expect(
      screen.getByTestId(`attached-experience-list-${LIST_1_ID}`),
    ).toBeTruthy();
    expect(screen.getByText('Thrill Rides of Magic Kingdom')).toBeTruthy();
    expect(screen.getByText(/by Ariel/)).toBeTruthy();
    expect(screen.getByText(/5 items/)).toBeTruthy();
  });

  test('R14.8: tapping an available attached experience list navigates to ExperienceListDetail', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (path === '/me') return { user: { id: OWN_USER_ID } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      throw new Error(`Unexpected path ${path}`);
    });

    const navigation = makeNavigation();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <TripDetailScreen
          navigation={navigation as any}
          route={{
            key: 'detail',
            name: 'TripDetail',
            params: { tripId: TRIP_ID },
          }}
        />
      </QueryClientProvider>,
    );

    const card = await screen.findByTestId(
      `attached-experience-list-${LIST_1_ID}`,
    );
    fireEvent.press(card);

    expect(navigation.navigate).toHaveBeenCalledWith('ExperienceListDetail', {
      experienceListId: LIST_1_ID,
    });
  });

  test('R14.8: renders unavailable entry with greyed "No longer available" treatment', async () => {
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === `/trips/${TRIP_ID}`) return BASE_TRIP;
      if (path === '/me') return { user: { id: OWN_USER_ID } };
      if (path === `/trips/${TRIP_ID}/members`) return [];
      throw new Error(`Unexpected path ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <TripDetailScreen
          navigation={makeNavigation() as any}
          route={{
            key: 'detail',
            name: 'TripDetail',
            params: { tripId: TRIP_ID },
          }}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByTestId(
        `attached-experience-list-unavailable-${LIST_UNAVAIL_ID}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('No longer available')).toBeTruthy();
  });

  test('R14.1: opens attach modal and attaches an owned experience list', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/experience-lists') return OWNED_EXPERIENCE_LISTS;
      if (path === '/experience-lists/discover?sort=popular') return DISCOVERY_PAGE;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/experience-lists`) {
        return { success: true };
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    const queryClient = makeQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[AVAILABLE_LIST_1]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Open attach modal
    const attachBtn = screen.getByTestId('trip-detail-attach-experience-list-btn');
    fireEvent.press(attachBtn);

    expect(
      await screen.findByTestId('attach-experience-list-modal'),
    ).toBeTruthy();

    // Already attached list LIST_1_ID should NOT be shown in the picker
    expect(
      screen.queryByTestId(`selectable-experience-list-${LIST_1_ID}`),
    ).toBeNull();

    // Unattached list LIST_NEW_ID is selectable
    const selectableItem = await screen.findByTestId(
      `selectable-experience-list-${LIST_NEW_ID}`,
    );
    expect(selectableItem).toBeTruthy();
    expect(screen.getByText('Epcot Must-Dos')).toBeTruthy();

    // Tap attach
    const attachItemAction = screen.getByTestId(
      `attach-experience-list-action-${LIST_NEW_ID}`,
    );
    fireEvent.press(attachItemAction);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/experience-lists`,
        { experienceListId: LIST_NEW_ID },
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['trips', 'detail', TRIP_ID],
      });
    });
  });

  test('R14.1: attaches a public experience list from the Discover tab', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/experience-lists') return OWNED_EXPERIENCE_LISTS;
      if (path === '/experience-lists/discover?sort=popular') return DISCOVERY_PAGE;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/experience-lists`) {
        return { success: true };
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[AVAILABLE_LIST_1]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Open modal
    fireEvent.press(screen.getByTestId('trip-detail-attach-experience-list-btn'));

    // Switch to Discover tab
    const discoverTab = await screen.findByTestId(
      'attach-experience-list-tab-discover',
    );
    fireEvent.press(discoverTab);

    // Public list LIST_PUB_ID appears
    expect(
      await screen.findByTestId(`selectable-experience-list-${LIST_PUB_ID}`),
    ).toBeTruthy();
    expect(screen.getByText('Best Thrill Rides')).toBeTruthy();
    expect(screen.getByText(/by Chef Mickey/)).toBeTruthy();

    // Attach it
    fireEvent.press(
      screen.getByTestId(`attach-experience-list-action-${LIST_PUB_ID}`),
    );

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/experience-lists`,
        { experienceListId: LIST_PUB_ID },
      );
    });
  });

  test('R14.1: surfaces friendly error when attaching an ineligible experience list (trip_experience_list_ineligible)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/experience-lists') return OWNED_EXPERIENCE_LISTS;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/experience-lists`) {
        throw new ApiError({
          code: 'trip_experience_list_ineligible',
          message: 'ineligible',
          status: 403,
        });
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    fireEvent.press(screen.getByTestId('trip-detail-attach-experience-list-btn'));
    const itemAction = await screen.findByTestId(
      `attach-experience-list-action-${LIST_NEW_ID}`,
    );
    fireEvent.press(itemAction);

    expect(
      await screen.findByTestId('attach-experience-list-error'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Only experience lists you own or public lists can be attached to a trip.',
      ),
    ).toBeTruthy();
  });

  test('R14.1: surfaces friendly error when attaching a missing experience list (experience_list_not_found)', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (path === '/me/experience-lists') return OWNED_EXPERIENCE_LISTS;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/experience-lists`) {
        throw new ApiError({
          code: 'experience_list_not_found',
          message: 'not found',
          status: 404,
        });
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[]}
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    fireEvent.press(screen.getByTestId('trip-detail-attach-experience-list-btn'));
    const itemAction = await screen.findByTestId(
      `attach-experience-list-action-${LIST_NEW_ID}`,
    );
    fireEvent.press(itemAction);

    expect(
      await screen.findByTestId('attach-experience-list-error'),
    ).toBeTruthy();
    expect(
      screen.getByText('This experience list could not be found.'),
    ).toBeTruthy();
  });

  test('R14.4: an Organizer can detach any attached experience list', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (
        method === 'DELETE' &&
        path === `/trips/${TRIP_ID}/experience-lists/${LIST_2_ID}`
      ) {
        return undefined;
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    const queryClient = makeQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[AVAILABLE_LIST_2]} // Owned by Sebastian, caller is Organizer
          isOrganizer={true}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Organizer sees the detach button
    const detachBtn = screen.getByTestId(
      `detach-experience-list-btn-${LIST_2_ID}`,
    );
    expect(detachBtn).toBeTruthy();

    fireEvent.press(detachBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/experience-lists/${LIST_2_ID}`,
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['trips', 'detail', TRIP_ID],
      });
    });
  });

  test('R14.4: an Adder can detach their own attached experience list', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (
        method === 'DELETE' &&
        path === `/trips/${TRIP_ID}/experience-lists/${LIST_1_ID}`
      ) {
        return undefined;
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[AVAILABLE_LIST_1]} // Owned by Ariel, caller is Ariel (plain member)
          isOrganizer={false}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    // Adder sees detach button for their own list
    const detachBtn = screen.getByTestId(
      `detach-experience-list-btn-${LIST_1_ID}`,
    );
    expect(detachBtn).toBeTruthy();

    fireEvent.press(detachBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/experience-lists/${LIST_1_ID}`,
      );
    });
  });

  test('R14.4: a non-organizer non-adder does not see detach control (client-side gating)', async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[AVAILABLE_LIST_2]} // Owned by Sebastian, caller is Flounder
          isOrganizer={false}
          callerDisplayName="Flounder"
        />
      </QueryClientProvider>,
    );

    // Detach button must NOT be present for a non-organizer, non-adder
    expect(
      screen.queryByTestId(`detach-experience-list-btn-${LIST_2_ID}`),
    ).toBeNull();
  });

  test('prompts confirmation when detach is pressed and cancels without calling API', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[AVAILABLE_LIST_1]}
          isOrganizer={true}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    const detachBtn = screen.getByTestId(
      `detach-experience-list-btn-${LIST_1_ID}`,
    );
    fireEvent.press(detachBtn);

    expect(alertSpy).toHaveBeenCalledWith(
      "Detach 'Thrill Rides of Magic Kingdom'?",
      expect.stringContaining(
        "Detach 'Thrill Rides of Magic Kingdom' from this trip?",
      ),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
        expect.objectContaining({ text: 'Detach', style: 'destructive' }),
      ]),
    );
    expect(apiRequestMock).not.toHaveBeenCalledWith(
      'DELETE',
      `/trips/${TRIP_ID}/experience-lists/${LIST_1_ID}`,
    );
  });

  test('R14.4: server rejection trip_forbidden on detach displays friendly copy', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (method === 'DELETE') {
        throw new ApiError({
          code: 'trip_forbidden',
          message: 'forbidden',
          status: 403,
        });
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[AVAILABLE_LIST_2]}
          isOrganizer={false}
          callerDisplayName="Sebastian"
          allowAllDetachForTesting={true}
        />
      </QueryClientProvider>,
    );

    const detachBtn = screen.getByTestId(
      `detach-experience-list-btn-${LIST_2_ID}`,
    );
    fireEvent.press(detachBtn);

    expect(
      await screen.findByTestId('trip-detail-detach-experience-list-error'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Only the person who attached this experience list or a trip organizer can detach it.',
      ),
    ).toBeTruthy();
  });

  test('R14.8, R14.4: Organizer can detach an unavailable entry to clean up dead references', async () => {
    apiRequestMock.mockImplementation(async (method, path) => {
      if (
        method === 'DELETE' &&
        path === `/trips/${TRIP_ID}/experience-lists/${LIST_UNAVAIL_ID}`
      ) {
        return undefined;
      }
      throw new Error(`Unexpected call ${method} ${path}`);
    });

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AttachedExperienceListsSection
          tripId={TRIP_ID}
          experienceLists={[UNAVAILABLE_LIST]}
          isOrganizer={true}
          callerDisplayName="Ariel"
        />
      </QueryClientProvider>,
    );

    const detachBtn = screen.getByTestId(
      `detach-experience-list-btn-${LIST_UNAVAIL_ID}`,
    );
    expect(detachBtn).toBeTruthy();

    fireEvent.press(detachBtn);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'DELETE',
        `/trips/${TRIP_ID}/experience-lists/${LIST_UNAVAIL_ID}`,
      );
    });
  });
});
