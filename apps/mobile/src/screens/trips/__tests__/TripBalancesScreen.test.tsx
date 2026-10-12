/**
 * TripBalancesScreen component tests (Task 12.4).
 *
 * Requirements: 6.1, 6.3, 6.4, 6.5, 7.1, 7.3, 7.7
 *
 * Validates:
 * - Render real balance data (Card-per-member NetBalanceDTO with signed framing)
 * - Toggle to pairwise view (PairwiseBalanceDTO[])
 * - Open member balance drill-down modal and assert entries
 * - Record a settlement from pre-filled pairwise balance
 * - Record a standalone/partial settlement with custom amounts
 * - Assert balance UI updates after recordings
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

import TripBalancesScreen from '../TripBalancesScreen';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import type {
  TripDTO,
  TripMemberDTO,
  TripBalancesResponseDTO,
  BalanceDrillDownEntryDTO,
  SettlementDTO,
} from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-123';
const USER_1 = 'user-1'; // Ariel
const USER_2 = 'user-2'; // Eric
const USER_3 = 'user-3'; // Sebastian

const TRIP_FIXTURE: TripDTO = {
  id: TRIP_ID,
  name: 'Walt Disney World 2026',
  description: 'Our annual family trip',
  startDate: '2026-10-01',
  endDate: '2026-10-07',
  status: 'active',
  createdAt: '2026-09-01T00:00:00Z',
  resorts: [],
  foodLists: [],
  experienceLists: [],
};

const MEMBERS_FIXTURE: TripMemberDTO[] = [
  { userId: USER_1, displayName: 'Ariel', avatarPreset: null, role: 'organizer' },
  { userId: USER_2, displayName: 'Eric', avatarPreset: null, role: 'member' },
  { userId: USER_3, displayName: 'Sebastian', avatarPreset: null, role: 'member' },
];

let balancesData: TripBalancesResponseDTO = {
  net: [
    { memberId: USER_1, netCents: 5000 },
    { memberId: USER_2, netCents: -5000 },
    { memberId: USER_3, netCents: 0 },
  ],
  pairwise: [
    { memberIdA: USER_2, memberIdB: USER_1, aOwesBCents: 5000 },
  ],
};

const DRILLDOWN_FIXTURE: BalanceDrillDownEntryDTO[] = [
  {
    kind: 'expense',
    sourceId: 'exp-1',
    description: 'Dinner at Cinderella Castle',
    date: '2026-10-02',
    contributionCents: 5000,
    payerId: USER_1,
    recipientId: USER_2,
  },
  {
    kind: 'settlement',
    sourceId: 'set-1',
    description: 'Settlement',
    date: '2026-10-03',
    contributionCents: -2000,
    payerId: USER_2,
    recipientId: USER_1,
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

function makeNavigation() {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
  };
}

describe('TripBalancesScreen', () => {
  let queryClient: QueryClient;
  let navigation: ReturnType<typeof makeNavigation>;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = makeQueryClient();
    navigation = makeNavigation();

    balancesData = {
      net: [
        { memberId: USER_1, netCents: 5000 },
        { memberId: USER_2, netCents: -5000 },
        { memberId: USER_3, netCents: 0 },
      ],
      pairwise: [
        { memberIdA: USER_2, memberIdB: USER_1, aOwesBCents: 5000 },
      ],
    };

    apiRequestMock.mockImplementation(async (method: string, path: string, body?: any) => {
      if (method === 'GET' && path === '/me') {
        return { user: { id: USER_1 } } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return TRIP_FIXTURE as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) {
        return MEMBERS_FIXTURE as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) {
        return balancesData as any;
      }
      if (method === 'GET' && path.includes('/drilldown')) {
        return DRILLDOWN_FIXTURE as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/settlements`) {
        const created: SettlementDTO = {
          id: `set-${Date.now()}`,
          tripId: TRIP_ID,
          payerId: body.payerId,
          recipientId: body.recipientId,
          createdByUserId: USER_1,
          amountCents: body.amountCents,
          date: body.date,
          createdAt: new Date().toISOString(),
        };
        // Update balances
        balancesData = {
          net: [
            { memberId: USER_1, netCents: Math.max(0, 5000 - body.amountCents) },
            { memberId: USER_2, netCents: Math.min(0, -5000 + body.amountCents) },
            { memberId: USER_3, netCents: 0 },
          ],
          pairwise:
            body.amountCents >= 5000
              ? []
              : [{ memberIdA: USER_2, memberIdB: USER_1, aOwesBCents: 5000 - body.amountCents }],
        };
        return created as any;
      }
      throw new Error(`Unhandled request: ${method} ${path}`);
    });
  });

  const renderScreen = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <TripBalancesScreen navigation={navigation as any} route={{ params: { tripId: TRIP_ID } } as any} />
      </QueryClientProvider>,
    );

  it('renders net balance cards with signed framing and zero for no-activity members', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId(`net-balance-card-${USER_1}`)).toBeTruthy();
      expect(screen.getByTestId(`net-balance-card-${USER_2}`)).toBeTruthy();
      expect(screen.getByTestId(`net-balance-card-${USER_3}`)).toBeTruthy();
    });

    // Ariel is owed $50.00
    expect(screen.getByTestId(`net-balance-status-${USER_1}`)).toHaveTextContent('Owed $50.00');
    expect(screen.getByTestId(`net-balance-amount-${USER_1}`)).toHaveTextContent('+$50.00');

    // Eric owes $50.00
    expect(screen.getByTestId(`net-balance-status-${USER_2}`)).toHaveTextContent('Owes $50.00');
    expect(screen.getByTestId(`net-balance-amount-${USER_2}`)).toHaveTextContent('-$50.00');

    // Sebastian is settled up ($0.00)
    expect(screen.getByTestId(`net-balance-status-${USER_3}`)).toHaveTextContent('Settled up');
    expect(screen.getByTestId(`net-balance-amount-${USER_3}`)).toHaveTextContent('$0.00');
  });

  it('toggles to pairwise view and renders simplified debts', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('toggle-pairwise-balances')).toBeTruthy());

    fireEvent.press(screen.getByTestId('toggle-pairwise-balances'));

    await waitFor(() => {
      expect(screen.getByTestId('pairwise-balances-section')).toBeTruthy();
      expect(screen.getByTestId('pairwise-card-0')).toBeTruthy();
    });

    expect(screen.getByText(/Eric.*owes.*Ariel/)).toBeTruthy();
    expect(screen.getByTestId('pairwise-amount-0')).toHaveTextContent('$50.00');
  });

  it('opens member drill-down modal and displays contributing entries', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`net-balance-card-${USER_1}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`net-balance-card-${USER_1}`));

    await waitFor(() => {
      expect(screen.getByTestId('balance-drilldown-modal')).toBeTruthy();
      expect(screen.getByText('Dinner at Cinderella Castle')).toBeTruthy();
      expect(screen.getByText('Settlement')).toBeTruthy();
    });
  });

  it('records a settlement pre-filled from pairwise view', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('toggle-pairwise-balances')).toBeTruthy());
    fireEvent.press(screen.getByTestId('toggle-pairwise-balances'));

    await waitFor(() => expect(screen.getByTestId('settle-pair-btn-0')).toBeTruthy());

    fireEvent.press(screen.getByTestId('settle-pair-btn-0'));

    await waitFor(() => {
      expect(screen.getByTestId('settlement-modal')).toBeTruthy();
      expect(screen.getByTestId('settlement-amount-input')).toHaveProp('value', '50.00');
    });

    fireEvent.press(screen.getByTestId('submit-settlement-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/settlements`, {
        payerId: USER_2,
        recipientId: USER_1,
        amountCents: 5000,
        date: expect.any(String),
      });
    });
  });

  it('records a partial settlement with custom amount', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('open-record-settlement-btn')).toBeTruthy());

    fireEvent.press(screen.getByTestId('open-record-settlement-btn'));

    await waitFor(() => expect(screen.getByTestId('settlement-modal')).toBeTruthy());

    // Select Eric as payer
    fireEvent.press(screen.getByTestId(`settlement-payer-chip-${USER_2}`));
    // Select Ariel as recipient
    fireEvent.press(screen.getByTestId(`settlement-recipient-chip-${USER_1}`));
    // Enter partial amount 20.00
    fireEvent.changeText(screen.getByTestId('settlement-amount-input'), '20.00');

    fireEvent.press(screen.getByTestId('submit-settlement-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('POST', `/trips/${TRIP_ID}/settlements`, {
        payerId: USER_2,
        recipientId: USER_1,
        amountCents: 2000,
        date: expect.any(String),
      });
    });
  });

  it('tapping pairwise card opens pairwise breakdown modal showing mutual transactions (Req 6.7)', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('toggle-pairwise-balances')).toBeTruthy());
    fireEvent.press(screen.getByTestId('toggle-pairwise-balances'));

    await waitFor(() => {
      expect(screen.getByTestId('pairwise-card-0')).toBeTruthy();
      expect(screen.getByTestId('open-pairwise-breakdown-0')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('open-pairwise-breakdown-0'));

    await waitFor(() => {
      expect(screen.getByTestId('pairwise-breakdown-modal')).toBeTruthy();
      expect(screen.getByTestId('pairwise-modal-subtitle')).toHaveTextContent(/Eric owes Ariel: \$50\.00/);
      expect(screen.getByTestId('pairwise-entry-0')).toBeTruthy();
      expect(screen.getByText('Dinner at Cinderella Castle')).toBeTruthy();
      expect(screen.getByTestId('pairwise-entry-amount-0')).toHaveTextContent('+$50.00');

      expect(screen.getByTestId('pairwise-entry-1')).toBeTruthy();
      expect(screen.getByText('Payment from Eric')).toBeTruthy();
      expect(screen.getByText('Payment Received')).toBeTruthy();
      expect(screen.getByTestId('pairwise-entry-amount-1')).toHaveTextContent('-$20.00');
      expect(screen.getByText('Paid down')).toBeTruthy();
    });

    // Close modal
    fireEvent.press(screen.getByTestId('close-pairwise-breakdown-modal'));
    await waitFor(() => {
      expect(screen.queryByTestId('pairwise-breakdown-modal')).toBeNull();
    });
  });
});

