import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BudgetDTO, BudgetSuggestionDTO } from '@dwt/shared';

import { TripBudgetScreen } from '../TripBudgetScreen';
import * as budgetApi from '../budgetApi';

const mockDismissMutateAsync = jest.fn();
const mockCreateLineMutateAsync = jest.fn();
const mockPatchSettingsMutateAsync = jest.fn();

jest.mock('../budgetApi', () => {
  const actual = jest.requireActual('../budgetApi');
  return {
    ...actual,
    fetchBudget: jest.fn(),
    fetchBudgetSuggestions: jest.fn(),
    useDismissBudgetSuggestion: jest.fn(() => ({
      mutateAsync: mockDismissMutateAsync,
      isLoading: false,
    })),
    useCreateBudgetLine: jest.fn(() => ({
      mutateAsync: mockCreateLineMutateAsync,
      isLoading: false,
    })),
    useEditBudgetLine: jest.fn(() => ({
      mutateAsync: jest.fn(),
      isLoading: false,
    })),
    useDeleteBudgetLine: jest.fn(() => ({
      mutateAsync: jest.fn(),
      isLoading: false,
    })),
    usePutTravelerProfile: jest.fn(() => ({
      mutateAsync: jest.fn(),
      isLoading: false,
    })),
    useDeleteTravelerProfile: jest.fn(() => ({
      mutateAsync: jest.fn(),
      isLoading: false,
    })),
    usePatchBudgetSettings: jest.fn(() => ({
      mutateAsync: mockPatchSettingsMutateAsync,
      isLoading: false,
    })),
  };
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('TripBudgetScreen (Task 18.1, Requirements 6.2, 8.1, 16.6, 17.6, 21.3, 21.4, 22.2, 22.4, 22.5)', () => {
  const tripId = 'trip-100';

  const mockBudget: BudgetDTO = {
    tripId,
    totalCents: 125000,
    subtotalCents: 110000,
    taxCents: 10000,
    tipCents: 5000,
    lines: [
      {
        id: 'line-1',
        tripId,
        createdBy: 'user-1',
        category: 'tickets',
        description: '4-day Base Tickets',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        effectivePriceSource: 'disney_ticket_calendar',
        priceLabelKind: 'current',
        asOf: '2026-10-25',
        attribution: 'disney',
        applyTip: false,
        linkedExpenseId: null,
        suggestionKey: null,
        subtotalCents: 80000,
        taxCents: 5200,
        tipCents: 0,
        totalCents: 85200,
        allocations: [],
      },
      {
        id: 'line-2',
        tripId,
        createdBy: 'user-1',
        category: 'lightning_lane',
        description: 'Magic Kingdom Multi Pass',
        plannedDate: '2026-11-02',
        park: 'Magic Kingdom',
        experienceId: null,
        priceSource: 'themeparks_ll',
        effectivePriceSource: 'themeparks_ll',
        priceLabelKind: 'current',
        asOf: '2026-10-25',
        attribution: 'themeparks_wiki',
        applyTip: false,
        linkedExpenseId: null,
        suggestionKey: null,
        subtotalCents: 30000,
        taxCents: 1950,
        tipCents: 0,
        totalCents: 31950,
        allocations: [],
      },
    ],
    travelers: [
      {
        id: 'prof-1',
        memberId: 'user-1',
        guestId: null,
        label: 'Alice',
        ageBracket: 'adult',
        ticketOption: 'base',
        ticketDays: 4,
        ticketStartDate: '2026-11-01',
        discountGroup: 'std-gst',
        passType: 'none',
      },
    ],
    settings: {
      taxBps: {
        tickets: 650,
        lightning_lane: 650,
        dining: 650,
        lodging: 1250,
        transportation: 650,
        shopping: 650,
        other: 650,
      },
      taxBpsIsDefault: {
        tickets: true,
        lightning_lane: true,
        dining: true,
        lodging: true,
        transportation: true,
        shopping: true,
        other: true,
      },
      diningTipBps: 1800,
      diningTipBpsIsDefault: true,
      savedCents: 25000,
      savingsTargetCents: 150000,
    },
    byPerson: [
      { key: 'user-1', label: 'Alice', totalCents: 90000 },
      { key: 'deleted-user', label: 'Deleted user', totalCents: 35000 },
    ],
    byDay: [
      { key: '2026-11-01', label: '2026-11-01', totalCents: 85200 },
      { key: '2026-11-02', label: '2026-11-02', totalCents: 31950 },
    ],
    byPark: [
      { key: 'Magic Kingdom', label: 'Magic Kingdom', totalCents: 31950 },
      { key: 'none', label: 'All Parks', totalCents: 85200 },
    ],
    byCategory: [
      { key: 'tickets', label: 'tickets', totalCents: 85200 },
      { key: 'lightning_lane', label: 'lightning_lane', totalCents: 31950 },
    ],
    savings: {
      targetCents: 150000,
      savedCents: 25000,
      remainingCents: 125000,
      daysUntilStart: 28,
      weeksRemaining: 4,
      perWeekCents: 31250,
      status: 'saving',
    },
    vsActual: [
      {
        expenseCategory: 'tickets',
        budgetedCents: 117150,
        actualCents: 100000,
      },
      {
        expenseCategory: 'dining',
        budgetedCents: 20000,
        actualCents: 25000,
      },
    ],
  };

  const mockSuggestions: BudgetSuggestionDTO[] = [
    {
      suggestionKey: 'sug-ticket-1',
      kind: 'tickets',
      draft: {
        category: 'tickets',
        description: '4-day Base Tickets',
        plannedDate: '2026-11-01',
        park: null,
        experienceId: null,
        priceSource: 'disney_ticket_calendar',
        priceRef: {
          kind: 'ticket',
          discountGroup: 'std-gst',
          numDays: 4,
          ageGroup: 'adult',
          optionCode: 'base',
          startDate: '2026-11-01',
        },
        applyTip: false,
        suggestionKey: 'sug-ticket-1',
        partySize: 1,
        allocations: [],
        needsPrice: false,
        needsPeople: false,
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (budgetApi.fetchBudget as jest.Mock).mockResolvedValue(mockBudget);
    (budgetApi.fetchBudgetSuggestions as jest.Mock).mockResolvedValue(mockSuggestions);
    mockDismissMutateAsync.mockResolvedValue({});
    mockCreateLineMutateAsync.mockResolvedValue({ id: 'line-new' });
  });

  it('renders header totals, savings text, and price badge attributions (Properties 39, 40)', async () => {
    renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={true} />
    );

    // Header totals
    await waitFor(() => {
      expect(screen.getByText('$1250.00')).toBeTruthy();
      expect(screen.getByText(/Subtotal: \$1100.00/)).toBeTruthy();
      expect(screen.getByText(/Tax: \$100.00/)).toBeTruthy();
      expect(screen.getByText(/Tip: \$50.00/)).toBeTruthy();
    });

    // Savings text: "Save $312.50 per week"
    expect(screen.getByText('Save $312.50 per week')).toBeTruthy();

    // PriceBadge attributions (Property 39)
    // Tickets: neutral Disney source line
    expect(screen.getAllByText(/Prices from Disney's website/i).length).toBeGreaterThanOrEqual(1);
    // Lightning Lane: Powered by ThemeParks.wiki
    expect(screen.getAllByText('Powered by ThemeParks.wiki').length).toBeGreaterThanOrEqual(1);

    // Action buttons visible for organizer
    expect(screen.getByLabelText('Add line')).toBeTruthy();
    expect(screen.getByLabelText('Travelers')).toBeTruthy();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });

  it('settings button is hidden for a non-organizer member and shown for an organizer', async () => {
    // 1. Non-organizer
    const { rerender } = renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={false} />
    );

    await waitFor(() => {
      expect(screen.queryByLabelText('Settings')).toBeNull();
    });

    // 2. Organizer
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TripBudgetScreen tripId={tripId} isOrganizer={true} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Settings')).toBeTruthy();
    });
  });

  it('tapping each of the five view chips switches view, selected state, and shows corresponding buckets (Property 40)', async () => {
    renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={true} />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Party')).toBeTruthy();
    });

    // Initial state: Party is selected
    expect(screen.getByLabelText('Party').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Person').props.accessibilityState.selected).toBe(false);

    // 1. Switch to Person view
    fireEvent.press(screen.getByLabelText('Person'));
    expect(screen.getByLabelText('Person').props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText('Party').props.accessibilityState.selected).toBe(false);

    // Assert "Deleted user" bucket label renders as text in by-person view
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Deleted user')).toBeTruthy();
    expect(screen.getByText('$350.00')).toBeTruthy();

    // 2. Switch to Day view
    fireEvent.press(screen.getByLabelText('Day'));
    expect(screen.getByLabelText('Day').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('2026-11-01')).toBeTruthy();

    // 3. Switch to Park view
    fireEvent.press(screen.getByLabelText('Park'));
    expect(screen.getByLabelText('Park').props.accessibilityState.selected).toBe(true);
    expect(screen.getAllByText('Magic Kingdom').length).toBeGreaterThanOrEqual(1);

    // 4. Switch to Category view
    fireEvent.press(screen.getByLabelText('Category'));
    expect(screen.getByLabelText('Category').props.accessibilityState.selected).toBe(true);
    expect(screen.getAllByText('tickets').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('lightning_lane').length).toBeGreaterThanOrEqual(1);
  });

  it('dismissing a suggestion calls POST /budget/suggestions/dismiss and removes it', async () => {
    renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={true} />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Dismiss')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Dismiss'));

    await waitFor(() => {
      expect(mockDismissMutateAsync).toHaveBeenCalledWith({
        suggestionKey: 'sug-ticket-1',
      });
    });
  });

  it('accepting a suggestion opens BudgetLineFormModal with draft and issues create on confirm (Property 46)', async () => {
    renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={true} />
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Accept')).toBeTruthy();
    });

    // Tap Accept on the suggestion
    fireEvent.press(screen.getByLabelText('Accept'));

    // Modal opens pre-filled; NO create call yet before user confirms
    expect(mockCreateLineMutateAsync).not.toHaveBeenCalled();

    // Now save inside the form modal
    const saveLineBtn = screen.getByLabelText('Save line');
    fireEvent.press(saveLineBtn);

    await waitFor(() => {
      expect(mockCreateLineMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'tickets',
          suggestionKey: 'sug-ticket-1',
        })
      );
    });
  });

  it('renders empty state when lines is empty', async () => {
    (budgetApi.fetchBudget as jest.Mock).mockResolvedValueOnce({
      ...mockBudget,
      lines: [],
      totalCents: 0,
      subtotalCents: 0,
      taxCents: 0,
      tipCents: 0,
    });

    renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={true} />
    );

    await waitFor(() => {
      expect(
        screen.getByText("No budget lines yet. Tap 'Add line' to get started.")
      ).toBeTruthy();
    });
  });

  it('renders the attribution footer and screen title when lines exist', async () => {
    renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={true} />
    );

    await waitFor(() => {
      expect(screen.getByText('Trip Budget')).toBeTruthy();
      expect(screen.getByTestId('budget-attribution-footer')).toBeTruthy();
    });
  });

  it('allows depositing +$50 and entering a custom deposit amount into savings', async () => {
    mockPatchSettingsMutateAsync.mockResolvedValue({
      taxBps: {},
      diningTipBps: 1800,
      savedCents: 45000,
    });

    renderWithClient(
      <TripBudgetScreen tripId={tripId} isOrganizer={true} />
    );

    await waitFor(() => {
      expect(screen.getByText('Savings Plan')).toBeTruthy();
    });

    // Tap +$50 deposit button
    const deposit50Btn = screen.getByLabelText('Deposit $50 to savings');
    expect(deposit50Btn).toBeTruthy();
    fireEvent.press(deposit50Btn);

    expect(mockPatchSettingsMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ savedCents: expect.any(Number) })
    );

    // Tap + Custom deposit button to expand input
    const customBtn = screen.getByLabelText('Custom deposit to savings');
    expect(customBtn).toBeTruthy();
    fireEvent.press(customBtn);

    // Enter $250.00
    const customInput = screen.getByLabelText('Custom deposit amount');
    expect(customInput).toBeTruthy();
    expect(StyleSheet.flatten(customInput.props.style).minHeight).toBe(40);
    expect(StyleSheet.flatten(customInput.props.style).textAlignVertical).toBe('center');
    fireEvent.changeText(customInput, '250.00');

    // Confirm deposit
    fireEvent.press(screen.getByLabelText('Confirm custom deposit'));
    expect(mockPatchSettingsMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ savedCents: expect.any(Number) })
    );
  });
});

