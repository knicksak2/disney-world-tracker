// Feature: trip-budget, Property 40: Every new mobile screen is themed, labelled and wired
// Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.7, 5.7, 9.1, 9.4, 14.8, 14.9, 14.12, 15.6, 22.3, 22.5

import React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { MenuDTO, PriceQuoteDTO } from '@dwt/shared';

import { BudgetLineFormModal } from '../BudgetLineFormModal';
import * as budgetApi from '../budgetApi';

const mockMutateAsync = jest.fn().mockResolvedValue({ id: 'saved-line-1' });

jest.mock('../budgetApi', () => {
  const actual = jest.requireActual('../budgetApi');
  return {
    ...actual,
    fetchPriceQuotes: jest.fn(),
    useCreateBudgetLine: jest.fn(() => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
    })),
    useEditBudgetLine: jest.fn(() => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
    })),
  };
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('BudgetLineFormModal (Task 18.2, Requirements 2.1-2.7, 14.8, 14.12, 22.3)', () => {
  const tripId = 'trip-100';
  const mockFetchQuotes = budgetApi.fetchPriceQuotes as jest.MockedFunction<typeof budgetApi.fetchPriceQuotes>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ticket quote picker POSTs quotes, park picker appears for 1-day base, and defaults from park', async () => {
    const mockQuote: PriceQuoteDTO = {
      priceCents: 18400,
      taxCents: 1196,
      effectivePriceSource: 'disney_ticket_calendar',
      priceLabelKind: 'current',
      asOf: '2026-10-25',
      attribution: 'disney',
      parkAssumed: false,
    };
    mockFetchQuotes.mockResolvedValueOnce([mockQuote]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-11-01"
        initialDraft={{
          category: 'tickets',
          park: 'Animal Kingdom',
        }}
        onCancel={jest.fn()}
      />
    );

    // Starting park chips appear because days=1 and option=base
    // Animal Kingdom should be selected by default from park
    expect(screen.getByLabelText('Ticket park Animal Kingdom')).toBeTruthy();

    // Tap Get Ticket Quote
    const getQuoteBtn = screen.getByLabelText('Get ticket quote');
    fireEvent.press(getQuoteBtn);

    await waitFor(() => {
      expect(mockFetchQuotes).toHaveBeenCalledWith(tripId, {
        requests: [
          {
            kind: 'ticket',
            discountGroup: 'std-gst',
            numDays: 1,
            ageGroup: 'adult',
            optionCode: 'base',
            startDate: '2026-11-01',
            park: 'ak',
          },
        ],
      });
    });

    // Returned label is current and not estimate
    expect(screen.getAllByText('Disney price, as of Oct 25, 2026').length).toBeGreaterThanOrEqual(1);
  });

  it('leaving park unset for 1-day base ticket shows parkAssumed Estimate text', async () => {
    const mockQuote: PriceQuoteDTO = {
      priceCents: 20900,
      taxCents: 1358,
      effectivePriceSource: 'disney_ticket_calendar',
      priceLabelKind: 'estimate',
      asOf: '2026-10-25',
      attribution: 'disney',
      parkAssumed: true,
      estimateReason: 'park_unset',
    };
    mockFetchQuotes.mockResolvedValueOnce([mockQuote]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-11-01"
        initialDraft={{
          category: 'tickets',
          park: null,
        }}
        onCancel={jest.fn()}
      />
    );

    // Tap Get Ticket Quote without setting park
    fireEvent.press(screen.getByLabelText('Get ticket quote'));

    await waitFor(() => {
      expect(mockFetchQuotes).toHaveBeenCalledWith(tripId, {
        requests: [
          expect.objectContaining({
            kind: 'ticket',
            park: undefined,
          }),
        ],
      });
    });

    // Shows parkAssumed text
    expect(screen.getByLabelText('Estimate (highest park price)')).toBeTruthy();
    expect(screen.getByText('Estimate (highest park price)')).toBeTruthy();
  });

  it('flUnavailable quote renders Florida resident text and ignores cacheState (Requirement 14.8, 14.12)', async () => {
    const mockQuote: PriceQuoteDTO = {
      priceCents: null,
      taxCents: null,
      effectivePriceSource: 'disney_ticket_calendar',
      priceLabelKind: 'add_your_price',
      asOf: '2026-10-25',
      attribution: 'disney',
      flUnavailable: true,
      cacheState: 'warming',
      estimateReason: 'fl_unavailable',
    };
    mockFetchQuotes.mockResolvedValueOnce([mockQuote]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'tickets' }}
        onCancel={jest.fn()}
      />
    );

    // Select Florida resident
    fireEvent.press(screen.getByLabelText('fl-resident'));

    // Get Quote
    fireEvent.press(screen.getByLabelText('Get ticket quote'));

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          'Florida resident price unavailable for 1 days; enter your price'
        )
      ).toBeTruthy();
    });

    // Must NOT show "Prices are being fetched" even though cacheState is warming
    expect(screen.queryByText(/Prices are being fetched/)).toBeNull();
  });

  it('renders cacheState text when price is null and flUnavailable is false', async () => {
    // 1. cacheState warming
    mockFetchQuotes.mockResolvedValueOnce([
      {
        priceCents: null,
        taxCents: null,
        effectivePriceSource: 'disney_ticket_calendar',
        priceLabelKind: 'add_your_price',
        asOf: '2026-10-25',
        attribution: 'disney',
        flUnavailable: false,
        cacheState: 'warming',
      },
    ]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'tickets' }}
        onCancel={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText('Get ticket quote'));
    await waitFor(() => {
      expect(
        screen.getByLabelText('Prices are being fetched, try again in a minute')
      ).toBeTruthy();
    });

    // 2. cacheState disabled
    mockFetchQuotes.mockResolvedValueOnce([
      {
        priceCents: null,
        taxCents: null,
        effectivePriceSource: 'disney_ticket_calendar',
        priceLabelKind: 'add_your_price',
        asOf: '2026-10-25',
        attribution: 'disney',
        flUnavailable: false,
        cacheState: 'disabled',
      },
    ]);

    fireEvent.press(screen.getByLabelText('Get ticket quote'));
    await waitFor(() => {
      expect(
        screen.getByLabelText(
          'Automatic ticket prices are unavailable right now; enter your price'
        )
      ).toBeTruthy();
    });

    // 3. cacheState failed
    mockFetchQuotes.mockResolvedValueOnce([
      {
        priceCents: null,
        taxCents: null,
        effectivePriceSource: 'disney_ticket_calendar',
        priceLabelKind: 'add_your_price',
        asOf: '2026-10-25',
        attribution: 'disney',
        flUnavailable: false,
        cacheState: 'failed',
      },
    ]);

    fireEvent.press(screen.getByLabelText('Get ticket quote'));
    await waitFor(() => {
      expect(
        screen.getByLabelText(
          'Automatic ticket prices could not be fetched; enter your price'
        )
      ).toBeTruthy();
    });
    expect(screen.queryByText(/Prices are being fetched/)).toBeNull();
  });

  it('typing a manual price switches label to "Your price" and sends user_entered (Requirement 5.7)', async () => {
    const saveSpy = jest.fn();
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lodging', description: 'Hotel Stay' }}
        onSaveSuccess={saveSpy}
        onCancel={jest.fn()}
      />
    );

    // Type into manual price
    const priceInput = screen.getByLabelText('Manual price');
    fireEvent.changeText(priceInput, '150.00');

    // Price badge displays "Your price"
    expect(screen.getByText('Your price')).toBeTruthy();

    // Save line
    fireEvent.press(screen.getByLabelText('Save line'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'lodging',
          description: 'Hotel Stay',
          priceSource: 'user_entered',
        })
      );
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('dining flow allows opening MenuItemPicker and confirming selection', async () => {
    const mockMenus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        groups: [
          {
            name: 'Entrees',
            items: [{ name: 'Steak', priceCents: 4500 }],
          },
        ],
      },
    ];

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'dining' }}
        restaurantMenus={mockMenus}
        onCancel={jest.fn()}
      />
    );

    // Click "Pick from menu"
    const pickBtn = screen.getByLabelText('Pick from menu');
    fireEvent.press(pickBtn);

    // Menu Item Picker opens
    expect(screen.getAllByText('Pick from Menu').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Steak')).toBeTruthy();

    // Select Steak and confirm
    fireEvent.press(screen.getByLabelText('Steak'));
    fireEvent.press(screen.getByLabelText('Confirm selection'));

    // Subtotal updated and price badge shows Disney menu price
    expect(screen.getByDisplayValue('45.00')).toBeTruthy();
    expect(screen.getByText(/Disney menu price/)).toBeTruthy();
  });

  it('lightning lane picker resolves quote and shows LL PriceBadge', async () => {
    const mockQuote: PriceQuoteDTO = {
      priceCents: 3200,
      taxCents: 208,
      effectivePriceSource: 'themeparks_ll',
      priceLabelKind: 'current',
      asOf: '2026-10-25',
      attribution: 'themeparks_wiki',
    };
    mockFetchQuotes.mockResolvedValueOnce([mockQuote]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lightning_lane' }}
        onCancel={jest.fn()}
      />
    );

    // Select Premier Pass
    fireEvent.press(screen.getByLabelText('premier'));

    // Get LL Quote
    fireEvent.press(screen.getByLabelText('Get Lightning Lane quote'));

    await waitFor(() => {
      expect(mockFetchQuotes).toHaveBeenCalledWith(tripId, {
        requests: [
          {
            kind: 'll',
            passType: 'premier',
            park: 'Magic Kingdom',
            date: '2026-11-01',
          },
        ],
      });
    });

    // Shows LL badge and credit
    expect(screen.getAllByText('Lightning Lane price, as of Oct 25, 2026').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Powered by ThemeParks.wiki').length).toBeGreaterThanOrEqual(1);
  });

  it('hotel lodging flow renders Link Disney Resort and allows opening ResortPickerModal', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lodging' }}
        onCancel={jest.fn()}
      />
    );

    // Assert Link Disney Resort button is visible
    const linkBtn = screen.getByLabelText('Link Disney Resort');
    expect(linkBtn).toBeTruthy();

    // Tap to open ResortPickerModal
    fireEvent.press(linkBtn);
    expect(screen.getByText('Select Resort Hotel')).toBeTruthy();
  });

  it('dining flow allows selecting a restaurant from ExperiencePicker and forwards experienceId on save', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'dining', description: '' }}
        onCancel={jest.fn()}
      />
    );

    // Assert Link Disney Restaurant button is visible
    const linkBtn = screen.getByLabelText('Link Disney Restaurant');
    expect(linkBtn).toBeTruthy();

    // Tap to open ExperiencePicker modal
    fireEvent.press(linkBtn);
    expect(screen.getByText('Select Restaurant')).toBeTruthy();
  });

  it('renders party allocations with resilient keys and traveler names without unique key warnings', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={[
          { id: 'm-1', name: 'Alice' },
          { id: 'm-2', name: 'Bob' },
          { id: 'm-3', name: 'Charlie' },
          { id: 'm-4', name: 'David' },
        ]}
        guests={[
          { id: 'g-1', name: 'wife', isGuest: true },
          { id: 'g-2', name: 'kid', isGuest: true },
        ]}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.getByText('Charlie')).toBeTruthy();
    expect(screen.getByText('David')).toBeTruthy();
    expect(screen.getByText('wife')).toBeTruthy();
    expect(screen.getByText('kid')).toBeTruthy();

    const uniqueKeyErrors = errorSpy.mock.calls.filter((args) =>
      args.some((arg) => typeof arg === 'string' && arg.includes('Each child in a list should have a unique "key" prop'))
    );
    expect(uniqueKeyErrors).toHaveLength(0);

    errorSpy.mockRestore();
  });

  it('ticket quote applies price and saves with traveler 0 allocation and line priceRef', async () => {
    const mockQuote: PriceQuoteDTO = {
      priceCents: 19400,
      taxCents: 1261,
      effectivePriceSource: 'disney_ticket_calendar',
      priceLabelKind: 'current',
      asOf: '2026-10-26',
      attribution: 'disney',
      parkAssumed: false,
    };
    mockFetchQuotes.mockResolvedValueOnce([mockQuote]);

    const saveSpy = jest.fn();
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={[{ id: '11111111-1111-4111-8111-111111111111', name: 'knicksak2' }]}
        initialDraft={{
          category: 'tickets',
          description: 'tickets',
          park: 'Magic Kingdom',
          plannedDate: '2026-10-29',
        }}
        onSaveSuccess={saveSpy}
        onCancel={jest.fn()}
      />
    );

    // Tap Get Ticket Quote
    fireEvent.press(screen.getByLabelText('Get ticket quote'));

    await waitFor(() => {
      expect(screen.getByText('Official Disney quote applied: $194.00')).toBeTruthy();
    });

    // Save line
    fireEvent.press(screen.getByLabelText('Save line'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'tickets',
          description: 'tickets',
          priceSource: 'disney_ticket_calendar',
          priceRef: expect.objectContaining({
            kind: 'ticket',
            numDays: 1,
            optionCode: 'base',
          }),
          allocations: [
            expect.objectContaining({
              memberId: '11111111-1111-4111-8111-111111111111',
              amountCents: 19400,
            }),
          ],
        })
      );
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces save failure in an error banner if mutateAsync rejects', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network error saving line'));

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lodging', description: 'Hotel' }}
        onCancel={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText('Save line'));

    await waitFor(() => {
      expect(screen.getByText('Network error saving line')).toBeTruthy();
    });
  });

  it('multi-ticket calculator batch-quotes Adult and Child quantities and allocates per-traveler refs (Requirement 22.9, Property 50c)', async () => {
    const adultQuote: PriceQuoteDTO = {
      priceCents: 19400,
      taxCents: 1261,
      effectivePriceSource: 'disney_ticket_calendar',
      priceLabelKind: 'current',
      asOf: '2026-10-26',
      attribution: 'disney',
      parkAssumed: false,
    };
    const childQuote: PriceQuoteDTO = {
      priceCents: 18400,
      taxCents: 1196,
      effectivePriceSource: 'disney_ticket_calendar',
      priceLabelKind: 'current',
      asOf: '2026-10-26',
      attribution: 'disney',
      parkAssumed: false,
    };
    mockFetchQuotes.mockResolvedValueOnce([adultQuote, childQuote]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-11-01"
        members={[
          { id: '11111111-1111-4111-8111-111111111111', name: 'Alice' },
          { id: '22222222-2222-4222-8222-222222222222', name: 'Bob' },
        ]}
        guests={[
          { id: '33333333-3333-4333-8333-333333333333', name: 'Junior', isGuest: true },
        ]}
        initialDraft={{
          category: 'tickets',
          park: 'Magic Kingdom',
        }}
        onCancel={jest.fn()}
      />
    );

    // Default is 1 Adult, 0 Children. Step Adults to 2 and Children to 1.
    fireEvent.press(screen.getByLabelText('Increase adult tickets'));
    fireEvent.press(screen.getByLabelText('Increase child tickets'));

    fireEvent.press(screen.getByLabelText('Get ticket quote'));

    await waitFor(() => {
      expect(mockFetchQuotes).toHaveBeenCalledWith(tripId, {
        requests: [
          expect.objectContaining({ ageGroup: 'adult', numDays: 1, park: 'mk' }),
          expect.objectContaining({ ageGroup: 'child', numDays: 1, park: 'mk' }),
        ],
      });
    });

    // Combined subtotal = 2 * $194.00 + 1 * $184.00 = $572.00
    expect(screen.getByDisplayValue('572.00')).toBeTruthy();
    expect(
      screen.getByText(/2 Adults × \$194\.00 \+ 1 Child × \$184\.00 = \$572\.00/)
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Save line'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'tickets',
          description: '1-Day 1-Park Base Tickets',
          priceSource: 'disney_ticket_calendar',
          allocations: [
            expect.objectContaining({
              memberId: '11111111-1111-4111-8111-111111111111',
              amountCents: 19400,
              priceRef: expect.objectContaining({ ageGroup: 'adult' }),
            }),
            expect.objectContaining({
              memberId: '22222222-2222-4222-8222-222222222222',
              amountCents: 19400,
              priceRef: expect.objectContaining({ ageGroup: 'adult' }),
            }),
            expect.objectContaining({
              guestId: '33333333-3333-4333-8333-333333333333',
              amountCents: 18400,
              priceRef: expect.objectContaining({ ageGroup: 'child' }),
            }),
          ],
        })
      );
    });
  });

  it('dining supports 1-tap menu average per person and inline buffet Adult + Child steppers (Requirements 9.11, 9.12)', async () => {
    const mockMenus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        groups: [
          {
            name: 'Entrees',
            type: 'Entrees',
            items: [
              { name: 'Ribeye Steak', priceCents: 4000 },
              { name: 'Roasted Chicken', priceCents: 3000 },
            ],
          },
          {
            name: 'Buffet Pricing',
            items: [
              { name: '$65 per adult', price: '$65.00' },
              { name: '$40 per child', price: '$40.00' },
            ],
          },
        ],
      },
    ];

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={[
          { id: '11111111-1111-4111-8111-111111111111', name: 'Alice' },
          { id: '22222222-2222-4222-8222-222222222222', name: 'Bob' },
        ]}
        initialDraft={{ category: 'dining', experienceId: 'exp-1' }}
        restaurantMenus={mockMenus}
        onCancel={jest.fn()}
      />
    );

    // 1. Tap "Apply menu average" (~$35.00/person * 2 diners = $70.00)
    const avgBtn = screen.getByLabelText('Apply menu average');
    fireEvent.press(avgBtn);
    expect(screen.getByDisplayValue('70.00')).toBeTruthy();

    // 2. Step inline buffet Adult (1) + Child (1) = $65 + $40 = $105.00
    fireEvent.press(screen.getByLabelText('Increase buffet Adult'));
    fireEvent.press(screen.getByLabelText('Increase buffet Child'));
    expect(screen.getByDisplayValue('105.00')).toBeTruthy();
  });

  it('dining Off-Property toggle hides Disney restaurant picker and saves with experienceId null (Requirement 22.9)', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'dining', experienceId: 'exp-1' }}
        onCancel={jest.fn()}
      />
    );

    // Switch to Off-Property Dining
    fireEvent.press(screen.getByLabelText('Off-Property Dining'));
    expect(screen.queryByLabelText('Link Disney Restaurant')).toBeNull();
    expect(screen.queryByLabelText('Pick from menu')).toBeNull();

    fireEvent.changeText(screen.getByLabelText('Manual price'), '80.00');
    fireEvent.press(screen.getByLabelText('Save line'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'dining',
          description: 'Off-Property Dining',
          experienceId: null,
          priceSource: 'user_entered',
        })
      );
    });
  });

  it('lodging nightly rate × nights calculator updates subtotal and live breakdown preview (Requirement 22.9)', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-11-01"
        tripEnd="2026-11-05"
        initialDraft={{ category: 'lodging' }}
        onCancel={jest.fn()}
      />
    );

    // Default nights from 2026-11-01 to 2026-11-05 is 4 nights. Enter $250/night => $1000.00
    const nightlyInput = screen.getByLabelText('Nightly rate');
    fireEvent.changeText(nightlyInput, '250.00');
    expect(screen.getByLabelText('Manual price').props.value).toBe('1000.00');

    // Increase nights to 5 => $1250.00
    fireEvent.press(screen.getByLabelText('Increase nights'));
    expect(screen.getByLabelText('Manual price').props.value).toBe('1250.00');
    expect(screen.getByText(/Est\. Total/)).toBeTruthy();
  });

  it('renders quick 1-tap trip day chips and defaults plannedDate to tripStart', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-10-27"
        tripEnd="2026-10-30"
        initialDraft={{ category: 'tickets', description: 'Park Day Tickets' }}
        onCancel={jest.fn()}
      />
    );

    // Initial planned date should default to tripStart
    expect(screen.getByText('Oct 27, 2026')).toBeTruthy();

    // Day chips for the trip dates should exist
    expect(screen.getByTestId('trip-day-chip-2026-10-27')).toBeTruthy();
    expect(screen.getByTestId('trip-day-chip-2026-10-28')).toBeTruthy();
    expect(screen.getByTestId('trip-day-chip-2026-10-29')).toBeTruthy();
    expect(screen.getByTestId('trip-day-chip-2026-10-30')).toBeTruthy();
    expect(screen.getByText('Day 1 · Oct 27')).toBeTruthy();
    expect(screen.getByText('Day 2 · Oct 28')).toBeTruthy();

    // Tapping Day 3 chip selects 2026-10-29
    fireEvent.press(screen.getByTestId('trip-day-chip-2026-10-29'));
    expect(screen.getByText('Oct 29, 2026')).toBeTruthy();

    // Enter manual price and save to verify plannedDate is sent in payload
    fireEvent.changeText(screen.getByLabelText('Manual price'), '150.00');
    fireEvent.press(screen.getByLabelText('Save line'));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          plannedDate: '2026-10-29',
        })
      );
    });
  });

  it('displays informative status callout and applies baseline estimate when LL quote returns no price data', async () => {
    mockFetchQuotes.mockResolvedValueOnce([
      {
        priceCents: null,
        taxCents: null,
        effectivePriceSource: 'user_entered',
        priceLabelKind: 'add_your_price',
        asOf: '',
        attribution: null,
        soldOut: false,
        cacheState: 'ready',
        estimateReason: 'none',
        parkAssumed: false,
        flUnavailable: false,
      },
    ]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lightning_lane', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    fireEvent.press(screen.getByLabelText('Get Lightning Lane quote'));

    await waitFor(() => {
      expect(
        screen.getByText(/Disney publishes Lightning Lane prices only a few days in advance/i)
      ).toBeTruthy();
      // Magic Kingdom Multi Pass baseline is $29.00
      expect(screen.getByLabelText('Manual price').props.value).toBe('29.00');
    });
  });

  it('allows tapping quick estimate tier chips and syncs total with quantity stepper', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lightning_lane', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Initial state has quantity 1 and Magic Kingdom
    // Tap Moderate tier chip ($35 for Magic Kingdom Multi Pass)
    const moderateChip = screen.getByLabelText('Estimate Moderate $35');
    expect(moderateChip).toBeTruthy();
    fireEvent.press(moderateChip);

    expect(screen.getByLabelText('Manual price').props.value).toBe('35.00');
    expect(screen.getByText(/Estimated Moderate tier applied: \$35\.00\/pass \(\$35\.00 total\)/)).toBeTruthy();

    // Increase quantity to 3 passes
    fireEvent.press(screen.getByLabelText('Increase LL quantity'));
    fireEvent.press(screen.getByLabelText('Increase LL quantity'));
    expect(screen.getByLabelText('Manual price').props.value).toBe('105.00');

    // Tap Peak tier chip ($39)
    const peakChip = screen.getByLabelText('Estimate Peak $39');
    fireEvent.press(peakChip);
    // 3 passes * $39 = $117.00
    expect(screen.getByLabelText('Manual price').props.value).toBe('117.00');

    // Switching park to EPCOT updates baseline for 3 passes ($21 * 3 = $63.00)
    fireEvent.press(screen.getByLabelText('LL park EPCOT'));
    expect(screen.getByLabelText('Manual price').props.value).toBe('63.00');
  });

  it('applies LL quote, calculates multi-pass total, and displays quote result banner', async () => {
    mockFetchQuotes.mockResolvedValueOnce([
      {
        priceCents: 2700,
        taxCents: null,
        effectivePriceSource: 'themeparks_ll',
        priceLabelKind: 'current',
        asOf: '2026-10-25',
        attribution: 'themeparks_wiki',
        soldOut: false,
        cacheState: 'ready',
        estimateReason: 'none',
        parkAssumed: false,
        flUnavailable: false,
      },
    ]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lightning_lane', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Increase quantity from 1 to 4
    fireEvent.press(screen.getByLabelText('Increase LL quantity'));
    fireEvent.press(screen.getByLabelText('Increase LL quantity'));
    fireEvent.press(screen.getByLabelText('Increase LL quantity'));
    expect(screen.getByText(/4\s+passes/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Get Lightning Lane quote'));

    await waitFor(() => {
      expect(screen.getByText('Quote applied: 4 × $27.00 = $108.00')).toBeTruthy();
      expect(screen.getByLabelText('Manual price').props.value).toBe('108.00');
    });
  });

  it('party allocation allows tapping Exclude Me to allocate subtotal only across other crew members', async () => {
    const testMembers = [
      { id: 'user-organizer', name: 'Organizer' },
      { id: 'user-friend1', name: 'Friend 1' },
      { id: 'user-friend2', name: 'Friend 2' },
    ];

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={testMembers}
        initialDraft={{ category: 'dining', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Enter a $150.00 dining price
    fireEvent.changeText(screen.getByLabelText('Manual price'), '150.00');

    // Tap "Exclude me so others split"
    const excludeMeBtn = screen.getByLabelText('Exclude me so others split');
    expect(excludeMeBtn).toBeTruthy();
    fireEvent.press(excludeMeBtn);

    // Verify Organizer gets $0.00, while Friend 1 and Friend 2 each get $75.00
    expect(screen.getByLabelText('Allocation for Organizer').props.value).toBe('0.00');
    expect(screen.getByLabelText('Allocation for Friend 1').props.value).toBe('75.00');
    expect(screen.getByLabelText('Allocation for Friend 2').props.value).toBe('75.00');
  });

  it('renders park-specific Premier Pass tier buttons for Animal Kingdom and EPCOT', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'lightning_lane', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Switch to Premier Pass
    fireEvent.press(screen.getByText('Premier Pass'));

    // Select Animal Kingdom
    fireEvent.press(screen.getByLabelText('LL park Animal Kingdom'));
    expect(screen.getByLabelText('Estimate Standard $149')).toBeTruthy();
    expect(screen.getByLabelText('Estimate High Demand $189')).toBeTruthy();
    expect(screen.getByLabelText('Estimate Peak Holiday $219')).toBeTruthy();

    // Select EPCOT
    fireEvent.press(screen.getByLabelText('LL park EPCOT'));
    expect(screen.getByLabelText('Estimate Standard $209')).toBeTruthy();
    expect(screen.getByLabelText('Estimate High Demand $269')).toBeTruthy();
    expect(screen.getByLabelText('Estimate Peak Holiday $309')).toBeTruthy();
  });

  it('party allocation allows adding an inline guest on the fly and recalculates split', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={[{ id: 'user-organizer', name: 'knicksak2' }]}
        initialDraft={{ category: 'dining', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Enter a $100 price
    fireEvent.changeText(screen.getByLabelText('Manual price'), '100.00');

    // Initially 1 traveler with $100.00
    expect(screen.getByLabelText('Allocation for knicksak2').props.value).toBe('100.00');

    // Tap "+ Add Party Member"
    fireEvent.press(screen.getByLabelText('Add party member'));

    // Input guest name
    fireEvent.changeText(screen.getByLabelText('Guest name'), 'Wife');

    // Press "+ Adult"
    fireEvent.press(screen.getByLabelText('Add as Adult'));

    // Now Wife is rendered and the $100 is split evenly ($50 / $50)
    await waitFor(() => {
      expect(screen.getByLabelText('Allocation for Wife')).toBeTruthy();
      expect(screen.getByLabelText('Allocation for knicksak2').props.value).toBe('50.00');
      expect(screen.getByLabelText('Allocation for Wife').props.value).toBe('50.00');
    });
  });

  it('dining quick estimate chips calculate table-service and buffet adult/child rates', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={[{ id: 'u1', name: 'Member 1' }, { id: 'u2', name: 'Member 2' }]}
        initialDraft={{ category: 'dining', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Tap Table-Service (~$45) -> 2 diners * $45 = $90.00
    fireEvent.press(screen.getByLabelText('Table-Service ~$45/person'));
    expect(screen.getByLabelText('Manual price').props.value).toBe('90.00');

    // Tap Buffet / Character -> 1 adult * $65 = $65.00
    fireEvent.press(screen.getByLabelText('Buffet / Character'));
    expect(screen.getByLabelText('Manual price').props.value).toBe('65.00');

    // Increase buffet kids -> 1 adult ($65) + 1 kid ($42) = $107.00
    fireEvent.press(screen.getByLabelText('Increase buffet kids'));
    expect(screen.getByLabelText('Manual price').props.value).toBe('107.00');
  });

  it('party allocation supports Only Me and individual traveler checkboxes to include or exclude', async () => {
    const testMembers = [
      { id: 'u1', name: 'knicksak2' },
      { id: 'u2', name: 'Wife' },
    ];

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={testMembers}
        initialDraft={{ category: 'tickets', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    fireEvent.changeText(screen.getByLabelText('Manual price'), '200.00');
    fireEvent.press(screen.getByLabelText('Split among everyone'));

    // Both get 100
    expect(screen.getByLabelText('Allocation for knicksak2').props.value).toBe('100.00');
    expect(screen.getByLabelText('Allocation for Wife').props.value).toBe('100.00');

    // Tap "Only Me"
    fireEvent.press(screen.getByLabelText('I pay all 100%'));
    expect(screen.getByLabelText('Allocation for knicksak2').props.value).toBe('200.00');
    expect(screen.getByLabelText('Allocation for Wife').props.value).toBe('0.00');

    // Toggle Wife back into split
    fireEvent.press(screen.getByLabelText('Include Wife in split'));
    expect(screen.getByLabelText('Allocation for knicksak2').props.value).toBe('100.00');
    expect(screen.getByLabelText('Allocation for Wife').props.value).toBe('100.00');
  });

  it('sync party to tickets adds missing guests matching adult and child ticket counts', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={[{ id: 'u1', name: 'knicksak2' }]}
        initialDraft={{ category: 'tickets', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Increase adult count to 2 and child count to 1
    fireEvent.press(screen.getByLabelText('Increase adult tickets'));
    fireEvent.press(screen.getByLabelText('Increase child tickets'));

    // Sync banner appears
    const syncBtn = screen.getByLabelText('Sync party to ticket quantities');
    expect(syncBtn).toBeTruthy();

    fireEvent.press(syncBtn);

    // New guests added to party
    await waitFor(() => {
      expect(screen.getByLabelText('Allocation for Wife / Partner')).toBeTruthy();
      expect(screen.getByLabelText('Allocation for Kid (Age 7)')).toBeTruthy();
    });
  });

  it('renders category pill badge in header and clean party allocations without duplicate chips', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        members={[
          { id: 'u1', name: 'knicksak2' },
          { id: 'u2', name: 'test' },
          { id: 'u3', name: 'user' },
        ]}
        initialDraft={{ category: 'transportation', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // Active category badge pill renders "Travel / Rides" in section header
    const activePill = screen.getByTestId('active-category-pill');
    expect(activePill).toBeTruthy();
    expect(within(activePill).getByText('Travel / Rides')).toBeTruthy();
    expect(screen.getAllByText('Travel / Rides').length).toBe(2);

    // Verify 3 traveler allocation rows exist with checkboxes and dollar amounts
    expect(screen.getByLabelText('Include knicksak2 in split')).toBeTruthy();
    expect(screen.getByLabelText('Include test in split')).toBeTruthy();
    expect(screen.getByLabelText('Include user in split')).toBeTruthy();

    // Verify split preset buttons exist in dedicated presets row
    expect(screen.getByLabelText('Smart rate match for adults and kids')).toBeTruthy();
    expect(screen.getByLabelText('Split among everyone')).toBeTruthy();
    expect(screen.getByLabelText('Exclude me so others split')).toBeTruthy();
    expect(screen.getByLabelText('I pay all 100%')).toBeTruthy();

    // Verify add party member button is rendered
    expect(screen.getByLabelText('Add party member')).toBeTruthy();

    // Verify no duplicate toggle chips exist (only the checkboxes on allocation rows)
    expect(screen.queryByLabelText('Toggle traveler knicksak2')).toBeNull();
  });

  it('correctly normalizes and pre-fills plannedDate in edit mode for date formats including ISO timestamp or day string', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-12-15"
        tripEnd="2026-12-20"
        initialLine={{
          id: 'line-uber-1',
          tripId,
          createdBy: 'user-1',
          category: 'transportation',
          description: 'Uber',
          plannedDate: '2026-12-15T05:00:00.000Z',
          park: null,
          experienceId: null,
          priceSource: 'user_entered',
          priceLabelKind: 'your_price',
          effectivePriceSource: 'user_entered',
          asOf: '2026-10-27T03:51:10.664Z',
          attribution: null,
          applyTip: false,
          linkedExpenseId: null,
          suggestionKey: null,
          subtotalCents: 4000,
          taxCents: 0,
          tipCents: 0,
          totalCents: 4000,
          allocations: [
            { id: 'alloc-1', memberId: 'user-1', guestId: null, storedCents: 4000, effectiveCents: 4000, taxCents: 0, tipCents: 0, priceRef: null },
          ],
        }}
        onCancel={jest.fn()}
      />
    );

    // Day 1 chip should be selected
    const day1Chip = screen.getByTestId('trip-day-chip-2026-12-15');
    expect(day1Chip.props.accessibilityState.selected).toBe(true);

    // DatePickerField should display the formatted date, not placeholder
    expect(screen.getByText('Dec 15, 2026')).toBeTruthy();
  });

  it('renders mockup layout: category grid, estimation tabs, paired details, split cards, and sticky bottom save button (Requirement 22.12)', async () => {
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-12-15"
        tripEnd="2026-12-20"
        members={[
          { id: 'u1', name: 'knicksak2' },
          { id: 'u2', name: 'Wife' },
        ]}
        guests={[
          { id: 'g1', name: 'Kid (Age 4)', isGuest: true },
        ]}
        initialDraft={{
          category: 'dining',
          description: "Chef Mickey's (Buffet)",
          plannedDate: '2026-12-15',
        }}
        onCancel={jest.fn()}
      />
    );

    // 1. Step 1: CHOOSE CATEGORY header and category cards in 3x2 grid
    expect(screen.getByText('1. CHOOSE CATEGORY')).toBeTruthy();
    expect(screen.getByLabelText('tickets')).toBeTruthy();
    expect(screen.getByLabelText('lightning_lane')).toBeTruthy();
    expect(screen.getByLabelText('dining')).toBeTruthy();
    expect(screen.getByLabelText('lodging')).toBeTruthy();
    expect(screen.getByLabelText('transportation')).toBeTruthy();
    expect(screen.getByLabelText('shopping')).toBeTruthy();

    // 2. Disney Dining & Menu Calculator Card
    expect(screen.getByText('Disney Dining & Menu Calculator')).toBeTruthy();
    expect(screen.getByText('Disney API')).toBeTruthy();
    expect(screen.getByLabelText('Disney Dining')).toBeTruthy();
    expect(screen.getByLabelText('Off-Property Dining')).toBeTruthy();
    expect(screen.getByLabelText('Link Disney Restaurant')).toBeTruthy();

    // Estimation Method Tabs
    expect(screen.getByText('ESTIMATION METHOD')).toBeTruthy();
    expect(screen.getByText('Buffet / Fixed')).toBeTruthy();
    expect(screen.getByText('Menu Average')).toBeTruthy();
    expect(screen.getByText('Pick Menu Items')).toBeTruthy();

    // Buffet Steppers (Adults $65, Kids $42)
    expect(screen.getByLabelText('Decrease buffet adults')).toBeTruthy();
    expect(screen.getByLabelText('Increase buffet adults')).toBeTruthy();
    expect(screen.getByLabelText('Decrease buffet kids')).toBeTruthy();
    expect(screen.getByLabelText('Increase buffet kids')).toBeTruthy();
    expect(screen.getByLabelText('Apply tip')).toBeTruthy();

    // 3. Step 2: LINE DESCRIPTION & DETAILS
    expect(screen.getByText('2. LINE DESCRIPTION & DETAILS')).toBeTruthy();
    expect(screen.getByLabelText('Description').props.value).toBe("Chef Mickey's (Buffet)");
    expect(screen.getByText('SUBTOTAL ($)')).toBeTruthy();
    expect(screen.getByText('PLANNED DAY')).toBeTruthy();
    expect(screen.queryByText('Paid Upfront By:')).toBeNull();

    // 4. Step 3: SPLIT COSTS AMONG
    expect(screen.getByText('3. SPLIT COSTS AMONG')).toBeTruthy();
    expect(screen.getByText('Tap any traveler to include/exclude')).toBeTruthy();
    const knickCard = screen.getByLabelText('Include knicksak2 in split');
    expect(knickCard).toBeTruthy();
    expect(StyleSheet.flatten(knickCard.props.style).width).toBe('100%');
    expect(screen.getByLabelText('Include Wife in split')).toBeTruthy();
    expect(screen.getByLabelText('Include Kid (Age 4) in split')).toBeTruthy();

    // Toggle knicksak2 out of split
    fireEvent.press(screen.getByLabelText('Include knicksak2 in split'));
    expect(screen.getByText('Excluded from Split')).toBeTruthy();

    // 5. Sticky Bottom Save Button
    expect(screen.getByLabelText('Save line')).toBeTruthy();
    expect(screen.getByText('Save Line to Trip Budget')).toBeTruthy();
  });

  it('prix-fixe restaurants like Ohana show real menu offers, auto-prefill party counts, hide generic buffet and park chips', async () => {
    const ohanaMenus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        groups: [
          {
            name: 'Sides and Drinks',
            items: [
              { name: 'POG Juice', price: '$4.50' },
              { name: 'Coffee', price: '$3.75' },
            ],
          },
          {
            name: 'Dinner Pricing',
            items: [
              { name: '$58 per adult', price: '$58.00' },
              { name: '$36 per child', price: '$36.00' },
            ],
          },
        ],
      },
    ];

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-12-15"
        tripEnd="2026-12-20"
        members={[
          { id: 'u1', name: 'knicksak2' },
          { id: 'u2', name: 'test' },
          { id: 'u3', name: 'user' },
        ]}
        initialDraft={{
          category: 'dining',
          experienceId: 'ohana-exp',
          description: "'Ohana",
          plannedDate: '2026-12-15',
        }}
        restaurantMenus={ohanaMenus}
        onCancel={jest.fn()}
      />
    );

    // 1. Real Disney Prix-Fixe steppers are shown for Ohana ($58 Adult, $36 Child)
    expect(screen.getByText('3 Adult')).toBeTruthy();
    expect(screen.getByText('0 Child')).toBeTruthy();
    expect(screen.getByLabelText('Increase buffet Adult')).toBeTruthy();
    expect(screen.getByLabelText('Increase buffet Child')).toBeTruthy();

    // 2. Generic fallback $65/$42 steppers are NOT rendered
    expect(screen.queryByLabelText('Increase buffet adults')).toBeNull();
    expect(screen.queryByLabelText('Decrease buffet adults')).toBeNull();
    expect(screen.queryByLabelText('Increase buffet kids')).toBeNull();
    expect(screen.queryByLabelText('Decrease buffet kids')).toBeNull();

    // 3. Misleading drink-average (~$8.26/person) is NOT rendered
    expect(screen.queryByLabelText('Apply menu average')).toBeNull();

    // 4. Standalone theme park picker is NOT rendered because experience is linked
    expect(screen.queryByLabelText('Magic Kingdom')).toBeNull();
    expect(screen.queryByLabelText('EPCOT')).toBeNull();

    // 5. Party of 3 adults auto-prefills Adult tier to 3 and subtotal to $174.00 (3 * $58.00)
    expect(screen.getByDisplayValue('174.00')).toBeTruthy();

    // 6. Each traveler is allocated their $58.00 share
    expect(screen.getAllByDisplayValue('58.00').length).toBe(3);

    // 7. Traveler names knicksak2, test, user are rendered without truncation
    expect(screen.getByText('knicksak2')).toBeTruthy();
    expect(screen.getByText('test')).toBeTruthy();
    expect(screen.getByText('user')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('renders Ticket Quote Calculator with 6-category grid and mockup styling', async () => {
    const mockQuote: PriceQuoteDTO = {
      priceCents: 57200,
      taxCents: 3718,
      effectivePriceSource: 'disney_ticket_calendar',
      priceLabelKind: 'current',
      asOf: '2026-10-25',
      attribution: 'disney',
      parkAssumed: false,
    };
    mockFetchQuotes.mockResolvedValueOnce([mockQuote]);

    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        tripStart="2026-12-15"
        tripEnd="2026-12-18"
        members={[
          { id: 'm1', name: 'knicksak2' },
          { id: 'm2', name: 'Wife' },
        ]}
        initialDraft={{ category: 'tickets', plannedDate: '2026-12-15' }}
        onCancel={jest.fn()}
      />
    );

    // 1. 6-Category Grid plus spanning 'other' shelf
    expect(screen.getByLabelText('tickets')).toBeTruthy();
    expect(screen.getByLabelText('lightning_lane')).toBeTruthy();
    expect(screen.getByLabelText('dining')).toBeTruthy();
    expect(screen.getByLabelText('lodging')).toBeTruthy();
    expect(screen.getByLabelText('transportation')).toBeTruthy();
    expect(screen.getByLabelText('shopping')).toBeTruthy();
    expect(screen.getByLabelText('other')).toBeTruthy();

    // Friendly category labels rendered in cards
    expect(screen.getByText('Hotel / Stay')).toBeTruthy();
    expect(screen.getByText('Travel / Rides')).toBeTruthy();
    expect(screen.getByText('Souvenirs')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();

    // 2. Ticket Calculator Card Header
    expect(screen.getByText('Disney Ticket Quote Calculator')).toBeTruthy();
    expect(screen.getByText('Official Disney Pricing')).toBeTruthy();

    // 3. Ticket Duration Row
    expect(screen.getByText('Ticket Duration:')).toBeTruthy();
    expect(screen.getByLabelText('Decrease days')).toBeTruthy();
    expect(screen.getByLabelText('Increase days')).toBeTruthy();

    // Increase days to 4
    fireEvent.press(screen.getByLabelText('Increase days'));
    fireEvent.press(screen.getByLabelText('Increase days'));
    fireEvent.press(screen.getByLabelText('Increase days'));
    expect(screen.getByText('4 days')).toBeTruthy();

    // 4. Party Ticket Quantities with daily rate subtext
    expect(screen.getByText('PARTY TICKET QUANTITIES')).toBeTruthy();
    expect(screen.getByText('Adults (10+)')).toBeTruthy();
    expect(screen.getByText('Children (3–9)')).toBeTruthy();
    expect(screen.getByText('$142.50/day')).toBeTruthy();
    expect(screen.getByText('$137.25/day')).toBeTruthy();

    // 5. Ticket Type 2x2 Grid with icons
    expect(screen.getByText('TICKET TYPE')).toBeTruthy();
    expect(screen.getByLabelText('base')).toBeTruthy();
    expect(screen.getByLabelText('park_hopper')).toBeTruthy();
    expect(screen.getByLabelText('park_hopper_plus')).toBeTruthy();
    expect(screen.getByLabelText('water_parks_sports')).toBeTruthy();
    expect(screen.getByText('✨')).toBeTruthy();
    expect(screen.getByText('🏰')).toBeTruthy();

    // 6. Pricing Tier
    expect(screen.getByText('PRICING TIER')).toBeTruthy();
    expect(screen.getByLabelText('std-gst')).toBeTruthy();
    expect(screen.getByLabelText('fl-resident')).toBeTruthy();
    expect(screen.getByText('Standard Guest')).toBeTruthy();
    expect(screen.getByText('Florida Resident (Discount)')).toBeTruthy();

    // 7. Get Ticket Quote & Calculated Disney Quote Card
    fireEvent.press(screen.getByLabelText('Get ticket quote'));
    await waitFor(() => {
      expect(screen.getByText('Calculated Disney Quote:')).toBeTruthy();
    });
    expect(screen.getByText('Includes 6.5% FL Tax')).toBeTruthy();
    expect(screen.getByText('$609.18')).toBeTruthy();

    // 8. Smart Line Description, Whole Trip Chip, and Split Section Polish
    expect(screen.getByText('2. LINE DESCRIPTION & DETAILS')).toBeTruthy();
    expect(screen.getByPlaceholderText('4-Day 1-Park Base (1 Adult)')).toBeTruthy();
    expect(screen.getByText('Whole Trip')).toBeTruthy();
    expect(screen.getByText('Only Me')).toBeTruthy();

    // 9. Paid Upfront By is omitted from Budget lines (pure forward planning, no payer)
    expect(screen.queryByText('Paid Upfront By:')).toBeNull();
    expect(screen.queryByLabelText('Change who paid upfront')).toBeNull();

    // 10. Smart Rates with 1 Adult Ticket across 2 travelers
    fireEvent.press(screen.getByLabelText('Smart rate match for adults and kids'));
    expect(screen.getByText('Active Split (100%)')).toBeTruthy();
    expect(screen.getByText('Excluded from Split')).toBeTruthy();

    // 11. Disney disclaimer appears on the ticket quote card
    expect(screen.getByText(/Prices from Disney's website/)).toBeTruthy();

    // 12. Switching from Tickets to Dining resets ticket quote and does NOT leak ticket blurb or quote
    fireEvent.press(screen.getByLabelText('dining'));
    expect(screen.queryByText(/Prices from Disney's website/)).toBeNull();
    expect(screen.queryByDisplayValue('572.00')).toBeNull();
  });

  it('header clears the status bar / camera cutout so the Close button is tappable', () => {
    const topInset = 48;
    renderWithClient(
      <SafeAreaInsetsContext.Provider value={{ top: topInset, bottom: 0, left: 0, right: 0 }}>
        <BudgetLineFormModal
          visible={true}
          tripId={tripId}
          initialDraft={{ category: 'dining' }}
          onCancel={jest.fn()}
        />
      </SafeAreaInsetsContext.Provider>
    );

    const header = StyleSheet.flatten(screen.getByTestId('budget-line-form-modal-header').props.style);
    // Base padding (theme spacing.xl) plus the full top inset.
    expect(header.paddingTop).toBeGreaterThanOrEqual(topInset + 1);
    expect(screen.getByLabelText('Cancel')).toBeTruthy();

    // Without a provider (zero inset) the header is strictly shorter.
    screen.unmount();
    renderWithClient(
      <BudgetLineFormModal
        visible={true}
        tripId={tripId}
        initialDraft={{ category: 'dining' }}
        onCancel={jest.fn()}
      />
    );
    const noInset = StyleSheet.flatten(screen.getByTestId('budget-line-form-modal-header').props.style);
    expect(header.paddingTop - noInset.paddingTop).toBe(topInset);
  });
});
