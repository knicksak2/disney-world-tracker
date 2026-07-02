/**
 * ExperiencesList — the shared Experiences list + Experience_Filter UI
 * (task 5.5).
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
 *   - **Filter controls (R14.3, R14.9).** Two controls — Park and Category —
 *     each offer `All` plus exactly one option per catalog `PARKS` entry and
 *     per `EXPERIENCE_CATEGORIES` entry. Each control wrapper exposes an
 *     `accessibilityLabel` naming the control and an `accessibilityValue`
 *     reflecting the currently active selection.
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
 * 14.6, 14.7, 14.8, 14.9
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type CompletionEntryDTO,
} from '@dwt/shared';

import { theme } from '../../theme/theme';
import { Chip, EmptyState } from '../../theme/components';
import { CompletionRow } from './CompletionRow';
import {
  applyExperienceFilter,
  DEFAULT_FILTER,
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
  // Independent per-instance filter state (R14.1, R14.2).
  const [filter, setFilter] = React.useState<ExperienceFilterState>(DEFAULT_FILTER);

  // The unfiltered named set decides whether to show the mode empty-state
  // (R5.4, R13.4) versus the filter + (possibly empty) list.
  const hasNamedEntries = namedEntries(entries).length > 0;

  // Synchronous, read-free re-derivation on every render (R14.4, R14.7).
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

  return (
    <View style={styles.container} testID={`${testIDPrefix}-experiences-list`}>
      {/* Park selection control (R14.3, R14.9). */}
      <FilterControl
        label="Filter by park"
        valueText={parkValueText(filter.park)}
        testID={`${testIDPrefix}-filter-park`}
      >
        <FilterChip
          label="All"
          active={filter.park === 'All'}
          onPress={() => {
            setFilter((prev) => ({ ...prev, park: 'All' }));
          }}
          testID={`${testIDPrefix}-filter-park-option-All`}
        />
        {PARKS.map((park) => (
          <FilterChip
            key={park}
            label={park}
            active={filter.park === park}
            onPress={() => {
              setFilter((prev) => ({ ...prev, park }));
            }}
            testID={`${testIDPrefix}-filter-park-option-${park}`}
          />
        ))}
      </FilterControl>

      {/* Category selection control (R14.3, R14.9). */}
      <FilterControl
        label="Filter by experience type"
        valueText={categoryValueText(filter.category)}
        testID={`${testIDPrefix}-filter-category`}
      >
        <FilterChip
          label="All"
          active={filter.category === 'All'}
          onPress={() => {
            setFilter((prev) => ({ ...prev, category: 'All' }));
          }}
          testID={`${testIDPrefix}-filter-category-option-All`}
        />
        {EXPERIENCE_CATEGORIES.map((category) => (
          <FilterChip
            key={category}
            label={categoryLabel(category)}
            active={filter.category === category}
            onPress={() => {
              setFilter((prev) => ({ ...prev, category }));
            }}
            testID={`${testIDPrefix}-filter-category-option-${category}`}
          />
        ))}
      </FilterControl>

      {/* Filtered list, or the no-match message (R14.8). */}
      {visible.length === 0 ? (
        <EmptyState
          icon="filter-outline"
          title="No completed Experiences match the active filter"
          body="Try a different park or experience type."
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
// Subcomponents
// ---------------------------------------------------------------------------

/**
 * A single filter control: a label, a horizontally scrollable row of option
 * chips, and the accessibility wiring required by R14.9. The wrapper carries
 * the `accessibilityLabel` naming the control and the `accessibilityValue`
 * reflecting the active selection.
 */
function FilterControl({
  label,
  valueText,
  testID,
  children,
}: {
  readonly label: string;
  readonly valueText: string;
  readonly testID: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <View
      style={styles.control}
      testID={testID}
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText }}
    >
      <Text style={styles.controlLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** A single selectable filter option, rendered as a themed chip. */
function FilterChip({
  label,
  active,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}): JSX.Element {
  return <Chip label={label} active={active} onPress={onPress} testID={testID} />;
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
  control: {
    marginBottom: theme.spacing.md,
  },
  controlLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: theme.spacing.md,
  },
});
