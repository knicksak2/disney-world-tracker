/**
 * Feature: dark-mode — B3-N3 render coverage for the two "add to" sheets.
 *
 * `AddToTripPickerSheet`'s `statusMeta(t)` badges and both sheets' primaryFg
 * icons must take the active theme (light keeps today's values).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';
import type { TripDTO } from '@dwt/shared';

import AddToTripPickerSheet from '../AddToTripPickerSheet';
import AddToTripOrListChoiceSheet from '../AddToTripOrListChoiceSheet';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';
import { darkTheme } from '../../../theme/theme';

const baseTrip = {
  description: null,
  createdAt: '2026-09-01T00:00:00Z',
  resorts: [],
  foodLists: [],
  experienceLists: [],
};
const TRIPS = [
  {
    ...baseTrip,
    id: 'trip-active',
    name: 'Fall Magic',
    startDate: '2026-10-01',
    endDate: '2026-10-05',
    status: 'active',
  },
  {
    ...baseTrip,
    id: 'trip-upcoming',
    name: 'Holiday Trip',
    startDate: '2026-12-20',
    endDate: '2026-12-24',
    status: 'upcoming',
  },
] as unknown as TripDTO[];

const flat = (node: { props: { style?: unknown } }): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

function badgeTextColor(id: string): unknown {
  return flat(within(screen.getByTestId(id)).getByText(/./)).color;
}

describe('AddToTripPickerSheet / AddToTripOrListChoiceSheet themes', () => {
  afterEach(resetTestScheme);

  it('dark: trip status badges and the sheet surface use dark tokens', () => {
    setTestScheme('dark');
    render(
      <AddToTripPickerSheet visible trips={TRIPS} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(badgeTextColor('add-to-trip-picker-status-trip-upcoming')).toBe(
      darkTheme.color.primaryFg,
    );
    expect(badgeTextColor('add-to-trip-picker-status-trip-active')).toBe(darkTheme.color.success);
    expect(flat(screen.getByText('Add to which trip?')).color).toBe(darkTheme.color.textPrimary);
    expect(
      within(screen.getByTestId('add-to-trip-picker-close-btn')).UNSAFE_getByType(Ionicons).props
        .color,
    ).toBe(darkTheme.color.textSecondary);
  });

  it('light: status badges keep today\'s #5b2a86 / #2e9e6b', () => {
    setTestScheme('light');
    render(
      <AddToTripPickerSheet visible trips={TRIPS} onSelect={jest.fn()} onClose={jest.fn()} />,
    );
    expect(badgeTextColor('add-to-trip-picker-status-trip-upcoming')).toBe('#5b2a86');
    expect(badgeTextColor('add-to-trip-picker-status-trip-active')).toBe('#2e9e6b');
  });

  it('dark: the choice sheet option icons are primaryFg on surfaceAlt rows', () => {
    setTestScheme('dark');
    render(
      <AddToTripOrListChoiceSheet
        visible
        onClose={jest.fn()}
        onAddToTrip={jest.fn()}
        onAddToList={jest.fn()}
      />,
    );
    const tripOption = screen.getByTestId('add-to-trip-or-list-choice-trip');
    const addIcon = within(tripOption)
      .UNSAFE_getAllByType(Ionicons)
      .find((i) => i.props.name === 'add')!;
    expect(addIcon.props.color).toBe(darkTheme.color.primaryFg);
    expect(flat(tripOption).backgroundColor).toBe(darkTheme.color.surfaceAlt);
    expect(flat(screen.getByText('Add to Trip')).color).toBe(darkTheme.color.textPrimary);
  });
});
