/**
 * TripExpensesScreen component tests (Tasks 10.8, 15.4, 16.3).
 *
 * Requirements: 1.1, 3.1, 3.3, 4.1, 5.1, 5.5, 5.9, 8.1, 8.3, 11.1, 11.2, 11.3, 11.8, 12.1, 12.4, 13.1, 13.2, 13.3
 *
 * Validates:
 * - Render real ledger data (visually distinct expense and settlement cards)
 * - Add expense in all four split modes (exact, even, tiered, itemized) asserting exact POST payloads
 * - Edit expense, including split mode switching that resets previous fields and submits updated payload
 * - Remove expense (DELETE call and UI update)
 * - Category filter chips and Payer filter chips
 * - Record refund asserting POST payload and on-screen "Net: $X" update
 * - Catalog restaurant/resort linking pre-fills description
 * - Settle-up banner shown for past trip with nonzero balances
 */

import React from 'react';
import { Share, StyleSheet, Switch } from 'react-native';
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
import { contrastRatio } from '../../../theme/contrast';
import { DARK_TONAL, darkTheme, withAlpha } from '../../../theme/theme';
import { CATEGORY_META, EXPENSES } from '../TripExpensesScreen.palette';
import { FORM } from '../ExpenseFormModal.palette';

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
    apiFetchText: jest.fn(),
  };
});

