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
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { ResortDTO } from '@dwt/shared';

import { theme } from '../theme/theme';

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

/** Case-insensitive substring match on the Resort name. */
function matches(resort: ResortDTO, query: string): boolean {
  return resort.name.toLowerCase().includes(query);
}

export function ResortPicker({
  resorts,
  selectedIds,
  onToggle,
  disabled = false,
  testIDPrefix,
}: ResortPickerProps): JSX.Element {
  const [query, setQuery] = useState('');

  // The selected Resorts, resolved to their catalog rows for the chip summary.
  const selectedResorts = useMemo(
    () => resorts.filter((resort) => selectedIds.includes(resort.id)),
    [resorts, selectedIds],
  );

  // The list filtered by the trimmed, lower-cased query. An empty query shows
  // every Resort so the picker still works without typing.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length === 0 ? resorts : resorts.filter((r) => matches(r, q));
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
              <Ionicons name="close" size={14} color={theme.color.primary} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <Ionicons
          name="search"
          size={16}
          color={theme.color.textSecondary}
          style={styles.searchIcon}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search resorts"
          placeholderTextColor={theme.color.textSecondary}
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
              color={theme.color.textSecondary}
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
                  color={selected ? theme.color.primary : theme.color.textSecondary}
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

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    maxWidth: '100%',
    backgroundColor: `${theme.color.primary}18`,
    borderRadius: theme.radius.md,
    paddingLeft: theme.spacing.sm,
    paddingRight: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
  },
  chipText: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.color.surface,
  },
  searchIcon: {
    marginRight: theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    ...theme.typography.body,
    color: theme.color.textPrimary,
  },
  list: {
    maxHeight: 220,
    marginTop: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  rowSelected: {
    backgroundColor: `${theme.color.primary}12`,
  },
  rowText: {
    ...theme.typography.body,
    color: theme.color.textPrimary,
    flexShrink: 1,
  },
  empty: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    padding: theme.spacing.md,
  },
});
