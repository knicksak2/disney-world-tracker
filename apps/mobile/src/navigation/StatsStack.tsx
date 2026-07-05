import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import StatsScreen from '../screens/stats/StatsScreen';
import CoverageDetailScreen from '../screens/stats/CoverageDetailScreen';
import RatingsDetailScreen from '../screens/stats/RatingsDetailScreen';
import InterestsDetailScreen from '../screens/stats/InterestsDetailScreen';
import ExperiencesDetailScreen from '../screens/stats/ExperiencesDetailScreen';
import type { CoverageFocus } from '../screens/stats/statsView';

/**
 * Stats tab stack.
 *
 * The Stats tab nests its own native stack so the user can drill from the
 * Overview hub (`StatsScreen`, the initial route) into a focused, bounded
 * detail screen without leaving the tab. This mirrors the existing
 * `CatalogStack`/`FriendsStack` pattern: the bottom tab bar stays visible,
 * native back/gestures come for free, and every detail screen re-reads the
 * shared cached `['me-stats', { percentile: true }]` snapshot rather than
 * receiving data through params (D1a).
 *
 * Route params are intentionally minimal — no screen receives a
 * `StatsResponse` through navigation. The only param is `CoverageDetail`'s
 * optional, serializable `focus` hint, whose union mirrors `CoverageFocus`
 * (including the `'resorts'` lens) so the hub's highlight cards and external
 * deep-links can jump straight to a specific coverage lens (R3.5).
 */
export type StatsStackParamList = {
  /** Overview hub — the Stats tab landing (initial route). */
  StatsOverview: undefined;
  /** Focused coverage story; optional deep-link focus (e.g. jump to a lens). */
  CoverageDetail: { focus?: CoverageFocus } | undefined;
  /** Focused ratings story (rich or unlock state, decided from the cache). */
  RatingsDetail: undefined;
  /** Focused interests/facets grid. */
  InterestsDetail: undefined;
  /** The existing ExperiencesList wrapped as its own route (D8). */
  ExperiencesDetail: undefined;
};

const Stack = createNativeStackNavigator<StatsStackParamList>();

export default function StatsStack(): JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="StatsOverview" component={StatsScreen} />
      <Stack.Screen name="CoverageDetail" component={CoverageDetailScreen} />
      <Stack.Screen name="RatingsDetail" component={RatingsDetailScreen} />
      <Stack.Screen name="InterestsDetail" component={InterestsDetailScreen} />
      <Stack.Screen name="ExperiencesDetail" component={ExperiencesDetailScreen} />
    </Stack.Navigator>
  );
}
