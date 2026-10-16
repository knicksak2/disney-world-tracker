/**
 * Component and interaction tests for ExplorationPromptCard.
 *
 * Validates: Requirement 2.1 (Vacation Context hero: "an exploration prompt when no trips exist").
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import * as navigationRefModule from '../../../navigation/navigationRef';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';
import ExplorationPromptCard from '../ExplorationPromptCard';
import { EXPLORATION_PROMPT } from '../ExplorationPromptCard.palette';

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

describe('ExplorationPromptCard — dark mode', () => {
  afterEach(resetTestScheme);

  it('(c) converted literals render their dark palette / token values', () => {
    setTestScheme('dark');
    render(<ExplorationPromptCard />);

    const card = StyleSheet.flatten(screen.getByTestId('home-exploration-prompt-card').props.style);
    expect(card.borderColor).toBe(EXPLORATION_PROMPT.dark.cardBorder);
    expect(card.backgroundColor).toBe(darkTheme.color.surface);
    expect(StyleSheet.flatten(screen.getByText('PLAN A VACATION').props.style).color).toBe(
      darkTheme.color.primaryLight,
    );
    expect(StyleSheet.flatten(screen.getByText('Plan Your Next Adventure').props.style).color).toBe(
      darkTheme.color.textPrimary,
    );
  });

  it('keeps the original light literals under light', () => {
    render(<ExplorationPromptCard />);
    const card = StyleSheet.flatten(screen.getByTestId('home-exploration-prompt-card').props.style);
    expect(card.borderColor).toBe('#ebdff8');
    expect(StyleSheet.flatten(screen.getByText('PLAN A VACATION').props.style).color).toBe('#7e57c2');
  });
});
