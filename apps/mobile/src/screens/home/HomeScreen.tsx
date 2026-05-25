/**
 * HomeScreen — the App's lead surface (R11.1).
 *
 * Renders the Highest-Rated Experiences section against
 * `GET /home/highest-rated`. The leaderboard rows are produced by the
 * server in their final R11.3 order (`mean DESC, count DESC,
 * lower(name) ASC`), so the screen renders them in array order without
 * any client-side sort.
 *
 * Caching (R11.7, R11.8, R11.9):
 *
 *   - The query passes both `staleTime` and `gcTime` of 5 minutes to
 *     react-query. While the cached entry is younger than the stale
 *     window, react-query returns the cached data without dispatching
 *     a network call (R11.8). Once the entry crosses the 5-minute
 *     boundary, the next mount triggers a refetch (R11.7). The
 *     `gcTime` value matches `staleTime` so the cached entry is not
 *     evicted before the staleness check fires on next navigation.
 *
 * Empty state (R11.11, R11.12):
 *
 *   - When the response carries an empty `entries` array — meaning no
 *     active Experiences cleared the `count >= 3` threshold — the
 *     screen replaces the list with a single non-interactive line
 *     ("No leaderboard yet — keep exploring!"). The empty-state body
 *     is intentionally NOT wrapped in `Pressable`, so tap gestures
 *     within the section have nowhere to go (R11.12).
 *
 * Tap-to-detail (R11.6):
 *
 *   - Each row is a `Pressable` that dispatches a cross-stack
 *     navigation into the Catalog tab's `ExperienceDetail` screen,
 *     passing the leaderboard entry's `experienceId`. The detail
 *     screen owns its own loading and error handling.
 *
 * Validates: Requirements R11.1, R11.2, R11.3, R11.4, R11.5, R11.6,
 *            R11.7, R11.8, R11.9, R11.10, R11.11, R11.12
 */

import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

import type { ExperienceCategory, LeaderboardEntryDTO } from '@dwt/shared';

import { ApiError, apiRequest } from '../../api/client';
import type { MainTabParamList } from '../../navigation/RootNavigator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = BottomTabScreenProps<MainTabParamList, 'Home'>;

/**
 * Wire shape for `GET /home/highest-rated`. Mirrors
 * `LeaderboardResponse` declared in
 * `apps/api/src/services/aggregate/leaderboardRoutes.ts`. The screen
 * only reads `entries`, so additional metadata fields (e.g. cache age)
 * could be added on the server later without a coordinated client
 * change.
 */
interface LeaderboardResponse {
  readonly entries: readonly LeaderboardEntryDTO[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 5 minutes. Used for both `staleTime` (controls when react-query
 * considers the cached entry fit to serve without a network call —
 * R11.8) and `gcTime` (keeps the cached entry resident at least until
 * staleness can be re-checked — R11.7). Both values together
 * implement R11.9's "at most once every 5 minutes" cap.
 */
const CACHE_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function HomeScreen({ navigation }: Props): JSX.Element {
  const query = useQuery<LeaderboardResponse, ApiError>({
    queryKey: ['home', 'highest-rated'] as const,
    queryFn: () => apiRequest<LeaderboardResponse>('GET', '/home/highest-rated'),
    staleTime: CACHE_WINDOW_MS,
    gcTime: CACHE_WINDOW_MS,
  });

  const showLoading = query.isLoading && query.data === undefined;
  const entries = query.data?.entries ?? [];
  const showEmpty =
    !showLoading && !query.isError && entries.length === 0;
  // R11.10/R11.11: between 1 and 9 qualifying Experiences renders the
  // populated list (with whatever count we got); zero qualifying drops
  // through to the empty-state branch.
  const showList = !showLoading && !query.isError && entries.length > 0;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Highest-Rated Experiences
      </Text>

      {showLoading ? (
        <View style={styles.center} testID="home-leaderboard-loading">
          <ActivityIndicator />
        </View>
      ) : null}

      {query.isError && query.data === undefined ? (
        <View style={styles.center} testID="home-leaderboard-error">
          <Text style={styles.errorText}>
            Couldn&apos;t load the leaderboard. Pull to refresh later.
          </Text>
        </View>
      ) : null}

      {showEmpty ? (
        // R11.11 + R11.12: render a plain Text node — no Pressable, no
        // onPress wiring — so tap gestures within the section cannot
        // resolve to a navigation action.
        <View style={styles.center} testID="home-leaderboard-empty">
          <Text style={styles.emptyText}>
            No leaderboard yet — keep exploring!
          </Text>
        </View>
      ) : null}

      {showList ? (
        <FlatList
          data={entries as LeaderboardEntryDTO[]}
          keyExtractor={(item) => item.experienceId}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <LeaderboardRow
              entry={item}
              onPress={() => {
                // R11.6: cross-stack navigation into the Catalog tab's
                // ExperienceDetail screen. The bottom-tab navigator
                // accepts a nested `screen`/`params` payload to drive
                // a child stack.
                navigation.navigate('Catalog', {
                  screen: 'ExperienceDetail',
                  params: { experienceId: item.experienceId },
                });
              }}
            />
          )}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface LeaderboardRowProps {
  readonly entry: LeaderboardEntryDTO;
  readonly onPress: () => void;
}

function LeaderboardRow({ entry, onPress }: LeaderboardRowProps): JSX.Element {
  // R11.5: name, Park, Experience_Category, Aggregate_Rating to one
  // decimal place, count of contributing Ratings.
  const meanLabel = entry.value.toFixed(1);
  const countLabel = `${entry.count} ${entry.count === 1 ? 'rating' : 'ratings'}`;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${entry.name}, ${entry.park}, ${formatCategory(
        entry.category,
      )}, rated ${meanLabel} from ${countLabel}`}
      testID={`home-leaderboard-row-${entry.experienceId}`}
    >
      <Text style={styles.rowName} numberOfLines={1}>
        {entry.name}
      </Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {entry.park} • {formatCategory(entry.category)}
      </Text>
      <Text style={styles.rowStats}>
        {meanLabel} / 10 ({countLabel})
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render the underscore-bearing `Character_Meet` enum literal as a
 * friendly "Character Meet" label. Mirrors the formatter used by
 * `CatalogScreen` so the two surfaces present categories identically.
 */
function formatCategory(value: ExperienceCategory): string {
  return value === 'Character_Meet' ? 'Character Meet' : value;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111111',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: {
    fontSize: 15,
    color: '#555555',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 14,
    color: '#b91c1c',
    textAlign: 'center',
  },
  listContent: {
    paddingBottom: 24,
  },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eeeeee',
  },
  rowPressed: {
    backgroundColor: '#f7f7f7',
  },
  rowName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
    marginBottom: 2,
  },
  rowMeta: {
    fontSize: 12,
    color: '#666666',
    marginBottom: 2,
  },
  rowStats: {
    fontSize: 13,
    color: '#222222',
    fontWeight: '600',
  },
});
