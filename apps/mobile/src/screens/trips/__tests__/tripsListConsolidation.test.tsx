/**
 * Trips-list consolidation example test (task 15.4).
 *
 * Validates: Requirements 7.5
 *
 * The Notification_Center is now the single in-app surface for acting on
 * pending Trip_Invites. Task 15.2 removed the invitations actionable section
 * from `TripsListScreen`, and with it the `GET /me/trip-invites` read the
 * screen previously issued — the screen now reads only `GET /me/trips`.
 *
 * This test renders the real `TripsStack` inside a `NavigationContainer`
 * (mirroring `TripsListScreen.test.tsx`) with a `GET /me/trips` response that
 * carries a trip, and asserts:
 *   1. No invitation Accept/Decline controls render (no `trips-invite-*`
 *      testIDs, no Accept/Decline copy).
 *   2. The invites read is gone: `apiRequest` is never called with
 *      `/me/trip-invites`.
 *   3. The trip list itself still renders.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';

import type { TripDTO } from '@dwt/shared';

// ---------------------------------------------------------------------------
// Mocks (declared before the modules under test are imported).
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
// Imports of modules under test (after the mocks above).
// ---------------------------------------------------------------------------

import TripsStack from '../../../navigation/TripsStack';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { clearTripsListNotice } from '../../../navigation/tripsListNotice';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const ACTIVE_TRIP: TripDTO = {
  id: 'trip-active-1',
  name: 'Spring Break at WDW',
  description: '',
  startDate: '2024-05-01',
  endDate: '2024-05-05',
  status: 'active',
  createdAt: '2024-04-01T12:00:00Z',
  resorts: [],
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderTripsStack(): void {
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <NavigationContainer>
        <TripsStack />
      </NavigationContainer>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Trips list consolidation — no invitations actionable section (R7.5)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    clearTripsListNotice();
    apiRequestMock.mockImplementation(async (_method, path) => {
      if (path === '/me/trips') {
        return [{ status: 'active', trips: [ACTIVE_TRIP] }] as never;
      }
      if (path === '/resorts') {
        return { resorts: [] } as never;
      }
      throw new Error(`unexpected call to ${String(path)}`);
    });
  });

  test('renders the trips list without invitation Accept/Decline controls', async () => {
    renderTripsStack();

    // The trip list itself still renders.
    expect(
      await screen.findByTestId(`trips-trip-${ACTIVE_TRIP.id}`),
    ).toBeTruthy();

    // No invitation actionable controls render.
    expect(screen.queryByTestId('trips-invites')).toBeNull();
    expect(screen.queryByText('Accept')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
  });

  test('no longer issues the trip-invites read', async () => {
    renderTripsStack();

    await waitFor(() => {
      expect(screen.getByTestId(`trips-trip-${ACTIVE_TRIP.id}`)).toBeTruthy();
    });

    // The invitations section (and its read) is gone: the screen never calls
    // the invites endpoint.
    const calledInvites = apiRequestMock.mock.calls.some(
      ([, path]) => path === '/me/trip-invites',
    );
    expect(calledInvites).toBe(false);
  });
});
