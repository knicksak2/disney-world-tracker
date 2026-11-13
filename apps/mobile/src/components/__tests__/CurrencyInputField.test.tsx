import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { CurrencyInputField, parseDollarInputToCents } from '../CurrencyInputField';

describe('CurrencyInputField', () => {
  describe('parseDollarInputToCents', () => {
    it('parses basic dollar amounts', () => {
      expect(parseDollarInputToCents('25')).toBe(2500);
      expect(parseDollarInputToCents('25.5')).toBe(2550);
      expect(parseDollarInputToCents('25.50')).toBe(2550);
      expect(parseDollarInputToCents('0.75')).toBe(75);
    });

    it('returns null for empty or non-numeric strings', () => {
      expect(parseDollarInputToCents('')).toBeNull();
      expect(parseDollarInputToCents('abc')).toBeNull();
    });

    it('ignores extraneous symbols like $', () => {
      expect(parseDollarInputToCents('$42.99')).toBe(4299);
    });
  });

  it('renders empty string when cents is 0 and allowEmpty is true (default)', () => {
    render(
      <CurrencyInputField
        cents={0}
        onChangeCents={jest.fn()}
        placeholder="0.00"
        testID="currency-input"
      />
    );

    const input = screen.getByTestId('currency-input');
    expect(input.props.value).toBe('');
    expect(input.props.placeholder).toBe('0.00');
  });

  it('renders formatted dollar string when cents > 0', () => {
    render(
      <CurrencyInputField
        cents={4999}
        onChangeCents={jest.fn()}
        testID="currency-input"
      />
    );

    const input = screen.getByTestId('currency-input');
    expect(input.props.value).toBe('49.99');
  });

  it('allows natural typing without forcing decimal places on every keystroke', () => {
    const onChangeCents = jest.fn();
    render(
      <CurrencyInputField
        cents={0}
        onChangeCents={onChangeCents}
        testID="currency-input"
      />
    );

    const input = screen.getByTestId('currency-input');

    // Type '2'
    fireEvent.changeText(input, '2');
    expect(input.props.value).toBe('2');
    expect(onChangeCents).toHaveBeenLastCalledWith(200);

    // Type '25'
    fireEvent.changeText(input, '25');
    expect(input.props.value).toBe('25');
    expect(onChangeCents).toHaveBeenLastCalledWith(2500);

    // Type '25.'
    fireEvent.changeText(input, '25.');
    expect(input.props.value).toBe('25.');
    expect(onChangeCents).toHaveBeenLastCalledWith(2500);

    // Type '25.5'
    fireEvent.changeText(input, '25.5');
    expect(input.props.value).toBe('25.5');
    expect(onChangeCents).toHaveBeenLastCalledWith(2550);

    // Type '25.50'
    fireEvent.changeText(input, '25.50');
    expect(input.props.value).toBe('25.50');
    expect(onChangeCents).toHaveBeenLastCalledWith(2550);
  });

  it('allows natural backspacing all the way down to empty string without adding zeros', () => {
    const onChangeCents = jest.fn();
    render(
      <CurrencyInputField
        cents={2550}
        onChangeCents={onChangeCents}
        testID="currency-input"
      />
    );

    const input = screen.getByTestId('currency-input');
    expect(input.props.value).toBe('25.50');

    // Backspace: 25.50 -> 25.5
    fireEvent.changeText(input, '25.5');
    expect(input.props.value).toBe('25.5');
    expect(onChangeCents).toHaveBeenLastCalledWith(2550);

    // Backspace: 25.5 -> 25
    fireEvent.changeText(input, '25');
    expect(input.props.value).toBe('25');
    expect(onChangeCents).toHaveBeenLastCalledWith(2500);

    // Backspace: 25 -> 2
    fireEvent.changeText(input, '2');
    expect(input.props.value).toBe('2');
    expect(onChangeCents).toHaveBeenLastCalledWith(200);

    // Backspace: 2 -> ''
    fireEvent.changeText(input, '');
    expect(input.props.value).toBe('');
    expect(onChangeCents).toHaveBeenLastCalledWith(0);
  });

  it('formats cleanly on blur', () => {
    render(
      <CurrencyInputField
        cents={0}
        onChangeCents={jest.fn()}
        testID="currency-input"
      />
    );

    const input = screen.getByTestId('currency-input');

    // Type '5'
    fireEvent.changeText(input, '5');
    expect(input.props.value).toBe('5');

    // Blur formats '5' -> '5.00'
    fireEvent(input, 'blur', { nativeEvent: {} });
    expect(input.props.value).toBe('5.00');
  });

  it('syncs text when cents prop updates externally and input is not focused', () => {
    const { rerender } = render(
      <CurrencyInputField
        cents={1000}
        onChangeCents={jest.fn()}
        testID="currency-input"
      />
    );

    const input = screen.getByTestId('currency-input');
    expect(input.props.value).toBe('10.00');

    // External change (e.g. preset calculation to 14.56)
    rerender(
      <CurrencyInputField
        cents={1456}
        onChangeCents={jest.fn()}
        testID="currency-input"
      />
    );

    expect(input.props.value).toBe('14.56');
  });
});
