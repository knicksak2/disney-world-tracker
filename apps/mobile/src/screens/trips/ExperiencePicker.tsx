// Feature: trips — shared Experience search-and-pick control.
//
// A User can never know an Experience's internal UUID, so every place that
// needs an Experience (the Planned_List composer, the Shared_Log composer)
// lets them search the Catalog by name and tap a real result. The tapped
// row's id is what the caller forwards to the API — the id is derived from
// the selection, never typed.
//
// The control queries `GET /catalog?q=` (the same active-only browse/search
// the Catalog tab uses), debounced, and only once at least a couple of
// characters are present so it does not fire on every keystroke. Callers
// supply an `onSelect` handler and may mark some rows disabled (e.g. an
// Experience already on a Planned_List) with a short trailing label, and
// surface a per-row spinner while a follow-up request is in flight.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import type { ExperienceDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import { Badge } from '../../theme/components';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wire shape of `GET /catalog` — only the fields the picker reads. */
interface CatalogSearchResponse {
  readonly experiences: readonly ExperienceDTO[];
}

/**
 * Minimum non-whitespace characters before a Catalog search fires. Keeps the
 * picker from querying on every single keystroke while still feeling
 * responsive.
 */
const SEARCH_MIN_CHARS = 2;

/** Debounce applied to the search box before dispatching `GET /catalog?q=`. */
const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ExperiencePickerProps {
  /**
   * Whether the picker is live. The Catalog query is only enabled while this is
   * `true`, so a hidden picker (a closed modal) issues no requests.
   */
  readonly enabled: boolean;
  /** Called with the tapped Experience when a selectable row is pressed. */
  readonly onSelect: (experience: ExperienceDTO) => void;
  /**
   * Experience ids to render as disabled (non-selectable) — e.g. an Experience
   * already on the Planned_List. Defaults to an empty set.
   */
  readonly disabledIds?: ReadonlySet<string>;
  /** Trailing label shown on a disabled row (defaults to "Added"). */
  readonly disabledLabel?: string;
  /** The id of a row with a follow-up request in flight, to show a spinner. */
  readonly pendingId?: string | null;
  /** When true, every row is non-interactive (a request is in flight). */
  readonly busy?: boolean;
  /** Prefix for the control's testIDs, e.g. `planned-list` or `shared-log`. */
  readonly testIDPrefix: string;
}

/**
 * The Catalog search box plus its tappable results list. Purely a picker: it
 * owns the query text and the `GET /catalog?q=` read, and hands the selected
 * `ExperienceDTO` back through `onSelect`. All decisions about what a selection
 * means (add immediately, stage a form field, etc.) live with the caller.
 */
