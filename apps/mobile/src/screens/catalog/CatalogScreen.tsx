/**
 * CatalogScreen — browse the active Experiences in the local catalog.
 *
 * Implements task 16.1 of the disney-world-tracker plan: list all active
 * Experiences grouped by Park, sorted alphabetically (case-insensitive,
 * ascending) by name within each Park group. The server already returns
 * the rows in `park ASC, lower(name) ASC` order so the screen only has
 * to walk the array and emit a new SectionList section every time the
 * Park value changes (R1.17).
 *
 * Behaviors and acceptance criteria covered here:
 *
 *   - **Park / Category filters (R1.18, R1.19).** A row of chips for each
 *     enum value plus a leading "All" chip toggles the corresponding
 *     filter. The selected value is forwarded to the server as the
 *     `parkId`/`category` query parameter so filtering happens at the
 *     SQL layer; the screen never re-filters in JS.
 *
 *   - **Server-side query (R1.17, R1.18, R1.19).** The fetch uses
 *     `react-query`'s `useQuery` with a cache key that includes the
 *     active filters and search query. `staleTime` is 5 minutes so the
 *     same filter combination served by a recent fetch will not re-hit
 *     the network on tab focus.
 *
 *   - **Stale-cache banner (R1.13).** When the response carries
 *     `staleCache: true`, a small warning banner is rendered above the
 *     list; the data is still useful, the upstream sync just couldn't
 *     refresh it. The banner does not auto-retry; the cache will
 *     refresh on the next scheduled sync (or via React Query's normal
 *     stale window).
 *
 *   - **`catalog_unavailable` error state (R1.24).** When the API
 *     returns an `ApiError` with code `catalog_unavailable` AND no
 *     prior cache exists in React Query, the screen shows a full-screen
 *     error with no automatic retry — retrying immediately would just
 *     spam an upstream we already know is unreachable. If a prior
 *     successful response exists in the cache, React Query keeps the
 *     last-good payload visible and the user is never bumped to the
 *     error screen (the stale-cache banner takes over instead).
 *
 *   - **Empty state (R1.23).** When the active filters yield zero rows,
 *     the screen replaces the list body with "No experiences match your
 *     filters." Task 16.2 will refine the copy when a search query is
 *     also active.
 *
 *   - **Tap-to-detail (R1.22).** Tapping a row navigates to
 *     `ExperienceDetail` in the parent stack with the row's stable
 *     internal id; task 16.3 owns that screen's body.
 *
 * Styling: uses the shared "Magical / Whimsical" theme — a gradient hero
 * header with the search field beneath it, themed filter `Chip`s,
 * experience rows as `Card`s with a park-colored left accent and a
 * category `Badge`. See `theme/theme.ts` and `theme/components.tsx`.
 *
 * Validates: Requirements 1.13, 1.17, 1.18, 1.19, 1.22, 1.24
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type ExperienceDTO,
  type Park,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { CatalogStackParamList } from '../../navigation/CatalogStack';
import { theme } from '../../theme/theme';
import {
  Badge,
  Card,
  Chip,
  EmptyState,
  GradientHeader,
  ScreenContainer,
} from '../../theme/components';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = NativeStackScreenProps<CatalogStackParamList, 'CatalogList'>;

/**
 * Wire shape for `GET /catalog`. Mirrors the inline response in
 * `apps/api/src/services/catalog/routes.ts`; we type only what the
 * screen reads so a future field addition does not require a
 * coordinated mobile change.
 */
interface CatalogListResponse {
  readonly experiences: readonly ExperienceDTO[];
  readonly staleCache: boolean;
}

interface CatalogSection {
  readonly title: Park;
  readonly data: readonly ExperienceDTO[];
}

