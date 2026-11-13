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
} from '@dwt/shared';
import type { MenuDTO, TripMemberDTO } from '@dwt/shared';

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

  test('linked restaurant renders hero menu hook-up bar and opens menu picker from hero in any split mode', async () => {
    mockedApiRequest.mockResolvedValue({ menus: MOCK_MENUS, name: "Chef Mickey's" });

    renderModal({
      initialExpense: {
        id: 'exp-hero-menu-1',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 5000,
        date: '2026-11-01',
        category: 'dining',
        description: "Chef Mickey's",
        splitMode: 'even',
        experienceId: 'exp-chef-mickeys',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });

    // 1. Linked restaurant menu hook-up bar is rendered in hero card
    await screen.findByTestId('hero-linked-menu-bar');
    expect(screen.getByText("Chef Mickey's • Menu Available")).toBeTruthy();

    const viewMenuBtn = screen.getByTestId('hero-view-menu-button');
    expect(viewMenuBtn).toBeTruthy();

    // 2. Tapping "View Menu" opens the menu item picker
    fireEvent.press(viewMenuBtn);
    await screen.findByText('Steak');
    expect(screen.getByText('Chicken')).toBeTruthy();

    // 3. Canceling closes the menu picker without altering split mode
    fireEvent.press(within(screen.getByTestId('expense-menu-item-picker')).getByLabelText('Cancel'));
    expect(screen.queryByText('Steak')).toBeNull();
    expect(screen.getByTestId('split-mode-chip-even')).toBeTruthy();
  });

  test('applied suggested tiers persist across split mode tab switches and do not reset to defaults', async () => {
    mockedApiRequest.mockResolvedValue({ menus: PRIX_FIXE_MENUS, name: "Chef Mickey's" });

    renderModal({
      initialExpense: {
        id: 'exp-tier-persist-1',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 10500,
        date: '2026-11-01',
        category: 'dining',
        description: "Chef Mickey's",
        splitMode: 'tiered',
        experienceId: 'exp-chef-mickeys',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });

    // 1. Suggestions banner appears and user applies suggestions
    await screen.findByTestId('tier-suggestions-banner');
    fireEvent.press(screen.getByTestId('apply-tier-suggestions-btn'));

    // Applied values are Adult $65.00 and Child $40.00
    expect(screen.getByDisplayValue('Adult')).toBeTruthy();
    expect(screen.getByDisplayValue('65.00')).toBeTruthy();
    expect(screen.getByDisplayValue('Child')).toBeTruthy();
    expect(screen.getByDisplayValue('40.00')).toBeTruthy();
    expect(screen.getByTestId('tier-applied-indicator')).toBeTruthy();

    // 2. User switches to EXACT split mode tab
    fireEvent.press(screen.getByTestId('split-mode-chip-exact'));
    expect(screen.getByText('PER-PERSON SHARES')).toBeTruthy();

    // 3. User switches back to TIERED split mode tab
    fireEvent.press(screen.getByTestId('split-mode-chip-tiered'));

    // 4. Assert tiers did NOT reset to random $50.00 / $30.00 default!
    expect(screen.getByDisplayValue('Adult')).toBeTruthy();
    expect(screen.getByDisplayValue('65.00')).toBeTruthy();
    expect(screen.getByDisplayValue('Child')).toBeTruthy();
    expect(screen.getByDisplayValue('40.00')).toBeTruthy();
    expect(screen.queryByDisplayValue('50.00')).toBeNull();
    expect(screen.queryByDisplayValue('30.00')).toBeNull();

    // 5. Menu Suggestions button in header allows re-applying at any time
    expect(screen.getByTestId('reapply-tier-suggestions-btn')).toBeTruthy();
    expect(screen.getByTestId('tiered-pick-from-menu-button')).toBeTruthy();
  });

  test('itemized mode shows prominent menu prompt card when empty and dual add buttons when populated', async () => {
    mockedApiRequest.mockResolvedValue({ name: 'Steakhouse 71', menus: MOCK_MENUS });

    renderModal({
      initialExpense: {
        id: 'exp-init-empty-itemized',
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

    // 1. In empty state with cached menu, prominent prompt card is visible
    expect(await screen.findByTestId('itemized-empty-prompt')).toBeTruthy();
    expect(screen.getByText('Steakhouse 71 Menu Available')).toBeTruthy();
    expect(screen.getByTestId('pick-from-menu-button')).toBeTruthy();
    expect(screen.getByTestId('add-item-btn')).toBeTruthy();
    expect(screen.getByText('CALCULATED TOTAL')).toBeTruthy();
    expect(screen.getByText('Auto-Calculated')).toBeTruthy();
    // Header row buttons are not duplicated above the prompt card when items are empty
    expect(screen.queryByTestId('itemized-header-menu-btn')).toBeNull();
    expect(screen.queryByTestId('itemized-header-custom-btn')).toBeNull();

    // 2. Tapping custom item adds an item card and switches to dual action row
    fireEvent.press(screen.getByTestId('add-item-btn'));
    expect(screen.getByTestId('item-card-0')).toBeTruthy();
    expect(screen.queryByTestId('itemized-empty-prompt')).toBeNull();
    // Now that items exist, header row quick actions become accessible
    expect(screen.getByTestId('itemized-header-menu-btn')).toBeTruthy();
    expect(screen.getByTestId('itemized-header-custom-btn')).toBeTruthy();

    // 3. Below the item card, both "+ From Menu" and "+ Custom Item" are accessible
    expect(screen.getByTestId('pick-from-menu-button')).toBeTruthy();
    expect(screen.getByText('+ From Menu')).toBeTruthy();
    expect(screen.getByText('+ Custom Item')).toBeTruthy();
  });

  test('confirming combined buffet tiers and drinks appends all as itemized rows and switches splitMode to itemized', async () => {
    const combinedMenus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        groups: [
          {
            name: "'Ohana Dinner Pricing",
            items: [
              { name: '$69 per adult, plus tax and gratuity' },
              { name: '$46 per child (Guests ages 3-9), plus tax and gratuity' },
            ],
          },
          {
            name: 'Specialty Cocktails',
            type: 'Alcoholic Beverage',
            items: [
              { name: 'Lapu Lapu', priceCents: 2400 },
            ],
          },
        ],
      },
    ];

    mockedApiRequest.mockResolvedValue({ menus: combinedMenus });
    mockedCreateExpense.mockResolvedValue({ id: 'exp-combined-1' } as any);

    renderModal({
      initialExpense: {
        id: 'exp-init-combined',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 0,
        date: '2026-11-01',
        category: 'dining',
        description: "'Ohana Dinner",
        splitMode: 'itemized',
        experienceId: 'exp-ohana',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [],
        chargeLines: [],
        refunds: [],
      },
    });

    // Open Menu Item Picker
    const pickBtn = await screen.findByTestId('pick-from-menu-button');
    fireEvent.press(pickBtn);

    // Select Adult buffet tier ($69.00)
    await screen.findByLabelText('Adult: $69.00');
    fireEvent.press(screen.getByLabelText('Adult: $69.00'));

    // Select Lapu Lapu ($24.00)
    fireEvent.press(screen.getByLabelText('Lapu Lapu'));

    // Subtotal should be $69 + $24 = $93.00
    expect(screen.getByText('Subtotal: $93.00')).toBeTruthy();

    // Confirm
    fireEvent.press(screen.getByLabelText('Confirm selection'));

    // Picker closes, itemized mode shows both rows
    await waitFor(() => {
      expect(screen.queryByTestId('expense-menu-item-picker')).toBeNull();
    });

    // Submitting expense sends both items
    const submitBtn = screen.getByTestId('submit-expense-button');
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(mockedEditExpense).toHaveBeenCalledTimes(1);
    });

    const calledPayload = mockedEditExpense.mock.calls[0]![2] as any;
    expect(calledPayload.items).toHaveLength(2);
    expect(calledPayload.items[0]).toEqual({
      name: 'Adult',
      priceCents: 6900,
      assigneeIds: [USER_1, USER_2],
      isAlcohol: false,
    });
    expect(calledPayload.items[1]).toEqual({
      name: 'Lapu Lapu',
      priceCents: 2400,
      assigneeIds: [USER_1, USER_2],
      isAlcohol: true,
    });
  });

  it('calculates discount percentage accurately against eligible items excluding alcohol (Req 14.5, Property 22)', async () => {
    mockedApiRequest.mockResolvedValue({ menus: [] });
    renderModal({
      initialExpense: {
        id: 'exp-discount-test',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 9300,
        description: "'Ohana Dinner",
        date: '2026-11-09',
        category: 'dining',
        splitMode: 'itemized',
        experienceId: 'exp-ohana',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [
          {
            id: 'item-1',
            expenseId: 'exp-discount-test',
            name: "'Ohana Dinner",
            priceCents: 6900,
            isAlcohol: false,
            assigneeIds: [USER_1, USER_2],
          },
          {
            id: 'item-2',
            expenseId: 'exp-discount-test',
            name: 'Lapu Lapu',
            priceCents: 2400,
            isAlcohol: true,
            assigneeIds: [USER_1, USER_2],
          },
        ],
        chargeLines: [],
        refunds: [],
      },
    });

    // Smart button shows 20%
    const addDiscountBtn = await screen.findByTestId('add-charge-discount');
    expect(addDiscountBtn).toHaveTextContent('+ Discount (20%)');

    // Tap + Discount (20%)
    fireEvent.press(addDiscountBtn);

    // Charge line appears with 20% of $69 non-alcohol = $13.80
    const chargeCard = await screen.findByTestId('charge-line-0');
    expect(chargeCard).toBeTruthy();
    const amountInput = screen.getByTestId('charge-amount-0');
    expect(amountInput.props.value).toBe('13.80');
    expect(screen.getByText(/20% of \$69\.00 non-alcoholic items/)).toBeTruthy();

    // Toggle Exclude Alcohol to OFF -> recalculates 20% of $93.00 = $18.60
    const excludeToggle = screen.getByTestId('discount-exclude-alcohol-0');
    fireEvent(excludeToggle, 'valueChange', false);
    expect(amountInput.props.value).toBe('18.60');
    expect(screen.getByText(/20% of \$93\.00 total items/)).toBeTruthy();

    // Tap 10% preset pill -> recalculates 10% of $93.00 = $9.30
    fireEvent.press(screen.getByTestId('discount-preset-10-0'));
    expect(amountInput.props.value).toBe('9.30');

    // Tap Flat $ preset pill -> switches to flat dollar mode
    fireEvent.press(screen.getByTestId('discount-mode-dollar-0'));
    fireEvent.changeText(amountInput, '15.00');
    expect(amountInput.props.value).toBe('15.00');

    // Submit expense
    const submitBtn = screen.getByTestId('submit-expense-button');
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(mockedEditExpense).toHaveBeenCalledTimes(1);
    });

    const calledPayload = mockedEditExpense.mock.calls[0]![2] as any;
    expect(calledPayload.chargeLines).toHaveLength(1);
    expect(calledPayload.chargeLines[0]).toEqual({
      kind: 'discount',
      amountCents: -1500,
      excludeAlcohol: false,
    });
  });

  test('custom percentage discount calculates against non-alcohol items and updates on custom input (Requirement 14.5)', async () => {
    mockedEditExpense.mockResolvedValue({ id: 'exp-discount-custom' } as any);

    renderModal({
      initialExpense: {
        id: 'exp-discount-custom',
        tripId: TRIP_ID,
        payerId: USER_1,
        createdByUserId: USER_1,
        amountCents: 9300,
        date: '2026-11-01',
        category: 'dining',
        description: "'Ohana Dinner with Drinks",
        splitMode: 'itemized',
        experienceId: 'exp-ohana',
        resortId: null,
        createdAt: '2026-10-25T12:00:00Z',
        shares: [],
        tiers: [],
        items: [
          {
            id: 'item-1',
            expenseId: 'exp-discount-custom',
            name: "'Ohana Dinner",
            priceCents: 6900,
            isAlcohol: false,
            assigneeIds: [USER_1, USER_2],
          },
          {
            id: 'item-2',
            expenseId: 'exp-discount-custom',
            name: 'Lapu Lapu',
            priceCents: 2400,
            isAlcohol: true,
            assigneeIds: [USER_1, USER_2],
          },
        ],
        chargeLines: [],
        refunds: [],
      },
    });

    // Tap + Discount (20%)
    const addDiscountBtn = await screen.findByTestId('add-charge-discount');
    fireEvent.press(addDiscountBtn);

    // Initial 20% calculation
    const amountInput = screen.getByTestId('charge-amount-0');
    expect(amountInput.props.value).toBe('13.80');

    // Tap Custom % preset pill
    const customPill = screen.getByTestId('discount-mode-custom-0');
    fireEvent.press(customPill);

    // Custom % text input appears with default 15% -> 15% of $69 = $10.35
    const customPctInput = screen.getByTestId('discount-custom-pct-input-0');
    expect(customPctInput.props.value).toBe('15');
    expect(amountInput.props.value).toBe('10.35');
    expect(screen.getByText(/15% of \$69\.00 non-alcoholic items/)).toBeTruthy();

    // Type 40% (e.g. Cast Member dining discount) -> 40% of $69 = $27.60
    fireEvent.changeText(customPctInput, '40');
    expect(amountInput.props.value).toBe('27.60');
    expect(screen.getByText(/40% of \$69\.00 non-alcoholic items \(excludes \$24\.00 alcohol\)/)).toBeTruthy();

    // Toggle Exclude Alcohol to OFF -> 40% of $93 = $37.20
    const excludeToggle = screen.getByTestId('discount-exclude-alcohol-0');
    fireEvent(excludeToggle, 'valueChange', false);
    expect(amountInput.props.value).toBe('37.20');
    expect(screen.getByText(/40% of \$93\.00 total items/)).toBeTruthy();

    // Submit expense
    const submitBtn = screen.getByTestId('submit-expense-button');
    fireEvent.press(submitBtn);

    await waitFor(() => {
      expect(mockedEditExpense).toHaveBeenCalledTimes(1);
    });

    const calledPayload = mockedEditExpense.mock.calls[0]![2] as any;
    expect(calledPayload.chargeLines).toHaveLength(1);
    expect(calledPayload.chargeLines[0]).toEqual({
      kind: 'discount',
      amountCents: -3720,
      excludeAlcohol: false,
    });
  });
});