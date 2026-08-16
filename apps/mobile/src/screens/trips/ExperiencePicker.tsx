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
import { theme, categoryVisual } from '../../theme/theme';
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

export type ExperiencePickerTab = 'all' | 'attractions' | 'dining' | 'shows' | 'breaks';

export interface ExperiencePickerProps {
  /**
   * Whether the picker is live. The Catalog query is only enabled while this is
   * `true`, so a hidden picker (a closed modal) issues no requests.
   */
  readonly enabled: boolean;
  /** Called with the tapped Experience when a selectable row is pressed. */
  readonly onSelect: (experience: ExperienceDTO) => void;
  /** Optional callback to create an unlocated break directly. */
  readonly onSelectUnlocatedBreak?: (customTitle: string, durationMinutes: number) => void;
  /** Whether to show category filter tabs. Defaults to true. */
  readonly showTabs?: boolean;
  /**
   * Experience ids to render as disabled (non-selectable) — e.g. an Experience
   * already on the Planned_List. Defaults to an empty set.
   */
  readonly disabledIds?: ReadonlySet<string>;
  /** Trailing label shown on a disabled row (defaults to "Added"). */
  readonly disabledLabel?: string;
  /** The id of a row with a follow-up request in flight, to show a spinner. */
  readonly pendingId?: string | null;
  /** Experience add counts in the current session for showing feedback badges (e.g. "✓ 1 added"). */
  readonly addedCounts?: ReadonlyMap<string, number>;
  /** Experience ids added in the current session to display added checkmark feedback. */
  readonly addedIds?: ReadonlySet<string>;
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
  onSelectUnlocatedBreak,
  showTabs = true,
  disabledIds,
  disabledLabel = 'Added',
  pendingId = null,
  addedCounts,
  addedIds,
  busy = false,
  testIDPrefix,
}: ExperiencePickerProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ExperiencePickerTab>('all');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [breakTitle, setBreakTitle] = useState('Midday Break');
  const [breakDuration, setBreakDuration] = useState(45);

  const disabledSet = disabledIds ?? EMPTY_SET;
  const addedSet = addedIds ?? EMPTY_SET;

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

  const rawResults = searchQuery.data?.experiences ?? [];

  const results = rawResults.filter((item) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'attractions') {
      return item.category === 'Ride';
    }
    if (activeTab === 'dining') {
      return item.category === 'Restaurant';
    }
    if (activeTab === 'shows') {
      return item.category === 'Show' || item.category === 'Parade' || item.category === 'Character_Meet' || item.category === 'Event';
    }
    if (activeTab === 'breaks') {
      return item.category === 'Resort' || item.category === 'Recreation' || item.category === 'Spa';
    }
    return true;
  });

  const clear = (): void => {
    if (busy) return;
    setSearchInput('');
    setDebouncedQuery('');
  };

  return (
    <View>
      {showTabs && (
        <View style={styles.tabBar} testID={`${testIDPrefix}-tabs`}>
          <Pressable
            style={[styles.tabBtn, activeTab === 'all' && styles.tabBtnActive]}
            onPress={() => setActiveTab('all')}
            testID={`${testIDPrefix}-tab-all`}
          >
            <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>All</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'attractions' && styles.tabBtnActive]}
            onPress={() => setActiveTab('attractions')}
            testID={`${testIDPrefix}-tab-attractions`}
          >
            <Text style={[styles.tabText, activeTab === 'attractions' && styles.tabTextActive]}>Rides</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'dining' && styles.tabBtnActive]}
            onPress={() => setActiveTab('dining')}
            testID={`${testIDPrefix}-tab-dining`}
          >
            <Text style={[styles.tabText, activeTab === 'dining' && styles.tabTextActive]}>Dining</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'shows' && styles.tabBtnActive]}
            onPress={() => setActiveTab('shows')}
            testID={`${testIDPrefix}-tab-shows`}
          >
            <Text style={[styles.tabText, activeTab === 'shows' && styles.tabTextActive]}>Shows</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'breaks' && styles.tabBtnActive]}
            onPress={() => setActiveTab('breaks')}
            testID={`${testIDPrefix}-tab-breaks`}
          >
            <Text style={[styles.tabText, activeTab === 'breaks' && styles.tabTextActive]}>☕ Breaks</Text>
          </Pressable>
        </View>
      )}

      {activeTab === 'breaks' && onSelectUnlocatedBreak && (
        <View style={styles.breakCard} testID={`${testIDPrefix}-break-creator`}>
          <Text style={styles.breakCardTitle}>Schedule a Break or Rest Period</Text>
          <TextInput
            style={styles.breakTitleInput}
            value={breakTitle}
            onChangeText={setBreakTitle}
            placeholder="Break description (e.g. Midday Hotel Nap, Pool Time)"
            placeholderTextColor={theme.color.textSecondary}
            testID={`${testIDPrefix}-break-title-input`}
          />
          <Text style={styles.subLabel}>Duration (Minutes)</Text>
          <View style={styles.durationPresetsRow}>
            {[30, 45, 60, 90, 120].map((dur) => (
              <Pressable
                key={dur}
                style={[styles.durChip, breakDuration === dur && styles.durChipActive]}
                onPress={() => setBreakDuration(dur)}
                testID={`${testIDPrefix}-break-dur-${dur}`}
              >
                <Text style={[styles.durChipText, breakDuration === dur && styles.durChipTextActive]}>
                  {dur}m
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={styles.addBreakBtn}
            onPress={() => {
              if (busy || !breakTitle.trim()) return;
              onSelectUnlocatedBreak(breakTitle.trim(), breakDuration);
            }}
            disabled={busy || !breakTitle.trim()}
            testID={`${testIDPrefix}-add-break-btn`}
          >
            <Ionicons name="add-circle" size={18} color="#FFFFFF" />
            <Text style={styles.addBreakBtnText}>Add Break ({breakDuration} min)</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.searchWrap}>
        <Ionicons
          name="search"
          size={18}
          color={theme.color.textSecondary}
        />
        <TextInput
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder={activeTab === 'dining' ? 'Search restaurants...' : activeTab === 'shows' ? 'Search shows...' : 'Search by name...'}
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
            Type at least {SEARCH_MIN_CHARS} characters to search {activeTab !== 'all' ? activeTab : 'experiences'}.
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
            No {activeTab !== 'all' ? activeTab : 'experiences'} matched &ldquo;{debouncedQuery}&rdquo;.
          </Text>
        ) : (
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            testID={`${testIDPrefix}-results`}
          >
            {results.map((item) => {
              const count = addedCounts?.get(item.id) ?? (addedSet.has(item.id) ? 1 : 0);
              return (
                <ExperienceResultRow
                  key={item.id}
                  experience={item}
                  disabled={disabledSet.has(item.id)}
                  disabledLabel={disabledLabel}
                  pending={pendingId === item.id && busy}
                  addedCount={count}
                  busy={busy}
                  onPress={() => onSelect(item)}
                  testID={`${testIDPrefix}-result-${item.id}`}
                />
              );
            })}
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
  addedCount = 0,
  busy,
  onPress,
  testID,
}: {
  readonly experience: ExperienceDTO;
  readonly disabled: boolean;
  readonly disabledLabel: string;
  readonly pending: boolean;
  readonly addedCount?: number;
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
          : addedCount > 0
          ? `Add ${experience.name} (${addedCount} currently added)`
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
        <View style={styles.resultBadges}>
          {(() => {
            const visual =
              experience.category && experience.category in categoryVisual
                ? categoryVisual[experience.category as keyof typeof categoryVisual]
                : { label: experience.category || 'Experience', tint: theme.color.textSecondary };
            return <Badge label={visual.label} color={visual.tint} />;
          })()}
          {experience.park !== null ? (
            <Badge label={experience.park} color={theme.color.primary} />
          ) : null}
          {addedCount > 0 ? (
            <Badge
              label={addedCount === 1 ? '✓ 1 added' : `✓ ${addedCount} added`}
              color={theme.color.success}
            />
          ) : null}
        </View>
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
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
    backgroundColor: theme.color.surfaceAlt,
    padding: theme.spacing.xs,
    borderRadius: theme.radius.md,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
  },
  tabBtnActive: {
    backgroundColor: theme.color.surface,
    ...theme.shadow.card,
  },
  tabText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  tabTextActive: {
    color: theme.color.primary,
    fontWeight: '700',
  },
  breakCard: {
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  breakCardTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    fontWeight: '600',
  },
  breakTitleInput: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    fontSize: 14,
    color: theme.color.textPrimary,
  },
  subLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: 2,
  },
  durationPresetsRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
  },
  durChip: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  durChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  durChipText: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
    fontWeight: '500',
  },
  durChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  addBreakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    backgroundColor: theme.color.primary,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    marginTop: 4,
  },
  addBreakBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
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
  resultBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
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
