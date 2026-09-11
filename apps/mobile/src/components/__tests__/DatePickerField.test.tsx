/**
 * Behavior tests for the reusable DatePickerField calendar picker.
 *
 * Focus: the `maximumDate` prop (added for the "Log a visit" flow) must make
 * days after the maximum non-selectable. react-native-calendars guards
 * `onDayPress` for out-of-range days, so pressing a day past `maximumDate`
 * must NOT fire `onChange`, while an in-range day must fire it with the
 * correct `YYYY-MM-DD` string. The real component renders (no mocking of the
 * component under test); only the caller's `onChange` is a spy.
 *
 * Validates: Requirement 6.6 (visit-date picker cannot select a future date)
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { DatePickerField } from '../DatePickerField';

describe('DatePickerField — maximumDate', () => {
  function open(): void {
    // The field opens on the month of `value` (2026-06). The calendar modal
    // then renders the June 2026 day grid.
    fireEvent.press(screen.getByTestId('when'));
  }

  test('does not fire onChange for a day after maximumDate (R6.6)', () => {
    const onChange = jest.fn();
    render(
      <DatePickerField
        value="2026-06-15"
        onChange={onChange}
        maximumDate="2026-06-15"
        accessibilityLabel="Visit date"
        testID="when"
      />,
    );

    open();
    // 20 is after the maximum (15). The Calendar guards onDayPress for
    // out-of-range days, so this press is a no-op.
    fireEvent.press(screen.getByText('20'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('fires onChange for a day on/before maximumDate (R6.6)', () => {
    const onChange = jest.fn();
    render(
      <DatePickerField
        value="2026-06-15"
        onChange={onChange}
        maximumDate="2026-06-15"
        accessibilityLabel="Visit date"
        testID="when"
      />,
    );

    open();
    // 10 is before the maximum, so it is selectable and emits the ISO date.
    fireEvent.press(screen.getByText('10'));
    expect(onChange).toHaveBeenCalledWith('2026-06-10');
  });

  test('the maximum day itself is selectable (boundary) (R6.6)', () => {
    const onChange = jest.fn();
    render(
      <DatePickerField
        value="2026-06-10"
        onChange={onChange}
        maximumDate="2026-06-15"
        accessibilityLabel="Visit date"
        testID="when"
      />,
    );

    open();
    fireEvent.press(screen.getByText('15'));
    expect(onChange).toHaveBeenCalledWith('2026-06-15');
  });
});
