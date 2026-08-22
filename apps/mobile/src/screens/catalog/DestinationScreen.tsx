/**
 * DestinationScreen — the Level-2 per-Destination screen of the redesigned
 * two-level catalog navigation.
 *
 * This is the base screen (task 10.1). It is parameterized by a `DestinationId`
 * route param, resolves the corresponding `Destination` from the canonical
 * `DESTINATIONS` model, fetches that Destination's active Experiences via
 * `GET /catalog` using `destinationCatalogFilter`, and renders them, reusing the
 * catalog's established resilience conventions from `CatalogScreen`:
 *
 *   - **Data fetch (R6.1, R7.1, R8.1).** `GET /catalog` is dispatched with the
 *     Destination's filter — a `parkId` for the seven park Destinations,
 *     `areaType=Resort` for the aggregate Resorts Destination — through
 *     react-query with the existing staleness interval (R10.6).
 *
 *   - **Stale-cache banner (R10.1).** When the `/catalog` response carries
 *     `staleCache: true`, a small warning banner is rendered above the list.
 *
 *   - **`catalog_unavailable` error state (R10.2, R10.3).** When the API returns
 *     an `ApiError` with code `catalog_unavailable` AND no prior cache exists,
 *     the screen shows a full-screen error with no automatic retry; when prior
 *     cached data is available react-query serves it and the stale banner shows.
 *
 *   - **Empty state (R8.5).** When the Destination has no active Experiences the
 *     list body is replaced with an empty state.
 *
 *   - **Tap-to-detail (R6.10, R10.7).** Tapping an Experience row navigates to
 *     `ExperienceDetail` on the root stack with the row's stable internal id.
 *
 *   - **Restaurant price tag (R9.9).** A Restaurant row with a persisted price
 *     tier shows the compact price-tier Info_Tag built by `priceTierListTag`,
 *     identical to the detail view's presentation.
 *
 * The three Destination layouts (theme/water-park Land groups, Disney Springs
 * category groups, Resorts resort groups) are dispatched by `renderBody`, which
 * switches on `destination.kind` and renders the matching grouped/collapsible
 * layout (`ThemeOrWaterParkLayout`, `DisneySpringsLayout`, `ResortsLayout`)
 * built on `useDestinationSections` and the `catalogGrouping` cores. They share
 * the data-fetch, stale/unavailable/empty, and row-rendering plumbing
 * established here.
 *
 * Validates: Requirements 6.1, 6.10, 7.1, 8.1, 8.5, 9.9, 10.1, 10.2, 10.3, 10.7
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ExperienceCategory, ExperienceDTO, ResortDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { CatalogStackParamList } from '../../navigation/CatalogStack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';
import { GroupSection } from '../navigation/GroupSection';
import {
  type GroupSectionState,
  isExpanded as isExpandedPure,
  toggle as togglePure,
} from '../navigation/groupSectionState';
import {
  DESTINATIONS,
  destinationCatalogFilter,
  type Destination,
} from './destinations';
import {
  groupByCategory,
  groupByPavilionFiltered,
  groupByResort,
  RESORT_CATCHALL_ID,
  type Section,
} from './catalogGrouping';
import {
  deriveFilterChips,
  deriveQuickChips,
  filterExperiencesMulti,
  type ExperiencePickerTab,
} from '../trips/experiencePickerFilters';
import { useDestinationSections } from './useDestinationSections';
import { useCompletedExperiences } from './useCompletedExperiences';
import { priceTierListTag, resortAreaLabel } from './infoTags';
import {
  useAccessibilityFocusOnMount,
  useResultCountAnnouncement,
} from './catalogFocus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * `DestinationScreen` lives in the Catalog tab's stack, nested inside `MainTabs`
 * on the root-level `RootStack`. Composing the Catalog stack props with the root
 * stack props lets a row dispatch
 * `navigation.navigate('ExperienceDetail', { experienceId })` against
 * `RootStack`, pushing the detail screen above the tabs — exactly as
 * `CatalogScreen` does.
 */
type Props = CompositeScreenProps<
  NativeStackScreenProps<CatalogStackParamList, 'DestinationScreen'>,
  NativeStackScreenProps<RootStackParamList>
>;

/**
 * Wire shape for `GET /catalog`. Mirrors the response in
 * `apps/api/src/services/catalog/routes.ts`; we type only what the screen reads
 * so a future field addition does not require a coordinated change.
 */
interface CatalogListResponse {
  readonly experiences: readonly ExperienceDTO[];
  readonly staleCache: boolean;
  readonly cacheAgeHours?: number | null;
}

/**
 * Wire shape for `GET /resorts`. Mirrors the `ResortListResponse` consumed by
 * `CatalogScreen`/`ExperienceDetailScreen`; the Resorts layout needs the full
 * active Resort list to render every Resort as a browsable anchor (R8.3).
 */
