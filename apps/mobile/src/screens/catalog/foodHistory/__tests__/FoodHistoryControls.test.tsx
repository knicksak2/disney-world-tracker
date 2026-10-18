import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import {
  FoodHistoryControls,
  type SortOption,
  type FilterChipOption,
} from '../FoodHistoryControls';

describe('FoodHistoryControls component', () => {
  const sortOptions: readonly SortOption[] = [
    { id: 'recent', label: 'Most Recent' },
    { id: 'highest_rated', label: 'Highest Rated' },
    { id: 'most_logged', label: 'Most Logged' },
  ];

  const filterChips: readonly FilterChipOption[] = [
    { id: 'place-1', label: 'Aloha Isle' },
    { id: 'place-2', label: 'Pecos Bill' },
  ];

  it('renders search input, calls onSearchChange and clears search', () => {
    const onSearchChange = jest.fn();
    const { getByTestId } = render(
      <FoodHistoryControls
        searchText="dole"
        onSearchChange={onSearchChange}
        sortOptions={sortOptions}
        sort="recent"
        onSortChange={jest.fn()}
        filterChips={filterChips}
        selectedFilterIds={new Set()}
        onToggleFilter={jest.fn()}
        onClearFilter={jest.fn()}
      />,
    );

    const input = getByTestId('food-history-search-input');
    expect(input.props.value).toBe('dole');

    fireEvent.changeText(input, 'waffle');
    expect(onSearchChange).toHaveBeenCalledWith('waffle');

    const clearBtn = getByTestId('food-history-clear-search');
    expect(clearBtn.props.accessibilityRole).toBe('button');
    expect(clearBtn.props.accessibilityLabel).toBe('Clear search text');

    fireEvent.press(clearBtn);
    expect(onSearchChange).toHaveBeenCalledWith('');
  });

  it('renders sort chips and calls onSortChange on tap', () => {
    const onSortChange = jest.fn();
    const { getByTestId } = render(
      <FoodHistoryControls
        searchText=""
        onSearchChange={jest.fn()}
        sortOptions={sortOptions}
        sort="recent"
        onSortChange={onSortChange}
        filterChips={filterChips}
        selectedFilterIds={new Set()}
        onToggleFilter={jest.fn()}
        onClearFilter={jest.fn()}
      />,
    );

    const highestRatedChip = getByTestId('sort-chip-highest_rated');
    expect(highestRatedChip.props.accessibilityRole).toBe('button');
    expect(highestRatedChip.props.accessibilityLabel).toBe('Sort by Highest Rated');

    fireEvent.press(highestRatedChip);
    expect(onSortChange).toHaveBeenCalledWith('highest_rated');
  });

  it('renders filter chips and handles toggle and clear', () => {
    const onToggleFilter = jest.fn();
    const onClearFilter = jest.fn();

    const { getByTestId } = render(
      <FoodHistoryControls
        searchText=""
        onSearchChange={jest.fn()}
        sortOptions={sortOptions}
        sort="recent"
        onSortChange={jest.fn()}
        filterChips={filterChips}
        selectedFilterIds={new Set(['place-1'])}
        onToggleFilter={onToggleFilter}
        onClearFilter={onClearFilter}
      />,
    );

    const allChip = getByTestId('restaurant-filter-all');
    expect(allChip.props.accessibilityRole).toBe('button');
    expect(allChip.props.accessibilityLabel).toBe('All places');
    fireEvent.press(allChip);
    expect(onClearFilter).toHaveBeenCalledTimes(1);

    const chip1 = getByTestId('restaurant-filter-place-1');
    expect(chip1.props.accessibilityRole).toBe('button');
    expect(chip1.props.accessibilityLabel).toBe('Filter by Aloha Isle');

    const chip2 = getByTestId('restaurant-filter-place-2');
    fireEvent.press(chip2);
    expect(onToggleFilter).toHaveBeenCalledWith('place-2');
  });
});