interface ActiveFilters {
  readonly park: Park | null;
  readonly category: ExperienceCategory | null;
  readonly q: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 5 minutes — matches the design's "cache via react-query for 5 minutes" rule. */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Debounce for the search input. 250 ms keeps the UI responsive while
 * avoiding a per-keystroke fetch storm; task 16.2 will refine the
 * trim/min-length rule, this screen just forwards whatever's in the box
 * after the debounce window.
 */
const SEARCH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function CatalogScreen({ navigation }: Props): JSX.Element {
  const [park, setPark] = useState<Park | null>(null);
  const [category, setCategory] = useState<ExperienceCategory | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce the search input so each keystroke doesn't trigger a
  // refetch. The cleanup function cancels a pending timer when the
  // input changes again before the window elapses, which is the
  // standard "trailing-edge debounce" shape.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(handle);
    };
  }, [searchInput]);

  const filters: ActiveFilters = useMemo(
    () => ({ park, category, q: debouncedSearch }),
    [park, category, debouncedSearch],
  );

  const query = useQuery<CatalogListResponse, ApiError>({
    queryKey: ['catalog', filters] as const,
    queryFn: () => fetchCatalog(filters),
    staleTime: STALE_TIME_MS,
    // R1.24: when upstream has no prior cache and is unreachable the
    // server returns 503 `catalog_unavailable`. Retrying immediately
    // would just hammer an endpoint we already know is failing, so we
    // disable react-query's default retry — the user can pull-to-
    // refresh or change filters when they want to try again.
    retry: false,
  });

  const sections = useMemo<readonly CatalogSection[]>(
    () => groupByPark(query.data?.experiences ?? []),
    [query.data?.experiences],
  );

  // R1.24 full-screen error: only when there is no prior cache to fall
  // back on. `query.data` being defined means a previous successful
  // fetch is still in cache (e.g. earlier filter combination), in which
  // case we keep showing it and surface staleness via the banner.
  if (query.isError && query.data === undefined) {
    if (
      query.error instanceof ApiError &&
      query.error.code === 'catalog_unavailable'
    ) {
      return <CatalogUnavailableState />;
    }
    return (
      <GenericErrorState
        message={query.error?.message ?? 'Catalog couldn\u2019t be loaded.'}
      />
    );
  }

  const showStaleBanner = query.data?.staleCache === true;
  const showLoading = query.isLoading && query.data === undefined;
  const showEmpty = !showLoading && sections.length === 0;

  return (
    <ScreenContainer>
      <GradientHeader
        title="Catalog"
        subtitle="Find your next bit of magic."
        icon="map"
      />

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
        </View>

        <FilterChipRow
          label="Park"
          values={PARKS}
          selected={park}
          onChange={setPark}
          testIdPrefix="catalog-park"
        />
        <FilterChipRow
          label="Category"
          values={EXPERIENCE_CATEGORIES}
          selected={category}
          onChange={setCategory}
          formatLabel={formatCategory}
          testIdPrefix="catalog-category"
        />
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

      {showLoading ? (
        <View style={styles.center} testID="catalog-loading">
          <ActivityIndicator color={theme.color.primary} />
        </View>
      ) : showEmpty ? (
        <View style={styles.center} testID="catalog-empty">
          <EmptyState
            icon="search-outline"
            title="No experiences match your filters"
            body="Try clearing a filter or searching for something else."
          />
        </View>
      ) : (
        <SectionList
          sections={sections as unknown as CatalogSection[]}
          keyExtractor={(item) => item.id}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeaderWrap}>
              <View
                style={[
                  styles.sectionDot,
                  { backgroundColor: theme.parkAccent[section.title] },
                ]}
              />
              <Text style={styles.sectionHeader}>{section.title}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <ExperienceRow
              experience={item}
              onPress={() => {
                navigation.navigate('ExperienceDetail', {
                  experienceId: item.id,
                });
              }}
            />
          )}
          stickySectionHeadersEnabled
          contentContainerStyle={styles.listContent}
        />
      )}
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface FilterChipRowProps<T extends string> {
  readonly label: string;
  readonly values: readonly T[];
  readonly selected: T | null;
  readonly onChange: (next: T | null) => void;
  readonly formatLabel?: (value: T) => string;
  readonly testIdPrefix: string;
}

