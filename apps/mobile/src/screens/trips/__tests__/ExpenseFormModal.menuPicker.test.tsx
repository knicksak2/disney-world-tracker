/**
 * ExpenseFormModal menu picker and tax/gratuity integration tests (Task 19.1).
 *
 * Validates: trip-expenses Requirement 16 (16.1 - 16.8), Property 19, Property 20, Property 21
 *            trip-budget Property 42
 */

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import {
  bpsOf,
  BUDGET_DEFAULT_TAX_BPS,
  BUDGET_DEFAULT_DINING_TIP_BPS,
  type MenuDTO,
  type TripMemberDTO,
} from '@dwt/shared';

// Mocks
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

jest.mock('../tripExpenseApi', () => {
  const actual = jest.requireActual('../tripExpenseApi');
  return {
    __esModule: true,
    ...actual,
    createExpense: jest.fn(),
    editExpense: jest.fn(),
    fetchTripGuests: jest.fn().mockResolvedValue([]),
  };
});

import { ExpenseFormModal } from '../ExpenseFormModal';
import { apiRequest } from '../../../api/client';
import { createExpense, editExpense } from '../tripExpenseApi';

const mockedApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;
const mockedCreateExpense = createExpense as jest.MockedFunction<typeof createExpense>;
const mockedEditExpense = editExpense as jest.MockedFunction<typeof editExpense>;

const TRIP_ID = 'trip-100';
const USER_1 = 'user-1';
const USER_2 = 'user-2';

const MEMBERS: TripMemberDTO[] = [
  {
    userId: USER_1,
    displayName: 'Alice',
    avatarPreset: null,
    role: 'organizer',
  },
  {
    userId: USER_2,
    displayName: 'Bob',
    avatarPreset: null,
    role: 'member',
  },
];

const MOCK_MENUS: MenuDTO[] = [
  {
    menuType: 'Dinner',
    groups: [
      {
        name: 'Entrees',
        items: [
          {
            name: 'Steak',
            price: '$45.00',
            priceCents: 4500,
          },
          {
            name: 'Chicken',
            price: '$28.00',
            priceCents: 2800,
          },
          {
            name: 'Market Fish',
            price: null,
          },
        ],
      },
      {
        name: 'Beverages',
        type: 'Alcoholic Beverage',
        items: [
          {
            name: 'Red Wine',
            price: '$16.00',
            priceCents: 1600,
          },
        ],
      },
    ],
  },
];

const PRIX_FIXE_MENUS: MenuDTO[] = [
  {
    menuType: 'Dinner',
    groups: [
      {
        name: 'Prix Fixe Offering',
        items: [
          {
            name: 'Adult: $65.00',
            price: '$65.00',
            priceCents: 6500,
          },
          {
            name: 'Child: $40.00',
            price: '$40.00',
            priceCents: 4000,
          },
        ],
      },
    ],
  },
];

const PRICELESS_MENUS: MenuDTO[] = [
  {
    menuType: 'Dinner',
    groups: [
      {
        name: 'Daily Specials',
        items: [
          {
            name: 'Catch of the Day',
            price: null,
          },
        ],
      },
    ],
  },
];

