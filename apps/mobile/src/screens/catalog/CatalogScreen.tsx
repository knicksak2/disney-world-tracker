/**
 * CatalogScreen — Catalog_Home (Level 1) Destination grid + global search.
 *
 * Implements tasks 9.1 and 9.2 of the catalog-navigation-redesign plan: the top
 * level of the two-level drill-down. The screen presents the eight Destinations
 * as a compact grid of cards so a guest starts browsing from a place that
 * matches their mental model of the parks (R4), and layers an always-visible
 * global search over that grid so locating a specific Experience never requires
 * drilling in (R5).
 *
 * Destination grid (task 9.1):
 *
 *   - **Destination grid (R4.1).** Renders the eight Destination cards in the
 *     canonical `DESTINATIONS` order — four theme parks, then the two water
 *     parks, then Disney Springs, then the aggregate Resorts Destination.
 *
 *   - **Representative image + placeholder (R4.2, R4.3).** Each card shows a
 *     representative image; because no per-Destination image is sourced yet,
 *     every card renders a bundled, themed placeholder (an accent-tinted tile
 *     with a Destination glyph) rather than a blank tile.
 *
 *   - **Active count (R4.4, R4.5, R4.6).** Each card shows the count of active
 *     Experiences for its Destination from `GET /catalog/destinations`; the
 *     Resorts card shows the aggregate `Resort`-area count. A Destination with
 *     no matching count entry renders a count of zero.
 *
 *   - **Loading state (R4.7).** While the count data is first loading with no
 *     prior data, a loading spinner is shown.
 *
 *   - **Tap-to-drill (R4.8).** Tapping a Destination card navigates to
 *     `DestinationScreen` for that Destination.
 *
 *   - **Stale-cache banner (R10.1) & `catalog_unavailable` (R10.2, R10.3).**
 *     A stale-cache response renders the cached counts with a warning banner;
 *     a `catalog_unavailable` error with no prior cache renders the full-screen
 *     unavailable state with no automatic retry.
 *
 * Global search (task 9.2):
 *
 *   - **Always-visible search control (R5.1).** A search `TextInput` sits above
 *     the body at all times (except the grid's full-screen error states, which
 *     are only reached when no search is active), with the search
 *     `accessibilityLabel` identifying it as the search input (R12.4).
 *
 *   - **Debounced, catalog-wide query (R5.2).** The query is debounced ≥300 ms;
 *     once it has at least one non-whitespace character it drives
 *     `GET /catalog?q=...` with no area filter, so it spans every Area_Type
 *     (`ThemePark`, `WaterPark`, `DisneySprings`, `Resort`).
 *
 *   - **Flat result list in place of the grid (R5.3).** While a query is active
 *     the matching Experiences replace the grid as a flat, tappable list; each
 *     row shows the Experience's Destination and, when present, its Land, plus
 *     the Restaurant price tag via `priceTierListTag` (R9.9).
 *
 *   - **Navigate to detail (R5.4, R10.7).** Selecting a result navigates to
 *     `ExperienceDetail` on the root stack.
 *
 *   - **Restore the grid (R5.5).** Clearing the query to no non-whitespace
 *     characters restores the Destination grid.
 *
 *   - **Empty & error states retain the query (R5.6, R5.7).** No matches shows
 *     an empty-results state; a failed search shows a search-error state; both
 *     keep the typed query in the search control.
 *
 *   - **react-query caching (R10.6).** Both the counts and the search reads are
 *     cached through react-query using the existing staleness interval.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2,
 * 5.3, 5.4, 5.5, 5.6, 5.7, 9.9, 10.1, 10.2, 10.3, 10.6, 10.7
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
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

import type { ExperienceCategory, ExperienceDTO } from '@dwt/shared';

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
import {
  DESTINATIONS,
  destinationCardLabel,
  type Destination,
  type DestinationId,
} from './destinations';
import { priceTierListTag, resortAreaLabel } from './infoTags';
import { useCardFocusRestore, useResultCountAnnouncement } from './catalogFocus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * `CatalogScreen` (`CatalogList`) is the Level-1 screen in the Catalog tab's
 * stack, nested inside `MainTabs` on the root-level `RootStack`. Composing the
 * Catalog stack props with the root stack props lets the screen dispatch both
 * `navigation.navigate('DestinationScreen', { destination })` against the
 * Catalog stack and `navigation.navigate('ExperienceDetail', …)` against
 * `RootStack` for a tapped search result (R5.4, R10.7).
 */
type Props = CompositeScreenProps<
  NativeStackScreenProps<CatalogStackParamList, 'CatalogList'>,
  NativeStackScreenProps<RootStackParamList>
>;

/** One `{ destination, count }` entry from `GET /catalog/destinations`. */
interface DestinationCountEntry {
  readonly destination: DestinationId;
  readonly count: number;
}

