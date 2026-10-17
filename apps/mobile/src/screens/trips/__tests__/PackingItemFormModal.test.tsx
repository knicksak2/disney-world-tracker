/**
 * PackingItemFormModal component tests (Task 11.6).
 *
 * Validates: Requirements 13.6, 13.7, 13.12
 *
 * Assertions:
 * - Empty/whitespace name shows an error naming `name` and `onSubmit` not called
 * - 81-char name rejected naming `name`
 * - Quantity 0, 100, 1.5 rejected naming `quantity`
 * - Valid input calls `onSubmit` with trimmed name, integer quantity (default 1), chosen category and assignee
 * - Entered values persist after a rejected submit
 * - Chips expose selected state
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { PackingItemFormModal } from '../PackingItemFormModal';

describe('PackingItemFormModal', () => {
  const members = [
    { id: '11111111-1111-4111-8111-111111111111', displayName: 'Mickey' },
    { id: '22222222-2222-4222-8222-222222222222', displayName: 'Donald' },
  ];

  test('chips expose selected state', () => {
    render(
      <PackingItemFormModal
        visible={true}
        members={members}
        initialItem={{
          name: 'MagicBand',
          category: 'park_gear',
          quantity: 2,
          assigneeId: members[0]!.id,
        }}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // Category chips
    const parkGearChip = screen.getByTestId('category-chip-park_gear');
    expect(parkGearChip.props.accessibilityState).toEqual({ selected: true });

    const clothingChip = screen.getByTestId('category-chip-clothing');
    expect(clothingChip.props.accessibilityState).toEqual({ selected: false });

    // Assignee chips
    const memberChip = screen.getByTestId(`assignee-chip-${members[0]!.id}`);
    expect(memberChip.props.accessibilityState).toEqual({ selected: true });

    const noOneChip = screen.getByTestId('assignee-chip-none');
    expect(noOneChip.props.accessibilityState).toEqual({ selected: false });

    const member2Chip = screen.getByTestId(`assignee-chip-${members[1]!.id}`);
    expect(member2Chip.props.accessibilityState).toEqual({ selected: false });
  });

  test('empty/whitespace name shows an error naming "name" and onSubmit is not called', () => {
    const onSubmit = jest.fn();
    render(
      <PackingItemFormModal
        visible={true}
        members={members}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByTestId('packing-item-name-input'), '   ');
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));

    expect(onSubmit).not.toHaveBeenCalled();
    const errorBox = screen.getByTestId('packing-form-error');
    expect(errorBox).toBeTruthy();
    expect(within(errorBox).getByText(/name/i)).toBeTruthy();
  });

  test('81-char name is rejected naming "name"', () => {
    const onSubmit = jest.fn();
    render(
      <PackingItemFormModal
        visible={true}
        members={members}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByTestId('packing-item-name-input'), 'a'.repeat(81));
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));

    expect(onSubmit).not.toHaveBeenCalled();
    const errorBox = screen.getByTestId('packing-form-error');
    expect(errorBox).toBeTruthy();
    expect(within(errorBox).getByText(/name/i)).toBeTruthy();
  });

  test('quantity 0, 100, and 1.5 are rejected naming "quantity"', () => {
    const onSubmit = jest.fn();
    render(
      <PackingItemFormModal
        visible={true}
        members={members}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    fireEvent.changeText(screen.getByTestId('packing-item-name-input'), 'Sunscreen');

    // Test 0
    fireEvent.changeText(screen.getByTestId('packing-item-quantity-input'), '0');
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));
    expect(onSubmit).not.toHaveBeenCalled();
    let errorBox = screen.getByTestId('packing-form-error');
    expect(within(errorBox).getByText(/quantity/i)).toBeTruthy();

    // Test 100
    fireEvent.changeText(screen.getByTestId('packing-item-quantity-input'), '100');
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));
    expect(onSubmit).not.toHaveBeenCalled();
    errorBox = screen.getByTestId('packing-form-error');
    expect(within(errorBox).getByText(/quantity/i)).toBeTruthy();

    // Test 1.5
    fireEvent.changeText(screen.getByTestId('packing-item-quantity-input'), '1.5');
    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));
    expect(onSubmit).not.toHaveBeenCalled();
    errorBox = screen.getByTestId('packing-form-error');
    expect(within(errorBox).getByText(/quantity/i)).toBeTruthy();
  });

  test('entered values persist after a rejected submit', () => {
    const onSubmit = jest.fn();
    render(
      <PackingItemFormModal
        visible={true}
        members={members}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    // Enter valid category and assignee, but invalid name
    fireEvent.changeText(screen.getByTestId('packing-item-name-input'), '   ');
    fireEvent.changeText(screen.getByTestId('packing-item-quantity-input'), '5');
    fireEvent.press(screen.getByTestId('category-chip-toiletries'));
    fireEvent.press(screen.getByTestId(`assignee-chip-${members[1]!.id}`));

    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('packing-form-error')).toBeTruthy();

    // Assert entered values persist in the form
    expect(screen.getByTestId('packing-item-quantity-input').props.value).toBe('5');
    expect(screen.getByTestId('category-chip-toiletries').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(
      screen.getByTestId(`assignee-chip-${members[1]!.id}`).props.accessibilityState,
    ).toEqual({ selected: true });
  });

  test('valid input calls onSubmit with trimmed name, integer quantity (default 1), chosen category and assignee', () => {
    const onSubmit = jest.fn();
    render(
      <PackingItemFormModal
        visible={true}
        members={members}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />,
    );

    // Enter name with padding
    fireEvent.changeText(screen.getByTestId('packing-item-name-input'), '  Swimsuit  ');
    // Clear quantity to test default of 1
    fireEvent.changeText(screen.getByTestId('packing-item-quantity-input'), '');
    // Choose clothing
    fireEvent.press(screen.getByTestId('category-chip-clothing'));
    // Choose Mickey
    fireEvent.press(screen.getByTestId(`assignee-chip-${members[0]!.id}`));

    fireEvent.press(screen.getByTestId('submit-packing-item-btn'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Swimsuit',
      quantity: 1,
      category: 'clothing',
      assigneeId: members[0]!.id,
    });
  });

  test('close button and cancel button invoke onClose/handleClose', () => {
    const onClose = jest.fn();
    render(
      <PackingItemFormModal
        visible={true}
        members={members}
        onSubmit={jest.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.press(screen.getByTestId('close-packing-item-modal'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('cancel-packing-item-btn'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
