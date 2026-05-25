// Feature: disney-world-tracker, Tasks 16.1 + 16.2 — Catalog list, filters, search
//
// Validates: Requirements R1.13, R1.17, R1.18, R1.19, R1.20, R1.21, R1.22,
//            R1.23, R1.24
//
// Behavior summary:
//   - Reads `GET /catalog` through `react-query` and renders the active
//     Experience set grouped by Park, with Experiences sorted alphabetically
//     within each group (R1.17). The server already orders by
//     `park ASC, lower(name) ASC`, so the client only has to fold the flat
//     list into Park-keyed sections.
//   - Surfaces the server's `staleCache` flag with a small banner so users
//     know when they are looking at the prior cache after an upstream
//     failure (R1.13). When the server returns `503 catalog_unavailable`
//     and there is no prior cached response, the screen renders the
//     catalog-load error state (R1.24).
//   - Exposes filters for Park (R1.19) and Experience_Category (R1.18).
//     The currently selected values are passed straight through as query
//     params (`parkId`, `category`); `react-query` keys the cache by the
//     filter set so the cached snapshot for "no filters" is preserved
//     while the user toggles filters.
//   - Adds a debounced search input (300ms) that:
//       * client-side trims the input,
//       * only contributes a `q` query param when the trimmed length is
//         at least 1 (R1.20),
//       * combines with the Park/category filters (R1.21).
//     The trimmed query is passed both as the query param and into the
//     react-query key, so toggling between identical trimmed values does
//     not blow away the cache.
//   - Empty-state strings:
//       * "No Experiences match your filters and search." when any filter
//         or a non-empty search query is active and the response is empty
//         (R1.23).
//       * "No Experiences yet." when none of the filter / search fields
//         are active and the response is empty (catalog has no rows).

import React, { useMemo, useState } from 'react';
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

import {
  EXPERIENCE_CATEGORIES,
  PARKS,
  type ExperienceCategory,
  type ExperienceDTO,
  type Park,
} from '@dwt/shared';

import { ApiError, apiRequest } from '../api/client';
import { useDebounce } from '../hooks/useDebounce';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Debounce window for the search input (R1.20). 300ms is short enough that
 * a typist barely perceives the delay but long enough to coalesce a typical
 * burst of keystrokes into a single request.
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * `staleTime` for `react-query` on `GET /catalog`. The design (task 16.1)
 * specifies a 5-minute client-side cache so the server is hit at most once
 * per filter set per 5 minutes during steady-state browsing.
 */
const CATALOG_STALE_TIME_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * Shape of `GET /catalog`. Mirrors the body produced by
 * `apps/api/src/services/catalog/routes.ts`. Re-declared here rather than
 * imported because the API does not export a wire type for the list
 * response and the contract is stable for this read.
 */
interface CatalogListResponse {
  readonly experiences: readonly ExperienceDTO[];
  readonly staleCache: boolean;
}

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

/**
 * Logical filter state held locally by the screen. Each field defaults
 * to `null` ("no filter") so the type cleanly carries "this filter is
 * unset" alongside the enum value when the filter is active.
 */
interface FilterState {
  readonly parkId: Park | null;
  readonly category: ExperienceCategory | null;
}

