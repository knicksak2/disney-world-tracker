// Feature: food-lists, Task 19.8 — MarkGottenUndoToast tests
//
// Validates: Requirements 13.16, 13.17

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import MarkGottenUndoToast from '../MarkGottenUndoToast';
import { TOAST } from '../MarkGottenUndoToast.palette';
import { darkTheme, lightTheme, type AppTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';

describe('MarkGottenUndoToast', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('activating "Undo" calls onUndo then onDismiss', () => {
    const onUndo = jest.fn();
    const onDismiss = jest.fn();

    render(
      <MarkGottenUndoToast itemName="Dole Whip" onUndo={onUndo} onDismiss={onDismiss} />,
    );

    expect(screen.getByText('Ate this: Dole Whip')).toBeTruthy();

    fireEvent.press(screen.getByTestId('mark-gotten-undo-btn'));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test('auto-dismisses after its visible duration without calling onUndo', () => {
    jest.useFakeTimers();
    const onUndo = jest.fn();
    const onDismiss = jest.fn();

    render(
      <MarkGottenUndoToast
        itemName="Dole Whip"
        onUndo={onUndo}
        onDismiss={onDismiss}
        durationMs={5000}
      />,
    );

    expect(onDismiss).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5000);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });

  test('does not auto-dismiss before its visible duration elapses', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();

    render(
      <MarkGottenUndoToast
        itemName="Dole Whip"
        onUndo={jest.fn()}
        onDismiss={onDismiss}
        durationMs={5000}
      />,
    );

    jest.advanceTimersByTime(4999);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

// Feature: dark-mode, Property 22: the inverse toast (rule 1a, H-role) keeps its
// `#1f1235` surface and white / gold text in both schemes.
describe('MarkGottenUndoToast — theme (Property 22)', () => {
  afterEach(resetTestScheme);

  function renderToast(): void {
    render(<MarkGottenUndoToast itemName="Dole Whip" onUndo={jest.fn()} onDismiss={jest.fn()} />);
  }

  const cases: ReadonlyArray<readonly ['light' | 'dark', AppTheme]> = [
    ['light', lightTheme],
    ['dark', darkTheme],
  ];

  test.each(cases)('%s: toast is #1f1235 with white message and accent Undo', (scheme, t) => {
    setTestScheme(scheme);
    renderToast();

    const toast = StyleSheet.flatten(screen.getByTestId('mark-gotten-undo-toast').props.style);
    expect(toast.backgroundColor).toBe('#1f1235');
    expect(TOAST[scheme].bg).toBe('#1f1235');

    const message = StyleSheet.flatten(screen.getByText('Ate this: Dole Whip').props.style);
    expect(message.color).toBe('#ffffff');
    expect(message.color).toBe(t.color.textOnPrimary);

    const undo = StyleSheet.flatten(screen.getByText('Undo').props.style);
    expect(undo.color).toBe(t.color.accent);
  });

  test('dark: the toast spreads the dark card outline; light has none', () => {
    setTestScheme('dark');
    renderToast();
    const dark = StyleSheet.flatten(screen.getByTestId('mark-gotten-undo-toast').props.style);
    expect(dark.borderColor).toBe(darkTheme.color.border);
    expect(dark.borderWidth).toBe(StyleSheet.hairlineWidth);
    screen.unmount();

    setTestScheme('light');
    renderToast();
    const light = StyleSheet.flatten(screen.getByTestId('mark-gotten-undo-toast').props.style);
    expect(light.borderColor).toBeUndefined();
    // Zero width: draws nothing, but explicitly clears the dark hairline on a
    // live switch (Android does not reset a style key that is just omitted).
    expect(light.borderWidth).toBe(0);
  });
});
