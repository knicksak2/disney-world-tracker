// Reusable currency input field for dollars and cents.
//
// Eliminates cursor jumping, zero-padding loop traps, and decimal fighting.
// Allows natural typing (e.g. typing "5" keeps "5" while emitting 500 cents,
// typing "5." keeps "5.", deleting via backspace empties cleanly to show placeholder,
// and onBlur formats to 2 decimal places).

import React, { useEffect, useRef, useState } from 'react';
import {
  TextInput,
  type TextInputProps,
} from 'react-native';
import { EXPENSE_AMOUNT_MAX_CENTS } from '@dwt/shared';

export function parseDollarInputToCents(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const dollars = parseInt(parts[0] || '0', 10);
  let centsPart = 0;
  if (parts.length === 2) {
    const rawCents = (parts[1] + '00').slice(0, 2);
    centsPart = parseInt(rawCents, 10);
  }
  const total = dollars * 100 + centsPart;
  if (isNaN(total) || total < 0 || total > EXPENSE_AMOUNT_MAX_CENTS) return null;
  return total;
}

export interface CurrencyInputFieldProps extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  readonly cents: number;
  readonly onChangeCents: (cents: number) => void;
  /** Whether 0 cents should render as '' so placeholder is shown. Default true. */
  readonly allowEmpty?: boolean;
}

export const CurrencyInputField = React.forwardRef<TextInput, CurrencyInputFieldProps>(
  function CurrencyInputField(
    {
      cents,
      onChangeCents,
      allowEmpty = true,
      onFocus,
      onBlur,
      selectTextOnFocus = true,
      keyboardType = 'decimal-pad',
      placeholder = '0.00',
      ...rest
    },
    ref
  ) {
    const initialText = cents > 0 ? (cents / 100).toFixed(2) : allowEmpty ? '' : '0.00';
    const [text, setText] = useState<string>(initialText);
    const [isFocused, setIsFocused] = useState(false);
    const lastReportedCentsRef = useRef<number>(cents);

    // If cents was updated externally (e.g. from preset, auto-calc, or scan),
    // sync our text state if not currently focused
    useEffect(() => {
      if (cents !== lastReportedCentsRef.current) {
        lastReportedCentsRef.current = cents;
        if (!isFocused) {
          setText(cents > 0 ? (cents / 100).toFixed(2) : allowEmpty ? '' : '0.00');
        }
      }
    }, [cents, isFocused, allowEmpty]);

    const handleChangeText = (v: string) => {
      // Allow only digits and at most one decimal point
      const cleaned = v.replace(/[^0-9.]/g, '');
      const parts = cleaned.split('.');
      let sanitized = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
      if (parts.length === 2 && parts[1]!.length > 2) {
        sanitized = `${parts[0]}.${parts[1]!.slice(0, 2)}`;
      }

      setText(sanitized);

      const parsed = parseDollarInputToCents(sanitized) ?? 0;
      lastReportedCentsRef.current = parsed;
      onChangeCents(parsed);
    };

    const handleFocus: TextInputProps['onFocus'] = (e) => {
      setIsFocused(true);
      if (text === '0.00' && allowEmpty) {
        setText('');
      }
      onFocus?.(e);
    };

    const handleBlur: TextInputProps['onBlur'] = (e) => {
      setIsFocused(false);
      const parsed = parseDollarInputToCents(text);
      if (parsed !== null && parsed > 0) {
        setText((parsed / 100).toFixed(2));
      } else if (allowEmpty) {
        setText('');
      } else {
        setText('0.00');
      }
      onBlur?.(e);
    };

    return (
      <TextInput
        ref={ref}
        keyboardType={keyboardType}
        selectTextOnFocus={selectTextOnFocus}
        placeholder={placeholder}
        value={text}
        onChangeText={handleChangeText}
        onFocus={handleFocus}
        onBlur={handleBlur}
        {...rest}
      />
    );
  }
);
