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
});