const INITIAL_FILTERS: FilterState = {
  parkId: null,
  category: null,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CatalogListScreen(): JSX.Element {
  // -------------------------------------------------------------------------
  // Local UI state — filters and search query
  // -------------------------------------------------------------------------

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [searchInput, setSearchInput] = useState('');

  // Debounce so each keystroke does not fire a request. The trim + length
  // check happens after the debounce so the request is gated by what the
  // user actually settled on, not by every transient whitespace state.
  const debouncedSearch = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);

  // R1.20: only issue the request with a `q` parameter when the trimmed
  // query has at least one non-whitespace character. A whitespace-only
  // box is treated as "no search".
  const trimmedQuery = debouncedSearch.trim();
  const activeQuery: string | null = trimmedQuery.length >= 1 ? trimmedQuery : null;

  // -------------------------------------------------------------------------
  // Catalog query
  // -------------------------------------------------------------------------

  const catalogQuery = useQuery<CatalogListResponse, ApiError>({
    // Key includes every input that changes the server response so that:
    //   • toggling a filter or typing in the search box reads from / writes
    //     to a distinct cache slot,
    //   • returning to a previous filter set surfaces the cached result
    //     without a network round-trip.
    queryKey: ['catalog', filters.parkId, filters.category, activeQuery],
    queryFn: () => fetchCatalog(filters, activeQuery),
    staleTime: CATALOG_STALE_TIME_MS,
    // Keep prior data on the screen while a new filter set fetches so the
    // user does not see a flash of empty list between filter taps.
    placeholderData: (previous) => previous,
    // R1.24 maps to `503 catalog_unavailable`, which we render as a hard
    // error state. Disable retries on that specific code so we don't spin
    // a noisy retry loop on top of an already-degraded server.
    retry: (failureCount, error) => {
      if (error.code === 'catalog_unavailable') {
        return false;
      }
      return failureCount < 1;
    },
  });

  // -------------------------------------------------------------------------
  // Render branches
  // -------------------------------------------------------------------------

  if (catalogQuery.isLoading && catalogQuery.data === undefined) {
    return (
      <View style={styles.centered} accessibilityRole="progressbar">
        <ActivityIndicator />
      </View>
    );
  }

  if (catalogQuery.isError && catalogQuery.data === undefined) {
    // R1.24: no prior successful cache and upstream is unreachable →
    // show the catalog-load error message. Any other failure produces
    // the same terminal message; we don't expose retry buttons because
    // `react-query`'s background refetch will pick up the next attempt
    // automatically when the user toggles a filter.
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          We couldn&apos;t load the catalog. Please try again later.
        </Text>
      </View>
    );
  }

  // From here on we know we have a payload — either fresh or cached. The
  // banner / empty-state branches below all read from `catalogQuery.data`.
  const data = catalogQuery.data;
  const experiences = data?.experiences ?? [];
  const staleCache = data?.staleCache ?? false;

  const hasAnyFilterOrQuery =
    filters.parkId !== null || filters.category !== null || activeQuery !== null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
    >
      {staleCache ? (
        <View style={styles.staleBanner} accessibilityRole="alert">
          <Text style={styles.staleBannerText}>
            Showing cached catalog. The latest sync didn&apos;t complete in time.
          </Text>
        </View>
      ) : null}

      <SearchBar value={searchInput} onChange={setSearchInput} />

      <FilterBar
        filters={filters}
        onChange={setFilters}
      />

      {experiences.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {hasAnyFilterOrQuery
              ? 'No Experiences match your filters and search.'
              : 'No Experiences yet.'}
          </Text>
        </View>
      ) : (
        <ParkGroupedList experiences={experiences} />
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Build and issue the `GET /catalog` request for the current filter +
 * query state. Filters are only added to the query string when set so
 * the server sees the same URL for "no filters" regardless of whether
 * the user ever toggled one.
 */
async function fetchCatalog(
  filters: FilterState,
  activeQuery: string | null,
): Promise<CatalogListResponse> {
  const params: string[] = [];
  if (filters.parkId !== null) {
    params.push(`parkId=${encodeURIComponent(filters.parkId)}`);
  }
  if (filters.category !== null) {
    params.push(`category=${encodeURIComponent(filters.category)}`);
  }
  if (activeQuery !== null) {
    params.push(`q=${encodeURIComponent(activeQuery)}`);
  }
  const path = params.length === 0 ? '/catalog' : `/catalog?${params.join('&')}`;
  return apiRequest<CatalogListResponse>('GET', path);
}

// ---------------------------------------------------------------------------
// Search bar
// ---------------------------------------------------------------------------

interface SearchBarProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function SearchBar({ value, onChange }: SearchBarProps): JSX.Element {
  return (
    <View style={styles.searchWrap}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search experiences"
        autoCapitalize="none"
        autoCorrect={false}
        // The shared `searchQuerySchema` caps `q` at 100 chars. Pin the
        // input to the same bound so a 200-char paste cannot dispatch an
        // already-doomed request.
        maxLength={100}
        style={styles.searchInput}
        accessibilityLabel="Search experiences"
        returnKeyType="search"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  readonly filters: FilterState;
  readonly onChange: (next: FilterState) => void;
}

function FilterBar({ filters, onChange }: FilterBarProps): JSX.Element {
  return (
    <View style={styles.filterBar}>
      <Text style={styles.filterLabel}>Park</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Chip
          label="All"
          selected={filters.parkId === null}
          onPress={() => onChange({ ...filters, parkId: null })}
        />
        {PARKS.map((park) => (
          <Chip
            key={park}
            label={park}
            selected={filters.parkId === park}
            onPress={() => onChange({ ...filters, parkId: park })}
          />
        ))}
      </ScrollView>

      <Text style={styles.filterLabel}>Category</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <Chip
          label="All"
          selected={filters.category === null}
          onPress={() => onChange({ ...filters, category: null })}
        />
        {EXPERIENCE_CATEGORIES.map((category) => (
          <Chip
            key={category}
            label={category}
            selected={filters.category === category}
            onPress={() => onChange({ ...filters, category: category })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

interface ChipProps {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}

function Chip({ label, selected, onPress }: ChipProps): JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Park-grouped list
// ---------------------------------------------------------------------------

interface ParkGroupedListProps {
  readonly experiences: readonly ExperienceDTO[];
}

function ParkGroupedList({ experiences }: ParkGroupedListProps): JSX.Element {
  // Fold the server-ordered flat list into Park-keyed sections. The server
  // already returns rows in `park ASC, lower(name) ASC` order, so a single
  // pass preserves both the inter-Park order and the alphabetical order
  // within each Park (R1.17).
  const groups = useMemo(() => {
    const byPark = new Map<Park, ExperienceDTO[]>();
    for (const exp of experiences) {
      const list = byPark.get(exp.park);
      if (list === undefined) {
        byPark.set(exp.park, [exp]);
      } else {
        list.push(exp);
      }
    }
    // Iterate in the canonical Park order (matches the server's
    // alphabetical Park ordering for the standard set).
    const ordered: { park: Park; items: readonly ExperienceDTO[] }[] = [];
    for (const park of PARKS) {
      const items = byPark.get(park);
      if (items !== undefined && items.length > 0) {
        ordered.push({ park, items });
      }
    }
    return ordered;
  }, [experiences]);

  return (
    <View style={styles.list}>
      {groups.map((group) => (
        <View key={group.park} style={styles.parkGroup}>
          <Text style={styles.parkHeading}>{group.park}</Text>
          {group.items.map((exp) => (
            <View key={exp.id} style={styles.row}>
              <Text style={styles.rowName}>{exp.name}</Text>
              <Text style={styles.rowMeta}>{exp.category}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    padding: 16,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  errorText: {
    fontSize: 16,
    color: '#b91c1c',
    textAlign: 'center',
  },
  staleBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  staleBannerText: {
    color: '#92400e',
    fontSize: 14,
  },
  searchWrap: {
    marginTop: 4,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#f9fafb',
  },
  filterBar: {
    gap: 6,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  chipRow: {
    gap: 8,
    paddingVertical: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#f3f4f6',
  },
  chipSelected: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  chipText: {
    fontSize: 13,
    color: '#374151',
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
  emptyState: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  list: {
    gap: 16,
  },
  parkGroup: {
    gap: 8,
  },
  parkHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  row: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowName: {
    fontSize: 15,
    color: '#111827',
    flex: 1,
  },
  rowMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 8,
  },
});