function FilterChipRow<T extends string>(
  props: FilterChipRowProps<T>,
): JSX.Element {
  const { label, values, selected, onChange, formatLabel, testIdPrefix } =
    props;
  return (
    <View style={styles.chipRowContainer}>
      <Text style={styles.chipRowLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRowContent}
      >
        <Chip
          label="All"
          active={selected === null}
          onPress={() => onChange(null)}
          testID={`${testIdPrefix}-all`}
        />
        {values.map((value) => (
          <Chip
            key={value}
            label={formatLabel ? formatLabel(value) : value}
            active={selected === value}
            onPress={() => onChange(value)}
            testID={`${testIdPrefix}-${value}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface ExperienceRowProps {
  readonly experience: ExperienceDTO;
  readonly onPress: () => void;
}

function ExperienceRow({ experience, onPress }: ExperienceRowProps): JSX.Element {
  const visual = theme.categoryVisual[experience.category];
  return (
    <Card
      onPress={onPress}
      accentColor={theme.parkAccent[experience.park]}
      style={styles.row}
      testID={`catalog-row-${experience.id}`}
    >
      <View style={styles.rowInner}>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={2}>
            {experience.name}
          </Text>
          <View style={styles.rowBadges}>
            <Badge
              label={visual.label}
              color={visual.tint}
              icon={visual.glyph as keyof typeof Ionicons.glyphMap}
            />
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

/**
 * Build the `GET /catalog` URL with only the supplied filters as query
 * parameters and dispatch the request.
 *
 * Empty/null filters are omitted entirely — the server treats a missing
 * parameter as "no filter", which is what the screen wants when the
 * "All" chip is selected. The search query is forwarded verbatim;
 * task 16.2 will tighten the trim/min-length rule on the way in.
 */
async function fetchCatalog(filters: ActiveFilters): Promise<CatalogListResponse> {
  const params = new URLSearchParams();
  if (filters.park !== null) {
    params.append('parkId', filters.park);
  }
  if (filters.category !== null) {
    params.append('category', filters.category);
  }
  const trimmedQ = filters.q.trim();
  if (trimmedQ.length > 0) {
    params.append('q', trimmedQ);
  }
  const qs = params.toString();
  const path = qs.length > 0 ? `/catalog?${qs}` : '/catalog';
  return apiRequest<CatalogListResponse>('GET', path);
}

/**
 * Walk the server-ordered list and emit a new section every time the
 * `park` value changes. Because the server returns rows in
 * `park ASC, lower(name) ASC` order (R1.17), preserving order is
 * sufficient — no client-side sort is needed.
 */
function groupByPark(experiences: readonly ExperienceDTO[]): readonly CatalogSection[] {
  const sections: CatalogSection[] = [];
  let current: { title: Park; data: ExperienceDTO[] } | null = null;
  for (const experience of experiences) {
    if (current === null || current.title !== experience.park) {
      current = { title: experience.park, data: [] };
      sections.push(current);
    }
    current.data.push(experience);
  }
  return sections;
}

/**
 * Render the underscore-bearing `Character_Meet` enum as a friendlier
 * "Character Meet" label without losing the literal value used over
 * the wire.
 */
function formatCategory(value: ExperienceCategory): string {
  return value === 'Character_Meet' ? 'Character Meet' : value;
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
  chipRowContainer: {
    marginTop: theme.spacing.md,
  },
  chipRowLabel: {
    ...theme.typography.meta,
    color: theme.color.textSecondary,
    marginBottom: theme.spacing.xs,
  },
  chipRowContent: {
    paddingRight: theme.spacing.lg,
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
  listContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  sectionHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.color.background,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  sectionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: theme.spacing.sm,
  },
  sectionHeader: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
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
  rowText: {
    flex: 1,
    marginRight: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  rowName: {
    ...theme.typography.subtitle,
    color: theme.color.textPrimary,
  },
  rowBadges: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
  },
});
