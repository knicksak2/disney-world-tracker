/**
 * Component and interaction tests for ExplorationPromptCard.
 *
 * Validates: Requirement 2.1 (Vacation Context hero: "an exploration prompt when no trips exist").
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import * as navigationRefModule from '../../../navigation/navigationRef';
import ExplorationPromptCard from '../ExplorationPromptCard';

describe('ExplorationPromptCard (Requirement 2.1)', () => {
  it('renders with title, tag, subtitle, and accessible button semantics', () => {
    render(<ExplorationPromptCard />);

    const card = screen.getByTestId('home-exploration-prompt-card');
    expect(card).toBeTruthy();
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe(
      'Plan your next adventure. Explore parks, build itineraries, and invite your crew.',
    );

    expect(screen.getByText('PLAN A VACATION')).toBeTruthy();
    expect(screen.getByText('Plan Your Next Adventure')).toBeTruthy();
    expect(
      screen.getByText('Explore parks, build itineraries & invite crew'),
    ).toBeTruthy();
  });

  it('triggers custom onPress handler on tap when provided', () => {
    const handlePress = jest.fn();
    render(<ExplorationPromptCard onPress={handlePress} />);

    const card = screen.getByTestId('home-exploration-prompt-card');
    fireEvent.press(card);

    expect(handlePress).toHaveBeenCalledTimes(1);
  });

  it('falls back to navigateToTripsList when onPress is not provided', () => {
    const navigateToTripsListSpy = jest
      .spyOn(navigationRefModule, 'navigateToTripsList')
      .mockReturnValue(true);

    render(<ExplorationPromptCard />);

    const card = screen.getByTestId('home-exploration-prompt-card');
    fireEvent.press(card);

    expect(navigateToTripsListSpy).toHaveBeenCalledTimes(1);

    navigateToTripsListSpy.mockRestore();
  });
});
