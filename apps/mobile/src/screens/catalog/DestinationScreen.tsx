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
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  filterAndRankExperiences,
  type ExperienceCategory,
  type ExperienceDTO,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { ExploreStackParamList } from '../../navigation/ExploreStack';
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
import { DESTINATION_VISUALS } from './destinationVisuals';
import {
  browseLandOf,
  groupByCategory,
  type Section,
} from './catalogGrouping';
import { useDestinationSections } from './useDestinationSections';
import { useCompletedExperiences } from './useCompletedExperiences';
import { useFavoritedExperiences } from './useFavoritedExperiences';
import { FavoriteToggle } from './FavoriteToggle';
import { priceTierListTag, resortAreaLabel } from './infoTags';
import {
  useAccessibilityFocusOnMount,
  useResultCountAnnouncement,
} from './catalogFocus';
import ParkDestinationScreen from './ParkDestinationScreen';
import ResortsDirectoryScreen from './ResortsDirectoryScreen';

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
  NativeStackScreenProps<ExploreStackParamList, 'DestinationScreen'>,
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 5 minutes — matches the catalog's react-query staleness interval (R10.6). */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Fixed row heights for the flattened, per-row-virtualizing `FlatList`s below
 * (theme/water-park, Disney Springs, Resorts layouts). Both the header row and
 * the Experience row render at a constant height regardless of content —
 * `numberOfLines` caps text, and the empty-group indicator reuses the header
 * row's height — so `getItemLayout` can report exact offsets without a
 * measurement pass, letting `FlatList` compute scroll position synchronously
 * (matters most for the Resorts layout's scroll-to-anchor jump).
 */
const SECTION_HEADER_ROW_HEIGHT = 44;
const EXPERIENCE_ROW_HEIGHT = 96;

// ---------------------------------------------------------------------------
// Flattened, per-row-virtualizing section list
// ---------------------------------------------------------------------------

/**
 * A single flattened row for a collapsible sectioned `FlatList`: either a
 * section header or one of that section's items. Encoding sections as one flat
 * tagged array — instead of each `renderItem` call rendering its whole section
 * (header + every item) as plain `View`s — lets `FlatList` virtualize at the
 * granularity of individual Experience rows rather than whole sections, so a
 * Land/category/Resort with dozens of Experiences never mounts more rows than
 * are actually scrolled into view. Matches the pattern already used by
 * `TripsListScreen` / `FriendsListScreen` for their unified lists.
 */
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
    }
  | {
      readonly kind: 'emptyGroup';
      readonly key: string;
      readonly sectionKey: string;
    };

/**
 * Flatten collapsible `Section`s into `FlatSectionRow`s: a header row for every
 * section, followed by its item rows only while expanded (collapsed sections
 * contribute only their header, so their rows are never mounted — not merely
 * hidden). A section with zero items renders a trailing `emptyGroup` row while
 * expanded, when `showEmptyGroup` is set (used by the Resorts layout, R8.7).
 */
