/**
 * GroupFavoritesSection — component tests (Task 14.3).
 *
 * Validates: Requirements 9.1, 9.4, 9.5, 9.6, 9.7, 9.8
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { GroupFavoriteDTO, Park } from '@dwt/shared';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'http://test.local' } },
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    __esModule: true,
    ...actual,
    apiRequest: jest.fn(),
  };
});

import GroupFavoritesSection from '../GroupFavoritesSection';
import { GROUP_FAVORITES } from '../GroupFavoritesSection.palette';
import { apiRequest as mockedApiRequest } from '../../../api/client';
import { darkTheme } from '../../../theme/theme';
import { resetTestScheme, setTestScheme } from '../../../test/themeTestUtils';

const apiRequestMock = mockedApiRequest as jest.MockedFunction<
  typeof mockedApiRequest
>;

const TRIP_ID = 'trip-favs-1';

function makeItem(
  index: number,
  park: Park | null,
  names: readonly string[] = ['Alice', 'Bob'],
): GroupFavoriteDTO {
  return {
    experienceId: `exp-${index}`,
    experienceName: `Experience ${index}`,
    park,
    category: 'Ride',
    favoritingCount: names.length,
    favoritingDisplayNames: names,
  };
}

const FIVE_ITEMS: readonly GroupFavoriteDTO[] = [
  makeItem(1, 'Magic Kingdom', ['Alice', 'Bob', 'Charlie']),
  makeItem(2, 'EPCOT', ['Alice', 'Bob']),
  makeItem(3, 'Hollywood Studios', ['Alice', 'Charlie']),
  makeItem(4, 'Animal Kingdom', ['Bob', 'Charlie']),
  makeItem(5, 'Magic Kingdom', ['Alice', 'Bob']),
];

const EIGHT_ITEMS_THREE_PARKS: readonly GroupFavoriteDTO[] = [
  // Intentionally mix parks so canonical PARKS ordering of pills is exercised:
  // Hollywood Studios, EPCOT, Magic Kingdom -> pills must render Magic Kingdom, EPCOT, Hollywood Studios
  { ...makeItem(1, 'Hollywood Studios', ['Alice', 'Bob', 'Charlie']), experienceName: 'Tower of Terror' },
  { ...makeItem(2, 'EPCOT', ['Alice', 'Bob', 'Charlie']), experienceName: 'Cosmic Rewind' },
  { ...makeItem(3, 'Magic Kingdom', ['Alice', 'Bob', 'Charlie']), experienceName: 'Space Mountain' },
  { ...makeItem(4, 'EPCOT', ['Alice', 'Diana']), experienceName: 'Remy Ratatouille Adventure' },
  { ...makeItem(5, 'Magic Kingdom', ['Bob', 'Charlie']), experienceName: 'TRON Lightcycle Run' },
  { ...makeItem(6, 'Hollywood Studios', ['Alice', 'Diana']), experienceName: 'Rise of the Resistance' },
  { ...makeItem(7, 'EPCOT', ['Diana', 'Evan']), experienceName: 'Frozen Ever After' },
  { ...makeItem(8, 'Magic Kingdom', ['Alice', 'Evan']), experienceName: 'Big Thunder Mountain' },
];

const SEVEN_SINGLE_PARK_ITEMS: readonly GroupFavoriteDTO[] = Array.from(
  { length: 7 },
  (_, i) => makeItem(i + 1, 'Magic Kingdom', ['Alice', 'Bob']),
);

function renderSection(
  onSelectExperience: jest.Mock = jest.fn(),
): { onSelectExperience: jest.Mock } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  render(
    <QueryClientProvider client={client}>
      <GroupFavoritesSection
        tripId={TRIP_ID}
        onSelectExperience={onSelectExperience}
      />
    </QueryClientProvider>,
  );

  return { onSelectExperience };
}

describe('GroupFavoritesSection (Requirements 9.6–9.8)', () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
  });

  afterEach(() => {
    resetTestScheme();
  });

  test('boundary (<= 5 items): renders all 5 inline with no See all trigger', async () => {
    apiRequestMock.mockResolvedValue({ items: FIVE_ITEMS });

    renderSection();

    for (const item of FIVE_ITEMS) {
      expect(
        await screen.findByTestId(`group-favorite-item-${item.experienceId}`),
      ).toBeTruthy();
    }
    expect(screen.queryByTestId('group-favorites-see-all-btn')).toBeNull();
    expect(screen.queryByTestId('group-favorites-modal')).toBeNull();
  });

  test('overflow (> 5 items): caps inline list at 5 and opens full modal to select item #7', async () => {
    apiRequestMock.mockResolvedValue({ items: EIGHT_ITEMS_THREE_PARKS });
    const onSelect = jest.fn();

    renderSection(onSelect);

    // Inline shows only top 5
    for (let i = 1; i <= 5; i += 1) {
      expect(await screen.findByTestId(`group-favorite-item-exp-${i}`)).toBeTruthy();
    }
    for (let i = 6; i <= 8; i += 1) {
      expect(screen.queryByTestId(`group-favorite-item-exp-${i}`)).toBeNull();
    }

    const seeAllBtn = screen.getByTestId('group-favorites-see-all-btn');
    expect(within(seeAllBtn).getByText('See all 8 favorites')).toBeTruthy();
    expect(screen.queryByTestId('group-favorites-modal')).toBeNull();

    // Open modal
    fireEvent.press(seeAllBtn);
    const modal = await screen.findByTestId('group-favorites-modal');
    expect(modal).toBeTruthy();

    for (let i = 1; i <= 8; i += 1) {
      expect(screen.getByTestId(`group-favorite-modal-item-exp-${i}`)).toBeTruthy();
    }

    // Select item #7 from modal -> closes modal and invokes onSelectExperience('exp-7')
    fireEvent.press(screen.getByTestId('group-favorite-modal-item-exp-7'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('exp-7');
    expect(screen.queryByTestId('group-favorites-modal')).toBeNull();
  });

  test('modal park pills render in canonical order and compose conjunctively with search and clear', async () => {
    apiRequestMock.mockResolvedValue({ items: EIGHT_ITEMS_THREE_PARKS });

    renderSection();
    fireEvent.press(await screen.findByTestId('group-favorites-see-all-btn'));

    const parkFilters = await screen.findByTestId('group-favorites-modal-park-filters');
    expect(parkFilters).toBeTruthy();

    const pillButtons = within(parkFilters).getAllByRole('button');
    expect(pillButtons.map((b) => b.props.testID)).toEqual([
      'group-favorites-park-pill-all',
      'group-favorites-park-pill-Magic Kingdom',
      'group-favorites-park-pill-EPCOT',
      'group-favorites-park-pill-Hollywood Studios',
    ]);
    expect(within(parkFilters).getByText('All (8)')).toBeTruthy();
    expect(within(parkFilters).getByText('Magic Kingdom (3)')).toBeTruthy();
    expect(within(parkFilters).getByText('EPCOT (3)')).toBeTruthy();
    expect(within(parkFilters).getByText('Hollywood Studios (2)')).toBeTruthy();

    // Select EPCOT pill -> only EPCOT items (exp-2, exp-4, exp-7)
    fireEvent.press(screen.getByTestId('group-favorites-park-pill-EPCOT'));
    expect(screen.getByTestId('group-favorite-modal-item-exp-2')).toBeTruthy();
    expect(screen.getByTestId('group-favorite-modal-item-exp-4')).toBeTruthy();
    expect(screen.getByTestId('group-favorite-modal-item-exp-7')).toBeTruthy();
    expect(screen.queryByTestId('group-favorite-modal-item-exp-1')).toBeNull();
    expect(screen.queryByTestId('group-favorite-modal-item-exp-3')).toBeNull();

    // Search by member name "Evan" conjunctively inside EPCOT -> only exp-7 (exp-8 is MK)
    const searchInput = screen.getByTestId('group-favorites-modal-search');
    fireEvent.changeText(searchInput, 'Evan');
    expect(screen.getByTestId('group-favorite-modal-item-exp-7')).toBeTruthy();
    expect(screen.queryByTestId('group-favorite-modal-item-exp-2')).toBeNull();
    expect(screen.queryByTestId('group-favorite-modal-item-exp-8')).toBeNull();
    expect(screen.getByText('Showing 1 of 8')).toBeTruthy();

    // Clear search button restores EPCOT items while keeping EPCOT pill selected
    fireEvent.press(screen.getByTestId('group-favorites-modal-search-clear'));
    expect(screen.getByTestId('group-favorite-modal-item-exp-2')).toBeTruthy();
    expect(screen.getByTestId('group-favorite-modal-item-exp-4')).toBeTruthy();
    expect(screen.getByTestId('group-favorite-modal-item-exp-7')).toBeTruthy();
    expect(screen.queryByTestId('group-favorite-modal-item-exp-1')).toBeNull();

    // Tapping "Reset" in status row clears the park filter and restores all 8
    fireEvent.press(screen.getByTestId('group-favorites-modal-reset-filters'));
    for (let i = 1; i <= 8; i += 1) {
      expect(screen.getByTestId(`group-favorite-modal-item-exp-${i}`)).toBeTruthy();
    }

    // Re-select EPCOT, toggle it off by pressing EPCOT again, then select & switch via All pill
    fireEvent.press(screen.getByTestId('group-favorites-park-pill-EPCOT'));
    expect(screen.queryByTestId('group-favorite-modal-item-exp-1')).toBeNull();
    fireEvent.press(screen.getByTestId('group-favorites-park-pill-EPCOT'));
    expect(screen.getByTestId('group-favorite-modal-item-exp-1')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-favorites-park-pill-EPCOT'));
    expect(screen.queryByTestId('group-favorite-modal-item-exp-1')).toBeNull();
    fireEvent.press(screen.getByTestId('group-favorites-park-pill-all'));
    expect(screen.getByTestId('group-favorite-modal-item-exp-1')).toBeTruthy();

    // Re-filter then search unmatched -> empty state + Clear filters restores all 8
    fireEvent.press(screen.getByTestId('group-favorites-park-pill-EPCOT'));
    fireEvent.changeText(searchInput, 'zzzz-no-match');
    expect(await screen.findByTestId('group-favorites-modal-empty')).toBeTruthy();
    expect(screen.getByText('No matching favorites')).toBeTruthy();

    fireEvent.press(screen.getByTestId('group-favorites-modal-clear-filters'));
    for (let i = 1; i <= 8; i += 1) {
      expect(screen.getByTestId(`group-favorite-modal-item-exp-${i}`)).toBeTruthy();
    }
  });

  test('single-park overflow omits park filter pills while keeping search', async () => {
    apiRequestMock.mockResolvedValue({ items: SEVEN_SINGLE_PARK_ITEMS });

    renderSection();
    fireEvent.press(await screen.findByTestId('group-favorites-see-all-btn'));

    expect(await screen.findByTestId('group-favorites-modal-search')).toBeTruthy();
    expect(screen.queryByTestId('group-favorites-modal-park-filters')).toBeNull();
  });

  test('closing and reopening the modal resets search and park filters', async () => {
    apiRequestMock.mockResolvedValue({ items: EIGHT_ITEMS_THREE_PARKS });

    renderSection();
    fireEvent.press(await screen.findByTestId('group-favorites-see-all-btn'));

    fireEvent.press(await screen.findByTestId('group-favorites-park-pill-EPCOT'));
    fireEvent.changeText(screen.getByTestId('group-favorites-modal-search'), 'Cosmic');
    expect(screen.queryByTestId('group-favorite-modal-item-exp-1')).toBeNull();

    // Close modal via close button
    fireEvent.press(screen.getByTestId('group-favorites-modal-close'));
    expect(screen.queryByTestId('group-favorites-modal')).toBeNull();

    // Reopen modal -> filters are reset
    fireEvent.press(screen.getByTestId('group-favorites-see-all-btn'));
    expect(screen.getByTestId('group-favorites-modal-search').props.value).toBe('');
    for (let i = 1; i <= 8; i += 1) {
      expect(screen.getByTestId(`group-favorite-modal-item-exp-${i}`)).toBeTruthy();
    }

    // Dismiss via backdrop press
    fireEvent.press(screen.getByTestId('group-favorites-modal-backdrop'));
    expect(screen.queryByTestId('group-favorites-modal')).toBeNull();
  });

  test('dark mode paints See all text, modal backdrop, and modal sheet with Twilight tokens', async () => {
    apiRequestMock.mockResolvedValue({ items: EIGHT_ITEMS_THREE_PARKS });
    setTestScheme('dark');

    renderSection();

    const seeAllBtn = await screen.findByTestId('group-favorites-see-all-btn');
    const seeAllText = within(seeAllBtn).getByText('See all 8 favorites');
    expect(StyleSheet.flatten(seeAllText.props.style).color).toBe(
      darkTheme.color.primaryFg,
    );

    fireEvent.press(seeAllBtn);
    const backdrop = await screen.findByTestId('group-favorites-modal-backdrop');
    const sheet = screen.getByTestId('group-favorites-modal-sheet');
    expect(StyleSheet.flatten(backdrop.props.style).backgroundColor).toBe(
      GROUP_FAVORITES.dark.overlayBg,
    );
    expect(StyleSheet.flatten(sheet.props.style).backgroundColor).toBe(
      darkTheme.color.surface,
    );
  });
});
