import React from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { makeStyles } from '../../../theme/makeStyles';
import { useAppTheme } from '../../../theme/useAppTheme';

export interface SortOption<S extends string = string> {
  readonly id: S;
  readonly label: string;
}

export interface FilterChipOption {
  readonly id: string;
  readonly label: string;
  readonly testID?: string | undefined;
}

export interface FoodHistoryControlsProps<S extends string = string> {
  readonly searchText: string;
  readonly onSearchChange: (text: string) => void;
  readonly searchPlaceholder?: string | undefined;
  readonly searchInputTestId?: string | undefined;
  readonly searchClearTestId?: string | undefined;

  readonly sortOptions: readonly SortOption<S>[];
  readonly sort: S;
  readonly onSortChange: (sort: S) => void;
  readonly sortChipTestIdPrefix?: string | undefined;

  readonly filterChips?: readonly FilterChipOption[] | undefined;
  readonly selectedFilterIds: ReadonlySet<string>;
  readonly onToggleFilter: (id: string) => void;
  readonly onClearFilter: () => void;
  readonly allFilterLabel?: string | undefined;
  readonly allFilterAccessibilityLabel?: string | undefined;
  readonly allFilterTestId?: string | undefined;
  readonly filterChipTestIdPrefix?: string | undefined;
}

export function FoodHistoryControls<S extends string = string>({
  searchText,
  onSearchChange,
  searchPlaceholder = 'Search dishes or places...',
  searchInputTestId = 'food-history-search-input',
  searchClearTestId = 'food-history-clear-search',
  sortOptions,
  sort,
  onSortChange,
  sortChipTestIdPrefix = 'sort-chip-',
  filterChips,
  selectedFilterIds,
  onToggleFilter,
  onClearFilter,
  allFilterLabel = 'All Places',
  allFilterAccessibilityLabel = 'All places',
  allFilterTestId = 'restaurant-filter-all',
  filterChipTestIdPrefix = 'restaurant-filter-',
}: FoodHistoryControlsProps<S>): JSX.Element {
  const styles = useStyles();
  const t = useAppTheme();

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={t.color.textSecondary} />
        <TextInput
          value={searchText}
          onChangeText={onSearchChange}
          placeholder={searchPlaceholder}
          placeholderTextColor={t.color.textSecondary}
          keyboardAppearance={t.scheme}
          style={styles.searchInput}
          testID={searchInputTestId}
          autoCorrect={false}
        />
        {searchText.length > 0 && (
          <Pressable
            onPress={() => onSearchChange('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search text"
            style={styles.clearBtn}
            testID={searchClearTestId}
          >
            <Ionicons name="close-circle" size={18} color={t.color.textSecondary} />
          </Pressable>
        )}
      </View>

      {/* Sort chips */}
      <View style={styles.sortSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {sortOptions.map((option) => {
            const active = sort === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => onSortChange(option.id)}
                accessibilityRole="button"
                accessibilityLabel={`Sort by ${option.label}`}
                style={[styles.chip, active && styles.chipActive]}
                testID={`${sortChipTestIdPrefix}${option.id}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Filter chips */}
      {filterChips && filterChips.length > 0 && (
        <View style={styles.filterSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
          >
            <Pressable
              onPress={onClearFilter}
              accessibilityRole="button"
              accessibilityLabel={allFilterAccessibilityLabel}
              style={[
                styles.filterChip,
                selectedFilterIds.size === 0 && styles.filterChipActive,
              ]}
              testID={allFilterTestId}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedFilterIds.size === 0 && styles.filterChipTextActive,
                ]}
              >
                {allFilterLabel}
              </Text>
            </Pressable>
            {filterChips.map((chip) => {
              const active = selectedFilterIds.has(chip.id);
              return (
                <Pressable
                  key={chip.id}
                  onPress={() => onToggleFilter(chip.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter by ${chip.label}`}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  testID={chip.testID ?? `${filterChipTestIdPrefix}${chip.id}`}
                >
                  <Text
                    style={[styles.filterChipText, active && styles.filterChipTextActive]}
                    numberOfLines={1}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    paddingBottom: t.spacing.xs,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.color.surfaceAlt,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color.border,
    paddingHorizontal: t.spacing.md,
    marginHorizontal: t.spacing.lg,
    marginBottom: t.spacing.sm,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: t.spacing.sm,
    fontSize: 15,
    color: t.color.textPrimary,
  },
  clearBtn: {
    padding: 4,
  },
  sortSection: {
    marginBottom: t.spacing.xs,
  },
  filterSection: {
    marginBottom: t.spacing.sm,
  },
  chipsScroll: {
    paddingHorizontal: t.spacing.lg,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surfaceAlt,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  chipActive: {
    backgroundColor: t.color.primary,
    borderColor: t.color.primary,
  },
  chipText: {
    fontSize: 13,
    color: t.color.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: t.color.textOnPrimary,
    fontWeight: '700',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: t.radius.pill,
    backgroundColor: t.color.surface,
    borderWidth: 1,
    borderColor: t.color.border,
  },
  filterChipActive: {
    backgroundColor: t.color.surfaceAlt,
    borderColor: t.color.primaryFg,
  },
  filterChipText: {
    fontSize: 12,
    color: t.color.textSecondary,
  },
  filterChipTextActive: {
    color: t.color.primaryFg,
    fontWeight: '600',
  },
}));