/**
 * Wire shape for `GET /catalog/destinations`. Mirrors the response in
 * `apps/api/src/services/catalog/routes.ts`; only the fields the screen reads
 * are typed so a future field addition does not require a coordinated change.
 */
interface DestinationsResponse {
  readonly destinations: readonly DestinationCountEntry[];
  readonly staleCache: boolean;
  readonly cacheAgeHours?: number | null;
}

/**
 * Wire shape for `GET /catalog`. Mirrors the response in
 * `apps/api/src/services/catalog/routes.ts`; only the fields the search body
 * reads are typed.
 */
interface CatalogListResponse {
  readonly experiences: readonly ExperienceDTO[];
  readonly staleCache: boolean;
  readonly cacheAgeHours?: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 5 minutes — matches the existing "cache via react-query" staleness rule (R10.6). */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Debounce for the search input (R5.2). The catalog-wide `q` fetch fires no
 * earlier than 300 ms after the most recent keystroke; the cleanup cancels a
 * pending timer when the input changes again inside the window (a trailing-edge
 * debounce).
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The bundled placeholder glyph for each Destination card (R4.3). Keyed by
 * `DestinationId`; the seven park identifiers plus the aggregate `'Resorts'`.
 */
const DESTINATION_GLYPH: Record<DestinationId, keyof typeof Ionicons.glyphMap> = {
  'Magic Kingdom': 'sparkles',
  EPCOT: 'earth',
  'Hollywood Studios': 'film',
  'Animal Kingdom': 'leaf',
  'Typhoon Lagoon': 'water',
  'Blizzard Beach': 'snow',
  'Disney Springs': 'storefront',
  Resorts: 'bed',
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CatalogScreen({ navigation }: Props): JSX.Element {
  // --- Search state -------------------------------------------------------
  // `searchInput` is the raw controlled value in the box; `debouncedSearch`
  // trails it by SEARCH_DEBOUNCE_MS and is what actually drives the fetch.
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [searchInput]);

  // A search is "active" only when the debounced query has ≥1 non-whitespace
  // character (R5.2, R5.5). The trimmed value is what is forwarded to `q`.
  const trimmedQuery = debouncedSearch.trim();
  const searchActive = trimmedQuery.length > 0;

  // --- Destination counts (grid) -----------------------------------------
  const destinationsQuery = useQuery<DestinationsResponse, ApiError>({
    queryKey: ['catalog', 'destinations'] as const,
    queryFn: fetchDestinationCounts,
    staleTime: STALE_TIME_MS,
    // R10.2: retrying immediately would hammer an upstream we already know is
    // unreachable, so react-query's default retry is disabled.
    retry: false,
  });

  // --- Search results -----------------------------------------------------
  // Only fetched while a query is active (R5.2); disabled otherwise so clearing
  // the query immediately restores the grid without a trailing request (R5.5).
  const searchQuery = useQuery<CatalogListResponse, ApiError>({
    queryKey: ['catalog', 'search', trimmedQuery] as const,
    queryFn: () => fetchCatalogSearch(trimmedQuery),
    enabled: searchActive,
    staleTime: STALE_TIME_MS,
    retry: false,
  });

  // Index the count entries by Destination id so each card can look up its
  // count in O(1); a Destination with no entry falls back to zero (R4.6).
  const countById = useMemo<ReadonlyMap<DestinationId, number>>(() => {
    const map = new Map<DestinationId, number>();
    for (const entry of destinationsQuery.data?.destinations ?? []) {
      map.set(entry.destination, entry.count);
    }
    return map;
  }, [destinationsQuery.data?.destinations]);

  // R12.8: announce the matching-result count to assistive tech within 1 second
  // whenever a search action changes the visible result set. Only active while a
  // search is running (the grid is not a filter/search surface), so clearing the
  // query restores the grid silently. The hook records the first observed count
  // as a baseline and announces every subsequent change (a new query returning a
  // different number of matches).
  const searchResultCount = searchActive
    ? searchQuery.data?.experiences.length ?? 0
    : 0;
  useResultCountAnnouncement(searchResultCount, searchActive);

  const onSelectExperience = (experience: ExperienceDTO): void => {
    navigation.navigate('ExperienceDetail', { experienceId: experience.id });
  };

  // R12.7: track a ref per Destination card and the last-activated Destination
  // so focus is restored to the activating card when the Catalog_Home regains
  // focus after returning from a Destination_Screen.
  const { registerCardRef, markActivated } = useCardFocusRestore<DestinationId>();

  // R10.2 full-screen error for the GRID: only when NOT searching (so the search
  // control stays reachable per R5.1) and there is no prior cache to fall back
  // on. This preserves the existing grid `catalog_unavailable` behavior intact.
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
    <ScreenContainer>
      <GradientHeader
        title="Catalog"
        subtitle="Where would you like to explore?"
        icon="map"
      />

      {/* Always-visible search control (R5.1, R12.4). */}
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
            placeholder="Search experiences"
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
              onPress={() => setSearchInput('')}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              testID="catalog-search-clear"
            />
          ) : null}
        </View>
      </View>

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

      {searchActive ? (
        <SearchResultsBody
          query={searchQuery}
          onSelectExperience={onSelectExperience}
        />
      ) : (
        <GridBody
          destinationsQuery={destinationsQuery}
          countById={countById}
          registerCardRef={registerCardRef}
          onSelectDestination={(destination) => {
            // R12.7: remember which card opened the Destination_Screen so focus
            // can be restored to it on back.
            markActivated(destination.id);
            navigation.navigate('DestinationScreen', {
              destination: destination.id,
            });
          }}
        />
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Grid body (default)
// ---------------------------------------------------------------------------

function GridBody({
  destinationsQuery,
  countById,
  registerCardRef,
  onSelectDestination,
}: {
  readonly destinationsQuery: {
    readonly isLoading: boolean;
    readonly data: DestinationsResponse | undefined;
  };
  readonly countById: ReadonlyMap<DestinationId, number>;
  readonly registerCardRef: (id: DestinationId) => (node: View | null) => void;
  readonly onSelectDestination: (destination: Destination) => void;
}): JSX.Element {
  const showLoading =
    destinationsQuery.isLoading && destinationsQuery.data === undefined;

  if (showLoading) {
    return (
      <View style={styles.center} testID="catalog-loading">
        <ActivityIndicator color={theme.color.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.gridScroll}
      contentContainerStyle={styles.grid}
      testID="catalog-destination-grid"
      keyboardShouldPersistTaps="handled"
    >
      {DESTINATIONS.map((destination) => (
        <DestinationCard
          key={destination.id}
          destination={destination}
          count={countById.get(destination.id) ?? 0}
          cardRef={registerCardRef(destination.id)}
          onPress={() => onSelectDestination(destination)}
        />
      ))}
    </ScrollView>
  );
}

interface DestinationCardProps {
  readonly destination: Destination;
  readonly count: number;
  readonly cardRef: (node: View | null) => void;
  readonly onPress: () => void;
}

/**
 * A single Destination card: a representative image (a bundled themed
 * placeholder when none is available — R4.2, R4.3), the Destination name, and
 * its active-Experience count (R4.4). The card exposes a screen-reader label of
 * `"{name}, {count} experiences"` (R12.1) via `destinationCardLabel`.
 *
 * The outer cell `View` receives `cardRef` (with `collapsable={false}` so a
 * native node handle exists on Android) so the Catalog_Home can restore focus
 * to the activated card on back navigation (R12.7).
 */
function DestinationCard({
  destination,
  count,
  cardRef,
  onPress,
}: DestinationCardProps): JSX.Element {
  const accent =
    destination.id === 'Resorts'
      ? theme.resortVisual.tint
      : theme.parkAccent[destination.id];

  return (
    <View ref={cardRef} collapsable={false} style={styles.gridCell}>
      <Card
        onPress={onPress}
        accentColor={accent}
        style={styles.card}
        testID={`catalog-destination-${destination.id}`}
        accessibilityRole="button"
        accessibilityLabel={destinationCardLabel(destination.title, count)}
      >
        <DestinationImage destinationId={destination.id} accent={accent} />
        <Text style={styles.cardTitle} numberOfLines={2}>
          {destination.title}
        </Text>
        <View style={styles.cardBadgeRow}>
          <Badge
            label={`${count} ${count === 1 ? 'experience' : 'experiences'}`}
            color={accent}
            icon="pricetag"
          />
        </View>
      </Card>
    </View>
  );
}

/**
 * The representative image for a Destination card. No per-Destination image is
 * sourced yet, so this always renders the bundled themed placeholder (R4.3): an
 * accent-tinted tile with the Destination's glyph, matching the placeholder
 * convention used by the Experience/Resort thumbnails elsewhere in the catalog.
 */
function DestinationImage({
  destinationId,
  accent,
}: {
  readonly destinationId: DestinationId;
  readonly accent: string;
}): JSX.Element {
  return (
    <View
      style={[styles.image, { backgroundColor: accent }]}
      testID={`catalog-destination-image-${destinationId}`}
    >
      <Ionicons
        name={DESTINATION_GLYPH[destinationId]}
        size={36}
        color={theme.color.textOnPrimary}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search results body
// ---------------------------------------------------------------------------

/**
 * The search body that replaces the grid while a query is active (R5.3). Shows
 * a loading spinner while the first page loads, a search-error state on failure
 * (R5.7), an empty-results state when nothing matches (R5.6), or the flat,
 * tappable result list otherwise (R5.3). The typed query is held in the search
 * control above this body, so the empty and error states retain it (R5.6, R5.7).
 */
function SearchResultsBody({
  query,
  onSelectExperience,
}: {
  readonly query: {
    readonly isLoading: boolean;
    readonly isError: boolean;
    readonly error: ApiError | null;
    readonly data: CatalogListResponse | undefined;
  };
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
}): JSX.Element {
  const results = query.data?.experiences ?? [];

  // R5.7: a failed search shows the search-error state (query is retained in the
  // control above). Only when there is no prior cache to keep showing.
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

  // R5.6: no matches → empty-results state (query retained above).
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
      renderItem={({ item }) => (
        <SearchResultRow
          experience={item}
          onPress={() => onSelectExperience(item)}
        />
      )}
    />
  );
}

interface SearchResultRowProps {
  readonly experience: ExperienceDTO;
  readonly onPress: () => void;
}

/**
 * One flat search-result row (R5.3). Shows the thumbnail (or category
 * placeholder), the name, the Experience's Destination and — when persisted —
 * its Land, and, for a Restaurant with a price tier, the compact price-tier
 * Info_Tag from `priceTierListTag` (R9.9). Tapping the row navigates to the
 * Experience_Detail_Screen (R5.4).
 */
function SearchResultRow({
  experience,
  onPress,
}: SearchResultRowProps): JSX.Element {
  const visual = theme.categoryVisual[experience.category];
  // `park` is `null` for a Resort-area Experience; fall back to the brand accent
  // so the row still reads.
  const accent =
    experience.park !== null
      ? theme.parkAccent[experience.park]
      : theme.color.primary;

  const destinationLabel = resultDestinationLabel(experience);
  const land =
    typeof experience.land === 'string' && experience.land.trim().length > 0
      ? experience.land.trim()
      : null;
  // A Resort-area result has no Land; surface its Resort_Area zone instead so
  // the row conveys which part of the property it sits in.
  const detail = land ?? resortAreaLabel(experience);

  // R9.9: a Restaurant with a persisted price tier shows the compact price tag.
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
        <ExperienceThumb
          imageUrl={experience.imageUrl ?? null}
          category={experience.category}
        />
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={2}>
            {experience.name}
          </Text>
          {/* R5.3: each result shows its Destination and, when present, its
              Land — or, for a Resort-area result, its Resort_Area zone. */}
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
 * Leading thumbnail for a search-result row. Renders the Disney-sourced image
 * when present; otherwise a category-tinted placeholder with the category glyph
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
      testID="catalog-search-thumb-placeholder"
    >
      <Ionicons
        name={visual.glyph as keyof typeof Ionicons.glyphMap}
        size={22}
        color={theme.color.textOnPrimary}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Full-screen states
// ---------------------------------------------------------------------------

function CatalogUnavailableState(): JSX.Element {
  return (
    <ScreenContainer>
      <GradientHeader title="Catalog" icon="map" />
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
      <GradientHeader title="Catalog" icon="map" />
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
// Helpers
// ---------------------------------------------------------------------------

/** Dispatch `GET /catalog/destinations`. */
async function fetchDestinationCounts(): Promise<DestinationsResponse> {
  return apiRequest<DestinationsResponse>('GET', '/catalog/destinations');
}

/**
 * Dispatch `GET /catalog?q=...` for a global search (R5.2). No area filter is
 * applied, so the search spans every Area_Type (`ThemePark`, `WaterPark`,
 * `DisneySprings`, `Resort`). The query is forwarded verbatim (already trimmed
 * by the caller).
 */
async function fetchCatalogSearch(q: string): Promise<CatalogListResponse> {
  const params = new URLSearchParams();
  params.append('q', q);
  return apiRequest<CatalogListResponse>('GET', `/catalog?${params.toString()}`);
}

/**
 * The Destination label shown on a search-result row (R5.3). For a park
 * Experience it is the Experience's `park`; for a `Resort`-area Experience it is
 * the aggregate `'Resorts'` Destination. A park-less non-Resort Experience (no
 * park ancestor) falls back to `'Resorts'` so the row always reads.
 */
function resultDestinationLabel(experience: ExperienceDTO): string {
  if (experience.areaType === 'Resort') {
    return 'Resorts';
  }
  return experience.park ?? 'Resorts';
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    marginTop: -theme.spacing.lg,
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
    marginTop: theme.spacing.md,
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
  gridScroll: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  gridCell: {
    width: '50%',
    padding: theme.spacing.sm,
  },
  card: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  image: {
    width: '100%',
    height: 96,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  cardBadgeRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
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
  thumb: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.md,
    marginRight: theme.spacing.md,
    backgroundColor: theme.color.surfaceAlt,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    marginRight: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  rowName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  rowMeta: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
  },
  rowBadges: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
});
