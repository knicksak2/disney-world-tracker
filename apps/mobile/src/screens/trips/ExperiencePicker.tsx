// Feature: trips — shared Experience search-and-pick control.
//
// A User can never know an Experience's internal UUID, so every place that
// needs an Experience (the Planned_List composer, the Shared_Log composer)
// lets them search the Catalog by name and tap a real result. The tapped
// row's id is what the caller forwards to the API — the id is derived from
// the selection, never typed.
//
// The control queries `GET /catalog` (the same active-only browse/search
// the Catalog tab uses), debounced, and only once at least a couple of
// characters are present on 'all' or when browsing by category/park.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import type { ExperienceDTO, Park } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme, categoryVisual } from '../../theme/theme';
import { Badge } from '../../theme/components';
import { DESTINATIONS, type DestinationId } from '../catalog/destinations';
import { groupByPavilionFiltered } from '../catalog/catalogGrouping';
import {
  TAB_CATEGORIES,
  deriveFilterChips,
  deriveQuickChips,
  filterExperiencesMulti,
  formatEmptyFilterMessage,
  formatSearchHintMessage,
  isKnownPark,
  resolveParkScope,
  type ExperiencePickerTab,
} from './experiencePickerFilters';

export { type ExperiencePickerTab } from './experiencePickerFilters';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Wire shape of `GET /catalog` — only the fields the picker reads. */
interface CatalogSearchResponse {
  readonly experiences: readonly ExperienceDTO[];
}

/**
 * Minimum non-whitespace characters before a Catalog free-text search fires.
 */
const SEARCH_MIN_CHARS = 2;

/** Debounce applied to the search box before dispatching `GET /catalog?q=`. */
const SEARCH_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Component Props
// ---------------------------------------------------------------------------

export interface ExperiencePickerProps {
  /**
   * Whether the picker is live. The Catalog query is only enabled while this is
   * `true`, so a hidden picker (a closed modal) issues no requests.
   */
  readonly enabled: boolean;
  /** Called with the tapped Experience when a selectable row is pressed. */
  readonly onSelect: (experience: ExperienceDTO) => void;
  /** Optional callback to create a break directly (with optional attached location). */
  readonly onSelectUnlocatedBreak?: (
    customTitle: string,
    durationMinutes: number,
    experienceId?: string | null,
  ) => void;
  /** Whether to show category filter tabs. Defaults to true. */
  readonly showTabs?: boolean;
  /**
   * The tab the picker opens on. Defaults to `all`. Combined with
   * `showTabs={false}` this scopes the picker to one category with no way to
   * widen it — used by the Reservations screen so a dining booking can only
   * choose a restaurant and a Lightning Lane booking only a ride
   * (trip-reservations R3.2, R3.3).
   */
  readonly defaultTab?: ExperiencePickerTab;
  /** Whether to show Destination/Park filter chips. Defaults to false. */
  readonly showParkFilter?: boolean;
  /** Pre-selected park filter chip. Defaults to null. */
  readonly defaultPark?: Park | null;
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
  /** Optional container style to customize or expand layout. */
  readonly style?: StyleProp<ViewStyle>;
  /** When true, the results area and picker expand to fill available vertical space (e.g. in full-screen modals). */
  readonly fillContainer?: boolean;
}

/**
 * The Catalog search box plus its tappable results list.
 */
