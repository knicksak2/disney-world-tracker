// Reusable "where you stayed" Resort multi-select.
//
// A searchable multi-select over the Catalog Resorts (`GET /resorts`). It
// replaces the long, unfiltered checkbox list with:
//   - a summary row of the currently-selected Resorts as removable chips
//     (always visible, even when filtered out by the search), so the current
//     stay is clear and can be cleared without hunting through the list;
//   - a search box that filters the list by name (case-insensitive substring);
//   - a bounded, scrollable results list of matching Resorts as tappable rows
//     with a checkbox reflecting selection.
//
// Used by the create-trip modal (`TripsListScreen`) and the edit form
// (`TripEditScreen`). Selection is controlled by the parent (`selectedIds` +
// `onToggle`); this component owns only the transient search query. The shared
// `TRIP_RESORT_LIMIT` bound is enforced by the parent's toggle handler.
//
// `testIDPrefix` namespaces the emitted testIDs so the two hosts stay
// distinct: `${prefix}-resorts` (container), `${prefix}-search` (query input),
// `${prefix}-resort-<id>` (a result row), `${prefix}-chip-<id>` (a selected
// chip), and `${prefix}-resorts-empty` (the no-matches state).

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { filterAndRankExperiences, type ResortDTO } from '@dwt/shared';

import { makeStyles } from '../theme/makeStyles';
import { useAppTheme } from '../theme/useAppTheme';

interface ResortPickerProps {
  /** All selectable Catalog Resorts (from `GET /resorts`). */
  readonly resorts: readonly ResortDTO[];
  /** Currently-selected Resort ids (controlled by the parent). */
  readonly selectedIds: readonly string[];
  /** Toggle a Resort's selection; the parent enforces the selection bound. */
  readonly onToggle: (resortId: string) => void;
  /** Disable all interaction while a submit is in flight. */
  readonly disabled?: boolean;
  /** Namespaces the emitted testIDs so multiple hosts stay distinct. */
  readonly testIDPrefix: string;
}

export function ResortPicker({
  resorts,
  selectedIds,
  onToggle,
  disabled = false,
  testIDPrefix,
}: ResortPickerProps): JSX.Element {
  const [query, setQuery] = useState('');
  const styles = useStyles();
  const t = useAppTheme();

  // The selected Resorts, resolved to their catalog rows for the chip summary.
  const selectedResorts = useMemo(
    () => resorts.filter((resort) => selectedIds.includes(resort.id)),
    [resorts, selectedIds],
  );

  // The list filtered and ranked by the search query using the shared normalization pipeline.
  const filtered = useMemo(() => {
    return filterAndRankExperiences(resorts, query);
  }, [resorts, query]);

  return (
    <View testID={`${testIDPrefix}-resorts`}>
      {selectedResorts.length > 0 ? (
        <View style={styles.chips}>
          {selectedResorts.map((resort) => (
            <Pressable
              key={resort.id}
              onPress={() => {
                if (!disabled) onToggle(resort.id);
              }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${resort.name}`}
              style={styles.chip}
              testID={`${testIDPrefix}-chip-${resort.id}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {resort.name}
              </Text>
              <Ionicons name="close" size={14} color={t.color.primaryFg} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <Ionicons
          name="search"
          size={16}
          color={t.color.textSecondary}
          style={styles.searchIcon}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search resorts"
          placeholderTextColor={t.color.textSecondary}
          keyboardAppearance={t.scheme}
          editable={!disabled}
          autoCorrect={false}
          style={styles.searchInput}
          accessibilityLabel="Search resorts"
          testID={`${testIDPrefix}-search`}
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            testID={`${testIDPrefix}-search-clear`}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={t.color.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.list}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        {filtered.length === 0 ? (
          <Text style={styles.empty} testID={`${testIDPrefix}-resorts-empty`}>
            No resorts match “{query.trim()}”.
          </Text>
        ) : (
          filtered.map((resort) => {
            const selected = selectedIds.includes(resort.id);
            return (
              <Pressable
                key={resort.id}
                onPress={() => {
                  if (!disabled) onToggle(resort.id);
                }}
                disabled={disabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={resort.name}
                style={[styles.row, selected ? styles.rowSelected : null]}
                testID={`${testIDPrefix}-resort-${resort.id}`}
              >
                <Ionicons
                  name={selected ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={selected ? t.color.primaryFg : t.color.textSecondary}
                />
                <Text style={styles.rowText} numberOfLines={1}>
                  {resort.name}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing.sm,
    marginBottom: t.spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    maxWidth: '100%',
    backgroundColor: `${t.color.primary}18`,
    borderRadius: t.radius.md,
    paddingLeft: t.spacing.sm,
    paddingRight: t.spacing.xs,
    paddingVertical: t.spacing.xs,
  },
  chipText: {
    ...t.typography.meta,
    color: t.color.textPrimary,
    flexShrink: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.xs,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    backgroundColor: t.color.surface,
  },
  searchIcon: {
    marginRight: t.spacing.xs,
  },
  searchInput: {
    flex: 1,
    paddingVertical: t.spacing.md,
    ...t.typography.body,
    color: t.color.textPrimary,
  },
  list: {
    maxHeight: 220,
    marginTop: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  rowSelected: {
    backgroundColor: `${t.color.primary}12`,
  },
  rowText: {
    ...t.typography.body,
    color: t.color.textPrimary,
    flexShrink: 1,
  },
  empty: {
    ...t.typography.meta,
    color: t.color.textSecondary,
    padding: t.spacing.md,
  },
}));
