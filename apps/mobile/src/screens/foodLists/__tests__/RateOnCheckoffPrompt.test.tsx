// Feature: food-lists, Task 19.3 — RateOnCheckoffPrompt tests
//
// Validates: Requirements 13.15

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import RateOnCheckoffPrompt from '../RateOnCheckoffPrompt';

describe('RateOnCheckoffPrompt', () => {
  test('selecting a rating and confirming calls onConfirm with that value', () => {
    const onConfirm = jest.fn();
    const onSkip = jest.fn();

    render(
      <RateOnCheckoffPrompt
        visible
        foodItemName="Dole Whip"
        onSkip={onSkip}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-8'));
    fireEvent.press(screen.getByTestId('rate-on-checkoff-confirm-btn'));

    expect(onConfirm).toHaveBeenCalledWith(8);
    expect(onSkip).not.toHaveBeenCalled();
  });

  test('"Skip" calls onSkip and never onConfirm, even with no rating selected', () => {
    const onConfirm = jest.fn();
    const onSkip = jest.fn();

    render(
      <RateOnCheckoffPrompt
        visible
        foodItemName="Dole Whip"
        onSkip={onSkip}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('"Skip" calls onSkip and never onConfirm even after a rating was selected then abandoned', () => {
    const onConfirm = jest.fn();
    const onSkip = jest.fn();

    render(
      <RateOnCheckoffPrompt
        visible
        foodItemName="Dole Whip"
        onSkip={onSkip}
        onConfirm={onConfirm}
      />,
    );

    // Select a rating, then choose Skip instead of Confirm.
    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-5'));
    fireEvent.press(screen.getByTestId('rate-on-checkoff-skip-btn'));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('dismissing via the backdrop without selecting a rating calls onSkip, never onConfirm', () => {
    const onConfirm = jest.fn();
    const onSkip = jest.fn();

    render(
      <RateOnCheckoffPrompt
        visible
        foodItemName="Dole Whip"
        onSkip={onSkip}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.press(screen.getByTestId('rate-on-checkoff-backdrop'));

    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('Confirm does not render until a rating is selected', () => {
    render(
      <RateOnCheckoffPrompt
        visible
        foodItemName="Dole Whip"
        onSkip={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    // No disabled Confirm button sits on screen before a rating is picked
    // — only "Skip" is available until then.
    expect(screen.queryByTestId('rate-on-checkoff-confirm-btn')).toBeNull();

    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-3'));

    expect(screen.getByTestId('rate-on-checkoff-confirm-btn')).toBeTruthy();
    expect(screen.getByText('Confirm (3/10)')).toBeTruthy();
  });

  test('pre-selects rating and shows Cancel when initialRating is provided', () => {
    const onConfirm = jest.fn();
    const onSkip = jest.fn();

    render(
      <RateOnCheckoffPrompt
        visible
        foodItemName="Dole Whip"
        initialRating={7}
        onSkip={onSkip}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText('Update rating (1–10)')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Confirm (7/10)')).toBeTruthy();

    const btn7 = screen.getByTestId('rate-on-checkoff-rating-btn-7');
    expect(btn7.props.accessibilityState).toEqual({ selected: true });

    // Can change selection to 9 and confirm
    fireEvent.press(screen.getByTestId('rate-on-checkoff-rating-btn-9'));
    expect(screen.getByText('Confirm (9/10)')).toBeTruthy();
    fireEvent.press(screen.getByTestId('rate-on-checkoff-confirm-btn'));

    expect(onConfirm).toHaveBeenCalledWith(9);
    expect(onSkip).not.toHaveBeenCalled();
  });

  test('renders nothing when visible is false', () => {
    render(
      <RateOnCheckoffPrompt
        visible={false}
        foodItemName="Dole Whip"
        onSkip={jest.fn()}
        onConfirm={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('rate-on-checkoff-prompt')).toBeNull();
  });
});
