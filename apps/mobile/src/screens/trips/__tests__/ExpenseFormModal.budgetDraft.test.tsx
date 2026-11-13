/**
 * ExpenseFormModal opened from a Budget_Line draft (trip-budget task 22.3).
 *
 * // Feature: trip-budget, Property 51: Logging a Budget_Line as an Expense pre-fills faithfully and links softly
 * Validates: trip-budget Requirements 23.3, 23.4, 23.12; trip-expenses Requirement 17.1 - 17.4
 *
 * Renders the real form. Only the network layer (apiRequest and the expense API functions) is mocked.
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ExpenseDTO, TripGuestDTO, TripMemberDTO } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: 'http://test.local' } } },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { __esModule: true, ...actual, apiRequest: jest.fn() };
});

jest.mock('../tripExpenseApi', () => {
  const actual = jest.requireActual('../tripExpenseApi');
  return {
    __esModule: true,
    ...actual,
    createExpense: jest.fn(),
    editExpense: jest.fn(),
    fetchTripGuests: jest.fn(),
  };
});

import { ExpenseFormModal } from '../ExpenseFormModal';
import type { ExpenseFormDraft } from '../budgetToExpenseDraft';
import { apiRequest } from '../../../api/client';
import { createExpense, editExpense, fetchTripGuests } from '../tripExpenseApi';

const mockedApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockedCreateExpense = createExpense as jest.MockedFunction<typeof createExpense>;
const mockedEditExpense = editExpense as jest.MockedFunction<typeof editExpense>;
const mockedFetchGuests = fetchTripGuests as jest.MockedFunction<typeof fetchTripGuests>;

const TRIP_ID = 'trip-100';
const ALICE = 'user-alice';
const BOB = 'user-bob';
const GUEST_ID = 'guest-timmy';
const RESTAURANT_ID = 'exp-restaurant-1';

const MEMBERS: TripMemberDTO[] = [
  { userId: ALICE, displayName: 'Alice', avatarPreset: null, role: 'organizer' },
  { userId: BOB, displayName: 'Bob', avatarPreset: null, role: 'member' },
];
const GUESTS = [
  { id: GUEST_ID, tripId: TRIP_ID, sponsorMemberId: BOB, name: 'Timmy' },
] as unknown as TripGuestDTO[];

// Alice 124.50 (incl. tax and tip), Bob 62.25, guest Timmy 31.10 => 217.85
const DRAFT: ExpenseFormDraft = {
  budgetLineId: 'line-1',
  description: 'Be Our Guest dinner',
  date: '2026-11-10',
  category: 'dining',
  amountCents: 21785,
  experienceId: RESTAURANT_ID,
  shares: [
    { memberId: ALICE, guestId: null, amountCents: 12450 },
    { memberId: BOB, guestId: null, amountCents: 6225 },
    { memberId: null, guestId: GUEST_ID, amountCents: 3110 },
  ],
};

const CREATED = { id: 'expense-new', tripId: TRIP_ID } as unknown as ExpenseDTO;

function renderModal(props: Partial<React.ComponentProps<typeof ExpenseFormModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = jest.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ExpenseFormModal
        visible={true}
        tripId={TRIP_ID}
        members={MEMBERS}
        guests={GUESTS}
        callerId={ALICE}
        onClose={onClose}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

describe('ExpenseFormModal with a Budget_Line draft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchGuests.mockResolvedValue(GUESTS);
    mockedApiRequest.mockResolvedValue({ menus: [] });
    mockedCreateExpense.mockResolvedValue(CREATED);
  });

  test('opens pre-filled: description, amount, notice, and per-person amounts, with no create call yet', async () => {
    renderModal({ initialDraft: DRAFT });

    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Be Our Guest dinner');
    });
    expect(screen.getByTestId('expense-amount-input').props.value).toBe('217.85');
    expect(screen.getByTestId('expense-form-draft-notice')).toBeTruthy();
    expect(screen.getByText(/Pre-filled from your budget estimate/)).toBeTruthy();

    // Exact split, payer (Alice) is the caller so her row is hidden; the others carry their amounts.
    expect(screen.queryByTestId(`exact-share-row-${ALICE}`)).toBeNull();
    expect(screen.getByTestId(`exact-share-input-${BOB}`).props.value).toBe('62.25');
    expect(screen.getByTestId(`exact-share-input-${GUEST_ID}`).props.value).toBe('31.10');
    expect(screen.getByText(/Payer's Implicit Share: \$124\.50/)).toBeTruthy();

    expect(mockedCreateExpense).not.toHaveBeenCalled();
  });

  test('saving posts the draft-derived exact payload, then reports the created Expense before closing', async () => {
    const calls: string[] = [];
    const onSaved = jest.fn(async () => {
      calls.push('onSaved');
    });
    const { onClose } = renderModal({ initialDraft: DRAFT, onSaved });
    onClose.mockImplementation(() => {
      calls.push('onClose');
    });

    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Be Our Guest dinner');
    });
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(mockedCreateExpense).toHaveBeenCalledTimes(1);
    });
    expect(mockedCreateExpense).toHaveBeenCalledWith(TRIP_ID, {
      payerId: ALICE,
      description: 'Be Our Guest dinner',
      date: '2026-11-10',
      category: 'dining',
      splitMode: 'exact',
      amountCents: 21785,
      experienceId: RESTAURANT_ID,
      resortId: undefined,
      shares: [
        { memberId: BOB, amountCents: 6225 },
        { guestId: GUEST_ID, amountCents: 3110 },
      ],
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith(CREATED);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(calls).toEqual(['onSaved', 'onClose']);
  });

  test('changing the payer keeps every pre-filled amount: the old payer becomes an explicit share, the new payer is omitted', async () => {
    renderModal({ initialDraft: DRAFT, onSaved: jest.fn() });
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Be Our Guest dinner');
    });

    fireEvent.press(screen.getByTestId(`payer-chip-${BOB}`));

    // Alice's row appears with her budgeted amount; Bob's row is gone (he is the payer now).
    await waitFor(() => {
      expect(screen.getByTestId(`exact-share-input-${ALICE}`).props.value).toBe('124.50');
    });
    expect(screen.queryByTestId(`exact-share-row-${BOB}`)).toBeNull();

    fireEvent.press(screen.getByTestId('submit-expense-button'));
    await waitFor(() => {
      expect(mockedCreateExpense).toHaveBeenCalledTimes(1);
    });
    const payload = mockedCreateExpense.mock.calls[0]![1] as any;
    expect(payload.payerId).toBe(BOB);
    expect(payload.amountCents).toBe(21785);
    expect(payload.shares).toEqual([
      { memberId: ALICE, amountCents: 12450 },
      { guestId: GUEST_ID, amountCents: 3110 },
    ]);
  });

  test('every pre-filled value stays editable and the edited values are what is saved', async () => {
    renderModal({ initialDraft: DRAFT, onSaved: jest.fn() });
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Be Our Guest dinner');
    });

    fireEvent.changeText(screen.getByTestId('expense-description-input'), 'Dinner (receipt)');
    fireEvent.changeText(screen.getByTestId('expense-amount-input'), '230.00');
    fireEvent.changeText(screen.getByTestId(`exact-share-input-${BOB}`), '70.00');
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(mockedCreateExpense).toHaveBeenCalledTimes(1);
    });
    const payload = mockedCreateExpense.mock.calls[0]![1] as any;
    expect(payload.description).toBe('Dinner (receipt)');
    expect(payload.amountCents).toBe(23000);
    expect(payload.shares).toEqual([
      { memberId: BOB, amountCents: 7000 },
      { guestId: GUEST_ID, amountCents: 3110 },
    ]);
  });

  test('a null draft date keeps the form default of today', async () => {
    renderModal({ initialDraft: { ...DRAFT, date: null }, onSaved: jest.fn() });
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Be Our Guest dinner');
    });
    fireEvent.press(screen.getByTestId('submit-expense-button'));
    await waitFor(() => {
      expect(mockedCreateExpense).toHaveBeenCalledTimes(1);
    });
    const payload = mockedCreateExpense.mock.calls[0]![1] as any;
    expect(payload.date).toBe(new Date().toISOString().slice(0, 10));
  });

  test('the Expense stays saved and the form still closes when onSaved throws', async () => {
    const onSaved = jest.fn().mockRejectedValue(new Error('link failed'));
    const { onClose } = renderModal({ initialDraft: DRAFT, onSaved });
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Be Our Guest dinner');
    });
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(mockedCreateExpense).toHaveBeenCalledTimes(1);
  });

  test('without a draft the form opens empty with no notice and behaves as before', async () => {
    renderModal();
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input')).toBeTruthy();
    });
    expect(screen.queryByTestId('expense-form-draft-notice')).toBeNull();
    expect(screen.getByTestId('expense-description-input').props.value).toBe('');
    expect(screen.getByTestId('expense-amount-input').props.value).toBe('');
  });

  test('editing an existing Expense ignores the draft and never calls onSaved', async () => {
    const onSaved = jest.fn();
    mockedEditExpense.mockResolvedValue(CREATED);
    const existing = {
      id: 'exp-existing',
      tripId: TRIP_ID,
      payerId: ALICE,
      createdByUserId: ALICE,
      amountCents: 5000,
      date: '2026-11-01',
      category: 'dining',
      description: 'Existing dinner',
      splitMode: 'even',
      experienceId: null,
      resortId: null,
      createdAt: '2026-10-25T12:00:00Z',
      shares: [{ memberId: BOB, guestId: null, amountCents: 2500 }],
      tiers: [],
      items: [],
      chargeLines: [],
      refunds: [],
    } as unknown as ExpenseDTO;

    const { onClose } = renderModal({ initialExpense: existing, initialDraft: DRAFT, onSaved });
    await waitFor(() => {
      expect(screen.getByTestId('expense-description-input').props.value).toBe('Existing dinner');
    });
    expect(screen.queryByTestId('expense-form-draft-notice')).toBeNull();

    fireEvent.press(screen.getByTestId('submit-expense-button'));
    await waitFor(() => {
      expect(mockedEditExpense).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(mockedCreateExpense).not.toHaveBeenCalled();
  });
});
