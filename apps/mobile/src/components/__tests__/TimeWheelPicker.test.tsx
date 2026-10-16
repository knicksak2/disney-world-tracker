/**
 * TimeWheelPicker tests (trip-reservations task 8.4).
 *
 * Drives each of the three columns and asserts the value the component emits,
 * plus the offered options for each granularity. The component is the guard
 * against the defect that prompted it: a meridiem is always an explicit
 * selection, so a PM time can never be emitted as its AM counterpart.
 *
 * Validates: Requirements 3.8, 3.9, 3.11
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

import { resetTestScheme, setTestScheme } from '../../test/themeTestUtils';
import { themes } from '../../theme/theme';
import {
  TimeWheelPicker,
  parseWheelValue,
  wheelMinutes,
  WHEEL_HOURS,
} from '../TimeWheelPicker';

describe('wheelMinutes', () => {
  it('offers 5-minute granularity for reservations — a 6:25 booking is representable', () => {
    const minutes = wheelMinutes(5);
    expect(minutes).toHaveLength(12);
    expect(minutes[0]).toBe('00');
    expect(minutes).toContain('25');
    expect(minutes).toContain('55');
  });

  it('offers quarter hours for the Schedule Builder', () => {
    expect(wheelMinutes(15)).toEqual(['00', '15', '30', '45']);
  });
});

describe('parseWheelValue', () => {
  it('splits a 12-hour value into its three selections', () => {
    expect(parseWheelValue('6:25 PM', 5)).toEqual({
      hour: '6',
      minute: '25',
      meridiem: 'PM',
    });
  });

  it('normalizes 12 AM and 12 PM to hour 12', () => {
    expect(parseWheelValue('12:00 AM', 5).hour).toBe('12');
    expect(parseWheelValue('12:00 PM', 5).hour).toBe('12');
  });

  it('reports no selection for an empty or unparseable value (R3.11)', () => {
    for (const bad of ['', '   ', '18:30', 'half six', '6:25']) {
      expect(parseWheelValue(bad, 5)).toEqual({ hour: '', minute: '', meridiem: '' });
    }
  });

  it('snaps a minute that is not an offered option on a coarser wheel', () => {
    // 25 is not a quarter hour, so a 15-minute wheel falls back rather than
    // showing nothing selected.
    expect(parseWheelValue('6:25 PM', 15).minute).toBe('00');
    expect(parseWheelValue('6:30 PM', 15).minute).toBe('30');
  });
});

describe('TimeWheelPicker', () => {
  it('renders every hour and both meridiems', () => {
    render(<TimeWheelPicker value="" onChange={jest.fn()} testIDPrefix="t" />);
    for (const hour of WHEEL_HOURS) {
      expect(screen.getByTestId(`t-hour-${hour}`)).toBeTruthy();
    }
    expect(screen.getByTestId('t-meridiem-AM')).toBeTruthy();
    expect(screen.getByTestId('t-meridiem-PM')).toBeTruthy();
  });

  it('renders 5-minute options when minuteStep is 5, and only quarter hours at 15', () => {
    const { unmount } = render(
      <TimeWheelPicker value="" onChange={jest.fn()} minuteStep={5} testIDPrefix="five" />,
    );
    expect(screen.getByTestId('five-minute-25')).toBeTruthy();
    unmount();

    render(<TimeWheelPicker value="" onChange={jest.fn()} minuteStep={15} testIDPrefix="fifteen" />);
    expect(screen.queryByTestId('fifteen-minute-25')).toBeNull();
    expect(screen.getByTestId('fifteen-minute-30')).toBeTruthy();
  });

  it('emits the changed hour, keeping the existing minute and meridiem', () => {
    const onChange = jest.fn();
    render(
      <TimeWheelPicker value="6:25 PM" onChange={onChange} minuteStep={5} testIDPrefix="t" />,
    );
    fireEvent.press(screen.getByTestId('t-hour-8'));
    expect(onChange).toHaveBeenCalledWith('8:25 PM');
  });

  it('emits the changed minute, keeping the existing hour and meridiem', () => {
    const onChange = jest.fn();
    render(
      <TimeWheelPicker value="6:25 PM" onChange={onChange} minuteStep={5} testIDPrefix="t" />,
    );
    fireEvent.press(screen.getByTestId('t-minute-45'));
    expect(onChange).toHaveBeenCalledWith('6:45 PM');
  });

  it('emits the changed meridiem, keeping the existing hour and minute', () => {
    const onChange = jest.fn();
    render(
      <TimeWheelPicker value="6:25 PM" onChange={onChange} minuteStep={5} testIDPrefix="t" />,
    );
    fireEvent.press(screen.getByTestId('t-meridiem-AM'));
    expect(onChange).toHaveBeenCalledWith('6:25 AM');
  });

  it('completes a usable value from a single press when nothing was selected', () => {
    const onChange = jest.fn();
    render(<TimeWheelPicker value="" onChange={onChange} minuteStep={5} testIDPrefix="t" />);
    fireEvent.press(screen.getByTestId('t-hour-1'));
    // Defaults fill the columns the user has not touched yet.
    expect(onChange).toHaveBeenCalledWith('1:00 PM');
  });

  it('marks the current selection as selected for assistive tech', () => {
    render(
      <TimeWheelPicker value="6:25 PM" onChange={jest.fn()} minuteStep={5} testIDPrefix="t" />,
    );
    expect(screen.getByTestId('t-hour-6').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('t-hour-7').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('t-minute-25').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('t-meridiem-PM').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('t-meridiem-AM').props.accessibilityState.selected).toBe(false);
  });

  it('shows nothing selected for an empty value, so no time is implied (R3.11)', () => {
    render(<TimeWheelPicker value="" onChange={jest.fn()} minuteStep={5} testIDPrefix="t" />);
    for (const hour of WHEEL_HOURS) {
      expect(screen.getByTestId(`t-hour-${hour}`).props.accessibilityState.selected).toBe(false);
    }
    expect(screen.getByTestId('t-meridiem-AM').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('t-meridiem-PM').props.accessibilityState.selected).toBe(false);
  });
});

// Feature: dark-mode — the wheel's surfaces and selection follow the Active theme.
describe('TimeWheelPicker — dark mode', () => {
  const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
    (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

  afterEach(resetTestScheme);

  it('renders the dark wheel and repaints a selection made after the switch', () => {
    const onChange = jest.fn();
    const view = render(
      <TimeWheelPicker value="6:25 PM" onChange={onChange} minuteStep={5} testIDPrefix="t" />,
    );
    expect(flat(screen.getByTestId('t-wheel')).backgroundColor).toBe(themes.light.color.surfaceAlt);
    expect(flat(screen.getByTestId('t-hour-6')).backgroundColor).toBe(themes.light.color.primary);

    setTestScheme('dark');
    const d = themes.dark.color;
    expect(flat(screen.getByTestId('t-wheel')).backgroundColor).toBe(d.surfaceAlt);
    expect(flat(screen.getByTestId('t-wheel')).borderColor).toBe(d.border);
    expect(flat(screen.getByTestId('t-hour-6')).backgroundColor).toBe(d.primary);
    expect(flat(screen.getByText('6')).color).toBe(d.textOnPrimary);
    expect(flat(screen.getByText('7')).color).toBe(d.textPrimary);
    expect(flat(screen.getByTestId('t-meridiem-AM')).backgroundColor).toBe(d.surface);

    fireEvent.press(screen.getByTestId('t-hour-7'));
    expect(onChange).toHaveBeenCalledWith('7:25 PM');
    view.rerender(
      <TimeWheelPicker value="7:25 PM" onChange={onChange} minuteStep={5} testIDPrefix="t" />,
    );
    expect(flat(screen.getByTestId('t-hour-7')).backgroundColor).toBe(d.primary);
    expect(flat(screen.getByText('7')).color).toBe(d.textOnPrimary);
  });
});