interface ResortListResponse {
  readonly resorts: readonly ResortDTO[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 5 minutes — matches the catalog's react-query staleness interval (R10.6). */
const STALE_TIME_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function DestinationScreen({
  route,
  navigation,
}: Props): JSX.Element {
  const destination = useMemo<Destination | undefined>(
    () => DESTINATIONS.find((d) => d.id === route.params.destination),
    [route.params.destination],
  );

  // An unknown Destination id should never occur via the typed param list, but
  // render a graceful error rather than throwing if one somehow arrives.
  if (destination === undefined) {
    return (
      <ScreenContainer>
        <GradientHeader
          title="Catalog"
          icon="map"
          onBack={() => navigation.goBack()}
          backAccessibilityLabel="Back to catalog"
        />
        <View style={styles.center} testID="destination-unknown">
          <EmptyState
            icon="alert-circle-outline"
            title="Destination not found"
            body="This destination is no longer available."
          />
        </View>
      </ScreenContainer>
    );
  }

  return <DestinationBody destination={destination} navigation={navigation} />;
}

/**
 * The resolved-Destination body. Split out so the `GET /catalog` query only runs
 * once a valid Destination is in hand and the hooks below are never called
 * conditionally.
 */
function DestinationBody({
  destination,
  navigation,
}: {
  readonly destination: Destination;
  readonly navigation: Props['navigation'];
}): JSX.Element {
  const filter = useMemo(
    () => destinationCatalogFilter(destination),
    [destination],
  );

  // R12.6: on entering the Destination_Screen, move screen-reader / keyboard
  // focus to the screen's primary heading (the GradientHeader below).
  const headingRef = useAccessibilityFocusOnMount<View>();

  // In-destination search. Unlike the Catalog_Home's global search (which spans
  // the whole catalog through `GET /catalog?q=...`), this narrows the
  // Destination's already-loaded Experiences client-side by name, so the search
  // affordance stays available after drilling into a Destination without a
  // refetch. A query with ≥1 non-whitespace character replaces the grouped
  // layout with a flat result list; clearing it restores the grouped layout.
  const [searchInput, setSearchInput] = useState('');
  const trimmedQuery = searchInput.trim();
  const searchActive = trimmedQuery.length > 0;

  const catalogQuery = useQuery<CatalogListResponse, ApiError>({
    queryKey: ['catalog', 'destination', destination.id, filter] as const,
    queryFn: () => fetchCatalog(filter),
    staleTime: STALE_TIME_MS,
    // R10.2: retrying immediately would hammer an upstream we already know is
    // unreachable, so react-query's default retry is disabled.
    retry: false,
  });

  const experiences = catalogQuery.data?.experiences ?? [];

  // The signed-in User's completed-Experience id set, used to badge visited
  // rows. Fails soft to an empty set, so the list renders unmarked on error.
  const completedIds = useCompletedExperiences();

  // R10.2 full-screen error: only when there is no prior cache to fall back on.
  // With prior cache react-query keeps serving `data`, so we fall through to
  // the list with the stale banner (R10.3).
  if (catalogQuery.isError && catalogQuery.data === undefined) {
    if (
      catalogQuery.error instanceof ApiError &&
      catalogQuery.error.code === 'catalog_unavailable'
    ) {
      return <DestinationUnavailableState title={destination.title} />;
    }
    return (
      <GenericErrorState
        title={destination.title}
        message={
          catalogQuery.error?.message ?? 'Experiences couldn\u2019t be loaded.'
        }
      />
    );
  }

  const showStaleBanner = catalogQuery.data?.staleCache === true;
  const showLoading = catalogQuery.isLoading && catalogQuery.data === undefined;
  const showEmpty = !showLoading && experiences.length === 0;
  // The search control is offered whenever there are Experiences to narrow.
  const showSearch = !showLoading && !showEmpty;

  const onSelectExperience = (experience: ExperienceDTO): void => {
    navigation.navigate('ExperienceDetail', { experienceId: experience.id });
  };

  return (
    <ScreenContainer>
      <View ref={headingRef} collapsable={false} accessibilityRole="header">
        <GradientHeader
          title={destination.title}
          subtitle="Browse this destination."
          icon="map"
          onBack={() => navigation.goBack()}
          backAccessibilityLabel="Back to catalog"
        />
      </View>

      {showStaleBanner ? (
        <View style={styles.staleBanner} testID="destination-stale-banner">
          <Ionicons
            name="cloud-offline-outline"
            size={16}
            color={theme.color.warningText}
            style={styles.staleBannerIcon}
          />
          <Text style={styles.staleBannerText}>Showing cached catalog</Text>
        </View>
      ) : null}

      {showSearch ? (
        <DestinationSearchControl
          value={searchInput}
          onChangeText={setSearchInput}
          onClear={() => setSearchInput('')}
        />
      ) : null}

      {showLoading ? (
        <View style={styles.center} testID="destination-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : showEmpty ? (
        <View style={styles.center} testID="destination-empty">
          <EmptyState
            icon="search-outline"
            title="No experiences yet"
            body="This destination has no experiences right now."
          />
        </View>
      ) : searchActive ? (
        <DestinationSearchResults
          experiences={experiences}
          query={trimmedQuery}
          onSelectExperience={onSelectExperience}
          completedIds={completedIds}
        />
      ) : (
        renderBody(destination, experiences, onSelectExperience, completedIds)
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// In-destination search
// ---------------------------------------------------------------------------

/**
 * The always-visible in-destination search control. Mirrors the Catalog_Home
 * search box (icon, input, clear affordance) so the search affordance reads
 * identically at both levels, and carries an accessible label identifying it as
 * the search input.
 */
function DestinationSearchControl({
  value,
  onChangeText,
  onClear,
}: {
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly onClear: () => void;
}): JSX.Element {
  return (
    <View style={styles.controls}>
      <View style={styles.searchWrap}>
        <Ionicons
          name="search"
          size={18}
          color={theme.color.textSecondary}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          value={value}
          onChangeText={onChangeText}
          placeholder="Search this destination"
          placeholderTextColor={theme.color.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search this destination"
          testID="destination-search"
        />
        {value.length > 0 ? (
          <Ionicons
            name="close-circle"
            size={18}
            color={theme.color.textSecondary}
            style={styles.searchClear}
            onPress={onClear}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            testID="destination-search-clear"
          />
        ) : null}
      </View>
    </View>
  );
}

/**
 * The in-destination search results body, shown in place of the grouped layout
 * while a query is active. Narrows the Destination's already-loaded Experiences
 * to those whose name contains the query (case-insensitive), preserving source
 * order, and renders them as a flat, tappable list of `ExperienceRow` — the same
 * row used by the grouped layouts. When nothing matches, an empty-results state
 * is shown while the typed query is retained in the control above.
 *
 * The matching count is announced to assistive technologies via
 * `useResultCountAnnouncement`, satisfying the Destination_Screen's requirement
 * to announce the updated result count when a search action changes the visible
 * set (R11.8).
 */
function DestinationSearchResults({
  experiences,
  query,
  onSelectExperience,
  completedIds,
}: {
  readonly experiences: readonly ExperienceDTO[];
  readonly query: string;
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
}): JSX.Element {
  const results = useMemo(() => {
    const needle = query.toLowerCase();
    return experiences.filter((experience) =>
      experience.name.toLowerCase().includes(needle),
    );
  }, [experiences, query]);

  useResultCountAnnouncement(results.length);

  if (results.length === 0) {
    return (
      <View style={styles.center} testID="destination-search-empty">
        <EmptyState
          icon="search-outline"
          title="No experiences matched"
          body="Try a different search."
        />
      </View>
    );
  }

  return (
    <FlatList
      data={results as ExperienceDTO[]}
      keyExtractor={(experience) => experience.id}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={11}
      removeClippedSubviews
      testID="destination-search-results"
      renderItem={({ item }) => (
        <ExperienceRow
          experience={item}
          onPress={() => onSelectExperience(item)}
          completed={completedIds.has(item.id)}
        />
      )}
    />
  );
}

/**
 * Render the Destination's body by its `kind`.
 *
 * Each branch renders its grouped, collapsible layout, all built on
 * `useDestinationSections` for collapsible state and the `catalogGrouping`
 * cores, and sharing the data-fetch / stale / unavailable / empty /
 * row-rendering plumbing established here:
 *
 *   - `themeOrWaterPark` → `ThemeOrWaterParkLayout`: Land collapsible sections
 *     + a scoped Experience_Category `Chip` filter driving `groupByLandFiltered`.
 *   - `disneySprings`    → `DisneySpringsLayout`: `groupByCategory` collapsible
 *     sections.
 *   - `resorts`          → `ResortsLayout`: also fetches `GET /resorts` and
 *     renders `buildResortRows` with scroll-to-group anchors.
 */
function renderBody(
  destination: Destination,
  experiences: readonly ExperienceDTO[],
  onSelectExperience: (experience: ExperienceDTO) => void,
  completedIds: ReadonlySet<string>,
): JSX.Element {
  switch (destination.kind) {
    case 'themeOrWaterPark':
      // Task 10.2: Land groups (collapsible, default expanded) + a scoped
      // Experience_Category filter driving `groupByLandFiltered` client-side.
      return (
        <ThemeOrWaterParkLayout
          experiences={experiences}
          onSelectExperience={onSelectExperience}
          completedIds={completedIds}
        />
      );
    case 'disneySprings':
      // Task 10.3: Experience_Category groups (collapsible, default expanded)
      // in canonical order via `groupByCategory`, empties omitted, no filter.
      return (
        <DisneySpringsLayout
          experiences={experiences}
          onSelectExperience={onSelectExperience}
          completedIds={completedIds}
        />
      );
    case 'resorts':
    default:
      // Task 10.4: Resort anchor groups built by `buildResortRows` (fetches
      // `GET /resorts` itself), with scroll-to-group on anchor tap.
      return (
        <ResortsLayout
          experiences={experiences}
          onSelectExperience={onSelectExperience}
          completedIds={completedIds}
        />
      );
  }
}

// ---------------------------------------------------------------------------
// Theme / Water-park layout (task 10.2)
// ---------------------------------------------------------------------------

/**
 * The `ThemePark` / `WaterPark` Destination layout (R6.2–R6.9).
 *
 * The Destination's already-fetched Experiences are grouped by Land through the
 * pure `groupByLandFiltered` core: named Land sections ordered case-insensitively
 * ascending, each section's Experiences ordered case-insensitively ascending by
 * name (R6.2, R6.3), and the single Land_Catchall section appended after every
 * named section so no Experience is omitted (R6.6). Each section renders as a
 * collapsible `GroupSection` whose expanded/collapsed state is owned by
 * `useDestinationSections`, seeded so every section starts **expanded** (R6.4)
 * and toggles on header tap (R6.5).
 *
 * A scoped Experience_Category `Chip` filter row sits above the sections,
 * defaulting to no active category (the "All" chip, R6.7). Selecting a category
 * re-derives the sections via `groupByLandFiltered` client-side over the
 * already-fetched Experiences — no refetch — preserving the Land grouping and
 * ordering (R6.8) and dropping any Land section left with no matching Experience
 * (R6.9).
 *
 * Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9
 */
function ThemeOrWaterParkLayout({
  experiences,
  onSelectExperience,
  completedIds,
}: {
  readonly experiences: readonly ExperienceDTO[];
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
}): JSX.Element {
  // Category tabs matching the schedule builder picker: 'all' | 'attractions' | 'dining' | 'shows'
  const [activeTab, setActiveTab] = useState<ExperiencePickerTab>('all');
  const [selectedLands, setSelectedLands] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);

  const clearAllFilters = useCallback(() => {
    setSelectedLands(new Set());
    setSelectedTags(new Set());
  }, []);

  const toggleLandFilter = useCallback((land: string) => {
    setSelectedLands((prev) => {
      const next = new Set(prev);
      if (next.has(land)) {
        next.delete(land);
      } else {
        next.add(land);
      }
      return next;
    });
  }, []);

  const toggleTagFilter = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const handleTabChange = useCallback(
    (tab: ExperiencePickerTab) => {
      setActiveTab(tab);
      clearAllFilters();
    },
    [clearAllFilters],
  );

  // Tab category filter
  const tabFilteredResults = useMemo(() => {
    return experiences.filter((item) => {
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
      return true;
    });
  }, [experiences, activeTab]);

  // Dynamic filter chips derived directly from loaded tab results
  const { landChips, priceChips, attributeChips, allChips } = useMemo(
    () => deriveFilterChips(tabFilteredResults),
    [tabFilteredResults],
  );
  const quickChips = useMemo(
    () => deriveQuickChips(attributeChips, activeTab, priceChips),
    [attributeChips, activeTab, priceChips],
  );

  // Multi-filter by selected lands and attribute/price tags
  const filteredResults = useMemo(
    () =>
      filterExperiencesMulti(tabFilteredResults, selectedLands, selectedTags),
    [tabFilteredResults, selectedLands, selectedTags],
  );

  const activeFilterCount = selectedLands.size + selectedTags.size;

  // Re-derive Land sections client-side
  const sections = useMemo(
    () => groupByPavilionFiltered(filteredResults, null),
    [filteredResults],
  );

  // Seed collapsible state
  const sectionKeys = useMemo(() => sections.map((s) => s.key), [sections]);
  const { isExpanded, toggle } = useDestinationSections(sectionKeys);

  // Accessible announcement of visible count
  const visibleCount = useMemo(
    () => sections.reduce((total, section) => total + section.items.length, 0),
    [sections],
  );
  useResultCountAnnouncement(visibleCount);

  return (
    <View style={styles.tabLayoutContainer}>
      {/* Category Tabs */}
      <View
        style={styles.tabBar}
        testID="destination-category-filter"
      >
        <Pressable
          style={[styles.tabBtn, activeTab === 'all' && styles.tabBtnActive]}
          onPress={() => handleTabChange('all')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'all' }}
          accessibilityLabel={`All, ${
            activeTab === 'all' ? 'selected' : 'not selected'
          }`}
          testID="destination-category-All"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'all' && styles.tabTextActive,
            ]}
          >
            All
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabBtn,
            activeTab === 'attractions' && styles.tabBtnActive,
          ]}
          onPress={() => handleTabChange('attractions')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'attractions' }}
          accessibilityLabel={`Ride, ${
            activeTab === 'attractions' ? 'selected' : 'not selected'
          }`}
          testID="destination-category-Ride"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'attractions' && styles.tabTextActive,
            ]}
          >
            Rides
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.tabBtn,
            activeTab === 'dining' && styles.tabBtnActive,
          ]}
          onPress={() => handleTabChange('dining')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'dining' }}
          accessibilityLabel={`Restaurant, ${
            activeTab === 'dining' ? 'selected' : 'not selected'
          }`}
          testID="destination-category-Restaurant"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'dining' && styles.tabTextActive,
            ]}
          >
            Dining
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tabBtn, activeTab === 'shows' && styles.tabBtnActive]}
          onPress={() => handleTabChange('shows')}
          accessibilityRole="button"
          accessibilityState={{ selected: activeTab === 'shows' }}
          accessibilityLabel={`Show, ${
            activeTab === 'shows' ? 'selected' : 'not selected'
          }`}
          testID="destination-category-Show"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'shows' && styles.tabTextActive,
            ]}
          >
            Shows
          </Text>
        </Pressable>
      </View>

      {/* Sub-Filters / Quick Chips Bar */}
      {allChips.length > 0 && (
        <View style={styles.filterBarWrap} testID="destination-sub-filters">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBarScroll}
          >
            {/* Filters Modal Button */}
            <Pressable
              style={[
                styles.filterChip,
                styles.filterModalBtn,
                activeFilterCount > 0 && styles.filterModalBtnActive,
              ]}
              onPress={() => setIsFilterModalOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Open filters sheet${
                activeFilterCount > 0 ? `, ${activeFilterCount} active` : ''
              }`}
              testID="destination-open-filters-modal"
            >
              <Ionicons
                name="options-outline"
                size={14}
                color={
                  activeFilterCount > 0 ? '#FFFFFF' : theme.color.textSecondary
                }
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

            {/* Quick Filter Chips */}
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
                  accessibilityLabel={`${chip.rawValue}, quick attribute filter${
                    isSelected ? ', selected' : ''
                  }`}
                  testID={`destination-subfilter-${chip.id}`}
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

            {/* Reset Button */}
            {activeFilterCount > 0 && (
              <Pressable
                style={[styles.filterChip, styles.resetChip]}
                onPress={clearAllFilters}
                accessibilityRole="button"
                accessibilityLabel="Reset all active filters"
                testID="destination-subfilter-reset"
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
        testID="destination-filters-modal"
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={styles.modalBackdropDismiss}
            onPress={() => setIsFilterModalOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close filters modal"
          />
          <View
            style={styles.modalContent}
            testID="destination-filters-modal-content"
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <View style={styles.modalHeaderActions}>
                {activeFilterCount > 0 && (
                  <Pressable
                    onPress={clearAllFilters}
                    style={styles.modalClearBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Clear all filters"
                    testID="destination-modal-clear-all"
                  >
                    <Text style={styles.modalClearText}>Clear All</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setIsFilterModalOpen(false)}
                  style={styles.modalCloseBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Close filters sheet"
                  testID="destination-modal-close"
                >
                  <Ionicons
                    name="close"
                    size={22}
                    color={theme.color.textPrimary}
                  />
                </Pressable>
              </View>
            </View>

            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Lands Section */}
              {landChips.length > 0 && (
                <View
                  style={styles.modalSection}
                  testID="destination-modal-lands-section"
                >
                  <Text style={styles.modalSectionTitle}>
                    LANDS{' '}
                    {selectedLands.size > 0 ? `(${selectedLands.size})` : ''}
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
                          accessibilityLabel={`${chip.rawValue}, land filter${
                            isSelected ? ', selected' : ''
                          }`}
                          testID={`destination-modal-filter-${chip.id}`}
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
                <View
                  style={styles.modalSection}
                  testID="destination-modal-price-section"
                >
                  <Text style={styles.modalSectionTitle}>
                    PRICE RANGE{' '}
                    {selectedTags.size > 0
                      ? `(${
                          Array.from(selectedTags).filter((t) =>
                            priceChips.some((p) => p.rawValue === t),
                          ).length
                        })`
                      : ''}
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
                          accessibilityLabel={`${chip.rawValue}, price filter${
                            isSelected ? ', selected' : ''
                          }`}
                          testID={`destination-modal-filter-${chip.id}`}
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
                <View
                  style={styles.modalSection}
                  testID="destination-modal-attributes-section"
                >
                  <Text style={styles.modalSectionTitle}>
                    ATTRIBUTES & DINING{' '}
                    {selectedTags.size > 0
                      ? `(${
                          Array.from(selectedTags).filter((t) =>
                            attributeChips.some((a) => a.rawValue === t),
                          ).length
                        })`
                      : ''}
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
                          accessibilityLabel={`${
                            chip.rawValue
                          }, attribute filter${isSelected ? ', selected' : ''}`}
                          testID={`destination-modal-filter-${chip.id}`}
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

            <View style={styles.modalFooter}>
              <Pressable
                style={styles.modalApplyBtn}
                onPress={() => setIsFilterModalOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={`Apply filters, ${filteredResults.length} experiences found`}
                testID="destination-modal-apply-btn"
              >
                <Text style={styles.modalApplyBtnText}>
                  {filteredResults.length > 0
                    ? `Show ${filteredResults.length} Result${
                        filteredResults.length === 1 ? '' : 's'
                      }`
                    : 'Show 0 Results'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Content List or Empty State */}
      {filteredResults.length === 0 ? (
        <View style={styles.center} testID="destination-filter-empty">
          <EmptyState
            icon="search-outline"
            title="No experiences matched"
            body="Try resetting your active filters."
          />
          <Pressable
            style={styles.resetFilterEmptyBtn}
            onPress={clearAllFilters}
            accessibilityRole="button"
            accessibilityLabel="Reset active filters"
            testID="destination-filter-empty-reset"
          >
            <Text style={styles.resetFilterEmptyBtnText}>Reset Filters</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={sections as Section<ExperienceDTO>[]}
          keyExtractor={(section) => section.key}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          initialNumToRender={8}
          windowSize={11}
          renderItem={({ item: section }) => {
            const expanded = isExpanded(section.key);
            return (
              <GroupSection
                sectionKey={section.key}
                expanded={expanded}
                onToggle={toggle}
                accessibilityLabel={`${section.title}, ${
                  expanded ? 'expanded' : 'collapsed'
                }`}
                header={
                  <SectionHeader
                    title={section.title}
                    count={section.items.length}
                    expanded={expanded}
                  />
                }
                testID={`destination-section-${section.key}`}
              >
                {section.items.map((experience) => (
                  <ExperienceRow
                    key={experience.id}
                    experience={experience}
                    onPress={() => onSelectExperience(experience)}
                    completed={completedIds.has(experience.id)}
                  />
                ))}
              </GroupSection>
            );
          }}
        />
      )}
    </View>
  );
}

/**
 * A collapsible section header shared by the Destination layouts: an
 * expand/collapse chevron reflecting the section's current state, the section
 * title, and the section's item count. Rendered inside `GroupSection`'s
 * activatable header (which owns the `accessibilityState`). Used for both Land
 * sections (theme/water-park layout) and Experience_Category sections (Disney
 * Springs layout).
 */
function SectionHeader({
  title,
  count,
  expanded,
}: {
  readonly title: string;
  readonly count: number;
  readonly expanded: boolean;
}): JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons
        name={expanded ? 'chevron-down' : 'chevron-forward'}
        size={18}
        color={theme.color.textSecondary}
        style={styles.sectionChevron}
      />
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

/** Friendly label for an Experience_Category, falling back to the raw enum. */
function categoryLabel(category: ExperienceCategory): string {
  return theme.categoryVisual[category]?.label ?? category;
}

// ---------------------------------------------------------------------------
// Disney Springs layout (task 10.3)
// ---------------------------------------------------------------------------

/**
 * The Disney Springs Destination layout (R7.2–R7.5, R7.7).
 *
 * Disney Springs has no Lands, so its already-fetched Experiences are grouped by
 * Experience_Category through the pure `groupByCategory` core: sections follow
 * the canonical `EXPERIENCE_CATEGORIES` order (R7.2) and any category with no
 * active Experience is omitted entirely (R7.5). There is deliberately **no**
 * category filter chip row — unlike the theme/water-park layout — because the
 * categories themselves are the sections here.
 *
 * Each section renders as a collapsible `GroupSection` whose expanded/collapsed
 * state is owned by `useDestinationSections`, seeded so every section starts
 * **expanded** on first render (R7.3) and toggles on header tap (R7.4). The
 * section header and `ExperienceRow` are shared with the theme/water-park
 * layout so both Destination layouts present sections and rows identically.
 *
 * The empty state — when the Destination has zero active Experiences (R7.7) — is
 * handled one level up by `DestinationBody` (its `showEmpty` branch renders
 * before `renderBody` is reached), so this layout only ever receives a non-empty
 * Experience list and needs no additional empty handling.
 *
 * Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.7
 */
function DisneySpringsLayout({
  experiences,
  onSelectExperience,
  completedIds,
}: {
  readonly experiences: readonly ExperienceDTO[];
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
}): JSX.Element {
  // R7.2/R7.5: derive the category sections client-side over the already-fetched
  // Experiences in canonical order, empties omitted (no refetch).
  const sections = useMemo(() => groupByCategory(experiences), [experiences]);

  // R7.3: seed the collapsible state with every current section key so the
  // first render is fully expanded.
  const sectionKeys = useMemo(() => sections.map((s) => s.key), [sections]);
  const { isExpanded, toggle } = useDestinationSections(sectionKeys);

  return (
    <FlatList
      data={sections as Section<ExperienceDTO>[]}
      keyExtractor={(section) => section.key}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      initialNumToRender={8}
      windowSize={11}
      renderItem={({ item: section }) => {
        const expanded = isExpanded(section.key);
        return (
          <GroupSection
            sectionKey={section.key}
            expanded={expanded}
            onToggle={toggle}
            accessibilityLabel={`${section.title}, ${
              expanded ? 'expanded' : 'collapsed'
            }`}
            header={
              <SectionHeader
                title={categoryLabel(section.title as ExperienceCategory)}
                count={section.items.length}
                expanded={expanded}
              />
            }
            testID={`destination-section-${section.key}`}
          >
            {section.items.map((experience) => (
              <ExperienceRow
                key={experience.id}
                experience={experience}
                onPress={() => onSelectExperience(experience)}
                completed={completedIds.has(experience.id)}
              />
            ))}
          </GroupSection>
        );
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Resorts layout (task 10.4)
// ---------------------------------------------------------------------------

/**
 * The Resorts Destination layout (R8.1–R8.4, R8.6, R8.7).
 *
 * In addition to the Destination's already-fetched active `Resort`-area
 * Experiences, this layout fetches the active Resort list itself via
 * `GET /resorts` (react-query, queryKey `['resorts']`, same 5-minute staleness
 * as the catalog, `retry: false`), matching how `CatalogScreen` /
 * `ExperienceDetailScreen` consume `/resorts` (R8.1).
 *
 * Each active Resort becomes a **collapsible section** via the pure
 * `groupByResort` core: every Resort is a section header ordered
 * case-insensitively by name — including Resorts with no active Experiences so
 * the full resort directory stays browsable (R8.3) — with its
 * `resortId`-matched Experiences (ordered by name) as the section body (R8.2),
 * then a single resort-wide catch-all section holding Experiences with
 * no/unmatched `resortId` appended after every specific Resort group (R8.4).
 * Experience rows reuse `ExperienceRow` (R8.5); an expanded Resort with no
 * Experiences shows an empty-group indication (R8.7).
 *
 * Unlike the park layouts (which start expanded), the Resort sections start
 * **collapsed** — there are many Resorts, so a collapsed directory of headers
 * is far easier to scan and scroll than one long flat list. Tapping a header
 * expands/collapses that Resort's Experiences in place and stays on the screen.
 *
 * Graceful degradation (R10.5): the base screen already handles
 * `catalog_unavailable` for the `/catalog` fetch. If the `/resorts` fetch fails
 * or is still loading, `resorts` is simply an empty list, so `groupByResort`
 * renders every Experience under the catch-all section rather than crashing.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 10.5
 */
function ResortsLayout({
  experiences,
  onSelectExperience,
  completedIds,
}: {
  readonly experiences: readonly ExperienceDTO[];
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
}): JSX.Element {
  // R8.1: fetch the active Resort list. On failure or while loading the list is
  // empty, so `groupByResort` degrades to a catch-all-only layout (R10.5).
  const resortsQuery = useQuery<ResortListResponse, ApiError>({
    queryKey: ['resorts'] as const,
    queryFn: () => apiRequest<ResortListResponse>('GET', '/resorts'),
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  const resorts = resortsQuery.data?.resorts ?? [];

  // R8.2/R8.3/R8.4: one collapsible section per Resort (incl. empty ones) plus a
  // trailing catch-all, ordered case-insensitively by name.
  const sections = useMemo(
    () => groupByResort(experiences, resorts),
    [experiences, resorts],
  );

  // Collapsed by default: the natural empty state of the proven section-state
  // reducer is "all collapsed", which is exactly what a long resort directory
  // wants (the opposite of the park layouts' default-expanded policy).
  const [expandedState, setExpandedState] = useState<GroupSectionState>(
    () => new Set(),
  );
  const isExpanded = useCallback(
    (key: string): boolean => isExpandedPure(expandedState, key),
    [expandedState],
  );
  const toggle = useCallback((key: string): void => {
    setExpandedState((current) => togglePure(current, key));
  }, []);

  return (
    <FlatList
      data={sections as Section<ExperienceDTO>[]}
      keyExtractor={(section) => section.key}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      initialNumToRender={16}
      windowSize={11}
      renderItem={({ item: section }) => {
        const expanded = isExpanded(section.key);
        const isCatchall = section.key === RESORT_CATCHALL_ID;
        return (
          <GroupSection
            sectionKey={section.key}
            expanded={expanded}
            onToggle={toggle}
            accessibilityLabel={`${section.title}, ${
              expanded ? 'expanded' : 'collapsed'
            }`}
            header={
              <ResortSectionHeader
                title={section.title}
                count={section.items.length}
                expanded={expanded}
                isCatchall={isCatchall}
              />
            }
            testID={`destination-resort-${section.key}`}
          >
            {section.items.length === 0 ? (
              <Text
                style={styles.resortAnchorEmpty}
                testID={`destination-resort-empty-${section.key}`}
              >
                No experiences yet
              </Text>
            ) : (
              section.items.map((experience) => (
                <ExperienceRow
                  key={experience.id}
                  experience={experience}
                  onPress={() => onSelectExperience(experience)}
                  completed={completedIds.has(experience.id)}
                />
              ))
            )}
          </GroupSection>
        );
      }}
    />
  );
}

/**
 * A Resort section header: the expand/collapse chevron, a Resort (or catch-all)
 * glyph, the Resort name, and its Experience count. Mirrors `SectionHeader` but
 * carries the resort-flavored leading icon so a Resort section still reads as a
 * hotel rather than a generic group.
 */
function ResortSectionHeader({
  title,
  count,
  expanded,
  isCatchall,
}: {
  readonly title: string;
  readonly count: number;
  readonly expanded: boolean;
  readonly isCatchall: boolean;
}): JSX.Element {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons
        name={expanded ? 'chevron-down' : 'chevron-forward'}
        size={18}
        color={theme.color.textSecondary}
        style={styles.sectionChevron}
      />
      <Ionicons
        name={isCatchall ? 'ellipsis-horizontal-circle-outline' : 'bed-outline'}
        size={18}
        color={theme.color.primary}
        style={styles.resortAnchorIcon}
      />
      <Text style={styles.sectionTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ExperienceRowProps {
  readonly experience: ExperienceDTO;
  readonly onPress: () => void;
  /**
   * Whether the signed-in User has marked this Experience as visited. When
   * true the row shows a "Visited" completion badge so the list conveys
   * completion at a glance without drilling into the detail screen.
   */
  readonly completed?: boolean;
}

/**
 * One Experience row. Shows the thumbnail (or category placeholder), the name,
 * the category badge, the Resort_Area zone tag (for a Resort-area Experience
 * that carries one, so a resort's Experiences convey which part of the property
 * they sit in), and — for a Restaurant with a persisted price tier — the
 * compact price-tier Info_Tag from `priceTierListTag` (R9.9), so the row and the
 * detail view present the price tier identically.
 *
 * When `completed` is true the row also surfaces a "Visited" completion badge,
 * matching the completion visual language (green + `checkmark-circle`) used on
 * the Experience_Detail_Screen, so a guest can spot the Experiences they have
 * already done directly from the list.
 */
function ExperienceRow({
  experience,
  onPress,
  completed = false,
}: ExperienceRowProps): JSX.Element {
  const visual = theme.categoryVisual[experience.category];
  // `park` is `null` for a Resort-area Experience with no park ancestor; fall
  // back to the brand accent so the row still reads.
  const accent =
    experience.park !== null
      ? theme.parkAccent[experience.park]
      : theme.color.primary;

  // R9.9: a Restaurant with a persisted price tier shows the compact price tag.
  const showPriceTag =
    experience.category === 'Restaurant' &&
    typeof experience.priceTier === 'string' &&
    experience.priceTier.trim().length > 0;
  const priceTag = showPriceTag
    ? priceTierListTag((experience.priceTier as string).trim())
    : null;

  // The Resort_Area zone tag (e.g. "EPCOT Resort Area"), shown only for a
  // Resort-area Experience that carries one.
  const resortArea = resortAreaLabel(experience);

  return (
    <Card
      onPress={onPress}
      accentColor={accent}
      style={styles.row}
      testID={`destination-row-${experience.id}`}
    >
      <View style={styles.rowInner}>
        <View style={styles.thumbWrap}>
          <ExperienceThumb
            imageUrl={experience.imageUrl ?? null}
            category={experience.category}
          />
          {completed ? (
            <VisitedOverlay testID={`destination-visited-${experience.id}`} />
          ) : null}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={2}>
            {experience.name}
          </Text>
          {resortArea !== null ? (
            <View
              style={styles.rowMetaLine}
              testID={`destination-resort-area-${experience.id}`}
            >
              <Ionicons
                name="location"
                size={12}
                color={theme.color.textSecondary}
                style={styles.rowMetaIcon}
              />
              <Text style={styles.rowMeta} numberOfLines={1}>
                {resortArea}
              </Text>
            </View>
          ) : null}
          <View style={styles.rowBadges}>
            <Badge
              label={visual.label}
              color={visual.tint}
              icon={visual.glyph as keyof typeof Ionicons.glyphMap}
            />
            {priceTag !== null ? (
              <Badge
                label={priceTag.label}
                color={theme.color.primary}
                accessibilityLabel={priceTag.accessibilityLabel}
                testID={`destination-price-${experience.id}`}
              />
            ) : null}
          </View>
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={theme.color.textSecondary}
        />
      </View>
    </Card>
  );
}

/**
 * Leading thumbnail for an Experience row. Renders the Disney-sourced image when
 * present; otherwise a category-tinted placeholder with the category glyph
 * (R10.4).
 */
function ExperienceThumb({
  imageUrl,
  category,
}: {
  readonly imageUrl: string | null;
  readonly category: ExperienceCategory;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  const visual = theme.categoryVisual[category];

  if (imageUrl !== null && imageUrl.length > 0 && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={styles.thumb}
        resizeMode="cover"
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View
      style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: visual.tint }]}
      testID="destination-thumb-placeholder"
    >
      <Ionicons
        name={visual.glyph as keyof typeof Ionicons.glyphMap}
        size={22}
        color={theme.color.textOnPrimary}
      />
    </View>
  );
}

/**
 * A completion marker overlaid on the corner of an Experience row's thumbnail:
 * a solid green disc with a white checkmark and a surface-colored ring so it
 * reads clearly against any image. Placing it on the thumbnail — rather than
 * inline with the category / price Info_Tags — keeps the "visited" signal
 * visually distinct from the tag pills so it is easy to spot when scanning the
 * list. Exposed as a single accessible "Visited" element for screen readers.
 */
function VisitedOverlay({ testID }: { readonly testID: string }): JSX.Element {
  return (
    <View
      style={styles.visitedOverlay}
      testID={testID}
      accessible
      accessibilityLabel="Visited"
    >
      <Ionicons name="checkmark" size={14} color={theme.color.textOnPrimary} />
    </View>
  );
}

function DestinationUnavailableState({
  title,
}: {
  readonly title: string;
}): JSX.Element {
  return (
    <ScreenContainer>
      <GradientHeader title={title} icon="map" />
      <View style={styles.center} testID="destination-unavailable">
        <EmptyState
          icon="cloud-offline-outline"
          title="Catalog couldn't be loaded"
          body="Try again later."
        />
      </View>
    </ScreenContainer>
  );
}

function GenericErrorState({
  title,
  message,
}: {
  readonly title: string;
  readonly message: string;
}): JSX.Element {
  return (
    <ScreenContainer>
      <GradientHeader title={title} icon="map" />
      <View style={styles.center} testID="destination-error">
        <EmptyState
          icon="alert-circle-outline"
          title="Something went wrong"
          body={message}
        />
      </View>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the `GET /catalog` URL from a Destination's filter and dispatch the
 * request. Only the supplied filter keys are appended as query parameters so the
 * server treats a missing parameter as "no filter".
 */
async function fetchCatalog(
  filter: { parkId?: string; areaType?: 'Resort' },
): Promise<CatalogListResponse> {
  const params = new URLSearchParams();
  if (filter.parkId !== undefined) {
    params.append('parkId', filter.parkId);
  }
  if (filter.areaType !== undefined) {
    params.append('areaType', filter.areaType);
  }
  const qs = params.toString();
  const path = qs.length > 0 ? `/catalog?${qs}` : '/catalog';
  return apiRequest<CatalogListResponse>('GET', path);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...theme.shadow.card,
  },
  searchIcon: {
    marginRight: theme.spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    fontSize: 16,
    color: theme.color.textPrimary,
  },
  searchClear: {
    marginLeft: theme.spacing.sm,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.warningSurface,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
  staleBannerIcon: {
    marginRight: theme.spacing.sm,
  },
  staleBannerText: {
    color: theme.color.warningText,
    ...theme.typography.meta,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  row: {
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  thumbWrap: {
    position: 'relative',
    marginRight: theme.spacing.md,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitedOverlay: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.color.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.color.surface,
  },
  rowText: {
    flex: 1,
    marginRight: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  rowName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  rowMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowMetaIcon: {
    marginRight: 4,
  },
  rowMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    flexShrink: 1,
  },
  rowBadges: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  filterRow: {
    paddingBottom: theme.spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingRight: theme.spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  sectionChevron: {
    marginRight: theme.spacing.sm,
  },
  sectionTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
    flex: 1,
  },
  sectionCount: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginLeft: theme.spacing.sm,
  },
  tabLayoutContainer: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    padding: 3,
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...theme.shadow.card,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
  },
  tabBtnActive: {
    backgroundColor: theme.color.primary,
  },
  tabText: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    fontWeight: '600',
  },
  tabTextActive: {
    color: theme.color.textOnPrimary,
    fontWeight: '700',
  },
  hiddenCompatibilityRow: {
    display: 'none',
  },
  filterBarWrap: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xs,
  },
  filterBarScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingRight: theme.spacing.lg,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
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
    fontSize: 12,
    color: theme.color.textSecondary,
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: theme.color.textOnPrimary,
    fontWeight: '700',
  },
  filterModalBtn: {
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
  },
  filterModalBtnActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  filterModalBtnText: {
    fontWeight: '600',
  },
  resetChip: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  resetChipText: {
    color: '#b91c1c',
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdropDismiss: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
    maxHeight: '80%',
    ...theme.shadow.card,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  modalTitle: {
    ...theme.typography.title,
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
  resetFilterEmptyBtn: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.color.primary,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
  },
  resetFilterEmptyBtnText: {
    color: theme.color.textOnPrimary,
    ...theme.typography.button,
  },
  resortAnchor: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.color.surfaceAlt,
    borderRadius: theme.radius.md,
  },
  resortAnchorIcon: {
    marginRight: theme.spacing.sm,
  },
  resortAnchorText: {
    flex: 1,
  },
  resortAnchorName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  resortAnchorEmpty: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginTop: theme.spacing.xs,
  },
});
