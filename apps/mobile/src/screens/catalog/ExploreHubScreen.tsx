/**
 * ExploreHubScreen — Level 1 Root Screen for the Explore tab.
 *
 * Implements Tasks 6.1, 6.2, 6.3, 6.4 (Requirements 1.1–1.8, 7.1, 7.3, 8.1).
 * Replaces CatalogScreen.tsx (route `CatalogList`).
 *
 * Key components:
 * 1. Top hero gradient header with "Explore", operating subtitle, NotificationBell,
 *    and You & Crew shortcut (Req 1.1).
 * 2. Global debounced search input querying `/catalog?q=` (Req 1.2, 7.3).
 * 3. 3-column Utility Dock: Live Waits, Crowds, and Favorites (Req 1.3).
 * 4. 2x2 Theme Parks Landmark Grid with live wait pulses and experience counts (Req 1.4, 1.5).
 * 5. Full-width Resorts Spotlight Card navigating to ResortsDirectoryScreen (Req 1.8, 8.1).
 * 6. Full-width Disney Springs Showcase Banner with high-contrast pill badges (Req 1.6).
 * 7. Balanced 2-column Water Parks Grid for Blizzard Beach & Typhoon Lagoon (Req 1.7).
 * 8. Carried-over flat search results, favorites view, stale cache banner,
 *    and catalog_unavailable error handling (Req 7.3).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';

import {
  THEME_PARKS_EXPLORE_GRID,
  type ExperienceCategory,
  type ExperienceDTO,
  type ParkLiveSnapshotDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';
import { destinationCardLabel, type DestinationId } from './destinations';
import { priceTierListTag, resortAreaLabel } from './infoTags';
import { browseLandOf } from './catalogGrouping';
import { useResultCountAnnouncement } from './catalogFocus';
import { useCompletedExperiences } from './useCompletedExperiences';
import { useFavoritedExperiences } from './useFavoritedExperiences';
import FavoriteToggle from './FavoriteToggle';
import AvatarChip from '../navigation/AvatarChip';
import NotificationBell from '../../features/notifications/NotificationBell';
import { calculateParkWaitAverage } from '../home/pulseCalculations';
import { DESTINATION_VISUALS } from './destinationVisuals';

// ---------------------------------------------------------------------------
// Constants & Asset Metadata
// ---------------------------------------------------------------------------

const STALE_TIME_MS = 5 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 300;

export const DISNEY_SPRINGS_ASSET = {
  icon: '🛍️',
  title: 'Disney Springs',
  subtitle: 'Waterfront Dining, Shopping & Entertainment',
};

export const RESORTS_SPOTLIGHT_ASSET = {
  icon: '🏨',
  title: 'Disney Resorts & Hotels',
  subtitle: '32 On-Property Themed Resorts, Dining & Pools',
  tagline: 'From Deluxe Monorail Resorts to Value Favorites',
};

// ---------------------------------------------------------------------------
// Types & Wire Shapes
// ---------------------------------------------------------------------------

export type ExploreHubScreenProps = {
  readonly navigation?: any;
};

interface DestinationCountEntry {
  readonly destination: DestinationId;
  readonly count: number;
}

interface DestinationsResponse {
  readonly destinations: readonly DestinationCountEntry[];
  readonly staleCache: boolean;
  readonly cacheAgeHours?: number | null;
}

interface CatalogListResponse {
  readonly experiences: readonly ExperienceDTO[];
  readonly staleCache: boolean;
  readonly cacheAgeHours?: number | null;
}

// ---------------------------------------------------------------------------
// Header Actions
// ---------------------------------------------------------------------------

function HeaderActions(): JSX.Element {
  return (
    <View style={styles.headerActions}>
      <NotificationBell tintColor={theme.color.textOnPrimary} />
      <AvatarChip tintColor={theme.color.textOnPrimary} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// API Fetchers
// ---------------------------------------------------------------------------

async function fetchDestinationCounts(): Promise<DestinationsResponse> {
  return apiRequest<DestinationsResponse>('GET', '/catalog/destinations');
}

async function fetchCatalogSearch(q: string): Promise<CatalogListResponse> {
  const params = new URLSearchParams({ q });
  return apiRequest<CatalogListResponse>('GET', `/catalog?${params.toString()}`);
}

async function fetchAllCatalog(): Promise<CatalogListResponse> {
  return apiRequest<CatalogListResponse>('GET', '/catalog');
}

// ---------------------------------------------------------------------------
// Main Component: ExploreHubScreen
// ---------------------------------------------------------------------------

export default function ExploreHubScreen({
  navigation: passedNavigation,
}: ExploreHubScreenProps): JSX.Element {
  const navigation = passedNavigation;

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const trimmedQuery = debouncedSearch.trim();
  const searchActive = trimmedQuery.length > 0;

  // Destination counts query (Req 1.5, 1.6, 1.7)
  const destinationsQuery = useQuery<DestinationsResponse, ApiError>({
    queryKey: ['catalog', 'destinations'] as const,
    queryFn: fetchDestinationCounts,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  // Global search query (Req 1.2, 7.3)
  const searchQuery = useQuery<CatalogListResponse, ApiError>({
    queryKey: ['catalog', 'search', trimmedQuery] as const,
    queryFn: () => fetchCatalogSearch(trimmedQuery),
    enabled: searchActive,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  // In-screen favorites view state (Req 1.3)
  const [favoritesViewActive, setFavoritesViewActive] = useState(false);

  // All catalog query for favorites view
  const allCatalogQuery = useQuery<CatalogListResponse, ApiError>({
    queryKey: ['catalog', 'all'] as const,
    queryFn: fetchAllCatalog,
    enabled: favoritesViewActive,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  const { refetch: refetchDestinations } = destinationsQuery;
  const { refetch: refetchSearch } = searchQuery;
  const { refetch: refetchAllCatalog } = allCatalogQuery;

  useFocusEffect(
    useCallback(() => {
      void refetchDestinations();
      if (searchActive) {
        void refetchSearch();
      }
      if (favoritesViewActive) {
        void refetchAllCatalog();
      }
    }, [refetchDestinations, refetchSearch, refetchAllCatalog, searchActive, favoritesViewActive]),
  );

  const countById = useMemo<ReadonlyMap<DestinationId, number>>(() => {
    const map = new Map<DestinationId, number>();
    for (const entry of destinationsQuery.data?.destinations ?? []) {
      map.set(entry.destination, entry.count);
    }
    return map;
  }, [destinationsQuery.data?.destinations]);

  const searchResultCount = searchActive
    ? searchQuery.data?.experiences.length ?? 0
    : 0;
  useResultCountAnnouncement(searchResultCount, searchActive);

  const completedIds = useCompletedExperiences();
  const favoritedIds = useFavoritedExperiences();

  const onSelectExperience = useCallback(
    (experience: ExperienceDTO): void => {
      navigation?.navigate('ExperienceDetail', { experienceId: experience.id });
    },
    [navigation],
  );

  const onNavigatePark = useCallback(
    (park: DestinationId) => {
      navigation?.navigate('DestinationScreen', { destination: park });
    },
    [navigation],
  );

  const onNavigateLiveWaits = useCallback(() => {
    navigation?.navigate('LiveWaits');
  }, [navigation]);

  const onNavigateCrowdCalendar = useCallback(() => {
    navigation?.navigate('CrowdCalendar');
  }, [navigation]);

  const onNavigateResortsDirectory = useCallback(() => {
    navigation?.navigate('ResortsDirectory');
  }, [navigation]);

  // Full-screen catalog_unavailable error state (Req 7.3)
  if (
    !searchActive &&
    destinationsQuery.isError &&
    destinationsQuery.data === undefined
  ) {
    if (
      destinationsQuery.error instanceof ApiError &&
      destinationsQuery.error.code === 'catalog_unavailable'
    ) {
      return <CatalogUnavailableState />;
    }
    return (
      <GenericErrorState
        message={
          destinationsQuery.error?.message ?? 'Catalog couldn\u2019t be loaded.'
        }
      />
    );
  }

  const showStaleBanner =
    !searchActive && destinationsQuery.data?.staleCache === true;

  return (
    <ScreenContainer testID="explore-hub-screen">
      {/* 1. Header with Gradient, Search, and Profile Controls (Req 1.1) */}
      <GradientHeader
        title="Explore"
        subtitle="Where would you like to explore?"
        icon="compass"
        compact
        right={<HeaderActions />}
      />

      {/* 2. Global Search Input Field (Req 1.2, 7.3) */}
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
            placeholder="Search experiences, lands, or facets..."
            placeholderTextColor={theme.color.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search experiences"
            testID="catalog-search"
          />
          {searchInput.length > 0 ? (
            <Ionicons
              name="close-circle"
              size={18}
              color={theme.color.textSecondary}
              style={styles.searchClear}
              onPress={() => {
                setSearchInput('');
                setDebouncedSearch('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="catalog-search-clear"
            />
          ) : null}
        </View>
      </View>

      {/* Stale Cache Banner (Req 7.3) */}
      {showStaleBanner ? (
        <View style={styles.staleBanner} testID="catalog-stale-banner">
          <Ionicons
            name="cloud-offline-outline"
            size={16}
            color={theme.color.warningText}
            style={styles.staleBannerIcon}
          />
          <Text style={styles.staleBannerText}>Showing cached catalog</Text>
        </View>
      ) : null}

      {/* Render conditional views: Search Results vs Favorites vs Explore Hub Body */}
      {searchActive ? (
        <SearchResultsBody
          query={searchQuery}
          onSelectExperience={onSelectExperience}
          completedIds={completedIds}
          favoritedIds={favoritedIds}
        />
      ) : favoritesViewActive ? (
        <FavoritesBody
          allCatalogQuery={allCatalogQuery}
          onSelectExperience={onSelectExperience}
          completedIds={completedIds}
          favoritedIds={favoritedIds}
          onBack={() => setFavoritesViewActive(false)}
        />
      ) : (
        <ScrollView
          style={styles.hubScroll}
          contentContainerStyle={styles.hubContent}
          testID="explore-hub-content"
          keyboardShouldPersistTaps="handled"
        >
          {/* 3. 3-Column Utility Dock (Req 1.3) */}
          <View style={styles.utilityDock} testID="explore-utility-dock">
            <Pressable
              style={styles.dockTile}
              onPress={onNavigateLiveWaits}
              accessibilityRole="button"
              accessibilityLabel="Live Waits, real-time wait times"
              testID="utility-dock-waits"
            >
              <View style={[styles.dockIconCircle, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="time" size={20} color="#0284C7" />
              </View>
              <Text style={styles.dockTileTitle}>Live Waits</Text>
              <Text style={styles.dockTileSub}>Line times</Text>
            </Pressable>

            <Pressable
              style={styles.dockTile}
              onPress={onNavigateCrowdCalendar}
              accessibilityRole="button"
              accessibilityLabel="Crowds, day-by-day crowd projections"
              testID="utility-dock-crowds"
            >
              <View style={[styles.dockIconCircle, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="bar-chart" size={20} color="#D97706" />
              </View>
              <Text style={styles.dockTileTitle}>Crowds</Text>
              <Text style={styles.dockTileSub}>Calendar</Text>
            </Pressable>

            <Pressable
              style={styles.dockTile}
              onPress={() => setFavoritesViewActive(true)}
              accessibilityRole="button"
              accessibilityLabel="Favorites, your saved rides and dining"
              testID="utility-dock-favorites"
            >
              <View style={[styles.dockIconCircle, { backgroundColor: '#FFE4E6' }]}>
                <Ionicons name="heart" size={20} color="#E11D48" />
              </View>
              <Text style={styles.dockTileTitle}>Favorites</Text>
              <Text style={styles.dockTileSub}>Saved</Text>
            </Pressable>
          </View>

          {/* 4. 2x2 Theme Parks Landmark Grid (Req 1.4, 1.5) */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>THEME PARKS</Text>
            <Text style={styles.sectionSub}>Explore rides, dining & shows</Text>
          </View>

          <View style={styles.themeParksGrid} testID="explore-theme-parks-grid">
            {THEME_PARKS_EXPLORE_GRID.map((item) => (
              <ThemeParkGridTile
                key={item.park}
                park={item.park as DestinationId}
                count={countById.get(item.park as DestinationId) ?? 0}
                onPress={() => onNavigatePark(item.park as DestinationId)}
              />
            ))}
          </View>

          {/* 5. Full-Width Resorts Spotlight Card (Req 1.8, 8.1) */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>RESORT HOTELS</Text>
            <Text style={styles.sectionSub}>32 on-property hotels, dining & pools</Text>
          </View>

          <Pressable
            style={styles.resortsSpotlightCard}
            onPress={onNavigateResortsDirectory}
            accessibilityRole="button"
            accessibilityLabel={destinationCardLabel('Resorts', countById.get('Resorts') ?? 0)}
            testID="explore-resorts-spotlight-card"
          >
            <LinearGradient
              colors={DESTINATION_VISUALS.Resorts.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Ionicons
              name={DESTINATION_VISUALS.Resorts.watermarkGlyph}
              size={110}
              color="rgba(255, 255, 255, 0.08)"
              style={styles.resortsWatermark}
            />
            <View style={styles.resortsSpotlightContent}>
              <View style={styles.resortsSpotlightTopRow}>
                <View style={styles.resortsIconBadge}>
                  <Text style={styles.resortsIconText}>
                    {RESORTS_SPOTLIGHT_ASSET.icon}
                  </Text>
                </View>
                <View style={styles.resortsPill}>
                  <Text style={styles.resortsPillText}>32 Properties</Text>
                </View>
              </View>
              <View style={styles.resortsSpotlightBottom}>
                <Text style={styles.resortsSpotlightTitle}>
                  {RESORTS_SPOTLIGHT_ASSET.title}
                </Text>
                <Text style={styles.resortsSpotlightSub}>
                  {RESORTS_SPOTLIGHT_ASSET.subtitle}
                </Text>
                <View style={styles.resortsSpotlightCtaRow}>
                  <Text style={styles.resortsSpotlightCta}>
                    Explore Directory ›
                  </Text>
                </View>
              </View>
            </View>
          </Pressable>

          {/* 6. Disney Springs Showcase Card (Req 1.6) */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>SHOPPING & ENTERTAINMENT</Text>
            <Text style={styles.sectionSub}>Waterfront dining, shopping & nightlife</Text>
          </View>

          <Pressable
            style={styles.showcaseCard}
            onPress={() => onNavigatePark('Disney Springs')}
            accessibilityRole="button"
            accessibilityLabel={destinationCardLabel('Disney Springs', countById.get('Disney Springs') ?? 0)}
            testID="explore-disney-springs-card"
          >
            <LinearGradient
              colors={DESTINATION_VISUALS['Disney Springs'].gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Ionicons
              name={DESTINATION_VISUALS['Disney Springs'].watermarkGlyph}
              size={110}
              color="rgba(255, 255, 255, 0.08)"
              style={styles.showcaseWatermark}
            />
            <View style={styles.showcaseContent}>
              <View style={styles.showcaseTopRow}>
                <View style={styles.showcaseIconBadge}>
                  <Text style={styles.showcaseIconText}>
                    {DISNEY_SPRINGS_ASSET.icon}
                  </Text>
                </View>
                <View style={styles.showcaseBadgeWrap}>
                  <View style={styles.showcaseVenuePill}>
                    <Text style={styles.showcaseVenuePillText}>
                      {`${countById.get('Disney Springs') ?? 0} Venues`}
                    </Text>
                  </View>
                  <View style={[styles.showcaseVenuePill, styles.freeAdmissionPill]}>
                    <Text style={styles.freeAdmissionPillText}>Free Admission</Text>
                  </View>
                </View>
              </View>
              <View style={styles.showcaseBottomRow}>
                <Text style={styles.showcaseTitle}>
                  {DISNEY_SPRINGS_ASSET.title}
                </Text>
                <Text style={styles.showcaseSub}>
                  {DISNEY_SPRINGS_ASSET.subtitle}
                </Text>
              </View>
            </View>
          </Pressable>

          {/* 7. Balanced 2-Column Water Parks Grid (Req 1.7) */}
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>WATER PARKS</Text>
            <Text style={styles.sectionSub}>Thrills, slides & relaxation</Text>
          </View>

          <View style={styles.waterParksGrid} testID="explore-water-parks-grid">
            <WaterParkGridTile
              park="Blizzard Beach"
              title="Disney's Blizzard Beach"
              count={countById.get('Blizzard Beach') ?? 0}
              onPress={() => onNavigatePark('Blizzard Beach')}
            />
            <WaterParkGridTile
              park="Typhoon Lagoon"
              title="Disney's Typhoon Lagoon"
              count={countById.get('Typhoon Lagoon') ?? 0}
              onPress={() => onNavigatePark('Typhoon Lagoon')}
            />
          </View>
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: Theme Park Grid Tile (Req 1.4, 1.5)
// ---------------------------------------------------------------------------

function ThemeParkGridTile({
  park,
  count,
  onPress,
}: {
  readonly park: DestinationId;
  readonly count: number;
  readonly onPress: () => void;
}): JSX.Element {
  const visual = DESTINATION_VISUALS[park] ?? {
    id: park,
    icon: '🏰',
    landmark: park,
    accent: '#7e57c2',
    gradient: ['#280b45', '#5b2a86', '#7e57c2'] as const,
    watermarkGlyph: 'sparkles' as const,
  };

  const liveWaitQuery = useQuery<ParkLiveSnapshotDTO>({
    queryKey: ['park-live', park],
    queryFn: () =>
      apiRequest<ParkLiveSnapshotDTO>(
        'GET',
        `/parks/${encodeURIComponent(park)}/live`,
      ),
    staleTime: 60 * 1000,
    retry: false,
  });

  const avgWait = useMemo(() => {
    if (!liveWaitQuery.data?.entries) return null;
    return calculateParkWaitAverage(liveWaitQuery.data.entries);
  }, [liveWaitQuery.data]);

  return (
    <Pressable
      style={styles.parkGridTile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={destinationCardLabel(park, count)}
      testID={`explore-park-card-${park}`}
    >
      <LinearGradient
        colors={visual.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Ionicons
        name={visual.watermarkGlyph}
        size={84}
        color="rgba(255, 255, 255, 0.08)"
        style={styles.parkWatermark}
      />

      <View style={styles.parkTileContent}>
        <View style={styles.parkTileTopRow}>
          <View style={styles.parkTileIconBadge}>
            <Text style={styles.parkTileIconText}>{visual.icon}</Text>
          </View>
          {avgWait !== null && (
            <View
              style={styles.parkWaitPulseBadge}
              testID={`explore-park-wait-pulse-${park}`}
            >
              <Ionicons name="flash" size={11} color="#F6C343" />
              <Text style={styles.parkWaitPulseText}>{avgWait}m avg</Text>
            </View>
          )}
        </View>

        <View style={styles.parkTileBottom}>
          <Text style={styles.parkTileTitle} numberOfLines={1}>
            {park}
          </Text>
          <View style={styles.parkTileBadgeRow}>
            <Text style={styles.parkTileCountText}>
              {count} {count === 1 ? 'experience' : 'experiences'}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Subcomponent: Water Park Grid Tile (Req 1.7)
// ---------------------------------------------------------------------------

function WaterParkGridTile({
  park,
  title,
  count,
  onPress,
}: {
  readonly park: DestinationId;
  readonly title: string;
  readonly count: number;
  readonly onPress: () => void;
}): JSX.Element {
  const visual = DESTINATION_VISUALS[park] ?? {
    id: park,
    icon: '🏄‍♂️',
    landmark: park,
    accent: '#17a2b8',
    gradient: ['#052930', '#00838f', '#17a2b8'] as const,
    watermarkGlyph: 'water' as const,
  };

  return (
    <Pressable
      style={styles.waterParkTile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${count} experiences`}
      testID={`explore-water-park-${park}`}
    >
      <LinearGradient
        colors={visual.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Ionicons
        name={visual.watermarkGlyph}
        size={76}
        color="rgba(255, 255, 255, 0.08)"
        style={styles.waterParkWatermark}
      />

      <View style={styles.parkTileContent}>
        <View style={styles.parkTileTopRow}>
          <View style={styles.parkTileIconBadge}>
            <Text style={styles.parkTileIconText}>{visual.icon}</Text>
          </View>
        </View>

        <View style={styles.parkTileBottom}>
          <Text style={styles.waterParkTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.parkTileCountText}>{count} experiences</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Search Results Body (Ported from CatalogScreen.tsx - Req 7.3)
// ---------------------------------------------------------------------------

function SearchResultsBody({
  query,
  onSelectExperience,
  completedIds,
  favoritedIds,
}: {
  readonly query: {
    readonly isLoading: boolean;
    readonly isError: boolean;
    readonly error: ApiError | null;
    readonly data: CatalogListResponse | undefined;
  };
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
  readonly favoritedIds: ReadonlySet<string>;
}): JSX.Element {
  const results = query.data?.experiences ?? [];

  const renderSearchResult = useCallback(
    ({ item }: { item: ExperienceDTO }) => (
      <SearchResultRow
        experience={item}
        onSelectExperience={onSelectExperience}
        completed={completedIds.has(item.id)}
        favorited={favoritedIds.has(item.id)}
      />
    ),
    [onSelectExperience, completedIds, favoritedIds],
  );

  if (query.isError && query.data === undefined) {
    return (
      <View style={styles.center} testID="catalog-search-error">
        <EmptyState
          icon="alert-circle-outline"
          title="Search couldn't be completed"
          body={query.error?.message ?? 'Please try again.'}
        />
      </View>
    );
  }

  const showLoading = query.isLoading && query.data === undefined;
  if (showLoading) {
    return (
      <View style={styles.center} testID="catalog-search-loading">
        <ActivityIndicator color={theme.color.primary} />
      </View>
    );
  }

  if (results.length === 0) {
    return (
      <View style={styles.center} testID="catalog-search-empty">
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
      initialNumToRender={12}
      maxToRenderPerBatch={12}
      windowSize={11}
      removeClippedSubviews
      contentContainerStyle={styles.listContent}
      testID="catalog-search-results"
      renderItem={renderSearchResult}
    />
  );
}

// ---------------------------------------------------------------------------
// Search Result Row (Ported from CatalogScreen.tsx - Req 7.3)
// ---------------------------------------------------------------------------

interface SearchResultRowProps {
  readonly experience: ExperienceDTO;
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completed?: boolean;
  readonly favorited?: boolean;
}

const SearchResultRow = React.memo(function SearchResultRow({
  experience,
  onSelectExperience,
  completed = false,
  favorited = false,
}: SearchResultRowProps): JSX.Element {
  const onPress = useCallback(
    () => onSelectExperience(experience),
    [onSelectExperience, experience],
  );
  const visual = theme.categoryVisual[experience.category];
  const accent =
    experience.park !== null
      ? theme.parkAccent[experience.park]
      : theme.color.primary;

  const destinationLabel =
    experience.park ?? (experience.areaType === 'Resort' ? 'Resort' : 'Walt Disney World');
  const land = browseLandOf(experience);
  const detail = land ?? resortAreaLabel(experience);

  const showPriceTag =
    experience.category === 'Restaurant' &&
    typeof experience.priceTier === 'string' &&
    experience.priceTier.trim().length > 0;
  const priceTag = showPriceTag
    ? priceTierListTag((experience.priceTier as string).trim())
    : null;

  return (
    <Card
      onPress={onPress}
      accentColor={accent}
      style={styles.row}
      testID={`catalog-search-row-${experience.id}`}
    >
      <View style={styles.rowInner}>
        <View style={styles.thumbWrap}>
          <ExperienceThumb
            imageUrl={experience.imageUrl ?? null}
            category={experience.category}
          />
          {completed ? (
            <VisitedOverlay testID={`catalog-search-visited-${experience.id}`} />
          ) : null}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={2}>
            {experience.name}
          </Text>
          <Text
            style={styles.rowMeta}
            numberOfLines={1}
            testID={`catalog-search-meta-${experience.id}`}
          >
            {detail !== null ? `${destinationLabel} · ${detail}` : destinationLabel}
          </Text>
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
                testID={`catalog-search-price-${experience.id}`}
              />
            ) : null}
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
  const visual = theme.categoryVisual[category];

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
      style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: visual.tint }]}
      testID="catalog-search-thumb-placeholder"
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

// ---------------------------------------------------------------------------
// In-Screen Favorites View Body (Ported from CatalogScreen.tsx - Req 1.3, 7.3)
// ---------------------------------------------------------------------------

function FavoritesBody({
  allCatalogQuery,
  onSelectExperience,
  completedIds,
  favoritedIds,
  onBack,
}: {
  readonly allCatalogQuery: {
    readonly isLoading: boolean;
    readonly isError: boolean;
    readonly error: ApiError | null;
    readonly data: CatalogListResponse | undefined;
  };
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
  readonly favoritedIds: ReadonlySet<string>;
  readonly onBack: () => void;
}): JSX.Element {
  const experiences = allCatalogQuery.data?.experiences ?? [];
  const favoritedExperiences = useMemo(
    () => experiences.filter((exp) => favoritedIds.has(exp.id)),
    [experiences, favoritedIds],
  );

  const renderFavoriteItem = useCallback(
    ({ item }: { item: ExperienceDTO }) => (
      <SearchResultRow
        experience={item}
        onSelectExperience={onSelectExperience}
        completed={completedIds.has(item.id)}
        favorited={favoritedIds.has(item.id)}
      />
    ),
    [onSelectExperience, completedIds, favoritedIds],
  );

  if (allCatalogQuery.isError && allCatalogQuery.data === undefined) {
    return (
      <View style={styles.favoritesContainer} testID="catalog-favorites-view">
        <View style={styles.favoritesHeader}>
          <Pressable
            style={styles.favoritesBackBtn}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back to catalog"
            testID="catalog-favorites-back-button"
          >
            <Ionicons name="arrow-back" size={20} color={theme.color.primary} />
            <Text style={styles.favoritesBackText}>Explore</Text>
          </Pressable>
          <Text style={styles.favoritesHeaderTitle}>My Favorites</Text>
          <View style={styles.favoritesHeaderSpacer} />
        </View>
        <View style={styles.center} testID="catalog-favorites-error">
          <EmptyState
            icon="alert-circle-outline"
            title="Favorites couldn't be loaded"
            body={allCatalogQuery.error?.message ?? 'Please try again.'}
          />
        </View>
      </View>
    );
  }

  const showLoading =
    allCatalogQuery.isLoading && allCatalogQuery.data === undefined;

  return (
    <View style={styles.favoritesContainer} testID="catalog-favorites-view">
      <View style={styles.favoritesHeader}>
        <Pressable
          style={styles.favoritesBackBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to catalog"
          testID="catalog-favorites-back-button"
        >
          <Ionicons name="arrow-back" size={20} color={theme.color.primary} />
          <Text style={styles.favoritesBackText}>Explore</Text>
        </Pressable>
        <Text style={styles.favoritesHeaderTitle}>My Favorites</Text>
        <View style={styles.favoritesHeaderSpacer} />
      </View>

      {showLoading ? (
        <View style={styles.center} testID="catalog-favorites-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : favoritedExperiences.length === 0 ? (
        <View style={styles.center} testID="catalog-favorites-empty">
          <EmptyState
            icon="heart-outline"
            title="No experiences favorited yet"
            body="You have not favorited any experiences yet. Tap the heart on any experience to add it to your favorites."
          />
        </View>
      ) : (
        <FlatList
          data={favoritedExperiences}
          keyExtractor={(experience) => experience.id}
          style={styles.list}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={11}
          removeClippedSubviews
          contentContainerStyle={styles.listContent}
          testID="catalog-favorites-results"
          renderItem={renderFavoriteItem}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Error States (Ported from CatalogScreen.tsx - Req 7.3)
// ---------------------------------------------------------------------------

function CatalogUnavailableState(): JSX.Element {
  return (
    <ScreenContainer>
      <GradientHeader title="Explore" icon="compass" />
      <View style={styles.center} testID="catalog-unavailable">
        <EmptyState
          icon="cloud-offline-outline"
          title="Catalog couldn't be loaded"
          body="Try again later."
        />
      </View>
    </ScreenContainer>
  );
}

function GenericErrorState({ message }: { readonly message: string }): JSX.Element {
  return (
    <ScreenContainer>
      <GradientHeader title="Explore" icon="compass" />
      <View style={styles.center} testID="catalog-error">
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
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  controls: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: theme.color.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: theme.color.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: theme.color.textPrimary,
    fontSize: 15,
  },
  searchClear: {
    padding: 4,
  },
  staleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.warningSurface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  staleBannerIcon: {},
  staleBannerText: {
    color: theme.color.warningText,
    fontSize: 13,
    fontWeight: '500',
  },
  hubScroll: {
    flex: 1,
  },
  hubContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 16,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },

  // Utility Dock (Req 1.3)
  utilityDock: {
    flexDirection: 'row',
    gap: 10,
  },
  dockTile: {
    flex: 1,
    backgroundColor: theme.color.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.color.border,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  dockIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  dockTileTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.color.textPrimary,
    textAlign: 'center',
  },
  dockTileSub: {
    fontSize: 11,
    color: theme.color.textSecondary,
    textAlign: 'center',
    marginTop: 1,
  },

  // Section Headers
  sectionHeaderRow: {
    marginTop: 4,
    marginBottom: -4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: theme.color.textSecondary,
    textTransform: 'uppercase',
  },
  sectionSub: {
    fontSize: 12,
    color: theme.color.textSecondary,
    marginTop: 2,
  },

  // 2x2 Theme Parks Grid (Req 1.4, 1.5)
  themeParksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  parkGridTile: {
    width: '48%',
    height: 140,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1E293B',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  parkTileGradient: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  parkTileContent: {
    flex: 1,
    padding: 10,
    justifyContent: 'space-between',
  },
  parkTileTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  parkTileIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  parkTileIconText: {
    fontSize: 15,
  },
  parkWaitPulseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: 'rgba(246, 195, 67, 0.5)',
  },
  parkWaitPulseText: {
    color: '#F6C343',
    fontSize: 11,
    fontWeight: '700',
  },
  parkTileBottom: {
    gap: 2,
  },
  parkTileTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  parkTileLandmark: {
    fontSize: 11,
    color: '#E2E8F0',
  },
  parkTileBadgeRow: {
    marginTop: 2,
  },
  parkTileCountText: {
    fontSize: 10,
    color: '#CBD5E1',
    fontWeight: '600',
  },

  // Full-Width Disney Springs Showcase Banner (Req 1.6)
  showcaseCard: {
    height: 140,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0F172A',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  showcaseGradient: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  showcaseContent: {
    flex: 1,
    padding: 14,
    justifyContent: 'space-between',
  },
  showcaseTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  showcaseIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  showcaseIconText: {
    fontSize: 18,
  },
  showcaseBadgeWrap: {
    flexDirection: 'row',
    gap: 6,
  },
  showcaseVenuePill: {
    backgroundColor: 'rgba(0, 0, 0, 0.32)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  showcaseVenuePillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  showcaseAdmissionPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  freeAdmissionPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
  },
  freeAdmissionPillText: {
    color: '#D1FAE5',
    fontSize: 11,
    fontWeight: '700',
  },
  showcaseBottomRow: {
    gap: 2,
  },
  showcaseTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  showcaseSub: {
    fontSize: 12,
    color: '#E2E8F0',
  },

  // 2-Column Water Parks Grid (Req 1.7)
  waterParksGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  waterParkTile: {
    flex: 1,
    height: 115,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0F172A',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  waterParkTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Resorts Spotlight Card (Req 1.8, 8.1)
  resortsSpotlightCard: {
    height: 155,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1E1B4B',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  resortsSpotlightGradient: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(30, 27, 75, 0.7)',
  },
  resortsSpotlightContent: {
    flex: 1,
    padding: 14,
    justifyContent: 'space-between',
  },
  resortsSpotlightTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resortsIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resortsIconText: {
    fontSize: 18,
  },
  resortsPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  resortsPillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  resortsSpotlightBottom: {
    gap: 2,
  },
  resortsSpotlightTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  resortsSpotlightSub: {
    fontSize: 12,
    color: '#E2E8F0',
  },
  resortsSpotlightCtaRow: {
    marginTop: 6,
  },
  resortsSpotlightCta: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '700',
  },
  parkWatermark: {
    position: 'absolute',
    right: -10,
    bottom: -15,
  },
  showcaseWatermark: {
    position: 'absolute',
    right: 5,
    bottom: -20,
  },
  waterParkWatermark: {
    position: 'absolute',
    right: -10,
    bottom: -15,
  },
  resortsWatermark: {
    position: 'absolute',
    right: 5,
    bottom: -18,
  },

  // Flat Search / Favorites List
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 12,
  },
  row: {
    padding: 12,
    borderRadius: 12,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  thumbWrap: {
    position: 'relative',
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  thumbPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  visitedOverlay: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#10B981',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.color.surface,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.color.textPrimary,
  },
  rowMeta: {
    fontSize: 12,
    color: theme.color.textSecondary,
  },
  rowBadges: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // Favorites Container
  favoritesContainer: {
    flex: 1,
  },
  favoritesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
    backgroundColor: theme.color.surface,
  },
  favoritesBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  favoritesBackText: {
    color: theme.color.primary,
    fontSize: 15,
    fontWeight: '500',
  },
  favoritesHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.color.textPrimary,
  },
  favoritesHeaderSpacer: {
    width: 60,
  },
});