export function ExperiencePicker({
  enabled,
  onSelect,
  onSelectUnlocatedBreak,
  showTabs = true,
  defaultTab = 'all',
  showParkFilter = false,
  defaultPark = null,
  disabledIds,
  disabledLabel = 'Added',
  pendingId = null,
  addedCounts,
  addedIds,
  busy = false,
  testIDPrefix,
  style,
  fillContainer = false,
}: ExperiencePickerProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<ExperiencePickerTab>(defaultTab);
  const [selectedPark, setSelectedPark] = useState<DestinationId | 'all'>(
    defaultPark && isKnownPark(defaultPark) ? defaultPark : 'all',
  );
  const [selectedLands, setSelectedLands] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);

  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [breakTitle, setBreakTitle] = useState('Midday Break');
  const [breakDuration, setBreakDuration] = useState(60);
  const [stagedLocation, setStagedLocation] = useState<ExperienceDTO | null>(null);
  const [breakAddedFeedback, setBreakAddedFeedback] = useState<boolean>(false);

  const disabledSet = disabledIds ?? EMPTY_SET;
  const addedSet = addedIds ?? EMPTY_SET;

  const clearAllFilters = () => {
    setSelectedLands(new Set());
    setSelectedTags(new Set());
  };

  const toggleLandFilter = (land: string) => {
    setSelectedLands((prev) => {
      const next = new Set(prev);
      if (next.has(land)) {
        next.delete(land);
      } else {
        next.add(land);
      }
      return next;
    });
  };

  const toggleTagFilter = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  // Sync defaultPark prop changes into selectedPark state
  useEffect(() => {
    if (defaultPark && isKnownPark(defaultPark)) {
      setSelectedPark(defaultPark);
      clearAllFilters();
    } else if (defaultPark === null) {
      setSelectedPark('all');
      clearAllFilters();
    }
  }, [defaultPark]);

  // Debounce the raw input into the query that actually hits the API.
  useEffect(() => {
    const trimmed = searchInput.trim();
    const handle = setTimeout(() => {
      setDebouncedQuery(trimmed);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const handleTabChange = (tab: ExperiencePickerTab) => {
    setActiveTab(tab);
    clearAllFilters();
  };

  const handleParkChange = (park: DestinationId | 'all') => {
    setSelectedPark(park);
    clearAllFilters();
  };

  // Breaks tab requires at least SEARCH_MIN_CHARS so as not to flood the location list (AC 4.14)
  const searchActive =
    activeTab === 'breaks'
      ? debouncedQuery.length >= SEARCH_MIN_CHARS
      : activeTab !== 'all' || selectedPark !== 'all' || debouncedQuery.length >= SEARCH_MIN_CHARS;

  const parkScope = resolveParkScope(selectedPark);
  const tabCategories = TAB_CATEGORIES[activeTab];

  // Query key intentionally segregates cached catalog results across tabs,
  // selected park destinations, and search queries so switching tabs or
  // tapping park chips does not serve stale rows from other views.
  const searchQuery = useQuery<CatalogSearchResponse, ApiError>({
    queryKey: ['catalog', 'search', activeTab, selectedPark, debouncedQuery] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (tabCategories.length > 0) {
        params.append('categories', tabCategories.join(','));
      }
      if (parkScope.parkId) {
        params.append('parkId', parkScope.parkId);
      }
      if (parkScope.areaType) {
        params.append('areaType', parkScope.areaType);
      }
      if (debouncedQuery.length > 0) {
        params.append('q', debouncedQuery);
      }
      const qs = params.toString();
      return apiRequest<CatalogSearchResponse>(
        'GET',
        `/catalog${qs ? `?${qs}` : ''}`,
      );
    },
    enabled: enabled && searchActive,
  });

  const rawResults = searchQuery.data?.experiences ?? [];

  // Tab category filter safety
  const tabFilteredResults = rawResults.filter((item) => {
    if (activeTab === 'all') return true;
    if (activeTab === 'attractions') return item.category === 'Ride';
    if (activeTab === 'dining') return item.category === 'Restaurant';
    if (activeTab === 'shows') {
      return (
        item.category === 'Show' ||
        item.category === 'Parade' ||
        item.category === 'Character_Meet' ||
        item.category === 'Event'
      );
    }
    if (activeTab === 'breaks') {
      return true;
    }
    return true;
  });

  // Dynamic filter chips derived directly from loaded results
  const { landChips, priceChips, attributeChips, allChips } = deriveFilterChips(tabFilteredResults);
  const quickChips = deriveQuickChips(attributeChips, activeTab, priceChips);

  // Multi-filter by selected land and attribute chips
  const filteredResults = filterExperiencesMulti(
    tabFilteredResults,
    selectedLands,
    selectedTags,
  );

  const activeFilterCount = selectedLands.size + selectedTags.size;

  // Group by Land with EPCOT pavilion expansion
  const groupedSections = groupByPavilionFiltered(filteredResults, null);

  const clear = (): void => {
    if (busy) return;
    setSearchInput('');
    setDebouncedQuery('');
  };

  return (
    <View
      style={[styles.container, fillContainer && styles.containerFill, style]}
      testID={`${testIDPrefix}-container`}
    >
      {showTabs && (
        <View style={styles.tabBar} testID={`${testIDPrefix}-tabs`}>
          <Pressable
            style={[styles.tabBtn, activeTab === 'all' && styles.tabBtnActive]}
            onPress={() => handleTabChange('all')}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === 'all' }}
            testID={`${testIDPrefix}-tab-all`}
          >
            <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>All</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'attractions' && styles.tabBtnActive]}
            onPress={() => handleTabChange('attractions')}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === 'attractions' }}
            testID={`${testIDPrefix}-tab-attractions`}
          >
            <Text style={[styles.tabText, activeTab === 'attractions' && styles.tabTextActive]}>Rides</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'dining' && styles.tabBtnActive]}
            onPress={() => handleTabChange('dining')}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === 'dining' }}
            testID={`${testIDPrefix}-tab-dining`}
          >
            <Text style={[styles.tabText, activeTab === 'dining' && styles.tabTextActive]}>Dining</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'shows' && styles.tabBtnActive]}
            onPress={() => handleTabChange('shows')}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === 'shows' }}
            testID={`${testIDPrefix}-tab-shows`}
          >
            <Text style={[styles.tabText, activeTab === 'shows' && styles.tabTextActive]}>Shows</Text>
          </Pressable>
          <Pressable
            style={[styles.tabBtn, activeTab === 'breaks' && styles.tabBtnActive]}
            onPress={() => handleTabChange('breaks')}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === 'breaks' }}
            testID={`${testIDPrefix}-tab-breaks`}
          >
            <Text style={[styles.tabText, activeTab === 'breaks' && styles.tabTextActive]}>☕ Breaks</Text>
          </Pressable>
        </View>
      )}

      {showParkFilter && (
        <View style={styles.filterBarWrap} testID={`${testIDPrefix}-park-filters`}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBarScroll}
          >
            <Pressable
              style={[
                styles.filterChip,
                selectedPark === 'all' && styles.filterChipActive,
              ]}
              onPress={() => handleParkChange('all')}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedPark === 'all' }}
              testID={`${testIDPrefix}-park-chip-all`}
            >
              <Text
                style={[
                  styles.filterChipText,
                  selectedPark === 'all' && styles.filterChipTextActive,
                ]}
              >
                All Parks
              </Text>
            </Pressable>
            {DESTINATIONS.map((dest) => {
              const isSelected = selectedPark === dest.id;
              return (
                <Pressable
                  key={dest.id}
                  style={[
                    styles.filterChip,
                    isSelected && styles.filterChipActive,
                  ]}
                  onPress={() => handleParkChange(dest.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  testID={`${testIDPrefix}-park-chip-${dest.id}`}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && styles.filterChipTextActive,
                    ]}
                  >
                    {dest.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {allChips.length > 0 && (
        <View style={styles.filterBarWrap} testID={`${testIDPrefix}-sub-filters`}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBarScroll}
          >
            {/* Filters Button */}
            <Pressable
              style={[
                styles.filterChip,
                styles.filterModalBtn,
                activeFilterCount > 0 && styles.filterModalBtnActive,
              ]}
              onPress={() => setIsFilterModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Open filters sheet${activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''}`}
              testID={`${testIDPrefix}-open-filters-modal`}
            >
              <Ionicons
                name="options-outline"
                size={14}
                color={activeFilterCount > 0 ? '#FFFFFF' : theme.color.textSecondary}
              />
              <Text
                style={[
                  styles.filterChipText,
                  styles.filterModalBtnText,
                  activeFilterCount > 0 && styles.filterChipTextActive,
                ]}
              >
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </Text>
            </Pressable>

            {/* Quick Chips */}
            {quickChips.map((chip) => {
              const isSelected = selectedTags.has(chip.rawValue);
              return (
                <Pressable
                  key={chip.id}
                  style={[
                    styles.filterChip,
                    isSelected && styles.filterChipActive,
                  ]}
                  onPress={() => toggleTagFilter(chip.rawValue)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`${chip.rawValue}, quick attribute filter${isSelected ? ', selected' : ''}`}
                  testID={`${testIDPrefix}-subfilter-${chip.id}`}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && styles.filterChipTextActive,
                    ]}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}

            {/* Reset Button (only shown when any filter is active) */}
            {activeFilterCount > 0 && (
              <Pressable
                style={[styles.filterChip, styles.resetChip]}
                onPress={clearAllFilters}
                accessibilityRole="button"
                accessibilityLabel="Reset all active filters"
                testID={`${testIDPrefix}-subfilter-reset`}
              >
                <Text style={[styles.filterChipText, styles.resetChipText]}>
                  ✕ Reset
                </Text>
              </Pressable>
            )}
          </ScrollView>
        </View>
      )}

      {/* Filters Bottom Sheet Modal */}
      <Modal
        visible={isFilterModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsFilterModalOpen(false)}
        testID={`${testIDPrefix}-filters-modal`}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalBackdropDismiss}
            onPress={() => setIsFilterModalOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close filters modal"
          />
          <View style={styles.modalContent} testID={`${testIDPrefix}-filters-modal-content`}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <View style={styles.modalHeaderActions}>
                {activeFilterCount > 0 && (
                  <Pressable
                    onPress={clearAllFilters}
                    style={styles.modalClearBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all filters"
                    testID={`${testIDPrefix}-modal-clear-all`}
                  >
                    <Text style={styles.modalClearText}>Clear All</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setIsFilterModalOpen(false)}
                  style={styles.modalCloseBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Close filters sheet"
                  testID={`${testIDPrefix}-modal-close`}
                >
                  <Ionicons name="close" size={22} color={theme.color.textPrimary} />
                </Pressable>
              </View>
            </View>

            {/* Modal Scrollable Sections */}
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Lands Section */}
              {landChips.length > 0 && (
                <View style={styles.modalSection} testID={`${testIDPrefix}-modal-lands-section`}>
                  <Text style={styles.modalSectionTitle}>
                    LANDS {selectedLands.size > 0 ? `(${selectedLands.size})` : ''}
                  </Text>
                  <View style={styles.chipGrid}>
                    {landChips.map((chip) => {
                      const isSelected = selectedLands.has(chip.rawValue);
                      return (
                        <Pressable
                          key={`modal-${chip.id}`}
                          style={[
                            styles.modalChip,
                            isSelected && styles.modalChipActive,
                          ]}
                          onPress={() => toggleLandFilter(chip.rawValue)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isSelected }}
                          accessibilityLabel={`${chip.rawValue}, land filter${isSelected ? ', selected' : ''}`}
                          testID={`${testIDPrefix}-modal-filter-${chip.id}`}
                        >
                          <Text
                            style={[
                              styles.modalChipText,
                              isSelected && styles.modalChipTextActive,
                            ]}
                          >
                            {chip.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Price Range Section */}
              {priceChips.length > 0 && (
                <View style={styles.modalSection} testID={`${testIDPrefix}-modal-price-section`}>
                  <Text style={styles.modalSectionTitle}>
                    PRICE RANGE {selectedTags.size > 0 ? `(${Array.from(selectedTags).filter((t) => priceChips.some((p) => p.rawValue === t)).length})` : ''}
                  </Text>
                  <View style={styles.chipGrid}>
                    {priceChips.map((chip) => {
                      const isSelected = selectedTags.has(chip.rawValue);
                      return (
                        <Pressable
                          key={`modal-${chip.id}`}
                          style={[
                            styles.modalChip,
                            isSelected && styles.modalChipActive,
                          ]}
                          onPress={() => toggleTagFilter(chip.rawValue)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isSelected }}
                          accessibilityLabel={`${chip.rawValue}, price filter${isSelected ? ', selected' : ''}`}
                          testID={`${testIDPrefix}-modal-filter-${chip.id}`}
                        >
                          <Text
                            style={[
                              styles.modalChipText,
                              isSelected && styles.modalChipTextActive,
                            ]}
                          >
                            {chip.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Attributes Section */}
              {attributeChips.length > 0 && (
                <View style={styles.modalSection} testID={`${testIDPrefix}-modal-attributes-section`}>
                  <Text style={styles.modalSectionTitle}>
                    ATTRIBUTES & DINING {selectedTags.size > 0 ? `(${Array.from(selectedTags).filter((t) => attributeChips.some((a) => a.rawValue === t)).length})` : ''}
                  </Text>
                  <View style={styles.chipGrid}>
                    {attributeChips.map((chip) => {
                      const isSelected = selectedTags.has(chip.rawValue);
                      return (
                        <Pressable
                          key={`modal-${chip.id}`}
                          style={[
                            styles.modalChip,
                            isSelected && styles.modalChipActive,
                          ]}
                          onPress={() => toggleTagFilter(chip.rawValue)}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: isSelected }}
                          accessibilityLabel={`${chip.rawValue}, attribute filter${isSelected ? ', selected' : ''}`}
                          testID={`${testIDPrefix}-modal-filter-${chip.id}`}
                        >
                          <Text
                            style={[
                              styles.modalChipText,
                              isSelected && styles.modalChipTextActive,
                            ]}
                          >
                            {chip.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Modal Footer */}
            <View style={styles.modalFooter}>
              <Pressable
                style={styles.modalApplyBtn}
                onPress={() => setIsFilterModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={`Apply filters, ${filteredResults.length} experiences found`}
                testID={`${testIDPrefix}-modal-apply-btn`}
              >
                <Text style={styles.modalApplyBtnText}>
                  {filteredResults.length > 0
                    ? `Show ${filteredResults.length} Result${filteredResults.length === 1 ? '' : 's'}`
                    : 'Show 0 Results'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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

          {stagedLocation && (
            <View style={styles.stagedLocationBox} testID={`${testIDPrefix}-staged-location`}>
              <Text style={styles.stagedLocationText} numberOfLines={1}>
                📍 {stagedLocation.name}
              </Text>
              <Pressable
                style={styles.clearStagedBtn}
                onPress={() => setStagedLocation(null)}
                accessibilityRole="button"
                accessibilityLabel="Clear attached location"
                testID={`${testIDPrefix}-clear-staged-location`}
              >
                <Ionicons name="close-circle" size={18} color={theme.color.textSecondary} />
              </Pressable>
            </View>
          )}

          <Text style={styles.subLabel}>Duration (Minutes)</Text>
          <View style={styles.durationPresetsRow}>
            {[30, 45, 60, 90, 120].map((dur) => (
              <Pressable
                key={dur}
                style={[styles.durChip, breakDuration === dur && styles.durChipActive]}
                onPress={() => setBreakDuration(dur)}
                accessibilityRole="button"
                accessibilityState={{ selected: breakDuration === dur }}
                testID={`${testIDPrefix}-break-dur-${dur}`}
              >
                <Text style={[styles.durChipText, breakDuration === dur && styles.durChipTextActive]}>
                  {dur}m
                </Text>
              </Pressable>
            ))}
          </View>

          {breakAddedFeedback && (
            <View style={styles.breakFeedbackBox} testID={`${testIDPrefix}-break-feedback`}>
              <Text style={styles.breakFeedbackText}>✓ Break Added!</Text>
            </View>
          )}

          <Pressable
            style={[styles.addBreakBtn, breakAddedFeedback && styles.addBreakBtnSuccess]}
            onPress={() => {
              if (busy || !breakTitle.trim()) return;
              onSelectUnlocatedBreak(breakTitle.trim(), breakDuration, stagedLocation?.id ?? null);
              setBreakAddedFeedback(true);
              setStagedLocation(null);
              setTimeout(() => {
                setBreakAddedFeedback(false);
              }, 2000);
            }}
            disabled={busy || !breakTitle.trim()}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy || !breakTitle.trim() }}
            testID={`${testIDPrefix}-add-break-btn`}
          >
            <Ionicons name={breakAddedFeedback ? "checkmark-circle" : "add-circle"} size={18} color="#FFFFFF" />
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
          placeholder={
            activeTab === 'dining'
              ? 'Search restaurants...'
              : activeTab === 'shows'
              ? 'Search shows...'
              : activeTab === 'breaks'
              ? 'Search break locations...'
              : 'Search by name...'
          }
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

      <View style={[styles.resultsArea, fillContainer && styles.resultsAreaFill]}>
        {!searchActive ? (
          <Text style={styles.hint} testID={`${testIDPrefix}-search-hint`}>
            {activeTab === 'breaks'
              ? `Type at least ${SEARCH_MIN_CHARS} characters to search break locations.`
              : formatSearchHintMessage()}
          </Text>
        ) : searchQuery.isLoading ? (
          <View style={styles.center} testID={`${testIDPrefix}-search-loading`}>
            <ActivityIndicator color={theme.color.primary} />
          </View>
        ) : searchQuery.isError ? (
          <Text style={styles.hint} testID={`${testIDPrefix}-search-error`}>
            We couldn&apos;t search the catalog. Please try again.
          </Text>
        ) : filteredResults.length === 0 ? (
          <Text style={styles.hint} testID={`${testIDPrefix}-search-empty`}>
            {formatEmptyFilterMessage(
              selectedPark,
              activeTab,
              debouncedQuery,
              selectedLands.size > 0 || selectedTags.size > 0,
            )}
          </Text>
        ) : (
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={fillContainer ? styles.scrollFill : undefined}
            contentContainerStyle={fillContainer ? styles.scrollContentFill : undefined}
            testID={`${testIDPrefix}-results`}
          >
            {groupedSections.map((section) => (
              <View key={section.key} style={styles.landSection} testID={`${testIDPrefix}-section-${section.key}`}>
                <View style={styles.landHeader}>
                  <Text style={styles.landTitle}>{section.title}</Text>
                  <Text style={styles.landCount}>({section.items.length})</Text>
                </View>
                {section.items.map((item) => {
                  const count =
                    addedCounts?.get(item.id) ?? (addedSet.has(item.id) ? 1 : 0);
                  const isStagedOnBreaks =
                    activeTab === 'breaks' && stagedLocation?.id === item.id;
                  return (
                    <ExperienceResultRow
                      key={item.id}
                      experience={item}
                      disabled={disabledSet.has(item.id)}
                      disabledLabel={disabledLabel}
                      pending={pendingId === item.id && busy}
                      addedCount={count}
                      isStaged={isStagedOnBreaks}
                      busy={busy}
                      onPress={() => {
                        if (activeTab === 'breaks') {
                          setStagedLocation(item);
                        } else {
                          onSelect(item);
                        }
                      }}
                      testID={`${testIDPrefix}-result-${item.id}`}
                    />
                  );
                })}
              </View>
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
 * A single tappable Catalog search result.
 */
function ExperienceResultRow({
  experience,
  disabled,
  disabledLabel,
  pending,
  addedCount = 0,
  isStaged = false,
  busy,
  onPress,
  testID,
}: {
  readonly experience: ExperienceDTO;
  readonly disabled: boolean;
  readonly disabledLabel: string;
  readonly pending: boolean;
  readonly addedCount?: number;
  readonly isStaged?: boolean;
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
        isStaged ? styles.resultRowStaged : null,
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
          {isStaged ? (
            <Badge label="📍 Attached Location" color={theme.color.primary} />
          ) : null}
        </View>
      </View>
      {pending ? (
        <ActivityIndicator color={theme.color.primary} />
      ) : disabled ? (
        <Text style={styles.disabledTag}>{disabledLabel}</Text>
      ) : isStaged ? (
        <Ionicons name="checkmark-circle" size={22} color={theme.color.primary} />
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
  container: {},
  containerFill: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
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
  filterBarWrap: {
    marginBottom: theme.spacing.sm,
  },
  filterBarScroll: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    paddingVertical: 2,
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  filterChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  filterChipText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  filterModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.color.surface,
    borderColor: theme.color.borderStrong,
    borderWidth: 1.5,
  },
  filterModalBtnActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  filterModalBtnText: {
    fontWeight: '600',
  },
  chipDivider: {
    width: 1,
    height: 18,
    backgroundColor: theme.color.border,
    alignSelf: 'center',
    marginHorizontal: theme.spacing.xs,
  },
  resetChip: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
  },
  resetChipText: {
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 18, 53, 0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdropDismiss: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: theme.spacing.xl,
    ...theme.shadow.card,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  modalTitle: {
    ...theme.typography.title,
    fontSize: 18,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  modalClearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  modalClearText: {
    ...theme.typography.meta,
    color: theme.color.primary,
    fontWeight: '600',
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalScroll: {
    maxHeight: 400,
  },
  modalScrollContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.lg,
  },
  modalSection: {
    gap: theme.spacing.sm,
  },
  modalSectionTitle: {
    ...theme.typography.meta,
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.textSecondary,
    letterSpacing: 0.5,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  modalChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: theme.color.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  modalChipActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  modalChipText: {
    ...theme.typography.meta,
    color: theme.color.textPrimary,
    fontWeight: '500',
  },
  modalChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  modalFooter: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.color.border,
  },
  modalApplyBtn: {
    backgroundColor: theme.color.primary,
    paddingVertical: 14,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadow.card,
  },
  modalApplyBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
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
  resultsAreaFill: {
    flex: 1,
    maxHeight: undefined,
  },
  scrollFill: {
    flex: 1,
  },
  scrollContentFill: {
    flexGrow: 1,
    paddingBottom: theme.spacing.lg,
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
  landSection: {
    marginBottom: theme.spacing.md,
  },
  landHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.sm,
    marginBottom: 4,
  },
  landTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
  landCount: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontWeight: '500',
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
  stagedLocationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.color.surface,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.color.primary,
  },
  stagedLocationText: {
    ...theme.typography.meta,
    color: theme.color.primary,
    fontWeight: '600',
    flex: 1,
  },
  clearStagedBtn: {
    padding: 2,
    marginLeft: theme.spacing.xs,
  },
  breakFeedbackBox: {
    backgroundColor: '#dcfce7',
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
  },
  breakFeedbackText: {
    ...theme.typography.meta,
    color: '#15803d',
    fontWeight: '700',
  },
  addBreakBtnSuccess: {
    backgroundColor: theme.color.success,
  },
  resultRowStaged: {
    backgroundColor: '#eff6ff',
    borderColor: theme.color.primary,
  },
});