function renderModal(props: Partial<React.ComponentProps<typeof ExpenseFormModal>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ExpenseFormModal
        visible={true}
        tripId={TRIP_ID}
        members={MEMBERS}
        guests={[]}
        callerId={USER_1}
        onClose={jest.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('ExpenseFormModal - Menu Item Picker Integration (Task 19.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Pick from menu control appears only for itemized with linked restaurant having priced items', async () => {
    mockedApiRequest.mockImplementation(async (_method, path) => {
      if (path === '/catalog/exp-rest-1') {
        return { menus: MOCK_MENUS };
      }
      return {};
    });

    // 1. Itemized with linked restaurant and cached menu -> Present
    const { unmount } = renderModal({
      initialExpense: {
        id: 'exp-init-1',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: 'Be Our Guest',
        splitMode: 'itemized',
        experienceId: 'exp-rest-1',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Pick from menu')).toBeTruthy();
    });
    unmount();

    // 2. SplitMode even -> Absent
    const r2 = renderModal({
      initialExpense: {
        id: 'exp-init-2',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 5000,
        date: '2026-11-01',
        category: 'dining',
        description: 'Be Our Guest',
        splitMode: 'even',
        experienceId: 'exp-rest-1',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });
    expect(r2.queryByLabelText('Pick from menu')).toBeNull();
    r2.unmount();

    // 3. Unlinked restaurant (experienceId: null) -> Absent
    const r3 = renderModal({
      initialExpense: {
        id: 'exp-init-3',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: 'Unknown restaurant',
        splitMode: 'itemized',
        experienceId: null,
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });
    expect(r3.queryByLabelText('Pick from menu')).toBeNull();
    r3.unmount();

    // 4. Linked restaurant with no cached menu (menus: []) -> Absent
    mockedApiRequest.mockResolvedValueOnce({ menus: [] });
    const r4 = renderModal({
      initialExpense: {
        id: 'exp-init-4',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: 'Restaurant without menus',
        splitMode: 'itemized',
        experienceId: 'exp-no-menu',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });
    expect(r4.queryByLabelText('Pick from menu')).toBeNull();
    r4.unmount();

    // 5. Linked restaurant with only priceless items -> Absent
    mockedApiRequest.mockResolvedValueOnce({ menus: PRICELESS_MENUS });
    const r5 = renderModal({
      initialExpense: {
        id: 'exp-init-5',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: 'Priceless menu',
        splitMode: 'itemized',
        experienceId: 'exp-priceless',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });
    expect(r5.queryByLabelText('Pick from menu')).toBeNull();
    r5.unmount();
  });

  test('confirming picker appends editable draft rows with exact key set {name, priceCents, assigneeIds, isAlcohol} and pre-checks alcohol', async () => {
    mockedApiRequest.mockResolvedValue({ menus: MOCK_MENUS });
    mockedCreateExpense.mockResolvedValue({ id: 'exp-new-1' } as any);

    renderModal({
      initialExpense: {
        id: 'exp-init-1',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: 'Dinner at Steakhouse',
        splitMode: 'itemized',
        experienceId: 'exp-rest-1',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });

    // 1. Wait for "Pick from menu" and open
    await screen.findByLabelText('Pick from menu');
    fireEvent.press(screen.getByLabelText('Pick from menu'));

    // 2. Select Steak ($45.00) and Red Wine ($16.00, alcoholic beverage group)
    await screen.findByText('Steak');
    fireEvent.press(screen.getByLabelText('Steak'));
    fireEvent.press(screen.getByLabelText('Red Wine'));

    // Confirm selection
    fireEvent.press(screen.getByLabelText('Confirm selection'));

    // 3. Confirm items are appended to form
    await waitFor(() => {
      expect(screen.getByDisplayValue('Steak')).toBeTruthy();
      expect(screen.getByDisplayValue('Red Wine')).toBeTruthy();
    });

    // Edit Steak name and price to confirm it is fully editable
    fireEvent.changeText(screen.getByDisplayValue('Steak'), 'Prime Ribeye Steak');
    fireEvent.changeText(screen.getByDisplayValue('45.00'), '55.00');

    // 4. Submit the Expense form
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(mockedEditExpense).toHaveBeenCalled();
    });

    const calledPayload = mockedEditExpense.mock.calls[0]![2] as any;
    expect(calledPayload.items).toHaveLength(2);

    // Assert exact key set: {name, priceCents, assigneeIds, isAlcohol} only
    for (const item of calledPayload.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['assigneeIds', 'isAlcohol', 'name', 'priceCents'].sort(),
      );
    }

    // Assert edited item values and alcohol pre-check
    expect(calledPayload.items[0]).toEqual({
      name: 'Prime Ribeye Steak',
      priceCents: 5500,
      assigneeIds: [USER_1, USER_2],
      isAlcohol: false,
    });

    expect(calledPayload.items[1]).toEqual({
      name: 'Red Wine',
      priceCents: 1600,
      assigneeIds: [USER_1, USER_2],
      isAlcohol: true,
    });
  });

  test('tiered flow offers suggestions from prix fixe menus and discarded offer is absent from body (Property 20)', async () => {
    mockedApiRequest.mockResolvedValue({ menus: PRIX_FIXE_MENUS });
    mockedCreateExpense.mockResolvedValue({ id: 'exp-new-2' } as any);

    const { unmount } = renderModal({
      initialExpense: {
        id: 'exp-init-2',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: 'Prix Fixe Feast',
        splitMode: 'tiered',
        experienceId: 'exp-pf-1',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });

    // 1. Menu Pricing Suggestions card appears
    await screen.findByTestId('tier-suggestions-banner');
    expect(screen.getByText('Menu Pricing Suggestions')).toBeTruthy();
    expect(screen.getByText(/Adult: \$65\.00/)).toBeTruthy();
    expect(screen.getByText(/Child: \$40\.00/)).toBeTruthy();

    // 2. Discarding removes the banner without making any network call
    fireEvent.press(screen.getByTestId('discard-tier-suggestions-btn'));
    expect(screen.queryByTestId('tier-suggestions-banner')).toBeNull();
    expect(mockedCreateExpense).not.toHaveBeenCalled();

    unmount();

    // 3. Applying suggestions populates the tiers
    renderModal({
      initialExpense: {
        id: 'exp-init-3',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: 'Prix Fixe Feast 2',
        splitMode: 'tiered',
        experienceId: 'exp-pf-1',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });

    await screen.findByTestId('tier-suggestions-banner');
    fireEvent.press(screen.getByTestId('apply-tier-suggestions-btn'));

    // Check applied tiers are in the form inputs
    expect(screen.getByDisplayValue('Adult')).toBeTruthy();
    expect(screen.getByDisplayValue('65.00')).toBeTruthy();
    expect(screen.getByDisplayValue('Child')).toBeTruthy();
    expect(screen.getByDisplayValue('40.00')).toBeTruthy();
  });

  test('Add estimated tax and Add estimated gratuity actions (Property 42, trip-expenses Property 16)', async () => {
    mockedApiRequest.mockResolvedValue({ menus: MOCK_MENUS });
    mockedCreateExpense.mockResolvedValue({ id: 'exp-new-tax' } as any);

    renderModal({
      initialExpense: {
        id: 'exp-init-tax',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 10000,
        date: '2026-11-01',
        category: 'dining',
        description: 'Dinner with Tax and Tip',
        splitMode: 'itemized',
        experienceId: 'exp-rest-1',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [
          {
            id: 'item-1',
            expenseId: 'exp-init-tax',
            name: 'Food Subtotal Item',
            priceCents: 10000, // $100.00
            isAlcohol: false,
            assigneeIds: [USER_1],
          },
        ],
        chargeLines: [],
        refunds: [],
      },
    });

    // 1. Controls are found by accessibility label
    const addTaxBtn = await screen.findByLabelText('Add estimated tax');
    const addTipBtn = screen.getByLabelText('Add estimated gratuity');
    expect(addTaxBtn).toBeTruthy();
    expect(addTipBtn).toBeTruthy();

    // Initial amount display is $100.00 and no charge lines exist
    expect(screen.queryByTestId('charge-line-0')).toBeNull();
    expect(screen.getByText('$100.00')).toBeTruthy();

    // 2. Press "Add estimated tax": appends tax Charge_Line equal to bpsOf(10000, 650) = 650 cents ($6.50)
    const expectedTax = bpsOf(10000, BUDGET_DEFAULT_TAX_BPS.dining);
    expect(expectedTax).toBe(650);

    fireEvent.press(addTaxBtn);
    expect(screen.getByTestId('charge-line-0')).toBeTruthy();
    expect(within(screen.getByTestId('charge-line-0')).getByDisplayValue('6.50')).toBeTruthy();

    // On-screen amount changed to $106.50
    expect(screen.getByText('$106.50')).toBeTruthy();

    // 3. Press "Add estimated gratuity": appends gratuity Charge_Line equal to bpsOf(10000, 1800) = 1800 cents ($18.00)
    const expectedTip = bpsOf(10000, BUDGET_DEFAULT_DINING_TIP_BPS);
    expect(expectedTip).toBe(1800);

    fireEvent.press(addTipBtn);
    expect(screen.getByTestId('charge-line-1')).toBeTruthy();
    expect(within(screen.getByTestId('charge-line-1')).getByDisplayValue('18.00')).toBeTruthy();

    // On-screen amount changed to $124.50
    expect(screen.getByText('$124.50')).toBeTruthy();

    // 4. Edit tax charge line to $7.00
    fireEvent.changeText(within(screen.getByTestId('charge-line-0')).getByDisplayValue('6.50'), '7.00');
    expect(screen.getByText('$125.00')).toBeTruthy();

    // 5. Submit form and verify payload contains edited charges
    fireEvent.press(screen.getByTestId('submit-expense-button'));

    await waitFor(() => {
      expect(mockedEditExpense).toHaveBeenCalled();
    });

    const calledPayload = mockedEditExpense.mock.calls[0]![2] as any;
    expect(calledPayload.chargeLines).toHaveLength(2);
    expect(calledPayload.chargeLines[0]).toEqual(
      expect.objectContaining({
        kind: 'tax',
        amountCents: 700,
      }),
    );
    expect(calledPayload.chargeLines[1]).toEqual(
      expect.objectContaining({
        kind: 'gratuity',
        amountCents: 1800,
      }),
    );
  });
});