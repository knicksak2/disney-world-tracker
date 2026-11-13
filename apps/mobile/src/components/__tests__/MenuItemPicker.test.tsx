// Feature: trip-budget, Property 27: Picker selections become valid Expense and Budget payloads
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.8, 9.10, 22.8

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { menuPriceRefSchema, type MenuDTO } from '@dwt/shared';

import { MenuItemPicker } from '../MenuItemPicker';
import { selectionToBudgetPriceRef } from '../menuItemPicker.pure';

const MOCK_MENUS: MenuDTO[] = [
  {
    menuType: 'Dinner',
    groups: [
      {
        name: 'Appetizers',
        type: 'Food',
        items: [
          {
            name: 'Soup of the Day',
            price: '$12 / $18',
            prices: [
              { cents: 1200, label: 'Cup' },
              { cents: 1800, label: 'Bowl' },
            ],
          },
          {
            name: 'Caesar Salad',
            priceCents: 1400,
          },
          {
            name: 'Market Fresh Catch',
            price: null,
          },
        ],
      },
      {
        name: 'Drinks',
        type: 'Alcoholic Beverage',
        items: [
          {
            name: 'Magical Cocktail',
            priceCents: 1650,
          },
        ],
      },
      {
        name: 'Breakfast Buffet Pricing - Adult and Child Rates ($49 per person)',
        type: 'Pricing Banner',
        items: [],
      },
    ],
  },
];

