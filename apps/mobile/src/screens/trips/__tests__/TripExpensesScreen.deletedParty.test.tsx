/**
 * Money screens with a deleted party (account-deletion R12.10, R6.4; tasks.md 14.4).
 *
 * Real `TripExpensesScreen`, `ExpenseFormModal`, `SettlementModal` and
 * `TripBalancesScreen`; only `apiRequest` is mocked. The deleted party's id is a
 * real `generatePlaceholderId` output.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type {
  ExpenseDTO,
  SettlementDTO,
  TripBalancesResponseDTO,
  TripDTO,
  TripMemberDTO,
} from '@dwt/shared';

import { generatePlaceholderId } from '../../../../../api/src/services/accountDeletion/placeholderId';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn(), apiFetchText: jest.fn() };
});

jest.mock('../receiptScan.native', () => ({
  scanReceiptPhoto: jest.fn(),
  isNativeOcrAvailable: jest.fn(() => true),
}));

import TripExpensesScreen from '../TripExpensesScreen';
import TripBalancesScreen from '../TripBalancesScreen';
import { TRIP_PARTY_DELETED_MESSAGE } from '../tripPartyDeleted';
import { ApiError, apiRequest as mockedApiRequest } from '../../../api/client';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;

const TRIP_ID = 'trip-123';
const USER_1 = 'user-1'; // Ariel, the caller
const USER_2 = 'user-2'; // Eric
const DELETED = generatePlaceholderId(() => new Uint8Array(16).map((_, i) => (i * 41 + 5) % 256));

const TRIP: TripDTO = {
  id: TRIP_ID,
  name: 'Walt Disney World 2026',
  description: '',
  startDate: '2026-10-01',
  endDate: '2026-10-07',
  status: 'upcoming',
  createdAt: '2026-09-01T00:00:00Z',
  resorts: [],
  foodLists: [],
  experienceLists: [],
};

// The roster omits the deleted person (OMIT surface); they only appear as a party in the data.
const MEMBERS: TripMemberDTO[] = [
  { userId: USER_1, displayName: 'Ariel', avatarPreset: null, role: 'organizer' },
  { userId: USER_2, displayName: 'Eric', avatarPreset: null, role: 'member' },
];

const EXPENSE_FROM_DELETED: ExpenseDTO = {
  id: 'exp-del',
  tripId: TRIP_ID,
  payerId: DELETED,
  createdByUserId: USER_1,
  description: 'Dinner paid by someone who left',
  amountCents: 12000,
  date: '2026-10-02',
  category: 'dining',
  splitMode: 'even',
  experienceId: null,
  resortId: null,
  shares: [
    { id: 'sh-1', expenseId: 'exp-del', memberId: USER_2, guestId: null, amountCents: 6000 },
  ],
  tiers: [],
  items: [],
  chargeLines: [],
  refunds: [],
  createdAt: '2026-10-02T19:00:00Z',
};

const SETTLEMENT_WITH_DELETED: SettlementDTO = {
  id: 'set-del',
  tripId: TRIP_ID,
  payerId: USER_1,
  recipientId: DELETED,
  createdByUserId: USER_1,
  amountCents: 2000,
  date: '2026-10-03',
  createdAt: '2026-10-03T10:00:00Z',
};

// Pair 0 involves the deleted person; pair 1 is two ordinary members.
const BALANCES: TripBalancesResponseDTO = {
  net: [
    { memberId: USER_1, netCents: 4000 },
    { memberId: DELETED, netCents: -3000 },
    { memberId: USER_2, netCents: -1000 },
  ],
  pairwise: [
    { memberIdA: DELETED, memberIdB: USER_1, aOwesBCents: 3000 },
    { memberIdA: USER_2, memberIdB: USER_1, aOwesBCents: 1000 },
  ],
};

interface Overrides {
  createExpense?: () => Promise<unknown>;
  editExpense?: () => Promise<unknown>;
  createSettlement?: () => Promise<unknown>;
}

function installApi(overrides: Overrides = {}): void {
  apiRequestMock.mockImplementation((async (method: string, path: string) => {
    if (method === 'GET' && path === '/me') return { user: { id: USER_1 } };
    if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP;
    if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS;
    if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return [];
    if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) {
      return [EXPENSE_FROM_DELETED, SETTLEMENT_WITH_DELETED];
    }
    if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) return BALANCES;
    if (method === 'GET' && path.includes('/drilldown')) return [];
    if (method === 'POST' && path === `/trips/${TRIP_ID}/expenses`) {
      return (overrides.createExpense ?? (async () => ({})))();
    }
    if (method === 'PATCH' && path === `/trips/${TRIP_ID}/expenses/exp-del`) {
      return (overrides.editExpense ?? (async () => ({})))();
    }
    if (method === 'POST' && path === `/trips/${TRIP_ID}/settlements`) {
      return (overrides.createSettlement ?? (async () => ({})))();
    }
    if (method === 'DELETE') return null;
    throw new Error(`Unhandled request: ${method} ${path}`);
  }) as never);
}

function partyDeletedError(): ApiError {
  return new ApiError({
    code: 'trip_party_deleted',
    message: 'Server wording that must not be shown.',
    status: 409,
  });
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
}

function renderExpenses() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
  return render(
    <QueryClientProvider client={makeClient()}>
      <TripExpensesScreen
        navigation={navigation as never}
        route={{ params: { tripId: TRIP_ID } } as never}
      />
    </QueryClientProvider>,
  );
}

function renderBalances() {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  return render(
    <QueryClientProvider client={makeClient()}>
      <TripBalancesScreen
        navigation={navigation as never}
        route={{ params: { tripId: TRIP_ID } } as never}
      />
    </QueryClientProvider>,
  );
}

function callsMatching(method: string, path: string): unknown[][] {
  return apiRequestMock.mock.calls.filter((c) => c[0] === method && c[1] === path);
}

describe('trip_party_deleted copy (R12.10)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  it('the copy is exactly the specified sentence', () => {
    expect(TRIP_PARTY_DELETED_MESSAGE).toBe(
      "This entry involves someone who deleted their account, so it can't be changed. You can still delete it.",
    );
  });

  it('creating an expense that the server rejects with trip_party_deleted shows the copy, not the server text, and keeps the form open', async () => {
    installApi({
      createExpense: async () => {
        throw partyDeletedError();
      },
    });
    renderExpenses();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());
    fireEvent.press(screen.getByTestId('split-mode-chip-even'));
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Snacks');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '60.00');
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    const box = await screen.findByTestId('expense-form-error');
    expect(box).toHaveTextContent(TRIP_PARTY_DELETED_MESSAGE);
    expect(screen.queryByText('Server wording that must not be shown.')).toBeNull();
    expect(callsMatching('POST', `/trips/${TRIP_ID}/expenses`)).toHaveLength(1);
    expect(screen.getByTestId('expense-form-modal')).toBeTruthy();
  });

  it('editing an expense whose stored parties include a deleted person shows the copy', async () => {
    installApi({
      editExpense: async () => {
        throw partyDeletedError();
      },
    });
    renderExpenses();
    await waitFor(() => expect(screen.getByTestId('edit-expense-exp-del')).toBeTruthy());

    fireEvent.press(screen.getByTestId('edit-expense-exp-del'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Renamed');
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    expect(await screen.findByTestId('expense-form-error')).toHaveTextContent(
      TRIP_PARTY_DELETED_MESSAGE,
    );
    expect(callsMatching('PATCH', `/trips/${TRIP_ID}/expenses/exp-del`)).toHaveLength(1);
  });

  it('control: any other server error still shows the server message', async () => {
    installApi({
      createExpense: async () => {
        throw new ApiError({ code: 'internal_error', message: 'Boom from server.', status: 500 });
      },
    });
    renderExpenses();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());
    fireEvent.press(screen.getByTestId('split-mode-chip-even'));
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Snacks');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '60.00');
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    expect(await screen.findByTestId('expense-form-error')).toHaveTextContent('Boom from server.');
  });

  it('recording a settlement that the server rejects with trip_party_deleted shows the copy', async () => {
    installApi({
      createSettlement: async () => {
        throw partyDeletedError();
      },
    });
    renderBalances();
    await waitFor(() => expect(screen.getByTestId('open-record-settlement-btn')).toBeTruthy());

    fireEvent.press(screen.getByTestId('open-record-settlement-btn'));
    await waitFor(() => expect(screen.getByTestId('settlement-modal')).toBeTruthy());
    fireEvent.press(screen.getByTestId(`settlement-payer-chip-${USER_2}`));
    fireEvent.press(screen.getByTestId(`settlement-recipient-chip-${USER_1}`));
    fireEvent.changeText(screen.getByTestId('settlement-amount-input'), '25.00');
    fireEvent.press(screen.getByTestId('submit-settlement-button'));

    expect(await screen.findByTestId('settlement-error-box')).toHaveTextContent(
      TRIP_PARTY_DELETED_MESSAGE,
    );
    expect(callsMatching('POST', `/trips/${TRIP_ID}/settlements`)[0]).toEqual([
      'POST',
      `/trips/${TRIP_ID}/settlements`,
      { payerId: USER_2, recipientId: USER_1, amountCents: 2500, date: expect.any(String) },
    ]);
  });

  it('deleting an entry that involves a deleted person is still offered and calls DELETE', async () => {
    installApi();
    renderExpenses();
    await waitFor(() => expect(screen.getByTestId('delete-expense-exp-del')).toBeTruthy());

    fireEvent.press(screen.getByTestId('delete-expense-exp-del'));

    await waitFor(() => {
      expect(callsMatching('DELETE', `/trips/${TRIP_ID}/expenses/exp-del`)).toHaveLength(1);
    });
  });
});

describe('settle control against a deleted party (R6.4, design Money table)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    installApi();
  });

  describe('Expenses screen, Who owes what', () => {
    async function openWhoOwesWhat(): Promise<void> {
      renderExpenses();
      await waitFor(() => expect(screen.getByTestId('tab-balances-btn')).toBeTruthy());
      fireEvent.press(screen.getByTestId('tab-balances-btn'));
      await waitFor(() => expect(screen.getByTestId('pairwise-card-0')).toBeTruthy());
    }

    it('the row against the deleted person is labelled "Deleted user" and has NO Settle button; the ordinary row keeps it', async () => {
      await openWhoOwesWhat();

      expect(screen.queryByTestId('settle-pair-btn-0')).toBeNull();
      expect(screen.getByTestId('settle-pair-btn-1')).toBeTruthy();
      expect(screen.getByTestId('open-pairwise-breakdown-0').props.accessibilityLabel).toBe(
        'View mutual breakdown between Deleted user and Ariel',
      );
    });

    it('the pairwise breakdown for the deleted person offers no "Log Payment"; the ordinary one does', async () => {
      await openWhoOwesWhat();

      fireEvent.press(screen.getByTestId('open-pairwise-breakdown-0'));
      await waitFor(() => expect(screen.getByTestId('pairwise-breakdown-modal')).toBeTruthy());
      expect(screen.queryByTestId('pairwise-modal-settle-btn')).toBeNull();

      fireEvent.press(screen.getByTestId('close-pairwise-breakdown-modal'));
      await waitFor(() => expect(screen.queryByTestId('pairwise-breakdown-modal')).toBeNull());

      fireEvent.press(screen.getByTestId('open-pairwise-breakdown-1'));
      await waitFor(() => expect(screen.getByTestId('pairwise-modal-settle-btn')).toBeTruthy());
    });
  });

  describe('Balances screen', () => {
    async function openPairwise(): Promise<void> {
      renderBalances();
      await waitFor(() => expect(screen.getByTestId('toggle-pairwise-balances')).toBeTruthy());
      fireEvent.press(screen.getByTestId('toggle-pairwise-balances'));
      await waitFor(() => expect(screen.getByTestId('pairwise-card-0')).toBeTruthy());
    }

    it('names the deleted person on the net balance card', async () => {
      renderBalances();
      const card = await screen.findByTestId(`net-balance-card-${DELETED}`);
      expect(within(card).getByText('Deleted user')).toBeTruthy();
      // The card is a regular balance row: the amount is still shown.
      expect(screen.getByTestId(`net-balance-amount-${DELETED}`)).toHaveTextContent('-$30.00');
    });

    it('the pairwise row against the deleted person has NO Settle button; the ordinary row keeps it', async () => {
      await openPairwise();

      expect(screen.queryByTestId('settle-pair-btn-0')).toBeNull();
      expect(screen.getByTestId('settle-pair-btn-1')).toBeTruthy();
      expect(screen.getByText(/Deleted user.*owes.*Ariel/)).toBeTruthy();
    });

    it('the pairwise breakdown for the deleted person offers no "Log Payment"; the ordinary one does', async () => {
      await openPairwise();

      fireEvent.press(screen.getByTestId('open-pairwise-breakdown-0'));
      await waitFor(() => expect(screen.getByTestId('pairwise-breakdown-modal')).toBeTruthy());
      expect(screen.queryByTestId('pairwise-modal-settle-btn')).toBeNull();

      fireEvent.press(screen.getByTestId('close-pairwise-breakdown-modal'));
      await waitFor(() => expect(screen.queryByTestId('pairwise-breakdown-modal')).toBeNull());

      fireEvent.press(screen.getByTestId('open-pairwise-breakdown-1'));
      await waitFor(() => expect(screen.getByTestId('pairwise-modal-settle-btn')).toBeTruthy());
    });
  });
});
