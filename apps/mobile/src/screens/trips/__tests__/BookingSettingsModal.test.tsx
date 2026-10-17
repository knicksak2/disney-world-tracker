/**
 * BookingSettingsModal component tests (Task 11.4).
 *
 * Validates: Requirements 6.8, 6.14
 *
 * Assertions:
 * - Select Resort then Confirm: onConfirm called with exactly { stayType: 'resort' }
 * - Select Automatic when stored is resort sends { stayType: null }
 * - Cancel after changes calls onCancel, onConfirm never called, and re-opening shows stored values
 * - Out-of-range date shows checkInRangeText and Confirm sends no checkInOverride
 * - Each radio has an accessibility label and selected state
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { BookingSettingsModal } from '../BookingSettingsModal';
import { checkInRangeText } from '../bookingTimelineView';

describe('BookingSettingsModal', () => {
  const tripStart = '2025-06-15';
  const defaultInitialSettings = {
    stayType: null,
    lightningLaneTiming: null,
    checkInOverride: null,
  };

  test('each radio has an accessibility label and selected state', () => {
    render(
      <BookingSettingsModal
        visible={true}
        tripStart={tripStart}
        initialSettings={{
          stayType: 'resort',
          lightningLaneTiming: 'seven_day',
          checkInOverride: null,
        }}
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />,
    );

    // Stay type options
    const stayResort = screen.getByTestId('stay-type-resort');
    expect(stayResort.props.accessibilityRole).toBe('radio');
    expect(stayResort.props.accessibilityLabel).toBe('Resort');
    expect(stayResort.props.accessibilityState).toEqual({ selected: true });

    const stayAuto = screen.getByTestId('stay-type-automatic');
    expect(stayAuto.props.accessibilityRole).toBe('radio');
    expect(stayAuto.props.accessibilityLabel).toBe('Automatic');
    expect(stayAuto.props.accessibilityState).toEqual({ selected: false });

    const stayPartner = screen.getByTestId('stay-type-partner-hotel');
    expect(stayPartner.props.accessibilityRole).toBe('radio');
    expect(stayPartner.props.accessibilityLabel).toBe('Partner hotel');
    expect(stayPartner.props.accessibilityState).toEqual({ selected: false });

    const stayOffsite = screen.getByTestId('stay-type-off-site');
    expect(stayOffsite.props.accessibilityRole).toBe('radio');
    expect(stayOffsite.props.accessibilityLabel).toBe('Off-site');
    expect(stayOffsite.props.accessibilityState).toEqual({ selected: false });

    // Lightning lane timing options
    const timing7 = screen.getByTestId('ll-timing-7-days-before-check-in');
    expect(timing7.props.accessibilityRole).toBe('radio');
    expect(timing7.props.accessibilityLabel).toBe('7 days before check-in');
    expect(timing7.props.accessibilityState).toEqual({ selected: true });

    const timingAuto = screen.getByTestId('ll-timing-automatic');
    expect(timingAuto.props.accessibilityRole).toBe('radio');
    expect(timingAuto.props.accessibilityLabel).toBe('Automatic');
    expect(timingAuto.props.accessibilityState).toEqual({ selected: false });

    const timing3 = screen.getByTestId('ll-timing-3-days-before-(whole-trip)');
    expect(timing3.props.accessibilityRole).toBe('radio');
    expect(timing3.props.accessibilityLabel).toBe('3 days before (whole trip)');
    expect(timing3.props.accessibilityState).toEqual({ selected: false });

    const timingDaily = screen.getByTestId('ll-timing-3-days-before-(each-day)');
    expect(timingDaily.props.accessibilityRole).toBe('radio');
    expect(timingDaily.props.accessibilityLabel).toBe('3 days before (each day)');
    expect(timingDaily.props.accessibilityState).toEqual({ selected: false });
  });

  test('select Resort then Confirm: onConfirm called with exactly { stayType: "resort" }', () => {
    const onConfirm = jest.fn();
    render(
      <BookingSettingsModal
        visible={true}
        tripStart={tripStart}
        initialSettings={defaultInitialSettings}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('stay-type-resort'));
    expect(screen.getByTestId('stay-type-resort').props.accessibilityState).toEqual({
      selected: true,
    });

    fireEvent.press(screen.getByTestId('confirm-booking-settings'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ stayType: 'resort' });
  });

  test('select Automatic when stored is resort sends { stayType: null }', () => {
    const onConfirm = jest.fn();
    render(
      <BookingSettingsModal
        visible={true}
        tripStart={tripStart}
        initialSettings={{
          stayType: 'resort',
          lightningLaneTiming: null,
          checkInOverride: null,
        }}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.press(screen.getByTestId('stay-type-automatic'));
    expect(screen.getByTestId('stay-type-automatic').props.accessibilityState).toEqual({
      selected: true,
    });

    fireEvent.press(screen.getByTestId('confirm-booking-settings'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ stayType: null });
  });

  test('Cancel after changes calls onCancel, onConfirm never called, and re-opening shows stored values', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();

    const { rerender } = render(
      <BookingSettingsModal
        visible={true}
        tripStart={tripStart}
        initialSettings={defaultInitialSettings}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // Make changes
    fireEvent.press(screen.getByTestId('stay-type-off-site'));
    fireEvent.press(screen.getByTestId('ll-timing-3-days-before-(each-day)'));

    // Press cancel
    fireEvent.press(screen.getByTestId('cancel-booking-settings'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    // Re-render as if closed then re-opened
    rerender(
      <BookingSettingsModal
        visible={false}
        tripStart={tripStart}
        initialSettings={defaultInitialSettings}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    rerender(
      <BookingSettingsModal
        visible={true}
        tripStart={tripStart}
        initialSettings={defaultInitialSettings}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    // Check values were restored to initialSettings
    expect(screen.getByTestId('stay-type-automatic').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByTestId('stay-type-off-site').props.accessibilityState).toEqual({
      selected: false,
    });
    expect(screen.getByTestId('ll-timing-automatic').props.accessibilityState).toEqual({
      selected: true,
    });
    expect(
      screen.getByTestId('ll-timing-3-days-before-(each-day)').props.accessibilityState,
    ).toEqual({ selected: false });
  });

  test('an out-of-range date shows the text from checkInRangeText and Confirm sends no checkInOverride', () => {
    const onConfirm = jest.fn();
    const expectedRangeText = checkInRangeText(tripStart);

    // Start with an invalid check-in override date (e.g. 2025-04-01 is > 30 days before 2025-06-15)
    render(
      <BookingSettingsModal
        visible={true}
        tripStart={tripStart}
        initialSettings={{
          stayType: null,
          lightningLaneTiming: null,
          checkInOverride: '2025-04-01',
        }}
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    // Always-visible range text is displayed
    expect(screen.getByTestId('check-in-range-text')).toBeTruthy();
    expect(screen.getByText(expectedRangeText)).toBeTruthy();

    // Hit confirm
    fireEvent.press(screen.getByTestId('confirm-booking-settings'));

    // Confirm is blocked; error box appears showing rangeText; onConfirm not called
    expect(onConfirm).not.toHaveBeenCalled();
    const errorBox = screen.getByTestId('booking-settings-error');
    expect(errorBox).toBeTruthy();
    expect(screen.getAllByText(expectedRangeText).length).toBeGreaterThanOrEqual(1);

    // Clear the invalid override
    fireEvent.press(screen.getByTestId('clear-check-in-override'));

    // Now confirm can proceed
    fireEvent.press(screen.getByTestId('confirm-booking-settings'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({ checkInOverride: null });
  });

  test('close button in header calls onCancel', () => {
    const onCancel = jest.fn();
    render(
      <BookingSettingsModal
        visible={true}
        tripStart={tripStart}
        initialSettings={defaultInitialSettings}
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(screen.getByTestId('close-booking-settings-modal'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
