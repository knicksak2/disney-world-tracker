/**
 * ParkDestinationScreen — Level 2 Park Land View.
 *
 * Implements Tasks 7.1, 7.2, 7.3, 7.4 (Requirements 3.1–3.7, 7.4, 7.6).
 * Replaces DestinationScreen.tsx's ThemeOrWaterParkLayout.
 *
 * Key features:
 * - Hero header with park landmark photography, title, and real-time wait pulse (R3.1).
 * - Category tabs (All, Rides, Dining, Shows) + adjacent Favorites toggle (R3.2, R3.3).
 * - Dynamic quick chips derived horizontally beneath tabs (R3.5).
 * - Multi-select Filters modal supporting Lands, Price Tiers, Height Requirements,
 *   and Physical Considerations (R3.4, R7.6).
 * - Collapsible Land accordions with experience count badges (R3.6).
 * - Experience cards with thumbnails, visited badges, land location, category badges,
 *   price tiers, height requirement badges (R3.7), and favorite toggles.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { DESTINATION_VISUALS } from './destinationVisuals';

import {
  filterAndRankExperiences,
  type ExperienceCategory,
  type ExperienceDTO,
  type Park,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';
import {
  DESTINATIONS,
  destinationCatalogFilter,
  type Destination,
  type DestinationId,
} from './destinations';
import {
  browseLandOf,
  groupByPavilionFiltered,
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
import { useFavoritedExperiences } from './useFavoritedExperiences';
import { FavoriteToggle } from './FavoriteToggle';
import { priceTierListTag, resortAreaLabel } from './infoTags';
import { useResultCountAnnouncement } from './catalogFocus';

// ---------------------------------------------------------------------------
// Constants & Landmark Assets
// ---------------------------------------------------------------------------

export const PARK_HERO_PHOTOS: Record<
  string,
  { readonly icon: string; readonly landmark: string }
> = {
  'Magic Kingdom': {
    icon: '🏰',
    landmark: 'Cinderella Castle',
  },
  EPCOT: {
    icon: '🌐',
    landmark: 'Spaceship Earth',
  },
  'Hollywood Studios': {
    icon: '🎬',
    landmark: 'Tower of Terror',
  },
  'Animal Kingdom': {
    icon: '🌳',
    landmark: 'Tree of Life',
  },
  'Typhoon Lagoon': {
    icon: '🏄‍♂️',
    landmark: 'Surf Pool & Mount Mayday',
  },
  'Blizzard Beach': {
    icon: '❄️',
    landmark: 'Mount Gushmore',
  },
};

const SECTION_HEADER_ROW_HEIGHT = 44;
const EXPERIENCE_ROW_HEIGHT = 96;
const STALE_TIME_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types & Flattened List Structures
// ---------------------------------------------------------------------------

export interface ParkDestinationScreenProps {
  readonly route?: {
    readonly params?: {
      readonly destination?: DestinationId;
      readonly park?: Park;
    };
  } | undefined;
  readonly navigation?: any;
  readonly destination?: Destination | undefined;
  readonly experiences?: readonly ExperienceDTO[] | undefined;
  readonly onSelectExperience?: ((experience: ExperienceDTO) => void) | undefined;
  readonly completedIds?: ReadonlySet<string> | undefined;
  readonly favoritedIds?: ReadonlySet<string> | undefined;
  readonly showStaleBanner?: boolean | undefined;
}

interface CatalogListResponse {
  readonly experiences: readonly ExperienceDTO[];
  readonly staleCache: boolean;
  readonly cacheAgeHours?: number | null;
}

type FlatSectionRow<T> =
  | {
      readonly kind: 'header';
      readonly key: string;
      readonly section: Section<T>;
    }
  | {
      readonly kind: 'item';
      readonly key: string;
      readonly sectionKey: string;
      readonly item: T;
    };

function flattenSections<T>(
  sections: readonly Section<T>[],
  isExpanded: (key: string) => boolean,
): readonly FlatSectionRow<T>[] {
  const rows: FlatSectionRow<T>[] = [];
  for (const section of sections) {
    rows.push({ kind: 'header', key: `header:${section.key}`, section });
    if (!isExpanded(section.key)) {
      continue;
    }
    for (const item of section.items) {
      rows.push({
        kind: 'item',
        key: `item:${section.key}:${(item as { id: string }).id}`,
        sectionKey: section.key,
        item,
      });
    }
  }
  return rows;
}

function buildRowLayouts<T>(
  rows: readonly FlatSectionRow<T>[],
): readonly { length: number; offset: number; index: number }[] {
  let offset = 0;
  return rows.map((row, index) => {
    const length =
      row.kind === 'header'
        ? SECTION_HEADER_ROW_HEIGHT
        : EXPERIENCE_ROW_HEIGHT;
    const layout = { length, offset, index };
    offset += length;
    return layout;
  });
}

async function fetchCatalog(filter: {
  parkId?: string;
  areaType?: 'Resort';
}): Promise<CatalogListResponse> {
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
// Main Component
// ---------------------------------------------------------------------------

export default function ParkDestinationScreen({
  route,
  navigation: passedNavigation,
  destination: passedDestination,
  experiences: passedExperiences,
  onSelectExperience: passedOnSelectExperience,
  completedIds: passedCompletedIds,
  favoritedIds: passedFavoritedIds,
  showStaleBanner: passedShowStaleBanner,
}: ParkDestinationScreenProps): JSX.Element {
  const defaultNav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const navigation = passedNavigation ?? defaultNav;

  // Resolve destination
  const destinationId =
    passedDestination?.id ??
    route?.params?.destination ??
    (route?.params?.park as DestinationId | undefined) ??
    'Magic Kingdom';

  const destination: Destination = useMemo(() => {
    if (passedDestination) return passedDestination;
    const found = DESTINATIONS.find((d) => d.id === destinationId);
    return (
      found ?? {
        id: destinationId,
        kind: 'themeOrWaterPark',
        title: destinationId,
      }
    );
  }, [passedDestination, destinationId]);

  const filter = useMemo(() => destinationCatalogFilter(destination), [destination]);

  // Catalog query (if experiences not supplied as props)
  const catalogQuery = useQuery<CatalogListResponse, ApiError>({
    queryKey: ['catalog', 'destination', destination.id, filter] as const,
    queryFn: () => fetchCatalog(filter),
    staleTime: STALE_TIME_MS,
    enabled: !passedExperiences,
    retry: false,
  });

  const experiences = passedExperiences ?? catalogQuery.data?.experiences ?? [];
  const showStaleBanner =
    passedShowStaleBanner ?? catalogQuery.data?.staleCache === true;

  const defaultCompletedIds = useCompletedExperiences();
  const defaultFavoritedIds = useFavoritedExperiences();
  const completedIds = passedCompletedIds ?? defaultCompletedIds;
  const favoritedIds = passedFavoritedIds ?? defaultFavoritedIds;

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const trimmedQuery = searchInput.trim();
  const searchActive = trimmedQuery.length > 0;

  // Category and filter state (Req 3.2, 3.3, 3.4)
  const [activeTab, setActiveTab] = useState<ExperiencePickerTab>('all');
  const [selectedLands, setSelectedLands] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedFestivals, setSelectedFestivals] = useState<Set<string>>(new Set());
  const [isFilterModalOpen, setIsFilterModalOpen] = useState<boolean>(false);
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);

  const clearAllFilters = useCallback(() => {
    setSelectedLands(new Set());
    setSelectedTags(new Set());
    setSelectedFestivals(new Set());
  }, []);

  const toggleLandFilter = useCallback((land: string) => {
    setSelectedLands((prev) => {
      const next = new Set(prev);
      if (next.has(land)) next.delete(land);
      else next.add(land);
      return next;
    });
  }, []);

  const toggleTagFilter = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const toggleFestivalFilter = useCallback((slug: string) => {
    setSelectedFestivals((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
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

  // Derived filter chips
  const { landChips, priceChips, attributeChips, festivalChips, allChips } =
    useMemo(() => deriveFilterChips(tabFilteredResults), [tabFilteredResults]);

  const quickChips = useMemo(
    () => deriveQuickChips(attributeChips, activeTab, priceChips, festivalChips),
    [attributeChips, activeTab, priceChips, festivalChips],
  );

  // Partition attribute chips for dedicated modal rows (Req 3.4, 7.6)
  const heightChips = useMemo(() => {
    return attributeChips.filter((c) => {
      const raw = c.rawValue.toLowerCase();
      const id = c.id.toLowerCase();
      return (
        id.includes('height') ||
        raw.includes('height') ||
        raw.includes('inch') ||
        raw.includes(' cm') ||
        raw.includes('taller') ||
        raw.includes('under')
      );
    });
  }, [attributeChips]);

  const physicalChips = useMemo(() => {
    return attributeChips.filter((c) => {
      const raw = c.rawValue.toLowerCase();
      const id = c.id.toLowerCase();
      return (
        id.includes('physical') ||
        raw.includes('physical') ||
        id.includes('expectant') ||
        raw.includes('expectant') ||
        id.includes('wheelchair') ||
        raw.includes('wheelchair') ||
        id.includes('motion') ||
        raw.includes('motion') ||
        id.includes('transfer') ||
        raw.includes('transfer') ||
        id.includes('service-animal') ||
        raw.includes('service animal') ||
        id.includes('advisory') ||
        id.includes('age') ||
        raw.includes('adult') ||
        raw.includes('kid') ||
        raw.includes('preschool') ||
        raw.includes('teen')
      );
    });
  }, [attributeChips]);

  const otherAttributeChips = useMemo(() => {
    const heightSet = new Set(heightChips.map((c) => c.id));
    const physicalSet = new Set(physicalChips.map((c) => c.id));
    return attributeChips.filter(
      (c) => !heightSet.has(c.id) && !physicalSet.has(c.id),
    );
  }, [attributeChips, heightChips, physicalChips]);

  // Filtered results
  const filteredResults = useMemo(() => {
    const multiFiltered = filterExperiencesMulti(
      tabFilteredResults,
      selectedLands,
      selectedTags,
      selectedFestivals,
    );
    if (!favoritesOnly) {
      return multiFiltered;
    }
    return multiFiltered.filter((item) => favoritedIds.has(item.id));
  }, [
    tabFilteredResults,
    selectedLands,
    selectedTags,
    selectedFestivals,
    favoritesOnly,
    favoritedIds,
  ]);

  const activeFilterCount =
    selectedLands.size + selectedTags.size + selectedFestivals.size;

  // Land sections client-side (Req 3.6)
  const sections = useMemo(
    () => groupByPavilionFiltered(filteredResults, null),
    [filteredResults],
  );

  const sectionKeys = useMemo(() => sections.map((s) => s.key), [sections]);
  const { isExpanded, toggle } = useDestinationSections(sectionKeys);

  const flatRows = useMemo(
    () => flattenSections(sections, isExpanded),
    [sections, isExpanded],
  );
  const rowLayouts = useMemo(() => buildRowLayouts(flatRows), [flatRows]);
  const getItemLayout = useCallback(
    (_data: unknown, index: number) =>
      rowLayouts[index] ?? { length: EXPERIENCE_ROW_HEIGHT, offset: 0, index },
    [rowLayouts],
  );

  const visibleCount = useMemo(
    () => sections.reduce((total, section) => total + section.items.length, 0),
    [sections],
  );
  const showLoading =
    !passedExperiences && catalogQuery.isLoading && experiences.length === 0;
  const announcementEnabled = !showLoading;
  useResultCountAnnouncement(visibleCount, announcementEnabled);

  const onSelectExperience = useCallback(
    (experience: ExperienceDTO): void => {
      if (passedOnSelectExperience) {
        passedOnSelectExperience(experience);
      } else {
        navigation.navigate('ExperienceDetail', { experienceId: experience.id });
      }
    },
    [passedOnSelectExperience, navigation],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: (typeof flatRows)[number] }) => {
      if (row.kind === 'header') {
        const section = row.section;
        const expanded = isExpanded(section.key);
        return (
          <CollapsibleHeaderRow
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
          />
        );
      }
      return (
        <View style={styles.itemRowWrap}>
          <ExperienceRow
            experience={row.item}
            onSelectExperience={onSelectExperience}
            completed={completedIds.has(row.item.id)}
            favorited={favoritedIds.has(row.item.id)}
          />
        </View>
      );
    },
    [isExpanded, toggle, onSelectExperience, completedIds, favoritedIds],
  );

  const visual =
    DESTINATION_VISUALS[destination.title as DestinationId] ??
    DESTINATION_VISUALS[destination.id as DestinationId] ?? {
      id: destination.id,
      icon: '🏰',
      landmark: 'Walt Disney World Resort',
      accent: '#7e57c2',
      gradient: ['#280b45', '#5b2a86', '#7e57c2'] as const,
      watermarkGlyph: 'sparkles' as const,
    };

  return (
    <ScreenContainer>
      {/* 1. Hero Header with themed gradient (Req 3.1) */}
      <GradientHeader
        testID="park-destination-hero-header"
        backTestID="park-destination-back-btn"
        colors={visual.gradient}
        iconText={visual.icon}
        title={destination.title}
        subtitle={`${experiences.length} Active Experiences`}
        compact
        onBack={() => navigation?.goBack?.()}
        backAccessibilityLabel="Back to Explore"
      />

      {/* Stale Cache Banner */}
      {showStaleBanner && (
        <View style={styles.staleBanner} testID="destination-stale-banner">
          <Ionicons
            name="cloud-offline-outline"
            size={16}
            color={theme.color.warningText}
            style={styles.staleBannerIcon}
          />
          <Text style={styles.staleBannerText}>Showing cached catalog</Text>
        </View>
      )}

      {/* In-Destination Search Control */}
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
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder="Search by name, land, or facet..."
            placeholderTextColor={theme.color.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search by name, land, or facet"
            testID="destination-search"
          />
          {searchInput.length > 0 && (
            <Ionicons
              name="close-circle"
              size={18}
              color={theme.color.textSecondary}
              style={styles.searchClear}
              onPress={() => setSearchInput('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="destination-search-clear"
            />
          )}
        </View>
      </View>

      {/* Flat search results if search is active */}
      {showLoading ? (
        <View style={styles.center} testID="destination-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : searchActive ? (
        <DestinationSearchResults
          experiences={experiences}
          query={trimmedQuery}
          onSelectExperience={onSelectExperience}
          completedIds={completedIds}
          favoritedIds={favoritedIds}
        />
      ) : (
        <View style={styles.tabLayoutContainer}>
          {/* 2. Category Tabs & Favorites Toggle (Req 3.2, 3.3) */}
          <View style={styles.tabBarWrap}>
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
                style={[
                  styles.tabBtn,
                  activeTab === 'shows' && styles.tabBtnActive,
                ]}
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

            {/* Adjacent Favorites quick toggle pill (Req 3.3) */}
            <Pressable
              style={[
                styles.favoritesToggleBtn,
                favoritesOnly && styles.favoritesToggleBtnActive,
              ]}
              onPress={() => setFavoritesOnly((prev) => !prev)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: favoritesOnly }}
              accessibilityLabel={`Favorites only${
                favoritesOnly ? ', selected' : ''
              }`}
              testID="destination-favorites-toggle"
            >
              <Ionicons
                name={favoritesOnly ? 'heart' : 'heart-outline'}
                size={14}
                color={favoritesOnly ? '#FF2D55' : theme.color.textSecondary}
              />
              <Text
                style={[
                  styles.favoritesToggleText,
                  favoritesOnly && styles.favoritesToggleTextActive,
                ]}
              >
                Favorites
              </Text>
            </Pressable>
          </View>

          {/* 3. Sub-Filters / Quick Chips Bar (Req 3.5) */}
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
                      activeFilterCount > 0
                        ? '#FFFFFF'
                        : theme.color.textSecondary
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
                  const isSelected =
                    chip.kind === 'festival'
                      ? selectedFestivals.has(chip.rawValue)
                      : selectedTags.has(chip.rawValue);
                  return (
                    <Pressable
                      key={chip.id}
                      style={[
                        styles.filterChip,
                        isSelected && styles.filterChipActive,
                      ]}
                      onPress={() =>
                        chip.kind === 'festival'
                          ? toggleFestivalFilter(chip.rawValue)
                          : toggleTagFilter(chip.rawValue)
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: isSelected }}
                      accessibilityLabel={`${chip.label}, quick ${chip.kind} filter${
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

          {/* 4. Filters Bottom Sheet Modal (Req 3.4, 7.6) */}
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
                  {/* Festivals Section */}
                  {festivalChips.length > 0 && (
                    <View
                      style={styles.modalSection}
                      testID="destination-modal-festivals-section"
                    >
                      <Text style={styles.modalSectionTitle}>
                        FESTIVALS{' '}
                        {selectedFestivals.size > 0
                          ? `(${selectedFestivals.size})`
                          : ''}
                      </Text>
                      <View style={styles.chipGrid}>
                        {festivalChips.map((chip) => {
                          const isSelected = selectedFestivals.has(chip.rawValue);
                          return (
                            <Pressable
                              key={`modal-${chip.id}`}
                              style={[
                                styles.modalChip,
                                isSelected && styles.modalChipActive,
                              ]}
                              onPress={() => toggleFestivalFilter(chip.rawValue)}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: isSelected }}
                              accessibilityLabel={`${chip.label}, festival filter${
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

                  {/* Height Requirement Section (Req 3.4, 7.6) */}
                  {heightChips.length > 0 && (
                    <View
                      style={styles.modalSection}
                      testID="destination-modal-height-section"
                    >
                      <Text style={styles.modalSectionTitle}>
                        HEIGHT REQUIREMENT{' '}
                        {selectedTags.size > 0
                          ? `(${
                              Array.from(selectedTags).filter((t) =>
                                heightChips.some((h) => h.rawValue === t),
                              ).length
                            })`
                          : ''}
                      </Text>
                      <View style={styles.chipGrid}>
                        {heightChips.map((chip) => {
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
                              accessibilityLabel={`${chip.rawValue}, height filter${
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

                  {/* Physical Considerations Section (Req 3.4, 7.6) */}
                  {physicalChips.length > 0 && (
                    <View
                      style={styles.modalSection}
                      testID="destination-modal-physical-section"
                    >
                      <Text style={styles.modalSectionTitle}>
                        PHYSICAL CONSIDERATIONS & ADVISORIES{' '}
                        {selectedTags.size > 0
                          ? `(${
                              Array.from(selectedTags).filter((t) =>
                                physicalChips.some((p) => p.rawValue === t),
                              ).length
                            })`
                          : ''}
                      </Text>
                      <View style={styles.chipGrid}>
                        {physicalChips.map((chip) => {
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
                              accessibilityLabel={`${chip.rawValue}, physical consideration filter${
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

                  {/* Attributes & Dining Section */}
                  {otherAttributeChips.length > 0 && (
                    <View
                      style={styles.modalSection}
                      testID="destination-modal-attributes-section"
                    >
                      <Text style={styles.modalSectionTitle}>
                        ATTRIBUTES & DINING{' '}
                        {selectedTags.size > 0
                          ? `(${
                              Array.from(selectedTags).filter((t) =>
                                otherAttributeChips.some((a) => a.rawValue === t),
                              ).length
                            })`
                          : ''}
                      </Text>
                      <View style={styles.chipGrid}>
                        {otherAttributeChips.map((chip) => {
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
                              accessibilityLabel={`${chip.rawValue}, attribute filter${
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

          {/* 5. Content List or Empty State (Req 3.6) */}
          {filteredResults.length === 0 ? (
            <View style={styles.center} testID="destination-filter-empty">
              <EmptyState
                icon={favoritesOnly ? 'heart-outline' : 'search-outline'}
                title={
                  favoritesOnly
                    ? 'No favorited experiences'
                    : 'No experiences matched'
                }
                body={
                  favoritesOnly
                    ? 'No favorited experiences were found in this destination.'
                    : 'Try resetting your active filters.'
                }
                {...(favoritesOnly ? { testID: 'destination-favorites-empty' } : {})}
              />
              <Pressable
                style={styles.resetFilterEmptyBtn}
                onPress={() => {
                  clearAllFilters();
                  setFavoritesOnly(false);
                }}
                accessibilityRole="button"
                accessibilityLabel="Reset active filters"
                testID="destination-filter-empty-reset"
              >
                <Text style={styles.resetFilterEmptyBtnText}>Reset Filters</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              data={flatRows}
              keyExtractor={(row) => row.key}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={11}
              removeClippedSubviews
              getItemLayout={getItemLayout}
              renderItem={renderRow}
            />
          )}
        </View>
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function CollapsibleHeaderRow({
  sectionKey,
  expanded,
  onToggle,
  accessibilityLabel,
  header,
  testID,
}: {
  readonly sectionKey: string;
  readonly expanded: boolean;
  readonly onToggle: (key: string) => void;
  readonly accessibilityLabel: string;
  readonly header: React.ReactNode;
  readonly testID?: string;
}): JSX.Element {
  const handlePress = () => onToggle(sectionKey);
  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={accessibilityLabel}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={accessibilityLabel}
        testID={testID ? `${testID}-header` : undefined}
        style={styles.headerRowPressable}
      >
        {header}
      </Pressable>
    </Pressable>
  );
}

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
      <View style={styles.sectionCountBadge}>
        <Text style={styles.sectionCountText}>{count}</Text>
      </View>
    </View>
  );
}

interface ExperienceRowProps {
  readonly experience: ExperienceDTO;
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completed?: boolean;
  readonly favorited?: boolean;
}

export const ExperienceRow = React.memo(function ExperienceRow({
  experience,
  onSelectExperience,
  completed = false,
  favorited = false,
}: ExperienceRowProps): JSX.Element {
  const onPress = useCallback(
    () => onSelectExperience(experience),
    [onSelectExperience, experience],
  );
  const visual = theme.categoryVisual[experience.category] ?? {
    label: experience.category,
    tint: theme.color.primary,
    glyph: 'compass-outline',
  };

  const accent =
    experience.park !== null && experience.park !== undefined
      ? theme.parkAccent[experience.park] ?? theme.color.primary
      : theme.color.primary;

  const showPriceTag =
    experience.category === 'Restaurant' &&
    typeof experience.priceTier === 'string' &&
    experience.priceTier.trim().length > 0;
  const priceTag = showPriceTag
    ? priceTierListTag((experience.priceTier as string).trim())
    : null;

  const browseLand = browseLandOf(experience);
  const resortArea = resortAreaLabel(experience);
  const locationText = browseLand ?? resortArea;
  const isResortAreaOnly = browseLand === null && resortArea !== null;
  const locationTestId = isResortAreaOnly
    ? `destination-resort-area-${experience.id}`
    : `destination-location-${experience.id}`;

  const heightText =
    experience.heightRequirement &&
    typeof experience.heightRequirement.name === 'string' &&
    experience.heightRequirement.name.trim().length > 0
      ? experience.heightRequirement.name.trim()
      : null;

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
          {completed && (
            <VisitedOverlay testID={`destination-visited-${experience.id}`} />
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={2}>
            {experience.name}
          </Text>
          {locationText !== null && (
            <View style={styles.rowMetaLine} testID={locationTestId}>
              <Ionicons
                name="location"
                size={12}
                color={theme.color.textSecondary}
                style={styles.rowMetaIcon}
              />
              <Text style={styles.rowMeta} numberOfLines={1}>
                {locationText}
              </Text>
            </View>
          )}
          <View style={styles.rowBadges}>
            <Badge
              label={visual.label}
              color={visual.tint}
              icon={visual.glyph as keyof typeof Ionicons.glyphMap}
            />
            {priceTag !== null && (
              <Badge
                label={priceTag.label}
                color={theme.color.primary}
                accessibilityLabel={priceTag.accessibilityLabel}
                testID={`destination-price-${experience.id}`}
              />
            )}
            {/* Height Requirement Badge (Req 3.7) */}
            {heightText !== null && (
              <Badge
                label={`📏 ${heightText}`}
                color="#B91C1C"
                accessibilityLabel={`Height requirement: ${heightText}`}
                testID={`destination-height-${experience.id}`}
              />
            )}
          </View>
        </View>
        <View style={styles.rowActions}>
          <FavoriteToggle
            experienceId={experience.id}
            favorited={favorited}
            size="small"
          />
          <Ionicons
            name="chevron-forward"
            size={20}
            color={theme.color.textSecondary}
          />
        </View>
      </View>
    </Card>
  );
});

const ExperienceThumb = React.memo(function ExperienceThumb({
  imageUrl,
  category,
}: {
  readonly imageUrl: string | null;
  readonly category: ExperienceCategory;
}): JSX.Element {
  const [failed, setFailed] = useState(false);
  const visual = theme.categoryVisual[category] ?? {
    tint: theme.color.primary,
    glyph: 'compass-outline',
  };

  if (imageUrl !== null && imageUrl.length > 0 && !failed) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={styles.thumb}
        contentFit="cover"
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View
      style={[
        styles.thumb,
        styles.thumbPlaceholder,
        { backgroundColor: visual.tint },
      ]}
      testID="destination-thumb-placeholder"
    >
      <Ionicons
        name={visual.glyph as keyof typeof Ionicons.glyphMap}
        size={22}
        color={theme.color.textOnPrimary}
      />
    </View>
  );
});

const VisitedOverlay = React.memo(function VisitedOverlay({
  testID,
}: {
  readonly testID: string;
}): JSX.Element {
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
});

function DestinationSearchResults({
  experiences,
  query,
  onSelectExperience,
  completedIds,
  favoritedIds,
}: {
  readonly experiences: readonly ExperienceDTO[];
  readonly query: string;
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
  readonly favoritedIds: ReadonlySet<string>;
}): JSX.Element {
  const results = useMemo(() => {
    return filterAndRankExperiences(experiences, query);
  }, [experiences, query]);

  useResultCountAnnouncement(results.length);

  const renderItem = useCallback(
    ({ item }: { item: ExperienceDTO }) => (
      <ExperienceRow
        experience={item}
        onSelectExperience={onSelectExperience}
        completed={completedIds.has(item.id)}
        favorited={favoritedIds.has(item.id)}
      />
    ),
    [onSelectExperience, completedIds, favoritedIds],
  );

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
      renderItem={renderItem}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  heroHeaderWrap: {
    position: 'relative',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  heroWatermark: {
    position: 'absolute',
    right: -10,
    bottom: -15,
  },
  heroHeaderGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(29, 18, 51, 0.65)',
  },
  headerContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitleWrap: {
    flex: 1,
  },
  heroTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroIconText: {
    fontSize: 18,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  heroSubtitle: {
    color: '#E5DEF5',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.warningSurface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  staleBannerIcon: {
    marginRight: 2,
  },
  staleBannerText: {
    color: theme.color.warningText,
    fontSize: 12,
    fontWeight: '600',
  },
  controls: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: theme.color.background,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(91, 42, 134, 0.08)',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: theme.color.textPrimary,
    fontSize: 14,
  },
  searchClear: {
    marginLeft: 8,
  },
  tabLayoutContainer: {
    flex: 1,
  },
  tabBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  tabBar: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#F1EDFB',
    borderRadius: 10,
    padding: 3,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  tabTextActive: {
    color: theme.color.primary,
    fontWeight: '800',
  },
  favoritesToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F1EDFB',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  favoritesToggleBtnActive: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FECDD3',
  },
  favoritesToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  favoritesToggleTextActive: {
    color: '#E11D48',
    fontWeight: '800',
  },
  filterBarWrap: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(91, 42, 134, 0.06)',
  },
  filterBarScroll: {
    paddingHorizontal: 16,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#F3E8FF',
    borderColor: '#A855F7',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },
  filterChipTextActive: {
    color: '#7E22CE',
    fontWeight: '800',
  },
  filterModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1EDFB',
    borderColor: '#D8B4FE',
  },
  filterModalBtnActive: {
    backgroundColor: theme.color.primary,
    borderColor: theme.color.primary,
  },
  filterModalBtnText: {
    color: theme.color.primary,
  },
  resetChip: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
  },
  resetChipText: {
    color: '#B91C1C',
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 10, 28, 0.5)',
    justifyContent: 'flex-end',
  },
  modalBackdropDismiss: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '82%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(91, 42, 134, 0.08)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.color.textPrimary,
  },
  modalHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalClearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  modalClearText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.primary,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalScroll: {
    paddingHorizontal: 20,
  },
  modalScrollContent: {
    paddingVertical: 14,
    gap: 18,
  },
  modalSection: {
    gap: 8,
  },
  modalSectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: theme.color.textSecondary,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  modalChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modalChipActive: {
    backgroundColor: '#F3E8FF',
    borderColor: theme.color.primary,
  },
  modalChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  modalChipTextActive: {
    color: theme.color.primary,
    fontWeight: '800',
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(91, 42, 134, 0.08)',
  },
  modalApplyBtn: {
    backgroundColor: theme.color.primary,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalApplyBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 24,
  },
  headerRowPressable: {
    backgroundColor: theme.color.background,
  },
  sectionHeader: {
    height: SECTION_HEADER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 6,
    backgroundColor: theme.color.background,
  },
  sectionChevron: {
    marginRight: 2,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: theme.color.textPrimary,
    flex: 1,
  },
  sectionCountBadge: {
    backgroundColor: '#F1EDFB',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sectionCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.color.textSecondary,
  },
  itemRowWrap: {
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  row: {
    borderRadius: 14,
    padding: 10,
    backgroundColor: theme.color.surface,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  thumbWrap: {
    width: 60,
    height: 60,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  visitedOverlay: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 13.5,
    fontWeight: '800',
    color: theme.color.textPrimary,
    lineHeight: 18,
  },
  rowMetaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  rowMetaIcon: {
    marginRight: 1,
  },
  rowMeta: {
    fontSize: 11,
    color: theme.color.textSecondary,
  },
  rowBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  resetFilterEmptyBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#F1EDFB',
    borderRadius: 8,
  },
  resetFilterEmptyBtnText: {
    color: theme.color.primary,
    fontWeight: '700',
    fontSize: 12,
  },
});
