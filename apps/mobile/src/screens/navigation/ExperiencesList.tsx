/**
 * ExperiencesList — the shared Experiences list + Experience_Filter UI
 * (task 5.5, 5.7).
 *
 * Rendered by both the Friend_Profile_View's Experiences mode and the
 * Own_Stats_View's Own_Experiences mode over an already-loaded list of
 * Completion_Entries. It owns its own Experience_Filter state, so the two
 * lists' filters are fully independent — each instance keeps its own Park and
 * Category selection (R14.1).
 *
 * Behavior:
 *
 *   - **Independent filter state (R14.1, R14.2).** Each instance holds its own
 *     `ExperienceFilterState` via `useState(DEFAULT_FILTER)`, so mounting two
 *     lists (Friend + own) never couples their selections; both default to
 *     `All` / `All` on first display.
 *
 *   - **Dropdown filter controls & pickers (R14.3, R14.9).** Two controls —
 *     Park and Category — each display the active selection in a compact pill
 *     and open a vertical selection tray offering `All` plus exactly one option
 *     per catalog `PARKS` entry and per `EXPERIENCE_CATEGORIES` entry. Each
 *     control exposes an `accessibilityLabel` naming the control and an
 *     `accessibilityValue` reflecting the currently active selection.
 *
 *   - **Filtering (R14.4, R14.5, R14.6, R14.7).** The displayed rows are
 *     `applyExperienceFilter(entries, state)` — a pure, synchronous fold over
 *     the already-loaded entries. Changing a selection re-derives the list in
 *     the same render pass (well under 300 ms) and never issues a read.
 *
 *   - **Empty states.** When the unfiltered named set is empty, the mode's
 *     empty-state message is shown instead of the filter + list (R5.4, R13.4).
 *     When the named set is non-empty but the active filter matches nothing,
 *     the controls remain and a "no match" message is shown (R14.8).
 *
 *   - **Rows (R5.1, R5.2, R13.1, R13.2).** Each surviving entry renders through
 *     the shared `CompletionRow` with `fields="experiences"` so both the Park
 *     and Category appear alongside the date, rating, and shared note. Source
 *     order from the originating read is preserved by `applyExperienceFilter`.
 *
 * Validates: Requirements 5.1, 5.4, 13.1, 13.4, 14.1, 14.2, 14.3, 14.4, 14.5,
 * 14.6, 14.7, 14.8, 14.9, 14.10, 14.11
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
} from '@dwt/shared';

import { theme } from '../../theme/theme';
import { EmptyState } from '../../theme/components';
import { CompletionRow } from './CompletionRow';
import {
  applyExperienceFilter,
  clearFilter,
  DEFAULT_FILTER,
  hasActiveFilter,
  type ExperienceFilterState,
  type FilterCategorySelection,
  type FilterParkSelection,
} from './experienceFilter';
import { namedEntries } from './grouping';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExperiencesList({
  entries,
  testIDPrefix,
  onOpenExperience,
}: {
  readonly entries: readonly CompletionEntryDTO[];
  readonly testIDPrefix: string;
  readonly onOpenExperience?: (experienceId: string) => void;
}): JSX.Element {
  // Independent per-instance filter state (R14.1, R14.2, R14.10).
  const [filter, setFilter] = React.useState<ExperienceFilterState>(DEFAULT_FILTER);
  const [activePicker, setActivePicker] = React.useState<'park' | 'category' | null>(null);

  // The unfiltered named set decides whether to show the mode empty-state
  // (R5.4, R13.4) versus the filter + (possibly empty) list.
  const totalNamed = namedEntries(entries).length;
  const hasNamedEntries = totalNamed > 0;

  // Synchronous, read-free re-derivation on every render (R14.4, R14.7, R14.10).
  const visible = applyExperienceFilter(entries, filter);

  // When nothing is loaded for this mode, show the mode empty-state instead of
  // the filter controls and list (R5.4, R13.4).
  if (!hasNamedEntries) {
    return (
      <View style={styles.container} testID={`${testIDPrefix}-experiences-list`}>
        <EmptyState
          icon="list-outline"
          title="No completed Experiences to show"
          body="There are no completed Experiences here yet."
          testID={`${testIDPrefix}-experiences-empty`}
        />
      </View>
    );
  }

  const isFiltering = hasActiveFilter(filter);

  return (
    <View style={styles.container} testID={`${testIDPrefix}-experiences-list`}>
      {/* Search bar (R14.10) */}
      <View style={styles.searchBar}>
        <Ionicons
          name="search"
          size={16}
          color={theme.color.textSecondary}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={filter.search ?? ''}
          onChangeText={(text) => setFilter((prev) => ({ ...prev, search: text }))}
          placeholder="Search completed experiences..."
          placeholderTextColor={theme.color.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search completed experiences"
          testID={`${testIDPrefix}-filter-search`}
        />
        {filter.search && filter.search.length > 0 ? (
          <Pressable
            onPress={() => setFilter((prev) => ({ ...prev, search: '' }))}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            testID={`${testIDPrefix}-filter-search-clear`}
            hitSlop={8}
            style={styles.searchClearBtn}
          >
            <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* Dropdown Selector Pills Row (R14.3, R14.9) */}
      <View style={styles.selectorRow}>
        <Pressable
          style={[
            styles.selectorPill,
            filter.park !== 'All' && styles.selectorPillActive,
            activePicker === 'park' && styles.selectorPillFocused,
          ]}
          onPress={() => setActivePicker((curr) => (curr === 'park' ? null : 'park'))}
          testID={`${testIDPrefix}-filter-park`}
          accessibilityRole="button"
          accessibilityLabel="Filter by park"
          accessibilityValue={{ text: parkValueText(filter.park) }}
        >
          <View style={styles.selectorPillContent}>
            <Ionicons
              name="business-outline"
              size={14}
              color={filter.park !== 'All' ? theme.color.primary : theme.color.textSecondary}
              style={styles.selectorIcon}
            />
            <Text
              style={[
                styles.selectorText,
                filter.park !== 'All' && styles.selectorTextActive,
              ]}
              numberOfLines={1}
            >
              {filter.park === 'All' ? 'Park: All' : filter.park}
            </Text>
          </View>
          <Ionicons
            name={activePicker === 'park' ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={filter.park !== 'All' ? theme.color.primary : theme.color.textSecondary}
          />
        </Pressable>

        <Pressable
          style={[
            styles.selectorPill,
            filter.category !== 'All' && styles.selectorPillActive,
            activePicker === 'category' && styles.selectorPillFocused,
          ]}
          onPress={() => setActivePicker((curr) => (curr === 'category' ? null : 'category'))}
          testID={`${testIDPrefix}-filter-category`}
          accessibilityRole="button"
          accessibilityLabel="Filter by experience type"
          accessibilityValue={{ text: categoryValueText(filter.category) }}
        >
          <View style={styles.selectorPillContent}>
            <Ionicons
              name="pricetag-outline"
              size={14}
              color={filter.category !== 'All' ? theme.color.primary : theme.color.textSecondary}
              style={styles.selectorIcon}
            />
            <Text
              style={[
                styles.selectorText,
                filter.category !== 'All' && styles.selectorTextActive,
              ]}
              numberOfLines={1}
            >
              {filter.category === 'All' ? 'Type: All' : categoryLabel(filter.category)}
            </Text>
          </View>
          <Ionicons
            name={activePicker === 'category' ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={filter.category !== 'All' ? theme.color.primary : theme.color.textSecondary}
          />
        </Pressable>
      </View>

      {/* Active filter summary & Reset control (R14.11) */}
      {isFiltering ? (
        <View style={styles.filterStatusBar}>
          <Text style={styles.filterStatusText}>
            Showing {visible.length} of {totalNamed}
          </Text>
          <Pressable
            onPress={() => {
              setFilter(clearFilter());
              setActivePicker(null);
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            testID={`${testIDPrefix}-filter-reset`}
            style={styles.resetBtn}
            hitSlop={6}
          >
            <Ionicons name="refresh-outline" size={13} color={theme.color.primary} />
            <Text style={styles.resetBtnText}>Clear filters</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Dropdown Selection Tray: Park (R14.3) */}
      <View
        testID={`${testIDPrefix}-filter-park-tray`}
        style={[styles.trayWrapper, activePicker === 'park' ? styles.trayVisible : styles.trayHidden]}
      >
        <View style={styles.trayHeader}>
          <Text style={styles.trayTitle}>Filter by Park</Text>
          <Pressable
            onPress={() => setActivePicker(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close park filter"
            testID={`${testIDPrefix}-filter-park-tray-close`}
          >
            <Ionicons name="close" size={18} color={theme.color.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.optionsList}>
          <Pressable
            style={[styles.optionItem, filter.park === 'All' && styles.optionItemActive]}
            onPress={() => {
              setFilter((prev) => ({ ...prev, park: 'All' }));
              setActivePicker(null);
            }}
            testID={`${testIDPrefix}-filter-park-option-All`}
            accessibilityRole="button"
            accessibilityLabel="All parks"
            accessibilityState={{ selected: filter.park === 'All' }}
          >
            <Text style={[styles.optionLabel, filter.park === 'All' && styles.optionLabelActive]}>
              All Parks
            </Text>
            {filter.park === 'All' ? (
              <Ionicons name="checkmark-circle" size={18} color={theme.color.primary} />
            ) : null}
          </Pressable>
          {PARKS.map((park) => {
            const isSelected = filter.park === park;
            return (
              <Pressable
                key={park}
                style={[styles.optionItem, isSelected && styles.optionItemActive]}
                onPress={() => {
                  setFilter((prev) => ({ ...prev, park }));
                  setActivePicker(null);
                }}
                testID={`${testIDPrefix}-filter-park-option-${park}`}
                accessibilityRole="button"
                accessibilityLabel={park}
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                  {park}
                </Text>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={18} color={theme.color.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Dropdown Selection Tray: Category (R14.3) */}
      <View
        testID={`${testIDPrefix}-filter-category-tray`}
        style={[styles.trayWrapper, activePicker === 'category' ? styles.trayVisible : styles.trayHidden]}
      >
        <View style={styles.trayHeader}>
          <Text style={styles.trayTitle}>Filter by Experience Type</Text>
          <Pressable
            onPress={() => setActivePicker(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close experience type filter"
            testID={`${testIDPrefix}-filter-category-tray-close`}
          >
            <Ionicons name="close" size={18} color={theme.color.textSecondary} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.scrollableOptionsList}
          showsVerticalScrollIndicator={true}
          nestedScrollEnabled={true}
        >
          <Pressable
            style={[styles.optionItem, filter.category === 'All' && styles.optionItemActive]}
            onPress={() => {
              setFilter((prev) => ({ ...prev, category: 'All' }));
              setActivePicker(null);
            }}
            testID={`${testIDPrefix}-filter-category-option-All`}
            accessibilityRole="button"
            accessibilityLabel="All types"
            accessibilityState={{ selected: filter.category === 'All' }}
          >
            <Text style={[styles.optionLabel, filter.category === 'All' && styles.optionLabelActive]}>
              All Types
            </Text>
            {filter.category === 'All' ? (
              <Ionicons name="checkmark-circle" size={18} color={theme.color.primary} />
            ) : null}
          </Pressable>
          {EXPERIENCE_CATEGORIES.map((category) => {
            const isSelected = filter.category === category;
            const label = categoryLabel(category);
            return (
              <Pressable
                key={category}
                style={[styles.optionItem, isSelected && styles.optionItemActive]}
                onPress={() => {
                  setFilter((prev) => ({ ...prev, category }));
                  setActivePicker(null);
                }}
                testID={`${testIDPrefix}-filter-category-option-${category}`}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                  {label}
                </Text>
                {isSelected ? (
                  <Ionicons name="checkmark-circle" size={18} color={theme.color.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Filtered list, or the no-match message (R14.8). */}
      {visible.length === 0 ? (
        <EmptyState
          icon="filter-outline"
          title="No completed Experiences match the active filter"
          body="Try a different search term, park, or experience type."
          testID={`${testIDPrefix}-experiences-no-match`}
        />
      ) : (
        visible.map((entry, index) => (
          <CompletionRow
            key={`${entry.experienceName}-${entry.completedOn}-${index}`}
            entry={entry}
            fields="experiences"
            {...(onOpenExperience !== undefined ? { onOpenExperience } : {})}
            testID={`${testIDPrefix}-experience-row-${index}`}
          />
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Friendly label for an Experience_Category, falling back to the raw enum. */
function categoryLabel(category: CompletionEntryDTO['category']): string {
  return theme.categoryVisual[category]?.label ?? category;
}

/** Accessibility value text for the current Park selection. */
function parkValueText(park: FilterParkSelection): string {
  return park === 'All' ? 'All' : park;
}

/** Accessibility value text for the current Category selection. */
function categoryValueText(category: FilterCategorySelection): string {
  return category === 'All' ? 'All' : categoryLabel(category);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    marginBottom: theme.spacing.sm,
    ...theme.shadow.card,
  },
  searchIcon: {
    marginRight: theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    color: theme.color.textPrimary,
  },
  searchClearBtn: {
    padding: 4,
    marginLeft: theme.spacing.xs,
  },
  selectorRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  selectorPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.pill,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  selectorPillActive: {
    backgroundColor: theme.color.surfaceAlt,
    borderColor: theme.color.primary,
  },
  selectorPillFocused: {
    borderColor: theme.color.primary,
  },
  selectorPillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 4,
  },
  selectorIcon: {
    marginRight: 6,
  },
  selectorText: {
    ...theme.typography.meta,
    fontSize: 13,
    color: theme.color.textPrimary,
    fontWeight: '500',
  },
  selectorTextActive: {
    color: theme.color.primary,
    fontWeight: '700',
  },
  filterStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: theme.spacing.xs,
  },
  filterStatusText: {
    ...theme.typography.meta,
    fontSize: 12,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: 12,
  },
  resetBtnText: {
    ...theme.typography.meta,
    fontSize: 11,
    color: theme.color.primary,
    fontWeight: '600',
  },
  trayWrapper: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    ...theme.shadow.card,
  },
  trayVisible: {
    opacity: 1,
  },
  trayHidden: {
    height: 0,
    opacity: 0,
    overflow: 'hidden',
    padding: 0,
    marginBottom: 0,
    borderWidth: 0,
  },
  trayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    marginBottom: 4,
  },
  trayTitle: {
    ...theme.typography.meta,
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  optionsList: {
    paddingVertical: 2,
  },
  scrollableOptionsList: {
    maxHeight: 280,
    paddingVertical: 2,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.radius.md,
  },
  optionItemActive: {
    backgroundColor: theme.color.surfaceAlt,
  },
  optionLabel: {
    ...theme.typography.body,
    fontSize: 14,
    color: theme.color.textPrimary,
  },
  optionLabelActive: {
    color: theme.color.primary,
    fontWeight: '700',
  },
});