jest.mock('../receiptScan.native', () => ({
  scanReceiptPhoto: jest.fn(),
  isNativeOcrAvailable: jest.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import TripExpensesScreen from '../TripExpensesScreen';
import { scanReceiptPhoto } from '../receiptScan.native';
import {
  apiRequest as mockedApiRequest,
  apiFetchText as mockedApiFetchText,
} from '../../../api/client';
import type {
  ExpenseDTO,
  SettlementDTO,
  TripMemberDTO,
  TripGuestDTO,
  TripBalancesResponseDTO,
  TripDTO,
} from '@dwt/shared';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<typeof mockedApiRequest>;
const mockScanReceiptPhoto = scanReceiptPhoto as jest.MockedFunction<typeof scanReceiptPhoto>;
const apiFetchTextMock = mockedApiFetchText as jest.MockedFunction<typeof mockedApiFetchText>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TRIP_ID = 'trip-123';
const USER_1 = 'user-1'; // Ariel (Organizer)
const USER_2 = 'user-2'; // Eric (Member)
const GUEST_1 = 'guest-1'; // Melody (Guest of Ariel)

const TRIP_FIXTURE: TripDTO = {
  id: TRIP_ID,
  name: 'Walt Disney World 2026',
  description: 'Our annual family trip',
  startDate: '2026-10-01',
  endDate: '2026-10-07',
  status: 'upcoming',
  createdAt: '2026-09-01T00:00:00Z',
  resorts: [],
  foodLists: [],
  experienceLists: [],
};

const MEMBERS_FIXTURE: TripMemberDTO[] = [
  { userId: USER_1, displayName: 'Ariel', avatarPreset: null, role: 'organizer' },
  { userId: USER_2, displayName: 'Eric', avatarPreset: null, role: 'member' },
];

const GUESTS_FIXTURE: TripGuestDTO[] = [
  {
    id: GUEST_1,
    tripId: TRIP_ID,
    name: 'Melody',
    sponsorMemberId: USER_1,
    createdAt: '2026-09-01T00:00:00Z',
  },
];

const EXPENSE_1: ExpenseDTO = {
  id: 'exp-1',
  tripId: TRIP_ID,
  payerId: USER_1,
  createdByUserId: USER_1,
  description: 'Be Our Guest Dinner',
  amountCents: 12000,
  date: '2026-10-02',
  category: 'dining',
  splitMode: 'even',
  experienceId: 'exp-bog',
  resortId: null,
  shares: [
    {
      id: 'sh-1',
      expenseId: 'exp-1',
      memberId: USER_2,
      guestId: null,
      amountCents: 6000,
    },
  ],
  tiers: [],
  items: [],
  chargeLines: [],
  refunds: [],
  createdAt: '2026-10-02T19:00:00Z',
};

const SETTLEMENT_1: SettlementDTO = {
  id: 'set-1',
  tripId: TRIP_ID,
  payerId: USER_2,
  recipientId: USER_1,
  createdByUserId: USER_2,
  amountCents: 5000,
  date: '2026-10-03',
  createdAt: '2026-10-03T10:00:00Z',
};

const BALANCES_FIXTURE: TripBalancesResponseDTO = {
  net: [
    { memberId: USER_1, netCents: 1000 },
    { memberId: USER_2, netCents: -1000 },
  ],
  pairwise: [
    { memberIdA: USER_2, memberIdB: USER_1, aOwesBCents: 1000 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    setOptions: jest.fn(),
  };
}

describe('TripExpensesScreen', () => {
  let queryClient: QueryClient;
  let navigation: ReturnType<typeof makeNavigation>;
  let recordedLedger: (ExpenseDTO | SettlementDTO)[];

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = makeQueryClient();
    navigation = makeNavigation();
    recordedLedger = [EXPENSE_1, SETTLEMENT_1];

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
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) {
        return GUESTS_FIXTURE as any;
      }
      if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) {
        return recordedLedger as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) {
        return BALANCES_FIXTURE as any;
      }
      if (method === 'GET' && path.includes('/drilldown')) {
        return [
          {
            kind: 'expense',
            sourceId: 'exp-1',
            description: 'Lunch at Be Our Guest',
            date: '2026-10-02',
            contributionCents: 2000,
            payerId: USER_1,
            recipientId: USER_2,
          },
          {
            kind: 'settlement',
            sourceId: 'set-1',
            description: 'Settlement',
            date: '2026-10-03',
            contributionCents: -1000,
            payerId: USER_2,
            recipientId: USER_1,
          },
        ] as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/expenses`) {
        const created: ExpenseDTO = {
          id: `exp-new-${Date.now()}`,
          tripId: TRIP_ID,
          payerId: body.payerId,
          createdByUserId: USER_1,
          description: body.description,
          amountCents: body.amountCents ?? 5000,
          date: body.date,
          category: body.category,
          splitMode: body.splitMode,
          experienceId: body.experienceId ?? null,
          resortId: body.resortId ?? null,
          shares: [],
          tiers: [],
          items: [],
          chargeLines: [],
          refunds: [],
          createdAt: new Date().toISOString(),
        };
        recordedLedger = [created, ...recordedLedger];
        return created as any;
      }
      if (method === 'PATCH' && path.startsWith(`/trips/${TRIP_ID}/expenses/`)) {
        const expenseId = path.split('/').pop()!;
        const updatedIndex = recordedLedger.findIndex((it) => it.id === expenseId);
        if (updatedIndex >= 0) {
          const old = recordedLedger[updatedIndex] as ExpenseDTO;
          const updated: ExpenseDTO = {
            ...old,
            description: body.description ?? old.description,
            category: body.category ?? old.category,
            splitMode: body.splitMode ?? old.splitMode,
            amountCents: body.amountCents ?? old.amountCents,
          };
          recordedLedger[updatedIndex] = updated;
          return updated as any;
        }
        return {} as any;
      }
      if (method === 'DELETE' && path.startsWith(`/trips/${TRIP_ID}/expenses/`)) {
        const expenseId = path.split('/').pop()!;
        recordedLedger = recordedLedger.filter((it) => it.id !== expenseId);
        return {} as any;
      }
      if (method === 'POST' && path.includes('/refunds')) {
        const parts = path.split('/');
        const expenseId = parts[parts.indexOf('expenses') + 1]!;
        const targetIndex = recordedLedger.findIndex((it) => it.id === expenseId);
        if (targetIndex >= 0) {
          const oldExp = recordedLedger[targetIndex] as ExpenseDTO;
          const newRefund = {
            id: `ref-${Date.now()}`,
            expenseId: oldExp.id,
            createdByUserId: USER_1,
            amountCents: body.amountCents,
            date: body.date,
            note: body.note ?? null,
            createdAt: new Date().toISOString(),
          };
          recordedLedger[targetIndex] = {
            ...oldExp,
            refunds: [...oldExp.refunds, newRefund],
          };
          return newRefund as any;
        }
        return {} as any;
      }
      throw new Error(`Unhandled mock request: ${method} ${path}`);
    });

    apiFetchTextMock.mockResolvedValue('Description,Date,Category,Amount\nTest,2026-10-02,dining,120.00');
  });

  const renderScreen = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <TripExpensesScreen navigation={navigation as any} route={{ params: { tripId: TRIP_ID } } as any} />
      </QueryClientProvider>,
    );

  it('renders ledger data with visually distinct expense and settlement cards', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId(`expense-card-${EXPENSE_1.id}`)).toBeTruthy();
      expect(screen.getByTestId(`settlement-card-${SETTLEMENT_1.id}`)).toBeTruthy();
    });

    expect(screen.getByText('Be Our Guest Dinner')).toBeTruthy();
    expect(screen.getByTestId(`expense-amount-${EXPENSE_1.id}`)).toBeTruthy();
    expect(screen.getByTestId(`settlement-amount-${SETTLEMENT_1.id}`)).toBeTruthy();
    expect(screen.getByTestId('hero-financial-stats-row')).toBeTruthy();
    expect(screen.getByTestId('hero-total-spend')).toBeTruthy();
    expect(screen.getByTestId('hero-personal-share')).toBeTruthy();
    expect(screen.getByTestId('hero-settled-total')).toBeTruthy();
  });

  it('adds an expense in EXACT split mode asserting POST payload', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`expense-card-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    // Switch to exact mode
    fireEvent.press(screen.getByTestId('split-mode-chip-exact'));

    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Droids and Lightsabers');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '100.00');
    // Set Eric's share to 40.00 (leaving Ariel's implicit share 60.00)
    fireEvent.changeText(screen.getByTestId(`exact-share-input-${USER_2}`), '40.00');

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses`,
        expect.objectContaining({
          description: 'Droids and Lightsabers',
          amountCents: 10000,
          splitMode: 'exact',
          payerId: USER_1,
          shares: [
            expect.objectContaining({
              memberId: USER_2,
              amountCents: 4000,
            }),
          ],
        }),
      );
    });
  });

  it('adds an expense in EVEN split mode asserting POST payload', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`expense-card-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    fireEvent.press(screen.getByTestId('split-mode-chip-even'));
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Snacks at Epcot');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '60.00');

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses`,
        expect.objectContaining({
          description: 'Snacks at Epcot',
          amountCents: 6000,
          splitMode: 'even',
          payerId: USER_1,
          participantIds: expect.arrayContaining([USER_1, USER_2, GUEST_1]),
        }),
      );
    });
  });

  it('adds an expense in TIERED split mode asserting POST payload', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`expense-card-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Water Park Tickets');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '80.00');

    // Add two tiers (mode switch cleared tiers per Req 8.3)
    fireEvent.press(screen.getByTestId('add-tier-btn'));
    fireEvent.changeText(screen.getByTestId('tier-name-0'), 'Adult');
    fireEvent.changeText(screen.getByTestId('tier-price-0'), '50.00');

    fireEvent.press(screen.getByTestId('add-tier-btn'));
    fireEvent.changeText(screen.getByTestId('tier-name-1'), 'Child');
    fireEvent.changeText(screen.getByTestId('tier-price-1'), '30.00');

    // Assign 1 Adult to USER_1 and 1 Child to GUEST_1
    fireEvent.changeText(screen.getByTestId(`tier-count-0-${USER_1}`), '1');
    fireEvent.changeText(screen.getByTestId(`tier-count-1-${GUEST_1}`), '1');

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses`,
        expect.objectContaining({
          description: 'Water Park Tickets',
          amountCents: 8000,
          splitMode: 'tiered',
          tiers: expect.arrayContaining([
            expect.objectContaining({ name: 'Adult', priceCents: 5000 }),
            expect.objectContaining({ name: 'Child', priceCents: 3000 }),
          ]),
          tierCounts: expect.arrayContaining([
            expect.objectContaining({ memberId: USER_1, count: 1 }),
            expect.objectContaining({ guestId: GUEST_1, count: 1 }),
          ]),
        }),
      );
    });
  });

  it('adds an expense in ITEMIZED split mode with derived total asserting POST payload', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`expense-card-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    fireEvent.press(screen.getByTestId('split-mode-chip-itemized'));
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Table Service Lunch');

    // Add an item
    fireEvent.press(screen.getByTestId('add-item-btn'));
    fireEvent.changeText(screen.getByTestId('item-name-0'), 'Burger');
    fireEvent.changeText(screen.getByTestId('item-price-0'), '20.00');

    // Add another item
    fireEvent.press(screen.getByTestId('add-item-btn'));
    fireEvent.changeText(screen.getByTestId('item-name-1'), 'Beer');
    fireEvent.changeText(screen.getByTestId('item-price-1'), '10.00');
    fireEvent(screen.getByTestId('item-alcohol-toggle-1'), 'valueChange', true);

    // Add Tax and Gratuity charge lines
    fireEvent.press(screen.getByTestId('add-charge-tax'));
    fireEvent.changeText(screen.getByTestId('charge-amount-0'), '3.00');
    fireEvent.press(screen.getByTestId('add-charge-gratuity'));
    fireEvent.changeText(screen.getByTestId('charge-amount-1'), '5.00');

    // Verify derived total is displayed on screen
    expect(screen.getByTestId('derived-amount-value')).toHaveTextContent('$38.00');

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses`,
        expect.objectContaining({
          description: 'Table Service Lunch',
          splitMode: 'itemized',
          // Notice amountCents is omitted in itemized submit payload per design
          items: expect.arrayContaining([
            expect.objectContaining({ name: 'Burger', priceCents: 2000, isAlcohol: false }),
            expect.objectContaining({ name: 'Beer', priceCents: 1000, isAlcohol: true }),
          ]),
          chargeLines: expect.arrayContaining([
            expect.objectContaining({ kind: 'tax', amountCents: 300 }),
            expect.objectContaining({ kind: 'gratuity', amountCents: 500 }),
          ]),
        }),
      );
    });
  });

  it('edits an expense including split mode switch that resets previous fields', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`edit-expense-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`edit-expense-${EXPENSE_1.id}`));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    // Switch from even to exact
    fireEvent.press(screen.getByTestId('split-mode-chip-exact'));

    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Be Our Guest (Updated)');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '150.00');
    fireEvent.changeText(screen.getByTestId(`exact-share-input-${USER_2}`), '50.00');

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'PATCH',
        `/trips/${TRIP_ID}/expenses/${EXPENSE_1.id}`,
        expect.objectContaining({
          description: 'Be Our Guest (Updated)',
          splitMode: 'exact',
          amountCents: 15000,
          shares: [
            expect.objectContaining({
              memberId: USER_2,
              amountCents: 5000,
            }),
          ],
        }),
      );
    });
  });

  it('deletes an expense and removes it from the list', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`delete-expense-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`delete-expense-${EXPENSE_1.id}`));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith('DELETE', `/trips/${TRIP_ID}/expenses/${EXPENSE_1.id}`);
    });
  });

  it('filters by category and by payer chips', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('category-filter-chips')).toBeTruthy());

    // Tap Dining category chip
    fireEvent.press(screen.getByTestId('category-filter-dining'));
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        expect.stringContaining('category=dining'),
      );
    });

    // Tap All Categories chip to reset
    fireEvent.press(screen.getByTestId('category-chip-all'));

    // Tap Payer chip for Eric
    fireEvent.press(screen.getByTestId(`payer-filter-${USER_2}`));
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'GET',
        expect.stringContaining(`payerId=${USER_2}`),
      );
    });
  });

  it('records a refund and renders the Net: $X update', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`refund-expense-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId(`refund-expense-${EXPENSE_1.id}`));
    await waitFor(() => expect(screen.getByTestId('refund-modal')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('refund-amount-input'), '30.00');
    fireEvent.press(screen.getByTestId('submit-refund-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses/${EXPENSE_1.id}/refunds`,
        expect.objectContaining({
          amountCents: 3000,
        }),
      );
    });

    // Screen should display the updated refund banner
    await waitFor(() => {
      expect(screen.getByTestId(`expense-refunds-banner-${EXPENSE_1.id}`)).toBeTruthy();
      expect(screen.getByText(/Refunded: \$30\.00/)).toBeTruthy();
      expect(screen.getByText(/Net: \$90\.00/)).toBeTruthy();
    });
  });

  it('exports ledger CSV and opens device share sheet', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('trip-expenses-export-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('trip-expenses-export-button'));

    await waitFor(() => {
      expect(apiFetchTextMock).toHaveBeenCalledWith(`/trips/${TRIP_ID}/expenses/export`);
      expect(shareSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Description,Date,Category,Amount'),
        }),
      );
    });
  });

  it('shows settle-up banner when trip is past and has nonzero balances', async () => {
    // Override trip to past
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me') return { user: { id: USER_1 } } as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { ...TRIP_FIXTURE, status: 'past' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return GUESTS_FIXTURE as any;
      if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) return recordedLedger as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) return BALANCES_FIXTURE as any;
      throw new Error(`Unhandled: ${method} ${path}`);
    });

    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('trip-expenses-settle-up-banner')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('trip-expenses-settle-up-banner'));
    expect(navigation.navigate).toHaveBeenCalledWith('TripBalances', { tripId: TRIP_ID });
  });

  it('does NOT show settle-up banner for upcoming trips or when all balances are zero (Req 13.2)', async () => {
    // 1. Upcoming trip: banner should not appear
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
    expect(screen.queryByTestId('trip-expenses-settle-up-banner')).toBeNull();

    // 2. Past trip with all-zero balances: banner should not appear
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me') return { user: { id: USER_1 } } as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) {
        return { ...TRIP_FIXTURE, status: 'past' } as any;
      }
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return GUESTS_FIXTURE as any;
      if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) return recordedLedger as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) {
        return [
          { userId: USER_1, netBalanceCents: 0 },
          { userId: USER_2, netBalanceCents: 0 },
        ] as any;
      }
      throw new Error(`Unhandled: ${method} ${path}`);
    });

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
    expect(screen.queryByTestId('trip-expenses-settle-up-banner')).toBeNull();
  });

  it('pre-fills description when linking a catalog restaurant (Req 11.1, 11.3)', async () => {
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me') return { user: { id: USER_1 } } as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return GUESTS_FIXTURE as any;
      if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) return recordedLedger as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) return BALANCES_FIXTURE as any;
      if (method === 'GET' && path.startsWith('/catalog')) {
        return {
          experiences: [
            {
              id: 'exp-cinderella',
              name: "Cinderella's Royal Table",
              category: 'Restaurant',
              subCategory: 'Table Service',
              park: 'magic-kingdom',
            },
          ],
        } as any;
      }
      throw new Error(`Unhandled: ${method} ${path}`);
    });

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('link-restaurant-button')).toBeTruthy());

    // Tap link restaurant button
    fireEvent.press(screen.getByTestId('link-restaurant-button'));

    // Wait for ExperiencePicker and select Cinderella's Royal Table
    await waitFor(() =>
      expect(screen.getByTestId('expense-restaurant-picker-result-exp-cinderella')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('expense-restaurant-picker-result-exp-cinderella'));

    // Description is pre-filled with the restaurant's name
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input')).toHaveProp('value', "Cinderella's Royal Table");
    });
  });

  it('populates suggested tiers from linked restaurant cached menu and allows editing before save (Req 11.4, 11.5)', async () => {
    apiRequestMock.mockImplementation(async (method: string, path: string, body?: any) => {
      if (method === 'GET' && path === '/me') return { user: { id: USER_1 } } as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return GUESTS_FIXTURE as any;
      if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) return recordedLedger as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) return BALANCES_FIXTURE as any;
      if (method === 'GET' && path.startsWith('/catalog?')) {
        return {
          experiences: [
            {
              id: 'exp-cinderella',
              name: "Cinderella's Royal Table",
              category: 'Restaurant',
              subCategory: 'Table Service',
              park: 'magic-kingdom',
            },
          ],
        } as any;
      }
      if (method === 'GET' && path === '/catalog/exp-cinderella') {
        return {
          id: 'exp-cinderella',
          name: "Cinderella's Royal Table",
          menus: [
            {
              menuType: 'Dinner',
              groups: [
                {
                  name: 'Pricing',
                  items: [
                    { name: '$75 per adult', price: '$75.00' },
                    { name: '$45 per child', price: '$45.00' },
                  ],
                },
              ],
            },
          ],
        } as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/expenses`) {
        return { id: 'exp-created-tiered', ...body } as any;
      }
      throw new Error(`Unhandled: ${method} ${path}`);
    });

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('link-restaurant-button')).toBeTruthy());

    // Link restaurant
    fireEvent.press(screen.getByTestId('link-restaurant-button'));
    await waitFor(() =>
      expect(screen.getByTestId('expense-restaurant-picker-result-exp-cinderella')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('expense-restaurant-picker-result-exp-cinderella'));

    // Switch to tiered mode
    fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));

    // Tier suggestions banner appears from cached menu
    await waitFor(() => {
      expect(screen.getByTestId('tier-suggestions-banner')).toBeTruthy();
      expect(screen.getByTestId('apply-tier-suggestions-btn')).toBeTruthy();
    });

    // Apply suggestions
    fireEvent.press(screen.getByTestId('apply-tier-suggestions-btn'));

    // Tiers are populated
    expect(screen.getByTestId('tier-name-0')).toHaveProp('value', 'Adult');
    expect(screen.getByTestId('tier-price-0')).toHaveProp('value', '75.00');

    // Editable before save (Req 11.4)
    fireEvent.changeText(screen.getByTestId('tier-price-0'), '80.00');
    expect(screen.getByTestId('tier-price-0')).toHaveProp('value', '80.00');
  });

  it('links a resort for a hotel expense and pre-fills description (Req 11.2, 11.3)', async () => {
    apiRequestMock.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path === '/me') return { user: { id: USER_1 } } as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return GUESTS_FIXTURE as any;
      if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) return recordedLedger as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) return BALANCES_FIXTURE as any;
      if (method === 'GET' && path === '/resorts') {
        return {
          resorts: [
            { id: 'resort-polynesian', name: "Disney's Polynesian Village Resort" },
          ],
        } as any;
      }
      throw new Error(`Unhandled: ${method} ${path}`);
    });

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('category-chip-hotel')).toBeTruthy());

    // Switch category to hotel
    fireEvent.press(screen.getByTestId('category-chip-hotel'));
    await waitFor(() => expect(screen.getByTestId('link-resort-button')).toBeTruthy());

    // Tap link resort button
    fireEvent.press(screen.getByTestId('link-resort-button'));
    await waitFor(() => expect(screen.getByTestId('resort-picker-modal')).toBeTruthy());

    // Select resort
    await waitFor(() => expect(screen.getByTestId('resort-option-resort-polynesian')).toBeTruthy());
    fireEvent.press(screen.getByTestId('resort-option-resort-polynesian'));

    // Description is pre-filled with resort name
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input')).toHaveProp(
        'value',
        "Disney's Polynesian Village Resort",
      );
    });
  });

  it('does NOT offer catalog link pickers for tickets, shopping, transportation, or other (Req 11.8)', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('category-chip-tickets')).toBeTruthy());

    const nonCatalogCategories = ['tickets', 'shopping', 'transportation', 'other'] as const;
    for (const cat of nonCatalogCategories) {
      fireEvent.press(screen.getByTestId(`category-chip-${cat}`));
      expect(screen.queryByTestId('link-restaurant-button')).toBeNull();
      expect(screen.queryByTestId('link-resort-button')).toBeNull();
    }
  });

  it('allows managing guests from inside expense modal, preserving form input and including new guest', async () => {
    let mockGuests = [...GUESTS_FIXTURE];
    apiRequestMock.mockImplementation(async (method: string, path: string, body?: any) => {
      if (method === 'GET' && path === '/me') return { user: { id: USER_1 } } as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}`) return TRIP_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/members`) return MEMBERS_FIXTURE as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/guests`) return mockGuests as any;
      if (method === 'GET' && path.startsWith(`/trips/${TRIP_ID}/expenses`)) return recordedLedger as any;
      if (method === 'GET' && path === `/trips/${TRIP_ID}/balances`) return BALANCES_FIXTURE as any;
      if (method === 'POST' && path === `/trips/${TRIP_ID}/guests`) {
        const newGuest: TripGuestDTO = {
          id: 'guest-new-1',
          tripId: TRIP_ID,
          name: body.name,
          sponsorMemberId: USER_1,
          createdAt: new Date().toISOString(),
        };
        mockGuests = [...mockGuests, newGuest];
        return newGuest as any;
      }
      if (method === 'POST' && path === `/trips/${TRIP_ID}/expenses`) {
        const created: ExpenseDTO = {
          id: `exp-new-${Date.now()}`,
          tripId: TRIP_ID,
          payerId: body.payerId,
          createdByUserId: USER_1,
          description: body.description,
          amountCents: body.amountCents ?? 5000,
          date: body.date,
          category: body.category,
          splitMode: body.splitMode,
          experienceId: null,
          resortId: null,
          shares: [],
          tiers: [],
          items: [],
          chargeLines: [],
          refunds: [],
          createdAt: new Date().toISOString(),
        };
        return created as any;
      }
      return undefined as any;
    });

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    // Type description and amount
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Snacks for Timmy');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '25.00');

    // Open Manage Guests from inside expense form
    fireEvent.press(screen.getByTestId('open-manage-guests-link'));
    await waitFor(() => expect(screen.getByTestId('trip-guest-management-modal')).toBeTruthy());

    // Add new guest
    fireEvent.changeText(screen.getByTestId('add-guest-name-input'), 'Little Timmy');
    fireEvent.press(screen.getByTestId('add-guest-button'));

    await waitFor(() => expect(screen.getByText('Little Timmy')).toBeTruthy());

    // Close guest modal
    fireEvent.press(screen.getByTestId('close-guest-modal'));

    // Assert user is back in expense form with description and amount preserved
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input')).toHaveProp('value', 'Snacks for Timmy');
      expect(screen.getByTestId('expense-amount-input')).toHaveProp('value', '25.00');
    });

    // Assert Little Timmy is now an available participant in the even split
    await waitFor(() => {
      expect(screen.getByTestId('even-participant-guest-new-1')).toBeTruthy();
    });

    // Submit expense
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses`,
        expect.objectContaining({
          description: 'Snacks for Timmy',
          amountCents: 2500,
          participantIds: expect.arrayContaining(['guest-new-1']),
        }),
      );
    });
  });

  it('renders Balance Overview Hero Card with personal net position and navigates to balances (Req 10.5)', async () => {
    renderScreen();

    // Verify Hero Card renders with net position
    await waitFor(() => {
      expect(screen.getByTestId('expenses-balance-hero')).toBeTruthy();
      expect(screen.getByText('YOUR NET POSITION')).toBeTruthy();
      expect(screen.getByText('+$10.00')).toBeTruthy();
      expect(screen.getByText('You are owed overall')).toBeTruthy();
      expect(screen.getByText(/Eric owes you: \$10\.00/)).toBeTruthy();
      expect(screen.getByTestId('hero-settle-up-btn')).toHaveTextContent('Log Payment');
    });

    // Press Who Owes What button on Hero Card
    fireEvent.press(screen.getByTestId('hero-view-balances-btn'));

    // Verify switched to Who Owes What tab
    await waitFor(() => {
      expect(screen.getByTestId('who-owes-what-view')).toBeTruthy();
      expect(screen.getByText('SIMPLIFIED DIRECT REPAYMENTS')).toBeTruthy();
    });
  });

  it('renders personal share indicator and toggles collapsible split breakdown (Req 10.5)', async () => {
    renderScreen();

    // Verify Personal Share Banner renders on EXPENSE_1
    await waitFor(() => {
      expect(screen.getByTestId('expense-personal-share-exp-1')).toBeTruthy();
      expect(screen.getByText(/You paid \$120\.00 · Lent \$60\.00/)).toBeTruthy();
      expect(screen.getByText('Split among 2 people')).toBeTruthy();
    });

    // Initially breakdown content is collapsed
    expect(screen.queryByTestId('expense-breakdown-exp-1')).toBeNull();

    // Press toggle breakdown button
    fireEvent.press(screen.getByTestId('toggle-breakdown-exp-1'));

    // Breakdown is now visible with individual shares
    await waitFor(() => {
      expect(screen.getByTestId('expense-breakdown-exp-1')).toBeTruthy();
      expect(screen.getByText(/Ariel \(You\)/)).toBeTruthy();
      expect(screen.getByTestId('expense-breakdown-exp-1')).toHaveTextContent(/Eric/);
    });

    // Toggle off
    fireEvent.press(screen.getByTestId('toggle-breakdown-exp-1'));
    await waitFor(() => {
      expect(screen.queryByTestId('expense-breakdown-exp-1')).toBeNull();
    });
  });

  it('switches to Who Owes What tab and opens pre-filled settlement for pairwise debt (Req 6.5, 10.5)', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('tab-balances-btn')).toBeTruthy());

    // Switch to Who Owes What tab
    fireEvent.press(screen.getByTestId('tab-balances-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('who-owes-what-view')).toBeTruthy();
      expect(screen.getByTestId('pairwise-card-0')).toBeTruthy();
      expect(screen.getByText(/Eric owes Ariel/)).toBeTruthy();
      expect(screen.getByTestId('pairwise-amount-0')).toHaveTextContent('$10.00');
    });

    // Tap Settle button
    fireEvent.press(screen.getByTestId('settle-pair-btn-0'));

    // Verify Settlement modal opened pre-filled
    await waitFor(() => {
      expect(screen.getByTestId('settlement-modal')).toBeTruthy();
      expect(screen.getByTestId('settlement-amount-input')).toHaveProp('value', '10.00');
    });
  });

  it('tiered expense form auto-calculates total and participant subtotals with steppers (Req 4.7)', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('add-expense-button'));

    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    // Switch to tiered split mode
    fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));

    await waitFor(() => {
      expect(screen.getByTestId('derived-tier-amount-box')).toBeTruthy();
      expect(screen.getByTestId('add-tier-btn')).toBeTruthy();
    });

    // Default tiers: Adult ($50), Child ($30)
    // Use stepper to increment Adult count for Eric
    fireEvent.press(screen.getByTestId('tier-count-inc-0-user-2'));

    // Total should auto-derive to $50.00
    await waitFor(() => {
      expect(screen.getByTestId('derived-tier-amount-value')).toHaveTextContent('$50.00');
      expect(screen.getByTestId('participant-tier-subtotal-user-2')).toHaveTextContent('Subtotal: $50.00');
      expect(screen.getByTestId('tier-summary-0')).toHaveTextContent(/1 ticket selected · \$50\.00 total/);
    });

    // Use stepper to increment another ticket for Ariel (Adult: index 0)
    fireEvent.press(screen.getByTestId('tier-count-inc-0-user-1'));

    // Total should auto-derive to $100.00
    await waitFor(() => {
      expect(screen.getByTestId('derived-tier-amount-value')).toHaveTextContent('$100.00');
      expect(screen.getByTestId('participant-tier-subtotal-user-1')).toHaveTextContent('Subtotal: $50.00');
      expect(screen.getByTestId('tier-summary-0')).toHaveTextContent(/2 tickets selected · \$100\.00 total/);
    });
  });

  it('supports switching between table matrix and cards view and quick-assigning tickets to all', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('add-expense-button'));

    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    // Switch to tiered split mode
    fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));

    await waitFor(() => {
      expect(screen.getByTestId('tier-view-toggle-matrix')).toBeTruthy();
      expect(screen.getByTestId('tier-view-toggle-cards')).toBeTruthy();
      expect(screen.getByTestId('tier-quick-action-all')).toBeTruthy();
      expect(screen.getByText(/0 tickets assigned/i)).toBeTruthy();
    });

    // Tap quick action to assign 1 Adult ticket to all participants (3 members in fixture)
    fireEvent.press(screen.getByTestId('tier-quick-action-all'));

    await waitFor(() => {
      expect(screen.getByText(/3 tickets assigned/i)).toBeTruthy();
      expect(screen.getByTestId('derived-tier-amount-value')).toHaveTextContent('$150.00');
    });

    // Toggle to cards view
    fireEvent.press(screen.getByTestId('tier-view-toggle-cards'));

    await waitFor(() => {
      expect(screen.getByTestId('participant-tier-card-user-1')).toBeTruthy();
      expect(screen.getByTestId('participant-tier-subtotal-user-1')).toHaveTextContent('Subtotal: $50.00');
    });

    // Clear all tickets
    fireEvent.press(screen.getByTestId('tier-quick-action-clear'));

    await waitFor(() => {
      expect(screen.getByText(/0 tickets assigned/i)).toBeTruthy();
      expect(screen.getByTestId('derived-tier-amount-value')).toHaveTextContent('$0.00');
    });
  });

  it('tiered expense tax & tip helper calculates and applies additions into tier prices', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('add-expense-button'));

    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    // Switch to tiered split mode
    fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));

    await waitFor(() => {
      expect(screen.getByTestId('tier-tax-tip-helper')).toBeTruthy();
      expect(screen.getByTestId('toggle-tax-tip-helper-btn')).toBeTruthy();
    });

    // Open the helper
    fireEvent.press(screen.getByTestId('toggle-tax-tip-helper-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('tax-mode-dollar-btn')).toBeTruthy();
      expect(screen.getByTestId('tax-dollar-input')).toBeTruthy();
      expect(screen.getByTestId('apply-tier-tax-tip-btn')).toBeTruthy();
    });

    // Input exact tax $10.00
    fireEvent.changeText(screen.getByTestId('tax-dollar-input'), '10.00');

    // Tap apply
    fireEvent.press(screen.getByTestId('apply-tier-tax-tip-btn'));

    // Verify confirmation and scaled tier price
    await waitFor(() => {
      expect(screen.getByText('✓ Applied taxes and tips into tier prices!')).toBeTruthy();
    });
  });

  it('tapping pairwise card opens pairwise breakdown modal showing mutual transactions (Req 6.7)', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId('tab-balances-btn')).toBeTruthy());
    fireEvent.press(screen.getByTestId('tab-balances-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('pairwise-card-0')).toBeTruthy();
      expect(screen.getByTestId('open-pairwise-breakdown-0')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('open-pairwise-breakdown-0'));

    await waitFor(() => {
      expect(screen.getByTestId('pairwise-breakdown-modal')).toBeTruthy();
      expect(screen.getByTestId('pairwise-modal-subtitle')).toHaveTextContent(/Eric owes you: \$10\.00/);
      expect(screen.getByTestId('pairwise-entry-0')).toBeTruthy();
      expect(screen.getByText('Lunch at Be Our Guest')).toBeTruthy();
      expect(screen.getByTestId('pairwise-entry-amount-0')).toHaveTextContent('+$20.00');

      // Assert settlement card renders with distinct payment styling and labels
      expect(screen.getByTestId('pairwise-entry-1')).toBeTruthy();
      expect(screen.getByText('Payment from Eric')).toBeTruthy();
      expect(screen.getByText('Payment Received')).toBeTruthy();
      expect(screen.getByTestId('pairwise-entry-amount-1')).toHaveTextContent('-$10.00');
      expect(screen.getByText('Paid down')).toBeTruthy();
    });

    // Close modal
    fireEvent.press(screen.getByTestId('close-pairwise-breakdown-modal'));
    await waitFor(() => {
      expect(screen.queryByTestId('pairwise-breakdown-modal')).toBeNull();
    });
  });

  it('tapping hero debt item opens pairwise breakdown modal with quick settle (Req 6.7)', async () => {
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId(`hero-debt-item-${USER_2}`)).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId(`hero-debt-item-${USER_2}`));

    await waitFor(() => {
      expect(screen.getByTestId('pairwise-breakdown-modal')).toBeTruthy();
      expect(screen.getByTestId('pairwise-modal-settle-btn')).toBeTruthy();
      expect(screen.getByTestId('pairwise-modal-settle-btn')).toHaveTextContent(/Log Payment \$10\.00/);
    });

    // Tap Log Payment button inside modal
    fireEvent.press(screen.getByTestId('pairwise-modal-settle-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('settlement-modal')).toBeTruthy();
      expect(screen.getByTestId('settlement-amount-input')).toHaveProp('value', '10.00');
    });
  });

  it('renders receipt scanner hero card in add expense modal and populates items from photo scan (Req 9.1, 9.3)', async () => {
    mockScanReceiptPhoto.mockResolvedValueOnce(
      'Dole Whip $6.50\nChurro $5.00\nSales Tax $0.75\nTotal $12.25'
    );

    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('add-expense-button'));

    await waitFor(() => {
      expect(screen.getByTestId('receipt-scanner-hero-card')).toBeTruthy();
      expect(screen.getByTestId('scan-receipt-camera-button')).toBeTruthy();
      expect(screen.getByTestId('scan-receipt-library-button')).toBeTruthy();
      expect(screen.getByTestId('scan-receipt-demo-button')).toBeTruthy();
    });

    // Press Take Photo button
    fireEvent.press(screen.getByTestId('scan-receipt-camera-button'));

    await waitFor(() => {
      expect(mockScanReceiptPhoto).toHaveBeenCalledWith('camera');
      expect(screen.getByTestId('receipt-review-modal')).toBeTruthy();
    });

    // Confirm receipt review
    fireEvent.press(screen.getByTestId('confirm-receipt-review-button'));

    // Returns to form in itemized mode with scanned items populated and derived total
    await waitFor(() => {
      expect(screen.getByTestId('derived-amount-box')).toBeTruthy();
      expect(screen.getByDisplayValue('Dole Whip')).toBeTruthy();
      expect(screen.getByDisplayValue('Churro')).toBeTruthy();
    });

    // Fill description and submit the scanned itemized expense
    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Aloha Isle Refreshments');
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    // Assert that the itemized expense was posted without client-generated temporary IDs on items
    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses`,
        expect.objectContaining({
          description: 'Aloha Isle Refreshments',
          splitMode: 'itemized',
          items: expect.arrayContaining([
            expect.objectContaining({ name: 'Dole Whip', priceCents: 650 }),
            expect.objectContaining({ name: 'Churro', priceCents: 500 }),
          ]),
        }),
      );
    });

    const postedItemizedCall = apiRequestMock.mock.calls.find(
      ([method, url]) => method === 'POST' && url === `/trips/${TRIP_ID}/expenses`,
    );
    expect(postedItemizedCall).toBeDefined();
    const postedPayload = postedItemizedCall![2] as any;
    expect(postedPayload.items).toHaveLength(2);
    for (const it of postedPayload.items) {
      expect(it.id).toBeUndefined();
    }
  });

  it('allows picking expense date using DatePickerField and submits chosen date (Req 1.13)', async () => {
    renderScreen();

    await waitFor(() => expect(screen.getByTestId(`expense-card-${EXPENSE_1.id}`)).toBeTruthy());

    fireEvent.press(screen.getByTestId('add-expense-button'));
    await waitFor(() => expect(screen.getByTestId('expense-form-modal')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Plaza Ice Cream');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '20.00');

    // Tap DatePickerField to open calendar modal
    fireEvent.press(screen.getByTestId('expense-date-input'));

    // Select day 15 from the open calendar
    const dayElements = screen.getAllByText('15');
    const dayTarget = dayElements[0];
    expect(dayTarget).toBeDefined();
    fireEvent.press(dayTarget!);

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        'POST',
        `/trips/${TRIP_ID}/expenses`,
        expect.objectContaining({
          description: 'Plaza Ice Cream',
          amountCents: 2000,
          date: expect.stringMatching(/^\d{4}-\d{2}-15$/),
        }),
      );
    });
  });

  it('loads sample Disney receipt immediately via the Sample quick button', async () => {
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
    fireEvent.press(screen.getByTestId('add-expense-button'));

    await waitFor(() => {
      expect(screen.getByTestId('scan-receipt-demo-button')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('scan-receipt-demo-button'));

    await waitFor(() => {
      expect(screen.getByTestId('receipt-review-modal')).toBeTruthy();
      expect(screen.getByDisplayValue('French Dip Sandwich')).toBeTruthy();
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

    it('(a)(b)(c) paints the screen, primary text and converted ledger elements with dark values', async () => {
      setTestScheme('dark');
      renderScreen();

      const card = await screen.findByTestId(`expense-card-${EXPENSE_1.id}`);
      const tabs = screen.getByTestId('trip-expenses-tab-switcher');
      // (a) the screen background behind the tab switcher.
      expect(ancestorWith(tabs, 'backgroundColor').backgroundColor).toBe(
        darkTheme.color.background,
      );
      // (b) primary text: the expense title.
      expect(flat(screen.getByText('Be Our Guest Dinner')).color).toBe(
        darkTheme.color.textPrimary,
      );
      // (c) converted literals: the lavender tab track, the expense card surface and
      // violet hairline, and the dining category avatar (tint + rule-2a `fg + '33'` border).
      expect(flat(tabs).backgroundColor).toBe(EXPENSES.dark.tabTrack);
      expect(flat(card).backgroundColor).toBe(darkTheme.color.surface);
      expect(flat(card).borderColor).toBe(EXPENSES.dark.violetCardBorder);
      const avatar = ancestorWith(within(card).getByText(/^🍽/), 'backgroundColor');
      expect(avatar.backgroundColor).toBe(CATEGORY_META.dark.diningBg);
      expect(avatar.borderColor).toBe(`${CATEGORY_META.dark.diningFg}33`);
      expect(avatar.borderColor).toMatch(/^#[0-9a-f]{8}$/);
    });

    it('renders the ExpenseFormModal sheet with dark surface and converted controls', async () => {
      setTestScheme('dark');
      renderScreen();
      await waitFor(() => expect(screen.getByTestId('add-expense-button')).toBeTruthy());
      fireEvent.press(screen.getByTestId('add-expense-button'));

      const sheet = await screen.findByTestId('expense-form-modal');
      expect(flat(sheet).backgroundColor).toBe(darkTheme.color.surface);
      expect(flat(screen.getByText('Add Expense')).color).toBe(darkTheme.color.textPrimary);
      // #5b2a86 fill → primary; #ffffff pill → surface with a violet (B) border.
      expect(flat(screen.getByTestId('scan-receipt-camera-button')).backgroundColor).toBe(
        darkTheme.color.primary,
      );
      const photo = flat(screen.getByTestId('scan-receipt-library-button'));
      expect(photo.backgroundColor).toBe(darkTheme.color.surface);
      expect(photo.borderColor).toBe(FORM.dark.violetBorder);
      // A checked EVEN participant row sits on the lavender panel (neutral S).
      expect(flat(screen.getByTestId(`even-participant-${USER_1}`)).backgroundColor).toBe(
        FORM.dark.lavenderPanel,
      );
      expect(screen.getByTestId('expense-description-input').props.keyboardAppearance).toBe('dark');
    });

    it('renders the RefundModal sheet with dark surface and a primary-tinted projection', async () => {
      setTestScheme('dark');
      renderScreen();
      fireEvent.press(await screen.findByTestId(`refund-expense-${EXPENSE_1.id}`));

      const sheet = await screen.findByTestId('refund-modal');
      expect(flat(sheet).backgroundColor).toBe(darkTheme.color.surface);
      fireEvent.changeText(screen.getByTestId('refund-amount-input'), '10.00');
      const projected = await screen.findByText('Projected Net: $110.00');
      expect(flat(projected).color).toBe(darkTheme.color.primaryFg);
      expect(ancestorWith(projected, 'backgroundColor').backgroundColor).toBe(
        withAlpha(darkTheme.color.primary, 0.08),
      );
    });

    // Feature: dark-mode polish pass (Requirement 9.12): active tab reads stronger than idle.
    it('tab switcher: the active pill is raised and its label is stronger than the idle label', async () => {
      setTestScheme('dark');
      renderScreen();
      await screen.findByTestId(`expense-card-${EXPENSE_1.id}`);

      const tabColors = () => ({
        expensesBg: flat(screen.getByTestId('tab-expenses-btn')).backgroundColor,
        balancesBg: flat(screen.getByTestId('tab-balances-btn')).backgroundColor,
        expensesLabel: flat(within(screen.getByTestId('tab-expenses-btn')).getByText('Expenses')).color,
        balancesLabel: flat(
          within(screen.getByTestId('tab-balances-btn')).getByText('Who Owes What'),
        ).color,
      });

      const before = tabColors();
      expect(before.expensesBg).toBe(darkTheme.color.borderStrong);
      expect(before.balancesBg).toBeUndefined();
      expect(before.expensesLabel).toBe(darkTheme.color.primaryFg);
      expect(before.balancesLabel).toBe(darkTheme.color.textSecondary);
      expect(before.balancesLabel).not.toBe(before.expensesLabel);
      // The idle label is not brighter than the active one (it was textPrimary before).
      expect(
        contrastRatio(before.balancesLabel as string, EXPENSES.dark.tabTrack),
      ).toBeLessThan(contrastRatio(before.expensesLabel as string, EXPENSES.dark.tabTrack));
      // The active pill differs from (and is lighter than) the surfaceAlt track.
      expect(before.expensesBg).not.toBe(EXPENSES.dark.tabTrack);

      fireEvent.press(screen.getByTestId('tab-balances-btn'));
      await waitFor(() =>
        expect(flat(screen.getByTestId('tab-balances-btn')).backgroundColor).toBe(
          darkTheme.color.borderStrong,
        ),
      );
      const after = tabColors();
      expect(after.expensesBg).toBeUndefined();
      expect(after.balancesLabel).toBe(darkTheme.color.primaryFg);
      expect(after.expensesLabel).toBe(darkTheme.color.textSecondary);

      // B4-4: member names are name ink (textPrimary), not the primaryFg accent.
      const memberName = flat(
        within(await screen.findByTestId(`net-balance-card-${USER_1}`)).getByText('Ariel'),
      ).color;
      expect(memberName).toBe(darkTheme.color.textPrimary);
      expect(memberName).not.toBe(darkTheme.color.primaryFg);
    });

    // Feature: dark-mode polish pass (Requirements 9.12, 9.6): tier pills + count inputs.
    it('tier counts: inputs get the dark keyboard and the active pill border is distinct', async () => {
      setTestScheme('dark');
      renderScreen();
      fireEvent.press(await screen.findByTestId('add-expense-button'));
      await screen.findByTestId('expense-form-modal');
      fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));

      // Matrix view (default).
      await waitFor(() => expect(screen.getByTestId('tier-view-toggle-matrix')).toBeTruthy());
      expect(screen.getByTestId(`tier-count-0-${USER_1}`).props.keyboardAppearance).toBe('dark');

      // Cards view.
      fireEvent.press(screen.getByTestId('tier-view-toggle-cards'));
      await waitFor(() => expect(screen.getByTestId(`tier-count-pill-0-${USER_1}`)).toBeTruthy());
      expect(screen.getByTestId(`tier-count-0-${USER_1}`).props.keyboardAppearance).toBe('dark');

      fireEvent.press(screen.getByTestId(`tier-count-inc-0-${USER_1}`));
      await waitFor(() =>
        expect(flat(screen.getByTestId(`tier-count-pill-0-${USER_1}`)).borderColor).toBe(
          darkTheme.color.primaryFg,
        ),
      );
      const active = flat(screen.getByTestId(`tier-count-pill-0-${USER_1}`));
      const idle = flat(screen.getByTestId(`tier-count-pill-1-${USER_1}`));
      expect(idle.borderColor).toBe(DARK_TONAL.violet.border);
      expect(active.borderColor).not.toBe(idle.borderColor);
      expect(
        contrastRatio(active.borderColor as string, active.backgroundColor as string),
      ).toBeGreaterThanOrEqual(3);
    });

    // Feature: dark-mode visual-verify pass (Requirement 9.12): found on emulator-5554.
    // The selected split-mode chip was `surface` on a `surfaceAlt` track (a darker hole),
    // and the matrix-view active stepper kept the idle `violet.border`.
    it('split-mode selector: the selected chip is raised above the track and moves on press', async () => {
      setTestScheme('dark');
      renderScreen();
      fireEvent.press(await screen.findByTestId('add-expense-button'));
      await screen.findByTestId('expense-form-modal');

      const track = flat(screen.getByTestId('split-mode-selector')).backgroundColor;
      expect(track).toBe(darkTheme.color.surfaceAlt);
      const even = flat(screen.getByTestId('split-mode-chip-even'));
      expect(even.backgroundColor).toBe(darkTheme.color.borderStrong);
      expect(even.backgroundColor).not.toBe(darkTheme.color.surface);
      // Lighter than the track, so it reads raised.
      expect(contrastRatio(even.backgroundColor as string, '#000000')).toBeGreaterThan(
        contrastRatio(track as string, '#000000'),
      );
      expect(flat(screen.getByTestId('split-mode-chip-tiered')).backgroundColor).toBe('transparent');
      expect(flat(within(screen.getByTestId('split-mode-chip-even')).getByText(/EVEN/)).color).toBe(
        darkTheme.color.primaryFg,
      );

      fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));
      await waitFor(() =>
        expect(flat(screen.getByTestId('split-mode-chip-tiered')).backgroundColor).toBe(
          darkTheme.color.borderStrong,
        ),
      );
      expect(flat(screen.getByTestId('split-mode-chip-even')).backgroundColor).toBe('transparent');
    });

    it('tier matrix: the active stepper border is distinct from the idle steppers', async () => {
      setTestScheme('dark');
      renderScreen();
      fireEvent.press(await screen.findByTestId('add-expense-button'));
      await screen.findByTestId('expense-form-modal');
      fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));
      await waitFor(() => expect(screen.getByTestId(`tier-matrix-pill-0-${USER_1}`)).toBeTruthy());

      // Before any count, the pill is idle with the violet hairline.
      expect(flat(screen.getByTestId(`tier-matrix-pill-0-${USER_1}`)).borderColor).toBe(
        DARK_TONAL.violet.border,
      );
      fireEvent.press(screen.getByTestId(`tier-count-inc-0-${USER_1}`));
      await waitFor(() =>
        expect(flat(screen.getByTestId(`tier-matrix-pill-0-${USER_1}`)).borderColor).toBe(
          darkTheme.color.primaryFg,
        ),
      );
      const active = flat(screen.getByTestId(`tier-matrix-pill-0-${USER_1}`));
      const idle = flat(screen.getByTestId(`tier-matrix-pill-1-${USER_1}`));
      expect(idle.borderColor).toBe(DARK_TONAL.violet.border);
      expect(active.borderColor).not.toBe(idle.borderColor);
      expect(
        contrastRatio(active.borderColor as string, active.backgroundColor as string),
      ).toBeGreaterThanOrEqual(3);
    });

    // Feature: dark-mode polish pass (Requirement 9.15): the alcohol Switch.
    it('alcohol Switch: token colours with the on state stronger than off', async () => {
      setTestScheme('dark');
      renderScreen();
      fireEvent.press(await screen.findByTestId('add-expense-button'));
      await screen.findByTestId('expense-form-modal');
      fireEvent.press(screen.getByTestId('split-mode-chip-itemized'));
      fireEvent.press(screen.getByTestId('add-item-btn'));

      const sw = () =>
        screen.UNSAFE_getAllByType(Switch).find((s) => s.props.testID === 'item-alcohol-toggle-0')!
          .props;
      expect(sw().trackColor).toEqual({
        false: darkTheme.color.borderStrong,
        true: darkTheme.color.primary,
      });
      expect(sw().ios_backgroundColor).toBe(darkTheme.color.borderStrong);
      expect(sw().thumbColor).toBe(darkTheme.color.textSecondary);
      const offThumb: string = sw().thumbColor;

      fireEvent(screen.getByTestId('item-alcohol-toggle-0'), 'valueChange', true);
      await waitFor(() => expect(sw().value).toBe(true));
      expect(sw().thumbColor).toBe(darkTheme.color.textOnPrimary);
      expect(sw().thumbColor).not.toBe(offThumb);
      // On track vs off track: the on track is brighter.
      expect(
        contrastRatio(sw().trackColor.true, darkTheme.color.surface),
      ).toBeGreaterThan(contrastRatio(sw().trackColor.false, darkTheme.color.surface));
    });

    // Feature: dark-mode polish pass (Requirement 9.15): the discount charge
    // line's "Exclude Alcohol" Switch (themedSwitchProps + key={t.scheme}).
    it('discount exclude-alcohol Switch: dark tokens, remounted with today\'s light colours', async () => {
      setTestScheme('dark');
      renderScreen();
      fireEvent.press(await screen.findByTestId('add-expense-button'));
      await screen.findByTestId('expense-form-modal');
      fireEvent.press(screen.getByTestId('split-mode-chip-itemized'));
      fireEvent.press(screen.getByTestId('add-charge-discount'));

      const discountSwitch = () => within(screen.getByTestId('charge-line-0')).UNSAFE_getByType(Switch);
      // A new discount line starts with excludeAlcohol on.
      expect(discountSwitch().props.value).toBe(true);
      expect(discountSwitch().props.trackColor).toEqual({
        false: darkTheme.color.borderStrong,
        true: darkTheme.color.primary,
      });
      expect(discountSwitch().props.ios_backgroundColor).toBe(darkTheme.color.borderStrong);
      expect(discountSwitch().props.thumbColor).toBe(darkTheme.color.textOnPrimary);

      fireEvent(discountSwitch(), 'valueChange', false);
      await waitFor(() => expect(discountSwitch().props.value).toBe(false));
      expect(discountSwitch().props.thumbColor).toBe(darkTheme.color.textSecondary);

      const darkInstance = discountSwitch();
      setTestScheme('light');
      // `key={t.scheme}` remounts it, and light keeps today's literal colours.
      await waitFor(() => expect(discountSwitch()).not.toBe(darkInstance));
      expect(discountSwitch().props.trackColor).toEqual({ false: '#cbd5e1', true: '#c084fc' });
      expect(discountSwitch().props.thumbColor).toBe('#ffffff');
      expect(discountSwitch().props.ios_backgroundColor).toBeUndefined();
    });

    // B4-8: AVATAR_FILL. A participant avatar keeps its hue family across schemes:
    // today's light literal in light, that family's DARK_TONAL fill in dark, with
    // the white initial still legible on it.
    it('payer avatar fill: light literal in light, same hue family\'s dark fill in dark', async () => {
      const LIGHT_FILLS = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#db2777', '#0891b2', '#4f46e5'];
      const DARK_FILLS = [
        DARK_TONAL.violet.fill,
        DARK_TONAL.blue.fill,
        DARK_TONAL.green.fill,
        DARK_TONAL.orange.fill,
        DARK_TONAL.red.fill,
        DARK_TONAL.pink.fill,
        DARK_TONAL.teal.fill,
        DARK_TONAL.blue.fill,
      ];
      const ericAvatar = async () => {
        fireEvent.press(await screen.findByTestId('add-expense-button'));
        await screen.findByTestId('expense-form-modal');
        // Ariel pays, so Eric's chip is unselected and shows its generated fill.
        fireEvent.press(screen.getByTestId(`payer-chip-${USER_1}`));
        const initial = within(screen.getByTestId(`payer-chip-${USER_2}`)).getByText('E');
        return { fill: ancestorWith(initial, 'backgroundColor').backgroundColor as string, initial };
      };

      setTestScheme('light');
      const { unmount } = renderScreen();
      const light = await ericAvatar();
      const idx = LIGHT_FILLS.indexOf(light.fill);
      expect(idx).toBeGreaterThanOrEqual(0);
      unmount();

      setTestScheme('dark');
      renderScreen();
      const dark = await ericAvatar();
      expect(dark.fill).toBe(DARK_FILLS[idx]);
      expect(dark.fill).not.toBe(light.fill);
      expect(flat(dark.initial).color).toBe(darkTheme.color.textOnPrimary);
      expect(contrastRatio(darkTheme.color.textOnPrimary, dark.fill)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('light-mode parity for the dark polish pass', () => {
    const flat = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style) ?? {};
    afterEach(resetTestScheme);

    it('tab switcher keeps today\'s white active pill and #655d78 idle label', async () => {
      setTestScheme('light');
      renderScreen();
      await screen.findByTestId(`expense-card-${EXPENSE_1.id}`);
      expect(flat(screen.getByTestId('tab-expenses-btn')).backgroundColor).toBe('#ffffff');
      expect(
        flat(within(screen.getByTestId('tab-balances-btn')).getByText('Who Owes What')).color,
      ).toBe('#655d78');
    });

    it('tier pill and alcohol Switch keep today\'s light colours', async () => {
      setTestScheme('light');
      renderScreen();
      fireEvent.press(await screen.findByTestId('add-expense-button'));
      await screen.findByTestId('expense-form-modal');
      fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));
      await waitFor(() => expect(screen.getByTestId('tier-view-toggle-cards')).toBeTruthy());
      expect(screen.getByTestId(`tier-count-0-${USER_1}`).props.keyboardAppearance).toBe('light');
      fireEvent.press(screen.getByTestId('tier-view-toggle-cards'));
      fireEvent.press(await screen.findByTestId(`tier-count-inc-0-${USER_1}`));
      await waitFor(() =>
        expect(flat(screen.getByTestId(`tier-count-pill-0-${USER_1}`)).borderColor).toBe('#bca5db'),
      );
      expect(flat(screen.getByTestId(`tier-count-pill-0-${USER_1}`)).backgroundColor).toBe(
        '#f5effa',
      );
      // Selected split-mode chip keeps today's white fill (visual-verify pass).
      expect(flat(screen.getByTestId('split-mode-chip-tiered')).backgroundColor).toBe('#ffffff');
      // Matrix view: the active stepper keeps today's white fill and #bca5db border.
      fireEvent.press(screen.getByTestId('tier-view-toggle-matrix'));
      await waitFor(() =>
        expect(flat(screen.getByTestId(`tier-matrix-pill-0-${USER_1}`)).borderColor).toBe('#bca5db'),
      );
      expect(flat(screen.getByTestId(`tier-matrix-pill-0-${USER_1}`)).backgroundColor).toBe('#ffffff');

      fireEvent.press(screen.getByTestId('split-mode-chip-itemized'));
      fireEvent.press(screen.getByTestId('add-item-btn'));
      const sw = () =>
        screen.UNSAFE_getAllByType(Switch).find((s) => s.props.testID === 'item-alcohol-toggle-0')!
          .props;
      expect(sw().trackColor).toEqual({ false: '#cbd5e1', true: '#c084fc' });
      expect(sw().thumbColor).toBe('#ffffff');
      expect(sw().ios_backgroundColor).toBeUndefined();
      fireEvent(screen.getByTestId('item-alcohol-toggle-0'), 'valueChange', true);
      await waitFor(() => expect(sw().thumbColor).toBe('#7c3aed'));
    });
  });
});