export function ExperiencePicker({
  enabled,
  onSelect,
  disabledIds,
  disabledLabel = 'Added',
  pendingId = null,
  busy = false,
  testIDPrefix,
}: ExperiencePickerProps): JSX.Element {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const disabledSet = disabledIds ?? EMPTY_SET;

  // Debounce the raw input into the query that actually hits the API.
  useEffect(() => {
    const trimmed = searchInput.trim();
    const handle = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const searchActive = debouncedQuery.length >= SEARCH_MIN_CHARS;

  const searchQuery = useQuery<CatalogSearchResponse, ApiError>({
    queryKey: ['catalog', 'search', debouncedQuery] as const,
    queryFn: () =>
      apiRequest<CatalogSearchResponse>(
        'GET',
        `/catalog?q=${encodeURIComponent(debouncedQuery)}`,
      ),
    enabled: enabled && searchActive,
  });

  const results = searchQuery.data?.experiences ?? [];

  const clear = (): void => {
    if (busy) return;
    setSearchInput('');
    setDebouncedQuery('');
  };

  return (
    <View>
      <View style={styles.searchWrap}>
        <Ionicons
          name="search"
          size={18}
          color={theme.color.textSecondary}
        />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search by name"
          placeholderTextColor={theme.color.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          style={styles.searchInput}
          accessibilityLabel="Search experiences"
          testID={`${testIDPrefix}-search`}
        />
        {searchInput.length > 0 ? (
          <Ionicons
            name="close-circle"
            size={18}
            color={theme.color.textSecondary}
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            testID={`${testIDPrefix}-search-clear`}
          />
        ) : null}
      </View>

      <View style={styles.resultsArea}>
        {!searchActive ? (
          <Text style={styles.hint} testID={`${testIDPrefix}-search-hint`}>
            Type at least {SEARCH_MIN_CHARS} characters to find experiences.
          </Text>
        ) : searchQuery.isLoading ? (
          <View style={styles.center} testID={`${testIDPrefix}-search-loading`}>
            <ActivityIndicator color={theme.color.primary} />
          </View>
        ) : searchQuery.isError ? (
          <Text style={styles.hint} testID={`${testIDPrefix}-search-error`}>
            We couldn&apos;t search the catalog. Please try again.
          </Text>
        ) : results.length === 0 ? (
          <Text style={styles.hint} testID={`${testIDPrefix}-search-empty`}>
            No experiences matched &ldquo;{debouncedQuery}&rdquo;.
          </Text>
        ) : (
          // A bounded, self-contained scroll region rather than a FlatList:
          // the Shared_Log composer mounts this picker inside a ScrollView, and
          // a VirtualizedList nested in a same-orientation ScrollView triggers
          // React Native's "VirtualizedLists should never be nested…" warning.
          // The results are a debounced, bounded Catalog search rendered in a
          // small (maxHeight) area, so a plain nested ScrollView is the right
          // fit and works as the sole scroller in the Planned_List composer too.
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            testID={`${testIDPrefix}-results`}
          >
            {results.map((item) => (
              <ExperienceResultRow
                key={item.id}
                experience={item}
                disabled={disabledSet.has(item.id)}
                disabledLabel={disabledLabel}
                pending={pendingId === item.id && busy}
                busy={busy}
                onPress={() => onSelect(item)}
                testID={`${testIDPrefix}-result-${item.id}`}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/** Reused empty set so the default `disabledIds` is a stable reference. */
const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * A single tappable Catalog search result. Shows the Experience name and Park;
 * a disabled row (already selected/added elsewhere) is dimmed with a trailing
 * label and is non-interactive, and a pending row shows a spinner in place of
 * the add affordance.
 */
function ExperienceResultRow({
  experience,
  disabled,
  disabledLabel,
  pending,
  busy,
  onPress,
  testID,
}: {
  readonly experience: ExperienceDTO;
  readonly disabled: boolean;
  readonly disabledLabel: string;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly onPress: () => void;
  readonly testID: string;
}): JSX.Element {
  const inactive = disabled || busy;
  return (
    <Pressable
      onPress={() => {
        if (inactive) return;
        onPress();
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      accessibilityLabel={
        disabled
          ? `${experience.name}, ${disabledLabel}`
          : `Add ${experience.name}`
      }
      style={({ pressed }) => [
        styles.resultRow,
        pressed && !inactive ? styles.resultRowPressed : null,
        disabled ? styles.resultRowDisabled : null,
      ]}
      testID={testID}
    >
      <View style={styles.resultText}>
        <Text style={styles.resultName} numberOfLines={2}>
          {experience.name}
        </Text>
        {experience.park !== null ? (
          <Badge label={experience.park} color={theme.color.primary} />
        ) : null}
      </View>
      {pending ? (
        <ActivityIndicator color={theme.color.primary} />
      ) : disabled ? (
        <Text style={styles.disabledTag}>{disabledLabel}</Text>
      ) : (
        <Ionicons
          name="add-circle-outline"
          size={22}
          color={theme.color.primary}
        />
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    fontSize: 16,
    color: theme.color.textPrimary,
  },
  resultsArea: {
    marginTop: theme.spacing.md,
    minHeight: 120,
    maxHeight: 320,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.lg,
  },
  hint: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    paddingVertical: theme.spacing.md,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  resultRowPressed: {
    backgroundColor: theme.color.surfaceAlt,
  },
  resultRowDisabled: {
    opacity: 0.55,
  },
  resultText: {
    flexShrink: 1,
    flexGrow: 1,
    gap: theme.spacing.xs,
    alignItems: 'flex-start',
  },
  resultName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  disabledTag: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
});