/** `flattenSections` without `showEmptyGroup`: never produces an `emptyGroup` row. */
function flattenSections<T>(
  sections: readonly Section<T>[],
  isExpanded: (key: string) => boolean,
): readonly Exclude<FlatSectionRow<T>, { readonly kind: 'emptyGroup' }>[];
/** `flattenSections` with `showEmptyGroup: true`: may produce `emptyGroup` rows. */
function flattenSections<T>(
  sections: readonly Section<T>[],
  isExpanded: (key: string) => boolean,
  options: { readonly showEmptyGroup: true },
): readonly FlatSectionRow<T>[];
function flattenSections<T>(
  sections: readonly Section<T>[],
  isExpanded: (key: string) => boolean,
  options: { readonly showEmptyGroup?: boolean } = {},
): readonly FlatSectionRow<T>[] {
  const rows: FlatSectionRow<T>[] = [];
  for (const section of sections) {
    rows.push({ kind: 'header', key: `header:${section.key}`, section });
    if (!isExpanded(section.key)) {
      continue;
    }
    if (section.items.length === 0) {
      if (options.showEmptyGroup === true) {
        rows.push({
          kind: 'emptyGroup',
          key: `empty:${section.key}`,
          sectionKey: section.key,
        });
      }
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

/** A row's fixed height by kind — every row is either header height or item height. */
function flatSectionRowHeight<T>(row: FlatSectionRow<T>): number {
  return row.kind === 'header' ? SECTION_HEADER_ROW_HEIGHT : EXPERIENCE_ROW_HEIGHT;
}

/**
 * Precompute the `{ length, offset, index }` triple for every row in a
 * flattened section list in one O(n) pass, so the `getItemLayout` callback
 * `FlatList` calls per row is an O(1) array lookup rather than re-summing
 * preceding heights on every call (which would make scrolling an O(n²) list of
 * calls). Recomputed only when `rows` changes (a new/updated flatten, e.g. on
 * toggle or filter), via the caller's `useMemo`.
 */
function buildRowLayouts<T>(
  rows: readonly FlatSectionRow<T>[],
): ReadonlyArray<{ readonly length: number; readonly offset: number; readonly index: number }> {
  const layouts: Array<{ length: number; offset: number; index: number }> = [];
  let offset = 0;
  rows.forEach((row, index) => {
    const length = flatSectionRowHeight(row);
    layouts.push({ length, offset, index });
    offset += length;
  });
  return layouts;
}

/**
 * A collapsible section's header, rendered as its own flat-list row rather than
 * as `GroupSection`'s wrapping container. Reproduces `GroupSection`'s header
 * contract exactly — the same `Pressable`, `accessibilityRole="button"`,
 * `accessibilityState={{ expanded }}`, `accessibilityLabel`, and
 * `${testID}-header` id — so the flattened list is behaviorally identical to
 * the nested `GroupSection` it replaces; only the body's items move from
 * `children` to sibling flat-list rows.
 */
const CollapsibleHeaderRow = React.memo(function CollapsibleHeaderRow({
  sectionKey,
  expanded,
  onToggle,
  accessibilityLabel,
  header,
  testID,
}: {
  readonly sectionKey: string;
  readonly expanded: boolean;
  readonly onToggle: (sectionKey: string) => void;
  readonly accessibilityLabel: string;
  readonly header: React.ReactNode;
  readonly testID: string;
}): JSX.Element {
  const handlePress = useCallback(() => {
    onToggle(sectionKey);
  }, [onToggle, sectionKey]);

  return (
    <View testID={testID}>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [pressed && styles.headerPressed]}
        testID={`${testID}-header`}
      >
        {header}
      </Pressable>
    </View>
  );
});

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

  // Requirements 7.2: ThemePark / WaterPark destinations delegate to ParkDestinationScreen
  if (destination.kind === 'themeOrWaterPark') {
    return (
      <ParkDestinationScreen
        route={route}
        navigation={navigation}
        destination={destination}
      />
    );
  }

  // Requirements 7.2, 8.1: Resorts destination delegates to ResortsDirectoryScreen
  if (destination.kind === 'resorts') {
    return <ResortsDirectoryScreen navigation={navigation} />;
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
  const favoritedIds = useFavoritedExperiences();

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

  const onSelectExperience = useCallback(
    (experience: ExperienceDTO): void => {
      navigation.navigate('ExperienceDetail', { experienceId: experience.id });
    },
    [navigation],
  );

  const visual =
    DESTINATION_VISUALS[destination.title as DestinationId] ??
    DESTINATION_VISUALS[destination.id as DestinationId];

  return (
    <ScreenContainer>
      <View ref={headingRef} collapsable={false} accessibilityRole="header">
        <GradientHeader
          title={destination.title}
          subtitle={
            experiences.length > 0
              ? `${experiences.length} Active Experiences`
              : 'Browse this destination.'
          }
          iconText={visual?.icon}
          icon={visual?.icon ? undefined : 'map'}
          colors={visual?.gradient}
          compact
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
          favoritedIds={favoritedIds}
        />
      ) : (
        renderBody(destination, experiences, onSelectExperience, completedIds, favoritedIds)
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
          placeholder="Search by name, land, or facet..."
          placeholderTextColor={theme.color.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search by name, land, or facet"
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

  // Stable `renderItem` identity — an inline arrow literal is recreated every
  // render (e.g. each keystroke re-deriving `results`), which `FlatList`
  // treats as a changed render function and forces the whole visible window
  // to re-render/re-measure even though `ExperienceRow` is memoized. See the
  // grouped layouts' `renderRow` for the same fix.
  const renderRow = useCallback(
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
      renderItem={renderRow}
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
  _destination: Destination,
  experiences: readonly ExperienceDTO[],
  onSelectExperience: (experience: ExperienceDTO) => void,
  completedIds: ReadonlySet<string>,
  favoritedIds: ReadonlySet<string>,
): JSX.Element {
  return (
    <DisneySpringsLayout
      experiences={experiences}
      onSelectExperience={onSelectExperience}
      completedIds={completedIds}
      favoritedIds={favoritedIds}
    />
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
  favoritedIds,
}: {
  readonly experiences: readonly ExperienceDTO[];
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  readonly completedIds: ReadonlySet<string>;
  readonly favoritedIds: ReadonlySet<string>;
}): JSX.Element {
  // R7.2/R7.5: derive the category sections client-side over the already-fetched
  // Experiences in canonical order, empties omitted (no refetch).
  const sections = useMemo(() => groupByCategory(experiences), [experiences]);

  // R7.3: seed the collapsible state with every current section key so the
  // first render is fully expanded.
  const sectionKeys = useMemo(() => sections.map((s) => s.key), [sections]);
  const { isExpanded, toggle } = useDestinationSections(sectionKeys);

  // Flatten into per-row `FlatList` data (see `flattenSections`) so a
  // category with many Experiences virtualizes at the row level.
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

  // Stable `renderItem` identity — see `ThemeOrWaterParkLayout`'s
  // `renderRow` for why an inline arrow here defeats row-level memoization.
  // The row type is inferred from `flatRows` (not annotated explicitly) so it
  // stays the narrower `Exclude<FlatSectionRow<T>, { kind: 'emptyGroup' }>`
  // that this layout's no-`showEmptyGroup` `flattenSections` overload
  // produces — annotating the full `FlatSectionRow<ExperienceDTO>` here would
  // widen it back and break the exhaustiveness narrowing below.
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
                title={categoryLabel(section.title as ExperienceCategory)}
                count={section.items.length}
                expanded={expanded}
              />
            }
            testID={`destination-section-${section.key}`}
          />
        );
      }
      // 'item' — Disney Springs' `flattenSections` call omits
      // `showEmptyGroup`, so 'emptyGroup' rows never occur here.
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

  return (
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
  );
}





// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface ExperienceRowProps {
  readonly experience: ExperienceDTO;
  readonly onSelectExperience: (experience: ExperienceDTO) => void;
  /**
   * Whether the signed-in User has marked this Experience as visited. When
   * true the row shows a "Visited" completion badge so the list conveys
   * completion at a glance without drilling into the detail screen.
   */
  readonly completed?: boolean;
  /**
   * Whether the signed-in User has marked this Experience as favorite.
   */
  readonly favorited?: boolean;
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
const ExperienceRow = React.memo(function ExperienceRow({
  experience,
  onSelectExperience,
  completed = false,
  favorited = false,
}: ExperienceRowProps): JSX.Element {
  const onPress = useCallback(
    () => onSelectExperience(experience),
    [onSelectExperience, experience],
  );
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

  // The location subtitle: browseLandOf(experience) for Land / EPCOT Pavilion,
  // or resortAreaLabel(experience) for Resort-area experiences (R6.15).
  const browseLand = browseLandOf(experience);
  const resortArea = resortAreaLabel(experience);
  const locationText = browseLand ?? resortArea;
  const isResortAreaOnly = browseLand === null && resortArea !== null;
  const locationTestId = isResortAreaOnly
    ? `destination-resort-area-${experience.id}`
    : `destination-location-${experience.id}`;

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
          {locationText !== null ? (
            <View
              style={styles.rowMetaLine}
              testID={locationTestId}
            >
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

/**
 * Leading thumbnail for an Experience row. Renders the Disney-sourced image when
 * present; otherwise a category-tinted placeholder with the category glyph
 * (R10.4).
 */
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
        // Default `cachePolicy` ('disk') persists decoded rows across
        // mount/unmount as the list scrolls, avoiding a re-fetch/re-decode
        // every time a row scrolls back into the (now much smaller,
        // per-row-virtualized) render window.
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
});

/**
 * A completion marker overlaid on the corner of an Experience row's thumbnail:
 * a solid green disc with a white checkmark and a surface-colored ring so it
 * reads clearly against any image. Placing it on the thumbnail — rather than
 * inline with the category / price Info_Tags — keeps the "visited" signal
 * visually distinct from the tag pills so it is easy to spot when scanning the
 * list. Exposed as a single accessible "Visited" element for screen readers.
 */
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
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
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
  headerPressed: {
    opacity: 0.85,
  },
  // Mirrors `GroupSection`'s `body` indentation/rail so a flattened item row
  // still reads as nested under its section header, now that each item is its
  // own flat-list row rather than a child inside a shared bordered container.
  itemRowWrap: {
    marginLeft: theme.spacing.md,
    paddingLeft: theme.spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.borderStrong,
  },
  emptyGroupWrap: {
    marginTop: theme.spacing.sm,
    marginLeft: theme.spacing.md,
    paddingLeft: theme.spacing.md,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.borderStrong,
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
  tabBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  tabBar: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...theme.shadow.card,
  },
  favoritesToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    ...theme.shadow.card,
  },
  favoritesToggleBtnActive: {
    borderColor: '#FF2D55',
    backgroundColor: '#fff1f2',
  },
  favoritesToggleText: {
    ...theme.typography.meta,
    fontSize: 12,
    fontWeight: '600',
    color: theme.color.textSecondary,
  },
  favoritesToggleTextActive: {
    color: '#FF2D55',
    fontWeight: '700',
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
