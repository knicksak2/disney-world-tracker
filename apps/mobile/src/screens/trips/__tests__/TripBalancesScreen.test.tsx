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
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';
import { BALANCES } from '../TripBalancesScreen.palette';

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

  describe('dark mode', () => {
    const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
    /** Nearest host ancestor whose flattened style sets `key`. */
    function ancestorWith(node: ReactTestInstance, key: string): Record<string, unknown> {
      let cur: ReactTestInstance | null = node.parent;
      while (cur !== null) {
        if (typeof cur.type === 'string' && flat(cur)[key] !== undefined) {
          return flat(cur);
        }
        cur = cur.parent;
      }
      return {};
    }

    afterEach(resetTestScheme);

    it('(a)(b)(c) paints the screen, primary text and converted balance elements with dark values', async () => {
      setTestScheme('dark');
      renderScreen();

      const toggle = await screen.findByTestId('balances-view-toggle');
      await waitFor(() => expect(screen.getByTestId(`net-balance-amount-${USER_1}`)).toBeTruthy());
      // (a) the screen background behind the toggle bar.
      expect(ancestorWith(toggle, 'backgroundColor').backgroundColor).toBe(
        darkTheme.color.background,
      );
      // (c) converted literals: the toggle track (#f1f5f9), the "owed" amount
      // (#15803d) and the violet "Record a Settlement" fill (#7c3aed).
      expect(flat(toggle).backgroundColor).toBe(BALANCES.dark.toggleTrack);
      expect(flat(screen.getByTestId(`net-balance-amount-${USER_1}`)).color).toBe(
        BALANCES.dark.owedText,
      );
      expect(flat(screen.getByTestId('open-record-settlement-btn')).backgroundColor).toBe(
        BALANCES.dark.heroFill,
      );

      // (b) primary text: the pairwise debt amount.
      fireEvent.press(screen.getByTestId('toggle-pairwise-balances'));
      const amount = await screen.findByTestId('pairwise-amount-0');
      expect(flat(amount).color).toBe(darkTheme.color.textPrimary);
    });

    it('opens the SettlementModal sheet on the dark surface with a themed selected chip', async () => {
      setTestScheme('dark');
      renderScreen();

      fireEvent.press(await screen.findByTestId('open-record-settlement-btn'));
      const sheet = await screen.findByTestId('settlement-modal');
      expect(flat(sheet).backgroundColor).toBe(darkTheme.color.surface);
      // The selected payer chip is a primary fill with white text.
      const chip = screen.getByTestId(`settlement-payer-chip-${USER_1}`);
      expect(flat(chip).backgroundColor).toBe(darkTheme.color.primary);
      expect(flat(within(chip).getByText('Ariel')).color).toBe(darkTheme.color.textOnPrimary);
      expect(screen.getByTestId('settlement-amount-input').props.keyboardAppearance).toBe('dark');
    });

    // Feature: dark-mode polish pass (Requirement 9.12): active toggle reads stronger than idle.
    it('Net/Pairwise toggle: the active pill is raised and its label is textPrimary', async () => {
      setTestScheme('dark');
      renderScreen();
      await screen.findByTestId('balances-view-toggle');

      const net = () => flat(screen.getByTestId('toggle-net-balances'));
      const pairwise = () => flat(screen.getByTestId('toggle-pairwise-balances'));
      const netLabel = () => flat(screen.getByText('Net Balances')).color;
      const pairwiseLabel = () => flat(screen.getByText('Pairwise Debts')).color;

      expect(net().backgroundColor).toBe(darkTheme.color.borderStrong);
      expect(net().backgroundColor).not.toBe(BALANCES.dark.toggleTrack);
      expect(pairwise().backgroundColor).toBeUndefined();
      expect(netLabel()).toBe(darkTheme.color.textPrimary);
      expect(pairwiseLabel()).toBe(darkTheme.color.textSecondary);
      expect(netLabel()).not.toBe(pairwiseLabel());

      fireEvent.press(screen.getByTestId('toggle-pairwise-balances'));
      await waitFor(() => expect(pairwise().backgroundColor).toBe(darkTheme.color.borderStrong));
      expect(net().backgroundColor).toBeUndefined();
      expect(pairwiseLabel()).toBe(darkTheme.color.textPrimary);
      expect(netLabel()).toBe(darkTheme.color.textSecondary);
    });

    it('light: the active toggle keeps today\'s white pill and #1e1b4b label', async () => {
      setTestScheme('light');
      renderScreen();
      await screen.findByTestId('balances-view-toggle');
      expect(flat(screen.getByTestId('toggle-net-balances')).backgroundColor).toBe('#ffffff');
      expect(flat(screen.getByText('Net Balances')).color).toBe('#1e1b4b');
    });
  });
});

