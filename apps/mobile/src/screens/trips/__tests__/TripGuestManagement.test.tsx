/**
 * TripGuestManagement component tests (Task 11.3).
 *
 * Requirements: 2.1, 2.2, 2.3, 2.8, 2.9, 2.10
 *
 * Validates:
 * - Add a new guest with sponsor mapping
 * - Rename an existing guest
 * - Remove a guest
 * - Removal blocked when referenced by active expenses, displaying friendly explanatory error
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import TripGuestManagementModal from '../TripGuestManagementModal';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';
import type { TripMemberDTO, TripGuestDTO } from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-123';
const USER_1 = 'user-1'; // Ariel
const USER_2 = 'user-2'; // Eric

const MEMBERS: TripMemberDTO[] = [
  { userId: USER_1, displayName: 'Ariel', avatarPreset: null, role: 'organizer' },
  { userId: USER_2, displayName: 'Eric', avatarPreset: null, role: 'member' },
];

const INITIAL_GUESTS: TripGuestDTO[] = [
  {
    id: 'guest-1',
    tripId: TRIP_ID,
    name: 'Melody',
    sponsorMemberId: USER_1,
    createdAt: '2026-10-01T00:00:00Z',
  },
];

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe('TripGuestManagementModal', () => {
  let queryClient: QueryClient;
  const onCloseMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = makeQueryClient();
  });

  const renderModal = (guests: TripGuestDTO[] = INITIAL_GUESTS) =>
    render(
      <QueryClientProvider client={queryClient}>
        <TripGuestManagementModal
          visible={true}
          onClose={onCloseMock}
          tripId={TRIP_ID}
          callerId={USER_1}
          isOrganizer={true}
          members={MEMBERS}
          guests={guests}
        />
      </QueryClientProvider>,
    );

  it('renders guest roster and sponsor attribution', () => {
    renderModal();

    expect(screen.getByTestId('trip-guest-management-modal')).toBeTruthy();
    expect(screen.getByText('Melody')).toBeTruthy();
    expect(screen.getByText('Sponsored by Ariel')).toBeTruthy();
  });

  it('adds a new guest with sponsor mapping defaulting to caller (Req 2.1)', async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: 'guest-2',
      tripId: TRIP_ID,
      name: 'Flounder Jr',
      sponsorMemberId: USER_1,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });

    renderModal();

    fireEvent.changeText(screen.getByTestId('add-guest-name-input'), 'Flounder Jr');
    fireEvent.press(screen.getByTestId('add-guest-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/guests`, {
        name: 'Flounder Jr',
        sponsorMemberId: USER_1,
      });
      expect(screen.getByText('Flounder Jr')).toBeTruthy();
      expect(screen.getByText('ROSTER (2)')).toBeTruthy();
    });
  });

  it('adds a new guest tied to a selected different member (Req 2.1, 2.12)', async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: 'guest-3',
      tripId: TRIP_ID,
      name: 'Sebastian Jr',
      sponsorMemberId: USER_2,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });

    renderModal();

    // Select Eric (USER_2) as sponsor
    fireEvent.press(screen.getByTestId(`add-guest-sponsor-${USER_2}`));
    fireEvent.changeText(screen.getByTestId('add-guest-name-input'), 'Sebastian Jr');
    fireEvent.press(screen.getByTestId('add-guest-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/guests`, {
        name: 'Sebastian Jr',
        sponsorMemberId: USER_2,
      });
      expect(screen.getByText('Sebastian Jr')).toBeTruthy();
    });
  });

  it('renames an existing guest preserving sponsor (Req 2.10)', async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: 'guest-1',
      tripId: TRIP_ID,
      name: 'Princess Melody',
      sponsorMemberId: USER_1,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });

    renderModal();

    fireEvent.press(screen.getByTestId('rename-guest-btn-guest-1'));
    fireEvent.changeText(screen.getByTestId('rename-guest-input-guest-1'), 'Princess Melody');
    fireEvent.press(screen.getByTestId('save-rename-guest-guest-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', `/trips/${TRIP_ID}/guests/guest-1`, {
        name: 'Princess Melody',
        sponsorMemberId: USER_1,
      });
    });
  });

  it('reassigns guest sponsor to another member on edit (Req 2.11, 2.12)', async () => {
    apiRequestMock.mockResolvedValueOnce({
      id: 'guest-1',
      tripId: TRIP_ID,
      name: 'Melody',
      sponsorMemberId: USER_2,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    });

    renderModal();

    fireEvent.press(screen.getByTestId('rename-guest-btn-guest-1'));
    // Reassign sponsor to Eric (USER_2)
    fireEvent.press(screen.getByTestId(`edit-guest-sponsor-guest-1-${USER_2}`));
    fireEvent.press(screen.getByTestId('save-rename-guest-guest-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('PATCH', `/trips/${TRIP_ID}/guests/guest-1`, {
        name: 'Melody',
        sponsorMemberId: USER_2,
      });
    });
  });

  it('removes a guest when not in use', async () => {
    apiRequestMock.mockResolvedValueOnce({});

    renderModal();

    fireEvent.press(screen.getByTestId('remove-guest-btn-guest-1'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', `/trips/${TRIP_ID}/guests/guest-1`);
    });
  });

  it('displays friendly explanatory error when removal is blocked while in use', async () => {
    apiRequestMock.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'trip_validation_failed',
        message: 'Guest is referenced by active expenses',
      }),
    );

    renderModal();

    fireEvent.press(screen.getByTestId('remove-guest-btn-guest-1'));

    await waitFor(() => {
      expect(screen.getByTestId('guest-management-error')).toBeTruthy();
      expect(
        screen.getByText(
          'This guest cannot be removed because they are referenced by one or more expenses.',
        ),
      ).toBeTruthy();
    });
  });
});
