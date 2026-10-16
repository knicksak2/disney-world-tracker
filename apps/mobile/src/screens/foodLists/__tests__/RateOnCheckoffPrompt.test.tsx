// Feature: food-lists, Task 19.3 — RateOnCheckoffPrompt tests
//
// Validates: Requirements 13.15

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import RateOnCheckoffPrompt from '../RateOnCheckoffPrompt';
import { darkTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';

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

  describe('dark mode', () => {
    afterEach(resetTestScheme);

    test('paints the sheet, title and rating tiles with dark tokens', () => {
      setTestScheme('dark');
      render(
        <RateOnCheckoffPrompt
          visible
          foodItemName="Dole Whip"
          initialRating={7}
          onSkip={jest.fn()}
          onConfirm={jest.fn()}
        />,
      );

      const title = screen.getByText('Dole Whip');
      // (a) the sheet surface, (b) primary text.
      expect(paintedBackground(title)).toBe(darkTheme.color.surface);
      expect(StyleSheet.flatten(title.props.style).color).toBe(darkTheme.color.textPrimary);
      // (c) idle tile on surfaceAlt; selected tile is a primary fill with white text.
      expect(
        StyleSheet.flatten(screen.getByTestId('rate-on-checkoff-rating-btn-1').props.style)
          .backgroundColor,
      ).toBe(darkTheme.color.surfaceAlt);
      expect(
        StyleSheet.flatten(screen.getByTestId('rate-on-checkoff-rating-btn-7').props.style)
          .backgroundColor,
      ).toBe(darkTheme.color.primary);
      expect(StyleSheet.flatten(screen.getByText('7').props.style).color).toBe(
        darkTheme.color.textOnPrimary,
      );
    });
  });
});

/** Nearest painted `backgroundColor` at or above `node` (sheet surface lookup). */
function paintedBackground(node: ReactTestInstance | null): unknown {
  for (let n = node; n !== null; n = n.parent) {
    const style = n.props.style;
    if (style === undefined || typeof style === 'function') continue;
    const flat = StyleSheet.flatten(style) as { backgroundColor?: unknown } | undefined;
    if (flat?.backgroundColor !== undefined) return flat.backgroundColor;
  }
  return undefined;
}