describe('MenuItemPicker (Task 17.3, Requirements 9.1-9.10)', () => {
  it('renders tax and gratuity note (Requirement 9.8)', () => {
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    const note = screen.getByLabelText('Menu prices are before tax and gratuity.');
    expect(note).toBeTruthy();
    expect(screen.getByText('Menu prices are before tax and gratuity.')).toBeTruthy();
  });

  it('selects an item and confirms payload', () => {
    const confirmSpy = jest.fn();
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // Toggle Caesar Salad
    const saladRow = screen.getByLabelText('Caesar Salad');
    fireEvent.press(saladRow);

    // Press Confirm
    const confirmBtn = screen.getByLabelText('Confirm selection');
    fireEvent.press(confirmBtn);

    expect(confirmSpy).toHaveBeenCalledWith({
      items: [
        {
          name: 'Caesar Salad',
          priceCents: 1400,
          priceLabel: null,
          quantity: 1,
          isAlcohol: false,
        },
      ],
    });
  });

  it('picks a size variant and updates price', () => {
    const confirmSpy = jest.fn();
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // Toggle Soup
    const soupRow = screen.getByLabelText('Soup of the Day');
    fireEvent.press(soupRow);

    // Pick 'Bowl: $18.00' variant
    const bowlVariant = screen.getByLabelText('Bowl: $18.00');
    fireEvent.press(bowlVariant);

    // Confirm
    fireEvent.press(screen.getByLabelText('Confirm selection'));

    expect(confirmSpy).toHaveBeenCalledWith({
      items: [
        {
          name: 'Soup of the Day',
          priceCents: 1800,
          priceLabel: 'Bowl',
          quantity: 1,
          isAlcohol: false,
        },
      ],
    });
  });

  it('raises item quantity with stepper', () => {
    const confirmSpy = jest.fn();
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // Toggle Salad
    fireEvent.press(screen.getByLabelText('Caesar Salad'));

    // Press + button
    const plusBtn = screen.getByLabelText('Increase quantity for Caesar Salad');
    fireEvent.press(plusBtn);

    // Confirm
    fireEvent.press(screen.getByLabelText('Confirm selection'));

    expect(confirmSpy).toHaveBeenCalledWith({
      items: [
        {
          name: 'Caesar Salad',
          priceCents: 1400,
          priceLabel: null,
          quantity: 2,
          isAlcohol: false,
        },
      ],
    });
  });

  it('requires typed price for priceless item before confirm', () => {
    const confirmSpy = jest.fn();
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // Select priceless item "Market Fresh Catch"
    fireEvent.press(screen.getByLabelText('Market Fresh Catch'));

    // Confirm should be disabled initially
    const confirmBtn = screen.getByLabelText('Confirm selection');
    fireEvent.press(confirmBtn);
    expect(confirmSpy).not.toHaveBeenCalled();

    // Type price "28.50"
    const priceInput = screen.getByLabelText('Price for Market Fresh Catch');
    fireEvent.changeText(priceInput, '28.50');

    // Confirm now succeeds
    fireEvent.press(confirmBtn);
    expect(confirmSpy).toHaveBeenCalledWith({
      items: [
        {
          name: 'Market Fresh Catch',
          priceCents: 2850,
          priceLabel: null,
          quantity: 1,
          isAlcohol: false,
        },
      ],
    });
  });

  it('pre-checks isAlcohol for item from Alcoholic Beverage group', () => {
    const confirmSpy = jest.fn();
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // Select Magical Cocktail
    fireEvent.press(screen.getByLabelText('Magical Cocktail'));

    // Confirm
    fireEvent.press(screen.getByLabelText('Confirm selection'));

    expect(confirmSpy).toHaveBeenCalledWith({
      items: [
        {
          name: 'Magical Cocktail',
          priceCents: 1650,
          priceLabel: null,
          quantity: 1,
          isAlcohol: true,
        },
      ],
    });
  });

  it('cancels and calls back', () => {
    const cancelSpy = jest.fn();
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={jest.fn()}
        onCancel={cancelSpy}
      />
    );

    fireEvent.press(screen.getByLabelText('Cancel'));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('choosing a prix fixe offer whose label is 60 characters yields tier.name of first 40 trimmed characters (round 5 L8)', () => {
    const confirmSpy = jest.fn();
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // Find the offer button for the 60+ char banner
    const offerLabelPrefix = 'Breakfast Buffet Pricing - Adult';
    const offerBtn = screen.getByText(new RegExp(offerLabelPrefix));
    expect(offerBtn).toBeTruthy();
    fireEvent.press(offerBtn);

    // Confirm
    fireEvent.press(screen.getByLabelText('Confirm selection'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const selection = confirmSpy.mock.calls[0]![0];
    expect(selection.tier).toBeDefined();

    // Round 5 L8: tier.name is at most 40 characters and valid under menuPriceRefSchema
    expect(selection.tier.name.length).toBeLessThanOrEqual(40);
    expect(selection.tier.priceCents).toBe(4900);

    const priceRef = selectionToBudgetPriceRef(selection);
    const parsed = menuPriceRefSchema.safeParse(priceRef);
    expect(parsed.success).toBe(true);
  });

  it('allows selecting both Adult and Child buffet tiers simultaneously with independent quantities (Requirement 9.12, Property 50b)', () => {
    const confirmSpy = jest.fn();
    const buffetMenus: MenuDTO[] = [
      {
        menuType: 'Dinner',
        groups: [
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

    render(
      <MenuItemPicker
        menus={buffetMenus}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // Select both Adult ($65.00) and Child ($40.00)
    fireEvent.press(screen.getByLabelText('Adult: $65.00'));
    fireEvent.press(screen.getByLabelText('Child: $40.00'));

    // Increment Adult quantity to 2
    fireEvent.press(screen.getByLabelText('Increase quantity for Adult'));

    // Subtotal should show 2 * $65 + 1 * $40 = $170.00
    expect(screen.getByText('Subtotal: $170.00')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Confirm selection'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const selection = confirmSpy.mock.calls[0]![0];
    expect(selection.tiers).toEqual([
      { name: 'Adult', priceCents: 6500, quantity: 2 },
      { name: 'Child', priceCents: 4000, quantity: 1 },
    ]);
  });

  it('deselects an item when decreasing quantity from 1 to 0 via stepper', () => {
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    // Select Caesar Salad
    const saladRow = screen.getByLabelText('Caesar Salad');
    fireEvent.press(saladRow);

    expect(screen.getByText('Subtotal: $14.00')).toBeTruthy();
    expect(screen.getByText('1 item selected')).toBeTruthy();

    // Decrease quantity from 1 -> 0
    const decBtn = screen.getByLabelText('Decrease quantity for Caesar Salad');
    fireEvent.press(decBtn);

    // Item should be deselected cleanly
    expect(screen.getByText('Subtotal: $0.00')).toBeTruthy();
    expect(screen.queryByLabelText('Decrease quantity for Caesar Salad')).toBeNull();
  });

  it('deselects an item when pressing the Remove button', () => {
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    // Select Caesar Salad
    fireEvent.press(screen.getByLabelText('Caesar Salad'));
    expect(screen.getByText('Subtotal: $14.00')).toBeTruthy();

    // Press Remove button
    const removeBtn = screen.getByLabelText('Remove Caesar Salad');
    fireEvent.press(removeBtn);

    expect(screen.getByText('Subtotal: $0.00')).toBeTruthy();
    expect(screen.queryByLabelText('Remove Caesar Salad')).toBeNull();
  });

  it('filters items in real time via search input and shows empty state', () => {
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    const searchInput = screen.getByTestId('menu-search-input');

    // Search for "Cocktail"
    fireEvent.changeText(searchInput, 'Cocktail');

    expect(screen.getByLabelText('Magical Cocktail')).toBeTruthy();
    expect(screen.queryByLabelText('Caesar Salad')).toBeNull();

    // Search for nonexistent item
    fireEvent.changeText(searchInput, 'Waffles');
    expect(screen.getByText('No menu items found')).toBeTruthy();

    // Reset filters button
    fireEvent.press(screen.getByLabelText('Reset filters and search'));
    expect(screen.getByLabelText('Caesar Salad')).toBeTruthy();
  });

  it('filters items using filter chips (Priced Items vs Drinks)', () => {
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    // Filter to Priced Items only (hides priceless items like Market Fresh Catch)
    fireEvent.press(screen.getByLabelText('Filter priced items only'));
    expect(screen.getByLabelText('Caesar Salad')).toBeTruthy();
    expect(screen.queryByLabelText('Market Fresh Catch')).toBeNull();

    // Filter to Drinks & Cocktails
    fireEvent.press(screen.getByLabelText('Filter drinks and cocktails'));
    expect(screen.getByLabelText('Magical Cocktail')).toBeTruthy();
    expect(screen.queryByLabelText('Caesar Salad')).toBeNull();

    // Return to All
    fireEvent.press(screen.getByLabelText('Filter all items'));
    expect(screen.getByLabelText('Caesar Salad')).toBeTruthy();
    expect(screen.getByLabelText('Market Fresh Catch')).toBeTruthy();
  });

  it('clears all selections via Clear All button in footer', () => {
    render(
      <MenuItemPicker
        menus={MOCK_MENUS}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    // Select Caesar Salad
    fireEvent.press(screen.getByLabelText('Caesar Salad'));
    expect(screen.getByText('1 item selected')).toBeTruthy();

    // Press Clear All
    const clearAllBtn = screen.getByLabelText('Clear all selections');
    fireEvent.press(clearAllBtn);

    expect(screen.getByText('0 items selected')).toBeTruthy();
    expect(screen.getByText('Subtotal: $0.00')).toBeTruthy();
    expect(screen.queryByLabelText('Clear all selections')).toBeNull();
  });

  it('filters by meal (Breakfast vs Dinner), separates rates, and suppresses duplicate price lines & included feast food items', () => {
    const multiMealMenus: MenuDTO[] = [
      {
        menuType: 'Breakfast',
        groups: [
          {
            name: "'Ohana Breakfast Pricing",
            items: [
              { name: '$58 per adult, plus tax and gratuity' },
              { name: '$36 per child (Guests ages 3-9), plus tax and gratuity' },
            ],
          },
          {
            name: "All-You-Care-To-Enjoy 'Ohana Breakfast",
            items: [
              { name: 'Freshly Made Pineapple-Coconut Breakfast Bread' },
              { name: 'Fresh Fruit' },
              { name: "'Ohana Breakfast Skillet" },
            ],
          },
          {
            name: 'Breakfast Specialties',
            type: 'Beverage',
            items: [
              { name: 'Lapu Lapu', priceCents: 2400 },
            ],
          },
        ],
      },
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
            name: "All-You-Care-To-Enjoy 'Ohana Dinner",
            items: [
              { name: "'Ohana Dinner Skillet" },
              { name: "'Ohana Bread Pudding" },
            ],
          },
          {
            name: 'Dinner Specialties',
            type: 'Alcoholic Beverage',
            items: [
              { name: 'Cold Brew Martini', priceCents: 1800 },
            ],
          },
        ],
      },
    ];

    render(
      <MenuItemPicker
        menus={multiMealMenus}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    // Initial meal is Breakfast: shows Breakfast buffet rates ($58 Adult, $36 Child)
    expect(screen.getByText('Prix Fixe & Buffet Pricing — Breakfast')).toBeTruthy();
    expect(screen.getByLabelText('Adult: $58.00')).toBeTruthy();
    expect(screen.getByLabelText('Child: $36.00')).toBeTruthy();

    // Duplicate pricing announcement rows ($58 per adult...) do NOT appear as item checkboxes
    expect(screen.queryByLabelText('$58 per adult, plus tax and gratuity')).toBeNull();

    // Included feast food items (Fresh Fruit, Skillet) are hidden from default view
    expect(screen.queryByLabelText('Fresh Fruit')).toBeNull();
    expect(screen.queryByLabelText("'Ohana Breakfast Skillet")).toBeNull();

    // Billable drink shows
    expect(screen.getByLabelText('Lapu Lapu')).toBeTruthy();

    // Switch to Dinner tab
    fireEvent.press(screen.getByLabelText('Filter by Dinner menu'));

    // Header updates to Dinner and shows Dinner buffet rates ($69 Adult, $46 Child)
    expect(screen.getByText('Prix Fixe & Buffet Pricing — Dinner')).toBeTruthy();
    expect(screen.getByLabelText('Adult: $69.00')).toBeTruthy();
    expect(screen.getByLabelText('Child: $46.00')).toBeTruthy();
    expect(screen.queryByLabelText('Adult: $58.00')).toBeNull();

    // Dinner drink shows, Dinner feast items hidden
    expect(screen.getByLabelText('Cold Brew Martini')).toBeTruthy();
    expect(screen.queryByLabelText("'Ohana Dinner Skillet")).toBeNull();

    // Tap "Feast Items (Included)" chip to view feast components
    fireEvent.press(screen.getByLabelText('Filter included feast items'));
    expect(screen.getByLabelText("'Ohana Dinner Skillet")).toBeTruthy();
    expect(screen.getByLabelText("'Ohana Bread Pudding")).toBeTruthy();

    // Switch to All Meals tab: shows both Breakfast and Dinner rates clearly labeled
    fireEvent.press(screen.getByLabelText('Filter by All meals'));
    expect(screen.getByLabelText('Breakfast — Adult: $58.00')).toBeTruthy();
    expect(screen.getByLabelText('Breakfast — Child: $36.00')).toBeTruthy();
    expect(screen.getByLabelText('Dinner — Adult: $69.00')).toBeTruthy();
    expect(screen.getByLabelText('Dinner — Child: $46.00')).toBeTruthy();
  });

  it('preserves buffet tier selection when choosing drinks and computes combined subtotal (Requirement 9.12)', () => {
    const confirmSpy = jest.fn();
    const multiMealMenus: MenuDTO[] = [
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
              { name: 'Backscratcher', priceCents: 1800 },
            ],
          },
        ],
      },
    ];

    render(
      <MenuItemPicker
        menus={multiMealMenus}
        onConfirm={confirmSpy}
        onCancel={jest.fn()}
      />
    );

    // 1. Select Adult buffet tier ($69.00)
    fireEvent.press(screen.getByLabelText('Adult: $69.00'));
    // Increment Adult quantity to 2
    fireEvent.press(screen.getByLabelText('Increase quantity for Adult'));

    expect(screen.getByText('Subtotal: $138.00')).toBeTruthy();
    expect(screen.getByText('2 items selected')).toBeTruthy();

    // 2. Select drinks without losing Adult selection
    fireEvent.press(screen.getByLabelText('Lapu Lapu'));
    expect(screen.getByText('Subtotal: $162.00')).toBeTruthy();
    expect(screen.getByText('3 items selected')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Backscratcher'));
    expect(screen.getByText('Subtotal: $180.00')).toBeTruthy();
    expect(screen.getByText('4 items selected')).toBeTruthy();

    // Verify Adult checkbox is STILL checked with quantity 2
    expect(screen.getByLabelText('Adult: $69.00')).toBeTruthy();
    expect(screen.getByLabelText('Decrease quantity for Adult')).toBeTruthy();

    // 3. Confirm selection yields both tier(s) and items
    fireEvent.press(screen.getByLabelText('Confirm selection'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const selection = confirmSpy.mock.calls[0]![0];

    expect(selection.tier).toEqual({
      name: 'Adult',
      priceCents: 6900,
      quantity: 2,
    });
    expect(selection.tiers).toEqual([
      { name: 'Adult', priceCents: 6900, quantity: 2 },
    ]);
    expect(selection.items).toEqual([
      {
        name: 'Lapu Lapu',
        priceCents: 2400,
        priceLabel: null,
        quantity: 1,
        isAlcohol: true,
      },
      {
        name: 'Backscratcher',
        priceCents: 1800,
        priceLabel: null,
        quantity: 1,
        isAlcohol: true,
      },
    ]);

    // Budget price ref projects all into items to satisfy menuPriceRefSchema
    const priceRef = selectionToBudgetPriceRef(selection);
    const parsed = menuPriceRefSchema.safeParse(priceRef);
    expect(parsed.success).toBe(true);
    expect(priceRef.items).toHaveLength(3);
  });
});
