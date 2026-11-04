// Feature: unified-experience-logging, Task 7.2 — LogToastHost tests
//
// Validates: Requirements 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.5

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { navigateToTripFeed } from '../../../navigation/navigationRef';
import LogToastHost from '../LogToastHost';
import {
  LOG_TOAST_MS,
  LOG_TOAST_WITH_DISH_PROMPT_MS,
  useLogToastStore,
} from '../logToastStore';

jest.mock('../../../navigation/navigationRef', () => ({
  navigateToTripFeed: jest.fn(),
}));

jest.mock('../../catalog/FoodItemPickerModal', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockFoodItemPickerModal(props: {
    readonly visible: boolean;
    readonly experienceId?: string | null;
    readonly mode?: string;
    readonly onClose: () => void;
    readonly onSelectFoodItem?: (item: { id: string; name: string }) => void;
  }) {
    if (!props.visible) return null;
    return (
      <View testID="mock-food-picker">
        <Text testID="mock-food-picker-exp">{props.experienceId ?? ''}</Text>
        <Pressable
          testID="mock-food-picker-select"
          onPress={() =>
            props.onSelectFoodItem?.({ id: 'dish-101', name: 'Dole Whip' })
          }
        />
      </View>
    );
  };
});

jest.mock('../../catalog/LogFoodItemModal', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function MockLogFoodItemModal(props: {
    readonly visible: boolean;
    readonly foodItem: { id: string; name: string } | null;
    readonly onClose: () => void;
  }) {
    if (!props.visible) return null;
    return (
      <View testID="mock-food-log-modal">
        <Text testID="mock-food-log-dish-name">
          {props.foodItem?.name ?? ''}
        </Text>
      </View>
    );
  };
});

const mockNavigateToTripFeed = navigateToTripFeed as jest.MockedFunction<
  typeof navigateToTripFeed
>;

describe('LogToastHost', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    act(() => {
      useLogToastStore.getState().dismiss();
    });
  });

  afterEach(() => {
    act(() => {
      useLogToastStore.getState().dismiss();
    });
    jest.useRealTimers();
  });

  it('renders nothing when there is no active toast', () => {
    render(<LogToastHost />);
    expect(screen.queryByTestId('log-toast')).toBeNull();
  });

  it('renders toast message text variants', () => {
    render(<LogToastHost />);

    act(() => {
      useLogToastStore.getState().show({
        message: 'Space Mountain logged',
        tripId: null,
        experienceId: 'exp-1',
        offerDishPrompt: false,
      });
    });

    expect(screen.getByTestId('log-toast')).toBeTruthy();
    expect(screen.getByText('Space Mountain logged')).toBeTruthy();
    expect(screen.queryByTestId('log-toast-view-in-trip')).toBeNull();
    expect(screen.queryByTestId('log-toast-dish-prompt')).toBeNull();
  });

  it('shows View in trip button when tripId is present and navigates on tap', () => {
    render(<LogToastHost />);

    act(() => {
      useLogToastStore.getState().show({
        message: 'Big Thunder Mountain logged to May Family Trip',
        tripId: 'trip-123',
        experienceId: 'exp-btm',
        offerDishPrompt: false,
      });
    });

    const viewInTripBtn = screen.getByTestId('log-toast-view-in-trip');
    expect(viewInTripBtn).toBeTruthy();

    fireEvent.press(viewInTripBtn);
    expect(mockNavigateToTripFeed).toHaveBeenCalledWith({ tripId: 'trip-123' });
    expect(screen.queryByTestId('log-toast')).toBeNull();
  });

  it('shows Dish_Prompt only when offerDishPrompt is true and opens the picker with experienceId', () => {
    render(<LogToastHost />);

    act(() => {
      useLogToastStore.getState().show({
        message: 'Be Our Guest Restaurant logged',
        tripId: null,
        experienceId: 'exp-bog',
        offerDishPrompt: true,
      });
    });

    const dishBtn = screen.getByTestId('log-toast-dish-prompt');
    expect(dishBtn).toBeTruthy();
    expect(screen.getByText('Log what you ate')).toBeTruthy();

    fireEvent.press(dishBtn);

    // Toast is dismissed and picker is opened with the restaurant's experienceId
    expect(screen.queryByTestId('log-toast')).toBeNull();
    expect(screen.getByTestId('mock-food-picker')).toBeTruthy();
    expect(screen.getByTestId('mock-food-picker-exp').props.children).toBe(
      'exp-bog',
    );

    // Selecting a dish opens the LogFoodItemModal
    fireEvent.press(screen.getByTestId('mock-food-picker-select'));
    expect(screen.queryByTestId('mock-food-picker')).toBeNull();
    expect(screen.getByTestId('mock-food-log-modal')).toBeTruthy();
    expect(
      screen.getByTestId('mock-food-log-dish-name').props.children,
    ).toBe('Dole Whip');
  });

  it('auto-dismisses non-dish toast after LOG_TOAST_MS (6000ms)', () => {
    render(<LogToastHost />);

    act(() => {
      useLogToastStore.getState().show({
        message: 'Haunted Mansion logged',
        tripId: null,
        experienceId: 'exp-hm',
        offerDishPrompt: false,
      });
    });

    expect(screen.getByTestId('log-toast')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(LOG_TOAST_MS - 100);
    });
    expect(screen.getByTestId('log-toast')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId('log-toast')).toBeNull();
  });

  it('auto-dismisses dish-prompt toast after LOG_TOAST_WITH_DISH_PROMPT_MS (8000ms)', () => {
    render(<LogToastHost />);

    act(() => {
      useLogToastStore.getState().show({
        message: 'Cinderella Royal Table logged',
        tripId: null,
        experienceId: 'exp-crt',
        offerDishPrompt: true,
      });
    });

    expect(screen.getByTestId('log-toast')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(LOG_TOAST_MS + 100);
    });
    // Still visible at 6.1s because offerDishPrompt duration is 8s
    expect(screen.getByTestId('log-toast')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(
        LOG_TOAST_WITH_DISH_PROMPT_MS - (LOG_TOAST_MS + 100),
      );
    });
    expect(screen.queryByTestId('log-toast')).toBeNull();
  });

  it('replaces a previous toast and resets the timer when show is called again', () => {
    render(<LogToastHost />);

    act(() => {
      useLogToastStore.getState().show({
        message: 'First Ride logged',
        tripId: null,
        experienceId: 'exp-1',
        offerDishPrompt: false,
      });
    });
    expect(screen.getByText('First Ride logged')).toBeTruthy();

    // Advance 4s
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText('First Ride logged')).toBeTruthy();

    // Trigger second toast
    act(() => {
      useLogToastStore.getState().show({
        message: 'Second Ride logged to Disney Trip',
        tripId: 'trip-2',
        experienceId: 'exp-2',
        offerDishPrompt: false,
      });
    });

    // Old message replaced, not stacked
    expect(screen.queryByText('First Ride logged')).toBeNull();
    expect(screen.getByText('Second Ride logged to Disney Trip')).toBeTruthy();
    expect(screen.getAllByTestId('log-toast').length).toBe(1);

    // After 4s more, total 8s since first toast, the second toast should still be visible because timer was reset
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText('Second Ride logged to Disney Trip')).toBeTruthy();

    // Advance remaining 2s to complete the 6s for second toast
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.queryByTestId('log-toast')).toBeNull();
  });
});
