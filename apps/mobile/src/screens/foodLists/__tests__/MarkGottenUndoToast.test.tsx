// Feature: food-lists, Task 19.8 — MarkGottenUndoToast tests
//
// Validates: Requirements 13.16, 13.17

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import MarkGottenUndoToast from '../MarkGottenUndoToast';

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
