/**
 * TripBudgetScreen "Log as expense" flow (trip-budget task 22.4).
 *
 * // Feature: trip-budget, Property 51: Logging a Budget_Line as an Expense pre-fills faithfully and links softly
 * Validates: Requirements 23.1, 23.9, 23.10, 23.11, 23.12
 *
 * Renders the real Budget screen, the real Expense form and the real link hook. Only the
 * network layer (`apiRequest`) is mocked, so the assertions are on the actual requests.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BudgetDTO, BudgetLineDTO, TripMemberDTO } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

import { TripBudgetScreen } from '../TripBudgetScreen';
import { apiRequest } from '../../../api/client';

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const TRIP = 'trip-100';
const ALICE = 'user-alice';
const BOB = 'user-bob';
const RESTAURANT = 'exp-restaurant-1';
const NEW_EXPENSE_ID = 'expense-new';

const MEMBERS: TripMemberDTO[] = [
  { userId: ALICE, displayName: 'Alice', avatarPreset: null, role: 'organizer' },
  { userId: BOB, displayName: 'Bob', avatarPreset: null, role: 'member' },
];

function diningLine(over: Partial<BudgetLineDTO> = {}): BudgetLineDTO {
  return {
    id: 'line-dinner',
    tripId: TRIP,
    createdBy: ALICE,
    category: 'dining',
    description: 'Dinner at Be Our Guest',
    plannedDate: '2026-11-10',
    park: null,
    experienceId: RESTAURANT,
    priceSource: 'user_entered',
    effectivePriceSource: 'user_entered',
    priceLabelKind: 'your_price',
    asOf: '2026-11-01',
    attribution: null,
    applyTip: false,
    linkedExpenseId: null,
    suggestionKey: null,
    subtotalCents: 10000,
    taxCents: 650,
    tipCents: 0,
    totalCents: 10650,
    allocations: [
      { id: 'a1', memberId: ALICE, guestId: null, storedCents: 5000, effectiveCents: 5000, taxCents: 325, tipCents: 0, priceRef: null },
      { id: 'a2', memberId: BOB, guestId: null, storedCents: 5000, effectiveCents: 5000, taxCents: 325, tipCents: 0, priceRef: null },
    ],
    ...over,
  };
}

function budgetWith(lines: BudgetLineDTO[]): BudgetDTO {
  return {
    tripId: TRIP,
    lines,
    travelers: [],
    settings: {
      taxBps: { tickets: 650, lightning_lane: 650, dining: 650, lodging: 1250, transportation: 650, shopping: 650, other: 650 },
      taxBpsIsDefault: { tickets: true, lightning_lane: true, dining: true, lodging: true, transportation: true, shopping: true, other: true },
      diningTipBps: 1800,
      diningTipBpsIsDefault: true,
      savedCents: 0,
      savingsTargetCents: null,
    },
    totalCents: lines.reduce((n, l) => n + l.totalCents, 0),
    subtotalCents: lines.reduce((n, l) => n + l.subtotalCents, 0),
    taxCents: lines.reduce((n, l) => n + l.taxCents, 0),
    tipCents: 0,
    byPerson: [],
    byDay: [],
    byPark: [],
    byCategory: [],
    savings: {
      targetCents: 0,
      savedCents: 0,
      remainingCents: 0,
      daysUntilStart: 10,
      weeksRemaining: 1,
      perWeekCents: 0,
      status: 'saving',
    },
    vsActual: [],
  };
}

interface NetworkOptions {
  readonly meFails?: boolean;
  readonly linkFails?: boolean;
}

let budgetState: BudgetDTO;

function installNetwork(options: NetworkOptions = {}) {
  mockApiRequest.mockImplementation(async (method: string, path: string) => {
    const m = method.toUpperCase();
    if (m === 'GET' && path === `/trips/${TRIP}/budget`) return budgetState;
    if (m === 'GET' && path === `/trips/${TRIP}/budget/suggestions`) return [];
    if (m === 'GET' && path === '/me') {
      if (options.meFails) throw new Error('offline');
      return { user: { id: ALICE } };
    }
    if (m === 'GET' && path === `/trips/${TRIP}/members`) return MEMBERS;
    if (m === 'GET' && path === `/trips/${TRIP}/guests`) return [];
    if (m === 'GET' && path === `/trips/${TRIP}`) return { id: TRIP, startDate: '2026-11-08', endDate: '2026-11-15' };
    if (m === 'GET' && path.startsWith('/catalog/')) return { menus: [] };
    if (m === 'POST' && path === `/trips/${TRIP}/expenses`) return { id: NEW_EXPENSE_ID, tripId: TRIP };
    if (m === 'PUT' && path === `/trips/${TRIP}/budget/lines/line-dinner/link`) {
      if (options.linkFails) throw new Error('link failed');
      budgetState = budgetWith(budgetState.lines.map((l) => (l.id === 'line-dinner' ? { ...l, linkedExpenseId: NEW_EXPENSE_ID } : l)));
      return null;
    }
    return {};
  });
}

function callsTo(method: string, path: string) {
  return mockApiRequest.mock.calls.filter((c) => String(c[0]).toUpperCase() === method && c[1] === path);
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TripBudgetScreen tripId={TRIP} />
    </QueryClientProvider>,
  );
}

describe('TripBudgetScreen: Log as expense', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    budgetState = budgetWith([diningLine()]);
  });

  test('an unlinked line shows the control and a linked line shows the "Logged as expense" mark instead', async () => {
    budgetState = budgetWith([
      diningLine(),
      diningLine({ id: 'line-done', description: 'Already logged lunch', linkedExpenseId: 'expense-old' }),
    ]);
    installNetwork();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByLabelText('Log Dinner at Be Our Guest as expense')).toBeTruthy();
    });
    expect(screen.getByTestId('log-expense-line-dinner')).toBeTruthy();
    expect(screen.queryByTestId('logged-expense-line-dinner')).toBeNull();

    expect(screen.getByLabelText('Logged as expense')).toBeTruthy();
    expect(screen.getByTestId('logged-expense-line-done')).toBeTruthy();
    expect(screen.queryByTestId('log-expense-line-done')).toBeNull();
    expect(screen.queryByLabelText('Log Already logged lunch as expense')).toBeNull();
  });

  test('pressing the control opens the Expense form pre-filled from the line and sends no POST yet', async () => {
    installNetwork();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('log-expense-line-dinner').props.accessibilityState.disabled).toBe(false);
    });
    fireEvent.press(screen.getByTestId('log-expense-line-dinner'));

    await waitFor(() => {
      expect(screen.getByTestId('expense-form-modal')).toBeTruthy();
    });
    expect(screen.getByTestId('expense-description-input').props.value).toBe('Dinner at Be Our Guest');
    expect(screen.getByTestId('expense-amount-input').props.value).toBe('106.50');
    expect(screen.getByTestId('expense-form-draft-notice')).toBeTruthy();
    expect(screen.getByTestId(`exact-share-input-${BOB}`).props.value).toBe('53.25');

    expect(callsTo('POST', `/trips/${TRIP}/expenses`)).toHaveLength(0);
    expect(callsTo('PUT', `/trips/${TRIP}/budget/lines/line-dinner/link`)).toHaveLength(0);
  });

  test('saving posts the Expense, then links it to the line, and the refetched Budget shows the logged mark', async () => {
    installNetwork();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('log-expense-line-dinner').props.accessibilityState.disabled).toBe(false);
    });
    fireEvent.press(screen.getByTestId('log-expense-line-dinner'));
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Dinner at Be Our Guest');
    });

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(callsTo('PUT', `/trips/${TRIP}/budget/lines/line-dinner/link`)).toHaveLength(1);
    });

    // The Expense request carries the draft values; Alice (the caller) is the payer.
    const posts = callsTo('POST', `/trips/${TRIP}/expenses`);
    expect(posts).toHaveLength(1);
    expect(posts[0]![2]).toEqual({
      payerId: ALICE,
      description: 'Dinner at Be Our Guest',
      date: '2026-11-10',
      category: 'dining',
      splitMode: 'exact',
      amountCents: 10650,
      experienceId: RESTAURANT,
      shares: [{ memberId: BOB, amountCents: 5325 }],
    });

    // The link names the Expense returned by the POST, and happens after it.
    const puts = callsTo('PUT', `/trips/${TRIP}/budget/lines/line-dinner/link`);
    expect(puts[0]![2]).toEqual({ expenseId: NEW_EXPENSE_ID });
    const order = mockApiRequest.mock.calls.map((c) => `${String(c[0]).toUpperCase()} ${c[1]}`);
    expect(order.indexOf(`POST /trips/${TRIP}/expenses`)).toBeLessThan(
      order.indexOf(`PUT /trips/${TRIP}/budget/lines/line-dinner/link`),
    );

    // The form closes, the Budget is refetched and the line now shows as logged with no control.
    await waitFor(() => {
      expect(screen.queryByTestId('expense-form-modal')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('logged-expense-line-dinner')).toBeTruthy();
    });
    expect(screen.queryByTestId('log-expense-line-dinner')).toBeNull();
    expect(screen.queryByTestId('budget-link-error')).toBeNull();
  });

  test('a failing link keeps the Expense, shows the message once, creates no second Expense and refetches the Budget', async () => {
    installNetwork({ linkFails: true });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('log-expense-line-dinner').props.accessibilityState.disabled).toBe(false);
    });
    fireEvent.press(screen.getByTestId('log-expense-line-dinner'));
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Dinner at Be Our Guest');
    });
    const budgetGetsBefore = callsTo('GET', `/trips/${TRIP}/budget`).length;

    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(screen.getByTestId('budget-link-error')).toBeTruthy();
    });
    expect(screen.getByText('Expense saved, but it could not be linked to this budget line.')).toBeTruthy();

    expect(callsTo('POST', `/trips/${TRIP}/expenses`)).toHaveLength(1);
    expect(callsTo('PUT', `/trips/${TRIP}/budget/lines/line-dinner/link`)).toHaveLength(1);
    await waitFor(() => {
      expect(screen.queryByTestId('expense-form-modal')).toBeNull();
    });
    await waitFor(() => {
      expect(callsTo('GET', `/trips/${TRIP}/budget`).length).toBeGreaterThan(budgetGetsBefore);
    });
    // The line is still unlinked, so the control is still there and nothing claims it was logged.
    expect(screen.getByTestId('log-expense-line-dinner')).toBeTruthy();
    expect(screen.queryByTestId('logged-expense-line-dinner')).toBeNull();
  });

  test('the control is disabled and opens nothing until the caller and the roster have loaded', async () => {
    installNetwork({ meFails: true });
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('log-expense-line-dinner')).toBeTruthy();
    });
    // /me failed, so the caller is unknown: the control stays disabled.
    expect(screen.getByTestId('log-expense-line-dinner').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(screen.getByTestId('log-expense-line-dinner'));
    expect(screen.queryByTestId('expense-form-modal')).toBeNull();
    expect(callsTo('POST', `/trips/${TRIP}/expenses`)).toHaveLength(0);
  });

  test('closing the form without saving creates nothing and leaves the line unlinked', async () => {
    installNetwork();
    renderScreen();

    await waitFor(() => {
      expect(screen.getByTestId('log-expense-line-dinner').props.accessibilityState.disabled).toBe(false);
    });
    fireEvent.press(screen.getByTestId('log-expense-line-dinner'));
    await waitFor(() => {
      expect(screen.getByTestId('expense-form-modal')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('close-expense-modal'));

    await waitFor(() => {
      expect(screen.queryByTestId('expense-form-modal')).toBeNull();
    });
    expect(callsTo('POST', `/trips/${TRIP}/expenses`)).toHaveLength(0);
    expect(callsTo('PUT', `/trips/${TRIP}/budget/lines/line-dinner/link`)).toHaveLength(0);
    expect(screen.getByTestId('log-expense-line-dinner')).toBeTruthy();
  });
});
